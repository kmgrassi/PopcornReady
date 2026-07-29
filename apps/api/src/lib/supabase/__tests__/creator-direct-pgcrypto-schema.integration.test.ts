import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

const localUrl = process.env.SUPABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  Boolean(process.env.SUPABASE_ANON_KEY) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const integrationTest = runLocalIntegration ? test : test.skip;

function client(key: string): SupabaseClient {
  return createClient(localUrl, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function assertDomainError(
  error: PostgrestError | null,
  expectedMessage: string
): void {
  assert.ok(error, `expected ${expectedMessage}`);
  assert.equal(error.code, "23514");
  assert.equal(error.message, expectedMessage);
  const rendered = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  assert.doesNotMatch(rendered, /digest|does not exist/i);
}

integrationTest(
  "creator-direct gate decisions resolve pgcrypto before rejecting a missing gate",
  async () => {
    const service = client(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const anon = client(process.env.SUPABASE_ANON_KEY!);
    const gateId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();
    const requestDigest = "a".repeat(64);
    const approvalToken = "creator-direct-token-1234";

    const { error: confirmationError } = await service.rpc(
      "consume_creator_direct_proposal_gate",
      {
        p_gate_id: gateId,
        p_project_id: projectId,
        p_actor_id: actorId,
        p_request_digest: requestDigest,
        p_approved_max_usd: 10,
        p_approval_token: approvalToken,
        p_idempotency_key: `confirm-${randomUUID()}`,
      }
    );
    assertDomainError(confirmationError, "creator_direct_confirmation_invalid");

    const { error: rejectionError } = await service.rpc(
      "reject_creator_direct_proposal_gate",
      {
        p_gate_id: gateId,
        p_project_id: projectId,
        p_actor_id: actorId,
        p_request_digest: requestDigest,
        p_approval_token: approvalToken,
      }
    );
    assertDomainError(rejectionError, "creator_direct_rejection_invalid");

    const { error: anonConfirmationError } = await anon.rpc(
      "consume_creator_direct_proposal_gate",
      {
        p_gate_id: gateId,
        p_project_id: projectId,
        p_actor_id: actorId,
        p_request_digest: requestDigest,
        p_approved_max_usd: 10,
        p_approval_token: approvalToken,
        p_idempotency_key: `anon-confirm-${randomUUID()}`,
      }
    );
    assert.ok(anonConfirmationError);
    assert.equal(anonConfirmationError.code, "42501");

    const { error: anonRejectionError } = await anon.rpc(
      "reject_creator_direct_proposal_gate",
      {
        p_gate_id: gateId,
        p_project_id: projectId,
        p_actor_id: actorId,
        p_request_digest: requestDigest,
        p_approval_token: approvalToken,
      }
    );
    assert.ok(anonRejectionError);
    assert.equal(anonRejectionError.code, "42501");
  }
);
