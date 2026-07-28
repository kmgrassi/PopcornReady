import {
  createDurableOrchestratorJobCreator,
  type OrchestratorJobCreator,
} from "@/lib/orchestrator/job-gateway";
import {
  getActiveProjectPlan as realGetActiveProjectPlan,
  getAsset as realGetAsset,
  getProjectCurrentStoryboardId as realGetProjectCurrentStoryboardId,
  getProjectStoryboardById as realGetProjectStoryboardById,
  getProjectStoryboardsForPlan as realGetProjectStoryboardsForPlan,
} from "@/lib/api/v1/store";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";
import { runStoryboardJob as realRunStoryboardJob } from "./storyboard-job";
import {
  resolveVisualTargets,
  shotPlanForTargetBeats,
  type TrustedVisualTargets,
} from "./visual-targeting";
import { preservedStoryboardTiles } from "./storyboard-keyframe-handoff";

// generate_storyboard reads the project's persisted plan (the stage→stage handoff
// through the asset graph) and generates one cheap sketch tile per beat. It is the
// first ASYNC tool: it enqueues a job, kicks off the background work, and returns
// `accepted` so the orchestrator parks the run and resumes when the job completes.
export interface GenerateStoryboardInput {
  /** Optional instruction to revise an existing storyboard. */
  feedback?: string;
  /** Server-derived domain scope; never model-authored. */
  trustedVisualTargets?: TrustedVisualTargets;
}

export interface GenerateStoryboardOutput {
  jobId: string;
}

export interface GenerateStoryboardDeps {
  getActiveProjectPlan: typeof realGetActiveProjectPlan;
  getAsset: typeof realGetAsset;
  getProjectCurrentStoryboardId: typeof realGetProjectCurrentStoryboardId;
  getProjectStoryboardById: typeof realGetProjectStoryboardById;
  getProjectStoryboardsForPlan: typeof realGetProjectStoryboardsForPlan;
  createJob: OrchestratorJobCreator["createJob"];
  runStoryboardJob: typeof realRunStoryboardJob;
}

const defaultDeps: GenerateStoryboardDeps = {
  getActiveProjectPlan: realGetActiveProjectPlan,
  getAsset: realGetAsset,
  getProjectCurrentStoryboardId: realGetProjectCurrentStoryboardId,
  getProjectStoryboardById: realGetProjectStoryboardById,
  getProjectStoryboardsForPlan: realGetProjectStoryboardsForPlan,
  createJob: createDurableOrchestratorJobCreator().createJob,
  runStoryboardJob: realRunStoryboardJob,
};

export const generateStoryboardInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    feedback: { type: "string", description: "Optional revision instruction." },
  },
} as const;

export const generateStoryboardOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { jobId: { type: "string" } },
  required: ["jobId"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGenerateStoryboardInput(input: unknown): GenerateStoryboardInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("generate_storyboard input must be an object.", {
      expected: generateStoryboardInputSchema,
    });
  }
  const feedback = input.feedback;
  if (feedback !== undefined && typeof feedback !== "string") {
    throw new ToolInputError("generate_storyboard feedback must be a string.", {});
  }
  return feedback && feedback.trim() ? { feedback: feedback.trim() } : {};
}

function planRequired(): ToolCallResult<GenerateStoryboardOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "generate_storyboard needs a shot plan before it can sketch the storyboard.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "plan",
          because: "Storyboard tiles are generated one per planned beat.",
          satisfyWith: { tool: "plan_shots", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "plan_shots", inputHint: {} }],
    },
  };
}

