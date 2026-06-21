import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { v1Api } from "../../lib/api-client";
import styles from "./AssetEditModal.module.css";

export interface AssetEditModalProps {
  open: boolean;
  /** The asset to edit (regenerate). When null the modal is closed. */
  assetId: string | null;
  imageUrl?: string | null;
  title?: string;
  subtitle?: string | null;
  onClose: () => void;
  /** Called after a successful edit so the caller can refetch. */
  onEdited?: () => void;
}

// Universal "click an asset, ask the AI to edit it" modal: shows the image and a
// prompt box, and regenerates the asset in place. Reusable for any asset id.
export function AssetEditModal({
  open,
  assetId,
  imageUrl,
  title = "Edit this asset",
  subtitle,
  onClose,
  onEdited,
}: AssetEditModalProps) {
  const titleId = useId();
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null | undefined>(imageUrl);
  const [edited, setEdited] = useState(false);

  // Reset whenever the modal (re)opens for a (possibly different) asset.
  useEffect(() => {
    if (open) {
      setPrompt("");
      setError(null);
      setPending(false);
      setEdited(false);
      setCurrentUrl(imageUrl);
    }
  }, [open, assetId, imageUrl]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !assetId) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || pending || !assetId) return;
    setPending(true);
    setError(null);
    try {
      const media = await v1Api.regenerateAsset(assetId, trimmed);
      setCurrentUrl(media.url ?? media.thumbnailUrl ?? currentUrl);
      setEdited(true);
      setPrompt("");
      onEdited?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className={styles.close} type="button" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className={styles.media}>
          {currentUrl ? (
            <img src={currentUrl} alt="" />
          ) : (
            <div className={styles.mediaEmpty}>No preview available</div>
          )}
        </div>

        <form className={styles.panel} onSubmit={submit}>
          <div className={styles.heading}>
            <p className={styles.eyebrow}>Ask the AI to edit</p>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>

          <label className={styles.field}>
            <span>What should change?</span>
            <textarea
              value={prompt}
              rows={6}
              autoFocus
              placeholder="e.g. make it nighttime, add rain, warmer lighting, a wider shot…"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          {edited && !error ? (
            <p className={styles.success} role="status">
              Updated. Ask for another change or close.
            </p>
          ) : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <div className={styles.actions}>
            <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
              Close
            </Button>
            <Button variant="primary" type="submit" disabled={!prompt.trim() || pending} isLoading={pending}>
              {pending ? "Editing…" : "Apply edit"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
