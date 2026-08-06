import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { LlmClient, StructuredVisionImage } from "@/lib/llm";
import { getLlmClient } from "@/lib/llm";
import { materializeAssetObject } from "@/lib/storage/asset-read";
import { contentTypeForFilename } from "@/lib/storage/asset-write";
import { ApiError } from "./errors";
import {
  addProjectAssetCritique,
  createAction,
  getAssetCritiqueSource,
  getProjectAssetCritique,
  updateAction,
  type V1Asset,
} from "./store";
import {
  extractVideoFramesFromPath,
  videoSampleTimes,
} from "./video-frame-sampling";

export const DEFAULT_ASSET_CRITIQUE_QUESTION = "How can we improve upon this?";
export const MAX_ASSET_CRITIQUE_QUESTION_LENGTH = 2_000;

export interface AssetCritiqueAnswer {
  answer: string;
  strengths: string[];
  improvements: string[];
  evidence: string[];
  limitations: string[];
}

export interface AssetCritiqueResponse extends AssetCritiqueAnswer {
  critiqueAssetId: string;
  sourceAssetId: string;
  sourceKind: "script" | "image" | "video";
  question: string;
  provider: string;
  model: string;
}

const critiqueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    improvements: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "strengths", "improvements", "evidence", "limitations"],
};

const systemPrompt = `You are a candid, constructive creative reviewer for scripts, images, and videos.
Answer the user's exact question about the supplied asset. Be specific, practical, and concise.
Separate direct observations from inference. Never claim to have heard audio or reviewed continuous
motion when only sampled video frames are supplied. Suggestions are advisory; do not rewrite or
change the source asset.`;

interface AssetCritiqueDeps {
  getAssetCritiqueSource: typeof getAssetCritiqueSource;
  getProjectAssetCritique: typeof getProjectAssetCritique;
  createAction: typeof createAction;
  updateAction: typeof updateAction;
  addProjectAssetCritique: typeof addProjectAssetCritique;
  getLlmClient: typeof getLlmClient;
  materializeAssetObject: typeof materializeAssetObject;
}

const defaultDeps: AssetCritiqueDeps = {
  getAssetCritiqueSource,
  getProjectAssetCritique,
  createAction,
  updateAction,
  addProjectAssetCritique,
  getLlmClient,
  materializeAssetObject,
};

function reservedUuid(label: string): string {
  const digest = createHash("sha256").update(label).digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export function normalizeAssetCritiqueQuestion(question: unknown): string {
  if (question !== undefined && question !== null && typeof question !== "string") {
    throw new ApiError("validation_failed", "question must be a string.");
  }
  const normalized = typeof question === "string" ? question.trim() : "";
  if (normalized.length > MAX_ASSET_CRITIQUE_QUESTION_LENGTH) {
    throw new ApiError(
      "validation_failed",
      `question must be ${MAX_ASSET_CRITIQUE_QUESTION_LENGTH.toLocaleString()} characters or fewer.`
    );
  }
  return normalized || DEFAULT_ASSET_CRITIQUE_QUESTION;
}

function imageMediaType(filename: string): StructuredVisionImage["mediaType"] {
  const contentType = contentTypeForFilename(filename);
  if (
    contentType === "image/png" ||
    contentType === "image/jpeg" ||
    contentType === "image/webp" ||
    contentType === "image/gif"
  ) {
    return contentType;
  }
  throw new ApiError("asset_invalid", "This image format is not supported for AI feedback.");
}

async function critiqueScript(input: {
  client: LlmClient;
  question: string;
  script: unknown;
}): Promise<AssetCritiqueAnswer> {
  return input.client.structured<AssetCritiqueAnswer>({
    cachedSystem: systemPrompt,
    user: `Question: ${input.question}\n\nActive script snapshot:\n${JSON.stringify(input.script)}`,
    schema: critiqueSchema,
    maxTokens: 2_000,
    effort: "medium",
  });
}

async function critiqueVisual(input: {
  client: LlmClient;
  question: string;
  asset: V1Asset;
  deps: AssetCritiqueDeps;
}): Promise<AssetCritiqueAnswer> {
  if (!input.asset.storageKey || !input.asset.storageBucket) {
    throw new ApiError(
      "asset_invalid",
      "AI feedback needs stored source media. Re-import this asset before requesting feedback."
    );
  }
  const materialized = await input.deps.materializeAssetObject({
    storageKey: input.asset.storageKey,
    storageBucket: input.asset.storageBucket,
  });
  const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), "popcornready-asset-critique-"));
  try {
    let images: StructuredVisionImage[];
    let evidenceNote: string;
    if (input.asset.kind === "image") {
      images = [{ path: materialized.path, mediaType: imageMediaType(input.asset.filename) }];
      evidenceNote = "The complete stored image is attached.";
    } else {
      const times = videoSampleTimes(input.asset.durationSec, 4, 6);
      const frames = await extractVideoFramesFromPath({
        sourcePath: materialized.path,
        outputDir: frameDir,
        timesSec: times,
      });
      images = frames.map((frame) => ({ path: frame.path, mediaType: "image/jpeg" }));
      evidenceNote = `The video is represented by ${frames.length} sampled frames at ${times.join(", ")} seconds. Audio and continuous motion are not attached.`;
    }
    return input.client.structuredVision<AssetCritiqueAnswer>({
      cachedSystem: systemPrompt,
      user: `Question: ${input.question}\n\nAsset metadata: ${JSON.stringify({
        filename: input.asset.filename,
        kind: input.asset.kind,
        durationSec: input.asset.durationSec,
        description: input.asset.description,
        context: input.asset.context,
        evidenceNote,
      })}`,
      images,
      schema: critiqueSchema,
      maxTokens: 2_000,
      effort: "medium",
    });
  } finally {
    await Promise.allSettled([
      materialized.cleanup(),
      fs.rm(frameDir, { recursive: true, force: true }),
    ]);
  }
}

