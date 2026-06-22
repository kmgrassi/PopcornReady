import { Router } from "express";
import { createHash } from "crypto";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { createGeneratedAsset } from "@/lib/api/v1/generated-assets";
import type { AuthContext } from "@/lib/api/v1/auth";
import type { V1Job } from "@/lib/api/v1/jobs";
import { setAssetVisibility } from "@/lib/api/v1/store";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { remoteAssetUrlForDelivery, resolveAssetUrl } from "@/lib/storage/asset-urls";

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

interface RandomStoryInspiration {
  formula: string;
  logline: string;
  typeOfPerson: string;
  setting: string;
  externalGoal: string;
  antagonisticForce: string;
  innerFlawOrLie: string;
  oldSelf: string;
  newTruth: string;
  endingType: string;
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

const ELEMENT_GROUPS: InspirationElementGroup[] = [
  "plot",
  "setting",
  "arc",
  "antagonist",
  "theme",
  "stakes",
  "structure",
];

const PERSON_TYPES = [
  "failed teenage magician",
  "burned-out nurse",
  "small-town mechanic",
  "disgraced junior lawyer",
  "lonely arcade champion",
  "retired stunt driver",
  "first-generation scholarship student",
  "struggling street chef",
  "former child star",
  "anxious climate scientist",
  "rookie union organizer",
  "widowed radio host",
] as const;

const EXTERNAL_GOALS = [
  "win a national talent competition",
  "save their neighborhood venue",
  "clear their family name",
  "find a missing friend",
  "win the last open seat in a citywide election",
  "deliver a dangerous prototype before sunrise",
  "earn a place in an elite academy",
  "expose a corporate cover-up",
  "rebuild a failing restaurant",
  "rescue a stranded crew",
  "solve a decades-old mystery",
  "lead an impossible comeback season",
] as const;

const OLD_SELF_CHOICES = [
  "chasing approval",
  "hiding from responsibility",
  "winning by cheating",
  "staying invisible",
  "protecting a comfortable lie",
  "controlling everyone around them",
  "choosing ambition over loyalty",
  "running from grief",
  "trusting the system to stay fair",
  "believing they have to act alone",
] as const;

const ENDING_TYPES = [
  "a redemptive public victory",
  "a bittersweet personal win",
  "a costly but honest triumph",
  "a restored community",
  "an open-ended second chance",
  "a hard-won reconciliation",
  "a quiet act of courage",
  "a final reversal that exposes the truth",
  "a sacrifice that saves what matters",
  "a new beginning on their own terms",
] as const;

const SYSTEM_WORKSPACE_ID = "00000000-0000-4000-a000-000000000002";
const INSPIRATION_POSTER_CACHE_PROJECT_ID = "00000000-0000-4000-a000-000000000003";

export const inspirationRouter = Router();

inspirationRouter.get(
  "/inspiration/random",
  route(async () => {
    const rows = await listStoryElements();
    return {
      status: 200,
      body: { inspiration: buildRandomStory(rows) },
      headers: { "Cache-Control": "no-store" },
    };
  })
);

inspirationRouter.post(
  "/inspiration/poster",
  mutation(async ({ body }) => {
    const inspiration = await parsePosterInspiration(body);
    const poster = await ensureStoryConceptPoster(inspiration);
    return {
      status: poster.status === "ready" ? 200 : 202,
      body: { poster },
      headers: { "Cache-Control": "no-store" },
    };
  })
);

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

function buildRandomStory(rows: StoryElementRow[]): RandomStoryInspiration {
  const grouped = groupByCategory(rows);
  const plot = pickMany(preferred(grouped.plot_type, "competition"), 2);
  const timeSetting = pickOne(preferred(grouped.setting, "time_settings"));
  const placeSetting = pickOne([
    ...preferred(grouped.setting, "place_settings"),
    ...preferred(grouped.setting, "world_scale_settings"),
  ]);
  const settings = [timeSetting, placeSetting];
  const arc = pickOne(grouped.character_arc);
  const beliefShift = pickOne(grouped.belief_shift);
  const antagonist = pickMany(grouped.antagonist_type, 2);
  const theme = pickMany(grouped.theme, 2);
  const stakes = pickMany(grouped.stakes, 3);
  const structure = pickOne(preferred(grouped.structure, "competition"));

  const typeOfPerson = randomItem(PERSON_TYPES);
  const settingText = formatSetting(timeSetting, placeSetting);
  const externalGoal = randomItem(EXTERNAL_GOALS);
  const antagonistText = describeAntagonist(antagonist, theme);
  const innerFlawOrLie = innerFlawFor(arc, beliefShift);
  const newTruth = newTruthFor(arc, beliefShift);
  const oldSelf = randomItem(OLD_SELF_CHOICES);
  const endingType = randomItem(ENDING_TYPES);
  const logline = buildLogline({
    typeOfPerson,
    setting: settingText,
    externalGoal,
    antagonisticForce: antagonistText,
    innerFlawOrLie,
    oldSelf,
    newTruth,
    endingType,
  });

  return {
    formula:
      "A [type of person] in [setting] wants [external goal], but [antagonistic force] blocks them. To succeed, they must overcome [inner flaw/lie] and choose between [old self] and [new truth], leading to [ending type].",
    logline,
    typeOfPerson,
    setting: settingText,
    externalGoal,
    antagonisticForce: antagonistText,
    innerFlawOrLie,
    oldSelf,
    newTruth,
    endingType,
    elements: {
      plot: plot.map(toElement),
      setting: settings.map(toElement),
      arc: [arc, beliefShift].filter(Boolean).map(toElement),
      antagonist: antagonist.map(toElement),
      theme: theme.map(toElement),
      stakes: stakes.map(toElement),
      structure: [structure].map(toElement),
    },
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

  const timeSetting = selectedRows.setting[0];
  const placeSetting = selectedRows.setting[1];
  const arc = selectedRows.arc.find((row) => row.category_slug === "character_arc");
  const beliefShift = selectedRows.arc.find((row) => row.category_slug === "belief_shift");
  const structure = selectedRows.structure[0];
  if (!timeSetting || !placeSetting || !arc || !beliefShift || !structure) {
    throw new ApiError("validation_failed", "inspiration.elements is incomplete.");
  }

  const typeOfPerson = enumField(input, "typeOfPerson", PERSON_TYPES);
  const externalGoal = enumField(input, "externalGoal", EXTERNAL_GOALS);
  const oldSelf = enumField(input, "oldSelf", OLD_SELF_CHOICES);
  const endingType = enumField(input, "endingType", ENDING_TYPES);
  const setting = formatSetting(timeSetting, placeSetting);
  const antagonisticForce = describeAntagonist(selectedRows.antagonist, selectedRows.theme);
  const innerFlawOrLie = innerFlawFor(arc, beliefShift);
  const newTruth = newTruthFor(arc, beliefShift);
  const logline = buildLogline({
    typeOfPerson,
    setting,
    externalGoal,
    antagonisticForce,
    innerFlawOrLie,
    oldSelf,
    newTruth,
    endingType,
  });

  assertFieldMatches(input, "setting", setting);
  assertFieldMatches(input, "antagonisticForce", antagonisticForce);
  assertFieldMatches(input, "innerFlawOrLie", innerFlawOrLie);
  assertFieldMatches(input, "newTruth", newTruth);
  assertFieldMatches(input, "logline", logline);

  return {
    formula: typeof input.formula === "string" ? input.formula : "",
    logline,
    typeOfPerson,
    setting,
    externalGoal,
    antagonisticForce,
    innerFlawOrLie,
    oldSelf,
    newTruth,
    endingType,
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

function enumField<T extends readonly string[]>(
  input: Record<string, unknown>,
  field: string,
  allowed: T
): T[number] {
  const value = input[field];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ApiError("validation_failed", `inspiration.${field} is invalid.`);
  }
  return value;
}

function assertFieldMatches(
  input: Record<string, unknown>,
  field: string,
  expected: string
): void {
  if (input[field] !== expected) {
    throw new ApiError("validation_failed", `inspiration.${field} does not match the selected elements.`);
  }
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
  const promptParts = [
    inspiration.typeOfPerson,
    inspiration.setting,
    inspiration.externalGoal,
    inspiration.antagonisticForce,
    inspiration.innerFlawOrLie,
    inspiration.oldSelf,
    inspiration.newTruth,
    inspiration.endingType,
    promptHash,
  ]
    .map(normalizeKeyPart)
    .join("|");
  return `${elementKey}|prompt:${promptParts}`;
}

function normalizeKeyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function posterPromptFor(inspiration: RandomStoryInspiration): string {
  return [
    "Create cinematic movie poster key art for this story concept.",
    `Logline: ${inspiration.logline}`,
    `Hero: ${inspiration.typeOfPerson}.`,
    `Setting: ${inspiration.setting}.`,
    `Antagonistic force: ${inspiration.antagonisticForce}.`,
    `Theme and stakes: ${inspiration.newTruth}; ${inspiration.endingType}.`,
    "Vertical theatrical one-sheet, bold composition, no readable typography, no logos.",
  ].join(" ");
}

async function ensureStoryConceptPoster(
  inspiration: RandomStoryInspiration
): Promise<StoryConceptPoster> {
  const db = getServiceSupabase();
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
          formula: inspiration.formula ?? null,
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

  const existing = await runQuery(
    "inspiration.findStoryConceptPoster",
    db
      .from("story_concept_posters")
      .select("id,status,poster_asset_id,prompt")
      .eq("story_concept_id", concept.id)
      .eq("prompt_hash", promptHash)
      .eq("is_primary", true)
      .maybeSingle()
  ) as { id: string; status: StoryConceptPoster["status"]; poster_asset_id: string | null; prompt: string } | null;

  if (existing?.status === "ready" && existing.poster_asset_id) {
    return {
      status: "ready",
      assetId: existing.poster_asset_id,
      url: await posterUrlForAsset(existing.poster_asset_id),
      prompt: existing.prompt,
    };
  }
  if (existing?.status === "queued" || existing?.status === "generating") {
    return {
      status: existing.status,
      assetId: existing.poster_asset_id,
      url: existing.poster_asset_id ? await posterUrlForAsset(existing.poster_asset_id) : null,
      prompt: existing.prompt,
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
        })
        .eq("id", posterRow.id)
    );
    return {
      status: "ready",
      assetId,
      url: await posterUrlForAsset(assetId),
      prompt,
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
      status: "failed",
      assetId: null,
      url: null,
      prompt,
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

function describeAntagonist(antagonist: StoryElementRow[], theme: StoryElementRow[]): string {
  const primary = antagonist[0]?.name.toLowerCase() ?? "institution";
  const secondary = antagonist[1]?.name.toLowerCase();
  const themeName = theme[0]?.name.toLowerCase() ?? "power";
  if (primary === "technology" || secondary === "technology") {
    return `an AI-controlled entertainment monopoly`;
  }
  if (primary === "institution" || secondary === "institution") {
    return `a powerful institution policing ${themeName}`;
  }
  if (primary === "person") return `a ruthless rival obsessed with ${themeName}`;
  if (primary === "self") return `their own fear of losing ${themeName}`;
  if (primary === "society") return `a society built around ${themeName}`;
  if (primary === "nature") return `a worsening disaster tied to ${themeName}`;
  if (primary === "supernatural force") return `a supernatural bargain tied to ${themeName}`;
  return `a force tied to ${themeName}`;
}

function formatSetting(timeSetting: StoryElementRow, placeSetting: StoryElementRow): string {
  const time = settingLabel(timeSetting.name);
  const place = settingLabel(placeSetting.name);
  return `${articleFor(place)} ${place} in the ${time}`;
}

function settingLabel(name: string): string {
  return name.toLowerCase().replace(/\s*\/\s*/g, " or ");
}

function innerFlawFor(arc: StoryElementRow, beliefShift: StoryElementRow | undefined): string {
  return beliefShift
    ? `the belief that ${quote(stripSentenceEnd(beliefShift.name))}`
    : lowerFirst(arc.name);
}

function newTruthFor(arc: StoryElementRow, beliefShift: StoryElementRow | undefined): string {
  return beliefShift?.core_idea
    ? stripSentenceEnd(beliefShift.core_idea)
    : lowerFirst(stripSentenceEnd(arc.core_idea ?? "they can choose a better self"));
}

function buildLogline(input: {
  typeOfPerson: string;
  setting: string;
  externalGoal: string;
  antagonisticForce: string;
  innerFlawOrLie: string;
  oldSelf: string;
  newTruth: string;
  endingType: string;
}): string {
  return (
    `A ${input.typeOfPerson} in ${input.setting} wants to ${input.externalGoal}, ` +
    `but ${input.antagonisticForce} blocks them. To succeed, they must overcome ` +
    `${input.innerFlawOrLie} and choose between ${input.oldSelf} and ${quote(input.newTruth)}, ` +
    `leading to ${input.endingType}.`
  );
}

function lowerFirst(value: string): string {
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

function articleFor(value: string): "a" | "an" {
  return /^[aeiou]/i.test(value) ? "an" : "a";
}

function stripSentenceEnd(value: string): string {
  return value.trim().replace(/[.!?]+$/, "");
}

function quote(value: string): string {
  return `"${value}"`;
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
