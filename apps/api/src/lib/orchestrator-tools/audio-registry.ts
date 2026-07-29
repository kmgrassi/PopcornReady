import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { DefaultToolRegistryDeps } from "./default-registry";
import { createOwnedToolRegistry } from "./owned-registry";
import { ToolRegistry } from "./registry";
import {
  audioTaskForRegistry,
  createAudioDomainFitTool,
  createAudioDomainGenerateTool,
  type AudioDomainFitDeps,
  type AudioDomainToolDeps,
} from "./audio-domain-tools";

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
  deps: DefaultToolRegistryDeps = {},
  profile?: AudioRegistryProfile
): ToolRegistry {
  if (!profile) return createOwnedToolRegistry("audio", deps);
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
