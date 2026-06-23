import { useSearchParams } from "react-router-dom";
import {
  GATEABLE_GENERATION_STAGE_TYPES,
  type GateableGenerationStageType,
} from "@popcorn/shared/v1/types";
import { StudioShell } from "../components/studio/StudioShell";
import {
  normalizeStudioStep,
  type StudioStep,
} from "../components/studio/studioSteps";
import type { BriefDraft } from "../components/studio/useStudioFlow";

const PROJECT_CREATION_STEP_SET = new Set<StudioStep>([
  "brief",
  "footage",
  "plan",
  "story",
  "generate",
  "review",
  "export",
]);

function parseCreationStep(value: string | null): StudioStep | undefined {
  return PROJECT_CREATION_STEP_SET.has(value as StudioStep)
    ? normalizeStudioStep(value)
    : undefined;
}

function parseReviewGates(value: string | null): GateableGenerationStageType[] {
  if (!value) return [];
  const validStages = new Set<string>(GATEABLE_GENERATION_STAGE_TYPES);
  return value
    .split(",")
    .filter((stage): stage is GateableGenerationStageType => validStages.has(stage));
}

export function ProjectCreationPage() {
  const [params] = useSearchParams();
  const goal = params.get("goal") ?? "";
  const length = Number(params.get("length"));
  const initialStep = parseCreationStep(params.get("step"));
  const openPanel = params.get("panel") ?? undefined;
  const reviewGates = parseReviewGates(params.get("reviewGates"));
  const draftId = params.get("draft");
  const newDraftRequest = params.get("new") ?? undefined;
  const autoStartGeneration =
    params.get("autoStart") === "1" || (Boolean(goal.trim()) && !draftId);

  const initialBrief: Partial<BriefDraft> = {
    ...(goal ? { goal } : {}),
    ...(Number.isFinite(length) && length > 0 ? { targetLengthSec: length } : {}),
    ...(reviewGates.length > 0 ? { reviewGates } : {}),
  };

  return (
    <StudioShell
      initialBrief={initialBrief}
      initialStep={initialStep}
      initialStarted={params.has("start") || Boolean(initialStep || goal)}
      openPanel={openPanel}
      draftId={draftId}
      newDraftRequest={newDraftRequest}
      autoStartGeneration={autoStartGeneration}
    />
  );
}
