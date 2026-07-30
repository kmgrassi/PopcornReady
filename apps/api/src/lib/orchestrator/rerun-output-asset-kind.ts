import {
  domainOutputAssetKind,
  type DomainOutputKind,
} from "@popcorn/shared/domain-agent-contract";
import type { BoundRequiredOutput } from "@popcorn/shared/rerun-proposal";

/**
 * Stored graph kinds allowed to satisfy one proposal output binding.
 * Story snapshots are target-sensitive because the relational story spine
 * points whole-story, compatibility-plan, scene, and beat rows at different
 * semantic graph kinds.
 */
export function rerunOutputAssetKinds(
  output: Pick<BoundRequiredOutput, "kind" | "target">
): readonly string[] {
  if (output.kind !== "story_snapshot") {
    const kind = domainOutputAssetKind(output.kind as DomainOutputKind);
    return kind ? [kind] : [];
  }
  switch (output.target.kind) {
    case "project":
      return ["story_blueprint"];
    case "storyboard":
    case "scene":
      return ["plan"];
    case "beat":
      return ["beat"];
    default:
      return [];
  }
}
