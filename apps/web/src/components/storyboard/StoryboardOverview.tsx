import { useMemo, useState } from "react";
import type {
  ProjectStoryboard,
  StoryboardStatus,
  V1Project,
} from "@popcorn/shared/v1/types";
import { Button, ButtonLink } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/StateCard";
import {
  StatusChecklist,
  type ChecklistItem,
} from "../ui/StatusChecklist";
import styles from "./StoryboardOverview.module.css";

// The storyboard route is the project's home base: a calm, read-first overview
// of the high-level assets (the poster image + the scene/beat structure) and
// where the project sits in the generation process. Editing the structure is a
// deliberate mode switch into the dense StoryboardEditor, surfaced here as the
// primary action rather than the default view.

const PIPELINE: { id: StoryboardStatus; label: string; detail: string }[] = [
  { id: "draft", label: "Storyboard drafted", detail: "Scenes and beats outlined" },
  { id: "generating", label: "Generating panels", detail: "Rendering storyboard frames" },
  { id: "ready", label: "Panels ready", detail: "Frames ready for review" },
  { id: "reviewing", label: "In review", detail: "Awaiting approval" },
  { id: "approved", label: "Approved", detail: "Locked for the timeline" },
];

const STATUS_TONE: Record<StoryboardStatus, "neutral" | "active" | "good"> = {
  draft: "neutral",
  generating: "active",
  ready: "active",
  reviewing: "active",
  approved: "good",
  archived: "neutral",
};

function titleCase(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function pipelineItems(status: StoryboardStatus): ChecklistItem[] {
  // "archived" is terminal; treat its history as fully complete.
  const activeIndex =
    status === "archived"
      ? PIPELINE.length
      : PIPELINE.findIndex((stage) => stage.id === status);
  return PIPELINE.map((stage, index) => ({
    id: stage.id,
    label: stage.label,
    detail: stage.detail,
    status:
      index < activeIndex ? "done" : index === activeIndex ? "active" : "pending",
  }));
}

function Poster({ name, posterUrl }: { name: string; posterUrl?: string | null }) {
  // Signed poster URLs can point at bytes that are gone (pre-cutover dev
  // assets); degrade to an initial-letter placeholder instead of a broken
  // image. Keyed to the failed URL so a refreshed URL retries automatically.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (posterUrl && posterUrl !== failedUrl) {
    return (
      <img
        className={styles.posterImg}
        src={posterUrl}
        alt={`${name} poster`}
        loading="lazy"
        onError={() => setFailedUrl(posterUrl)}
      />
    );
  }
  return (
    <div className={styles.posterEmpty} aria-hidden="true">
      <span>{name.trim().charAt(0).toUpperCase() || "?"}</span>
      <p>No poster yet</p>
    </div>
  );
}

export interface StoryboardOverviewProps {
  projectId: string;
  project?: V1Project;
  storyboard: ProjectStoryboard | null;
  onEdit: () => void;
}

