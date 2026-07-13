import type { AspectRatio } from "@popcorn/shared/v1/types";
import type {
  Platform,
  StoryFormat,
} from "./useStudioFlow";

export const studioCopy = {
  brief: {
    heading: "What are we making?",
    description:
      "Describe the outcome, audience, and message. You can keep it rough - the next steps will refine the footage, story, and plan.",
    goalLabel: "Video idea",
    goalPlaceholder:
      "Make a 60-second launch video for Popcorn Ready showing how raw clips become a polished movie trailer.",
    lengthLabel: "Length",
    aspectLabel: "Aspect ratio",
    advancedSummary: "Add creative direction",
  },
  advanced: {
    audience: "Audience",
    platform: "Platform",
    format: "Story format",
    hook: "Hook question",
    bestVisual: "Best visual proof",
    bigIdea: "One big idea",
    payoff: "What should the viewer understand by the end?",
    accuracyNote: "Accuracy note",
    style: "Style",
  },
  footage: {
    usageLabel: "How should we use your footage?",
  },
} as const;

export const lengthOptions = [
  { value: 10, label: "10s", description: "Teaser" },
  { value: 30, label: "30s", description: "Ad" },
  { value: 60, label: "60s", description: "Short" },
  { value: 120, label: "2 min", description: "Explainer" },
  { value: 300, label: "5 min", description: "Full story" },
] as const;

export const aspectOptions: Array<{ value: AspectRatio; label: string }> = [
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
  { value: "1:1", label: "1:1" },
];

export const platformOptions: Array<{ value: Platform; label: string }> = [
  { value: "tiktok", label: "TikTok" },
  { value: "reels", label: "Reels" },
  { value: "youtube", label: "YouTube" },
  { value: "facebook", label: "Facebook" },
  { value: "vimeo", label: "Vimeo" },
  { value: "general", label: "General" },
];

export const formatOptions: Array<{ value: StoryFormat; label: string }> = [
  { value: "visual_reveal", label: "Visual reveal" },
  { value: "mystery_to_model", label: "Mystery to model" },
  { value: "challenge", label: "Challenge" },
  { value: "misconception", label: "Misconception" },
  { value: "animated_explainer", label: "Animated explainer" },
  { value: "classroom_demo", label: "Classroom demo" },
  { value: "aesthetic_montage", label: "Aesthetic montage" },
];
