import { useEffect, useId, useState, type FormEvent } from "react";
import type { BoardRevisionTarget } from "@popcorn/shared/v1/types";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";
import { v1Api } from "../../lib/api-client";
import { modelPurposeConfig, providerConfig } from "../../lib/modelOptions";
import styles from "./AssetEditModal.module.css";

export interface AssetEditModalProps {
  open: boolean;
  projectId: string;
  /** What is being edited. When null the modal is closed. */
  target: BoardRevisionTarget | null;
  imageUrl?: string | null;
  title?: string;
  subtitle?: string | null;
  /** Saved provenance displayed when a user inspects an existing asset. */
  sourcePrompt?: string | null;
  /**
   * Seeds the message box when the modal opens. Used by the "Generate" action on
   * an empty slot to pre-fill the item's intended prompt (e.g. a beat's visual
   * description or a scene's summary) so the user can edit it or run as-is.
   */
  initialPrompt?: string;
  onClose: () => void;
  /** Called with the run id after the edit is sent so the caller can poll it. */
  onSubmitted?: (runId: string) => void;
}

// Universal "click an asset, request changes to it" modal. The edit is routed
// through the project's AGENT (not a raw image regen): it submits feedback the
// orchestrator processes in context, so it can place the change correctly and
// propagate to downstream assets when they exist.
export function AssetEditModal({
  open,
  projectId,
  target,
  imageUrl,
  title = "Edit this asset",
  subtitle,
  sourcePrompt,
  initialPrompt,
  onClose,
  onSubmitted,
}: AssetEditModalProps) {
  const titleId = useId();
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const purposeConfig = modelPurposeConfig("image_generation");
  const [provider, setProvider] = useState(purposeConfig.providers[0].id);
  const [model, setModel] = useState(providerConfig(purposeConfig, provider).models[0]);
  const [modelTouched, setModelTouched] = useState(false);

  // Reset whenever the modal (re)opens for a (possibly different) target.
  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt ?? "");
      setError(null);
      setPending(false);
      setSent(false);
      setProvider(purposeConfig.providers[0].id);
      setModel(providerConfig(purposeConfig, purposeConfig.providers[0].id).models[0]);
      setModelTouched(false);
    }
  }, [open, purposeConfig, target, initialPrompt]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !target) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || pending || !target) return;
    setPending(true);
    setError(null);
    try {
      const res = await v1Api.createProjectAssetRevision(projectId, {
        message: trimmed,
        target,
        ...(modelTouched ? { generationModel: { provider, model } } : {}),
      });
      setSent(true);
      setPrompt("");
      onSubmitted?.(res.runId);
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
        <CloseButton className={styles.close} onClick={onClose} />

        <div className={styles.media}>
          {imageUrl ? (
            <img src={imageUrl} alt="" />
          ) : (
            <div className={styles.mediaEmpty}>No preview available</div>
          )}
        </div>

        <form className={styles.panel} onSubmit={submit}>
          <div className={styles.heading}>
            <p className={styles.eyebrow}>Request Changes</p>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>

          {sent && !error ? (
            <p className={styles.success} role="status">
              Sent to the agent. It’s revising this in context — this panel will update
              shortly. You can ask for another change or close.
            </p>
          ) : null}

          {sourcePrompt?.trim() ? (
            <section className={styles.sourcePrompt} aria-label="Generation prompt">
              <h3>Generation prompt</h3>
              <p>{sourcePrompt}</p>
            </section>
          ) : null}

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

          <fieldset className={styles.modelPane} disabled={pending}>
            <legend>Generation model</legend>
            <label>
              <span>Provider</span>
              <select
                value={provider}
                onChange={(event) => {
                  const nextProvider = event.target.value;
                  const nextConfig = providerConfig(purposeConfig, nextProvider);
                  setProvider(nextProvider);
                  setModel(nextConfig.models[0] ?? "");
                  setModelTouched(true);
                }}
              >
                {purposeConfig.providers.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Model</span>
              <select
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  setModelTouched(true);
                }}
              >
                {providerConfig(purposeConfig, provider).models.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

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
              {pending ? "Sending…" : "Send to agent"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
