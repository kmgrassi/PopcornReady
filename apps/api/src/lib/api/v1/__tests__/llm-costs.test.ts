import assert from "node:assert/strict";
import test from "node:test";

import { reportLlmUsage } from "@popcorn/llm";

import {
  generatedAssetLlmCostScope,
  resolveGeneratedAssetMetadataWithCost,
} from "../generated-assets";
import { buildLlmCostRecord, withLlmCostRecording } from "../llm-costs";

test("buildLlmCostRecord prices OpenAI input, output, and cache reads separately", () => {
  const record = buildLlmCostRecord({
    provider: "openai",
    model: "gpt-5",
    inputTokens: 1_000,
    outputTokens: 100,
    cacheReadInputTokens: 500,
  });

  assert.deepEqual(record, {
    provider: "openai",
    model: "gpt-5",
    unit: "tokens",
    quantity: 1_100,
    inputTokens: 1_000,
    outputTokens: 100,
    costUsd: 0.0016875,
    isEstimate: true,
    hasKnownRate: true,
  });
});

test("buildLlmCostRecord recognizes dated GPT-5 response model IDs", () => {
  const record = buildLlmCostRecord({
    provider: "openai",
    model: "gpt-5-2026-01-01",
    inputTokens: 1_000,
    outputTokens: 100,
  });

  assert.equal(record.costUsd, 0.00225);
  assert.equal(record.hasKnownRate, true);
});

test("buildLlmCostRecord prices Anthropic cache creation at its own rate", () => {
  const record = buildLlmCostRecord({
    provider: "anthropic",
    model: "claude-opus-4-7",
    inputTokens: 1_000,
    outputTokens: 100,
    cacheReadInputTokens: 500,
    cacheCreationInputTokens: 200,
  });

  assert.equal(record.quantity, 1_800);
  assert.equal(record.costUsd, 0.009);
  assert.equal(record.hasKnownRate, true);
});

test("buildLlmCostRecord keeps unknown model usage observable without guessing a rate", () => {
  const record = buildLlmCostRecord({
    provider: "openai",
    model: "future-model",
    inputTokens: 1_000,
    outputTokens: 100,
  });

  assert.equal(record.quantity, 1_100);
  assert.equal(record.costUsd, 0);
  assert.equal(record.hasKnownRate, false);
  assert.equal(record.isEstimate, true);
});

test("withLlmCostRecording keeps concurrent scopes isolated and survives a ledger failure", async () => {
  const recorded: Array<{ projectId: string; runId?: string; actionId?: string; model: string }> = [];
  const recordUsage = async (
    scope: { projectId: string; runId?: string; actionId?: string },
    usage: { model: string }
  ) => {
    await new Promise((resolve) => setTimeout(resolve, usage.model === "first" ? 10 : 0));
    recorded.push({ ...scope, model: usage.model });
  };

  await Promise.all([
    withLlmCostRecording(
      { projectId: "project-a", runId: "run-a" },
      () => reportLlmUsage({ provider: "openai", model: "first", inputTokens: 1, outputTokens: 1 }),
      recordUsage
    ),
    withLlmCostRecording(
      { projectId: "project-b", actionId: "action-b" },
      () => reportLlmUsage({ provider: "anthropic", model: "second", inputTokens: 1, outputTokens: 1 }),
      recordUsage
    ),
  ]);

  assert.deepEqual(recorded, [
    { projectId: "project-b", actionId: "action-b", model: "second" },
    { projectId: "project-a", runId: "run-a", model: "first" },
  ]);

  const result = await withLlmCostRecording(
    { projectId: "project-a" },
    async () => {
      await reportLlmUsage({ provider: "openai", model: "gpt-5", inputTokens: 1, outputTokens: 1 });
      return "provider-result";
    },
    async () => {
      throw new Error("ledger unavailable");
    }
  );
  assert.equal(result, "provider-result");
});

test("generated asset AI naming records under the generation action, but explicit names do not", async () => {
  const scope = generatedAssetLlmCostScope("project-a", "run-a", "action-a");
  const recorded: Array<{ projectId: string; runId?: string; actionId?: string }> = [];
  const recordUsage = async (costScope: typeof scope) => {
    recorded.push(costScope);
  };
  const resolveMetadata: Parameters<typeof resolveGeneratedAssetMetadataWithCost>[0]["resolveMetadata"] = async (input) => {
    if (!input.agent?.name) {
      await reportLlmUsage({
        provider: "openai",
        model: "gpt-5-mini",
        inputTokens: 10,
        outputTokens: 2,
      });
    }
    return { name: input.agent?.name ?? "AI generated name", slug: "ai-generated-name" };
  };

  await resolveGeneratedAssetMetadataWithCost({
    scope,
    input: { kind: "image", provider: "mock", prompt: "sunset" },
    resolveMetadata,
    recordUsage,
  });
  assert.deepEqual(recorded, [scope]);

  await resolveGeneratedAssetMetadataWithCost({
    scope,
    input: { agent: { name: "Explicit title" }, kind: "image", provider: "mock", prompt: "sunset" },
    resolveMetadata,
    recordUsage,
  });
  assert.deepEqual(recorded, [scope]);
});
