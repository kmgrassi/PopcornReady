import assert from "node:assert/strict";
import test from "node:test";

import type { LlmClient } from "@/lib/llm";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAssetCritique,
  DEFAULT_ASSET_CRITIQUE_QUESTION,
  normalizeAssetCritiqueQuestion,
  type AssetCritiqueAnswer,
} from "../asset-critique";
import { ApiError } from "../errors";
import type { V1Asset } from "../store";

const answer: AssetCritiqueAnswer = {
  answer: "The focal point is clear, but the hierarchy can be stronger.",
  strengths: ["Clear subject"],
  improvements: ["Increase separation around the headline"],
  evidence: ["The subject occupies the center third"],
  limitations: [],
};

const requestDb = {} as SupabaseClient;

function llm(overrides: Partial<LlmClient> = {}): LlmClient {
  return {
    provider: "openai",
    model: "gpt-test",
    structured: async () => answer,
    structuredVision: async () => answer,
    chooseTool: async () => ({ type: "done", text: "", model: "gpt-test" }),
    ...overrides,
  } as LlmClient;
}

function imageAsset(): V1Asset {
  return {
    id: "image-1",
    schemaVersion: "asset.v1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    kind: "image",
    filename: "poster.png",
    status: "ready",
    source: { type: "generated", generatedAssetId: "generated-1" },
    storageKey: "projects/project-1/poster.png",
    storageBucket: "private-assets",
    contentHash: "image-hash",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}

function baseDeps(options: {
  client?: LlmClient;
  asset?: V1Asset;
  script?: { assetId: string; contentHash: string; script: never };
}) {
  const persisted: unknown[] = [];
  const updates: unknown[] = [];
  const actions: unknown[] = [];
  const databases: unknown[] = [];
  return {
    persisted,
    updates,
    actions,
    databases,
    deps: {
      getAssetCritiqueSource: async (input: { db: unknown }) => {
        databases.push(input.db);
        return options.script
          ? { kind: "script" as const, ...options.script }
          : { kind: "image" as const, asset: options.asset ?? imageAsset() };
      },
      getProjectAssetCritique: async (input: { db: unknown }): Promise<unknown | null> => {
        databases.push(input.db);
        return null;
      },
      createAction: async (input: unknown, db?: unknown) => {
        actions.push(input);
        databases.push(db);
        return { id: (input as { id: string }).id, status: "running" } as never;
      },
      updateAction: async (...args: unknown[]) => {
        updates.push(args);
        databases.push(args[2]);
        return {} as never;
      },
      addProjectAssetCritique: async (input: { db: unknown }) => {
        persisted.push(input);
        databases.push(input.db);
        return { critiqueAssetId: "critique-1" };
      },
      getLlmClient: () => options.client ?? llm(),
      materializeAssetObject: async () => ({
        path: new URL(import.meta.url).pathname,
        cleanup: async () => undefined,
      }),
    },
  };
}

test("normalizes omitted and blank questions to the product default", () => {
  assert.equal(normalizeAssetCritiqueQuestion(undefined), DEFAULT_ASSET_CRITIQUE_QUESTION);
  assert.equal(normalizeAssetCritiqueQuestion("   "), DEFAULT_ASSET_CRITIQUE_QUESTION);
  assert.equal(normalizeAssetCritiqueQuestion(" What works? "), "What works?");
  assert.throws(
    () => normalizeAssetCritiqueQuestion("x".repeat(2_001)),
    (error: unknown) => error instanceof ApiError && error.code === "validation_failed",
  );
});

test("replays a persisted critique without another model call", async () => {
  const saved = {
    sourceAssetId: "image-1",
    sourceKind: "image" as const,
    question: "What works here?",
    provider: "openai",
    model: "gpt-test",
    ...answer,
  };
  const fixture = baseDeps({
    client: llm({
      structuredVision: async () => {
        throw new Error("model must not run for a persisted replay");
      },
    }),
  });
  fixture.deps.getProjectAssetCritique = async () => saved;

  const result = await createAssetCritique({
    db: requestDb,
    workspaceId: "workspace-1",
    projectId: "project-1",
    assetId: "image-1",
    idempotencyKey: "critique-image-replay",
    question: "What works here?",
    deps: fixture.deps,
  });

  assert.equal(result.answer, saved.answer);
  assert.equal(fixture.persisted.length, 0);
  assert.equal(fixture.updates.length, 1);
  assert.equal(
    (fixture.updates[0] as [string, { status: string }])[1].status,
    "applied",
  );
});

test("reviews an exact stored image and persists a pooled critique with source identity", async () => {
  let visionCalls = 0;
  const fixture = baseDeps({
    client: llm({
      structuredVision: (async (input) => {
        visionCalls += 1;
        assert.equal(input.images.length, 1);
        assert.match(input.user, /What works here\?/);
        return answer;
      }) as LlmClient["structuredVision"],
    }),
  });
  const result = await createAssetCritique({
    db: requestDb,
    workspaceId: "workspace-1",
    projectId: "project-1",
    assetId: "image-1",
    idempotencyKey: "critique-image-1",
    question: "What works here?",
    deps: fixture.deps,
  });

  assert.equal(visionCalls, 1);
  assert.equal(result.sourceKind, "image");
  assert.equal(result.critiqueAssetId, "critique-1");
  assert.equal(fixture.persisted.length, 1);
  assert.deepEqual(
    (fixture.persisted[0] as { sourceAssetId: string; sourceContentHash: string }).sourceAssetId,
    "image-1",
  );
  assert.equal(
    (fixture.persisted[0] as { sourceContentHash: string }).sourceContentHash,
    "image-hash",
  );
  assert.equal(fixture.databases.length, 4);
  assert.ok(fixture.databases.every((db) => db === requestDb));
});

test("canonicalizes a project-scoped asset slug before UUID-backed writes", async () => {
  const canonicalAsset = { ...imageAsset(), id: "11111111-1111-4111-8111-111111111111" };
  const fixture = baseDeps({ asset: canonicalAsset });

  const result = await createAssetCritique({
    db: requestDb,
    workspaceId: "workspace-1",
    projectId: "project-1",
    assetId: "poster-slug",
    idempotencyKey: "critique-image-slug",
    deps: fixture.deps,
  });

  assert.equal(result.sourceAssetId, canonicalAsset.id);
  assert.deepEqual(
    (fixture.actions[0] as { inputAssetIds: string[] }).inputAssetIds,
    [canonicalAsset.id],
  );
  assert.equal(
    (fixture.persisted[0] as { sourceAssetId: string }).sourceAssetId,
    canonicalAsset.id,
  );
});

test("reviews only the exact active script snapshot", async () => {
  const script = {
    assetId: "script-asset-1",
    contentHash: "script-hash",
    script: { narration: "A better opening.", scenes: [] },
  } as never;
  const fixture = baseDeps({ script });

  const result = await createAssetCritique({
    db: requestDb,
    workspaceId: "workspace-1",
    projectId: "project-1",
    assetId: "script-asset-1",
    idempotencyKey: "critique-script-1",
    deps: fixture.deps,
  });

  assert.equal(result.sourceKind, "script");
  assert.equal(result.question, DEFAULT_ASSET_CRITIQUE_QUESTION);
  assert.equal(
    (fixture.persisted[0] as { sourceContentHash: string }).sourceContentHash,
    "script-hash",
  );
});

test("rejects missing stored media and finalizes the action as failed", async () => {
  const fixture = baseDeps({ asset: { ...imageAsset(), storageKey: undefined } });
  await assert.rejects(
    createAssetCritique({
      db: requestDb,
      workspaceId: "workspace-1",
      projectId: "project-1",
      assetId: "image-1",
      idempotencyKey: "critique-missing-image-1",
      deps: fixture.deps,
    }),
    (error: unknown) => error instanceof ApiError && error.code === "asset_invalid",
  );
  assert.equal(fixture.persisted.length, 0);
  assert.equal(fixture.updates.length, 1);
  assert.equal(
    (fixture.updates[0] as [string, { status: string }])[1].status,
    "failed",
  );
});
