import { Router, type Request, type RequestHandler } from "express";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { ApiError } from "@/core/errors";
import { createGeneratedAsset } from "@/lib/api/v1/generated-assets";
import { resolveWorkspaceGenerationModel } from "@/lib/api/v1/model-settings";
import { posterTextMentionsMinor } from "@/lib/api/v1/poster-generation";
import { authMode, type AuthContext } from "@/lib/api/v1/auth";
import type { V1Job } from "@/lib/api/v1/jobs";
import { setAssetVisibility } from "@/lib/api/v1/store";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { remoteAssetUrlForDelivery, resolveAssetUrl } from "@/lib/storage/asset-urls";
import {
  rankStoryConcepts,
  INSPIRATION_INGREDIENT_GROUPS,
  type InspirationCandidate,
  type InspirationIngredientSummary,
} from "@/lib/agent/inspiration";

type StoryElementCategory =
  | "plot_type"
  | "setting"
  | "character_arc"
  | "belief_shift"
  | "structure"
  | "antagonist_type"
  | "stakes"
  | "theme";

interface StoryElementRow {
  id: string;
  category_slug: StoryElementCategory;
  group_slug: string | null;
  slug: string;
  name: string;
  core_idea: string | null;
  is_featured: boolean;
}

interface InspirationElement {
  id: string;
  category: StoryElementCategory;
  groupSlug: string | null;
  slug: string;
  name: string;
  coreIdea: string | null;
}

// The model authors the prose (title/logline/premise) and a per-ingredient
// emoji + summary; the `elements` keep the provenance back to the catalog.
interface RandomStoryInspiration {
  movieTitle: string;
  logline: string;
  premise: string;
  // HMAC over the prose + element provenance, minted when /random serves the
  // concept. /poster re-verifies it so this public endpoint only ever generates
  // posters for concepts WE authored — not arbitrary client-supplied prompts.
  signature: string;
  ingredients: Record<InspirationElementGroup, InspirationIngredientSummary>;
  elements: {
    plot: InspirationElement[];
    setting: InspirationElement[];
    arc: InspirationElement[];
    antagonist: InspirationElement[];
    theme: InspirationElement[];
    stakes: InspirationElement[];
    structure: InspirationElement[];
  };
  poster?: StoryConceptPoster;
}

type InspirationElementGroup = keyof RandomStoryInspiration["elements"];
type InspirationElements = RandomStoryInspiration["elements"];

interface StoryConceptPoster {
  status: "queued" | "generating" | "ready" | "failed";
  url: string | null;
  assetId: string | null;
  prompt: string;
}

const CATEGORIES: StoryElementCategory[] = [
  "plot_type",
  "setting",
  "character_arc",
  "belief_shift",
  "structure",
  "antagonist_type",
  "stakes",
  "theme",
];

const ELEMENT_GROUPS: InspirationElementGroup[] = [...INSPIRATION_INGREDIENT_GROUPS];

const SYSTEM_WORKSPACE_ID = "00000000-0000-4000-a000-000000000002";
const INSPIRATION_POSTER_CACHE_PROJECT_ID = "00000000-0000-4000-a000-000000000003";

// How many concepts the model develops + ranks per batch. The winner is served
// immediately; the runners-up are handed out on the next few requests.
const BATCH_SIZE = 5;
// In-memory only: a redeploy or second instance just triggers a fresh batch.
const BUFFER_TTL_MS = 15 * 60 * 1000;
let inspirationBuffer: RandomStoryInspiration[] = [];
let inspirationBufferedAt = 0;

export const inspirationRouter = Router();

// Inspiration is a public, unauthenticated surface (linked from the landing
// page), so it mounts before authMiddleware and must NOT go through the
// auth-resolving route()/mutation() adapter — that throws 401 for anonymous
// callers in AUTH_MODE=supabase. This thin wrapper mirrors the discover feed.
type PublicResult = { status: number; body: unknown; headers?: Record<string, string> };

function publicEndpoint(fn: (req: Request) => Promise<PublicResult>): RequestHandler {
  return async (req, res) => {
    try {
      const result = await fn(req);
      for (const [name, value] of Object.entries(result.headers ?? {})) {
        res.setHeader(name, value);
      }
      res.status(result.status).json(result.body);
    } catch (err) {
      const apiError =
        err instanceof ApiError
          ? err
          : new ApiError("internal_error", err instanceof Error ? err.message : "Internal error.");
      res.status(apiError.status).json(apiError.envelope(req.requestId));
    }
  };
}

