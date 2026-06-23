// Stripe wiring for one-time credit top-ups.
//
// The platform is free; users buy credits (1 credit = $0.01) to generate on our
// keys, or bring their own keys. Purchases are one-time Stripe Checkout sessions;
// a webhook credits the ledger on payment. There is NO markup on the purchase —
// $X buys X*100 credits — the platform margin lives entirely in the generation
// debit (cost x margin), see the orchestrator engine.

import Stripe from "stripe";
import { ApiError } from "@/core/errors";

export const CREDIT_PACKS = {
  "10": { usd: 10, credits: 1000 },
  "25": { usd: 25, credits: 2500 },
  "50": { usd: 50, credits: 5000 },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;

export function isCreditPackId(id: string): id is CreditPackId {
  return Object.prototype.hasOwnProperty.call(CREDIT_PACKS, id);
}

let client: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new ApiError("not_implemented", "Credit purchases need STRIPE_SECRET_KEY.");
  }
  if (!client) client = new Stripe(key);
  return client;
}

export function stripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new ApiError("not_implemented", "Stripe webhooks need STRIPE_WEBHOOK_SECRET.");
  }
  return secret;
}

// Where Stripe Checkout returns the user after pay/cancel. Configurable so the
// deployed web origin can be injected; defaults to the local SPA.
export function checkoutReturnUrls(): { success: string; cancel: string } {
  const base = (
    process.env.CREDITS_RETURN_URL ||
    process.env.WEB_ORIGIN ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
  return {
    success: `${base}/library/projects?credits=purchased`,
    cancel: `${base}/library/projects?credits=canceled`,
  };
}
