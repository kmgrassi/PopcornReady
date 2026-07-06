import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { VideoBriefInput } from "@popcorn/shared/v1/types";
import { AgentRunPreview } from "../components/AgentRunPreview";
import { HeatLogoMark } from "../components/HeatLogoMark";
import { Reveal } from "../components/Reveal";
import { AnonymousUpgradeBanner } from "../components/auth/AnonymousUpgradeBanner";
import { useAuth } from "../components/auth/AuthProvider";
import { FaqSection } from "../components/faq/FaqSection";
import {
  LandingSection,
  LandingSectionHeader,
} from "../components/landing/LandingSection";
import { WorkflowStages } from "../components/landing/WorkflowStages";
import { CloseButton } from "../components/ui/CloseButton";
import { faqsForPlacement } from "../content/faqs";
import {
  buildPendingLandingPrompt,
  canStartGuestRun,
  guestRunGuardRemaining,
  pendingLandingPromptNavigationState,
  startPendingLandingPromptRun,
  type PendingLandingPrompt,
} from "../lib/guestGeneration";
import {
  formatUploadSize,
  LANDING_FOOTAGE_ACCEPT,
  LANDING_MAX_FILES,
  LANDING_MAX_FILE_SIZE_BYTES,
  newLandingUploadId,
  preflightLandingFootage,
  registerLandingUpload,
  type LandingUploadItem,
} from "../lib/landingUpload";
import { v1Api } from "../lib/api-client";
import { recordGuestRunStarted } from "../lib/guestRunLimit";
import { runProgressPath } from "../lib/quickStartRun";
import {
  drainShareTargetFiles,
  sharedFootageNames,
} from "../lib/shareTargetFiles";
import { readSelectedFootage, type SelectedFootage } from "../lib/upload";
import styles from "./HomePage.module.css";

