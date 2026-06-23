import type { GenerativeProvider } from "@popcorn/shared/generative/types";
import { elevenLabsProvider } from "./providers/elevenlabs";
import { geminiProvider } from "./providers/gemini";
import { ideogramProvider } from "./providers/ideogram";
import { klingProvider } from "./providers/kling";
import { ltxProvider } from "./providers/ltx";
import { mockProvider, unsupportedProvider } from "./providers/mock";
import { nvidiaCosmosProvider } from "./providers/nvidia-cosmos";
import { openAIProvider } from "./providers/openai";
import { runwayProvider } from "./providers/runway";
import { seedanceProvider } from "./providers/seedance";
import { xaiProvider } from "./providers/xai";

export { downloadOpenAIVideoById, getOpenAIVideoById } from "./providers/openai";

export function providerFor(name: string): GenerativeProvider {
  switch (name.toLowerCase()) {
    case "openai":
      return openAIProvider;
    case "ideogram":
      return ideogramProvider;
    case "gemini":
      return geminiProvider;
    case "runway":
    case "runwayml":
      return runwayProvider;
    case "ltx":
    case "ltxvideo":
    case "ltx-video":
      return ltxProvider;
    case "kling":
    case "klingai":
    case "kling-ai":
      return klingProvider;
    case "seedance":
    case "seedance2":
    case "seedance-2":
    case "seedance-2.0":
      return seedanceProvider;
    case "xai":
    case "grok":
    case "grok-imagine":
      return xaiProvider;
    case "nvidia":
    case "nvidia_api_catalog":
    case "nvidia-api-catalog":
    case "cosmos":
    case "cosmos3":
    case "cosmos3-nano":
      return nvidiaCosmosProvider;
    case "elevenlabs":
      return elevenLabsProvider;
    case "nanobanano":
    case "nano-banano":
    case "nano_banano":
      return unsupportedProvider("nanobanano");
    case "mock":
      return mockProvider;
    default:
      throw new Error(`Unknown generative provider: ${name}`);
  }
}
