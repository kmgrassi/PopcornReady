import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useAssetCritiqueMutation } from "../../lib/assetCritiqueQueries";
import type { AssetCritique } from "../../lib/api-client";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";
import styles from "./AssetCritiqueDialog.module.css";

export const DEFAULT_ASSET_CRITIQUE_QUESTION = "How can we improve upon this?";

export function AssetCritiqueDialog({
  open,
  projectId,
  assetId,
  title,
  subtitle,
  preview,
  onClose,
}: {
  open: boolean;
  projectId: string;
  assetId: string;
  title: string;
  subtitle?: string | null;
  preview: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const questionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [question, setQuestion] = useState(DEFAULT_ASSET_CRITIQUE_QUESTION);
  const [critique, setCritique] = useState<AssetCritique | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const mutation = useAssetCritiqueMutation(projectId, assetId);

  useEffect(() => {
    if (!open) return;
    setQuestion(DEFAULT_ASSET_CRITIQUE_QUESTION);
    setCritique(null);
    setIdempotencyKey(crypto.randomUUID());
    mutation.reset();
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    });
    return () => restoreFocusRef.current?.focus();
  }, [open, assetId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !mutation.isPending) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), textarea:not([disabled]), [tabindex='0']"
        )
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mutation.isPending, onClose, open]);

  if (!open) return null;

  async function submit() {
    if (!question.trim() || mutation.isPending) return;
    try {
      const response = await mutation.mutateAsync({
        question: question.trim(),
        idempotencyKey,
      });
      setCritique(response.critique);
      setIdempotencyKey(crypto.randomUUID());
    } catch {
      // Mutation error is rendered in the dialog; the key stays stable for a safe retry.
    }
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={() => {
        if (!mutation.isPending) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={mutation.isPending || undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.contextLabel}>AI feedback</p>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <CloseButton onClick={onClose} disabled={mutation.isPending} />
        </header>

        <div className={styles.body}>
          <div className={styles.preview}>{preview}</div>
          <div className={styles.conversation}>
            <label htmlFor={questionId}>What would you like the AI to review?</label>
            <textarea
              id={questionId}
              value={question}
              maxLength={2000}
              rows={4}
              disabled={mutation.isPending}
              onChange={(event) => {
                setQuestion(event.target.value);
                setCritique(null);
                mutation.reset();
                setIdempotencyKey(crypto.randomUUID());
              }}
            />
            <div className={styles.questionMeta}>
              <span>Ask about clarity, pacing, composition, tone, or anything else.</span>
              <span>{question.length}/2000</span>
            </div>
            {mutation.error ? (
              <div className={styles.error} role="alert">
                <strong>Feedback couldn’t be generated.</strong>
                <span>{mutation.error.message}</span>
              </div>
            ) : null}
            {mutation.isPending ? (
              <div className={styles.loading} role="status">
                <span aria-hidden="true" />
                Reviewing this asset…
              </div>
            ) : null}
            {critique ? <CritiqueResult critique={critique} /> : null}
          </div>
        </div>

        <footer className={styles.actions}>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Close
          </Button>
          <Button
            variant="secondary"
            onClick={() => void submit()}
            disabled={!question.trim() || mutation.isPending}
            isLoading={mutation.isPending}
          >
            {critique ? "Ask again" : "Receive feedback"}
          </Button>
        </footer>
      </section>
    </div>
  );
}

function CritiqueResult({ critique }: { critique: AssetCritique }) {
  return (
    <section className={styles.result} aria-label="AI feedback response" aria-live="polite">
      <div>
        <h3>Response</h3>
        <p>{critique.answer}</p>
      </div>
      <ResultList title="What’s working" items={critique.strengths} />
      <ResultList title="Ways to improve" items={critique.improvements} />
      <ResultList title="Evidence" items={critique.evidence} />
      <ResultList title="Review limits" items={critique.limitations} muted />
    </section>
  );
}

function ResultList({
  title,
  items,
  muted = false,
}: {
  title: string;
  items: string[];
  muted?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className={muted ? styles.limits : undefined}>
      <h3>{title}</h3>
      <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
    </div>
  );
}
