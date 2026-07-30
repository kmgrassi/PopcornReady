import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";
import {
  runIdempotent,
  type IdempotencyStore,
} from "@/lib/api/v1/idempotency";
import {
  agentCreationsRouter,
  createCreationProposal,
  creationRequestDigest,
  parseCreation,
  prepareCreationRequest,
  taskFor,
} from "../agent-creations";

const imageRequest = {
  kind: "image_create" as const,
  prompt: "A stunning epic city, masterpiece, 8K",
  maximumUsd: 10,
  referenceAssetIds: [],
  improvePrompt: true,
};

function routeSignatures(): string[] {
  const stack = (agentCreationsRouter as unknown as { stack: unknown[] }).stack;
  return stack.map((layer) => {
    const route = layer as {
      route?: { path: string; methods: Record<string, boolean> };
    };
    const methods = Object.keys(route.route?.methods ?? {}).sort().join(",");
    return `${methods} ${route.route?.path ?? ""}`;
  });
}

test("agent creations router exposes proposal, confirmation, status, and cancel endpoints", () => {
  assert.deepEqual(routeSignatures(), [
    "post /projects/:projectId/agent-creations/proposals",
    "post /projects/:projectId/agent-creations/proposals/:gateId/confirm",
    "get /projects/:projectId/agent-creations/:runId",
    "post /projects/:projectId/agent-creations/:runId/cancel",
  ]);
});

