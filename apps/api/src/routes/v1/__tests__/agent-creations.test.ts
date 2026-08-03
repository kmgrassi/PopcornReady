import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";
import type { DomainRunRecord } from "@/lib/api/v1/domain-session-store";
import type { V1Asset } from "@/lib/api/v1/store";
import {
  buildDomainReportFromCompletion,
  DomainCompletionValidationError,
} from "@/lib/orchestrator/agent-definition";
import {
  runIdempotent,
  type IdempotencyStore,
} from "@/lib/api/v1/idempotency";
import {
  agentCreationsRouter,
  creationStatusForRun,
  creationStatusRoute,
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

const videoRequest = {
  ...imageRequest,
  kind: "video_create" as const,
  prompt: "An epic cinematic cyclist moving through a city, 8K",
};

function creatorRun(overrides: Partial<DomainRunRecord> = {}): DomainRunRecord {
  const task = taskFor({
    projectId: "project_1",
    actorId: "actor_1",
    request: imageRequest,
    requestDigest: "digest_1",
    approvalGateId: "gate_1",
    proposalActionId: "proposal_1",
    idempotencyKey: "key_1",
  });
  return {
    id: "run_1",
    projectId: "project_1",
    status: "failed",
    inputSummary: imageRequest.prompt,
    agentRole: "visuals",
    agentSessionId: "session_1",
    sessionSequence: 1,
    taskKind: "image_create",
    taskParams: task,
    originKind: "creator_direct",
    parentRunId: null,
    rootActionId: null,
    originActorId: "actor_1",
    originRequest: { requestDigest: "digest_1" },
    continuesRunId: null,
    pins: null,
    waitReason: null,
    completionRecipient: "creator_conversation",
    budgetUsd: 10,
    spentUsd: 0.08,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:01:00.000Z",
    startedAt: "2026-08-03T00:00:01.000Z",
    completedAt: "2026-08-03T00:01:00.000Z",
    supersededAt: null,
    ...overrides,
  };
}

function readyAsset(
  id: string,
  overrides: Partial<V1Asset> = {}
): V1Asset {
  return {
    id,
    schemaVersion: "asset.v1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    kind: "image",
    role: "standalone_image",
    name: "Finished image",
    filename: `${id}.png`,
    status: "ready",
    source: { type: "generated", generatedAssetId: id },
    remoteUrl: `https://media.example/${id}.png`,
    expiresAt: null,
    createdAt: "2026-08-03T00:00:30.000Z",
    updatedAt: "2026-08-03T00:00:30.000Z",
    ...overrides,
  };
}

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
  assert.deepEqual(task.acceptanceCriteria, [
    "Create at least one ready image asset that fulfills the approved request.",
  ]);

  const differentOriginalDigest = creationRequestDigest({
    ...prepared,
    originalPrompt: "A different original request",
  });
  assert.notEqual(differentOriginalDigest, requestDigest);
});

test("video proposals bind motion-aware enhancement and a distinct digest policy", async () => {
  let calls = 0;
  const prepared = await prepareCreationRequest("project_1", videoRequest, {
    structured: async <T extends object>() => {
      calls += 1;
      return {
        enhancedPrompt:
          "One continuous street-level shot of a cyclist crossing wet pavement from left to right while the camera holds still.",
      } as T;
    },
    recordCost: async (_projectId, operation) => operation(),
  });

  assert.equal(calls, 1);
  assert.equal(prepared.originalPrompt, videoRequest.prompt);
  assert.match(prepared.request.prompt, /One continuous street-level shot/);
  assert.equal(prepared.enhancementApplied, true);
  assert.equal(prepared.enhancementPolicy, "video_motion_direction_v1");

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
  assert.deepEqual(task.acceptanceCriteria, [
    "Create at least one ready video asset that fulfills the approved request.",
  ]);
  assert.notEqual(
    creationRequestDigest({
      ...prepared,
      enhancementPolicy: "video_motion_direction_v2",
    }),
    requestDigest
  );
});

