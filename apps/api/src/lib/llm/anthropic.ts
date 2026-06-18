import { client as anthropicClient, MODEL } from "../anthropic";
import {
  ChooseToolArgs,
  LlmClient,
  LlmEffort,
  StructuredArgs,
  StructuredVisionArgs,
  ToolChoiceResult,
  ToolSpec,
} from "./types";

type AnthropicMessageResponse = {
  model?: string;
  content?: unknown;
};

type AnthropicToolUseBlock = {
  type: "tool_use";
  name?: string;
  input?: unknown;
};

type AnthropicTextBlock = {
  type: "text";
  text?: unknown;
};

type AnthropicContentBlock =
  | AnthropicToolUseBlock
  | AnthropicTextBlock
  | { type?: string; [key: string]: unknown };

type MessageCreate = (
  params: Record<string, unknown>
) => Promise<AnthropicMessageResponse>;

// Low-reasoning calls route to the cheaper fast model.
const FAST_EFFORTS = new Set<LlmEffort>(["minimal", "low"]);

export interface AnthropicDeps {
  model?: string;
  // Cheaper model for minimal/low-effort calls. Defaults to `model`.
  fastModel?: string;
  // Injected in tests; defaults to the real Anthropic client lazily.
  createMessage?: MessageCreate;
}

export function toAnthropicTool(spec: ToolSpec): Record<string, unknown> {
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.parameters,
  };
}

const STRUCTURED_RESULT_TOOL = "return_result";

// A forced tool call occasionally comes back with no (or malformed) tool call.
// Retry this provider hiccup once before surfacing it.
const STRUCTURED_RETRY_ATTEMPTS = 2;
export function isMissingStructuredResultError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("did not call required tool") ||
    message.includes("invalid tool arguments") ||
    message.includes("invalid tool input")
  );
}

function asContentBlocks(value: unknown): AnthropicContentBlock[] {
  return Array.isArray(value) ? (value as AnthropicContentBlock[]) : [];
}

function isToolUseBlock(block: AnthropicContentBlock): block is AnthropicToolUseBlock {
  return block.type === "tool_use";
}

function isTextBlock(block: AnthropicContentBlock): block is AnthropicTextBlock {
  return block.type === "text";
}

function isStructuredResultToolUse(
  block: AnthropicContentBlock
): block is AnthropicToolUseBlock {
  return isToolUseBlock(block) && block.name === STRUCTURED_RESULT_TOOL;
}

function resultFromAnthropicToolUse<T>(res: AnthropicMessageResponse): T {
  const content = asContentBlocks(res.content);
  const toolUse = content.find(isStructuredResultToolUse);
  if (!toolUse) {
    throw new Error(`Model did not call required tool: ${STRUCTURED_RESULT_TOOL}`);
  }
  const input = toolUse.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Model returned invalid tool input for ${STRUCTURED_RESULT_TOOL}.`);
  }
  return input as T;
}

// Pure response parsing - unit-tested without a network call.
export function interpretAnthropicToolResponse(
  res: AnthropicMessageResponse,
  fallbackModel: string,
  allowed?: Set<string>
): ToolChoiceResult {
  const content = asContentBlocks(res.content);
  const toolUses = content.filter(isToolUseBlock);
  const model = res.model ?? fallbackModel;

  if (toolUses.length > 1) {
    throw new Error("Orchestrator model returned more than one tool call.");
  }
  if (toolUses.length === 1) {
    const toolUse = toolUses[0];
    const name = String(toolUse.name ?? "");
    if (allowed && !allowed.has(name)) {
      throw new Error(`Model requested an unknown tool: ${name}`);
    }
    const input =
      toolUse.input && typeof toolUse.input === "object" && !Array.isArray(toolUse.input)
        ? (toolUse.input as Record<string, unknown>)
        : {};
    return { type: "tool_call", toolName: name, input, model };
  }

  const text = content
    .filter(isTextBlock)
    .map((block) => String(block.text || ""))
    .join("")
    .trim();
  return { type: "done", text: text || "No tool call requested.", model };
}

export function createAnthropicLlmClient(deps: AnthropicDeps = {}): LlmClient {
  const model = deps.model ?? MODEL;
  const fastModel = deps.fastModel ?? model;
  const pickModel = (effort?: LlmEffort): string =>
    effort && FAST_EFFORTS.has(effort) ? fastModel : model;
  let createMessage = deps.createMessage;
  const ensureCreate = (): MessageCreate => {
    if (createMessage) return createMessage;
    createMessage = ((params: Record<string, unknown>) =>
      anthropicClient().messages.create(params as never)) as MessageCreate;
    return createMessage;
  };

  const structuredImpl = async <T>(
    args: StructuredArgs,
    userContent: unknown
  ): Promise<T> => {
    const callModel = pickModel(args.effort);
    const requestParams = {
      model: callModel,
      max_tokens: args.maxTokens ?? 8000,
      system: [
        {
          type: "text",
          text: args.cachedSystem,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: STRUCTURED_RESULT_TOOL,
          description: "Return the structured result for this task.",
          input_schema: args.schema,
        },
      ],
      tool_choice: { type: "tool", name: STRUCTURED_RESULT_TOOL },
      messages: [{ role: "user", content: userContent }],
    };
    let lastErr: unknown;
    for (let attempt = 0; attempt < STRUCTURED_RETRY_ATTEMPTS; attempt += 1) {
      const res = await ensureCreate()(requestParams);
      try {
        return resultFromAnthropicToolUse<T>(res);
      } catch (err) {
        if (!isMissingStructuredResultError(err)) throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  };

  return {
    provider: "anthropic",
    model,
    structured<T>(args: StructuredArgs) {
      return structuredImpl<T>(args, args.user);
    },
    async structuredVision<T>(args: StructuredVisionArgs) {
      const { promises: fs } = await import("fs");
      const imageBlocks = await Promise.all(
        args.images.map(async (image) => {
          const bytes = await fs.readFile(image.path);
          return {
            type: "image",
            source: {
              type: "base64",
              media_type: image.mediaType,
              data: bytes.toString("base64"),
            },
          };
        })
      );
      return structuredImpl<T>(args, [
        { type: "text", text: args.user },
        ...imageBlocks,
      ]);
    },
    async chooseTool(args: ChooseToolArgs) {
      const allowed = new Set(args.tools.map((tool) => tool.name));
      const callModel = pickModel(args.effort);
      const res = await ensureCreate()({
        model: callModel,
        max_tokens: args.maxTokens ?? 2000,
        system: args.system,
        tools: args.tools.map(toAnthropicTool),
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: JSON.stringify(args.userPayload) }],
      });
      return interpretAnthropicToolResponse(res, callModel, allowed);
    },
  };
}
