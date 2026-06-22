import { useState } from "react";
import { ApiClientError } from "../../lib/api-client";
import { useRegenerateImageMutation } from "../../lib/regenerateImage";
import { RegenerateAssetDialog } from "./RegenerateAssetDialog";
import styles from "./RegenerateImageButton.module.css";

export interface RegenerateImageButtonProps {
  // The image asset to re-run. The endpoint rejects non-image assets, so only
  // render this for image-kind assets.
  assetId: string;
  // The asset's saved prompt, used to prefill the dialog if the API reports no
  // stored prompt to reuse.
  initialPrompt?: string | null;
  label?: string;
  // Extra class for placement (e.g. an absolutely-positioned overlay slot).
  className?: string;
}

function isPromptRequired(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "prompt_required";
}

// A self-contained "regenerate this image" control for blank/failed image tiles.
// One click re-runs generation reusing the asset's saved prompt; if none is
// stored the API reports `prompt_required` and we collect one via the dialog.
export function RegenerateImageButton({
  assetId,
  initialPrompt,
  label = "Regenerate",
  className,
}: RegenerateImageButtonProps) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useRegenerateImageMutation();
  const promptPreview = initialPrompt?.trim();
  const tooltip = promptPreview
    ? `Prompt: ${promptPreview}`
    : "Regenerate this image from its prompt";

  const run = async (prompt?: string) => {
    setError(null);
    try {
      await mutation.mutateAsync({ assetId, ...(prompt ? { prompt } : {}) });
      setPromptOpen(false);
    } catch (err) {
      if (isPromptRequired(err)) {
        setPromptOpen(true);
      } else {
        setError(err instanceof Error ? err.message : "Unable to regenerate this image.");
      }
    }
  };

  return (
    <>
      <button
        type="button"
        className={[styles.button, className].filter(Boolean).join(" ")}
        // Stop propagation so triggering a regenerate never also fires a parent
        // tile's click handler (open viewer / select / send feedback).
        onClick={(event) => {
          event.stopPropagation();
          void run();
        }}
        disabled={mutation.isPending}
        aria-label="Regenerate this image from its prompt"
        title={tooltip}
        data-tooltip={tooltip}
      >
        <svg
          className={mutation.isPending ? styles.spin : undefined}
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        <span>{mutation.isPending ? "Regenerating…" : label}</span>
      </button>
      {error && !promptOpen ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
      <RegenerateAssetDialog
        open={promptOpen}
        initialPrompt={initialPrompt ?? ""}
        message="This image doesn't have a saved prompt. Enter one to regenerate it."
        pending={mutation.isPending}
        error={error}
        onSubmit={(prompt) => void run(prompt)}
        onCancel={() => {
          setPromptOpen(false);
          setError(null);
        }}
      />
    </>
  );
}
