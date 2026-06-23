import type { Page, Route } from "@playwright/test";
import { GENERATION_STAGE_LABELS } from "@popcorn/shared/v1/types";
import type {
  GenerationRun,
  GenerationRunStatus,
  GenerationStage,
  GenerationStageItem,
  GateableGenerationStageType,
  RunReviewGate,
  GenerationStageType,
} from "@popcorn/shared/v1/types";
import type { GenerationRunDetail } from "../../src/lib/v1/generation-runs/status";

export const e2eProjectId = "e2e-project-run-progress";

const now = "2026-06-16T14:00:00.000Z";

export function localMeResponse() {
  return {
    actor: {
      id: "dev-user",
      type: "local",
      email: "developer@popcornready.local",
    },
    workspaceId: "dev_workspace",
    workspaceName: "Development workspace",
    authMode: "local",
    isLocal: true,
  };
}

export function makeRunDetail(
  runId: string,
  options: {
    status?: GenerationRunStatus;
    reviewGate?: RunReviewGate | null;
    currentStageType?: GenerationStageType;
    progressPercent?: number;
    message?: string;
    error?: GenerationRun["error"];
    completedAt?: string;
  } = {},
): GenerationRunDetail {
  const status = options.status ?? "running";
  const currentStageType = options.currentStageType ?? "quality_review";
  const run: GenerationRun = {
    runId,
    projectId: e2eProjectId,
    status,
    reviewGates: options.reviewGate ? [options.reviewGate.stageType] : [],
    reviewGate: options.reviewGate ?? null,
    currentStageType,
    progressPercent: options.progressPercent ?? progressForStatus(status),
    message: options.message ?? messageForStatus(status),
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: options.completedAt,
    error: options.error,
  };

  return {
    run,
    stages: makeStages(runId, status, options.reviewGate, currentStageType),
    stageItems: options.reviewGate ? makeStageItems(options.reviewGate.stageId) : [],
  };
}

export function reviewGate(
  stageType: GateableGenerationStageType = "quality_review",
): RunReviewGate {
  return {
    stageType,
    stageId: `${stageType}-stage`,
    state: "awaiting_review",
    enteredAt: now,
  };
}

