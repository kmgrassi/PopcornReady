import Anthropic from "@anthropic-ai/sdk";

import {
  ChooseToolArgs,
  JsonObject,
  JsonSchema,
  LlmClient,
  LlmEffort,
  StructuredArgs,
  StructuredVisionArgs,
  ToolChoiceResult,
  ToolSpec,
} from "./types";
import { reportLlmUsage } from "./usage";

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-4-7";

let _client: Anthropic | null = null;
export function anthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.local.example to .env.local and add your key."
    );
  }
  if (!_client) _client = new Anthropic();
  return _client;
}

interface AnthropicTextBlock {
  type?: "text";
  text?: string | null;
}

interface AnthropicToolUseBlock {
  type?: "tool_use";
  name?: string | null;
  input?: unknown;
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | { type?: string; [key: string]: unknown };

interface AnthropicMessageResponse {
  model?: string | null;
  content?: AnthropicContentBlock[] | null;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  } | null;
}

export interface AnthropicImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

export interface AnthropicSystemTextBlock {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
  };
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export type AnthropicUserContent =
  | string
  | Array<AnthropicSystemTextBlock | AnthropicImageBlock>;

export interface AnthropicMessageCreateRequest {
  model: string;
  max_tokens: number;
  system?: AnthropicSystemTextBlock[] | string;
  tools?: AnthropicToolDefinition[];
  tool_choice?:
    | { type: "tool"; name: string }
    | { type: "auto" };
  messages: Array<{ role: "user"; content: AnthropicUserContent }>;
}

type MessageCreate = (
  params: AnthropicMessageCreateRequest
) => Promise<AnthropicMessageResponse>;

async function reportAnthropicUsage(
  response: AnthropicMessageResponse,
  fallbackModel: string
): Promise<void> {
  const usage = response.usage;
  if (!usage) return;
  await reportLlmUsage({
    provider: "anthropic",
    model: response.model ?? fallbackModel,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  });
}

// Low-reasoning calls route to the cheaper fast model.
const FAST_EFFORTS = new Set<LlmEffort>(["minimal", "low"]);

export interface AnthropicDeps {
  model?: string;
  // Cheaper model for minimal/low-effort calls. Defaults to `model`.
  fastModel?: string;
  // Injected in tests; defaults to the real Anthropic client lazily.
  createMessage?: MessageCreate;
}

export function toAnthropicTool(spec: ToolSpec): AnthropicToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    input_schema: spec.parameters,
  };
}

const STRUCTURED_RESULT_TOOL = "return_result";

function asContentBlocks(value: unknown): AnthropicContentBlock[] {
  return Array.isArray(value) ? (value as AnthropicContentBlock[]) : [];
}

function isToolUseBlock(block: AnthropicContentBlock): block is AnthropicToolUseBlock {
  return block?.type === "tool_use";
}

function isTextBlock(block: AnthropicContentBlock): block is AnthropicTextBlock {
  return block?.type === "text";
}

function isStructuredResultToolUse(
  block: AnthropicContentBlock
): block is AnthropicToolUseBlock {
  return isToolUseBlock(block) && block.name === STRUCTURED_RESULT_TOOL;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resultFromAnthropicToolUse<T extends object>(
  res: AnthropicMessageResponse
): T {
  const content = asContentBlocks(res.content);
  const toolUse = content.find(isStructuredResultToolUse);
  if (!toolUse) {
    throw new Error(`Model did not call required tool: ${STRUCTURED_RESULT_TOOL}`);
  }
  const input = toolUse.input;
  if (!isJsonObject(input)) {
    throw new Error(`Model returned invalid tool input for ${STRUCTURED_RESULT_TOOL}.`);
  }
  return input as T;
}

// Pure response parsing — unit-tested without a network call.
export function interpretAnthropicToolResponse(
  res: AnthropicMessageResponse,
  fallbackModel: string,
  allowed?: Set<string>
): ToolChoiceResult {
  const content = asContentBlocks(res.content);
  const toolUses = content.filter(isToolUseBlock);
  const model = res?.model ?? fallbackModel;

  if (toolUses.length > 1) {
    throw new Error("Orchestrator model returned more than one tool call.");
  }
  if (toolUses.length === 1) {
    const toolUse = toolUses[0];
    const name = String(toolUse?.name ?? "");
    if (allowed && !allowed.has(name)) {
      throw new Error(`Model requested an unknown tool: ${name}`);
    }
    const input = isJsonObject(toolUse?.input) ? toolUse.input : {};
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
  const model = deps.model ?? ANTHROPIC_DEFAULT_MODEL;
  const fastModel = deps.fastModel ?? model;
  const pickModel = (effort?: LlmEffort): string =>
    effort && FAST_EFFORTS.has(effort) ? fastModel : model;
  let createMessage = deps.createMessage;
  const ensureCreate = (): MessageCreate => {
    if (createMessage) return createMessage;
    createMessage = ((params: AnthropicMessageCreateRequest) =>
      anthropicClient().messages.create(params as never)) as MessageCreate;
    return createMessage;
  };
  const structuredImpl = async <T extends object>(
    args: StructuredArgs,
    userContent: AnthropicUserContent
  ): Promise<T> => {
    const callModel = pickModel(args.effort);
    const res = await ensureCreate()({
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
    });
    await reportAnthropicUsage(res, callModel);
    return resultFromAnthropicToolUse<T>(res);
  };

  return {
    provider: "anthropic",
    model,
    modelFor: pickModel,
    structured<T extends object>(args: StructuredArgs) {
      return structuredImpl<T>(args, args.user);
    },
    async structuredVision<T extends object>(args: StructuredVisionArgs) {
      const { promises: fs } = await import("node:fs");
      const imageBlocks: AnthropicImageBlock[] = await Promise.all(
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
        messages: [
          { role: "user", content: JSON.stringify(args.userPayload) },
        ],
      });
      await reportAnthropicUsage(res, callModel);
      return interpretAnthropicToolResponse(res, callModel, allowed);
    },
  };
}
