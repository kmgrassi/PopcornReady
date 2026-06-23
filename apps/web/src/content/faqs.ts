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
];

export function faqsForPlacement(placement: FaqPlacement): FaqItem[] {
  return FAQS.filter((faq) => faq.placements.includes(placement));
}

export function faqsWithTag(tag: string): FaqItem[] {
  return FAQS.filter((faq) => faq.tags.includes(tag));
}