export async function installRunProgressRoutes(
  page: Page,
  options: {
    detail: GenerationRunDetail;
    onAction?: (
      action: "approve" | "reject" | "cancel",
      body: unknown,
    ) => GenerationRunDetail;
    waitForGet?: Promise<void>;
  },
) {
  let detail = options.detail;
  const actionBodies: Array<{ action: string; body: unknown }> = [];

  await page.route("**/api/v1/**", async (route: Route) => {
    await route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Unhandled e2e API route." } },
    });
  });

  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({ json: localMeResponse() });
  });

  await page.route(`**/api/v1/projects/${e2eProjectId}`, async (route) => {
    await route.fulfill({
      json: {
        project: {
          id: e2eProjectId,
          schemaVersion: 1,
          workspaceId: "dev_workspace",
          name: "Run progress E2E project",
          status: "active",
          visibility: "private",
          brief: {
            goal: "Verify run progress actions",
            targetLengthSec: 30,
            aspectRatio: "9:16",
            platform: "tiktok",
            format: "visual_reveal",
            audience: "Producers",
            style: "fast-paced social ad",
            hookQuestion: "Can the user direct the run?",
            oneBigIdea: "Run controls stay in the workspace.",
            strongestVisual: "A progress rail with review checkpoints.",
            payoff: "The rough cut reaches review.",
            caveat: "",
          },
          currentBriefVersionId: null,
          hasStoryboard: false,
          posterAssetId: null,
          posterUrl: null,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  });

  await page.route(
    /\/api\/v1\/projects\/[^/]+\/generation-runs\/[^/]+(?:\/(?:approve|reject|cancel))?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const action = url.pathname.split("/").at(-1);

      if (request.method() === "GET") {
        await options.waitForGet;
        await route.fulfill({
          headers: { "Cache-Control": "no-store" },
          json: detail,
        });
        return;
      }

      if (
        request.method() === "POST" &&
        (action === "approve" || action === "reject" || action === "cancel")
      ) {
        const body = request.postDataJSON() as unknown;
        actionBodies.push({ action, body });
        detail = options.onAction
          ? options.onAction(action, body)
          : defaultActionResult(action, detail);
        await route.fulfill({ status: action === "cancel" ? 200 : 202, json: detail });
        return;
      }

      await route.continue();
    },
  );
  return {
    get actionBodies() {
      return actionBodies;
    },
    get detail() {
      return detail;
    },
  };
}

function defaultActionResult(
  action: "approve" | "reject" | "cancel",
  current: GenerationRunDetail,
): GenerationRunDetail {
  if (action === "cancel") {
    return {
      ...current,
      run: {
        ...current.run,
        status: "canceled",
        reviewGate: null,
        message: "Generation was canceled.",
        completedAt: now,
        updatedAt: now,
      },
    };
  }

  return {
    ...current,
    run: {
      ...current.run,
      reviewGate: null,
      currentStageType:
        action === "approve" ? "export" : current.run.currentStageType ?? "quality_review",
      message:
        action === "approve"
          ? "Review approved. Final render is in progress."
          : "Feedback received. Regenerating this stage.",
      updatedAt: now,
    },
    stages: makeStages(
      current.run.runId,
      current.run.status,
      null,
      action === "approve" ? "export" : current.run.currentStageType ?? "quality_review",
    ),
  };
}

function makeStages(
  runId: string,
  status: GenerationRunStatus,
  gate: RunReviewGate | null | undefined,
  currentStageType: GenerationStageType = gate?.stageType ?? "quality_review",
): GenerationStage[] {
  const stageTypes: GenerationStageType[] = [
    "brief_intake",
    "creative_plan",
    "storyboard",
    "asset_generation",
    "audio_generation",
    "timeline_assembly",
    "quality_review",
    "export",
    "ready",
  ];

  return stageTypes.map((type, index) => {
    const stageId = type === gate?.stageType ? gate.stageId : `${type}-stage`;
    const terminal = status === "succeeded" || status === "failed" || status === "canceled";
    const activeIndex = Math.max(0, stageTypes.indexOf(gate?.stageType ?? currentStageType));
    const beforeGate = index < activeIndex;
    const isGate = gate?.stageId === stageId;
    const isCurrent = type === currentStageType && !gate && !terminal;

    return {
      stageId,
      runId,
      type,
      label: GENERATION_STAGE_LABELS[type],
      order: index + 1,
      status: terminal
        ? status
        : isGate
          ? "running"
          : beforeGate
            ? "succeeded"
            : isCurrent
              ? "running"
              : "queued",
      progressPercent: terminal ? 100 : beforeGate ? 100 : isGate || isCurrent ? 70 : 0,
      message: isGate ? "Quality review is ready for approval." : undefined,
      jobIds: [],
      artifactIds: [],
      createdAt: now,
      updatedAt: now,
      startedAt: beforeGate || isGate || isCurrent ? now : undefined,
      completedAt: terminal || beforeGate ? now : undefined,
      judgment: isGate
        ? {
            judgmentId: "judgment-e2e",
            evaluatorId: "e2e-evaluator",
            verdict: "needs_review",
            rationale: "The stage is ready for human review.",
            createdAt: now,
          }
        : undefined,
    };
  });
}

function makeStageItems(stageId: string): GenerationStageItem[] {
  return [
    {
      itemId: "quality-summary",
      stageId,
      kind: "timeline",
      purpose: "timeline",
      label: "Continuity report",
      status: "succeeded",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function progressForStatus(status: GenerationRunStatus): number {
  if (status === "succeeded") return 100;
  if (status === "failed" || status === "canceled") return 70;
  return 72;
}

function messageForStatus(status: GenerationRunStatus): string {
  switch (status) {
    case "succeeded":
      return "Your video is ready.";
    case "failed":
      return "Generation failed during quality review.";
    case "canceled":
      return "Generation was canceled.";
    default:
      return "Quality review is running.";
  }
}
