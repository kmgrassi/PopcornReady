import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AssetKind } from "@popcorn/shared/v1/types";
import { CloseButton } from "../ui/CloseButton";
import { ImageWithSkeleton } from "../ui/ImageWithSkeleton";
import { modelPurposeForAssetKind } from "../../lib/modelOptions";
import { RegenerateAssetDialog } from "./RegenerateAssetDialog";
import styles from "./MediaViewer.module.css";

export interface MediaViewerItem {
  id: string;
  kind: AssetKind;
  title: string;
  url?: string | null;
  thumbnailUrl?: string | null;
  filename?: string | null;
  projectName?: string | null;
  durationSec?: number | null;
  expiresAt?: string | null;
}

export interface RefreshedMediaUrls {
  url: string | null;
  thumbnailUrl?: string | null;
  expiresAt?: string | null;
}

export interface MediaViewerProps {
  item: MediaViewerItem | null;
  hasPrevious?: boolean;
  hasNext?: boolean;
  actions?: ReactNode;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onRefresh?: (item: MediaViewerItem) => Promise<RefreshedMediaUrls>;
  // Re-run image generation for an asset with no deliverable URL. Resolve with
  // the now-live media. Reject with an error whose `.code === "prompt_required"`
  // to make the viewer pop a prompt-entry dialog instead of surfacing an error.
  onRegenerate?: (
    item: MediaViewerItem,
    input?: { prompt?: string; provider?: string; model?: string }
  ) => Promise<RefreshedMediaUrls>;
}

function isPromptRequired(error: unknown): boolean {
  return Boolean(error) && (error as { code?: string }).code === "prompt_required";
}

function formatDuration(seconds?: number | null) {
  if (!Number.isFinite(seconds ?? NaN)) return null;
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function isNearExpiry(expiresAt?: string | null) {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt).getTime();
  return Number.isFinite(expires) && expires - Date.now() < 60_000;
}

