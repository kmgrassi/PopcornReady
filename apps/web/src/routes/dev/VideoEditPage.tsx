// Dev-only harness: upload a video, describe an edit ("add a dinosaur sitting
// on the couch"), and watch the AI produce an edited clip. Talks to the
// flag-gated /api/v1/dev/video-edit endpoint (ENABLE_VIDEO_EDIT_HARNESS).
//
// The edit is a true video edit: the uploaded footage goes to the Gemini
// Files API and Gemini Omni Flash applies the instruction directly — no
// masks, no frame extraction.

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import styles from "./VideoEditPage.module.css";

const API_BASE = (import.meta.env.VITE_API_URL?.trim() || "").replace(/\/$/, "");

type JobStage = "uploading" | "editing" | "downloading" | "done" | "error";

interface JobStatus {
  jobId: string;
  stage: JobStage;
  error: string | null;
  artifacts: Partial<Record<"source" | "video", string>>;
}

const STAGES: Array<{ key: JobStage; label: string }> = [
  { key: "uploading", label: "Uploading your video to Gemini" },
  { key: "editing", label: "Editing the video (Gemini Omni)" },
  { key: "downloading", label: "Fetching the edited video" },
  { key: "done", label: "Done" },
];

function stageIndex(stage: JobStage): number {
  const index = STAGES.findIndex((entry) => entry.key === stage);
  return index === -1 ? STAGES.length : index;
}

async function fetchJobStatus(jobId: string): Promise<JobStatus> {
  const response = await fetch(`${API_BASE}/api/v1/dev/video-edit/${jobId}`);
  if (!response.ok) throw new Error(`Status check failed (${response.status}).`);
  return (await response.json()) as JobStatus;
}

export function VideoEditPage() {
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState(
    "Add a realistic dinosaur sitting on the couch"
  );
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sourcePreviewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file]
  );

  const { data: job } = useQuery({
    queryKey: ["dev-video-edit", jobId],
    queryFn: () => fetchJobStatus(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const stage = query.state.data?.stage;
      return stage === "done" || stage === "error" ? false : 4000;
    },
  });

  const running = Boolean(
    jobId && job?.stage !== "done" && job?.stage !== "error"
  );

  async function startJob() {
    if (!file || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setJobId(null);
    try {
      const response = await fetch(
        `${API_BASE}/api/v1/dev/video-edit?prompt=${encodeURIComponent(prompt)}`,
        {
          method: "POST",
          headers: { "Content-Type": file.type || "video/mp4" },
          body: file,
        }
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Upload failed (${response.status}). ${detail.slice(0, 200)}`);
      }
      const body = (await response.json()) as JobStatus;
      setJobId(body.jobId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const artifactUrl = (key: keyof JobStatus["artifacts"]) => {
    const artifactPath = job?.artifacts?.[key];
    return artifactPath ? `${API_BASE}${artifactPath}` : null;
  };

  const currentStageIndex = job ? stageIndex(job.stage) : -1;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>AI video edit</h1>
        <p className={styles.subtitle}>
          Upload a short clip, describe the change, and get back an AI-edited
          version of the scene.
        </p>
      </header>

      <section className={styles.composer}>
        <label className={styles.dropzone}>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className={styles.fileInput}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? (
            <span className={styles.fileName}>
              {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
            </span>
          ) : (
            <span className={styles.dropHint}>
              Tap to choose a video (a few seconds is plenty)
            </span>
          )}
        </label>

        <textarea
          className={styles.prompt}
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the edit, e.g. add a dinosaur sitting on the couch"
        />

        <button
          type="button"
          className={styles.cta}
          disabled={!file || !prompt.trim() || submitting || running}
          onClick={() => void startJob()}
        >
          {submitting ? "Uploading…" : running ? "Editing…" : "Edit my video"}
        </button>

        {submitError ? <p className={styles.error}>{submitError}</p> : null}
      </section>

      {job ? (
        <section className={styles.progress} aria-live="polite">
          <ol className={styles.stageList}>
            {STAGES.map((stage, index) => {
              const state =
                job.stage === "error"
                  ? index < currentStageIndex
                    ? "done"
                    : index === currentStageIndex
                      ? "failed"
                      : "pending"
                  : index < currentStageIndex ||
                      (job.stage === "done" && stage.key === "done")
                    ? "done"
                    : index === currentStageIndex
                      ? "active"
                      : "pending";
              return (
                <li key={stage.key} className={styles.stageItem} data-state={state}>
                  <span className={styles.stageDot} aria-hidden="true" />
                  {stage.label}
                </li>
              );
            })}
          </ol>
          {job.stage === "error" ? (
            <p className={styles.error}>{job.error || "The edit failed."}</p>
          ) : null}
        </section>
      ) : null}

      {(sourcePreviewUrl || job) && (
        <section className={styles.results}>
          <div className={styles.resultGrid}>
            {sourcePreviewUrl ? (
              <figure className={styles.resultCell}>
                <video src={sourcePreviewUrl} controls muted playsInline />
                <figcaption>Your video</figcaption>
              </figure>
            ) : null}
            {artifactUrl("video") ? (
              <figure className={styles.resultCell}>
                <video src={artifactUrl("video") ?? undefined} controls playsInline />
                <figcaption>
                  Edited video
                  {" · "}
                  <a
                    className={styles.artifactLink}
                    href={artifactUrl("video") ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in new tab
                  </a>
                </figcaption>
              </figure>
            ) : null}
          </div>
        </section>
      )}

      <footer className={styles.note}>
        Dev harness. Your footage is edited directly by Gemini Omni Flash
        (preview): the model finds the region to change from the instruction
        alone. The video is uploaded to the Gemini Files API under your API
        key.
      </footer>
    </div>
  );
}
