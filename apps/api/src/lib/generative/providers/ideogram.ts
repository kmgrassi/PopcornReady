import type {
  GenerateAssetRequest,
  GeneratedAssetResult,
  GenerativeProvider,
  IdeogramImageModel,
  IdeogramMagicPrompt,
  IdeogramRenderingSpeed,
  IdeogramStyleType,
} from "@popcorn/shared/generative/types";
import { estimateCostUsd } from "../pricing";
import {
  characterProviderSettings,
  readAsBlob,
  requirePrompt,
} from "./shared";

const IDEOGRAM_BASE_URL = "https://api.ideogram.ai";
const IDEOGRAM_DEFAULT_IMAGE_MODEL: IdeogramImageModel = "ideogram-v4";

interface IdeogramImageObject {
  prompt?: string;
  resolution?: string;
  is_image_safe?: boolean;
  seed?: number;
  url?: string;
  style_type?: string;
}

interface IdeogramGenerateResponse {
  created?: string;
  data?: IdeogramImageObject[];
  response_type?: string;
}

interface IdeogramImageOptions {
  model: string;
  prompt: string;
  resolution?: string;
  aspectRatio?: string;
  renderingSpeed?: IdeogramRenderingSpeed;
  magicPrompt?: IdeogramMagicPrompt;
  negativePrompt?: string;
  numImages?: number;
  seed?: number;
  styleType?: IdeogramStyleType;
  stylePreset?: string;
  customModelUri?: string;
  enableCopyrightDetection?: boolean;
}

function normalizeIdeogramModel(model?: string): IdeogramImageModel {
  const value = (model || IDEOGRAM_DEFAULT_IMAGE_MODEL).trim().toLowerCase();
  if (value === "v4" || value === "4" || value === "ideogram-4" || value === "ideogram-v4") {
    return "ideogram-v4";
  }
  if (value === "v3" || value === "3" || value === "ideogram-3" || value === "ideogram-v3") {
    return "ideogram-v3";
  }
  return value.includes("v3") || value.includes("3.0") ? "ideogram-v3" : "ideogram-v4";
}

function endpointForModel(model: IdeogramImageModel): string {
  return model === "ideogram-v3"
    ? "/v1/ideogram-v3/generate"
    : "/v1/ideogram-v4/generate";
}

function normalizeSpeed(value?: string): IdeogramRenderingSpeed | undefined {
  const upper = value?.trim().toUpperCase();
  return upper === "FLASH" ||
    upper === "TURBO" ||
    upper === "DEFAULT" ||
    upper === "QUALITY"
    ? upper
    : undefined;
}

function normalizeMagicPrompt(value?: string): IdeogramMagicPrompt | undefined {
  const upper = value?.trim().toUpperCase();
  return upper === "AUTO" || upper === "ON" || upper === "OFF" ? upper : undefined;
}

function normalizeStyleType(value?: string): IdeogramStyleType | undefined {
  const upper = value?.trim().toUpperCase();
  return upper === "AUTO" ||
    upper === "GENERAL" ||
    upper === "REALISTIC" ||
    upper === "DESIGN" ||
    upper === "FICTION"
    ? upper
    : undefined;
}

function positiveInteger(value?: number): number | undefined {
  if (value === undefined) return undefined;
  const rounded = Math.round(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : undefined;
}

export function buildIdeogramImageOptions(
  input: Extract<GenerateAssetRequest, { provider: "ideogram"; kind: "image" }>
): IdeogramImageOptions {
  return {
    model: normalizeIdeogramModel(input.model),
    prompt: requirePrompt(input.prompt),
    resolution: input.resolution || input.size,
    aspectRatio: input.aspectRatio,
    renderingSpeed: normalizeSpeed(input.renderingSpeed),
    magicPrompt: normalizeMagicPrompt(input.magicPrompt),
    negativePrompt: input.negativePrompt,
    numImages: positiveInteger(input.numImages),
    seed: positiveInteger(input.seed),
    styleType: normalizeStyleType(input.styleType),
    stylePreset: input.stylePreset,
    customModelUri: input.customModelUri,
    enableCopyrightDetection: input.enableCopyrightDetection,
  };
}

function addOptional(form: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  form.set(key, String(value));
}

async function buildIdeogramForm(
  input: Extract<GenerateAssetRequest, { provider: "ideogram"; kind: "image" }>,
  options: IdeogramImageOptions
): Promise<FormData> {
  const form = new FormData();
  const model = normalizeIdeogramModel(options.model);

  if (model === "ideogram-v4") {
    form.set("text_prompt", options.prompt);
    addOptional(form, "resolution", options.resolution);
    addOptional(form, "rendering_speed", options.renderingSpeed);
    addOptional(form, "enable_copyright_detection", options.enableCopyrightDetection);
    return form;
  }

  form.set("prompt", options.prompt);
  addOptional(form, "resolution", options.resolution);
  addOptional(form, "aspect_ratio", options.aspectRatio);
  addOptional(form, "rendering_speed", options.renderingSpeed);
  addOptional(form, "magic_prompt", options.magicPrompt);
  addOptional(form, "negative_prompt", options.negativePrompt);
  addOptional(form, "num_images", options.numImages);
  addOptional(form, "seed", options.seed);
  addOptional(form, "style_type", options.styleType);
  addOptional(form, "style_preset", options.stylePreset);
  addOptional(form, "custom_model_uri", options.customModelUri);
  addOptional(form, "enable_copyright_detection", options.enableCopyrightDetection);

  for (const filePath of input.referencePaths || []) {
    form.append("character_reference_images", await readAsBlob(filePath));
  }

  return form;
}

async function ideogramFetch(pathName: string, init: RequestInit): Promise<Response> {
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) throw new Error("IDEOGRAM_API_KEY is not set for the Ideogram provider.");

  const headers = new Headers(init.headers);
  headers.set("Api-Key", apiKey);

  const response = await fetch(`${IDEOGRAM_BASE_URL}${pathName}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ideogram request failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return response;
}

async function downloadImage(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ideogram image download failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") || "image/png",
  };
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

async function generateIdeogramImage(
  input: Extract<GenerateAssetRequest, { provider: "ideogram"; kind: "image" }>
): Promise<GeneratedAssetResult> {
  const options = buildIdeogramImageOptions(input);
  const model = normalizeIdeogramModel(options.model);
  const form = await buildIdeogramForm(input, options);
  const response = await ideogramFetch(endpointForModel(model), {
    method: "POST",
    body: form,
  });
  const data = (await response.json()) as IdeogramGenerateResponse;
  const image = data.data?.[0];
  if (!image?.url) {
    throw new Error("Ideogram image generation returned no image URL.");
  }

  const downloaded = await downloadImage(image.url);
  return {
    kind: "image",
    bytes: downloaded.bytes,
    extension: extensionForMime(downloaded.mimeType),
    mimeType: downloaded.mimeType,
    provider: "ideogram",
    model,
    prompt: image.prompt || options.prompt,
    costUsd: estimateCostUsd({ provider: "ideogram", kind: "image", model }),
    providerSettings: characterProviderSettings(input),
  };
}

export const ideogramProvider: GenerativeProvider = {
  name: "ideogram",
  async generateAsset(input) {
    if (input.provider !== "ideogram") {
      throw new Error("Ideogram provider received a non-ideogram request.");
    }
    if (input.kind === "image") return generateIdeogramImage(input);
    throw new Error("Ideogram provider supports image generation only.");
  },
};
