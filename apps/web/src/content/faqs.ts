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
  {
    id: "full-length-one-shot",
    question: "Can this really generate a full-length video in one shot?",
    answer:
      "It depends what you mean by full length. If you mean a feature-length 90-minute movie, probably not in one shot. Human taste is still very important, and you will likely need to edit a lot of things along the way. The idea is that Popcorn Ready makes that easier by letting you tell the AI what to do. Instead of manually chopping up audio and video in editing software and stitching everything together yourself, the AI can handle that work for you, while you still bring your taste and direction to the table.",
    placements: ["landing", "dashboard"],
    tags: ["limits", "long-form", "editing", "workflow"],
  },
  {
    id: "edit-after-generation",
    question: "Can I edit the video after it is generated?",
    answer:
      "Yes. You can edit the video at any time, even after it has been generated.",
    placements: ["landing", "dashboard"],
    tags: ["editing", "revision", "workflow"],
  },
  {
    id: "what-models",
    question: "What models does Popcorn Ready use?",
    answer:
      "Popcorn Ready's core model stack uses Gemini for video generation, OpenAI or Ideogram for image generation, and ElevenLabs for audio generation. Users can also pick their own models and add their own API keys for different provider options if they prefer.",
    placements: ["landing", "dashboard"],
    tags: ["models", "providers", "api-keys"],
  },
  {
    id: "editing-experience",
    question: "Do I need video editing experience to use it?",
    answer:
      "No. You do not need video editing experience. You need taste and the ability to prompt the model, and Popcorn Ready helps with example prompts along the way. The idea behind Popcorn Ready is that anyone can and should be able to create their own cinematic videos.",
    placements: ["landing", "dashboard"],
    tags: ["beginner", "prompting", "editing", "workflow"],
  },
];

export function faqsForPlacement(placement: FaqPlacement): FaqItem[] {
  return FAQS.filter((faq) => faq.placements.includes(placement));
}

export function faqsWithTag(tag: string): FaqItem[] {
  return FAQS.filter((faq) => faq.tags.includes(tag));
}
