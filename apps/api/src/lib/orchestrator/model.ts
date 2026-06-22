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

const SYSTEM_PROMPT =
  "You are the Popcorn Ready video-generation orchestrator. Decide the next single server-owned tool to call. The server owns validation, persistence, jobs, authorization, provider execution, and stage state. Call at most one tool. " +
  "Each prior result reports its tool and status; a failed result also carries an `error` describing why it failed. When the most recent action failed, do not repeat the same tool with the same inputs — instead follow `error.suggestedNextTools` and satisfy every `error.unmetRequirements[].satisfyWith.tool` before retrying the failed step. " +
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
      instruction:
        "Choose exactly one next tool if work remains. If all work is complete, answer with a concise text summary and no tool call. " +
        "Inspect priorResults first: if the latest action failed, resolve its error (follow suggestedNextTools / unmetRequirements) rather than calling the failed tool again unchanged.",
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
