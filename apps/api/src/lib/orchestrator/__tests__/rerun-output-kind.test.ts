import assert from "node:assert/strict";
import test from "node:test";
import {
  domainOutputAssetKind,
  type DomainOutputKind,
} from "@popcorn/shared/domain-agent-contract";

test("semantic rerun outputs normalize to their stored graph asset kinds", () => {
  const cases = {
    image: "image",
    poster: "image",
    anchor: "image",
    storyboard: "image",
    keyframe: "image",
    clip: "video",
    audio_track: "audio",
    audio_fit: "critique",
    composite: "composite",
    render: "render",
  } satisfies Record<DomainOutputKind, string>;

  for (const [outputKind, assetKind] of Object.entries(cases)) {
    assert.equal(
      domainOutputAssetKind(outputKind as DomainOutputKind),
      assetKind
    );
  }
});
