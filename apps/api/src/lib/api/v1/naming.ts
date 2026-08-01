import { getLlmClient } from "@/lib/llm";
import type { GenerativeAssetKind, GenerativeProviderName } from "@popcorn/shared/generative/types";
import type { VideoBrief } from "./schemas";

const MAX_DISPLAY_NAME_LENGTH = 64;
const MAX_SLUG_LENGTH = 48;

// A project-scoped, lowercase, agent-referenceable handle. The generating agent
// supplies this directly; this normalizer is the safety net that guarantees the
// stored value is index- and reference-safe regardless of what the model wrote.
export function normalizeSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || null;
}

const namingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description: "A concise human-facing display name.",
    },
  },
  required: ["name"],
} as const;

function cleanDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const withoutQuotes = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutQuotes) return null;
  return withoutQuotes.length > MAX_DISPLAY_NAME_LENGTH
    ? withoutQuotes.slice(0, MAX_DISPLAY_NAME_LENGTH - 3).trimEnd() + "..."
    : withoutQuotes;
}

function titleCaseWords(value: string): string {
  const small = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "or", "the", "to", "with"]);
  return value
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function fallbackDisplayName(input: string, fallback: string): string {
  const compact = input.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  const firstClause = compact.split(/[.!?\n:;]+/)[0]?.trim() || compact;
  const words = firstClause
    .replace(/[^a-zA-Z0-9 '&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 7)
    .join(" ");
  return cleanDisplayName(titleCaseWords(words)) ?? fallback;
}

async function aiDisplayName(args: {
  kind: "project" | GenerativeAssetKind;
  prompt: string;
  context?: string;
}): Promise<string | null> {
  try {
    const out = await getLlmClient().structured<{ name: string }>({
      cachedSystem:
        "You name generated video projects and media assets. Return short, specific, title-case display names. Do not copy the prompt verbatim. Do not include file extensions, quotes, emojis, or punctuation-heavy subtitles.",
      user: [
        `Object type: ${args.kind}`,
        args.context ? `Context: ${args.context}` : null,
        `Source prompt or brief: ${args.prompt}`,
        "Return one display name, ideally 2-6 words and no more than 64 characters.",
      ]
        .filter(Boolean)
        .join("\n"),
      schema: namingSchema,
      maxTokens: 80,
      effort: "minimal",
    });
    return cleanDisplayName(out.name);
  } catch {
    return null;
  }
}

type DisplayNameGenerator = typeof aiDisplayName;

export async function projectDisplayName(input: {
  explicitName?: string;
  brief?: VideoBrief;
  namingPrompt?: string;
  namingContext?: string;
}, generateName: DisplayNameGenerator = aiDisplayName): Promise<string> {
  const explicit = cleanDisplayName(input.explicitName);
  if (explicit) return explicit;

  const goal = input.namingPrompt?.trim() || input.brief?.goal || "";
  const context = [
    input.namingContext ? `asset type ${input.namingContext}` : null,
    input.brief?.format ? `format ${input.brief.format}` : null,
    input.brief?.platform ? `platform ${input.brief.platform}` : null,
    input.brief?.style ? `style ${input.brief.style}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    (goal ? await generateName({ kind: "project", prompt: goal, context }) : null) ??
    fallbackDisplayName(goal, "Untitled Project")
  );
}

export async function generatedAssetDisplayName(input: {
  explicitName?: string;
  kind: GenerativeAssetKind;
  provider: GenerativeProviderName;
  prompt: string;
  description?: string;
  role?: string;
}): Promise<string> {
  const explicit = cleanDisplayName(input.explicitName);
  if (explicit) return explicit;

  const context = [
    input.role ? `role ${input.role}` : null,
    `provider ${input.provider}`,
    input.description ? `description ${input.description}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const fallback = `${titleCaseWords(input.role || input.kind)} Asset`;
  return (
    (await aiDisplayName({ kind: input.kind, prompt: input.prompt, context })) ??
    fallbackDisplayName(input.description || input.prompt, fallback)
  );
}

// Agent-supplied display metadata for an asset/project tool call. The model writes
// these as part of the same tool call that produces the asset; both are optional so
// older callers and partial tool calls still resolve through the fallback chain.
export interface AgentMetadataInput {
  name?: string;
  slug?: string;
}

// Resolve the {name, slug} to persist for a generated asset. Prefers what the agent
// wrote in its tool call; falls back to the display-name pipeline (incl. the
// side-channel aiDisplayName) only when the agent omitted a name. The slug prefers
// the agent's slug, else is derived from the resolved name. Uniqueness within the
// project is enforced separately at insert time (see ensureUniqueAssetSlug).
export async function resolveAssetMetadata(input: {
  agent?: AgentMetadataInput;
  kind: GenerativeAssetKind;
  provider: GenerativeProviderName;
  prompt: string;
  description?: string;
  role?: string;
}): Promise<{ name: string; slug: string | null }> {
  const name = await generatedAssetDisplayName({
    explicitName: input.agent?.name,
    kind: input.kind,
    provider: input.provider,
    prompt: input.prompt,
    ...(input.description ? { description: input.description } : {}),
    ...(input.role ? { role: input.role } : {}),
  });
  const slug = normalizeSlug(input.agent?.slug) ?? normalizeSlug(name);
  return { name, slug };
}

// Resolve the {name, slug} to persist for a project, same agent-first policy.
export async function resolveProjectMetadata(input: {
  agent?: AgentMetadataInput;
  brief?: VideoBrief;
  namingPrompt?: string;
  namingContext?: string;
}): Promise<{ name: string; slug: string | null }> {
  const name = await projectDisplayName({
    ...(input.agent?.name ? { explicitName: input.agent.name } : {}),
    ...(input.brief ? { brief: input.brief } : {}),
    ...(input.namingPrompt ? { namingPrompt: input.namingPrompt } : {}),
    ...(input.namingContext ? { namingContext: input.namingContext } : {}),
  });
  const slug = normalizeSlug(input.agent?.slug) ?? normalizeSlug(name);
  return { name, slug };
}