inspirationRouter.get(
  "/inspiration/random",
  publicEndpoint(async () => {
    const inspiration = await nextInspiration();
    return {
      status: 200,
      body: { inspiration },
      headers: { "Cache-Control": "no-store" },
    };
  })
);

inspirationRouter.post(
  "/inspiration/poster",
  publicEndpoint(async (req) => {
    const inspiration = await parsePosterInspiration(req.body);
    // Only the hosted (supabase) deployment spends real image-generation
    // credits; local/hybrid dev returns a queued placeholder.
    const concept = await ensureStoryConceptPoster(inspiration, {
      allowGeneration: authMode() === "supabase",
    });
    return {
      status: concept.poster.status === "ready" ? 200 : 202,
      body: concept,
      headers: { "Cache-Control": "no-store" },
    };
  })
);

// Serve the next ranked concept: pop a warm runner-up, or generate a fresh
// batch when the buffer is empty or stale.
async function nextInspiration(): Promise<RandomStoryInspiration> {
  if (inspirationBuffer.length && Date.now() - inspirationBufferedAt < BUFFER_TTL_MS) {
    return inspirationBuffer.shift() as RandomStoryInspiration;
  }
  const batch = await generateRankedBatch(BATCH_SIZE);
  const [best, ...rest] = batch;
  inspirationBuffer = rest;
  inspirationBufferedAt = Date.now();
  return best;
}

// Draw `count` random ingredient sets, have the model develop + rank them, and
// stitch the prose back onto each set's catalog elements (best-first).
async function generateRankedBatch(count: number): Promise<RandomStoryInspiration[]> {
  const rows = await listStoryElements();
  const sets = Array.from({ length: count }, () => pickIngredientSet(rows));
  const ranked = await rankStoryConcepts(sets.map(toCandidate));
  return ranked.map((concept) => {
    const base = {
      movieTitle: concept.movieTitle,
      logline: concept.logline,
      premise: concept.premise,
      ingredients: concept.ingredients,
      elements: sets[concept.index],
    };
    return { ...base, signature: signConcept(base) };
  });
}

async function listStoryElements(): Promise<StoryElementRow[]> {
  // Global reference catalog only: no workspace/project rows are returned here.
  // Local auth mode does not create a request-scoped Supabase client, so use the
  // service client and keep the query constrained to public story_elements.
  const db = getServiceSupabase();
  const rows = await runQuery(
    "inspiration.listStoryElements",
    db
      .from("story_elements")
      .select(
        "id,group_slug,slug,name,core_idea,is_featured,story_element_categories!inner(slug)"
      )
      .in("story_element_categories.slug", CATEGORIES)
      .order("sort_order", { ascending: true })
  );

  return (rows as unknown[]).map((row) => {
    const record = row as {
      id: string;
      group_slug: string | null;
      slug: string;
      name: string;
      core_idea: string | null;
      is_featured: boolean;
      story_element_categories:
        | { slug: StoryElementCategory }
        | { slug: StoryElementCategory }[];
    };
    const category = Array.isArray(record.story_element_categories)
      ? record.story_element_categories[0]
      : record.story_element_categories;
    return {
      id: record.id,
      category_slug: category.slug,
      group_slug: record.group_slug,
      slug: record.slug,
      name: record.name,
      core_idea: record.core_idea,
      is_featured: record.is_featured,
    };
  });
}

// Pick one random set of catalog ingredients. Selection is unchanged from the
// previous template generator; only the prose stage moved to the model.
function pickIngredientSet(rows: StoryElementRow[]): InspirationElements {
  const grouped = groupByCategory(rows);
  const plot = pickMany(preferred(grouped.plot_type, "competition"), 2);
  const timeSetting = pickOne(preferred(grouped.setting, "time_settings"));
  const placeSetting = pickOne([
    ...preferred(grouped.setting, "place_settings"),
    ...preferred(grouped.setting, "world_scale_settings"),
  ]);
  const arc = pickOne(grouped.character_arc);
  const beliefShift = pickOne(grouped.belief_shift);
  const antagonist = pickMany(grouped.antagonist_type, 2);
  const theme = pickMany(grouped.theme, 2);
  const stakes = pickMany(grouped.stakes, 3);
  const structure = pickOne(preferred(grouped.structure, "competition"));

  return {
    plot: plot.map(toElement),
    setting: [timeSetting, placeSetting].map(toElement),
    arc: [arc, beliefShift].filter(Boolean).map(toElement),
    antagonist: antagonist.map(toElement),
    theme: theme.map(toElement),
    stakes: stakes.map(toElement),
    structure: [structure].map(toElement),
  };
}

