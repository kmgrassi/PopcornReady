import { getLlmClient } from "../llm";
import { getWorkspaceModelSetting } from "../api/v1/model-settings";
import { ToolRegistry } from "./registry";
import {
  OrchestratorModelDecision,
  ToolDefinition,
  ToolName,
  TOOL_NAMES,
} from "./types";

const TOOL_NAME_SET = new Set<string>(TOOL_NAMES);

export interface ModelTurnInput {
  workspaceId?: string;
  projectId: string;
  inputSummary: string;
  priorResults?: unknown[];
  registry: ToolRegistry;
  maxTokens?: number;
}

export type OrchestratorModel = (
  input: ModelTurnInput
) => Promise<OrchestratorModelDecision>;

interface PriorToolResult {
  tool?: unknown;
  status?: unknown;
  outputAssetIds?: unknown;
  error?: {
    kind?: unknown;
    message?: unknown;
    unmetRequirements?: unknown;
    suggestedNextTools?: unknown;
  };
}

interface RoutingContext {
  completedTools: ToolName[];
  latestFailure?: {
    tool: ToolName;
    kind?: string;
    message?: string;
    unmetRequirements: string[];
    requiredRecoveryTools: ToolName[];
  };
  nextToolHint?: {
    tool: ToolName;
    reason: string;
  };
  assetRoleGuide: Record<string, string>;
}

const SYSTEM_PROMPT =
  "You are the Popcorn Ready video-generation orchestrator. Decide the next single server-owned tool to call. The server owns validation, persistence, jobs, authorization, provider execution, and stage state. Call at most one tool. " +
  "Each prior result reports its tool and status; a failed result also carries an `error` describing why it failed. When the most recent action failed, do not repeat the same tool with the same inputs — instead follow `error.suggestedNextTools` and satisfy every `error.unmetRequirements[].satisfyWith.tool` before retrying the failed step. " +
  "Important asset roles: `generate_storyboard` creates cheap sketch `beat_storyboard` tiles for planning/review; `generate_keyframe` creates photoreal `beat_keyframe` first-frame assets required by `generate_clip`; `generate_clip` creates motion `beat_clip` video assets. A missing `beat_keyframe` is fixed with `generate_keyframe`, not `generate_storyboard`, unless the keyframe tool itself says storyboard tiles are missing. " +
  "Run autonomously by default: advance the pipeline toward a finished video without pausing for confirmation. The server enforces any required stops through its own configured approval gates, so do not insert approval steps on your own — only call `request_approval` when the input explicitly asks for human approval of a stage. Never choose `request_approval` merely because a step is expensive or user-visible.";

async function llmClientForWorkspace(workspaceId: string | undefined) {
  if (!workspaceId) return getLlmClient();
  try {
    const setting = await getWorkspaceModelSetting(workspaceId, "text_generation");
    if (!setting) return getLlmClient();
    const env: NodeJS.ProcessEnv = { ...process.env, LLM_PROVIDER: setting.provider };
    if (setting.provider === "anthropic") {
      env.ANTHROPIC_MODEL = setting.model;
      env.ANTHROPIC_FAST_MODEL ||= setting.model;
    } else {
      env.OPENAI_MODEL = setting.model;
      env.OPENAI_FAST_MODEL ||= setting.model;
    }
    return getLlmClient(env);
  } catch {
    return getLlmClient();
  }
}

