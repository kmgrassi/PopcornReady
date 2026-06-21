import type { Router } from "express";
import { accountRouter } from "./account.js";
import { assetGraphRouter } from "./asset-graph.js";
import { assetsRouter } from "./assets.js";
import { beatsRouter } from "./beats.js";
import { briefRouter } from "./brief.js";
import { catalogProtectedRouter } from "./catalog.js";
import { evalRouter } from "./eval.js";
import { meRouter } from "./me.js";
import { miscCapabilitiesRouter } from "./misc-capabilities.js";
import { orchestratorRunsRouter } from "./orchestrator-runs.js";
import { planRouter } from "./plan.js";
import { projectsRouter } from "./projects.js";
import { storyboardsRouter } from "./storyboards.js";
import { studioDraftsRouter } from "./studio-drafts.js";
import { studioPlanningRouter } from "./studio-planning.js";
import { timelinesRouter } from "./timelines.js";
import { workspacesRouter } from "./workspaces.js";

export function mountProtectedV1Routes(v1: Router) {
  v1.use(accountRouter);
  v1.use(meRouter);
  v1.use(projectsRouter);
  v1.use(workspacesRouter);
  v1.use(assetGraphRouter);
  v1.use(assetsRouter);
  v1.use(beatsRouter);
  v1.use(briefRouter);
  v1.use(catalogProtectedRouter);
  v1.use(miscCapabilitiesRouter);
  v1.use(planRouter);
  v1.use(storyboardsRouter);
  v1.use(orchestratorRunsRouter);
  v1.use(studioDraftsRouter);
  v1.use(studioPlanningRouter);
  v1.use(timelinesRouter);
  v1.use(evalRouter);
}