function toCandidate(elements: InspirationElements): InspirationCandidate {
  const brief = (els: InspirationElement[]) =>
    els.map((el) => ({ name: el.name, coreIdea: el.coreIdea }));
  return {
    plot: brief(elements.plot),
    setting: brief(elements.setting),
    arc: brief(elements.arc),
    antagonist: brief(elements.antagonist),
    theme: brief(elements.theme),
    stakes: brief(elements.stakes),
    structure: brief(elements.structure),
  };
}

async function parsePosterInspiration(body: unknown): Promise<RandomStoryInspiration> {
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  const rawInspiration = record.inspiration;
  if (!rawInspiration || typeof rawInspiration !== "object" || Array.isArray(rawInspiration)) {
    throw new ApiError("validation_failed", "inspiration is required.");
  }

  const input = rawInspiration as Record<string, unknown>;
  const rows = await listStoryElements();
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const selectedRows = parseSelectedElementRows(input.elements, rowsById);

  const built: SignableConcept = {
    movieTitle: requireString(input, "movieTitle"),
    logline: requireString(input, "logline"),
    premise: typeof input.premise === "string" ? input.premise.slice(0, 4000) : "",
    elements: {
      plot: selectedRows.plot.map(toElement),
      setting: selectedRows.setting.map(toElement),
      arc: selectedRows.arc.map(toElement),
      antagonist: selectedRows.antagonist.map(toElement),
      theme: selectedRows.theme.map(toElement),
      stakes: selectedRows.stakes.map(toElement),
      structure: selectedRows.structure.map(toElement),
    },
  };

  // The prose feeds a system-account image prompt, so it must be one WE
  // authored: reject anything whose signature does not match the served concept.
  if (!verifyConceptSignature(built, input.signature)) {
    throw new ApiError("validation_failed", "inspiration.signature is missing or invalid.");
  }

  return {
    ...built,
    signature: input.signature as string,
    ingredients: parseIngredients(input.ingredients),
  };
}

function parseSelectedElementRows(
  rawElements: unknown,
  rowsById: Map<string, StoryElementRow>
): Record<InspirationElementGroup, StoryElementRow[]> {
  if (!rawElements || typeof rawElements !== "object" || Array.isArray(rawElements)) {
    throw new ApiError("validation_failed", "inspiration.elements is required.");
  }
  const rawByGroup = rawElements as Record<string, unknown>;
  const selected = {} as Record<InspirationElementGroup, StoryElementRow[]>;

  for (const group of ELEMENT_GROUPS) {
    const rawGroup = rawByGroup[group];
    if (!Array.isArray(rawGroup) || rawGroup.length === 0) {
      throw new ApiError("validation_failed", `inspiration.elements.${group} is required.`);
    }
    selected[group] = rawGroup.map((item) => {
      const id = item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>).id
        : null;
      if (typeof id !== "string") {
        throw new ApiError("validation_failed", `inspiration.elements.${group} contains an invalid element.`);
      }
      const row = rowsById.get(id);
      if (!row || !elementGroupAllowsCategory(group, row.category_slug)) {
        throw new ApiError("validation_failed", `inspiration.elements.${group} contains an unknown element.`);
      }
      return row;
    });
  }

  return selected;
}

function elementGroupAllowsCategory(
  group: InspirationElementGroup,
  category: StoryElementCategory
): boolean {
  if (group === "plot") return category === "plot_type";
  if (group === "setting") return category === "setting";
  if (group === "arc") return category === "character_arc" || category === "belief_shift";
  if (group === "antagonist") return category === "antagonist_type";
  return group === category;
}

function requireString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("validation_failed", `inspiration.${field} is required.`);
  }
  return value.slice(0, 4000);
}

