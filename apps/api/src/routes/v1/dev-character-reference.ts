import { promises as fs } from "node:fs";
import path from "node:path";
import { Router, type RequestHandler } from "express";

import { ApiError } from "@/core/errors";
import { providerFor } from "@/lib/generative/providers";
import { readStorageConfig } from "@/lib/storage/config";
import {
  buildOneShotCharacterDraft,
  oneShotCharacterBinding,
  oneShotCharacterContext,
  oneShotHeroFramePrompt,
} from "@/lib/oneshot/character-reference";
import type { CharacterGenerationContext } from "@popcorn/shared/generative/types";
import { normalizeOpenAIVideoSeconds } from "@popcorn/shared/generative/types";
import type { Clip, GeneratedAssetCharacterBinding } from "@popcorn/shared/types";

export function isCharacterReferenceHarnessEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const flag = String(env.ENABLE_CHARACTER_REFERENCE_HARNESS || "")
    .trim()
    .toLowerCase();
  const enabled = flag === "1" || flag === "true";
  return enabled && env.NODE_ENV !== "production";
}

export const devCharacterReferenceRouter = Router();

function devRoute(
  fn: (req: Parameters<RequestHandler>[0]) => Promise<{ status: number; body: unknown }>
): RequestHandler {
  return async (req, res) => {
    try {
      const result = await fn(req);
      res.status(result.status).json(result.body);
    } catch (err) {
      console.error("[dev/character-reference-video] failed", err);
      const apiError =
        err instanceof ApiError
          ? err
          : new ApiError(
              "internal_error",
              err instanceof Error
                ? err.message
                : "Character reference video harness failed."
            );
      res.status(apiError.status).json(apiError.envelope(req.requestId));
    }
  };
}

function newId(prefix: string): string {
  return `${prefix}_` + Math.random().toString(36).slice(2, 10);
}

function normalizeGeminiSeconds(value: number): number {
  const candidate = Math.round(Number(value));
  if (!Number.isFinite(candidate)) return 4;
  if (candidate <= 4) return 4;
  if (candidate <= 6) return 6;
  return 8;
}

function videoPrompts(characterBrief: string): string[] {
  return [
    [
      "Use the supplied hero-frame image as the visual identity reference.",
      "Create a short cinematic video of the same child protagonist sitting at a desk in a cozy bedroom at night, smiling with creative excitement.",
      `Character brief: ${characterBrief}`,
      "Do not redesign, recast, age-shift, gender-swap, or replace the protagonist.",
      "No text, captions, logos, or extra main characters.",
    ].join(" "),
    [
      "Use the supplied hero-frame image as the visual identity reference.",
      "Create a short cinematic video of the same child protagonist holding a notebook and sketching a movie idea, lit by a laptop glow.",
      `Character brief: ${characterBrief}`,
      "The face, hair, build, skin tone, and wardrobe anchor should match the reference image.",
      "No text, captions, logos, or extra main characters.",
    ].join(" "),
    [
      "Use the supplied hero-frame image as the visual identity reference.",
      "Create a short cinematic video of the same child protagonist proudly looking at a small homemade film set on the bedroom floor.",
      `Character brief: ${characterBrief}`,
      "Preserve the same recognizable child from the hero image across the whole shot.",
      "No text, captions, logos, or extra main characters.",
    ].join(" "),
  ];
}

function harnessStorage() {
  const config = readStorageConfig();
  if (config.backend !== "local") {
    throw new ApiError(
      "validation_failed",
      "Character reference harness requires STORAGE_BACKEND=local."
    );
  }

  const keyPrefix = "generated/harness";
  return {
    dir: path.join(config.localMediaDir, config.publicBucket, keyPrefix),
    urlPrefix: `/${keyPrefix}`,
  };
}

async function writeGeneratedClip(input: {
  id: string;
  filename: string;
  bytes: Buffer;
  kind: "image" | "video";
  durationSec: number;
  description: string;
  provider: string;
  model?: string;
  prompt: string;
  characterContext?: CharacterGenerationContext;
  providerSettings?: GeneratedAssetCharacterBinding["providerSettings"];
}): Promise<Clip> {
  const storage = harnessStorage();
  await fs.mkdir(storage.dir, { recursive: true });
  await fs.writeFile(path.join(storage.dir, input.filename), input.bytes);
  const characterBinding = input.characterContext
    ? oneShotCharacterBinding({
        assetId: input.id,
        context: input.characterContext,
        providerSettings: input.providerSettings,
      })
    : undefined;

  return {
    id: input.id,
    filename: input.filename,
    url: `${storage.urlPrefix}/${input.filename}`,
    kind: input.kind,
    durationSec: input.durationSec,
    description: input.description,
    source: "generated",
    generatedBy: {
      provider: input.provider,
      model: input.model,
      prompt: input.prompt,
      characterBinding,
    },
    characterBinding,
  };
}

