import { Router } from "express";
import type { Request, Response } from "express";
import { createHash, createHmac } from "node:crypto";
import { mutation } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { requestContext } from "@/lib/supabase/request-context";

export const accountRouter = Router();

const DEVICE_RECOVERY_TOKEN_MIN_LENGTH = 32;
const DEVICE_RECOVERY_TOKEN_MAX_LENGTH = 512;

function readEmail(body: unknown): string {
  const email =
    body && typeof body === "object" && "email" in body
      ? String((body as { email?: unknown }).email ?? "").trim().toLowerCase()
      : "";
  if (!email || email.length > 320 || !email.includes("@")) {
    throw new ApiError("validation_failed", "Enter a valid email address.");
  }
  return email;
}

async function assertNoUnlinkedInviteCollision(email: string, ownUserId: string) {
  const db = getServiceSupabase();
  const row = await runQuery(
    "account.assertNoUnlinkedInviteCollision",
    db
      .from("users")
      .select("id")
      .is("auth_id", null)
      .ilike("email", email)
      .neq("id", ownUserId)
      .limit(1)
      .maybeSingle()
  );

  if (row) {
    throw new ApiError(
      "account_collision",
      "That email is already reserved for an invited account. Sign in with that account or use a different email."
    );
  }
}

function readRecoveryToken(body: unknown): string {
  const token =
    body && typeof body === "object" && "token" in body
      ? String((body as { token?: unknown }).token ?? "").trim()
      : "";
  if (
    token.length < DEVICE_RECOVERY_TOKEN_MIN_LENGTH ||
    token.length > DEVICE_RECOVERY_TOKEN_MAX_LENGTH
  ) {
    throw new ApiError("validation_failed", "Device recovery token is invalid.");
  }
  return token;
}

function recoveryTokenHash(token: string): string {
  const pepper = process.env.DEVICE_RECOVERY_TOKEN_PEPPER?.trim();
  if (pepper) {
    return createHmac("sha256", pepper).update(token).digest("hex");
  }
  return createHash("sha256").update(token).digest("hex");
}

function sendAccountError(req: Request, res: Response, err: unknown) {
  const apiError =
    err instanceof ApiError
      ? err
      : new ApiError("internal_error", err instanceof Error ? err.message : "Internal error.");
  res.status(apiError.status).json(apiError.envelope(req.requestId));
}

function anonymousRequestUserId(): string {
  const ctx = requestContext.getStore();
  if (!ctx?.publicUserId || !ctx.isAnonymous) {
    throw new ApiError(
      "forbidden",
      "Device recovery is only available for anonymous sessions."
    );
  }
  return ctx.publicUserId;
}

accountRouter.post(
  "/account/anonymous-upgrade-preflight",
  mutation(async ({ auth, body }) => {
    const email = readEmail(body);
    await assertNoUnlinkedInviteCollision(email, auth.actor.id);
    return {
      status: 200,
      body: { ok: true },
    };
  })
);

accountRouter.post("/account/anonymous-device-token", async (req, res) => {
  try {
    const publicUserId = anonymousRequestUserId();
    const tokenHash = recoveryTokenHash(readRecoveryToken(req.body));
    await runQuery(
      "account.registerAnonymousDeviceToken",
      getServiceSupabase()
        .from("anonymous_device_recovery_tokens")
        .upsert(
          {
            token_hash: tokenHash,
            user_id: publicUserId,
            revoked_at: null,
          },
          { onConflict: "token_hash" }
        )
        .select("id")
        .single()
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    sendAccountError(req, res, err);
  }
});

accountRouter.post("/account/anonymous-device-recovery", async (req, res) => {
  try {
    const publicUserId = anonymousRequestUserId();
    const tokenHash = recoveryTokenHash(readRecoveryToken(req.body));
    const rows = await runQuery(
      "account.recoverAnonymousDeviceWorkspace",
      getServiceSupabase().rpc("recover_anonymous_workspace", {
        p_token_hash: tokenHash,
        p_current_user_id: publicUserId,
      })
    );
    const recovery = Array.isArray(rows) ? rows[0] : null;

    res.status(200).json({
      ok: true,
      recovered: Boolean(recovery?.recovered),
      workspaceId: recovery?.workspace_id ?? null,
    });
  } catch (err) {
    sendAccountError(req, res, err);
  }
});

accountRouter.post(
  "/account/anonymous-upgrade-complete",
  mutation(async ({ auth, body }) => {
    const email = readEmail(body);
    await assertNoUnlinkedInviteCollision(email, auth.actor.id);

    await runQuery(
      "account.completeAnonymousUpgrade",
      getServiceSupabase()
        .from("users")
        .update({ email })
        .eq("id", auth.actor.id)
        .select("id")
        .single()
    );

    return {
      status: 200,
      body: { ok: true },
    };
  })
);