function parseIngredients(
  raw: unknown
): Record<InspirationElementGroup, InspirationIngredientSummary> {
  const record = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const result = {} as Record<InspirationElementGroup, InspirationIngredientSummary>;
  for (const group of ELEMENT_GROUPS) {
    const value = record[group];
    const obj = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
    result[group] = {
      emoji: typeof obj.emoji === "string" ? obj.emoji.slice(0, 8) : "",
      summary: typeof obj.summary === "string" ? obj.summary.slice(0, 200) : "",
    };
  }
  return result;
}

function conceptElementEntries(inspiration: RandomStoryInspiration) {
  return Object.entries(inspiration.elements)
    .flatMap(([group, elements]) =>
      elements.map((element, index) => ({
        element,
        role: roleForElement(group, element),
        position: index,
      }))
    )
    .filter((entry) => entry.element.id);
}

function roleForElement(group: string, element: InspirationElement): string {
  if (element.category === "belief_shift") return "belief_shift";
  if (element.category === "character_arc") return "arc";
  if (element.category === "antagonist_type") return "antagonist_type";
  if (group === "plot") return "plot";
  if (group === "setting") return "setting";
  if (group === "structure") return "structure";
  if (group === "theme") return "theme";
  if (group === "stakes") return "stakes";
  return group;
}

function conceptKeyFor(inspiration: RandomStoryInspiration, promptHash: string): string {
  const elementKey = conceptElementEntries(inspiration)
    .map(({ element, role, position }) => `${role}:${position}:${element.slug || element.id}`)
    .sort()
    .join("|");
  return `${elementKey}|prompt:${normalizeKeyPart(inspiration.logline)}|${promptHash}`;
}

function normalizeKeyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// The signed surface: prose that lands in the poster prompt + element provenance.
type SignableConcept = Pick<
  RandomStoryInspiration,
  "movieTitle" | "logline" | "premise" | "elements"
>;

// Server-only HMAC key. Always present in the hosted (supabase) deployment; the
// dev fallback is harmless because dev never generates real posters.
function conceptSigningSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || "inspiration-local-signing-secret";
}

function conceptSignaturePayload(concept: SignableConcept): string {
  const elementKey = conceptElementEntries(concept as RandomStoryInspiration)
    .map(({ element, role, position }) => `${role}:${position}:${element.slug || element.id}`)
    .sort()
    .join("|");
  return JSON.stringify([concept.movieTitle, concept.logline, concept.premise, elementKey]);
}

function signConcept(concept: SignableConcept): string {
  return createHmac("sha256", conceptSigningSecret())
    .update(conceptSignaturePayload(concept))
    .digest("hex");
}

function verifyConceptSignature(concept: SignableConcept, signature: unknown): boolean {
  if (typeof signature !== "string" || signature.length === 0) return false;
  const expected = signConcept(concept);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"));
}

export function posterPromptFor(inspiration: RandomStoryInspiration): string {
  const names = (els: InspirationElement[]) => els.map((el) => el.name).join(", ");
  return [
    "Create cinematic movie poster key art for this story concept.",
    `Movie title: "${inspiration.movieTitle}".`,
    `Logline: ${inspiration.logline}`,
    inspiration.premise ? `Premise: ${inspiration.premise}` : "",
    `Setting: ${names(inspiration.elements.setting)}.`,
    `Antagonist: ${names(inspiration.elements.antagonist)}.`,
    `Theme: ${names(inspiration.elements.theme)}.`,
    `Vertical theatrical one-sheet with the exact title "${inspiration.movieTitle}" as large readable poster typography, bold composition, no logos.`,
  ]
    .filter(Boolean)
    .join(" ");
}

