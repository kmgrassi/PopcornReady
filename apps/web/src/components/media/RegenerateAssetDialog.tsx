import { useEffect, useId, useState } from "react";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";
import styles from "./RegenerateAssetDialog.module.css";

export interface RegenerateAssetDialogProps {
  open: boolean;
  title?: string;
  /** Pre-fill the textarea (e.g. the asset's saved prompt). */
  initialPrompt?: string;
  /** Context line above the field, e.g. "This image doesn't have a prompt." */
  message?: string | null;
  pending?: boolean;
  error?: string | null;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
}

export function RegenerateAssetDialog({
  open,
  title = "Regenerate image",
  initialPrompt = "",
  message,
  pending = false,
  error,
  onSubmit,
  onCancel,
}: RegenerateAssetDialogProps) {
  const titleId = useId();
  const [prompt, setPrompt] = useState(initialPrompt);

  // Reset the field whenever the dialog (re)opens so a stale draft never leaks
  // between assets.
  useEffect(() => {
    if (open) setPrompt(initialPrompt);
  }, [open, initialPrompt]);

  if (!open) return null;

  const trimmed = prompt.trim();
  const canSubmit = Boolean(trimmed) && !pending;

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onCancel}>
      <form
        className={styles.dialog}
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit(trimmed);
        }}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Regenerate</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <CloseButton className={styles.closeButton} onClick={onCancel} />
        </header>

        {message ? <p className={styles.message}>{message}</p> : null}

        <label className={styles.field}>
          <span>Prompt</span>
          <textarea
            value={prompt}
            rows={6}
            autoFocus
            placeholder="Describe the image to generate…"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <footer className={styles.actions}>
          <Button variant="ghost" type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!canSubmit} isLoading={pending}>
            {pending ? "Regenerating…" : "Regenerate"}
          </Button>
        </footer>
      </form>
    </div>
  );
}
