import test from "node:test";
import assert from "node:assert/strict";
import { AgentApiStore } from "@/lib/agent-api/jobs";
import type { ProjectTranscript, V1Asset } from "../store";
import { transcribeAsset } from "../transcription";
import { withLocalDir } from "../media-paths";

function readyAudioAsset(overrides: Partial<V1Asset> = {}): V1Asset {
  const now = new Date(0).toISOString();
  return {
    id: "asset-audio",
    schemaVersion: "asset.v1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    kind: "audio",
    filename: "fixture.wav",
    status: "ready",
    source: { type: "multipart_upload" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("transcribeAsset persists mock transcript with transcribed_from provenance", async () => {
  await withLocalDir("/tmp/popcorn-transcription-test", async () => {
    const jobs = new AgentApiStore("/tmp/popcorn-transcription-test/jobs");
    let persisted: ProjectTranscript | null = null;

    const job = await transcribeAsset(
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        assetId: "asset-audio",
        provider: "mock",
      },
      {
        jobs,
        getAsset: async () => readyAudioAsset({ contentHash: "hash-source" }),
        readAssetBytes: async () => undefined,
        addProjectTranscript: async (input) => {
          assert.equal(input.sourceAssetId, "asset-audio");
          assert.equal(input.transcript.text, "testing one two three");
          persisted = {
            asset: {
              id: "transcript-1",
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              lineageId: "lineage-1",
              version: 1,
              role: "transcript",
              contentHash: "hash-transcript",
              inputsFingerprint: "inputs",
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
              content: input.transcript,
            },
            segments: input.transcript.segments,
          };
          return persisted;
        },
      }
    );

    assert.equal(job.status, "succeeded");
    assert.deepEqual(job.result, {
      transcriptAssetId: "transcript-1",
      segmentCount: 1,
    });
    assert.ok(persisted);
    const persistedTranscript = persisted as ProjectTranscript;
    assert.equal(persistedTranscript.segments[0]?.words[3]?.w, "three");
  });
});

test("transcribeAsset rejects image assets with typed failure", async () => {
  await withLocalDir("/tmp/popcorn-transcription-test-invalid", async () => {
    const jobs = new AgentApiStore("/tmp/popcorn-transcription-test-invalid/jobs");
    const job = await transcribeAsset(
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        assetId: "asset-image",
        provider: "mock",
      },
      {
        jobs,
        getAsset: async () => readyAudioAsset({ id: "asset-image", kind: "image" }),
        readAssetBytes: async () => undefined,
        addProjectTranscript: async () => {
          throw new Error("should not persist");
        },
      }
    );

    assert.equal(job.status, "failed");
    assert.equal(job.error?.code, "asset_not_transcribable");
  });
});
