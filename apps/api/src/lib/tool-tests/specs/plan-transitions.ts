import type { ToolBattery } from "../types";

export const planTransitionsBattery: ToolBattery = {
  tool: "plan_transitions",
  cases: [
    {
      // Robust, no-seed case: with no story spine yet there are no boundaries,
      // so the tool is a no-op success. Exercises routing + the empty path
      // without depending on plan/spine beat-id alignment or seeded clips.
      name: "no-ops to success when there is no story spine yet",
      instruction: "Decide the transitions between this video's clips.",
      expect: { tool: "plan_transitions", callStatus: "succeeded" },
      verify: ({ result }) => {
        const failures: string[] = [];
        if (result?.status !== "succeeded") {
          failures.push(`expected a succeeded result, got ${result?.status}`);
          return failures;
        }
        const output = result.output as { transitionAssetIds?: unknown; boundaryCount?: unknown };
        if (!Array.isArray(output?.transitionAssetIds) || output.transitionAssetIds.length !== 0) {
          failures.push("expected no transitions to be created without a spine");
        }
        if (output?.boundaryCount !== 0) {
          failures.push(`expected boundaryCount 0, got ${String(output?.boundaryCount)}`);
        }
        return failures;
      },
    },
    {
      // Full integration (scene-crossing boundary → crossfade, within-scene →
      // hard cut, clip provenance edges) is deferred until a spine + beat_clip
      // seed helper lands and plan/spine beat ids are reconciled. See
      // docs/scopes/transitions-as-assets.md.
      name: "persists effect transitions across scene boundaries",
      instruction: "Decide the transitions between this video's clips.",
      status: "pending",
      expect: { tool: "plan_transitions", callStatus: "succeeded" },
    },
  ],
};