export async function createAssetCritique(input: {
  db: SupabaseClient;
  workspaceId: string;
  projectId: string;
  assetId: string;
  idempotencyKey: string;
  question?: unknown;
  deps?: Partial<AssetCritiqueDeps>;
}): Promise<AssetCritiqueResponse> {
  const deps = { ...defaultDeps, ...input.deps };
  const question = normalizeAssetCritiqueQuestion(input.question);
  const source = await deps.getAssetCritiqueSource({
    db: input.db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    assetId: input.assetId,
  });
  const sourceAssetId = source.kind === "script" ? source.assetId : source.asset.id;
  const invocationIdentity = `${input.workspaceId}\u0000${input.projectId}\u0000${sourceAssetId}\u0000${input.idempotencyKey}`;
  const actionId = reservedUuid(`asset-critique-action\u0000${invocationIdentity}`);
  const critiqueAssetId = reservedUuid(`asset-critique-result\u0000${invocationIdentity}`);
  let sourceKind: AssetCritiqueResponse["sourceKind"];
  let sourceContentHash = "";
  let answer: AssetCritiqueAnswer;
  const client = deps.getLlmClient();
  const action = await deps.createAction({
    id: actionId,
    projectId: input.projectId,
    tool: "critique_asset",
    status: "running",
    params: { source: "receive_feedback", question },
    inputAssetIds: [sourceAssetId],
    rationale: "Answer an advisory question about one exact asset without changing it.",
  }, input.db);

  const replay = await deps.getProjectAssetCritique({
    db: input.db,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    critiqueAssetId,
    sourceAssetId,
    actionId: action.id,
  });
  if (replay) {
    await deps.updateAction(action.id, {
      status: "applied",
      outputAssetIds: [critiqueAssetId],
    }, input.db);
    const saved = replay as Omit<AssetCritiqueResponse, "critiqueAssetId">;
    return { critiqueAssetId, ...saved };
  }

  try {
    if (source.kind === "script") {
      sourceKind = "script";
      sourceContentHash = source.contentHash;
      answer = await critiqueScript({
        client,
        question,
        script: source.script,
      });
    } else {
      const asset = source.asset;
      sourceKind = source.kind;
      sourceContentHash = asset.contentHash ?? "";
      answer = await critiqueVisual({ client, question, asset, deps });
      if (source.kind === "video" && answer.limitations.length === 0) {
        answer.limitations = [
          "This review used sampled frames and did not evaluate audio or continuous motion.",
        ];
      }
    }

    const persisted = await deps.addProjectAssetCritique({
      db: input.db,
      critiqueAssetId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sourceAssetId,
      sourceContentHash,
      actionId: action.id,
      critique: {
        schemaVersion: "assetCritique.v1",
        question,
        sourceAssetId,
        sourceKind,
        sourceContentHash,
        ...answer,
        provider: client.provider,
        model: client.model,
      },
    });
    return {
      critiqueAssetId: persisted.critiqueAssetId,
      sourceAssetId,
      sourceKind,
      question,
      provider: client.provider,
      model: client.model,
      ...answer,
    };
  } catch (error) {
    await deps.updateAction(action.id, {
      status: "failed",
      outputAssetIds: [],
      error: { message: error instanceof Error ? error.message : "Asset critique failed." },
    }, input.db).catch(() => undefined);
    throw error;
  }
}
