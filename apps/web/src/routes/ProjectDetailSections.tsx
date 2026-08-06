import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ProjectVisibility,
  ProjectStoryboard,
  V1Project,
} from "@popcorn/shared/v1/types";
import type { ScriptDraft } from "@popcorn/shared/types";
import type { ProjectWatchMedia } from "../lib/api-client";
import { Button, ButtonLink } from "../components/ui/Button";
import { AssetCritiqueDialog } from "../components/ai-edit/AssetCritiqueDialog";
import { ErrorState } from "../components/ui/StateCard";
import { ImageWithSkeleton } from "../components/ui/ImageWithSkeleton";
import { VisibilityBadge } from "../components/ui/VisibilityBadge";
import { useSetProjectVisibilityMutation } from "../lib/queryClient";
import { assetLibraryPath } from "../lib/assetLibraryPath";
import { formatDate, formatDuration, titleCase } from "./project-detail-format";
import styles from "./ProjectDetailSections.module.css";

export function ProjectWatchVideo({ media }: { media: ProjectWatchMedia }) {
  return (
    <section className={styles.panel} id="watch">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Watch</span>
          <h2>Final video</h2>
        </div>
      </div>
      <video
        className={styles.watchVideo}
        src={media.url}
        poster={media.posterUrl}
        controls
        playsInline
        preload="metadata"
      />
    </section>
  );
}