test("creator-direct proposal parsing accepts only a strict improvePrompt boolean", () => {
  assert.equal(parseCreation(imageRequest).improvePrompt, true);
  assert.equal(
    parseCreation({ ...imageRequest, improvePrompt: undefined }).improvePrompt,
    false
  );
  assert.throws(
    () => parseCreation({ ...imageRequest, improvePrompt: "true" }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "validation_failed" &&
      /improvePrompt must be a boolean/.test(error.message)
  );
});

test("image proposals bind the enhanced prompt while retaining the original", async () => {
  let calls = 0;
  const prepared = await prepareCreationRequest("project_1", imageRequest, {
    structured: async <T extends object>() => {
      calls += 1;
      return {
        enhancedPrompt:
          "Street-level photograph of a compact city at dusk under flat overcast light.",
      } as T;
    },
    recordCost: async (_projectId, operation) => operation(),
  });

  assert.equal(calls, 1);
  assert.equal(prepared.originalPrompt, imageRequest.prompt);
  assert.match(prepared.request.prompt, /Street-level photograph/);
  assert.equal(prepared.enhancementApplied, true);
  assert.equal(prepared.enhancementPolicy, "image_art_direction_v1");

  const requestDigest = creationRequestDigest(prepared);
  const task = taskFor({
    projectId: "project_1",
    actorId: "actor_1",
    request: prepared.request,
    requestDigest,
    approvalGateId: "gate_1",
    proposalActionId: "action_1",
    idempotencyKey: "key_1",
  });
  assert.equal(task.objective, prepared.request.prompt);
  assert.equal(task.instruction, prepared.request.prompt);
  assert.deepEqual(task.acceptanceCriteria, [prepared.request.prompt]);

  const differentOriginalDigest = creationRequestDigest({
    ...prepared,
    originalPrompt: "A different original request",
  });
  assert.notEqual(differentOriginalDigest, requestDigest);
});

test("bypass and non-image proposals preserve the exact trimmed request without a model call", async () => {
  let calls = 0;
  const structured = async <T extends object>() => {
    calls += 1;
    return { enhancedPrompt: "should not be used" } as T;
  };
  const bypassed = await prepareCreationRequest(
    "project_1",
    { ...imageRequest, prompt: "Original image prompt", improvePrompt: false },
    { structured }
  );
  const video = await prepareCreationRequest(
    "project_1",
    {
      ...imageRequest,
      kind: "video_create",
      prompt: "Original video prompt",
    },
    { structured }
  );

  assert.equal(calls, 0);
  assert.equal(bypassed.request.prompt, "Original image prompt");
  assert.equal(video.request.prompt, "Original video prompt");
  assert.equal(bypassed.enhancementApplied, false);
  assert.equal(video.enhancementApplied, false);
});

test("invalid enhancer output fails visibly instead of creating a silent fallback", async () => {
  await assert.rejects(
    prepareCreationRequest("project_1", imageRequest, {
      structured: async <T extends object>() => ({ enhancedPrompt: "" }) as T,
      recordCost: async (_projectId, operation) => operation(),
    }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.code === "model_output_invalid" &&
      /turn off Improve image prompt/.test(error.message)
  );
});

test("proposal creation verifies and enhances before persistence, then stores exact prompt provenance", async () => {
  const events: string[] = [];
  let actionInput: Record<string, unknown> | undefined;
  let dispatchInput: Record<string, unknown> | undefined;
  let gateInput: Record<string, unknown> | undefined;
  const ids = ["action_1", "gate_1"];
  const prepared = {
    request: {
      ...imageRequest,
      prompt:
        "Street-level photograph of a compact city at dusk under flat overcast light.",
    },
    originalPrompt: imageRequest.prompt,
    enhancementApplied: true,
    enhancementPolicy: "image_art_direction_v1",
  };

  const proposal = await createCreationProposal(
    {
      workspaceId: "workspace_1",
      actorId: "actor_1",
      projectId: "project_1",
      requested: imageRequest,
      idempotencyKey: "proposal_key",
    },
    {
      verifyReferences: async () => {
        events.push("verify");
        return undefined;
      },
      prepareRequest: async () => {
        events.push("enhance");
        return prepared;
      },
      dispatch: async (input) => {
        events.push("dispatch");
        dispatchInput = input as unknown as Record<string, unknown>;
        return { sessionId: "session_1", runId: "run_1" };
      },
      createProposalAction: async (input) => {
        events.push("action");
        actionInput = input as unknown as Record<string, unknown>;
        return { id: "action_1" };
      },
      createProposalGate: async (input) => {
        events.push("gate");
        gateInput = input as unknown as Record<string, unknown>;
      },
      randomId: () => ids.shift() ?? "unexpected_id",
      approvalToken: () => "approval_token",
      now: () => 0,
    }
  );

  assert.deepEqual(events, ["verify", "enhance", "dispatch", "action", "gate"]);
  assert.equal(dispatchInput?.inputSummary, prepared.request.prompt);
  assert.equal(actionInput?.rationale, prepared.request.prompt);
  assert.deepEqual(
    (actionInput?.params as {
      promptEnhancement?: Record<string, unknown>;
    }).promptEnhancement,
    {
      requested: true,
      applied: true,
      policy: "image_art_direction_v1",
      originalPrompt: imageRequest.prompt,
      effectivePrompt: prepared.request.prompt,
    }
  );
  assert.equal(gateInput?.requestDigest, proposal.requestDigest);
  assert.equal(proposal.effectivePrompt, prepared.request.prompt);
  assert.equal(proposal.enhancementApplied, true);
});

test("enhancement failure occurs before run, action, or gate persistence", async () => {
  const persisted: string[] = [];
  await assert.rejects(
    createCreationProposal(
      {
        workspaceId: "workspace_1",
        actorId: "actor_1",
        projectId: "project_1",
        requested: imageRequest,
        idempotencyKey: "proposal_key",
      },
      {
        verifyReferences: async () => undefined,
        prepareRequest: async () => {
          throw new ApiError("model_output_invalid", "Enhancement failed.");
        },
        dispatch: async () => {
          persisted.push("dispatch");
          return { sessionId: "session_1", runId: "run_1" };
        },
        createProposalAction: async () => {
          persisted.push("action");
          return { id: "action_1" };
        },
        createProposalGate: async () => {
          persisted.push("gate");
        },
      }
    ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "model_output_invalid"
  );
  assert.deepEqual(persisted, []);
});

class ProposalIdempotencyStore implements IdempotencyStore {
  private response:
    | { bodyHash: string; status: number; responseBody: unknown }
    | undefined;

  async reserve(input: {
    bodyHash: string;
  }) {
    if (!this.response) {
      return { state: "reserved" as const, leaseToken: "lease_1" };
    }
    if (this.response.bodyHash !== input.bodyHash) {
      return { state: "conflict" as const };
    }
    return {
      state: "replay" as const,
      status: this.response.status,
      responseBody: this.response.responseBody,
    };
  }

  async complete(input: {
    bodyHash: string;
    status: number;
    responseBody: unknown;
  }) {
    this.response = {
      bodyHash: input.bodyHash,
      status: input.status,
      responseBody: input.responseBody,
    };
    return true;
  }

  async renew() {
    return true;
  }

  async abandon() {
    this.response = undefined;
    return true;
  }
}

test("the proposal idempotency boundary replays one effective prompt without another model pass", async () => {
  const store = new ProposalIdempotencyStore();
  let enhancementCalls = 0;
  let persistenceCalls = 0;
  const ids = ["action_1", "gate_1"];
  const operation = () =>
    createCreationProposal(
      {
        workspaceId: "workspace_1",
        actorId: "actor_1",
        projectId: "project_1",
        requested: imageRequest,
        idempotencyKey: "proposal_key",
      },
      {
        verifyReferences: async () => undefined,
        prepareRequest: async () => {
          enhancementCalls += 1;
          return {
            request: { ...imageRequest, prompt: "One stable refined prompt" },
            originalPrompt: imageRequest.prompt,
            enhancementApplied: true,
            enhancementPolicy: "image_art_direction_v1",
          };
        },
        dispatch: async () => {
          persistenceCalls += 1;
          return { sessionId: "session_1", runId: "run_1" };
        },
        createProposalAction: async () => {
          persistenceCalls += 1;
          return { id: "action_1" };
        },
        createProposalGate: async () => {
          persistenceCalls += 1;
        },
        randomId: () => ids.shift() ?? "unexpected_id",
        approvalToken: () => "approval_token",
        now: () => 0,
      }
    );
  const first = await runIdempotent(
    "workspace_1:actor_1:POST:proposal",
    "proposal_key",
    "body_hash",
    async () => ({ status: 201, body: { proposal: await operation() } }),
    { store }
  );
  const replay = await runIdempotent(
    "workspace_1:actor_1:POST:proposal",
    "proposal_key",
    "body_hash",
    async () => ({ status: 201, body: { proposal: await operation() } }),
    { store }
  );

  assert.deepEqual(replay, first);
  assert.equal(enhancementCalls, 1);
  assert.equal(persistenceCalls, 3);
});