async function ensureStoryConceptPoster(
  inspiration: RandomStoryInspiration,
  options: { allowGeneration?: boolean } = {}
): Promise<{ movieTitle: string; poster: StoryConceptPoster }> {
  const db = getServiceSupabase();
  const movieTitle = inspiration.movieTitle;
  const prompt = posterPromptFor(inspiration);
  const promptHash = sha256(prompt);
  const conceptKey = conceptKeyFor(inspiration, promptHash);
  const conceptHash = sha256(conceptKey);

  const concept = await runQuery(
    "inspiration.upsertStoryConcept",
    db
      .from("story_concepts")
      .upsert(
        {
          concept_key: conceptKey,
          concept_hash: conceptHash,
          title: movieTitle,
          logline: inspiration.logline,
          status: "ready",
        },
        { onConflict: "concept_key" }
      )
      .select("id")
      .single()
  ) as { id: string };

  const entries = conceptElementEntries(inspiration);
  if (entries.length) {
    await runQuery(
      "inspiration.upsertStoryConceptElements",
      db
        .from("story_concept_elements")
        .upsert(
          entries.map(({ element, role, position }) => ({
            story_concept_id: concept.id,
            story_element_id: element.id,
            role,
            position,
          })),
          { onConflict: "story_concept_id,role,position" }
        )
    );
  }

  // Posters are key-art / typographic, so they default to Ideogram (strong at
  // composition + readable title text) rather than the global image default
  // (openai/gpt-image), which produces the "ChatGPT-looking" output. Mirrors the
  // project poster path (generatePoster). Minor-safety still forces Gemini, and a
  // workspace-configured image model would still win if one were set.
  const safetyProvider = posterTextMentionsMinor(prompt) ? "gemini" : undefined;
  const posterModel = await resolveWorkspaceGenerationModel({
    workspaceId: SYSTEM_WORKSPACE_ID,
    kind: "image",
    ...(safetyProvider ? { explicitProvider: safetyProvider } : {}),
    defaultProvider: "ideogram",
  });

  const existing = await runQuery(
    "inspiration.findStoryConceptPoster",
    db
      .from("story_concept_posters")
      .select("id,status,poster_asset_id,prompt,provider,model")
      .eq("story_concept_id", concept.id)
      .eq("prompt_hash", promptHash)
      .eq("is_primary", true)
      .maybeSingle()
  ) as {
    id: string;
    status: StoryConceptPoster["status"];
    poster_asset_id: string | null;
    prompt: string;
    provider: string | null;
    model: string | null;
  } | null;

  const existingUsesPosterModel =
    existing?.provider === posterModel.provider &&
    (existing?.model ?? undefined) === (posterModel.model ?? undefined);

  if (
    existingUsesPosterModel &&
    existing?.status === "ready" &&
    existing.poster_asset_id
  ) {
    return {
      movieTitle,
      poster: {
        status: "ready",
        assetId: existing.poster_asset_id,
        url: await posterUrlForAsset(existing.poster_asset_id),
        prompt: existing.prompt,
      },
    };
  }
  if (
    existingUsesPosterModel &&
    (existing?.status === "queued" || existing?.status === "generating")
  ) {
    return {
      movieTitle,
      poster: {
        status: existing.status,
        assetId: existing.poster_asset_id,
        url: existing.poster_asset_id ? await posterUrlForAsset(existing.poster_asset_id) : null,
        prompt: existing.prompt,
      },
    };
  }

  if (options.allowGeneration === false) {
    return {
      movieTitle,
      poster: {
        status: "queued",
        assetId: existingUsesPosterModel ? existing?.poster_asset_id ?? null : null,
        url: existingUsesPosterModel && existing?.poster_asset_id
          ? await posterUrlForAsset(existing.poster_asset_id)
          : null,
        prompt: existingUsesPosterModel ? existing?.prompt ?? prompt : prompt,
      },
    };
  }

  const posterRow = existing
    ? await runQuery(
        "inspiration.markStoryConceptPosterGenerating",
        db
          .from("story_concept_posters")
          .update({
            prompt,
            prompt_hash: promptHash,
            poster_asset_id: null,
            status: "generating",
            error: null,
            provider: posterModel.provider,
            model: posterModel.model ?? null,
          })
          .eq("id", existing.id)
          .select("id")
          .single()
      ) as { id: string }
    : await runQuery(
        "inspiration.insertStoryConceptPoster",
        db
          .from("story_concept_posters")
          .insert({
            story_concept_id: concept.id,
            prompt,
            prompt_hash: promptHash,
            status: "generating",
            is_primary: true,
            provider: posterModel.provider,
            model: posterModel.model ?? null,
          })
          .select("id")
          .single()
      ) as { id: string };

  try {
    const result = await createGeneratedAsset({
      auth: systemAuth(),
      projectId: INSPIRATION_POSTER_CACHE_PROJECT_ID,
      body: {
        kind: "image",
        prompt,
        description: "Generated inspiration movie poster.",
        size: "1024x1536",
        assetRole: "poster",
        displayName: "Inspiration poster",
        slug: `inspiration-poster-${conceptHash.slice(0, 12)}`,
        provider: posterModel.provider,
        ...(posterModel.model ? { model: posterModel.model } : {}),
      },
    });
    const assetId = jobAssetId(result.body.job as V1Job);
    await setAssetVisibility(
      SYSTEM_WORKSPACE_ID,
      INSPIRATION_POSTER_CACHE_PROJECT_ID,
      assetId,
      "public",
      { actorId: "system_inspiration_poster" }
    );
    await runQuery(
      "inspiration.markStoryConceptPosterReady",
      db
        .from("story_concept_posters")
        .update({
          poster_asset_id: assetId,
          status: "ready",
          error: null,
          provider: posterModel.provider,
          model: posterModel.model ?? null,
        })
        .eq("id", posterRow.id)
    );
    return {
      movieTitle,
      poster: {
        status: "ready",
        assetId,
        url: await posterUrlForAsset(assetId),
        prompt,
      },
    };
  } catch (error) {
    await runQuery(
      "inspiration.markStoryConceptPosterFailed",
      db
        .from("story_concept_posters")
        .update({
          status: "failed",
          error: {
            message: error instanceof Error ? error.message : "Poster generation failed.",
          },
        })
        .eq("id", posterRow.id)
    );
    return {
      movieTitle,
      poster: {
        status: "failed",
        assetId: null,
        url: null,
        prompt,
      },
    };
  }
}