export function ProjectConcept({
  project,
  projectId,
  readOnly,
  onRequestChanges,
}: {
  project: V1Project;
  projectId: string;
  readOnly: boolean;
  onRequestChanges?: () => void;
}) {
  const brief = project.brief;
  const title = brief?.oneBigIdea ?? brief?.goal ?? project.name;
  const visibility = project.visibility ?? "public";
  const nextVisibility: ProjectVisibility =
    visibility === "public" ? "private" : "public";
  const visibilityMutation = useSetProjectVisibilityMutation(projectId);
  const [confirmVisibility, setConfirmVisibility] = useState<ProjectVisibility | null>(null);
  const helperText =
    visibility === "public"
      ? "Visible in public discovery. Public assets can be shared."
      : "Only your workspace can view it. Media uses private links.";
  const shareUrl = publicProjectUrl(project.id);
  return (
    <section className={styles.hero} id="concept">
      {!readOnly && project.posterAssetId ? (
        <Link
          className={styles.posterLink}
          to={assetLibraryPath(project.posterAssetId, projectId)}
          aria-label={`View ${project.name} poster asset`}
        >
          <ProjectPoster name={project.name} posterUrl={project.posterUrl} />
        </Link>
      ) : (
        <ProjectPoster name={project.name} posterUrl={project.posterUrl} />
      )}
      <div className={styles.heroBody}>
        <div className={styles.metaRow}>
          <StatusChip status={project.status} />
          <VisibilityBadge visibility={visibility} />
          <span>Created {formatDate(project.createdAt)}</span>
          {!readOnly ? (
            <div className={styles.visibilityControl}>
              <Button
                variant="ghost"
                size="sm"
                disabled={visibilityMutation.isPending}
                isLoading={visibilityMutation.isPending}
                onClick={() => setConfirmVisibility(nextVisibility)}
              >
                {nextVisibility === "private" ? "Make private" : "Make public"}
              </Button>
              <span>{helperText}</span>
            </div>
          ) : null}
          {!readOnly && onRequestChanges ? (
            <Button variant="ghost" size="sm" onClick={onRequestChanges}>
              Request changes
            </Button>
          ) : null}
          {!readOnly ? (
            <ButtonLink
              variant="ghost"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/concept`}
            >
              Open concept
            </ButtonLink>
          ) : null}
        </div>
        {!readOnly ? (
          <ProjectShareAffordance
            visibility={visibility}
            shareUrl={shareUrl}
          />
        ) : null}
        <div>
          <span className={styles.eyebrow}>Concept</span>
          <h2 className={styles.conceptTitle}>
            {readOnly ? (
              title
            ) : (
              <Link
                className={styles.sectionTitleLink}
                to={`/projects/${encodeURIComponent(projectId)}/concept`}
              >
                {title}
              </Link>
            )}
          </h2>
          {brief?.strongestVisual ? (
            <p className={styles.conceptSummary}>{brief.strongestVisual}</p>
          ) : null}
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>Length</dt>
            <dd>{formatDuration(brief?.targetLengthSec) ?? "Unset"}</dd>
          </div>
          <div>
            <dt>Aspect</dt>
            <dd>{brief?.aspectRatio ?? "Unset"}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{brief?.format ?? "Unset"}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{brief?.platform ?? "Unset"}</dd>
          </div>
        </dl>
      </div>
      <ProjectVisibilityConfirmDialog
        visibility={confirmVisibility}
        pending={visibilityMutation.isPending}
        onCancel={() => setConfirmVisibility(null)}
        onConfirm={(visibility) => {
          visibilityMutation.mutate(visibility, {
            onSuccess: () => setConfirmVisibility(null),
          });
        }}
      />
    </section>
  );
}

function ProjectVisibilityConfirmDialog({
  visibility,
  pending,
  onCancel,
  onConfirm,
}: {
  visibility: ProjectVisibility | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (visibility: ProjectVisibility) => void;
}) {
  const titleId = useId();
  if (!visibility) return null;

  const isPublic = visibility === "public";
  const title = isPublic ? "Make this project public?" : "Make this project private?";
  const body = isPublic
    ? "People may be able to discover the project and view its public media. Private assets stay private."
    : "The project will leave public discovery and media delivery will be reconciled to private links.";

  return (
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onMouseDown={pending ? undefined : onCancel}
    >
      <div
        className={styles.confirmDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div>
          <span className={styles.eyebrow}>Visibility</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <p>{body}</p>
        <div className={styles.dialogActions}>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={() => onConfirm(visibility)}
            disabled={pending}
            isLoading={pending}
          >
            {isPublic ? "Make public" : "Make private"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProjectShareAffordance({
  visibility,
  shareUrl,
}: {
  visibility?: "public" | "private" | null;
  shareUrl: string;
}) {
  const isPublic = visibility === "public";
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function copyPublicLink() {
    setCopyState("idle");
    try {
      await copyTextToClipboard(shareUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  if (!isPublic) {
    return (
      <div className={styles.shareNotice} data-state="private">
        <p>Private projects do not have a public link.</p>
        <span>Make this project public before sharing it outside your workspace.</span>
      </div>
    );
  }

  return (
    <div className={styles.shareNotice} data-state="public">
      <div>
        <p>Public project</p>
        <span>Appears in discovery and can be shared with this link.</span>
      </div>
      <Button variant="secondary" size="sm" onClick={() => void copyPublicLink()}>
        {copyState === "copied" ? "Copied" : "Copy public link"}
      </Button>
      <span
        className={styles.shareStatus}
        data-state={copyState}
        role="status"
        aria-live="polite"
      >
        {copyState === "copied" ? "Public link copied." : ""}
        {copyState === "error" ? "Could not copy automatically." : ""}
      </span>
    </div>
  );
}

function publicProjectUrl(projectId: string) {
  const path = `/p/${encodeURIComponent(projectId)}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);
  if (!copied) throw new Error("Clipboard copy failed.");
}

export function ProjectBrief({
  project,
  projectId,
  readOnly,
  onRequestChanges,
}: {
  project: V1Project;
  projectId: string;
  readOnly: boolean;
  onRequestChanges?: () => void;
}) {
  const brief = project.brief;
  return (
    <section className={`${styles.panel} ${styles.compactPanel}`} id="brief">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Brief</span>
          <h2>Project direction</h2>
        </div>
        {!readOnly ? (
          <div className={styles.sectionHeaderActions}>
            {onRequestChanges ? (
              <Button variant="ghost" size="sm" onClick={onRequestChanges}>
                Request changes
              </Button>
            ) : null}
            <ButtonLink
              variant="ghost"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/brief`}
            >
              Open brief
            </ButtonLink>
          </div>
        ) : null}
      </div>
      {brief ? (
        <dl className={styles.detailList}>
          <DetailTerm label="Prompt" value={brief.goal} />
          <DetailTerm label="Audience" value={brief.audience} />
          <DetailTerm label="Style" value={brief.style} />
          <DetailTerm label="Format" value={brief.format} />
          <DetailTerm label="Platform" value={brief.platform} />
          <DetailTerm label="Hook" value={brief.hookQuestion} />
          <DetailTerm label="Payoff" value={brief.payoff} />
          <DetailTerm label="Call to action" value={brief.constraints?.callToAction} />
        </dl>
      ) : (
        <p className={styles.muted}>No brief has been saved for this project yet.</p>
      )}
    </section>
  );
}

export function ProjectScript({
  project,
  projectId,
  storyboard,
  activeScript,
  scriptAssetId,
  readOnly,
  onRequestChanges,
}: {
  project: V1Project;
  projectId: string;
  storyboard: ProjectStoryboard | null;
  activeScript: ScriptDraft | null;
  scriptAssetId: string | null;
  readOnly: boolean;
  onRequestChanges?: () => void;
}) {
  const [critiqueOpen, setCritiqueOpen] = useState(false);
  const scriptLines = storyboardScriptLines(storyboard);
  const narrationScript = activeScript
    ? activeScript.narration?.trim()
    : project.brief?.narration?.script?.trim();
  const activeScriptLines = activeScript?.scenes.flatMap((scene) => [
    ...(scene.narration
      ? [{ id: `${scene.id}-narration`, label: scene.title, text: scene.narration }]
      : []),
    ...scene.dialogue.map((line, index) => ({
      id: `${scene.id}-dialogue-${index}`,
      label: line.characterName ?? scene.title,
      text: line.text,
    })),
  ]) ?? [];
  const displayedLines = activeScript ? activeScriptLines : scriptLines;

  return (
    <section className={`${styles.panel} ${styles.compactPanel}`} id="script">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Script</span>
          <h2>Narration and dialogue</h2>
        </div>
        {!readOnly ? (
          <div className={styles.sectionHeaderActions}>
            {scriptAssetId && activeScript ? (
              <Button variant="secondary" size="sm" onClick={() => setCritiqueOpen(true)}>
                Receive feedback
              </Button>
            ) : null}
            {onRequestChanges ? (
              <Button variant="ghost" size="sm" onClick={onRequestChanges}>
                Request changes
              </Button>
            ) : null}
            <ButtonLink
              variant="ghost"
              size="sm"
              to={`/projects/${encodeURIComponent(projectId)}/script`}
            >
              Open script
            </ButtonLink>
          </div>
        ) : null}
      </div>
      {narrationScript ? <p className={styles.scriptBlock}>{narrationScript}</p> : null}
      {displayedLines.length > 0 ? (
        <ol className={styles.scriptList}>
          {displayedLines.map((line) => (
            <li key={line.id}>
              <span>{line.label}</span>
              <p>{line.text}</p>
            </li>
          ))}
        </ol>
      ) : !narrationScript ? (
        <p className={styles.muted}>No script or narrated storyboard moments are ready yet.</p>
      ) : null}
      <AssetCritiqueDialog
        open={critiqueOpen}
        projectId={projectId}
        assetId={scriptAssetId ?? ""}
        title="Review this script"
        subtitle="Ask about clarity, structure, pacing, dialogue, or tone."
        preview={
          <div className={styles.scriptBlock}>
            {[narrationScript, ...displayedLines.map((line) => line.text)]
              .filter((line): line is string => Boolean(line))
              .join("\n\n")}
          </div>
        }
        onClose={() => setCritiqueOpen(false)}
      />
    </section>
  );
}

export function ProjectDangerSection({
  project,
  deleting,
  error,
  onDelete,
}: {
  project: V1Project;
  deleting: boolean;
  error: Error | null;
  onDelete: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [expanded, setExpanded] = useState(false);
  const confirmed = confirmation === project.name;

  // Collapsed by default: the overview is read-optimized, so the destructive
  // flow only unfolds after an explicit step.
  return (
    <section className={`${styles.panel} ${styles.dangerPanel}`} id="danger">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Danger</span>
          <h2>Delete project</h2>
        </div>
        {!expanded ? (
          <div className={styles.sectionHeaderActions}>
            <Button
              variant="ghost"
              className={styles.dangerButton}
              onClick={() => setExpanded(true)}
            >
              Delete project…
            </Button>
          </div>
        ) : null}
      </div>
      {expanded ? (
        <>
          <p className={styles.muted}>
            Delete this project from your library. Runs, storyboards, and generated
            assets for this project will no longer appear in the app.
          </p>
          <label className={styles.confirmField}>
            <span>Type {project.name} to confirm</span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={deleting}
              autoComplete="off"
            />
          </label>
          <div className={styles.dangerActions}>
            <Button
              variant="ghost"
              disabled={deleting}
              onClick={() => {
                setExpanded(false);
                setConfirmation("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              className={styles.dangerButton}
              disabled={!confirmed || deleting}
              isLoading={deleting}
              onClick={onDelete}
            >
              Delete project
            </Button>
          </div>
          {error ? (
            <ErrorState
              title="Unable to delete project"
              body="We couldn't delete this project. Check your session and try again."
              error={error}
              onRetry={onDelete}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function ProjectPoster({
  name,
  posterUrl,
  className,
  emptyClassName,
}: {
  name: string;
  posterUrl?: string | null;
  className?: string;
  emptyClassName?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const posterClassName = className ?? styles.poster;
  if (posterUrl && posterUrl !== failedUrl) {
    return (
      <ImageWithSkeleton
        className={posterClassName}
        src={posterUrl}
        alt=""
        onError={() => setFailedUrl(posterUrl)}
      />
    );
  }
  return (
    <div className={`${posterClassName} ${emptyClassName ?? styles.posterEmpty}`} aria-hidden="true">
      <span>{name.trim().charAt(0).toUpperCase() || "?"}</span>
    </div>
  );
}

function DetailTerm({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`${styles.chip} ${statusClass(status)}`}>
      {titleCase(status)}
    </span>
  );
}

function statusClass(status: string) {
  if (status === "running" || status === "processing") return styles.statusRunning;
  if (status === "succeeded" || status === "ready" || status === "active") {
    return styles.statusSucceeded;
  }
  if (status === "failed" || status === "canceled" || status === "deleted") {
    return styles.statusFailed;
  }
  return "";
}

function storyboardScriptLines(storyboard: ProjectStoryboard | null) {
  if (!storyboard) return [];
  return storyboard.scenes.flatMap((scene) =>
    scene.beats.flatMap((beat) => {
      const text = beat.narration?.trim() || beat.dialogueSummary?.trim();
      if (!text) return [];
      return [
        {
          id: beat.id,
          label: `Scene ${scene.sceneIndex + 1}, beat ${beat.beatIndex + 1}`,
          text,
        },
      ];
    }),
  );
}
