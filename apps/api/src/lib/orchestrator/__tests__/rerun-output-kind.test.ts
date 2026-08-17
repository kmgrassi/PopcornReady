import assert from "node:assert/strict";
import test from "node:test";
import {
  domainOutputAssetKind,
  type DomainOutputKind,
} from "@popcorn/shared/domain-agent-contract";

test("semantic rerun outputs normalize to their stored graph asset kinds", () => {
  const cases = {
    image: "image",
    poster: "poster",
    anchor: "anchor",
    storyboard: "keyframe",
    keyframe: "keyframe",
    clip: "clip",
    audio_track: "audio_track",
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
