import type { Router } from "express";
import { catalogPublicRouter } from "./catalog.js";
import { creditsWebhookRouter } from "./credits-webhook.js";
import {
  devCharacterReferenceRouter,
  isCharacterReferenceHarnessEnabled,
} from "./dev-character-reference.js";
import { devToolTestsRouter, isToolTestHarnessEnabled } from "./dev-tool-tests.js";
import { devWebE2ERouter, isWebE2EHarnessEnabled } from "./dev-web-e2e.js";
import { discoverRouter } from "./discover.js";
import { healthRouter } from "./health.js";

export function mountPublicV1Routes(v1: Router) {
  v1.use(healthRouter);
  v1.use(discoverRouter);
  v1.use(catalogPublicRouter);
  v1.use(creditsWebhookRouter);

  // Dev-only, flag-gated tool-call test harness. Never mounted in production.
  if (isToolTestHarnessEnabled()) {
    v1.use(devToolTestsRouter);
  }

  // Dev-only, flag-gated browser fixture lifecycle. Never mounted in production.
  if (isWebE2EHarnessEnabled()) {
    v1.use(devWebE2ERouter);
  }

  // Dev-only live-generation character-reference harness. Never mounted in production.
  if (isCharacterReferenceHarnessEnabled()) {
    v1.use(devCharacterReferenceRouter);
  }
}
