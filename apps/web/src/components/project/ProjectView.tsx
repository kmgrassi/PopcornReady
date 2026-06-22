import { useMemo, useState } from "react";
import type {
  ProjectStoryboard,
  StoryboardPanel,
  V1Project,
  VideoBriefInput,
} from "@popcorn/shared/v1/types";
import type { ProjectWatchMedia } from "../../lib/api-client";
import { ImageWithSkeleton } from "../ui/ImageWithSkeleton";
// Reuse the project page's styles so the owner view and the public/read-only
// view are visually identical.
import styles from "../../routes/ProjectDetailPage.module.css";

export function formatDate(value?: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDuration(seconds?: VideoBriefInput["targetLengthSec"]) {
  if (!Number.isFinite(seconds)) return null;
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function storyboardStats(storyboard: ProjectStoryboard | null) {
  if (!storyboard) return { scenes: 0, beats: 0, panels: 0 };
  return storyboard.scenes.reduce(
    (stats, scene) => {
      stats.scenes += 1;
      stats.beats += scene.beats.length;
      stats.panels += scene.beats.reduce((count, beat) => count + beat.panels.length, 0);
      return stats;
    },
    { scenes: 0, beats: 0, panels: 0 },
  );
}

export function firstPanels(storyboard: ProjectStoryboard | null, limit: number) {
  if (!storyboard) return [];
  return storyboard.scenes
    .flatMap((scene) => scene.beats)
    .flatMap((beat) => {
      const selected = beat.panels.find((panel) => panel.isSelected);
      return selected ? [selected] : beat.panels.slice(0, 1);
    })
    .slice(0, limit);
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

export function StatusChip({ status }: { status: string }) {
  return <span className={`${styles.chip} ${statusClass(status)}`}>{titleCase(status)}</span>;
}

export function ProjectPoster({ name, posterUrl }: { name: string; posterUrl?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (posterUrl && posterUrl !== failedUrl) {
    return (
      <ImageWithSkeleton
        className={styles.poster}
        src={posterUrl}
        alt=""
        onError={() => setFailedUrl(posterUrl)}
      />
    );
  }
  return (
    <div className={`${styles.poster} ${styles.posterEmpty}`} aria-hidden="true">
      <span>{name.trim().charAt(0).toUpperCase() || "?"}</span>
    </div>
  );
}

export function ProjectHero({
  project,
  storyboard,
}: {
  project: V1Project;
  storyboard: ProjectStoryboard | null;
}) {
  const stats = useMemo(() => storyboardStats(storyboard), [storyboard]);
  return (
    <section className={styles.hero}>
      <ProjectPoster name={project.name} posterUrl={project.posterUrl} />
      <div className={styles.heroBody}>
        <div className={styles.metaRow}>
          <StatusChip status={project.status} />
          {project.visibility ? (
            <span>{project.visibility === "public" ? "Public" : "Private"}</span>
          ) : null}
          <span>Created {formatDate(project.createdAt)}</span>
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>Length</dt>
            <dd>{formatDuration(project.brief?.targetLengthSec) ?? "Unset"}</dd>
          </div>
          <div>
            <dt>Aspect</dt>
            <dd>{project.brief?.aspectRatio ?? "Unset"}</dd>
          </div>
          <div>
            <dt>Scenes</dt>
            <dd>{stats.scenes}</dd>
          </div>
          <div>
            <dt>Beats</dt>
            <dd>{stats.beats}</dd>
          </div>
        </dl>
      </div>
    </section>
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

export function ProjectBrief({ project }: { project: V1Project }) {
  const brief = project.brief;
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Brief</span>
          <h2>Project details</h2>
        </div>
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

function StoryboardPanelThumb({ panel }: { panel: StoryboardPanel }) {
  const image = panel.thumbnailUrl ?? panel.url;
  if (image) {
    return <ImageWithSkeleton className={styles.storyImage} src={image} alt="" loading="lazy" />;
  }
  return (
    <div className={`${styles.storyImage} ${styles.storyImageEmpty}`}>
      <span>{titleCase(panel.status)}</span>
    </div>
  );
}

// Read-only storyboard summary: stats + the lead panel images. No edit or
// generation controls — those stay on the owner's project page.
export function StoryboardPanels({ storyboard }: { storyboard: ProjectStoryboard | null }) {
  const stats = storyboardStats(storyboard);
  const panels = firstPanels(storyboard, 4);
  if (!storyboard) {
    return (
      <section className={styles.panel} id="storyboard">
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.eyebrow}>Storyboard</span>
            <h2>Scenes and beats</h2>
          </div>
        </div>
        <p className={styles.muted}>No storyboard has been generated for this project yet.</p>
      </section>
    );
  }
  return (
    <section className={styles.panel} id="storyboard">
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Storyboard</span>
          <h2>Scenes and beats</h2>
        </div>
      </div>
      <dl className={styles.storyStats}>
        <div>
          <dt>Status</dt>
          <dd>{titleCase(storyboard.status)}</dd>
        </div>
        <div>
          <dt>Scenes</dt>
          <dd>{stats.scenes}</dd>
        </div>
        <div>
          <dt>Beats</dt>
          <dd>{stats.beats}</dd>
        </div>
        <div>
          <dt>Panels</dt>
          <dd>{stats.panels}</dd>
        </div>
      </dl>
      {panels.length > 0 ? (
        <div className={styles.panelGrid}>
          {panels.map((panel) => (
            <StoryboardPanelThumb panel={panel} key={panel.id} />
          ))}
        </div>
      ) : (
        <p className={styles.muted}>
          Storyboard structure exists, but no panel images are ready yet.
        </p>
      )}
    </section>
  );
}

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

// The shared, read-only project view used by the public share page and the
// authenticated read-only surfaces.
export function ProjectView({
  project,
  storyboard,
  media,
}: {
  project: V1Project;
  storyboard: ProjectStoryboard | null;
  media: ProjectWatchMedia | null;
}) {
  return (
    <>
      <ProjectHero project={project} storyboard={storyboard} />
      {media ? <ProjectWatchVideo media={media} /> : null}
      <section className={styles.layout}>
        <ProjectBrief project={project} />
        <StoryboardPanels storyboard={storyboard} />
      </section>
    </>
  );
}
