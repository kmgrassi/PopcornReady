import { getLlmClient } from "@/lib/llm";
import type { GenerativeAssetKind, GenerativeProviderName } from "@popcorn/shared/generative/types";
import type { VideoBrief } from "./schemas";

const MAX_DISPLAY_NAME_LENGTH = 64;

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

export async function projectDisplayName(input: {
  explicitName?: string;
  brief?: VideoBrief;
}): Promise<string> {
  const explicit = cleanDisplayName(input.explicitName);
  if (explicit) return explicit;

  const goal = input.brief?.goal ?? "";
  const context = [
    input.brief?.format ? `format ${input.brief.format}` : null,
    input.brief?.platform ? `platform ${input.brief.platform}` : null,
    input.brief?.style ? `style ${input.brief.style}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    (await aiDisplayName({ kind: "project", prompt: goal, context })) ??
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
