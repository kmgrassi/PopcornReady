export type FaqPlacement = "landing" | "dashboard";

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  placements: FaqPlacement[];
  tags: string[];
}

export const FAQS: FaqItem[] = [
  {
    id: "what-is-popcorn-ready",
    question: "What is Popcorn Ready?",
    answer:
      "Popcorn Ready is a fully AI-enabled video creation and edit tool. Its core differentiator is that it lets AI stitch videos together, not just generate standalone clips. Current AI video tools can create short clips, often around 10 seconds; Popcorn Ready turns those clips into a complete video by planning, sequencing, editing, and assembling them into one finished piece.",
    placements: ["landing", "dashboard"],
    tags: ["overview", "creation", "editing"],
  },
  {
    id: "approximate-cost",
    question: "Approximately how much does it cost?",
    answer:
      "The approximate model cost is 30 to 50 cents per minute of finished video at the expensive end. Videos may also use audio or image generation, and those pieces usually cost less. Users can bring their own API keys, or Popcorn Ready can charge per token or usage unit through our own connections to third-party models.",
    placements: ["landing", "dashboard"],
    tags: ["pricing", "cost", "models"],
  },
  {
    id: "bring-your-own-videos",
    question: "Can I bring my own videos?",
    answer:
      "Yes, absolutely. Popcorn Ready makes it easy to generate videos, but it is just as easy to use your own videos. You can bring existing footage and use the AI editing workflow to stitch those videos together into a finished piece.",
    placements: ["landing", "dashboard"],
    tags: ["uploads", "editing", "footage"],
  },
];

export function faqsForPlacement(placement: FaqPlacement): FaqItem[] {
  return FAQS.filter((faq) => faq.placements.includes(placement));
}

export function faqsWithTag(tag: string): FaqItem[] {
  return FAQS.filter((faq) => faq.tags.includes(tag));
}
