import { ApiError } from "@/core/errors";
import { getRequestSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { getServiceSupabaseForStore } from "./store";
import type { GenerativeAssetKind, GenerativeProviderName } from "@popcorn/shared/generative/types";

export const MODEL_SETTING_PURPOSES = [
  "image_generation",
  "video_generation",
  "audio_generation",
  "text_generation",
] as const;

export type ModelSettingPurpose = (typeof MODEL_SETTING_PURPOSES)[number];

export interface WorkspaceModelSetting {
  purpose: ModelSettingPurpose;
  provider: string;
  model: string;
  updatedAt: string;
}

interface WorkspaceModelSettingRow {
  purpose: ModelSettingPurpose;
  provider: string;
  model: string;
  updated_at: string;
}

const PROVIDERS_BY_PURPOSE: Record<ModelSettingPurpose, readonly string[]> = {
  image_generation: ["openai", "ideogram", "gemini", "mock"],
  video_generation: ["openai", "gemini", "runway", "ltx", "nvidia_api_catalog", "mock"],
  audio_generation: ["elevenlabs", "mock"],
  text_generation: ["openai", "anthropic"],
};

const DEFAULT_BY_PURPOSE: Record<
  ModelSettingPurpose,
  { provider: string; model: string }
> = {
  image_generation: { provider: "openai", model: "gpt-image-1.5" },
  video_generation: { provider: "gemini", model: "veo-3.1-generate-preview" },
  audio_generation: { provider: "elevenlabs", model: "eleven_multilingual_v2" },
  text_generation: { provider: "openai", model: "gpt-5" },
};

function getModelSettingsSupabase(backgroundSafe = false) {
  if (!backgroundSafe) return getRequestSupabase();
  try {
    return getRequestSupabase();
  } catch {
    return getServiceSupabaseForStore();
  }
}

export function readModelSettingPurpose(value: unknown): ModelSettingPurpose {
  const purpose = typeof value === "string" ? value.trim().toLowerCase() : "";
  if ((MODEL_SETTING_PURPOSES as readonly string[]).includes(purpose)) {
    return purpose as ModelSettingPurpose;
  }
  throw new ApiError(
    "validation_failed",
    `Unknown model setting purpose "${String(value)}".`
  );
}

export function normalizeModelSettingsProvider(
  purpose: ModelSettingPurpose,
  value: unknown
): string {
  const provider = String(value || "").trim().toLowerCase();
  const normalized =
    provider === "nvidia" || provider === "cosmos" || provider === "cosmos3"
      ? "nvidia_api_catalog"
      : provider;
  if (!PROVIDERS_BY_PURPOSE[purpose].includes(normalized)) {
    throw new ApiError(
      "validation_failed",
      `Provider "${String(value)}" is not supported for ${purpose}.`
    );
  }
  return normalized;
}

export function readModelSettingsBody(
  purpose: ModelSettingPurpose,
  body: unknown
): { provider: string; model: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  const record = body as Record<string, unknown>;
  const provider = normalizeModelSettingsProvider(purpose, record.provider);
  const model = String(record.model || "").trim();
  if (model.length < 2) {
    throw new ApiError("validation_failed", "Choose a model for this purpose.");
  }
  if (model.length > 160) {
    throw new ApiError("validation_failed", "Model names must be 160 characters or fewer.");
  }
  return { provider, model };
}

function toWorkspaceModelSetting(row: WorkspaceModelSettingRow): WorkspaceModelSetting {
  return {
    purpose: row.purpose,
    provider: row.provider,
    model: row.model,
    updatedAt: row.updated_at,
  };
}

export async function listWorkspaceModelSettings(
  workspaceId: string
): Promise<WorkspaceModelSetting[]> {
  const rows = await runQuery(
    "workspaceModelSettings.list",
    getRequestSupabase()
      .from("workspace_model_settings")
      .select("purpose,provider,model,updated_at")
      .eq("workspace_id", workspaceId)
      .order("purpose", { ascending: true })
  );
  return (rows as WorkspaceModelSettingRow[]).map(toWorkspaceModelSetting);
}

export async function upsertWorkspaceModelSetting(input: {
  workspaceId: string;
  purpose: ModelSettingPurpose;
  provider: string;
  model: string;
}): Promise<WorkspaceModelSetting> {
  const row = await runQuery(
    "workspaceModelSettings.upsert",
    getRequestSupabase()
      .from("workspace_model_settings")
      .upsert(
        {
          workspace_id: input.workspaceId,
          purpose: input.purpose,
          provider: input.provider,
          model: input.model,
        },
        { onConflict: "workspace_id,purpose" }
      )
      .select("purpose,provider,model,updated_at")
      .single()
  );
  return toWorkspaceModelSetting(row as WorkspaceModelSettingRow);
}

export async function getWorkspaceModelSetting(
  workspaceId: string,
  purpose: ModelSettingPurpose,
  options: { backgroundSafe?: boolean } = {}
): Promise<WorkspaceModelSetting | null> {
  const rows = await runQuery(
    "workspaceModelSettings.get",
    getModelSettingsSupabase(options.backgroundSafe)
      .from("workspace_model_settings")
      .select("purpose,provider,model,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("purpose", purpose)
      .limit(1)
  );
  const row = (rows as WorkspaceModelSettingRow[])[0];
  return row ? toWorkspaceModelSetting(row) : null;
}

export async function resolveWorkspaceGenerationModel(input: {
  workspaceId: string;
  kind: GenerativeAssetKind;
  explicitProvider?: string;
  explicitModel?: string;
}): Promise<{ provider: GenerativeProviderName; model?: string }> {
  if (input.explicitProvider) {
    return {
      provider: input.explicitProvider as GenerativeProviderName,
      ...(input.explicitModel ? { model: input.explicitModel } : {}),
    };
  }

  const purpose =
    input.kind === "video"
      ? "video_generation"
      : input.kind === "audio"
        ? "audio_generation"
        : "image_generation";

  const fallback = DEFAULT_BY_PURPOSE[purpose];
  let setting: WorkspaceModelSetting | null = null;
  try {
    setting = await getWorkspaceModelSetting(input.workspaceId, purpose, {
      backgroundSafe: true,
    });
  } catch {
    setting = null;
  }
  return {
    provider: (setting?.provider ?? fallback.provider) as GenerativeProviderName,
    model: input.explicitModel ?? setting?.model ?? fallback.model,
  };
}

export function defaultModelSettings(): WorkspaceModelSetting[] {
  const now = new Date(0).toISOString();
  return MODEL_SETTING_PURPOSES.map((purpose) => ({
    purpose,
    provider: DEFAULT_BY_PURPOSE[purpose].provider,
    model: DEFAULT_BY_PURPOSE[purpose].model,
    updatedAt: now,
  }));
}