function systemAuth(): AuthContext {
  return {
    mode: "local",
    actor: { id: "system_inspiration_poster", type: "agent" },
    workspaceId: SYSTEM_WORKSPACE_ID,
    isLocal: false,
  };
}

function jobAssetId(job: V1Job): string {
  const result = job.result as { assetIds?: unknown } | null;
  const assetId = Array.isArray(result?.assetIds) ? result.assetIds[0] : null;
  if (typeof assetId !== "string" || assetId.length === 0) {
    throw new ApiError("job_failed", "Poster generation job did not return an asset id.");
  }
  return assetId;
}

async function posterUrlForAsset(assetId: string): Promise<string | null> {
  const db = getServiceSupabase();
  const row = await runQuery(
    "inspiration.posterAssetUrl",
    db
      .from("assets")
      .select("remote_url,storage_key,storage_bucket,visibility")
      .eq("id", assetId)
      .maybeSingle()
  ) as {
    remote_url: string | null;
    storage_key: string | null;
    storage_bucket: string | null;
    visibility: "public" | "private" | null;
  } | null;
  if (!row) return null;
  if (row.storage_key) {
    try {
      return (await resolveAssetUrl(row, { privateTtlSec: 3600 })) ?? null;
    } catch {
      return remoteAssetUrlForDelivery(row.remote_url) ?? null;
    }
  }
  return remoteAssetUrlForDelivery(row.remote_url) ?? null;
}

function groupByCategory(rows: StoryElementRow[]): Record<StoryElementCategory, StoryElementRow[]> {
  return CATEGORIES.reduce((acc, category) => {
    acc[category] = rows.filter((row) => row.category_slug === category);
    return acc;
  }, {} as Record<StoryElementCategory, StoryElementRow[]>);
}

function preferred(rows: StoryElementRow[], needle: string): StoryElementRow[] {
  const normalized = needle.toLowerCase();
  const matches = rows.filter(
    (row) =>
      row.slug.includes(normalized) ||
      row.group_slug?.includes(normalized) ||
      row.name.toLowerCase().includes(normalized)
  );
  return matches.length ? matches : rows;
}

function pickOne(rows: StoryElementRow[]): StoryElementRow {
  if (!rows.length) {
    throw new ApiError(
      "validation_failed",
      "The story element catalog has not been seeded yet."
    );
  }
  const featured = rows.filter((row) => row.is_featured);
  return randomItem(featured.length && Math.random() < 0.7 ? featured : rows);
}

function pickMany(rows: StoryElementRow[], count: number): StoryElementRow[] {
  const pool = [...rows];
  const picks: StoryElementRow[] = [];
  while (pool.length && picks.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    const [pick] = pool.splice(index, 1);
    picks.push(pick);
  }
  if (!picks.length) picks.push(pickOne(rows));
  return picks;
}

function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function toElement(row: StoryElementRow): InspirationElement {
  return {
    id: row.id,
    category: row.category_slug,
    groupSlug: row.group_slug,
    slug: row.slug,
    name: row.name,
    coreIdea: row.core_idea,
  };
}
