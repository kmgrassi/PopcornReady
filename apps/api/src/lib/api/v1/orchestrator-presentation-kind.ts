import type { GenerationRun } from "@popcorn/shared/v1/types";
import type { OrchestratorRun } from "./orchestrator-store";

export function orchestratorRunPresentationKind(
  run: Pick<OrchestratorRun, "originKind" | "taskKind">
): GenerationRun["presentationKind"] {
  if (run.originKind !== "creator_direct") return undefined;
  if (run.taskKind === "image_create") return "standalone_image";
  if (run.taskKind === "video_create" || run.taskKind === "video_edit") {
    return "standalone_video";
  }
  if (run.taskKind === "soundtrack_create" || run.taskKind === "audio_create") {
    return "standalone_audio";
  }
  return undefined;
}