export function createGenerateStoryboardTool(
  deps: Partial<GenerateStoryboardDeps> = {}
): ToolDefinition<GenerateStoryboardInput, GenerateStoryboardOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("generate_storyboard"),
    description:
      "Generate cheap sketch beat_storyboard tiles — one previsualization image per planned beat — and persist them as the project's storyboard. Requires a plan first. Runs asynchronously. Do not use this to satisfy a missing beat_keyframe; beat_keyframe first-frame assets come from generate_keyframe.",
    usage: {
      preconditions: ["An active shot plan exists (call plan_shots first)."],
      produces: [
        "Cheap sketch beat_storyboard tiles — one per planned beat — persisted as the project's storyboard. Runs asynchronously (parks the run until the job completes).",
        "Selected beat_storyboard tiles that generate_keyframe can use as composition references.",
      ],
      useWhen: [
        "The plan (and any visual anchors) is ready and you need a low-cost previsualization before committing to expensive media generation.",
        "generate_keyframe failed because selected beat_storyboard tiles are missing.",
        "Do not use when generate_clip failed because beat_keyframe assets are missing; call generate_keyframe instead.",
      ],
    },
    inputSchema: generateStoryboardInputSchema,
    outputSchema: generateStoryboardOutputSchema,
    parseInput: parseGenerateStoryboardInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "image_generation",
      notes: "One cheap sketch tile per beat; cost scales with beat count and provider.",
    }),
    async execute(_input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "generate_storyboard requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }
      if (
        context.domainTask &&
        (!context.orchestratorRunId ||
          context.sessionClaimGeneration === undefined ||
          !context.actionId)
      ) {
        throw new ToolInputError(
          "Domain storyboard generation requires its exact run, session claim, and invocation action."
        );
      }

      const active = await resolved.getActiveProjectPlan(context.projectId);
      if (!active) {
        return planRequired();
      }
      const targets = await resolveVisualTargets({
        activePlan: active,
        targets: _input.trustedVisualTargets,
        loadStoryboard: (storyboardId) =>
          resolved.getProjectStoryboardById(
            context.auth.workspaceId,
            context.projectId!,
            storyboardId
          ),
      });
      const generationPlan = shotPlanForTargetBeats(
        active.plan,
        targets?.planBeatIds
      );
      if (context.domainTask && generationPlan.scenes.length === 0) {
        throw new ToolInputError("No planned beats intersect the trusted task targets.");
      }
      const allBeatCount = active.plan.scenes.reduce(
        (count, scene) => count + scene.beats.length,
        0
      );
      const targetBeatCount = generationPlan.scenes.reduce(
        (count, scene) => count + scene.beats.length,
        0
      );
      let baselineStoryboardId: string | undefined;
      if (targetBeatCount !== allBeatCount) {
        const candidates = targets?.sourceStoryboard
          ? [targets.sourceStoryboard]
          : await resolved.getProjectStoryboardsForPlan(
              context.auth.workspaceId,
              context.projectId,
              active.assetId
            );
        for (const candidate of candidates) {
          try {
            await preservedStoryboardTiles({
              plan: active.plan,
              planAssetId: active.assetId,
              planContentHash: active.contentHash,
              storyboard: candidate,
              targetBeatIds: targets?.planBeatIds ?? [],
              loadAsset: (assetId) =>
                resolved.getAsset(
                  context.auth.workspaceId,
                  context.projectId!,
                  assetId
                ),
            });
            baselineStoryboardId = candidate.id;
            break;
          } catch {
            // Try an older same-plan attempt only when no exact relational
            // target fixed the baseline identity.
            if (targets?.sourceStoryboard) break;
          }
        }
        if (!baselineStoryboardId) {
          throw new ToolInputError(
            "Scoped storyboard generation needs a complete compatible storyboard to preserve untargeted beats."
          );
        }
      }
      const expectedCurrentStoryboardId =
        context.sessionClaimGeneration !== undefined
          ? await resolved.getProjectCurrentStoryboardId(
              context.auth.workspaceId,
              context.projectId
            )
          : undefined;
      if (
        context.sessionClaimGeneration !== undefined &&
        (active.selectionSeq === undefined || !context.actionId)
      ) {
        throw new ToolInputError(
          "Claimed storyboard generation requires an explicitly selected plan and invocation action."
        );
      }

      const { job, created } = await resolved.createJob({
        workspaceId: context.auth.workspaceId,
        type: "asset_generation",
        projectId: context.projectId,
        sessionClaimGeneration: context.sessionClaimGeneration,
        ...(context.actionId
          ? { actionId: context.actionId, idempotencyKey: `action:${context.actionId}` }
          : {}),
        execution: {
          schemaVersion: "orchestrator_job_execution.v1",
          kind: "generate_storyboard",
          input: {
            workspaceId: context.auth.workspaceId,
            projectId: context.projectId,
            ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
            ...(context.sessionClaimGeneration !== undefined
              ? { sessionClaimGeneration: context.sessionClaimGeneration }
              : {}),
            ...(context.actionId ? { createdByActionId: context.actionId } : {}),
            plan: active.plan,
            planAssetId: active.assetId,
            planContentHash: active.contentHash,
            ...(active.selectionSeq !== undefined
              ? { expectedPlanSelectionSeq: active.selectionSeq }
              : {}),
            ...(expectedCurrentStoryboardId !== undefined
              ? { expectedCurrentStoryboardId }
              : {}),
            ...(targets?.planBeatIds.length
              ? { targetBeatIds: targets.planBeatIds }
              : {}),
            ...(baselineStoryboardId ? { baselineStoryboardId } : {}),
          },
        },
      });

      // Fire-and-forget: the worker writes the tiles + storyboard, marks the job
      // terminal, and resumes the parked run on completion.
      if (created) {
        void resolved.runStoryboardJob({
          jobId: job.id,
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
          ...(context.sessionClaimGeneration !== undefined
            ? { sessionClaimGeneration: context.sessionClaimGeneration }
            : {}),
          ...(context.actionId ? { createdByActionId: context.actionId } : {}),
          plan: active.plan,
          planAssetId: active.assetId,
          planContentHash: active.contentHash,
          ...(active.selectionSeq !== undefined
            ? { expectedPlanSelectionSeq: active.selectionSeq }
            : {}),
          ...(expectedCurrentStoryboardId !== undefined
            ? { expectedCurrentStoryboardId }
            : {}),
          ...(targets?.planBeatIds.length
            ? { targetBeatIds: targets.planBeatIds }
            : {}),
          ...(baselineStoryboardId ? { baselineStoryboardId } : {}),
        });
      }

      return { status: "accepted", jobId: job.id, resumesWhen: "job_terminal" };
    },
  };
}