const GITHUB_URL = "https://github.com/kmgrassi/popcornready";
const PROMPT_MIN_LENGTH = 12;
const LENGTH_OPTIONS = [15, 30, 45, 60];

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

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
    body: "Requests flow through the agent and update the selected assets.",
  },
  {
    title: "Inspectable & safe",
    body: "Every cut traces back to source clips, prompts, actions, and selected assets.",
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
    "Popcorn Ready produces a structured timeline from graph-linked assets, so the output remains inspectable even though edits are AI-driven.",
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

function buildLandingUploadBrief(
  goal: string,
  targetLengthSec: number,
  assetIds: string[],
): VideoBriefInput {
  return {
    goal: goal.trim(),
    targetLengthSec,
    aspectRatio: "9:16",
    platform: "tiktok",
    format: "visual_reveal",
    style: "fast-paced social montage from uploaded phone clips",
    constraints: {
      mustUseAssetIds: assetIds,
    },
  };
}

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
  const [prompt, setPrompt] = useState("");
  const [targetLengthSec, setTargetLengthSec] = useState(30);
  const [pendingPrompt, setPendingPrompt] = useState<PendingLandingPrompt | null>(
    null,
  );
  const [pendingUploadPrompt, setPendingUploadPrompt] =
    useState<PendingLandingPrompt | null>(null);
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
  const [uploadItems, setUploadItems] = useState<LandingUploadItem[]>([]);
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
  const readyUploadAssetIds = uploadItems
    .filter((item) => item.status === "ready" && item.assetId)
    .map((item) => item.assetId as string);
  const uploadCanSubmit =
    readyUploadAssetIds.length > 0 &&
    normalizedPrompt.length >= PROMPT_MIN_LENGTH &&
    !uploadIsBusy &&
    !isStartingRun;
  const hasSharedFootage = shareTargetFootage.length > 0;

  function updateUploadItem(
    id: string,
    patch: Partial<LandingUploadItem>,
  ): void {
    setUploadItems((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

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

  async function uploadLandingItems(
    projectId: string,
    itemsToUpload: LandingUploadItem[],
  ): Promise<void> {
    let cursor = 0;
    const workerCount = Math.min(2, itemsToUpload.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (cursor < itemsToUpload.length) {
          const item = itemsToUpload[cursor];
          cursor += 1;
          updateUploadItem(item.id, {
            status: "uploading",
            progress: Math.max(1, item.progress),
            error: undefined,
          });
          try {
            const asset = await registerLandingUpload(projectId, item, (progress) =>
              updateUploadItem(item.id, { progress }),
            );
            updateUploadItem(item.id, {
              status: "ready",
              progress: 100,
              assetId: asset.id,
            });
          } catch (err) {
            updateUploadItem(item.id, {
              status: "failed",
              error: err instanceof Error ? err.message : "Upload failed.",
            });
          }
        }
      }),
    );
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

      const nextItems = accepted.map<LandingUploadItem>((footage) => ({
        id: newLandingUploadId(),
        file: footage.file,
        name: footage.name,
        sizeBytes: footage.sizeBytes,
        durationSec: footage.durationSec,
        status: "queued",
        progress: 0,
      }));
      setUploadItems((items) => [...items, ...nextItems]);
      const projectId = await ensureUploadDraftProject();
      await uploadLandingItems(projectId, nextItems);
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

  async function retryLandingUpload(item: LandingUploadItem) {
    setUploadError(null);
    const projectId = await ensureUploadDraftProject();
    await uploadLandingItems(projectId, [{ ...item, progress: 0, status: "queued" }]);
  }

  async function startLandingUploadRun(nextPendingPrompt: PendingLandingPrompt) {
    setModalError(null);
    setStartError(null);
    setUploadError(null);
    setIsStartingRun(true);
    try {
      if (!uploadDraftProjectId) {
        throw new Error("Pick at least one clip before starting.");
      }
      if (readyUploadAssetIds.length === 0) {
        throw new Error("Wait for at least one clip to finish uploading.");
      }
      const needsAnonymousQuota =
        !authDisabled && (status !== "authenticated" || isAnonymous);
      if (needsAnonymousQuota && !canStartGuestRun()) {
        throw new Error("Create an account to make more guest videos.");
      }

      const brief = buildLandingUploadBrief(
        nextPendingPrompt.goal,
        nextPendingPrompt.targetLengthSec,
        readyUploadAssetIds,
      );
      const { briefVersion } = await v1Api.createBriefVersion(
        uploadDraftProjectId,
        brief,
      );
      const { runId } = await v1Api.startUploadedFootageGenerationRun(
        uploadDraftProjectId,
        {
          briefVersionId: briefVersion.id,
          assetIds: readyUploadAssetIds,
          mode: "hybrid",
          allowGeneratedGapFill: true,
          showCaptions: true,
        },
      );

      if (!runId) {
        throw new Error("Generation started without a run ID.");
      }
      if (needsAnonymousQuota) recordGuestRunStarted();
      navigate(runProgressPath({ projectId: uploadDraftProjectId, runId }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to start generation.";
      if (modalMode === "choice") setModalError(message);
      else setStartError(message);
      setUploadError(message);
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

  function openUploadAccountChoice() {
    if (!uploadCanSubmit) return;

    const nextPendingPrompt = buildPendingLandingPrompt(
      normalizedPrompt,
      targetLengthSec,
    );
    setModalError(null);
    setStartError(null);
    setUploadError(null);

    if (authDisabled || (status === "authenticated" && !isAnonymous)) {
      void startLandingUploadRun(nextPendingPrompt);
      return;
    }

    if (canStartGuestRun()) {
      setPendingUploadPrompt(nextPendingPrompt);
      setModalMode("choice");
      return;
    }

    setPendingUploadPrompt(nextPendingPrompt);
    setModalMode("limit");
  }

  function createAccount() {
    if (pendingUploadPrompt) {
      setModalError("Use the account form here so the uploaded clips stay attached.");
      return;
    }
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

  async function skipUploadAccount() {
    if (
      !pendingUploadPrompt ||
      isSkippingAccount ||
      isStartingRun ||
      modalMode === "limit"
    ) {
      return;
    }
    setModalError(null);
    setIsSkippingAccount(true);
    try {
      await startLandingUploadRun(pendingUploadPrompt);
    } catch (err) {
      setModalError(
        err instanceof Error ? err.message : "Unable to start uploaded-footage run.",
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
          <form
            className={styles.promptComposer}
            onSubmit={(event) => {
              event.preventDefault();
              if (readyUploadAssetIds.length > 0) {
                openUploadAccountChoice();
              } else {
                openAccountChoice();
              }
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
            <div className={styles.uploadDrop}>
              <div>
                <strong>Or start from your clips</strong>
                <span>
                  Pick up to {LANDING_MAX_FILES} short videos or stills,{" "}
                  {formatUploadSize(LANDING_MAX_FILE_SIZE_BYTES)} each for now. Nothing
                  generates until you tap create.
                </span>
              </div>
              <label className={styles.uploadPick}>
                <input
                  type="file"
                  accept={LANDING_FOOTAGE_ACCEPT}
                  multiple
                  capture="environment"
                  onChange={(event) => {
                    void handleLandingUploadFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                  disabled={
                    authIsResolving ||
                    uploadItems.length >= LANDING_MAX_FILES ||
                    uploadIsBusy
                  }
                />
                {authIsResolving
                  ? "Loading session..."
                  : isPreparingUploadDraft
                  ? "Preparing..."
                  : "Upload clips"}
              </label>
            </div>
            {(uploadItems.length > 0 || uploadError) && (
              <div className={styles.uploadPanel} aria-live="polite">
                {uploadItems.length > 0 && (
                  <ul className={styles.uploadList}>
                    {uploadItems.map((item) => (
                      <li className={styles.uploadItem} key={item.id}>
                        <div className={styles.uploadItemHeader}>
                          <span>{item.name}</span>
                          <em>
                            {formatUploadSize(item.sizeBytes)} · {item.status}
                          </em>
                        </div>
                        <div
                          className={styles.uploadMeter}
                          aria-label={`${item.name} ${Math.round(item.progress)} percent ${item.status}`}
                        >
                          <span style={{ width: `${item.progress}%` }} />
                        </div>
                        {item.error && (
                          <div className={styles.uploadFailure}>
                            <span>{item.error}</span>
                            <button
                              type="button"
                              onClick={() => void retryLandingUpload(item)}
                              disabled={uploadIsBusy}
                            >
                              Retry
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {uploadError && <p className={styles.uploadError}>{uploadError}</p>}
              </div>
            )}
            {hasSharedFootage && (
              <section
                className={styles.sharedFootage}
                aria-label="Shared footage ready for upload"
              >
                <div>
                  <strong>
                    {shareTargetFootage.length === 1
                      ? "1 shared clip is ready"
                      : `${shareTargetFootage.length} shared clips are ready`}
                  </strong>
                  <p>
                    Add a brief, then create a run with these clips.
                  </p>
                </div>
                <ul>
                  {shareTargetFootage.map((item) => (
                    <li key={`${item.name}-${item.sizeBytes}`}>
                      <span>{item.name}</span>
                      <em>{formatBytes(item.sizeBytes)}</em>
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
                disabled={readyUploadAssetIds.length > 0 ? !uploadCanSubmit : !canSubmit}
              >
                {isStartingRun
                  ? "Starting..."
                  : readyUploadAssetIds.length > 0
                  ? `Create from ${readyUploadAssetIds.length} clip${
                      readyUploadAssetIds.length === 1 ? "" : "s"
                    }`
                  : `Create my ${targetLengthSec}-second video`}
              </button>
            </div>
            <p className={styles.promptHint}>
              {startError
                ? startError
                : uploadIsBusy
                ? "Uploading clips now. You can write the brief while they move."
                : shareTargetError
                ? shareTargetError
                : hasSharedFootage
                ? `Shared from your phone: ${sharedFootageNames(shareTargetFootage)}.`
                : promptTooShort
                ? `Add a little more detail before starting.`
                : readyUploadAssetIds.length > 0
                ? "Uploaded clips are ready. Add a brief, then create the run."
                : `Guests can start ${guestRunLabel} before creating an account.`}
            </p>
          </form>
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
            title="Pricing"
            subtitle="Self-host for free, or create an account and pay per credit when you use our hosted tokens."
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
              1 credit = $0.01 of hosted generation. Self-hosting and
              bring-your-own-key generation do not spend credits.
            </p>
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
      {(pendingPrompt || pendingUploadPrompt) && (
        <AccountChoiceModal
          authConfigured={configured}
          error={modalError ?? authError}
          mode={modalMode}
          onClose={() => {
            if (!isSkippingAccount) {
              setPendingPrompt(null);
              setPendingUploadPrompt(null);
            }
          }}
          onCreateAccount={createAccount}
          onSkipAccount={() =>
            pendingUploadPrompt ? void skipUploadAccount() : void skipAccount()
          }
          skippingAccount={isSkippingAccount}
          targetLengthSec={
            (pendingUploadPrompt ?? pendingPrompt)?.targetLengthSec ?? targetLengthSec
          }
          variant={pendingUploadPrompt ? "upload" : "prompt"}
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
  variant?: "prompt" | "upload";
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
  variant = "prompt",
}: AccountChoiceModalProps) {
  const guestLimitReached = mode === "limit";
  const isUpload = variant === "upload";

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

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
        <CloseButton className={styles.modalClose} onClick={onClose} />
        <p className={styles.modalKicker}>Ready to generate</p>
        <h2 id="account-choice-title">Do you want to create an account?</h2>
        <p>
          {guestLimitReached
            ? "Create an account to make more videos and keep every project tied to your workspace."
            : isUpload
            ? `Your clips are uploaded. Create an account in this guest workspace, or start one ${targetLengthSec}-second run now.`
            : `Create an account before starting, or skip this step and generate one ${targetLengthSec}-second video as a guest.`}
        </p>
        {isUpload && <AnonymousUpgradeBanner className={styles.inlineUpgrade} />}
        {!authConfigured && (
          <p className={styles.modalError}>
            Supabase auth is not configured in this environment.
          </p>
        )}
        {error && <p className={styles.modalError}>{error}</p>}
        <div
          className={
            isUpload
              ? `${styles.modalActions} ${styles.modalActionsSingle}`
              : styles.modalActions
          }
        >
          {!isUpload && (
            <button
              className={styles.modalPrimary}
              type="button"
              onClick={onCreateAccount}
            >
              Create account
            </button>
          )}
          <button
            className={styles.modalSecondary}
            type="button"
            onClick={onSkipAccount}
            disabled={!authConfigured || guestLimitReached || skippingAccount}
          >
            {skippingAccount
              ? "Starting guest session..."
              : isUpload
              ? "Create uploaded run"
              : "Skip this step"}
          </button>
        </div>
      </section>
    </div>
  );
}
