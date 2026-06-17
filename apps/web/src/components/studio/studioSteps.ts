export type StudioStep =
  | "brief"
  | "footage"
  | "plan"
  | "story"
  | "generate"
  | "review"
  | "export";

/** Ordered flow steps; the setup stepper only renders `STUDIO_SETUP_STEPS`. */
export const STUDIO_STEPS: StudioStep[] = [
  "brief",
  "footage",
  "plan",
  "story",
  "generate",
  "review",
  "export",
];

export const STUDIO_SETUP_STEPS: StudioStep[] = ["brief", "footage"];

export function normalizeStudioStep(
  value: StudioStep | string | null | undefined,
  options: { hasRun?: boolean } = {},
): StudioStep {
  if (value === "brief" || value === "footage" || value === "plan") return value;
  if ((value === "generate" || value === "review" || value === "export") && options.hasRun) {
    return value;
  }
  if (value === "story" || value === "generate" || value === "review" || value === "export") {
    return "plan";
  }
  return "brief";
}