function requireToolName(value: unknown): ToolName {
  if (typeof value === "string" && TOOL_NAME_SET.has(value)) {
    return value as ToolName;
  }
  throw new Error(`Model requested an unknown tool: ${String(value)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asToolName(value: unknown): ToolName | undefined {
  return typeof value === "string" && TOOL_NAME_SET.has(value) ? (value as ToolName) : undefined;
}

function priorResult(value: unknown): PriorToolResult | null {
  return isRecord(value) ? (value as PriorToolResult) : null;
}

function recoveryToolsFromError(error: PriorToolResult["error"]): ToolName[] {
  if (!error) return [];
  const tools: ToolName[] = [];
  const suggested = Array.isArray(error.suggestedNextTools) ? error.suggestedNextTools : [];
  for (const call of suggested) {
    if (!isRecord(call)) continue;
    const tool = asToolName(call.tool);
    if (tool) tools.push(tool);
  }
  const unmet = Array.isArray(error.unmetRequirements) ? error.unmetRequirements : [];
  for (const miss of unmet) {
    if (!isRecord(miss) || !isRecord(miss.satisfyWith)) continue;
    const tool = asToolName(miss.satisfyWith.tool);
    if (tool) tools.push(tool);
  }
  return [...new Set(tools)];
}

function unmetRequirementNames(error: PriorToolResult["error"]): string[] {
  if (!error || !Array.isArray(error.unmetRequirements)) return [];
  return error.unmetRequirements.flatMap((miss) => {
    if (!isRecord(miss) || typeof miss.requirement !== "string") return [];
    return [miss.requirement];
  });
}

function nextToolHintForFailure(input: {
  tool: ToolName;
  unmetRequirements: string[];
  recoveryTools: ToolName[];
}): RoutingContext["nextToolHint"] {
  if (
    input.tool === "generate_clip" &&
    input.unmetRequirements.includes("beat_keyframe") &&
    input.recoveryTools.includes("generate_keyframe")
  ) {
    return {
      tool: "generate_keyframe",
      reason:
        "generate_clip is missing photoreal beat_keyframe first-frame assets; generate_storyboard only creates sketch beat_storyboard tiles.",
    };
  }
  if (
    input.tool === "generate_keyframe" &&
    input.unmetRequirements.includes("beat_storyboard") &&
    input.recoveryTools.includes("generate_storyboard")
  ) {
    return {
      tool: "generate_storyboard",
      reason:
        "generate_keyframe is missing selected beat_storyboard sketch tiles; create the storyboard before retrying photoreal keyframes.",
    };
  }
  const [tool] = input.recoveryTools;
  return tool
    ? { tool, reason: "The latest failed action explicitly suggested this recovery tool." }
    : undefined;
}

export function buildRoutingContext(priorResults: unknown[] = []): RoutingContext {
  const parsed = priorResults.flatMap((value) => {
    const result = priorResult(value);
    return result ? [result] : [];
  });
  const completedTools = [
    ...new Set(
      parsed.flatMap((result) => {
        const tool = asToolName(result.tool);
        return tool && result.status === "applied" ? [tool] : [];
      })
    ),
  ];
  const latestFailed = [...parsed].reverse().find((result) => result.status === "failed");
  const latestFailureTool = asToolName(latestFailed?.tool);
  const unmetRequirements = unmetRequirementNames(latestFailed?.error);
  const recoveryTools = recoveryToolsFromError(latestFailed?.error);
  const latestFailure =
    latestFailed && latestFailureTool
      ? {
          tool: latestFailureTool,
          ...(typeof latestFailed.error?.kind === "string"
            ? { kind: latestFailed.error.kind }
            : {}),
          ...(typeof latestFailed.error?.message === "string"
            ? { message: latestFailed.error.message }
            : {}),
          unmetRequirements,
          requiredRecoveryTools: recoveryTools,
        }
      : undefined;

  return {
    completedTools,
    ...(latestFailure ? { latestFailure } : {}),
    ...(latestFailureTool
      ? {
          nextToolHint: nextToolHintForFailure({
            tool: latestFailureTool,
            unmetRequirements,
            recoveryTools,
          }),
        }
      : {}),
    assetRoleGuide: {
      beat_storyboard:
        "Sketch/previsualization tile from generate_storyboard. It is a planning/reference asset, not enough for clip generation.",
      beat_keyframe:
        "Photoreal first-frame image from generate_keyframe. generate_clip requires this active selection per beat.",
      beat_clip:
        "Motion video clip from generate_clip, seeded from an active beat_keyframe.",
    },
  };
}

// One orchestrator turn: the configured LLM (OpenAI by default, Anthropic when
// LLM_PROVIDER=anthropic) picks the next single tool, or finishes with a
// summary. Tool definitions are passed provider-neutral; each adapter maps them
// to that provider's function-/tool-calling shape.
export const orchestratorModel: OrchestratorModel = async ({
  projectId,
  workspaceId,
  inputSummary,
  priorResults = [],
  registry,
  // Headroom so reasoning models (e.g. gpt-5) have budget left for the tool call
  // after thinking; non-reasoning models only use what they need.
  maxTokens = 4000,
}) => {
  const tools = [...registry.values()].map((tool: ToolDefinition) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));

  const client = await llmClientForWorkspace(workspaceId);
  const decision = await client.chooseTool({
    system: SYSTEM_PROMPT,
    userPayload: {
      projectId,
      inputSummary,
      priorResults,
      routingContext: buildRoutingContext(priorResults),
      instruction:
        "Choose exactly one next tool if work remains. If all work is complete, answer with a concise text summary and no tool call. " +
        "Inspect routingContext and priorResults first: if routingContext.nextToolHint is present, use that tool unless it is unavailable. " +
        "If the latest action failed, resolve its error (follow suggestedNextTools / unmetRequirements) rather than calling the failed tool again unchanged.",
    },
    tools,
    maxTokens,
    effort: "medium", // pick the next single tool — modest reasoning
  });

  if (decision.type === "tool_call") {
    return {
      type: "tool_call",
      toolName: requireToolName(decision.toolName),
      input: decision.input,
      model: decision.model,
    };
  }

  return {
    type: "done",
    summary: decision.text || "No tool call requested.",
    model: decision.model,
  };
};
