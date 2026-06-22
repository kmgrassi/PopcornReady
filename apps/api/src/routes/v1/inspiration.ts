import { Router } from "express";
import { route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";

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
  const innerFlawOrLie = beliefShift
    ? `the belief that ${quote(stripSentenceEnd(beliefShift.name))}`
    : lowerFirst(arc.name);
  const newTruth = beliefShift?.core_idea
    ? stripSentenceEnd(beliefShift.core_idea)
    : lowerFirst(stripSentenceEnd(arc.core_idea ?? "they can choose a better self"));
  const oldSelf = randomItem(OLD_SELF_CHOICES);
  const endingType = randomItem(ENDING_TYPES);

  const logline =
    `A ${typeOfPerson} in ${settingText} wants to ${externalGoal}, ` +
    `but ${antagonistText} blocks them. To succeed, they must overcome ` +
    `${innerFlawOrLie} and choose between ${oldSelf} and ${quote(newTruth)}, ` +
    `leading to ${endingType}.`;

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
