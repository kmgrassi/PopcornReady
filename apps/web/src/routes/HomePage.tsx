import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AgentRunPreview } from "../components/AgentRunPreview";
import { HeatLogoMark } from "../components/HeatLogoMark";
import { Reveal } from "../components/Reveal";
import { useAuth } from "../components/auth/AuthProvider";
import {
  LandingSection,
  LandingSectionHeader,
} from "../components/landing/LandingSection";
import { WorkflowStages } from "../components/landing/WorkflowStages";
import {
  buildPendingLandingPrompt,
  canStartGuestRun,
  continuePendingLandingPrompt,
  guestRunGuardRemaining,
  persistPendingLandingPrompt,
  type PendingLandingPrompt,
} from "../lib/guestGeneration";
import styles from "./HomePage.module.css";

const GITHUB_URL = "https://github.com/kmgrassi/popcornready";
const PROMPT_MIN_LENGTH = 12;
const LENGTH_OPTIONS = [15, 30, 45, 60];

const FEATURES = [
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
    body: "Every message becomes validated timeline edits.",
  },
  {
    title: "Inspectable & safe",
    body: "Every cut traces back to source clips, prompts, and patches. Bad model output is clamped, not rendered.",
  },
];

// Ordered by Popcorn Ready's strength: what it's best at on the left, weakest on
// the right. Every HEATMAP_ROWS `scores` array is in this same column order.
const HEATMAP_COLUMNS = [
  "AI workflow",
  "Gen AI",
  "Timeline model",
  "Audio",
  "Captions",
  "Versioning",
  "VFX",
  "Manual edit",
];

const HEATMAP_LEVELS = ["Minimal", "Light", "Medium", "Strong"];

const HEATMAP_EXPLANATIONS: Record<string, string> = {
  "Manual edit":
    "Whether a user can directly cut, trim, rearrange, and stitch video without relying on AI.",
  "Timeline model":
    "Whether the product represents the edit as a structured timeline with inspectable segments and render decisions.",
  Audio:
    "Whether the product can create, clean up, arrange, or export useful audio alongside the video.",
  VFX: "Whether the product supports deeper visual compositing, masking, effects, and shot manipulation.",
  Captions:
    "Whether captions, transcripts, subtitles, or localization workflows are a central capability.",
  "Gen AI":
    "Whether the product can generate or transform media such as video, images, voice, or effects.",
  "AI workflow":
    "Whether AI drives the full workflow end to end, rather than appearing as isolated tools inside a manual editor.",
  Versioning:
    "Whether the product supports review, project history, collaboration, or version control.",
};

const POPCORN_READY_HEATMAP_EXPLANATIONS: Record<string, string> = {
  "Manual edit":
    "Popcorn Ready does not currently provide a manual timeline UI for hand-stitching or editing without AI.",
  "Timeline model":
    "Popcorn Ready produces and patches a structured timeline, so the output remains inspectable even though edits are AI-driven.",
  Audio:
    "Popcorn Ready can generate or overlay audio and render it with the finished video, but it is not a full audio-post workstation.",
  VFX: "Popcorn Ready focuses on generated shots and deterministic assembly, not deep manual compositing or effects work.",
  Captions:
    "Popcorn Ready supports burned-in caption text in rendered videos, but it is not yet a full transcript, subtitle, and localization suite.",
  "Gen AI":
    "Popcorn Ready is generation-first: it can create missing visual assets instead of requiring source footage.",
  "AI workflow":
    "This is the core differentiator: brief, plan, asset generation, audio, timeline, and export happen through one AI-driven loop.",
  Versioning:
    "Local exports and inspectable plans exist today; richer cloud review and version history would come later.",
};

const HEATMAP_ROWS = [
  {
    app: "Popcorn Ready",
    scores: [3, 3, 3, 2, 2, 2, 1, 0],
    note: "Fully AI-driven brief-to-plan-to-assets-to-timeline flow; not a manual stitching or hand-editing tool.",
    featured: true,
  },
  {
    app: "Premiere Pro",
    scores: [1, 2, 3, 2, 3, 2, 2, 3],
    note: "Broad professional craft stack with Adobe ecosystem depth.",
  },
  {
    app: "DaVinci Resolve",
    scores: [1, 1, 3, 3, 2, 3, 3, 3],
    note: "Deepest finishing, color, audio, VFX, and collaboration suite.",
  },
  {
    app: "CapCut",
    scores: [2, 3, 2, 1, 3, 2, 1, 2],
    note: "Fast social editing with strong creator AI.",
  },
  {
    app: "VEED",
    scores: [2, 3, 1, 1, 3, 2, 0, 1],
    note: "Web editing shell with captions, dubbing, and model brokerage.",
  },
  {
    app: "Descript",
    scores: [2, 2, 2, 2, 3, 2, 1, 2],
    note: "Transcript-native editing for explainers, podcasts, and repurposing.",
  },
  {
    app: "Runway",
    scores: [2, 3, 1, 0, 0, 1, 2, 1],
    note: "Generative studio for shot invention and manipulation.",
  },
  {
    app: "Frame.io",
    scores: [0, 0, 0, 0, 1, 3, 0, 0],
    note: "Review and versioning backbone rather than an editor.",
  },
];

