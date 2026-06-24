import { useEffect, useId, useState } from "react";
import type { ModelSettingPurpose } from "../../lib/api-client";
import { modelPurposeConfig, providerConfig } from "../../lib/modelOptions";
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
  modelPurpose?: ModelSettingPurpose | null;
  onSubmit: (
    prompt: string,
    generationModel?: { provider: string; model: string }
  ) => void;
  onCancel: () => void;
}

export function RegenerateAssetDialog({
  open,
  title = "Regenerate image",
  initialPrompt = "",
  message,
  pending = false,
  error,
  modelPurpose,
  onSubmit,
  onCancel,
}: RegenerateAssetDialogProps) {
  const titleId = useId();
  const [prompt, setPrompt] = useState(initialPrompt);
  const purposeConfig = modelPurpose ? modelPurposeConfig(modelPurpose) : null;
  const initialProvider = purposeConfig?.providers[0]?.id ?? "";
  const initialModel = purposeConfig ? providerConfig(purposeConfig, initialProvider).models[0] : "";
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(initialModel);

  // Reset the field whenever the dialog (re)opens so a stale draft never leaks
  // between assets.
  useEffect(() => {
    if (!open) return;
    setPrompt(initialPrompt);
    setProvider(initialProvider);
    setModel(initialModel);
  }, [initialModel, initialProvider, initialPrompt, open]);

  if (!open) return null;

  const trimmed = prompt.trim();
  const canSubmit = Boolean(trimmed) && !pending;
  const selectedProviderConfig =
    purposeConfig && provider ? providerConfig(purposeConfig, provider) : null;

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onCancel}>
      <form
        className={styles.dialog}
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            onSubmit(
              trimmed,
              purposeConfig && provider && model.trim()
                ? { provider, model: model.trim() }
                : undefined
            );
          }
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

        {purposeConfig && selectedProviderConfig ? (
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
              <select value={model} onChange={(event) => setModel(event.target.value)}>
                {selectedProviderConfig.models.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        ) : null}

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
