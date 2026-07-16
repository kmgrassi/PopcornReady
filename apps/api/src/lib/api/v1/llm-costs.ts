import {
  withLlmUsageObserver,
  type LlmUsage,
} from "@popcorn/llm";

import { createLogger } from "@/lib/v1/logger";
import { recordModelCallCost } from "./model-call-costs";

const logger = createLogger();
const TOKENS_PER_MILLION = 1_000_000;

export interface LlmCostScope {
  projectId: string;
  runId?: string;
  /** Omit for orchestrator reasoning that precedes a tool invocation. */
  actionId?: string;
}

interface TokenRate {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion?: number;
  cacheCreationUsdPerMillion?: number;
}

// Standard, global API tier rates, checked 2026-07-16. These are estimates:
// provider invoices remain the reconciliation source and can change over time.
// Cache creation assumes Anthropic's default 5-minute cache lifetime.
const TOKEN_RATES: Record<string, TokenRate> = {
  "openai:gpt-5": {
    inputUsdPerMillion: 1.25,
    cacheReadUsdPerMillion: 0.125,
    outputUsdPerMillion: 10,
  },
  "openai:gpt-5-mini": {
    inputUsdPerMillion: 0.25,
    cacheReadUsdPerMillion: 0.025,
    outputUsdPerMillion: 2,
  },
  "anthropic:claude-opus-4-7": {
    inputUsdPerMillion: 5,
    cacheReadUsdPerMillion: 0.5,
    cacheCreationUsdPerMillion: 6.25,
    outputUsdPerMillion: 25,
  },
  "anthropic:claude-haiku-4-5": {
    inputUsdPerMillion: 1,
    cacheReadUsdPerMillion: 0.1,
    cacheCreationUsdPerMillion: 1.25,
    outputUsdPerMillion: 5,
  },
};

function nonNegativeInteger(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value ?? 0) : 0;
}

function rateFor(usage: LlmUsage): TokenRate | undefined {
  const model = usage.model.trim().toLowerCase();
  // Chat Completions can return a dated canonical snapshot even when the
  // request named the stable GPT-5 alias. These snapshots share this rate.
  const openAiStableModel = model.match(/^(gpt-5(?:-mini)?)(?:-\d{4}-\d{2}-\d{2})?$/)?.[1];
  return TOKEN_RATES[
    `${usage.provider}:${usage.provider === "openai" && openAiStableModel ? openAiStableModel : model}`
  ];
}

function roundedUsd(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

/**
 * The existing ledger stores raw provider input/output fields. Cache buckets are
 * included in the estimate, but are not persisted separately until a future
 * schema version adds typed usage data. OpenAI cache reads are already included
 * in its raw input total; Anthropic reports cache buckets separately.
 */
export function buildLlmCostRecord(usage: LlmUsage): {
  provider: "openai" | "anthropic";
  model: string;
  unit: "tokens";
  quantity: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  isEstimate: true;
  hasKnownRate: boolean;
} {
  const inputTokens = nonNegativeInteger(usage.inputTokens);
  const outputTokens = nonNegativeInteger(usage.outputTokens);
  const cacheReadInputTokens = nonNegativeInteger(usage.cacheReadInputTokens);
  const cacheCreationInputTokens = nonNegativeInteger(usage.cacheCreationInputTokens);
  const rate = rateFor(usage);
  // OpenAI reports cached prompt tokens as a subset of prompt_tokens; Anthropic
  // reports cache buckets separately from input_tokens.
  const nonCachedInputTokens =
    usage.provider === "openai" ? Math.max(0, inputTokens - cacheReadInputTokens) : inputTokens;
  const totalTokens =
    usage.provider === "openai"
      ? inputTokens + outputTokens + cacheCreationInputTokens
      : inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens;
  const costUsd = rate
    ? roundedUsd(
        (nonCachedInputTokens * rate.inputUsdPerMillion +
          outputTokens * rate.outputUsdPerMillion +
          cacheReadInputTokens * (rate.cacheReadUsdPerMillion ?? rate.inputUsdPerMillion) +
          cacheCreationInputTokens *
            (rate.cacheCreationUsdPerMillion ?? rate.inputUsdPerMillion)) /
          TOKENS_PER_MILLION
      )
    : 0;
  return {
    provider: usage.provider,
    model: usage.model,
    unit: "tokens",
    quantity: totalTokens,
    inputTokens,
    outputTokens,
    costUsd,
    isEstimate: true,
    hasKnownRate: Boolean(rate),
  };
}

async function recordLlmCost(scope: LlmCostScope, usage: LlmUsage): Promise<void> {
  const { hasKnownRate, ...record } = buildLlmCostRecord(usage);
  if (!hasKnownRate) {
    logger.warn("llm_cost.unknown_model_rate", {
      projectId: scope.projectId,
      runId: scope.runId,
      actionId: scope.actionId,
      provider: record.provider,
      model: record.model,
    });
  }
  await recordModelCallCost({
    projectId: scope.projectId,
    ...(scope.runId ? { runId: scope.runId } : {}),
    ...(scope.actionId ? { actionId: scope.actionId } : {}),
    ...record,
  });
}

export function withLlmCostRecording<T>(
  scope: LlmCostScope,
  operation: () => Promise<T>,
  recordUsage: (scope: LlmCostScope, usage: LlmUsage) => Promise<void> = recordLlmCost
): Promise<T> {
  return withLlmUsageObserver(async (usage) => {
    try {
      await recordUsage(scope, usage);
    } catch (error) {
      logger.warn("llm_cost.record_failed", {
        projectId: scope.projectId,
        runId: scope.runId,
        actionId: scope.actionId,
        provider: usage.provider,
        model: usage.model,
        error: error instanceof Error ? error : { message: String(error) },
      });
    }
  }, operation);
}