const PRICING = [
  {
    name: "Self-host",
    price: "Free",
    cadence: "open source",
    blurb: "Run the whole studio yourself. Bring your own model keys.",
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
    name: "Creator",
    price: "$19",
    cadence: "per month",
    blurb: "Hosted rendering for solo creators shipping short-form video.",
    features: [
      "~30 finished videos / mo",
      "Hosted rendering, no setup",
      "1080p watermark-free export",
      "1 workspace",
    ],
    cta: { label: "View projects", href: "/library/projects", external: false },
    featured: true,
  },
  {
    name: "Pro",
    price: "$49",
    cadence: "per month",
    blurb: "More volume, character consistency, and early API access.",
    features: [
      "~150 finished videos / mo",
      "Character consistency packs",
      "Priority rendering + 4K export",
      "Agent API preview",
    ],
    cta: { label: "View projects", href: "/library/projects", external: false },
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

function heatmapTooltip(app: string, column: string, score: number) {
  const explanation =
    app === "Popcorn Ready"
      ? POPCORN_READY_HEATMAP_EXPLANATIONS[column]
      : HEATMAP_EXPLANATIONS[column];
  return `${app}: ${column} is ${HEATMAP_LEVELS[score].toLowerCase()}. ${explanation}`;
}

function HeatLogoScale({ score }: { score: number }) {
  return (
    <span className={`lp-heat-scale count-${score}`} aria-hidden="true">
      {Array.from({ length: score }, (_, index) => (
        <HeatLogoMark className="lp-heat-mark" key={index} />
      ))}
    </span>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const {
    status,
    error: authError,
    configured,
    signInAnonymous,
  } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [targetLengthSec, setTargetLengthSec] = useState(30);
  const [pendingPrompt, setPendingPrompt] = useState<PendingLandingPrompt | null>(
    null,
  );
  const [modalMode, setModalMode] = useState<"choice" | "limit">("choice");
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSkippingAccount, setIsSkippingAccount] = useState(false);
  const normalizedPrompt = prompt.trim();
  const promptTooShort =
    normalizedPrompt.length > 0 && normalizedPrompt.length < PROMPT_MIN_LENGTH;
  const canSubmit =
    normalizedPrompt.length >= PROMPT_MIN_LENGTH && status !== "loading";
  const remainingGuestRuns = useMemo(() => guestRunGuardRemaining(), []);
  const guestRunLabel =
    remainingGuestRuns === 1 ? "1 video" : `${remainingGuestRuns} videos`;

  function openAccountChoice() {
    if (!canSubmit) return;

    const nextPendingPrompt = buildPendingLandingPrompt(
      normalizedPrompt,
      targetLengthSec,
    );
    setPendingPrompt(nextPendingPrompt);
    setModalError(null);

    if (status === "authenticated") {
      continuePendingLandingPrompt(navigate, nextPendingPrompt);
      return;
    }

    setModalMode(canStartGuestRun() ? "choice" : "limit");
  }

  function createAccount() {
    if (!pendingPrompt) return;
    persistPendingLandingPrompt(pendingPrompt);
    navigate("/signup", {
      state: { pendingLandingPrompt: pendingPrompt },
    });
  }

  async function skipAccount() {
    if (!pendingPrompt || isSkippingAccount || modalMode === "limit") return;
    setModalError(null);
    setIsSkippingAccount(true);
    try {
      await signInAnonymous();
      continuePendingLandingPrompt(navigate, pendingPrompt);
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : "Anonymous sign-in failed.",
      );
    } finally {
      setIsSkippingAccount(false);
    }
  }

  return (
    <div className="landing">
      <main>
        <section className="lp-hero">
          <span className="lp-eyebrow">New · AI-native video production</span>
          <h1>
            Prompt-to-video is{" "}
            <span className="lp-accent">only step one.</span>
          </h1>
          <p className="lp-lede">
            Popcorn Ready gives AI video the missing workflow: it plans the
            scenes, generates the shots, edits the sequence, checks continuity,
            and refines the final cut — one AI-native production, not a pile of
            clips.
          </p>
          <form
            className={styles.promptComposer}
            onSubmit={(event) => {
              event.preventDefault();
              openAccountChoice();
            }}
          >
            <label className={styles.promptLabel} htmlFor="landing-video-prompt">
              What should the video be about?
            </label>
            <textarea
              id="landing-video-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="A 30-second launch video for a neighborhood bakery's new midnight cookie menu..."
              rows={4}
            />
            <div className={styles.promptControls}>
              <label className={styles.lengthControl} htmlFor="landing-video-length">
                <span>Length</span>
                <select
                  id="landing-video-length"
                  value={targetLengthSec}
                  onChange={(event) =>
                    setTargetLengthSec(Number(event.target.value))
                  }
                >
                  {LENGTH_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} sec
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={styles.promptSubmit}
                type="submit"
                disabled={!canSubmit}
              >
                Create my {targetLengthSec}-second video
              </button>
            </div>
            <p className={styles.promptHint}>
              {promptTooShort
                ? `Add a little more detail before starting.`
                : `Guests can start ${guestRunLabel} before creating an account.`}
            </p>
          </form>
          <div className="lp-cta-buttons">
            <Link className="lp-price-cta" to="/library/projects">
              View projects
            </Link>
            <a
              className="lp-price-cta"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
            >
              Self-host
            </a>
          </div>
        </section>

        <Reveal>
          <LandingSection
            spacing="tight"
            kicker="Full run overview"
            title="One directed run, visible end to end."
            subtitle="Watch the agent work: it turns the brief into beats, generates a keyframe per beat, and assembles the timeline — every step inspectable in one workspace."
          >
            <AgentRunPreview />
          </LandingSection>
        </Reveal>

        <Reveal>
          <LandingSection spacing="normal" contentClassName={styles.orchestrator}>
            <div className={styles.orchestratorCopy}>
              <LandingSectionHeader
                align="start"
                kicker="AI orchestrator"
                title="The agent coordinates every stage."
                subtitle="Briefs, planning, asset generation, review, and rendering stay connected as one inspectable system instead of scattered one-off tools."
              />
            </div>
            <figure className={styles.orchestratorFrame}>
              <img
                src="/images/pc-ai-orchestrator-overview.png"
                alt="Popcorn Ready AI orchestrator overview showing the connected brief, planning, assets, and render pipeline."
                loading="lazy"
                width="1535"
                height="1024"
              />
            </figure>
          </LandingSection>
        </Reveal>

        <Reveal>
          <WorkflowStages />
        </Reveal>

        <Reveal>
          <LandingSection title="What it does" contentClassName="lp-grid">
            {FEATURES.map((feature) => (
              <div className="lp-card" key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </div>
            ))}
          </LandingSection>
        </Reveal>

        <Reveal>
          <LandingSection
            aria-label="Competitive feature heatmap"
            title="Where it fits"
            subtitle={
              <>
                Other tools bolt AI onto a manual editor. Popcorn Ready is the
                opposite: an agent that drives the whole pipeline &mdash; brief,
                plan, assets, audio, timeline, and export &mdash; in one loop.
              </>
            }
          >
            <div className="lp-heatmap-wrap">
              <div className="lp-heatmap">
                <div className="lp-heatmap-head">
                  <span>Tool</span>
                  {HEATMAP_COLUMNS.map((column) => (
                    <span key={column}>{column}</span>
                  ))}
                  <span>Positioning</span>
                </div>
                {HEATMAP_ROWS.map((row) => (
                  <div
                    className={`lp-heatmap-row${row.featured ? " featured" : ""}`}
                    key={row.app}
                  >
                    <strong>{row.app}</strong>
                    {row.scores.map((score, index) => (
                      <button
                        type="button"
                        className={`lp-heat-cell level-${score}`}
                        key={`${row.app}-${HEATMAP_COLUMNS[index]}`}
                        aria-label={heatmapTooltip(
                          row.app,
                          HEATMAP_COLUMNS[index],
                          score
                        )}
                      >
                        <em>{HEATMAP_COLUMNS[index]}</em>
                        <HeatLogoScale score={score} />
                        <span className="lp-heat-tip">
                          {heatmapTooltip(row.app, HEATMAP_COLUMNS[index], score)}
                        </span>
                      </button>
                    ))}
                    <p>{row.note}</p>
                  </div>
                ))}
              </div>
              <div className="lp-heatmap-legend" aria-hidden="true">
                <span>
                  <span className="lp-heat-scale count-0" /> Minimal
                </span>
                <span>
                  <span className="lp-heat-scale count-1">
                    <HeatLogoMark className="lp-heat-mark" />
                  </span>
                  Light
                </span>
                <span>
                  <span className="lp-heat-scale count-2">
                    <HeatLogoMark className="lp-heat-mark" />
                    <HeatLogoMark className="lp-heat-mark" />
                  </span>
                  Medium
                </span>
                <span>
                  <span className="lp-heat-scale count-3">
                    <HeatLogoMark className="lp-heat-mark" />
                    <HeatLogoMark className="lp-heat-mark" />
                    <HeatLogoMark className="lp-heat-mark" />
                  </span>
                  Strong
                </span>
              </div>
            </div>
          </LandingSection>
        </Reveal>

        <Reveal>
          <LandingSection
            id="pricing"
            title="Hosted pricing"
            subtitle="Start free by self-hosting, or let us run the rendering for you."
          >
            <div className="lp-pricing">
              {PRICING.map((tier) => (
                <div
                  className={`lp-price-card${tier.featured ? " featured" : ""}`}
                  key={tier.name}
                >
                  {tier.featured && <span className="lp-badge">Most popular</span>}
                  <h3>{tier.name}</h3>
                  <div className="lp-price">
                    <span className="lp-price-amount">{tier.price}</span>
                    <span className="lp-price-cadence">{tier.cadence}</span>
                  </div>
                  <p className="lp-price-blurb">{tier.blurb}</p>
                  <ul className="lp-price-features">
                    {tier.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  {tier.cta.external ? (
                    <a
                      className="lp-price-cta"
                      href={tier.cta.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {tier.cta.label}
                    </a>
                  ) : (
                    <Link className="lp-price-cta" to={tier.cta.href}>
                      {tier.cta.label}
                    </Link>
                  )}
                </div>
              ))}
            </div>
            <p className={styles.pricingNote}>
              Hosted pricing is indicative while we finalize launch tiers. Prefer
              full control? Self-hosting is always free.
            </p>
          </LandingSection>
        </Reveal>

        <Reveal>
          <LandingSection spacing="normal">
            <div className={styles.ctaCard}>
              <h2>Open source. Run it yourself.</h2>
              <p>
                Popcorn Ready is open source. Clone it, bring your own model keys,
                and render unlimited videos on your own machine.
              </p>
              <pre className="lp-code">
                <code>
                  git clone {GITHUB_URL}.git{"\n"}
                  cd popcornready && pnpm install && pnpm dev
                </code>
              </pre>
              <div className="lp-cta-buttons">
                <a
                  className="lp-price-cta featured"
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on GitHub &rarr;
                </a>
                <Link className="lp-price-cta" to="/library/projects">
                  Open projects
                </Link>
              </div>
            </div>
          </LandingSection>
        </Reveal>
      </main>
      {pendingPrompt && (
        <AccountChoiceModal
          authConfigured={configured}
          error={modalError ?? authError}
          mode={modalMode}
          onClose={() => {
            if (!isSkippingAccount) setPendingPrompt(null);
          }}
          onCreateAccount={createAccount}
          onSkipAccount={() => void skipAccount()}
          skippingAccount={isSkippingAccount}
          targetLengthSec={pendingPrompt.targetLengthSec}
        />
      )}
    </div>
  );
}

interface AccountChoiceModalProps {
  authConfigured: boolean;
  error: string | null;
  mode: "choice" | "limit";
  onClose: () => void;
  onCreateAccount: () => void;
  onSkipAccount: () => void;
  skippingAccount: boolean;
  targetLengthSec: number;
}

function AccountChoiceModal({
  authConfigured,
  error,
  mode,
  onClose,
  onCreateAccount,
  onSkipAccount,
  skippingAccount,
  targetLengthSec,
}: AccountChoiceModalProps) {
  const guestLimitReached = mode === "limit";

  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="account-choice-title"
        aria-modal="true"
        className={styles.accountModal}
        role="dialog"
      >
        <button
          aria-label="Close"
          className={styles.modalClose}
          type="button"
          onClick={onClose}
        >
          X
        </button>
        <p className={styles.modalKicker}>Ready to generate</p>
        <h2 id="account-choice-title">Do you want to create an account?</h2>
        <p>
          {guestLimitReached
            ? "Create an account to make more videos and keep every project tied to your workspace."
            : `Create an account before starting, or skip this step and generate one ${targetLengthSec}-second video as a guest.`}
        </p>
        {!authConfigured && (
          <p className={styles.modalError}>
            Supabase auth is not configured in this environment.
          </p>
        )}
        {error && <p className={styles.modalError}>{error}</p>}
        <div className={styles.modalActions}>
          <button
            className={styles.modalPrimary}
            type="button"
            onClick={onCreateAccount}
          >
            Create account
          </button>
          <button
            className={styles.modalSecondary}
            type="button"
            onClick={onSkipAccount}
            disabled={!authConfigured || guestLimitReached || skippingAccount}
          >
            {skippingAccount ? "Starting guest session..." : "Skip this step"}
          </button>
        </div>
      </section>
    </div>
  );
}
