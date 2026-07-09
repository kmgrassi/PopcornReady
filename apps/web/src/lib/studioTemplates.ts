import type { BriefDraft } from "../components/studio/useStudioFlow";

export interface StudioTemplate {
  id: string;
  title: string;
  group: string;
  lengthLabel: string;
  aspect: BriefDraft["aspectRatio"];
  brief: string;
  draft: Partial<BriefDraft>;
}

export const STUDIO_TEMPLATE_GROUPS = [
  "Launch",
  "Social",
  "Education",
  "Product",
  "Internal",
];

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  {
    id: "launch-teaser",
    title: "Launch teaser",
    group: "Launch",
    lengthLabel: "30s",
    aspect: "9:16",
    brief: "Fast hook, three proof points, product reveal, closing CTA.",
    draft: {
      projectName: "Launch teaser",
      goal:
        "Create a 30-second launch teaser with a fast hook, three proof points, a product reveal, and a closing call to action.",
      targetLengthSec: 30,
      aspectRatio: "9:16",
      format: "visual_reveal",
      style: "fast-paced launch teaser",
      hook: "Open with the sharpest product or audience problem.",
      payoff: "Reveal the product as the clear solution.",
      callToAction: "Invite viewers to try it or learn more.",
    },
  },
  {
    id: "founder-update",
    title: "Founder update",
    group: "Internal",
    lengthLabel: "60s",
    aspect: "16:9",
    brief: "Direct-to-camera outline with b-roll prompts and chapter beats.",
    draft: {
      projectName: "Founder update",
      goal:
        "Create a 60-second founder update with a direct-to-camera structure, supporting b-roll prompts, clear chapter beats, and a concise closing message.",
      targetLengthSec: 60,
      aspectRatio: "16:9",
      platform: "general",
      format: "animated_explainer",
      style: "clear, confident internal update",
      hook: "Start with the most important change or milestone.",
      callToAction: "Close with the next action for the team or audience.",
    },
  },
  {
    id: "ugc-cutdown",
    title: "UGC cutdown",
    group: "Social",
    lengthLabel: "20s",
    aspect: "9:16",
    brief: "Grab the strongest customer moment and package it for short-form.",
    draft: {
      projectName: "UGC cutdown",
      goal:
        "Create a 20-second short-form UGC cutdown that opens with the strongest customer moment, keeps pacing tight, and ends with a simple product takeaway.",
      targetLengthSec: 20,
      aspectRatio: "9:16",
      format: "challenge",
      style: "authentic, fast social cutdown",
      hook: "Lead with the most specific customer quote or reaction.",
      payoff: "Make the customer outcome feel immediate and credible.",
    },
  },
  {
    id: "feature-demo",
    title: "Feature demo",
    group: "Product",
    lengthLabel: "45s",
    aspect: "16:9",
    brief: "Problem, workflow, outcome, and polished product screenshots.",
    draft: {
      projectName: "Feature demo",
      goal:
        "Create a 45-second feature demo that frames the problem, shows the workflow, highlights the outcome, and uses polished product screenshots or captures.",
      targetLengthSec: 45,
      aspectRatio: "16:9",
      platform: "youtube",
      format: "animated_explainer",
      style: "clean product walkthrough",
      hook: "Name the user problem before showing the feature.",
      payoff: "End with the finished result or measurable benefit.",
    },
  },
  {
    id: "how-to",
    title: "How-to lesson",
    group: "Education",
    lengthLabel: "90s",
    aspect: "16:9",
    brief: "Step-by-step lesson with recap cards and clear visual anchors.",
    draft: {
      projectName: "How-to lesson",
      goal:
        "Create a 90-second how-to lesson with step-by-step teaching, recap cards, and clear visual anchors for each major action.",
      targetLengthSec: 90,
      aspectRatio: "16:9",
      platform: "youtube",
      format: "classroom_demo",
      style: "helpful, structured tutorial",
      hook: "Start with what the viewer will be able to do by the end.",
      payoff: "Finish with a short recap of the completed workflow.",
    },
  },
  {
    id: "event-recap",
    title: "Event recap",
    group: "Social",
    lengthLabel: "45s",
    aspect: "1:1",
    brief: "Montage structure with attendee quotes and branded end slate.",
    draft: {
      projectName: "Event recap",
      goal:
        "Create a 45-second event recap with an energetic montage structure, attendee quote moments, and a branded end slate.",
      targetLengthSec: 45,
      aspectRatio: "1:1",
      format: "aesthetic_montage",
      style: "energetic event montage",
      hook: "Open with the highest-energy crowd or speaker moment.",
      payoff: "End with the event theme, brand, and next date or call to action.",
    },
  },
];

export function studioTemplateById(id: string | null): StudioTemplate | undefined {
  if (!id) return undefined;
  return STUDIO_TEMPLATES.find((template) => template.id === id);
}
