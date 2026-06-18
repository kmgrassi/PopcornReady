import assert from "node:assert/strict";
import test from "node:test";

import {
  type OpenAiFunctionTool,
  createOpenAiLlmClient,
  interpretOpenAiToolResponse,
  sanitizeForOpenAI,
  toOpenAITool,
} from "../openai";
import type { ToolSpec } from "../types";

type SchemaProperties = Record<string, Record<string, unknown>>;

const planShots: ToolSpec = {
  name: "plan_shots",
  description: "Plan scenes and beats.",
  parameters: {
    type: "object",
    properties: { goal: { type: "string", minLength: 1 } },
    required: ["goal"],
  },
};

test("toOpenAITool wraps the spec as an OpenAI function tool and sanitizes parameters", () => {
  const tool = toOpenAITool(planShots);
  const properties = tool.function.parameters.properties as SchemaProperties;
  assert.equal(tool.type, "function");
  assert.equal(tool.function.name, "plan_shots");
  assert.equal(tool.function.description, "Plan scenes and beats.");
  // Tool-call parameters must be sanitized like the structured path, or OpenAI
  // rejects the request before the model can call the tool.
  assert.equal(properties.goal?.minLength, undefined);
  assert.equal(properties.goal?.type, "string");
  assert.deepEqual(tool.function.parameters.required, ["goal"]);
});

test("sanitizeForOpenAI strips keywords OpenAI tool parameters reject", () => {
  const sanitized = sanitizeForOpenAI({
    type: "object",
    properties: {
      goal: { type: "string", minLength: 1, maxLength: 5 },
      n: { type: "number", minimum: 1, maximum: 600 },
    },
    required: ["goal"],
  });
  const properties = sanitized.properties as SchemaProperties;
  assert.equal(properties.goal?.minLength, undefined);
  assert.equal(properties.goal?.maxLength, undefined);
  assert.equal(properties.n?.minimum, undefined);
  assert.equal(properties.n?.maximum, undefined);
  // structural keywords are preserved
  assert.equal(properties.goal.type, "string");
  assert.deepEqual(sanitized.required, ["goal"]);
});

test("interpretOpenAiToolResponse maps one tool_call with JSON-parsed arguments", () => {
  const decision = interpretOpenAiToolResponse(
    {
      model: "gpt-5",
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: "plan_shots", arguments: '{"goal":"a diner"}' } },
            ],
          },
        },
      ],
    },
    "fallback"
  );
  assert.equal(decision.type, "tool_call");
  if (decision.type === "tool_call") {
    assert.equal(decision.toolName, "plan_shots");
    assert.deepEqual(decision.input, { goal: "a diner" });
    assert.equal(decision.model, "gpt-5");
  }
});

test("interpretOpenAiToolResponse takes the first of parallel tool_calls", () => {
  const decision = interpretOpenAiToolResponse(
    {
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: "plan_shots", arguments: "{}" } },
              { function: { name: "generate_clip", arguments: "{}" } },
            ],
          },
        },
      ],
    },
    "m"
  );
  assert.equal(decision.type, "tool_call");
  if (decision.type === "tool_call") assert.equal(decision.toolName, "plan_shots");
});

test("interpretOpenAiToolResponse returns done with text when no tool is called", () => {
  const decision = interpretOpenAiToolResponse(
    { choices: [{ message: { content: "All complete." } }] },
    "m"
  );
  assert.equal(decision.type, "done");
  if (decision.type === "done") assert.equal(decision.text, "All complete.");
});

test("chooseTool sends function tools + tool_choice auto and uses max_completion_tokens", async () => {
  let sent: Record<string, unknown> | undefined;
  const client = createOpenAiLlmClient({
    model: "gpt-5",
    create: async (params) => {
      sent = params;
      return {
        model: "gpt-5",
        choices: [
          {
            message: {
              tool_calls: [{ function: { name: "plan_shots", arguments: '{"goal":"x"}' } }],
            },
          },
        ],
      };
    },
  });

  const decision = await client.chooseTool({
    system: "sys",
    userPayload: { a: 1 },
    tools: [planShots],
  });

  assert.ok(sent);
  assert.equal(sent.tool_choice, "auto");
  assert.equal(sent.parallel_tool_calls, false);
  const tools = sent.tools as OpenAiFunctionTool[];
  assert.equal(tools[0]?.type, "function");
  assert.equal(tools[0]?.function.name, "plan_shots");
  assert.ok("max_completion_tokens" in sent);
  assert.ok(!("max_tokens" in sent));
  assert.equal(decision.type, "tool_call");
});

