export const GITHUB_URL = "https://github.com/kmgrassi/popcornready";
export const PROMPT_MIN_LENGTH = 12;
export const LENGTH_OPTIONS = [10, 15, 30, 45, 60];

export const FEATURES = [
  {
    title: "Bring or generate footage",
    body: "Upload your own clips, or generate missing shots with OpenAI, Gemini Veo, and ElevenLabs audio.",
  },
  {
    title: "Character consistency",
    body: "Lock identity, wardrobe, and style with reference packs so generated shots stay on-model.",
  },
  {
    title: "Revise by conversation",
    body: "Requests flow through the agent and update the selected assets.",
  },
  {
    title: "Inspectable & safe",
    body: "Every cut traces back to source clips, prompts, actions, and selected assets.",
  },
];

export const PRICING = [
  {
    name: "Self-host",
    price: "Free",
    cadence: "open source",
    blurb: "Run the whole studio yourself with your own infrastructure.",
    features: [
      "Full studio + editor",
      "Bring your own API keys",
      "Unlimited local renders",
      "Community support",
    ],
    cta: { label: "Get it on GitHub", href: GITHUB_URL, external: true },
    featured: false,
  },
  {
    name: "Free",
    price: "Free",
    cadence: "+ credits",
    blurb: "Create an account, log in, and generate with our hosted model tokens.",
    features: [
      "No subscription required",
      "Use hosted model tokens",
      "Pay per credit as you generate",
      "1080p watermark-free export",
    ],
    cta: { label: "Start free", href: "/library/projects", external: false },
    featured: true,
  },
  {
    name: "Credits",
    price: "$0.01",
    cadence: "per credit",
    blurb: "Top up only when you need hosted generation capacity.",
    features: [
      "$10, $25, and $50 credit packs",
      "Credits spend on hosted generation",
      "Bring your own keys to avoid credit usage",
      "No subscription commitment",
    ],
    cta: { label: "Buy credits", href: "/account", external: false },
    featured: false,
  },
  {
    name: "Studio",
    price: "Custom",
    cadence: "for teams",
    blurb: "Seats, workspaces, quotas, and the full agent API for teams.",
    features: [
      "Multiple seats & workspaces",
      "Custom quotas & SLAs",
      "Full agent / automation API",
      "SSO & priority support",
    ],
    cta: { label: "Contact us", href: `${GITHUB_URL}/issues`, external: true },
    featured: false,
  },
];
