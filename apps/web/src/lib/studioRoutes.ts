import type { StudioStep } from "../components/studio/useStudioFlow";

export function newStudioDraftPath({
  step,
  panel,
}: {
  step?: StudioStep;
  panel?: string;
} = {}): string {
  const requestId = globalThis.crypto?.randomUUID?.() ?? Date.now().toString();
  const params = new URLSearchParams({
    start: "1",
    new: requestId,
  });
  if (step && step !== "brief") params.set("step", step);
  if (panel) params.set("panel", panel);
  return `/studio?${params.toString()}`;
}
