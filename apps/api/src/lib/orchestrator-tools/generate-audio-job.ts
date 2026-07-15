import { createDurableOrchestratorJobWriter, startDurableJobHeartbeat, type OrchestratorJobWriter } from "@/lib/orchestrator/job-gateway";
import { scheduleOrchestratorResume } from "@/lib/orchestrator/schedule-resume";
import type { AuthContext } from "@/lib/api/v1/auth";
import { createGeneratedAsset as realCreateGeneratedAsset } from "@/lib/api/v1/generated-assets";
import {
  getActiveProjectScopedAsset as realGetActiveProjectScopedAsset,
  selectGeneratedAudioAsset as realSelectGeneratedAudioAsset,
} from "@/lib/api/v1/store";
import type { V1Asset } from "@/lib/api/v1/store";
import type { VideoBrief } from "@/lib/api/v1/schemas";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";
import type { ShotPlan } from "@popcorn/shared/types";

type AudioProvider = "elevenlabs" | "mock";

export interface GenerateAudioJobDeps {
  createGeneratedAsset: typeof realCreateGeneratedAsset;
  getActiveProjectScopedAsset: typeof realGetActiveProjectScopedAsset;
  selectGeneratedAudioAsset: typeof realSelectGeneratedAudioAsset;
  jobs?: Pick<OrchestratorJobWriter, "setStep" | "succeed" | "fail"> & Partial<Pick<OrchestratorJobWriter, "reportProgress">>;
  enqueueOrchestratorDispatch?: (runId: string, workspaceId: string) => Promise<unknown>;
}

const defaultDeps: GenerateAudioJobDeps = {
  createGeneratedAsset: realCreateGeneratedAsset,
  getActiveProjectScopedAsset: realGetActiveProjectScopedAsset,
  selectGeneratedAudioAsset: realSelectGeneratedAudioAsset,
};

function localAuth(workspaceId: string): AuthContext {
  return {
    mode: "local",
    actor: { id: "orchestrator", type: "local" },
    workspaceId,
    isLocal: true,
  };
}

async function resume(
  deps: GenerateAudioJobDeps,
  runId: string,
  workspaceId: string
): Promise<void> {
  await scheduleOrchestratorResume({ runId, workspaceId, enqueue: deps.enqueueOrchestratorDispatch });
}

function assetIdsFromResult(result: Awaited<ReturnType<typeof realCreateGeneratedAsset>>): string[] {
  const job = result.body.job as { result?: { assetIds?: unknown } } | undefined;
  const ids = job?.result?.assetIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

type PlanBeat = {
  id: string;
  name?: string;
  durationSec?: number;
  intent?: string;
  narration?: string;
  dialogue?: string;
};

function planBeats(plan: ShotPlan): PlanBeat[] {
  const beats: PlanBeat[] = [];
  for (const scene of plan.scenes ?? []) {
    for (const beat of scene.beats ?? []) {
      if (!beat.id) continue;
      beats.push({
        id: beat.id,
        name: beat.name ?? scene.name,
        durationSec: beat.durationSec,
        intent: beat.intent,
      });
    }
  }
  return beats;
}

function durationForBeat(beat: PlanBeat): number {
  const duration = Number(beat.durationSec);
  return Number.isFinite(duration) && duration > 0 ? duration : 5;
}

function narrationTextForBeat(beat: PlanBeat): string {
  return (beat.narration || beat.dialogue || beat.intent || beat.name || "").trim();
}

function soundtrackPrompt(input: {
  plan: ShotPlan;
  brief?: VideoBrief;
  feedback?: string;
}): string {
  return [
    `Create an instrumental soundtrack for a ${input.plan.targetLengthSec}-second video.`,
    input.brief?.goal ? `Goal: ${input.brief.goal}` : undefined,
    input.plan.style || input.brief?.style ? `Style: ${input.plan.style || input.brief?.style}` : undefined,
    input.feedback ? `Direction: ${input.feedback}` : undefined,
    "No vocals. Support the edit rhythm without overpowering narration.",
  ]
    .filter(Boolean)
    .join(" ");
}

function graphInputsForPlan(input: GenerateAudioJobInput): GraphAssetInput[] {
  const graphInputs: GraphAssetInput[] = [
    {
      assetId: input.planAssetId,
      relation: "input",
      role: "plan",
      position: 0,
      ...(input.planContentHash ? { contentHash: input.planContentHash } : {}),
    },
  ];
  if (input.briefAssetId) {
    graphInputs.push({
      assetId: input.briefAssetId,
      relation: "input",
      role: "brief",
      position: 1,
      ...(input.briefContentHash ? { contentHash: input.briefContentHash } : {}),
    });
  }
  return graphInputs;
}

function graphInputsMatch(expected: GraphAssetInput[], actual: GraphAssetInput[] | undefined): boolean {
  if (!actual || actual.length === 0) return false;
  return expected.every((expectedInput) =>
    actual.some(
      (actualInput) =>
        actualInput.assetId === expectedInput.assetId &&
        actualInput.role === expectedInput.role &&
        (!expectedInput.contentHash || actualInput.contentHash === expectedInput.contentHash)
    )
  );
}

function canReuseSelectedAudio(
  asset: V1Asset,
  expectedGraphInputs: GraphAssetInput[]
): boolean {
  if (asset.source.type !== "generated") return true;
  return graphInputsMatch(expectedGraphInputs, asset.graphInputs);
}

export interface GenerateAudioJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  orchestratorRunId?: string;
  plan: ShotPlan;
  planAssetId: string;
  planContentHash: string;
  brief?: VideoBrief;
  briefAssetId?: string;
  briefContentHash?: string;
  provider?: AudioProvider;
  voiceId?: string;
  feedback?: string;
}

