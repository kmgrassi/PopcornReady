import { Router } from "express";
import { mutation } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";

export const accountRouter = Router();

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
