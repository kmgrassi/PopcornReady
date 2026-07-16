import { getLlmClient } from "../llm";
import { getAsset } from "../api/v1/store";
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
  resolveAssetKind?: AssetKindResolver;
}

export type OrchestratorModel = (
  input: ModelTurnInput
) => Promise<OrchestratorModelDecision>;

interface PriorToolResult {
  tool?: unknown;
  status?: unknown;
  outputAssetIds?: unknown;
  request?: unknown;
  error?: {
    kind?: unknown;
    message?: unknown;
    unmetRequirements?: unknown;
    suggestedNextTools?: unknown;
  };
}

interface BoardFeedbackRequest {
  message: string;
  generationModel?: {
    provider: string;
    model: string;
  };
  target: { scope?: string; assetId?: string };
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

type AssetKindResolver = (
  workspaceId: string,
  projectId: string,
  assetId: string
) => Promise<"image" | "video" | "audio" | undefined>;

// Exported so the fixture-only Gate-0 hierarchy simulation
// (lib/orchestrator/evals/hierarchy-fixture.ts) evaluates the proposed
// creative-director surface against the exact production decision prompt.
export const ORCHESTRATOR_SYSTEM_PROMPT =
  "You are the Popcorn Ready video-generation orchestrator. Decide the next single server-owned tool to call. The server owns validation, persistence, jobs, authorization, provider execution, and stage state. Call at most one tool. " +
  "Each prior result reports its tool and status; a failed result also carries an `error` describing why it failed. When the most recent action failed, do not repeat the same tool with the same inputs — instead follow `error.suggestedNextTools` and satisfy every `error.unmetRequirements[].satisfyWith.tool` before retrying the failed step. " +
  "Important asset roles: `generate_storyboard` creates cheap sketch `beat_storyboard` tiles for planning/review; `generate_keyframe` creates photoreal `beat_keyframe` first-frame assets required by `generate_clip`; `generate_clip` creates new motion `beat_clip` video assets for planned beats; `edit_video_asset` changes the content of an existing uploaded footage asset or generated clip and links the new asset back to the source. A missing `beat_keyframe` is fixed with `generate_keyframe`, not `generate_storyboard`, unless the keyframe tool itself says storyboard tiles are missing. " +
  "For Request Changes / board_feedback on a target asset: an image tile, keyframe, or visual anchor must use `regenerate_image_asset` with the target asset id and the user's replacement prompt. If the feedback asks to add, remove, replace, restyle, or otherwise modify content inside existing footage or a clip, call `edit_video_asset` with that target asset id as `sourceAssetId`. If the user asks for a different/new clip for a planned beat rather than changing the current source video, call `generate_clip`. " +
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

function boardFeedbackRequest(value: unknown): BoardFeedbackRequest | null {
  if (!isRecord(value)) return null;
  const message = value.message;
  const target = value.target;
  if (typeof message !== "string" || !message.trim() || !isRecord(target)) return null;
  return {
    message: message.trim(),
    ...(isRecord(value.generationModel) &&
    typeof value.generationModel.provider === "string" &&
    value.generationModel.provider.trim() &&
    typeof value.generationModel.model === "string" &&
    value.generationModel.model.trim()
      ? {
          generationModel: {
            provider: value.generationModel.provider.trim(),
            model: value.generationModel.model.trim(),
          },
        }
      : {}),
    target: {
      ...(typeof target.scope === "string" ? { scope: target.scope } : {}),
      ...(typeof target.assetId === "string" ? { assetId: target.assetId } : {}),
    },
  };
}

/**
 * Tile feedback is an image replacement request, not an open-ended planning
 * decision. Route it before consulting the LLM so a valid user request cannot
 * be incorrectly completed with no generation action.
 */
export function deterministicBoardFeedbackRoute(
  workspaceId: string | undefined,
  projectId: string,
  priorResults: unknown[] = [],
  resolveAssetKind: AssetKindResolver = async (resolvedWorkspaceId, resolvedProjectId, assetId) => {
    const asset = await getAsset(resolvedWorkspaceId, resolvedProjectId, assetId);
    return asset.kind;
  }
): Promise<{ toolName: "regenerate_image_asset"; input: Record<string, unknown> } | undefined> {
  const latest = priorResult(priorResults.at(-1));
  if (latest?.tool !== "board_feedback" || latest.status !== "applied" || !workspaceId) {
    return Promise.resolve(undefined);
  }
  const request = boardFeedbackRequest(latest.request);
  if (request?.target.scope !== "tile" || !request.target.assetId) {
    return Promise.resolve(undefined);
  }
  return resolveAssetKind(workspaceId, projectId, request.target.assetId)
    .then((assetKind) => {
      if (assetKind !== "image") return undefined;
      return {
        toolName: "regenerate_image_asset" as const,
        input: {
          assetId: request.target.assetId,
          prompt: request.message,
          ...(request.generationModel ? request.generationModel : {}),
        },
      };
    })
    .catch(() => undefined);
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
  const latestResult = parsed.at(-1);
  const latestFailed = latestResult?.status === "failed" ? latestResult : undefined;
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
      uploaded_video:
        "User-supplied footage. Request Changes that modify its visible content should use edit_video_asset, not generate_clip.",
      edited_from:
        "Graph input role linking an edited video asset back to the source video it changed.",
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
  resolveAssetKind,
}) => {
  const deterministicRoute = await deterministicBoardFeedbackRoute(
    workspaceId,
    projectId,
    priorResults,
    resolveAssetKind
  );
  if (deterministicRoute) {
    return { type: "tool_call", ...deterministicRoute, model: "deterministic-board-feedback-router" };
  }

  const tools = [...registry.values()].map((tool: ToolDefinition) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));

  const client = await llmClientForWorkspace(workspaceId);
  const decision = await client.chooseTool({
    system: ORCHESTRATOR_SYSTEM_PROMPT,
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
