import { useEffect, useId, useState, type ReactNode } from "react";
import type { ModelSettingPurpose } from "../../lib/api-client";
import { modelPurposeConfig, providerConfig } from "../../lib/modelOptions";
import { Button } from "../ui/Button";
import { CloseButton } from "../ui/CloseButton";
import styles from "./AiAssetFeedbackDialog.module.css";

export interface AssetGenerationModelSelection {
  provider: string;
  model: string;
}

export interface AiAssetFeedbackDialogProps {
  open: boolean;
  title: string;
  subtitle?: string | null;
  asset: ReactNode;
  pending?: boolean;
  error?: string | null;
  modelPurpose?: ModelSettingPurpose | null;
  initialModelSelection?: AssetGenerationModelSelection | null;
  onSubmit: (
    message: string,
    generationModel?: AssetGenerationModelSelection
  ) => Promise<void> | void;
  onClose: () => void;
}

export function AiAssetFeedbackDialog({
  open,
  title,
  subtitle,
  asset,
  pending = false,
  error,
  modelPurpose,
  initialModelSelection,
  onSubmit,
  onClose,
}: AiAssetFeedbackDialogProps) {
  const titleId = useId();
  const [message, setMessage] = useState("");
  const purposeConfig = modelPurpose ? modelPurposeConfig(modelPurpose) : null;
  const initialProvider =
    initialModelSelection?.provider ?? purposeConfig?.providers[0]?.id ?? "";
  const initialModel =
    initialModelSelection?.model ??
    (purposeConfig ? providerConfig(purposeConfig, initialProvider).models[0] : "");
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(initialModel);
  const [modelTouched, setModelTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setProvider(initialProvider);
    setModel(initialModel);
    setModelTouched(false);
  }, [initialModel, initialProvider, open]);

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
  const selectedProviderConfig =
    purposeConfig && provider ? providerConfig(purposeConfig, provider) : null;

  async function submit() {
    if (!canSubmit) return;
    await onSubmit(
      trimmed,
      modelTouched && purposeConfig && provider && model.trim()
        ? { provider, model: model.trim() }
        : undefined
    );
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
          <CloseButton className={styles.closeButton} onClick={onClose} disabled={pending} />
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
                  {selectedProviderConfig.models.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          ) : null}
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
