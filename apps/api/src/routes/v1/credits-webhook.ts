// Stripe webhook: credits the ledger when a credit-pack Checkout is paid.
//
// PUBLIC route, authenticated by the Stripe signature (verified against the raw
// body), not a user session — so it is a plain Express handler that bypasses the
// resolveAuth adapter (which would 401 an unauthenticated request in supabase
// mode). Crediting is idempotent on the Stripe event id, so Stripe's
// at-least-once delivery never double-credits.

import { Router, type Request, type Response } from "express";
import type Stripe from "stripe";
import { applyCreditTransaction } from "@/lib/api/v1/credits";
import { getStripe, stripeWebhookSecret } from "@/lib/billing/stripe";
import { rootLogger } from "@/lib/v1/logger";

export const creditsWebhookRouter = Router();

creditsWebhookRouter.post(
  "/credits/webhook",
  async (req: Request & { rawBody?: string }, res: Response) => {
    const signature = req.header("stripe-signature");
    const raw = req.rawBody;
    if (!signature || raw === undefined) {
      res.status(400).json({ error: "Missing Stripe signature or body." });
      return;
    }

    // Verify against the EXACT bytes Stripe signed (server.ts captures rawBody).
    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(raw, signature, stripeWebhookSecret());
    } catch (err) {
      res.status(400).json({
        error: `Signature verification failed: ${err instanceof Error ? err.message : "unknown"}`,
      });
      return;
    }

    try {
      // Immediate methods (card): `completed` arrives already paid. Delayed
      // methods (ACH/SEPA): `completed` arrives unpaid, then
      // `async_payment_succeeded` once funds settle — so fulfill on whichever
      // signals payment. Keyed on the session id (not the event id) so neither
      // redelivery nor the completed+async pair credits a purchase twice.
      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
      ) {
        const session = event.data.object as Stripe.Checkout.Session;
        const paid =
          event.type === "checkout.session.async_payment_succeeded" ||
          session.payment_status === "paid";
        const userId = session.metadata?.userId;
        const credits = Number(session.metadata?.credits ?? 0);
        if (paid && userId && credits > 0) {
          await applyCreditTransaction({
            userId,
            deltaCredits: credits,
            reason: "purchase",
            idempotencyKey: `stripe:checkout:${session.id}`,
            metadata: {
              stripeSessionId: session.id,
              stripeEventId: event.id,
              pack: session.metadata?.pack,
            },
          });
          rootLogger.info("credits_purchased", {
            metadata: { userId, credits, sessionId: session.id },
          });
        }
      }
      // Always 2xx for handled/ignored events so Stripe stops retrying.
      res.status(200).json({ received: true });
    } catch (err) {
      rootLogger.error("credits_webhook_error", {
        error: { message: err instanceof Error ? err.message : String(err) },
      });
      res.status(500).json({ error: "Webhook processing failed." });
    }
  }
);
