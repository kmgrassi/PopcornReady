import { useLocation, useSearchParams } from "react-router-dom";
import { StudioShell } from "../components/studio/StudioShell";
import type { StudioStep } from "../components/studio/studioSteps";
import type { BriefDraft } from "../components/studio/useStudioFlow";
import { studioTemplateById } from "../lib/studioTemplates";
import { readScriptCreationHandoff } from "../lib/scriptCreationHandoff";

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
  return PROJECT_CREATION_STEP_SET.has(value as StudioStep) ? (value as StudioStep) : undefined;
}

export function ProjectCreationPage() {
  const location = useLocation();
  const [params] = useSearchParams();
  const scriptHandoff = readScriptCreationHandoff(location.state);
  const goal = params.get("goal") ?? "";
  const length = Number(params.get("length"));
  const initialStep = scriptHandoff
    ? "brief"
    : parseCreationStep(params.get("step"));
  const openPanel = params.get("panel") ?? undefined;
  const draftId = params.get("draft");
  const template = studioTemplateById(params.get("template"));
  const newDraftRequest = params.get("new") ?? undefined;
  const autoStartGeneration =
    !scriptHandoff &&
    (params.get("autoStart") === "1" || (Boolean(goal.trim()) && !draftId));

  const initialBrief: Partial<BriefDraft> = {
    ...template?.draft,
    ...(goal ? { goal } : {}),
    ...(Number.isFinite(length) && length > 0 ? { targetLengthSec: length } : {}),
    ...scriptHandoff,
  };

  return (
    <StudioShell
      initialBrief={initialBrief}
      initialStep={initialStep}
      initialStarted={Boolean(
        scriptHandoff || params.has("start") || initialStep || goal || template,
      )}
      openPanel={openPanel}
      draftId={draftId}
      newDraftRequest={newDraftRequest}
      autoStartGeneration={autoStartGeneration}
    />
  );
}
