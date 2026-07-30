import { createAudioRerunExecutors } from "./rerun-audio-executors";
import { RerunExecutorRegistry } from "./rerun-executor-registry";
import { createVisualStillRerunExecutor } from "./rerun-executors/visual-stills";
import { createRootRerunExecutors } from "./rerun-root-executors";
import { productionRootRerunServices } from "./rerun-root-services";
import { createVideoRerunExecutors } from "./rerun-video-executor";

/**
 * The only production composition point for selective-regeneration adapters.
 * Registry construction fails immediately if two adapters claim the same id;
 * proposal preflight separately requires exactly one adapter per binding.
 */
export function createProductionRerunExecutorRegistry(): RerunExecutorRegistry {
  return new RerunExecutorRegistry([
    createVisualStillRerunExecutor(),
    ...createVideoRerunExecutors(),
    ...createAudioRerunExecutors(),
    ...createRootRerunExecutors(productionRootRerunServices),
  ]);
}

export const productionRerunExecutorRegistry =
  createProductionRerunExecutorRegistry();
