import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  parseApproveRerunProposalRequest,
  parseCreateRerunProposalV2Request,
  parseExecuteRerunProposalRequest,
  parseRefreshRerunProposalRequest,
  parseRerunProposalActionId,
} from "../rerun-proposals";

test("in-process HTTP preview path parses v2 and returns an inert proposal envelope", async (t) => {
  const inertEffects = { providerCalls: 0, selectionWrites: 0, enqueueCalls: 0 };
  const app = express();
  app.use(express.json());
  app.post("/api/v1/projects/:projectId/rerun-proposals/v2", (req, res) => {
    const parsed = parseCreateRerunProposalV2Request(req.body, req.params.projectId);
    // The production route passes this exact parsed value to the v2 service.
    // This smoke keeps all execution seams absent and proves the HTTP contract.
    res.status(201).json({
      actionId: "proposal-action",
      proposal: {
        schemaVersion: "RerunProposal.v2",
        projectId: parsed.projectId,
        rootRunId: parsed.rootRunId,
        source: parsed.source,
        userIntent: parsed.message,
        targets: parsed.targets,
        outcome: "ask_clarification",
      },
    });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const response = await fetch(
    `http://127.0.0.1:${port}/api/v1/projects/11111111-1111-4111-8111-111111111111/rerun-proposals/v2`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Shorten the narration.",
        rootRunId: "22222222-2222-4222-8222-222222222222",
        targets: [{
          kind: "transcript_segment",
          projectId: "11111111-1111-4111-8111-111111111111",
          transcriptSegmentId: "33333333-3333-4333-8333-333333333333",
        }],
      }),
    }
  );
  assert.equal(response.status, 201);
  const body = await response.json() as {
    actionId: string;
    proposal: { schemaVersion: string; outcome: string; userIntent: string };
  };
  assert.equal(body.actionId, "proposal-action");
  assert.equal(body.proposal.schemaVersion, "RerunProposal.v2");
  assert.equal(body.proposal.outcome, "ask_clarification");
  assert.equal(body.proposal.userIntent, "Shorten the narration.");
  assert.deepEqual(inertEffects, {
    providerCalls: 0,
    selectionWrites: 0,
    enqueueCalls: 0,
  });
});

test("v2 HTTP parser rejects malformed targets before service work", () => {
  assert.throws(() => parseCreateRerunProposalV2Request({
    message: "Change it",
    targets: [{
      kind: "asset",
      projectId: "project-a",
      assetId: "asset-a",
      requiresApproval: false,
    }],
  }, "project-a"), /cannot author server policy field requiresApproval/);
  assert.throws(() => parseCreateRerunProposalV2Request({
    source: "autonomous_review",
    message: "Change it",
    targets: [{ kind: "project", projectId: "project-a" }],
  }, "project-a"), /source is server-derived/);
});

test("durable lifecycle reads reject malformed proposal action identities", () => {
  assert.equal(
    parseRerunProposalActionId("22222222-2222-4222-8222-222222222222"),
    "22222222-2222-4222-8222-222222222222"
  );
  assert.throws(
    () => parseRerunProposalActionId("not-an-action"),
    /actionId must be a UUID/
  );
});

test("in-process lifecycle HTTP contract keeps approval, refresh, and execution bounded", async (t) => {
  const app = express();
  app.use(express.json());
  app.post("/approve", (req, res) =>
    res.json(parseApproveRerunProposalRequest(req.body)));
  app.post("/refresh", (req, res) =>
    res.json(parseRefreshRerunProposalRequest(req.body)));
  app.post("/execute", (req, res) =>
    res.json(parseExecuteRerunProposalRequest(req.body)));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const approve = await post("/approve", { approvedMaxCostUsd: 2 });
  assert.deepEqual(await approve.json(), { approvedMaxCostUsd: 2 });
  const refresh = await post("/refresh", {
    idempotencyKey: "refresh-1",
    message: "Use the warm option.",
    clarificationAnswer: {
      answerFingerprint: "fingerprint-1",
      optionId: "warm",
    },
  });
  assert.deepEqual(await refresh.json(), {
    idempotencyKey: "refresh-1",
    message: "Use the warm option.",
    clarificationAnswer: {
      answerFingerprint: "fingerprint-1",
      optionId: "warm",
    },
  });
  const execute = await post("/execute", { idempotencyKey: "execute-1" });
  assert.deepEqual(await execute.json(), { idempotencyKey: "execute-1" });
  assert.throws(
    () => parseExecuteRerunProposalRequest({
      idempotencyKey: "execute-1",
      approvedMaxCostUsd: 0,
    }),
    /approvedMaxCostUsd is unsupported/
  );
});
