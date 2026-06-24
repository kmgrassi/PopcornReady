import assert from "node:assert/strict";
import test from "node:test";
import type { AuthContext } from "../auth";
import { generatePoster, type GeneratePosterDeps } from "../poster-generation";
import type { V1Asset, V1Project } from "../store";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "workspace_1",
  isLocal: true,
};

const project: V1Project = {
  id: "project_1",
  schemaVersion: "project.v1",
  workspaceId: "workspace_1",
  name: "Poster project",
  status: "active",
  brief: {
    goal: "Explain correlation versus causation.",
    targetLengthSec: 60,
    aspectRatio: "9:16",
  },
  currentBriefVersionId: "brief_1",
  posterAssetId: null,
  posterUrl: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function deps(overrides: Partial<GeneratePosterDeps> = {}): GeneratePosterDeps {
  return {
    getPosterGenerationContext: async () => ({
      project,
      briefAsset: {
        id: "brief_1",
        contentHash: "brief_hash",
        content: project.brief,
      },
      planAsset: null,
      heroAnchorAsset: null,
      currentPosterManuallyPinned: false,
    }),
    findReusableGeneratedPoster: async () => null,
    createGeneratedAsset: async ({ body }) => ({
      status: 202,
      body: {
        job: {
          id: "job_1",
          schemaVersion: "job.v1",
          workspaceId: "workspace_1",
          projectId: "project_1",
          type: "asset_generation",
          status: "succeeded",
          progress: { currentStep: "done", percent: 100 },
          input: { body },
          result: { assetIds: ["poster_1"] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    }),
    getAsset: async () =>
      ({
        id: "poster_1",
        schemaVersion: "asset.v1",
        workspaceId: "workspace_1",
        projectId: "project_1",
        kind: "image",
        role: "poster",
        filename: "poster.png",
        status: "ready",
        source: { type: "generated", generatedAssetId: "poster_1" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }) as V1Asset,
    selectGeneratedProjectPoster: async ({ assetId }) => ({
      ...project,
      posterAssetId: assetId,
      posterUrl: `/generated/${assetId}.png`,
    }),
    ...overrides,
  };
}

test("generatePoster creates a poster asset and auto-selects it", async () => {
  let sentBody: Record<string, unknown> | null = null;
  const result = await generatePoster(auth, "project_1", { provider: "mock" }, deps({
    createGeneratedAsset: async ({ body }) => {
      sentBody = body as Record<string, unknown>;
      return deps().createGeneratedAsset({ auth, projectId: "project_1", body });
    },
  }));

  assert.equal(result.poster.assetId, "poster_1");
  assert.equal(result.poster.generated, true);
  assert.equal(result.poster.selected, true);
  assert.equal(result.project.posterAssetId, "poster_1");
  assert.ok(sentBody);
  const body = sentBody as Record<string, unknown>;
  assert.equal(body.assetRole, "poster");
  assert.equal(body.provider, "mock");
  assert.equal(body.size, "1024x1536");
  assert.deepEqual(
    (body.graphInputs as Array<{ assetId: string; role: string }>).map((input) => [
      input.assetId,
      input.role,
    ]),
    [["brief_1", "brief"]]
  );
});

test("generatePoster defaults to Ideogram when no provider is requested", async () => {
  let sentBody: Record<string, unknown> | null = null;
  await generatePoster(auth, "project_1", {}, deps({
    createGeneratedAsset: async ({ body }) => {
      sentBody = body as Record<string, unknown>;
      return deps().createGeneratedAsset({ auth, projectId: "project_1", body });
    },
  }));

  assert.ok(sentBody);
  assert.equal((sentBody as Record<string, unknown>).provider, "ideogram");
});

test("generatePoster routes minor poster content through Gemini", async () => {
  let sentBody: Record<string, unknown> | null = null;
  await generatePoster(auth, "project_1", { provider: "openai" }, deps({
    getPosterGenerationContext: async () => ({
      project,
      briefAsset: {
        id: "brief_1",
        contentHash: "brief_hash",
        content: {
          ...project.brief,
          goal: "A child learns how correlation can mislead people.",
        },
      },
      planAsset: null,
      heroAnchorAsset: null,
      currentPosterManuallyPinned: false,
    }),
    createGeneratedAsset: async ({ body }) => {
      sentBody = body as Record<string, unknown>;
      return deps().createGeneratedAsset({ auth, projectId: "project_1", body });
    },
  }));

  assert.ok(sentBody);
  const body = sentBody as Record<string, unknown>;
  assert.equal(body.provider, "gemini");
});

test("generatePoster forwards run id into generated asset requests", async () => {
  let sentBody: Record<string, unknown> | null = null;
  await generatePoster(auth, "project_1", { provider: "mock", runId: "run_1" }, deps({
    createGeneratedAsset: async ({ body }) => {
      sentBody = body as Record<string, unknown>;
      return deps().createGeneratedAsset({ auth, projectId: "project_1", body });
    },
  }));

  assert.ok(sentBody);
  const body = sentBody as Record<string, unknown>;
  assert.equal(body.runId, "run_1");
});

test("generatePoster reuses a matching poster without generating", async () => {
  let generated = false;
  const result = await generatePoster(
    auth,
    "project_1",
    {},
    deps({
      findReusableGeneratedPoster: async () => ({
        id: "poster_existing",
        contentHash: "hash",
      }),
      createGeneratedAsset: async () => {
        generated = true;
        return deps().createGeneratedAsset({
          auth,
          projectId: "project_1",
          body: {},
        });
      },
    })
  );

  assert.equal(generated, false);
  assert.equal(result.poster.reused, true);
  assert.equal(result.poster.generated, false);
  assert.equal(result.project.posterAssetId, "poster_existing");
});

test("generatePoster does not overwrite a manually pinned poster", async () => {
  let selected = false;
  const result = await generatePoster(
    auth,
    "project_1",
    { provider: "mock" },
    deps({
      getPosterGenerationContext: async () => ({
        project: { ...project, posterAssetId: "manual_1" },
        briefAsset: {
          id: "brief_1",
          contentHash: "brief_hash",
          content: project.brief,
        },
        planAsset: null,
        heroAnchorAsset: null,
        currentPosterManuallyPinned: true,
      }),
      selectGeneratedProjectPoster: async () => {
        selected = true;
        return project;
      },
    })
  );

  assert.equal(selected, false);
  assert.equal(result.poster.generated, true);
  assert.equal(result.poster.selected, false);
  assert.equal(result.poster.manuallyPinned, true);
  assert.equal(result.project.posterAssetId, "manual_1");
});