export function MediaViewer({
  item,
  hasPrevious = false,
  hasNext = false,
  actions,
  onClose,
  onPrevious,
  onNext,
  onRefresh,
  onRegenerate,
}: MediaViewerProps) {
  const [media, setMedia] = useState<MediaViewerItem | null>(item);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const lastRefreshIdRef = useRef<string | null>(null);

  useEffect(() => {
    setMedia(item);
    setRefreshError(null);
    setRegenError(null);
    setRegenerating(false);
    setPromptOpen(false);
    lastRefreshIdRef.current = null;
  }, [item]);

  const refresh = useCallback(async () => {
    if (!media || !onRefresh || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const next = await onRefresh(media);
      setMedia((current) =>
        current && current.id === media.id
          ? {
              ...current,
              url: next.url,
              thumbnailUrl: next.thumbnailUrl ?? current.thumbnailUrl,
              expiresAt: next.expiresAt ?? current.expiresAt,
            }
          : current
      );
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Unable to refresh media URL.");
    } finally {
      setRefreshing(false);
    }
  }, [media, onRefresh, refreshing]);

  const regenerate = useCallback(
    async (input?: { prompt?: string; provider?: string; model?: string }) => {
      if (!media || !onRegenerate || regenerating) return;
      setRegenerating(true);
      setRegenError(null);
      try {
        const next = await onRegenerate(media, input);
        setMedia((current) =>
          current && current.id === media.id
            ? {
                ...current,
                url: next.url,
                thumbnailUrl: next.thumbnailUrl ?? next.url ?? current.thumbnailUrl,
                expiresAt: next.expiresAt ?? current.expiresAt,
              }
            : current
        );
        setPromptOpen(false);
      } catch (error) {
        if (isPromptRequired(error)) {
          // No saved prompt to reuse — collect one from the user instead.
          setPromptOpen(true);
        } else {
          setRegenError(
            error instanceof Error ? error.message : "Unable to regenerate this image."
          );
        }
      } finally {
        setRegenerating(false);
      }
    },
    [media, onRegenerate, regenerating]
  );

  useEffect(() => {
    if (!media || !onRefresh || !isNearExpiry(media.expiresAt)) return;
    if (lastRefreshIdRef.current === media.id) return;
    lastRefreshIdRef.current = media.id;
    void refresh();
  }, [media, onRefresh, refresh]);

  useEffect(() => {
    if (!media) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && hasPrevious) onPrevious?.();
      if (event.key === "ArrowRight" && hasNext) onNext?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [hasNext, hasPrevious, media, onClose, onNext, onPrevious]);

  if (!media) return null;

  const title = media.title || media.filename || media.id;
  const duration = formatDuration(media.durationSec);
  const canRender = Boolean(media.url || media.thumbnailUrl);

  const handleMediaError = () => {
    if (!onRefresh || lastRefreshIdRef.current === media.id) return;
    lastRefreshIdRef.current = media.id;
    void refresh();
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={title}>
      <button className={styles.backdrop} type="button" aria-label="Close media viewer" onClick={onClose} />
      <section className={styles.dialog}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <h2>{title}</h2>
            <div className={styles.meta}>
              <span>{media.kind}</span>
              {duration ? <span>{duration}</span> : null}
              {media.projectName ? <span>{media.projectName}</span> : null}
            </div>
          </div>
          <CloseButton className={styles.iconButton} onClick={onClose} />
        </header>

        <div className={styles.stage}>
          {hasPrevious ? (
            <button className={`${styles.navButton} ${styles.prevButton}`} type="button" onClick={onPrevious} aria-label="Previous media">
              ‹
            </button>
          ) : null}

          {canRender && media.kind === "image" ? (
            <ImageWithSkeleton className={styles.visualMedia} src={media.url ?? media.thumbnailUrl ?? ""} alt={title} fit="contain" onError={handleMediaError} />
          ) : null}
          {canRender && media.kind === "video" ? (
            <video className={styles.visualMedia} src={media.url ?? undefined} poster={media.thumbnailUrl ?? undefined} controls preload="metadata" onError={handleMediaError} />
          ) : null}
          {canRender && media.kind === "audio" ? (
            <div className={styles.audioPanel}>
              <div className={styles.audioGlyph}>Audio</div>
              <audio src={media.url ?? undefined} controls preload="metadata" onError={handleMediaError} />
            </div>
          ) : null}
          {!canRender ? (
            <div className={styles.emptyState}>
              <strong>No playable URL</strong>
              <span>This asset is not viewable until the API projects a signed media URL.</span>
              {onRegenerate && media.kind === "image" ? (
                <button
                  className={styles.regenerateButton}
                  type="button"
                  onClick={() => void regenerate()}
                  disabled={regenerating}
                >
                  {regenerating ? "Regenerating…" : "Regenerate image"}
                </button>
              ) : null}
            </div>
          ) : null}

          {hasNext ? (
            <button className={`${styles.navButton} ${styles.nextButton}`} type="button" onClick={onNext} aria-label="Next media">
              ›
            </button>
          ) : null}
        </div>

        {(refreshing || refreshError || (regenError && !promptOpen)) ? (
          <div className={styles.status} role={refreshError || regenError ? "alert" : "status"}>
            {refreshing
              ? "Refreshing media URL..."
              : refreshError ?? regenError}
          </div>
        ) : null}
        {actions ? <footer className={styles.actions}>{actions}</footer> : null}
      </section>

      <RegenerateAssetDialog
        open={promptOpen}
        message="This image doesn't have a saved prompt. Enter one to regenerate it."
        pending={regenerating}
        error={regenError}
        modelPurpose={media.kind === "image" ? modelPurposeForAssetKind("image") : null}
        onSubmit={(prompt, generationModel) =>
          void regenerate({
            prompt,
            provider: generationModel?.provider,
            model: generationModel?.model,
          })
        }
        onCancel={() => {
          setPromptOpen(false);
          setRegenError(null);
        }}
      />
    </div>
  );
}
