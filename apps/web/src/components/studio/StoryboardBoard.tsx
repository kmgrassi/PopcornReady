import { useId } from "react";
import type {
  GenerationRunStatus,
  GenerationStageItem,
} from "@popcorn/shared/v1/types";
import { JudgmentBadge } from "../evals/JudgmentBadge";
import type { StageItemAsset } from "../generation-progress/StageItemCard";
import { RegenerateImageButton } from "../media/RegenerateImageButton";
import styles from "./StoryboardBoard.module.css";

type StoryboardItem = GenerationStageItem & {
  boardLabel?: string;
};

export interface StoryboardBoardProps {
  items: StoryboardItem[];
  assetsByItemId?: Record<string, StageItemAsset | undefined>;
  title?: string;
  description?: string;
}

const STATUS_LABEL: Record<GenerationRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Ready",
  failed: "Failed",
  canceled: "Canceled",
};

function statusLabel(status: GenerationRunStatus): string {
  return STATUS_LABEL[status] ?? status;
}

function clampPercent(percent?: number): number {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

function itemRole(item: GenerationStageItem): string {
  if (item.kind === "video") return "Shot";
  return "Keyframe";
}

function TileMedia({
  item,
  asset,
}: {
  item: GenerationStageItem;
  asset?: StageItemAsset;
}) {
  const url = asset?.url;

  if (url && item.kind === "video") {
    return (
      <video
        className={styles.media}
        src={url}
        poster={asset?.thumbnailUrl}
        controls
        muted
        playsInline
        preload="metadata"
      />
    );
  }

  if (url) {
    return <img className={styles.media} src={url} alt={item.label} />;
  }

  return (
    <div className={styles.placeholder}>
      <span aria-hidden="true">{itemRole(item)}</span>
      {item.kind === "image" && item.assetId ? (
        <RegenerateImageButton assetId={item.assetId} initialPrompt={item.promptPreview} />
      ) : null}
    </div>
  );
}

function ProgressBar({ percent }: { percent?: number }) {
  const determinate = typeof percent === "number" && Number.isFinite(percent);
  const clamped = clampPercent(percent);

  return (
    <div
      className={styles.progressBar}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? clamped : undefined}
    >
      <div
        className={styles.progressFill}
        style={determinate ? { width: `${clamped}%` } : undefined}
      />
    </div>
  );
}

function TileDetails({ item }: { item: GenerationStageItem }) {
  const details = [
    ["Provider", item.provider],
    ["Asset", item.assetId],
    ["Artifact", item.artifactId],
    ["Retryable", item.retryable || item.error?.retryable ? "Yes" : null],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (!item.promptPreview && !item.error && details.length === 0) return null;

  return (
    <details className={styles.details}>
      <summary>Inspect tile</summary>
      {item.promptPreview ? (
        <p className={styles.prompt} title={item.promptPreview}>
          &ldquo;{item.promptPreview}&rdquo;
        </p>
      ) : null}
      {item.error ? (
        <p className={styles.error} role="alert">
          <span>{item.error.code ?? "error"}</span>
          {item.error.message ?? "This tile failed."}
        </p>
      ) : null}
      {details.length > 0 ? (
        <dl className={styles.metaList}>
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </details>
  );
}

export function StoryboardBoard({
  items,
  assetsByItemId,
  title = "Storyboard board",
  description = "Visual outputs are grouped as the emerging movie so each beat can be reviewed in sequence.",
}: StoryboardBoardProps) {
  const headingId = useId();

  if (items.length === 0) return null;

  const gridClassName =
    items.length === 5
      ? `${styles.grid} ${styles.gridFive}`
      : `${styles.grid} ${styles.gridFlexible}`;

  return (
    <section className={styles.board} aria-labelledby={headingId}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Storyboard</p>
          <h2 id={headingId} className={styles.title}>
            {title}
          </h2>
          <p className={styles.description}>{description}</p>
        </div>
        <span className={styles.count}>
          {items.length} {items.length === 1 ? "tile" : "tiles"}
        </span>
      </div>

      <div className={gridClassName}>
        {items.map((item, index) => {
          const asset = assetsByItemId?.[item.itemId];
          const label = item.boardLabel ?? `Beat ${index + 1}`;

          return (
            <article
              key={item.itemId}
              className={styles.tile}
              data-status={item.status}
              data-kind={item.kind}
            >
              <div className={styles.frame}>
                <TileMedia item={item} asset={asset} />
                <div className={styles.frameBadges}>
                  <span className={styles.role}>{itemRole(item)}</span>
                  <span className={`${styles.status} ${styles[`status_${item.status}`]}`}>
                    {statusLabel(item.status)}
                  </span>
                </div>
                {item.status === "running" ? (
                  <div className={styles.tileProgress}>
                    <ProgressBar percent={item.progressPercent} />
                  </div>
                ) : null}
              </div>

              <div className={styles.tileBody}>
                <div className={styles.tileTitleRow}>
                  <span className={styles.beatLabel}>{label}</span>
                  <JudgmentBadge judgment={item.judgment} compact />
                </div>
                <h3 className={styles.tileTitle} title={item.label}>
                  {item.label}
                </h3>
                {item.provider ? (
                  <p className={styles.provider}>{item.provider}</p>
                ) : null}
                <TileDetails item={item} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
