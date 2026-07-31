import assert from "node:assert/strict";
import test from "node:test";
import {
  creationDraftNavigationState,
  creationReviewNavigationState,
  readCreationDraft,
  readCreationReviewRequest,
} from "./creationReview";

const request = {
  goal: "image" as const,
  projectId: "project_1",
  prompt: "An editorial still",
  improvePrompt: true,
  maximumUsd: 10,
  idempotencyKey: "asset-studio:proposal:proposal_1",
};

test("creation review state round-trips a valid request", () => {
  assert.deepEqual(
    readCreationReviewRequest(creationReviewNavigationState(request)),
    request,
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