// POST /api/v1/dev/character-reference-video
//
// Manual live-generation harness for the character-reference experiment. It is
// mounted only when ENABLE_CHARACTER_REFERENCE_HARNESS is set outside production.
devCharacterReferenceRouter.post(
  "/dev/character-reference-video",
  devRoute(async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const goal = String(
      body.goal ||
        "A 10-year-old movie-loving boy in a bedroom late at night discovers Popcorn Ready and dreams of becoming a filmmaker."
    );
    const style = String(body.style || "cinematic live-action");
    const requestedSeconds = Number(body.seconds) || 2;
    const videoProvider = String(body.videoProvider || "gemini");
    const effectiveSeconds =
      videoProvider === "openai"
        ? normalizeOpenAIVideoSeconds(requestedSeconds)
        : normalizeGeminiSeconds(requestedSeconds);
    const imageProvider = String(body.imageProvider || "openai");
    const imageModel = body.imageModel ? String(body.imageModel) : undefined;
    const videoModel = body.videoModel ? String(body.videoModel) : undefined;

    if (imageProvider !== "openai") {
      throw new ApiError(
        "validation_failed",
        "This harness currently supports imageProvider=openai only."
      );
    }
    if (videoProvider !== "gemini" && videoProvider !== "openai") {
      throw new ApiError("validation_failed", "videoProvider must be gemini or openai.");
    }

    const imagePrompt = oneShotHeroFramePrompt({ goal, style });
    const imageResult = await providerFor("openai").generateAsset({
      provider: "openai",
      kind: "image",
      prompt: imagePrompt,
      model: imageModel,
      size: "1024x1024",
      quality: "low",
    });

    const now = new Date().toISOString();
    const imageId = newId("img");
    const profileId = newId("char");
    const referenceId = newId("ref");
    const imageFilename = `${imageId}_hero.${imageResult.extension}`;
    const storage = harnessStorage();
    const imagePath = path.join(storage.dir, imageFilename);
    const draft = buildOneShotCharacterDraft({
      goal,
      projectId: "debug-character-reference-video",
      profileId,
      referenceId,
      assetId: imageId,
      now,
    });
    const imageContext = oneShotCharacterContext({
      profile: draft.profile,
      reference: draft.reference,
      referencePath: imagePath,
      referenceUrl: `${storage.urlPrefix}/${imageFilename}`,
      originalPrompt: goal,
      providerPrompt: imagePrompt,
    });
    const heroClip = await writeGeneratedClip({
      id: imageId,
      filename: imageFilename,
      bytes: imageResult.bytes,
      kind: "image",
      durationSec: 4,
      description: "Manual harness hero-frame reference.",
      provider: imageResult.provider,
      model: imageResult.model,
      prompt: imageResult.prompt,
      characterContext: imageContext,
      providerSettings: imageResult.providerSettings
        ? {
            provider: imageResult.provider,
            model: imageResult.model,
            ...imageResult.providerSettings,
          }
        : undefined,
    });

    const prompts = videoPrompts(draft.profile.identityInvariants);
    const videoClips: Clip[] = [];
    for (let index = 0; index < prompts.length; index += 1) {
      const prompt = prompts[index];
      const characterContext = oneShotCharacterContext({
        profile: draft.profile,
        reference: draft.reference,
        referencePath: imagePath,
        referenceUrl: heroClip.url,
        originalPrompt: goal,
        providerPrompt: prompt,
      });
      const result =
        videoProvider === "gemini"
          ? await providerFor("gemini").generateAsset({
              provider: "gemini",
              kind: "video",
              prompt,
              model: videoModel,
              size: "1280x720",
              seconds: requestedSeconds,
              referencePaths: [imagePath],
              characterContext,
            })
          : await providerFor("openai").generateAsset({
              provider: "openai",
              kind: "video",
              prompt,
              model: videoModel,
              size: "1280x720",
              seconds: requestedSeconds,
              referencePaths: [imagePath],
              characterContext,
            });
      const id = newId("vid");
      videoClips.push(
        await writeGeneratedClip({
          id,
          filename: `${id}_reference_${index + 1}.${result.extension}`,
          bytes: result.bytes,
          kind: "video",
          durationSec: effectiveSeconds,
          description: `Manual character-reference video ${index + 1}.`,
          provider: result.provider,
          model: result.model,
          prompt: result.prompt,
          characterContext,
          providerSettings: result.providerSettings
            ? {
                provider: result.provider,
                model: result.model,
                ...result.providerSettings,
              }
            : undefined,
        })
      );
    }

    return {
      status: 200,
      body: {
        goal,
        requestedSeconds,
        effectiveSeconds,
        note:
          requestedSeconds !== effectiveSeconds
            ? "Provider duration was normalized to the closest supported low-cost duration."
            : undefined,
        heroImage: heroClip,
        videos: videoClips,
        characterProfile: draft.profile,
        characterReference: draft.reference,
      },
    };
  })
);