export function StoryboardOverview({
  projectId,
  project,
  storyboard,
  onEdit,
}: StoryboardOverviewProps) {
  const scenes = storyboard?.scenes ?? [];
  const status: StoryboardStatus = storyboard?.status ?? "draft";
  const name = project?.name ?? "Untitled project";

  const stats = useMemo(() => {
    let beatCount = 0;
    let panelCount = 0;
    let renderedPanels = 0;
    let durationSec = 0;
    for (const scene of scenes) {
      beatCount += scene.beats.length;
      for (const beat of scene.beats) {
        durationSec += beat.durationSec ?? 0;
        for (const panel of beat.panels) {
          panelCount += 1;
          if (panel.imageAssetId) renderedPanels += 1;
        }
      }
    }
    return {
      sceneCount: scenes.length,
      beatCount,
      panelCount,
      renderedPanels,
      durationSec,
    };
  }, [scenes]);

  const hasStoryboard = Boolean(storyboard) && scenes.length > 0;
  const tone = STATUS_TONE[status];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.eyebrow}>Storyboard</p>
          <h1 className={styles.title}>{name}</h1>
          <p className={styles.subtitle}>
            {hasStoryboard
              ? `${stats.sceneCount} scene${stats.sceneCount === 1 ? "" : "s"} · ${stats.beatCount} beat${stats.beatCount === 1 ? "" : "s"} · ~${stats.durationSec}s`
              : "No storyboard structure yet."}
          </p>
        </div>
        <div className={styles.actions}>
          <Button variant="cta" onClick={onEdit}>
            {hasStoryboard ? "Edit storyboard" : "Build storyboard"}
          </Button>
          <ButtonLink
            variant="secondary"
            to={`/projects/${encodeURIComponent(projectId)}/watch`}
          >
            Watch
          </ButtonLink>
          <ButtonLink
            variant="ghost"
            to={`/library/runs?projectId=${encodeURIComponent(projectId)}`}
          >
            Runs
          </ButtonLink>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.posterWrap}>
          <Poster name={name} posterUrl={project?.posterUrl} />
        </div>

        <div className={styles.heroBody}>
          <Card padding="md" className={styles.processCard}>
            <div className={styles.processHead}>
              <h2 className={styles.cardTitle}>Process</h2>
              <span className={`${styles.badge} ${styles[tone]}`}>
                {titleCase(status)}
              </span>
            </div>
            <StatusChecklist items={pipelineItems(status)} />
          </Card>

          <div className={styles.statGrid}>
            <Stat label="Scenes" value={stats.sceneCount} />
            <Stat label="Beats" value={stats.beatCount} />
            <Stat
              label="Panels"
              value={
                stats.panelCount > 0
                  ? `${stats.renderedPanels}/${stats.panelCount}`
                  : "0"
              }
              hint={stats.panelCount > 0 ? "rendered" : undefined}
            />
            <Stat label="Runtime" value={`~${stats.durationSec}s`} />
          </div>
        </div>
      </section>

      <section className={styles.scenes}>
        <h2 className={styles.sectionTitle}>High-level assets</h2>
        {hasStoryboard ? (
          <div className={styles.sceneList}>
            {scenes.map((scene, index) => {
              const sceneDuration = scene.beats.reduce(
                (sum, beat) => sum + (beat.durationSec ?? 0),
                0,
              );
              return (
                <Card key={scene.id} padding="md" className={styles.sceneCard}>
                  <div className={styles.sceneHead}>
                    <span className={styles.sceneIndex}>{index + 1}</span>
                    <div className={styles.sceneHeadText}>
                      <h3 className={styles.sceneTitle}>
                        {scene.title || "Untitled scene"}
                      </h3>
                      <p className={styles.sceneMeta}>
                        {[scene.setting, scene.mood]
                          .filter(Boolean)
                          .join(" · ") || "No setting set"}
                        {sceneDuration > 0 ? ` · ~${sceneDuration}s` : ""}
                      </p>
                    </div>
                    <span
                      className={`${styles.itemBadge} ${styles[`item_${scene.status}`] ?? ""}`}
                    >
                      {titleCase(scene.status)}
                    </span>
                  </div>
                  <ol className={styles.beatList}>
                    {scene.beats.map((beat) => {
                      const rendered = beat.panels.filter(
                        (panel) => panel.imageAssetId,
                      ).length;
                      return (
                        <li key={beat.id} className={styles.beat}>
                          <span className={styles.beatIntent}>{beat.intent}</span>
                          <span className={styles.beatMeta}>
                            {beat.panels.length > 0 ? (
                              <span className={styles.panelTag}>
                                {rendered}/{beat.panels.length} panels
                              </span>
                            ) : (
                              <span className={styles.panelTagEmpty}>
                                No panels
                              </span>
                            )}
                            {beat.durationSec ? (
                              <span className={styles.beatDuration}>
                                {beat.durationSec}s
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No storyboard yet"
            body="Build the scene and beat structure to start generating panels for this project."
            action={
              <Button variant="primary" onClick={onEdit}>
                Build storyboard
              </Button>
            }
          />
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>
        {label}
        {hint ? <span className={styles.statHint}> {hint}</span> : null}
      </span>
    </div>
  );
}