test("low/minimal effort routes to the fast model; medium/high/none use the primary", async () => {
  const seen: string[] = [];
  const client = createOpenAiLlmClient({
    model: "gpt-5",
    fastModel: "gpt-5-mini",
    create: async (params) => {
      seen.push(String(params.model));
      return {
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "return_result", arguments: "{}" } },
              ],
            },
          },
        ],
      };
    },
  });
  for (const effort of ["minimal", "low", "medium", "high"] as const) {
    await client.structured({ cachedSystem: "s", user: "u", schema: {}, effort });
  }
  await client.structured({ cachedSystem: "s", user: "u", schema: {} });
  assert.deepEqual(seen, ["gpt-5-mini", "gpt-5-mini", "gpt-5", "gpt-5", "gpt-5"]);
});

test("reasoning_effort is sent for reasoning models (gpt-5) and omitted for gpt-4o", async () => {
  let reasoning: Record<string, unknown> | undefined;
  const gpt5 = createOpenAiLlmClient({
    model: "gpt-5",
    create: async (params) => {
      reasoning = params;
      return {
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "return_result", arguments: "{}" } },
              ],
            },
          },
        ],
      };
    },
  });
  await gpt5.structured({ cachedSystem: "s", user: "u", schema: {}, effort: "minimal" });
  assert.ok(reasoning);
  assert.equal(reasoning.reasoning_effort, "minimal");

  let nonReasoning: Record<string, unknown> | undefined;
  const gpt4o = createOpenAiLlmClient({
    model: "gpt-4o",
    create: async (params) => {
      nonReasoning = params;
      return {
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "return_result", arguments: "{}" } },
              ],
            },
          },
        ],
      };
    },
  });
  await gpt4o.structured({ cachedSystem: "s", user: "u", schema: {}, effort: "high" });
  assert.ok(nonReasoning);
  assert.ok(!("reasoning_effort" in nonReasoning));

  // No effort -> no reasoning_effort (provider default).
  let noEffort: Record<string, unknown> | undefined;
  const gpt5b = createOpenAiLlmClient({
    model: "gpt-5",
    create: async (params) => {
      noEffort = params;
      return {
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "return_result", arguments: "{}" } },
              ],
            },
          },
        ],
      };
    },
  });
  await gpt5b.structured({ cachedSystem: "s", user: "u", schema: {} });
  assert.ok(noEffort);
  assert.ok(!("reasoning_effort" in noEffort));
});

test("structured requires return_result tool call and parses arguments", async () => {
  const ok = createOpenAiLlmClient({
    model: "gpt-5",
    create: async () => ({
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: "return_result", arguments: '{"plan":1}' } },
            ],
          },
        },
      ],
    }),
  });
  assert.deepEqual(
    await ok.structured({ cachedSystem: "s", user: "u", schema: {} }),
    { plan: 1 }
  );

  const bad = createOpenAiLlmClient({
    model: "gpt-5",
    create: async () => ({ choices: [{ message: { content: "not json" } }] }),
  });
  await assert.rejects(
    () => bad.structured({ cachedSystem: "s", user: "u", schema: {} }),
    /did not call required tool/
  );
});

test("structured sends a required return_result function tool", async () => {
  let sent: Record<string, unknown> | undefined;
  const client = createOpenAiLlmClient({
    model: "gpt-5",
    create: async (params) => {
      sent = params;
      return {
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "return_result", arguments: '{"ok":true}' } },
              ],
            },
          },
        ],
      };
    },
  });

  await client.structured({
    cachedSystem: "s",
    user: "u",
    schema: { type: "object", properties: { ok: { type: "boolean" } } },
  });

  assert.ok(sent);
  assert.deepEqual(sent.tool_choice, {
    type: "function",
    function: { name: "return_result" },
  });
  assert.equal(sent.parallel_tool_calls, false);
  const tools = sent.tools as OpenAiFunctionTool[];
  assert.equal(tools[0]?.function.name, "return_result");
  assert.ok(!("response_format" in sent));
});

test("structured retries once when the model omits the required tool, then succeeds", async () => {
  let calls = 0;
  const client = createOpenAiLlmClient({
    model: "gpt-5",
    create: async () => {
      calls += 1;
      // First attempt: the model emits reasoning/text and never calls the tool.
      if (calls === 1) return { choices: [{ message: { content: "thinking..." } }] };
      return {
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "return_result", arguments: '{"plan":2}' } },
              ],
            },
          },
        ],
      };
    },
  });

  assert.deepEqual(
    await client.structured({ cachedSystem: "s", user: "u", schema: {} }),
    { plan: 2 }
  );
  assert.equal(calls, 2);
});

test("structured retries at most once, then surfaces the empty-tool error", async () => {
  let calls = 0;
  const bad = createOpenAiLlmClient({
    model: "gpt-5",
    create: async () => {
      calls += 1;
      return { choices: [{ message: { content: "still no tool" } }] };
    },
  });

  await assert.rejects(
    () => bad.structured({ cachedSystem: "s", user: "u", schema: {} }),
    /did not call required tool/
  );
  assert.equal(calls, 2);
});
