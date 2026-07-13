import assert from "node:assert/strict";
import test from "node:test";

import {
  createAnthropicLlmClient,
  interpretAnthropicToolResponse,
  toAnthropicTool,
} from "../anthropic";
import type { ToolSpec } from "../types";

const planShots: ToolSpec = {
  name: "plan_shots",
  description: "Plan scenes and beats.",
  parameters: {
    type: "object",
    properties: { goal: { type: "string" } },
    required: ["goal"],
  },
};

test("toAnthropicTool uses input_schema", () => {
  const tool = toAnthropicTool(planShots) as {
    name: string;
    description: string;
    input_schema: ToolSpec["parameters"];
  };
  assert.equal(tool.name, "plan_shots");
  assert.equal(tool.description, "Plan scenes and beats.");
  assert.deepEqual(tool.input_schema, planShots.parameters);
});

test("interpretAnthropicToolResponse maps a single tool_use block", () => {
  const decision = interpretAnthropicToolResponse(
    { model: "claude-x", content: [{ type: "tool_use", name: "plan_shots", input: { goal: "y" } }] },
    "fallback"
  );
  assert.equal(decision.type, "tool_call");
  if (decision.type === "tool_call") {
    assert.equal(decision.toolName, "plan_shots");
    assert.deepEqual(decision.input, { goal: "y" });
    assert.equal(decision.model, "claude-x");
  }
});

test("interpretAnthropicToolResponse throws on more than one tool_use", () => {
  assert.throws(
    () =>
      interpretAnthropicToolResponse(
        {
          content: [
            { type: "tool_use", name: "a", input: {} },
            { type: "tool_use", name: "b", input: {} },
          ],
        },
        "fb"
      ),
    /more than one tool call/
  );
});

test("interpretAnthropicToolResponse returns done with joined text when no tool is used", () => {
  const decision = interpretAnthropicToolResponse(
    { content: [{ type: "text", text: "done " }, { type: "text", text: "here" }] },
    "fb"
  );
  assert.equal(decision.type, "done");
  if (decision.type === "done") assert.equal(decision.text, "done here");
});

test("interpretAnthropicToolResponse rejects a tool the registry does not allow", () => {
  assert.throws(
    () =>
      interpretAnthropicToolResponse(
        { content: [{ type: "tool_use", name: "bogus", input: {} }] },
        "fb",
        new Set(["plan_shots"])
      ),
    /unknown tool/i
  );
});

test("low/minimal effort routes chooseTool to the fast model", async () => {
  const seen: string[] = [];
  const client = createAnthropicLlmClient({
    model: "claude-x",
    fastModel: "claude-haiku",
    createMessage: async (params) => {
      seen.push(String(params.model));
      return { content: [{ type: "text", text: "ok" }] };
    },
  });
  await client.chooseTool({ system: "s", userPayload: {}, tools: [planShots], effort: "minimal" });
  await client.chooseTool({ system: "s", userPayload: {}, tools: [planShots], effort: "high" });
  assert.deepEqual(seen, ["claude-haiku", "claude-x"]);
});

test("structured routes to the fast model and delegates required tool-call helper", async () => {
  const seen: string[] = [];
  const client = createAnthropicLlmClient({
    model: "claude-x",
    fastModel: "claude-haiku",
    createMessage: async (params) => {
      seen.push(String(params.model));
      return {
        content: [
          { type: "tool_use", name: "return_result", input: { ok: true } },
        ],
      };
    },
  });

  assert.deepEqual(
    await client.structured({
      cachedSystem: "s",
      user: "u",
      schema: { type: "object", properties: { ok: { type: "boolean" } } },
      effort: "minimal",
    }),
    { ok: true }
  );
  assert.deepEqual(seen, ["claude-haiku"]);
});

test("structured rejects a non-object tool payload", async () => {
  const client = createAnthropicLlmClient({
    model: "claude-x",
    createMessage: async () => ({
      content: [{ type: "tool_use", name: "return_result", input: "oops" }],
    }),
  });

  await assert.rejects(
    () => client.structured({ cachedSystem: "s", user: "u", schema: {} }),
    /invalid tool input/
  );
});

test("structured retries once when the model omits the required tool, then succeeds", async () => {
  let calls = 0;
  const client = createAnthropicLlmClient({
    model: "claude-x",
    createMessage: async () => {
      calls += 1;
      // First attempt: the model emits only text and never calls the tool.
      if (calls === 1) return { content: [{ type: "text", text: "thinking..." }] };
      return {
        content: [{ type: "tool_use", name: "return_result", input: { plan: 2 } }],
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
  const bad = createAnthropicLlmClient({
    model: "claude-x",
    createMessage: async () => {
      calls += 1;
      return { content: [{ type: "text", text: "still no tool" }] };
    },
  });

  await assert.rejects(
    () => bad.structured({ cachedSystem: "s", user: "u", schema: {} }),
    /did not call required tool/
  );
  assert.equal(calls, 2);
});

test("chooseTool sends input_schema tools + tool_choice auto and maps the result", async () => {
  let sent: Record<string, unknown> | undefined;
  const client = createAnthropicLlmClient({
    model: "claude-x",
    createMessage: async (params) => {
      sent = params;
      return {
        model: "claude-x",
        content: [{ type: "tool_use", name: "plan_shots", input: { goal: "z" } }],
      };
    },
  });

  const decision = await client.chooseTool({
    system: "sys",
    userPayload: { a: 1 },
    tools: [planShots],
  });

  assert.deepEqual(sent?.tool_choice, { type: "auto" });
  const tools = sent?.tools as Array<{ input_schema: { type: string } }> | undefined;
  assert.equal(tools?.[0]?.input_schema.type, "object");
  assert.equal(sent?.max_tokens, 2000);
  assert.equal(decision.type, "tool_call");
  if (decision.type === "tool_call") assert.equal(decision.toolName, "plan_shots");
});