test("creator-direct tasks keep a 4,000-character prompt exact while using bounded per-kind criteria", () => {
  const prompt = "x".repeat(4_000);
  const requests = [
    { ...imageRequest, kind: "image_create" as const, prompt },
    { ...videoRequest, kind: "video_create" as const, prompt },
    {
      ...videoRequest,
      kind: "video_edit" as const,
      prompt,
      sourceAssetId: "asset_source",
    },
    { ...videoRequest, kind: "soundtrack_create" as const, prompt },
    { ...videoRequest, kind: "audio_create" as const, prompt },
  ];

  for (const request of requests) {
    const task = taskFor({
      projectId: "project_1",
      actorId: "actor_1",
      request,
      requestDigest: `digest_${request.kind}`,
      approvalGateId: `gate_${request.kind}`,
      proposalActionId: `proposal_${request.kind}`,
      sourceFingerprint:
        request.kind === "video_edit" ? "source_fingerprint" : undefined,
      idempotencyKey: `key_${request.kind}`,
    });
    assert.equal(task.objective, prompt);
    assert.equal(task.instruction, prompt);
    assert.equal(task.acceptanceCriteria.length, 1);
    assert.ok(task.acceptanceCriteria[0].length <= 500);
    assert.notEqual(task.acceptanceCriteria[0], prompt);
  }
});

test("a long-prompt creator task accepts terminal evidence for its short trusted criterion", async () => {
  const prompt = "Long approved art direction. ".repeat(140).slice(0, 4_000);
  const task = taskFor({
    projectId: "project_1",
    actorId: "actor_1",
    request: { ...imageRequest, prompt },
    requestDigest: "digest_long",
    approvalGateId: "gate_long",
    proposalActionId: "proposal_long",
    idempotencyKey: "key_long",
  });
  const criterion = task.acceptanceCriteria[0];
  const report = await buildDomainReportFromCompletion(
    {
      runId: "run_long",
      projectId: "project_1",
      task,
      actions: [],
      summary: JSON.stringify({
        outcome: "done",
        acceptanceEvidence: [{
          criterion,
          satisfied: true,
          evidence: "The ready image fulfills the approved request.",
          assetIds: ["asset_long"],
        }],
        sessionSummary: "The requested image is ready.",
      }),
    },
    {
      validatedOutputs: async () => [{
        assetId: "asset_long",
        intrinsicRole: "standalone_image",
        kind: "image",
      }],
    }
  );

  assert.equal(report.outcome.outcome, "done");
  if (report.outcome.outcome === "done") {
    assert.equal(report.outcome.acceptanceEvidence[0]?.criterion, criterion);
  }
});

test("failed creator-direct status recovers ready run outputs in deterministic report-first order", async () => {
  const run = creatorRun();
  const actions = [{
    id: "action_1",
    tool: "generate_image_asset",
    status: "applied",
    params: {},
    outputAssetIds: ["asset_recovered", "asset_report", "asset_missing"],
    jobIds: [],
    createdAt: "2026-08-03T00:00:20.000Z",
  }];
  const report = {
    schemaVersion: "DomainReport.v1" as const,
    outcome: {
      outcome: "done" as const,
      outputs: [{ assetId: "asset_report", intrinsicRole: "standalone_image" }],
      changedSelections: [],
      acceptanceEvidence: [],
      sessionSummary: "done",
    },
  };
  const validatedIds: string[] = [];

  const result = await creationStatusForRun(
    {
      workspaceId: "workspace_1",
      actorId: "actor_1",
      projectId: "project_1",
      runId: "run_1",
    },
    {
      getRun: async () => run,
      listHistory: async () => [{
        runId: run.id,
        sessionSequence: 1,
        status: run.status,
        waitReason: null,
        taskKind: run.taskKind,
        continuesRunId: null,
        reportActionId: "report_1",
        report,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
      }],
      listActions: async () => actions,
      loadOutputInventory: async (input) => {
        const candidateIds = input.actions.flatMap((action) =>
          action.status === "applied" ? action.outputAssetIds : []
        );
        assert.equal(candidateIds.length, 1);
        const candidateId = candidateIds[0]!;
        validatedIds.push(candidateId);
        if (candidateId === "asset_missing") {
          throw new DomainCompletionValidationError(
            "invalid_output_state",
            "Output is missing.",
            false
          );
        }
        return [{
          assetId: candidateId,
          kind: "image",
          intrinsicRole: "standalone_image",
        }];
      },
      getRunAsset: async (_workspaceId, _projectId, assetId) => {
        assert.notEqual(assetId, "asset_missing");
        return readyAsset(
          assetId,
          assetId === "asset_report"
            ? { expiresAt: "2026-08-03T01:00:00.000Z" }
            : {}
        );
      },
    }
  );

  assert.deepEqual(validatedIds, [
    "asset_recovered",
    "asset_report",
    "asset_missing",
  ]);
  assert.deepEqual(
    result.outputs.map((output) => output.assetId),
    ["asset_report", "asset_recovered"]
  );
  assert.equal(result.outputs[0]?.url, "https://media.example/asset_report.png");
  assert.equal(result.outputs[0]?.expiresAt, "2026-08-03T01:00:00.000Z");
  assert.equal(result.outputs[1]?.expiresAt, null);
  assert.equal(result.run.status, "failed");
});

