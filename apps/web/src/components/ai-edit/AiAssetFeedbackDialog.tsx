import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import styles from "./AiAssetFeedbackDialog.module.css";

export interface AiAssetFeedbackDialogProps {
  open: boolean;
  title: string;
  subtitle?: string | null;
  asset: ReactNode;
  pending?: boolean;
  error?: string | null;
  onSubmit: (message: string) => Promise<void> | void;
  onClose: () => void;
}

export function AiAssetFeedbackDialog({
  open,
  title,
  subtitle,
  asset,
  pending = false,
  error,
  onSubmit,
  onClose,
}: AiAssetFeedbackDialogProps) {
  const titleId = useId();
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setMessage("");
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, pending]);

  if (!open) return null;

  const trimmed = message.trim();
  const canSubmit = Boolean(trimmed) && !pending;

  async function submit() {
    if (!canSubmit) return;
    await onSubmit(trimmed);
    setMessage("");
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={() => {
        if (!pending) onClose();
      }}
    >
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Edit with AI</p>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button
            className={styles.closeButton}
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
          >
            x
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.assetPane}>{asset}</div>
          <label className={styles.feedbackPane}>
            <span>Feedback for the AI</span>
            <textarea
              value={message}
              rows={8}
              autoFocus
              placeholder="Describe what should change."
              disabled={pending}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <footer className={styles.actions}>
          <Button variant="ghost" type="button" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!canSubmit} isLoading={pending}>
            {pending ? "Sending..." : "Send to AI"}
          </Button>
        </footer>
      </form>
    </div>
  );
}