export async function runGenerateAudioJob(
  input: GenerateAudioJobInput,
  deps: Partial<GenerateAudioJobDeps> = {}
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const jobs = d.jobs ?? createDurableOrchestratorJobWriter(input.workspaceId, input.projectId);
  const stopHeartbeat = startDurableJobHeartbeat(jobs, input.jobId);
  try {
    await jobs.setStep(input.jobId, "generating_assets");
    const auth = localAuth(input.workspaceId);
    const assetIds: string[] = [];
    const graphInputs = graphInputsForPlan(input);

    for (const beat of planBeats(input.plan)) {
      const existing = await d.getActiveProjectScopedAsset({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        slotRole: `voiceover:${beat.id}`,
        expectedRole: "voiceover",
      });
      if (existing && canReuseSelectedAudio(existing, graphInputs)) {
        assetIds.push(existing.id);
        continue;
      }

      const prompt = narrationTextForBeat(beat);
      if (!prompt) continue;
      const result = await d.createGeneratedAsset({
        auth,
        projectId: input.projectId,
        body: {
          kind: "audio",
          ...(input.provider ? { provider: input.provider } : {}),
          prompt,
          description: `Voiceover for ${beat.name ?? beat.id}`,
          name: `Voiceover — ${beat.name ?? beat.id}`,
          slug: `voiceover-${beat.id}`,
          durationSec: durationForBeat(beat),
          audioMode: "speech",
          assetRole: "voiceover",
          graphInputs,
          ...(input.voiceId ? { voiceId: input.voiceId } : {}),
          ...(input.orchestratorRunId ? { runId: input.orchestratorRunId } : {}),
        },
      });
      const generatedIds = assetIdsFromResult(result);
      if (generatedIds.length === 0) {
        throw new Error(`Voiceover generation returned no assets for ${beat.id}.`);
      }
      for (const assetId of generatedIds) {
        await d.selectGeneratedAudioAsset({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          assetId,
          role: "voiceover",
          slotKey: beat.id,
        });
        assetIds.push(assetId);
      }
    }

    const soundtrack = await d.getActiveProjectScopedAsset({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      slotRole: "soundtrack:main",
      expectedRole: "soundtrack",
    });
    if (soundtrack && canReuseSelectedAudio(soundtrack, graphInputs)) {
      assetIds.push(soundtrack.id);
    } else {
      const result = await d.createGeneratedAsset({
        auth,
        projectId: input.projectId,
        body: {
          kind: "audio",
          ...(input.provider ? { provider: input.provider } : {}),
          prompt: soundtrackPrompt(input),
          description: "Generated soundtrack",
          name: "Soundtrack",
          slug: "soundtrack-main",
          durationSec: input.plan.targetLengthSec,
          audioMode: "music",
          forceInstrumental: true,
          assetRole: "soundtrack",
          graphInputs,
          ...(input.orchestratorRunId ? { runId: input.orchestratorRunId } : {}),
        },
      });
      const generatedIds = assetIdsFromResult(result);
      if (generatedIds.length === 0) {
        throw new Error("Soundtrack generation returned no assets.");
      }
      for (const assetId of generatedIds) {
        await d.selectGeneratedAudioAsset({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          assetId,
          role: "soundtrack",
          slotKey: "main",
        });
        assetIds.push(assetId);
      }
    }

    await jobs.succeed(input.jobId, { assetIds });
  } catch (err) {
    await jobs.fail(input.jobId, {
      code: "job_failed",
      message: err instanceof Error ? err.message : String(err),
      requestId: "",
    });
  } finally {
    stopHeartbeat();
    if (input.orchestratorRunId) {
      try {
        await resume(d, input.orchestratorRunId, input.workspaceId);
      } catch {
        // best-effort: durable run sweepers can resume a parked run later.
      }
    }
  }
}
