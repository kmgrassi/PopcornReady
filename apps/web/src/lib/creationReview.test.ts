import assert from "node:assert/strict";
import test from "node:test";
import {
  creationDraftNavigationState,
  creationReviewNavigationState,
  readCreationDraft,
  readCreationReviewRequest,
  readCreationReviewState,
} from "./creationReview";

const request = {
  goal: "image" as const,
  projectId: "project_1",
  prompt: "An editorial still",
  improvePrompt: true,
  maximumUsd: 10,
  idempotencyKey: "asset-studio:proposal:proposal_1",
};

const proposal = {
  sessionId: "session_1",
  runId: "run_1",
  gateId: "gate_1",
  requestDigest: "digest_1",
  maximumUsd: 10,
  approvalToken: "approval_1",
  expiresAt: "2099-07-31T18:00:00.000Z",
  effectivePrompt: "A refined editorial still",
  enhancementApplied: true,
};

test("creation review state round-trips a valid request", () => {
  assert.deepEqual(
    readCreationReviewRequest(creationReviewNavigationState(request)),
    request,
  );
});

test("creation review state restores a validated proposal and automation policy", () => {
  assert.deepEqual(
    readCreationReviewState(
      creationReviewNavigationState(request, {
        proposal,
        autoApprovalAllowed: false,
      }),
    ),
    { request, proposal, autoApprovalAllowed: false },
  );
});

test("stored proposal state fails closed without explicit policy or valid authority", () => {
  assert.equal(
    readCreationReviewState({
      assetCreationReview: { request, proposal },
    }),
    null,
  );
  for (const invalidProposal of [
    { ...proposal, gateId: "" },
    { ...proposal, requestDigest: "" },
    { ...proposal, approvalToken: "" },
    { ...proposal, expiresAt: "not-a-date" },
    { ...proposal, maximumUsd: 9 },
    { ...proposal, effectivePrompt: "  " },
  ]) {
    assert.equal(
      readCreationReviewState({
        assetCreationReview: {
          request,
          proposal: invalidProposal,
          autoApprovalAllowed: true,
        },
      }),
      null,
    );
  }
});

test("legacy request-only review state remains readable", () => {
  assert.deepEqual(
    readCreationReviewState({ assetCreationReview: request }),
    { request, proposal: null, autoApprovalAllowed: true },
  );
});

test("request-only review state preserves an explicit manual-only policy", () => {
  assert.deepEqual(
    readCreationReviewState(
      creationReviewNavigationState(request, {
        proposal: null,
        autoApprovalAllowed: false,
      }),
    ),
    { request, proposal: null, autoApprovalAllowed: false },
  );
});

test("creation review state fails closed without a complete request", () => {
  assert.equal(readCreationReviewRequest(null), null);
  assert.equal(
    readCreationReviewRequest({
      assetCreationReview: { ...request, idempotencyKey: "" },
    }),
    null,
  );
  assert.equal(
    readCreationReviewRequest({
      assetCreationReview: { ...request, maximumUsd: 11 },
    }),
    null,
  );
  assert.equal(
    readCreationReviewRequest({
      assetCreationReview: { ...request, prompt: "   " },
    }),
    null,
  );
});

test("revision state carries the editable draft without proposal authority", () => {
  const draft = {
    goal: request.goal,
    projectId: request.projectId,
    prompt: request.prompt,
    improvePrompt: request.improvePrompt,
  };
  assert.deepEqual(
    readCreationDraft(creationDraftNavigationState(draft)),
    draft,
  );
  assert.equal(
    "idempotencyKey" in creationDraftNavigationState(draft).assetCreationDraft!,
    false,
  );
});

test("video review state preserves the default-on refinement choice", () => {
  const videoRequest = {
    ...request,
    goal: "video" as const,
    prompt: "A cyclist crosses a rain-slick street",
  };
  assert.deepEqual(
    readCreationReviewRequest(creationReviewNavigationState(videoRequest)),
    videoRequest,
  );
  assert.deepEqual(
    readCreationDraft(
      creationDraftNavigationState({
        goal: videoRequest.goal,
        projectId: videoRequest.projectId,
        prompt: videoRequest.prompt,
        improvePrompt: videoRequest.improvePrompt,
      }),
    ),
    {
      goal: "video",
      projectId: videoRequest.projectId,
      prompt: videoRequest.prompt,
      improvePrompt: true,
    },
  );
});