test("creator-direct status responses are private and no-store even without outputs", async () => {
  const requiredProjects: string[] = [];
  const response = await creationStatusRoute(
    {
      auth: {
        mode: "local",
        actor: { id: "actor_1", type: "local" },
        workspaceId: "workspace_1",
        isLocal: true,
      },
    },
    { projectId: "project_1", runId: "run_1" },
    {
      requireProjectAccess: async (workspaceId, projectId) => {
        requiredProjects.push(`${workspaceId}/${projectId}`);
      },
      getStatus: (input) =>
        creationStatusForRun(input, {
          getRun: async () => creatorRun({ taskParams: null }),
          listHistory: async () => [],
          listActions: async () => [],
          getRunAsset: async () => readyAsset("unused"),
        }),
    }
  );

  assert.deepEqual(requiredProjects, ["workspace_1/project_1"]);
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(response.body.outputs, []);
});

test("creator-direct status rejects a mismatched actor before privileged output reads", async () => {
  let privilegedReadCount = 0;

  await assert.rejects(
    creationStatusForRun(
      {
        workspaceId: "workspace_1",
        actorId: "actor_other",
        projectId: "project_1",
        runId: "run_1",
      },
      {
        getRun: async () => creatorRun(),
        listHistory: async () => {
          privilegedReadCount += 1;
          return [];
        },
        listActions: async () => {
          privilegedReadCount += 1;
          return [];
        },
        loadOutputInventory: async () => {
          privilegedReadCount += 1;
          return [];
        },
        getRunAsset: async () => {
          privilegedReadCount += 1;
          return readyAsset("asset_unreachable");
        },
      }
    ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "not_found"
  );

  assert.equal(privilegedReadCount, 0);
});

test("creator-direct status degrades only completion-validation failures", async () => {
  const run = creatorRun();
  const baseDeps = {
    getRun: async () => run,
    listHistory: async () => [],
    listActions: async () => [{
      id: "action_1",
      tool: "generate_image_asset",
      status: "applied",
      params: {},
      outputAssetIds: ["asset_candidate"],
      jobIds: [],
      createdAt: "2026-08-03T00:00:20.000Z",
    }],
    getRunAsset: async () => readyAsset("unused"),
  };
  const degraded = await creationStatusForRun(
    {
      workspaceId: "workspace_1",
      actorId: "actor_1",
      projectId: "project_1",
      runId: "run_1",
    },
    {
      ...baseDeps,
      loadOutputInventory: async () => {
        throw new DomainCompletionValidationError(
          "invalid_output_state",
          "Output is not ready.",
          false
        );
      },
    }
  );
  assert.deepEqual(degraded.outputs, []);

  await assert.rejects(
    creationStatusForRun(
      {
        workspaceId: "workspace_1",
        actorId: "actor_1",
        projectId: "project_1",
        runId: "run_1",
      },
      {
        ...baseDeps,
        loadOutputInventory: async () => {
          throw new Error("database unavailable");
        },
      }
    ),
    /database unavailable/
  );
});

test("opt-outs, video edits, and audio preserve the exact prompt without a model call", async () => {
  let calls = 0;
  const structured = async <T extends object>() => {
    calls += 1;
    return { enhancedPrompt: "should not be used" } as T;
  };
  const requests = [
    { ...imageRequest, prompt: "Original image prompt", improvePrompt: false },
    { ...videoRequest, prompt: "Original video prompt", improvePrompt: false },
    {
      ...videoRequest,
      kind: "video_edit" as const,
      prompt: "Keep the subject and slow the camera move",
      sourceAssetId: "asset_1",
    },
    {
      ...videoRequest,
      kind: "soundtrack_create" as const,
      prompt: "Sparse percussion with no vocals",
    },
    {
      ...videoRequest,
      kind: "audio_create" as const,
      prompt: "A single wooden door closing",
    },
  ];
  const prepared = await Promise.all(
    requests.map((request) =>
      prepareCreationRequest("project_1", request, { structured })
    )
  );

  assert.equal(calls, 0);
  assert.deepEqual(
    prepared.map((result) => result.request.prompt),
    requests.map((request) => request.prompt)
  );
  assert.ok(prepared.every((result) => !result.enhancementApplied));
});

test("invalid enhancer output fails visibly instead of creating a silent fallback", async () => {
  for (const [request, message] of [
    [imageRequest, /turn off Improve image prompt/],
    [videoRequest, /turn off Improve video prompt/],
  ] as const) {
    await assert.rejects(
      prepareCreationRequest("project_1", request, {
        structured: async <T extends object>() => ({ enhancedPrompt: "" }) as T,
        recordCost: async (_projectId, operation) => operation(),
      }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === "model_output_invalid" &&
        message.test(error.message)
    );
  }
});

test("video proposal provenance stores the exact original and effective prompts", async () => {
  let actionInput: Record<string, unknown> | undefined;
  let dispatchInput: Record<string, unknown> | undefined;
  const ids = ["action_video", "gate_video"];
  const effectivePrompt =
    "One continuous street-level shot of a cyclist crossing wet pavement from left to right while the camera holds still.";
  const proposal = await createCreationProposal(
    {
      workspaceId: "workspace_1",
      actorId: "actor_1",
      projectId: "project_1",
      requested: videoRequest,
      idempotencyKey: "video_proposal_key",
    },
    {
      verifyReferences: async () => undefined,
      prepareRequest: async () => ({
        request: { ...videoRequest, prompt: effectivePrompt },
        originalPrompt: videoRequest.prompt,
        enhancementApplied: true,
        enhancementPolicy: "video_motion_direction_v1",
      }),
      dispatch: async (input) => {
        dispatchInput = input as unknown as Record<string, unknown>;
        return { sessionId: "session_video", runId: "run_video" };
      },
      createProposalAction: async (input) => {
        actionInput = input as unknown as Record<string, unknown>;
        return { id: "action_video" };
      },
      createProposalGate: async () => undefined,
      randomId: () => ids.shift() ?? "unexpected_id",
      approvalToken: () => "approval_video",
      now: () => 0,
    }
  );

  assert.equal(dispatchInput?.inputSummary, effectivePrompt);
  assert.equal(actionInput?.rationale, effectivePrompt);
  assert.deepEqual(
    (actionInput?.params as {
      promptEnhancement?: Record<string, unknown>;
    }).promptEnhancement,
    {
      requested: true,
      applied: true,
      policy: "video_motion_direction_v1",
      originalPrompt: videoRequest.prompt,
      effectivePrompt,
    }
  );
  assert.equal(proposal.effectivePrompt, effectivePrompt);
  assert.equal(proposal.enhancementApplied, true);
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

test("video enhancement failure occurs before run, action, or gate persistence", async () => {
  const persisted: string[] = [];
  let enhancementCalls = 0;
  await assert.rejects(
    createCreationProposal(
      {
        workspaceId: "workspace_1",
        actorId: "actor_1",
        projectId: "project_1",
        requested: videoRequest,
        idempotencyKey: "proposal_key",
      },
      {
        verifyReferences: async () => undefined,
        prepareRequest: (projectId, request) =>
          prepareCreationRequest(projectId, request, {
            structured: async <T extends object>() => {
              enhancementCalls += 1;
              return { enhancedPrompt: "" } as T;
            },
            recordCost: async (_projectId, operation) => operation(),
          }),
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
  assert.equal(enhancementCalls, 1);
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

test("the proposal idempotency boundary replays one enhanced video prompt without another model pass", async () => {
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
        requested: videoRequest,
        idempotencyKey: "proposal_key",
      },
      {
        verifyReferences: async () => undefined,
        prepareRequest: (projectId, request) =>
          prepareCreationRequest(projectId, request, {
            structured: async <T extends object>() => {
              enhancementCalls += 1;
              return {
                enhancedPrompt:
                  "One continuous shot of a cyclist crossing wet pavement while the camera holds still.",
              } as T;
            },
            recordCost: async (_projectId, operation) => operation(),
          }),
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
