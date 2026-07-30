import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import { ToolRegistry } from "./registry";
import {
  audioTaskForRegistry,
  createAudioDomainFitTool,
  createAudioDomainGenerateTool,
  type AudioDomainFitDeps,
  type AudioDomainToolDeps,
} from "./audio-domain-tools";
import { createGenerateAudioTool } from "./generate-audio";
import { createFitAudioToPictureTool } from "./fit-audio-to-picture";
import type { ToolRegistryDeps } from "./registry-deps";

export interface AudioRegistryProfile {
  task: DomainTaskV1;
  generateAudio?: Partial<AudioDomainToolDeps>;
  fitAudioToPicture?: Partial<AudioDomainFitDeps>;
}

/**
 * Without a profile this remains the PR 3 ownership view. A finite Audio run
 * passes its trusted task and receives task-bound definitions under the same
 * canonical names; the flat default registry is untouched.
 */
export function createAudioToolRegistry(
  deps: ToolRegistryDeps = {},
  profile?: AudioRegistryProfile
): ToolRegistry {
  if (!profile) {
    const registry = new ToolRegistry();
    registry.register(createGenerateAudioTool(deps.generateAudio));
    registry.register(createFitAudioToPictureTool(deps.fitAudioToPicture));
    return registry;
  }
  const task = audioTaskForRegistry(profile.task);
  const registry = new ToolRegistry();
  registry.register(
    createAudioDomainGenerateTool(task, {
      ...deps.generateAudio,
      ...profile.generateAudio,
    })
  );
  registry.register(
    createAudioDomainFitTool(task, {
      ...deps.fitAudioToPicture,
      ...profile.fitAudioToPicture,
    })
  );
  return registry;
}
