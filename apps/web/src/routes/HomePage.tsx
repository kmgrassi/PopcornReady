import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AgentRunPreview } from "../components/AgentRunPreview";
import { Reveal } from "../components/Reveal";
import { AnonymousUpgradeBanner } from "../components/auth/AnonymousUpgradeBanner";
import { useAuth } from "../components/auth/AuthProvider";
import { FaqSection } from "../components/faq/FaqSection";
import {
  LandingSection,
  LandingSectionHeader,
} from "../components/landing/LandingSection";
import { WorkflowStages } from "../components/landing/WorkflowStages";
import { faqsForPlacement } from "../content/faqs";
import {
  buildPendingLandingPrompt,
  canStartGuestRun,
  guestRunGuardRemaining,
  pendingLandingPromptNavigationState,
  startPendingLandingPromptRun,
  type PendingLandingPrompt,
} from "../lib/guestGeneration";
import { preflightLandingFootage } from "../lib/landingUpload";
import { v1Api } from "../lib/api-client";
import { runProgressPath } from "../lib/quickStartRun";
import { drainShareTargetFiles } from "../lib/shareTargetFiles";
import { readSelectedFootage, type SelectedFootage } from "../lib/upload";
import { useUploadQueue } from "../lib/uploadQueue";
import { AccountChoiceModal } from "./home/AccountChoiceModal";
import { LandingComparisonHeatmap } from "./home/LandingComparisonHeatmap";
import {
  LandingPromptComposer,
  type UploadSourceMode,
} from "./home/LandingPromptComposer";
import { LandingPricing } from "./home/LandingPricing";
import { FEATURES, GITHUB_URL, PROMPT_MIN_LENGTH } from "./home/homeContent";
import styles from "./HomePage.module.css";

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    status,
    error: authError,
    configured,
    isAnonymous,
    signInAnonymous,
  } = useAuth();
  const uploadQueue = useUploadQueue();
  const [prompt, setPrompt] = useState("");
  const [targetLengthSec, setTargetLengthSec] = useState(30);
  const [pendingPrompt, setPendingPrompt] = useState<PendingLandingPrompt | null>(
    null,
  );
  const [modalMode, setModalMode] = useState<"choice" | "limit">("choice");
  const [modalError, setModalError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [shareTargetFootage, setShareTargetFootage] = useState<SelectedFootage[]>(
    [],
  );
  const [shareTargetError, setShareTargetError] = useState<string | null>(null);
  const [isSkippingAccount, setIsSkippingAccount] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [isPreparingUploadDraft, setIsPreparingUploadDraft] = useState(false);
  const [uploadDraftProjectId, setUploadDraftProjectId] = useState<string | null>(
    null,
  );
  const [uploadSourceMode, setUploadSourceMode] =
    useState<UploadSourceMode>("upload");
  const uploadItems = uploadDraftProjectId
    ? uploadQueue.projectItems(uploadDraftProjectId)
    : [];
  const normalizedPrompt = prompt.trim();
  const promptTooShort =
    normalizedPrompt.length > 0 && normalizedPrompt.length < PROMPT_MIN_LENGTH;
  const canSubmit =
    normalizedPrompt.length >= PROMPT_MIN_LENGTH &&
    status !== "loading" &&
    !isStartingRun;
  const remainingGuestRuns = useMemo(() => guestRunGuardRemaining(), []);
  const guestRunLabel =
    remainingGuestRuns === 1 ? "1 video" : `${remainingGuestRuns} videos`;
  const authDisabled = status === "disabled";
  const authIsResolving = status === "loading";
  const uploadIsBusy =
    authIsResolving ||
    isPreparingUploadDraft ||
    uploadItems.some((item) =>
      item.status === "queued" ||
      item.status === "uploading" ||
      item.status === "processing"
    );
  const hasSharedFootage = shareTargetFootage.length > 0;

  async function ensureUploadDraftProject(): Promise<string> {
    if (uploadDraftProjectId) return uploadDraftProjectId;
    if (authIsResolving) {
      throw new Error("Wait a moment while your session finishes loading.");
    }
    setIsPreparingUploadDraft(true);
    setUploadError(null);
    try {
      if (status !== "authenticated" && !authDisabled) {
        await signInAnonymous();
      }
      const { project } = await v1Api.createProject({
        name: "Mobile upload draft",
      });
      setUploadDraftProjectId(project.id);
      return project.id;
    } finally {
      setIsPreparingUploadDraft(false);
    }
  }

  async function handleLandingUploadFiles(files: FileList | null) {
    setUploadError(null);
    try {
      if (authIsResolving) {
        throw new Error("Wait a moment while your session finishes loading.");
      }
      const selected = await readSelectedFootage(files);
      const { accepted, errors } = preflightLandingFootage(
        selected,
        uploadItems.length,
      );
      if (errors.length > 0) setUploadError(errors.join(" "));
      if (accepted.length === 0) return;

      const projectId = await ensureUploadDraftProject();
      uploadQueue.enqueueUploads(projectId, accepted, { source: "landing" });
      navigate(`/projects/${encodeURIComponent(projectId)}/media`);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Could not prepare those files.",
      );
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shareTargetStatus = params.get("share-target");
    if (!shareTargetStatus) return;

    let cancelled = false;
    async function loadSharedFiles() {
      if (shareTargetStatus === "empty") {
        setShareTargetError("No video or image files were shared.");
        return;
      }
      if (shareTargetStatus === "failed") {
        setShareTargetError("Popcorn Ready could not read the shared files.");
        return;
      }

      try {
        const files = await drainShareTargetFiles();
        if (cancelled) return;
        if (files.length === 0) {
          setShareTargetError("No shared files were available.");
          return;
        }
        setShareTargetFootage(await readSelectedFootage(files));
        setShareTargetError(null);
      } catch (err) {
        if (!cancelled) {
          setShareTargetError(
            err instanceof Error
              ? err.message
              : "Popcorn Ready could not read the shared files.",
          );
        }
      }
    }

    void loadSharedFiles();
    return () => {
      cancelled = true;
    };
  }, [location.search]);

  async function startLandingRun(nextPendingPrompt: PendingLandingPrompt) {
    setModalError(null);
    setStartError(null);
    setIsStartingRun(true);
    try {
      const needsAnonymousSession = status !== "authenticated" && !authDisabled;
      if (needsAnonymousSession) {
        await signInAnonymous();
      }
      const result = await startPendingLandingPromptRun(nextPendingPrompt, {
        enforceGuestRunLimit: needsAnonymousSession || isAnonymous,
        selectedFootage: shareTargetFootage,
      });
      navigate(runProgressPath(result));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to start generation.";
      if (authDisabled || canStartGuestRun()) {
        setStartError(message);
      } else {
        setModalError(message);
        setPendingPrompt(nextPendingPrompt);
        setModalMode("limit");
      }
    } finally {
      setIsStartingRun(false);
    }
  }

  function openAccountChoice() {
    if (!canSubmit) return;

    const nextPendingPrompt = buildPendingLandingPrompt(
      normalizedPrompt,
      targetLengthSec,
    );
    setModalError(null);
    setStartError(null);

    if (status === "authenticated" || authDisabled || canStartGuestRun()) {
      void startLandingRun(nextPendingPrompt);
      return;
    }

    setPendingPrompt(nextPendingPrompt);
    setModalMode("limit");
  }

  function createAccount() {
    if (pendingPrompt) {
      navigate("/signup", {
        state: pendingLandingPromptNavigationState(pendingPrompt),
      });
    }
  }

  async function skipAccount() {
    if (
      !pendingPrompt ||
      isSkippingAccount ||
      isStartingRun ||
      modalMode === "limit"
    ) {
      return;
    }
    setModalError(null);
    setIsSkippingAccount(true);
    try {
      await startLandingRun(pendingPrompt);
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
            Let AI do the hard part:{" "}
            <span className="lp-accent">stitch the clips.</span>
          </h1>
          <p className="lp-lede">
            Popcorn Ready gives AI video the missing workflow: it plans the
            scenes, generates the shots, edits the sequence, checks continuity,
            and refines the final cut — one AI-native production, not a pile of
            clips.
          </p>
          <LandingPromptComposer
            authIsResolving={authIsResolving}
            canSubmit={canSubmit}
            guestRunLabel={guestRunLabel}
            hasSharedFootage={hasSharedFootage}
            isPreparingUploadDraft={isPreparingUploadDraft}
            isStartingRun={isStartingRun}
            onFilesSelected={(files) => void handleLandingUploadFiles(files)}
            onPromptChange={setPrompt}
            onRetryUpload={uploadQueue.retryUpload}
            onSubmit={openAccountChoice}
            onTargetLengthChange={setTargetLengthSec}
            onUploadSourceModeChange={setUploadSourceMode}
            prompt={prompt}
            promptTooShort={promptTooShort}
            shareTargetError={shareTargetError}
            shareTargetFootage={shareTargetFootage}
            startError={startError}
            targetLengthSec={targetLengthSec}
            uploadError={uploadError}
            uploadIsBusy={uploadIsBusy}
            uploadItems={uploadItems}
            uploadSourceMode={uploadSourceMode}
          />
          <AnonymousUpgradeBanner className={styles.retentionBanner} />
        </section>

        <Reveal>
          <LandingSection
            spacing="tight"
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
            <LandingComparisonHeatmap />
          </LandingSection>
        </Reveal>

        <Reveal>
          <LandingSection
            id="pricing"
            title="Pricing"
            subtitle="Self-host for free, or create an account and pay per credit when you use our hosted tokens."
          >
            <LandingPricing />
          </LandingSection>
        </Reveal>

        <Reveal>
          <LandingSection spacing="normal" align="start">
            <FaqSection faqs={faqsForPlacement("landing")} />
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
            if (!isSkippingAccount) {
              setPendingPrompt(null);
            }
          }}
          onCreateAccount={createAccount}
          onSkipAccount={() => void skipAccount()}
          skippingAccount={isSkippingAccount}
          targetLengthSec={pendingPrompt.targetLengthSec}
          variant="prompt"
        />
      )}
    </div>
  );
}
