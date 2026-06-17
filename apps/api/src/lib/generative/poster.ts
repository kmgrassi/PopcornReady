import type { VideoBrief } from "@/lib/api/v1/schemas";

export interface PosterPromptInput {
  brief: VideoBrief;
  planSummary?: string | null;
  heroAnchorDescription?: string | null;
}

function cleanLine(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

function briefStyle(brief: VideoBrief): string {
  const pieces = [
    cleanLine(brief.style),
    cleanLine(brief.platform ? `for ${brief.platform}` : null),
    cleanLine(brief.aspectRatio ? `${brief.aspectRatio} video` : null),
  ].filter(Boolean);
  return pieces.length ? pieces.join(", ") : "cinematic short-form key art";
}

export function buildPosterPrompt(input: PosterPromptInput): string {
  const goal = cleanLine(input.brief.goal) ?? "the project brief";
  const audience = cleanLine(input.brief.audience);
  const planSummary = cleanLine(input.planSummary);
  const heroAnchor = cleanLine(input.heroAnchorDescription);
  const style = briefStyle(input.brief);

  const parts = [
    "Create theatrical movie-poster key art for a Popcorn Ready video project.",
    `Core concept: ${goal}`,
    `Visual style: ${style}.`,
  ];
  if (audience) parts.push(`Audience: ${audience}.`);
  if (planSummary) parts.push(`Story direction: ${planSummary}.`);
  if (heroAnchor) parts.push(`Hero subject/reference: ${heroAnchor}.`);
  parts.push(
    "Use a dramatic 2:3 poster composition with one clear focal subject, cinematic lighting, strong depth, and readable silhouette.",
    "Do not include title text, captions, logos, watermarks, UI, or typography in the image."
  );

  return parts.join("\n");
}
