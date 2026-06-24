import type { AssetKind, ModelSettingPurpose } from "./api-client";

export interface ModelProviderOption {
  id: string;
  label: string;
  models: string[];
}

export interface ModelPurposeConfig {
  id: ModelSettingPurpose;
  label: string;
  description: string;
  icon: "image" | "video" | "audio" | "text";
  providers: ModelProviderOption[];
}

export const MODEL_PURPOSES: ModelPurposeConfig[] = [
  {
    id: "image_generation",
    label: "Image generation",
    description: "Keyframes, storyboards, posters, and generated still assets.",
    icon: "image",
    providers: [
      { id: "ideogram", label: "Ideogram", models: ["ideogram-v4", "ideogram-v3"] },
      { id: "openai", label: "OpenAI", models: ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"] },
      { id: "gemini", label: "Gemini", models: ["gemini-2.5-flash-image"] },
      { id: "xai", label: "xAI", models: ["grok-imagine-image-quality"] },
      { id: "mock", label: "Mock", models: ["mock-image"] },
    ],
  },
  {
    id: "video_generation",
    label: "Video generation",
    description: "Generated clips and motion assets.",
    icon: "video",
    providers: [
      { id: "gemini", label: "Gemini", models: ["veo-3.1-generate-preview"] },
      { id: "openai", label: "OpenAI", models: ["sora-2"] },
      { id: "runway", label: "Runway", models: ["gen4.5"] },
      { id: "ltx", label: "LTX", models: ["ltx-2-3-fast"] },
      { id: "kling", label: "Kling", models: ["kling-v3"] },
      {
        id: "seedance",
        label: "Seedance",
        models: ["bytedance/seedance-2.0/text-to-video", "bytedance/seedance-2.0/image-to-video"],
      },
      { id: "xai", label: "xAI", models: ["grok-imagine-video", "grok-imagine-video-1.5"] },
      { id: "nvidia_api_catalog", label: "NVIDIA API Catalog", models: ["nvidia/cosmos3-nano"] },
      { id: "mock", label: "Mock", models: ["mock-video"] },
    ],
  },
  {
    id: "audio_generation",
    label: "Audio generation",
    description: "Voiceover, dialogue, sound effects, and soundtrack generation.",
    icon: "audio",
    providers: [
      {
        id: "elevenlabs",
        label: "ElevenLabs",
        models: ["eleven_multilingual_v2", "eleven_v3", "eleven_text_to_sound_v2", "music_v1"],
      },
      { id: "mock", label: "Mock", models: ["mock-audio"] },
    ],
  },
  {
    id: "text_generation",
    label: "Text generation",
    description: "Planning, scripts, critiques, orchestration, and other language tasks.",
    icon: "text",
    providers: [
      { id: "openai", label: "OpenAI", models: ["gpt-5", "gpt-5-mini"] },
      { id: "anthropic", label: "Anthropic", models: ["claude-opus-4-7", "claude-haiku-4-5"] },
    ],
  },
];

export function modelPurposeForAssetKind(
  kind: AssetKind | "caption" | "timeline" | "export" | string
): ModelSettingPurpose | null {
  if (kind === "image") return "image_generation";
  if (kind === "video") return "video_generation";
  if (kind === "audio") return "audio_generation";
  return null;
}

export function modelPurposeConfig(purpose: ModelSettingPurpose): ModelPurposeConfig {
  return MODEL_PURPOSES.find((candidate) => candidate.id === purpose) ?? MODEL_PURPOSES[0];
}

export function providerConfig(purpose: ModelPurposeConfig, provider: string): ModelProviderOption {
  return purpose.providers.find((candidate) => candidate.id === provider) ?? purpose.providers[0];
}
