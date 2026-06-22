import { useState, type ReactNode } from "react";
import { ImageWithSkeleton } from "../ui/ImageWithSkeleton";
import { RegenerateImageButton } from "./RegenerateImageButton";
import styles from "./AssetImage.module.css";

export type AssetMediaKind = "image" | "video" | "audio";

// Still-working states: a blank frame here means "not done yet", not "broken",
// so we don't offer a recovery re-run. `generating` is the storyboard item
// contract's in-flight status — without it a panel that has an assetId but no
// URL yet would render the regenerate button mid-job (a duplicate rerun).
const IN_PROGRESS = new Set([
  "queued",
  "running",
  "processing",
  "pending",
  "generating",
]);

export interface AssetImageProps {
  // Identity + state. `assetId` enables the blank/failed recovery re-run.
  assetId?: string | null;
  kind?: AssetMediaKind;
  url?: string | null;
  thumbnailUrl?: string | null;
  status?: string | null;
  alt?: string;
  // The asset's saved prompt, used to prefill the regenerate dialog only if the
  // API reports no stored prompt to reuse.
  prompt?: string | null;

  // Styling hooks so each surface keeps its existing look.
  frameClassName?: string;
  mediaClassName?: string;
  placeholderClassName?: string;
  // Content shown when there is no deliverable media (e.g. a role label / beat #).
  placeholder?: ReactNode;
  // Surface chrome layered over healthy media (e.g. badges, a "click to edit"
  // hint). Non-interactive by default; render your own interactive bits inside.
  mediaOverlay?: ReactNode;

  // One-click re-run on a blank/failed IMAGE (a recovery action — the image is
  // undeliverable, so this restores a live URL; see docs/ui-interaction-model.md
  // §5). Default true. Set false when this card is rendered INSIDE a clickable
  // parent (a <button>): the parent must render the regenerate control as a
  // sibling overlay, since a nested <button> is invalid markup.
  allowRegenerate?: boolean;

  // Show native <video> controls. Off by default — dashboard/storyboard previews
  // are non-interactive posters, and a control tree nested in a clickable card
  // (<button>) is invalid markup that competes with the card's open handler.
  // Run-progress opts in. Ignored for non-video media.
  videoControls?: boolean;

  // Activate the healthy media (open the surface's viewer / Ask-the-AI modal).
  // Content edits on a healthy image route through the surface's modal, not here.
  onActivate?: () => void;
  // Class for the activate button, so a surface keeps its clickable styling
  // (border, hover, hint reveal). Only applies when onActivate is set.
  activateClassName?: string;
}

// Standardized media card: renders an asset's image/video (with an onError →
// placeholder fallback) and, when an image is blank or failed, surfaces a
// one-click recovery re-run. The single place media + the regenerate affordance
// live, so every surface behaves the same.
export function AssetImage({
  assetId,
  kind = "image",
  url,
  thumbnailUrl,
  status,
  alt = "",
  prompt,
  frameClassName,
  mediaClassName,
  placeholderClassName,
  placeholder,
  mediaOverlay,
  allowRegenerate = true,
  videoControls = false,
  onActivate,
  activateClassName,
}: AssetImageProps) {
  // Track every src that has 404'd/errored, so a video can fall through to its
  // thumbnail poster and an image can fall through to the placeholder.
  const [failedSrcs, setFailedSrcs] = useState<ReadonlySet<string>>(() => new Set());
  const markFailed = (s: string | null | undefined) => {
    if (!s) return;
    setFailedSrcs((prev) => (prev.has(s) ? prev : new Set(prev).add(s)));
  };
  const usable = (s: string | null | undefined): s is string =>
    Boolean(s) && !failedSrcs.has(s as string);

  // A video plays from `url`; never feed a thumbnail to <video src>. When a
  // video's bytes are gone, fall back to its thumbnail as a still poster image.
  const videoUrl = kind === "video" && usable(url) ? url : null;
  const thumb = usable(thumbnailUrl) ? thumbnailUrl : null;
  // The still image to render: the image asset's url (then its thumbnail), or a
  // dead video's thumbnail poster. Audio renders no still — it falls to the
  // placeholder.
  const stillSrc =
    kind === "video" ? thumb : kind === "image" ? (usable(url) ? url : thumb) : null;

  const renderedSrc = videoUrl ?? stillSrc;
  const hasMedia = renderedSrc != null;
  const inProgress = status != null && IN_PROGRESS.has(status);
  const recoverable =
    allowRegenerate &&
    kind === "image" &&
    Boolean(assetId) &&
    !inProgress &&
    (!hasMedia || status === "failed");

  const frame = [styles.frame, frameClassName].filter(Boolean).join(" ");
  const media = [styles.media, mediaClassName].filter(Boolean).join(" ");

  let body: ReactNode;
  if (videoUrl) {
    body = (
      <video
        className={media}
        src={videoUrl}
        poster={thumbnailUrl ?? undefined}
        muted
        playsInline
        preload="metadata"
        controls={videoControls}
        onError={() => markFailed(videoUrl)}
      />
    );
  } else if (stillSrc) {
    body = (
      <ImageWithSkeleton
        className={media}
        src={stillSrc}
        alt={alt}
        loading="lazy"
        fill
        onError={() => markFailed(stillSrc)}
      />
    );
  } else {
    body = (
      <div className={[styles.placeholder, placeholderClassName].filter(Boolean).join(" ")}>
        {placeholder}
      </div>
    );
  }

  const showsMedia = hasMedia;
  const overlay = showsMedia ? mediaOverlay : null;

  return (
    <div className={frame}>
      {showsMedia && onActivate ? (
        // Overlay lives INSIDE the activate button so the surface's hover/focus
        // selectors (e.g. ".panelButton:hover .editHint") still match.
        <button
          type="button"
          className={[styles.activate, activateClassName].filter(Boolean).join(" ")}
          onClick={onActivate}
          aria-label={alt || "Open"}
        >
          {body}
          {overlay}
        </button>
      ) : (
        <>
          {body}
          {overlay ? <div className={styles.overlay}>{overlay}</div> : null}
        </>
      )}
      {recoverable ? (
        <div className={styles.recovery}>
          <RegenerateImageButton assetId={assetId as string} prompt={prompt} />
        </div>
      ) : null}
    </div>
  );
}
