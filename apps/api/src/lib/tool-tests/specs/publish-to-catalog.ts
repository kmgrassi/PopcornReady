import { pendingBattery } from "./_pending";

// Pending: publish_to_catalog has a live handler + unit tests, but the model-in-
// the-loop harness case isn't wired yet (it would need a seeded source asset and
// the system publisher account). Unit coverage lives in
// orchestrator-tools/__tests__/publish-to-catalog.test.ts.
export const publishToCatalogBattery = pendingBattery(
  "publish_to_catalog",
  "Publish the generated character anchor to the shared public catalog so other users can browse and grab it."
);
