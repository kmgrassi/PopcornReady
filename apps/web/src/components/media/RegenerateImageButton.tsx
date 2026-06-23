import { useState } from "react";
import { ApiClientError, type AssetMediaResponse } from "../../lib/api-client";
import { useRegenerateImageMutation } from "../../lib/regenerateImage";
import { RegenerateAssetDialog } from "./RegenerateAssetDialog";
import styles from "./RegenerateImageButton.module.css";

export interface RegenerateImageButtonProps {
  // The image asset to re-run. The endpoint rejects non-image assets, so only
  // render this for image-kind assets.
  assetId: string;
  // The asset's saved generation prompt. The button opens a dialog with this
  // value so the user can review or edit it before regenerating.
  prompt?: string | null;
  label?: string;
  // Extra class for placement (e.g. an absolutely-positioned overlay slot).
  className?: string;
  onRegenerateStart?: () => void;
  onRegenerated?: (assetId: string, media: AssetMediaResponse) => void;
  onRegenerateSettled?: () => void;
}

function isPromptRequired(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "prompt_required";
}

// A self-contained "regenerate this image" control for blank/failed image tiles.
// Click opens the saved prompt in a dialog so regeneration is explicit and the
// prompt can be edited before the request is sent.
export function RegenerateImageButton({
  assetId,
  prompt,
  label = "Regenerate",
  className,
  onRegenerateStart,
  onRegenerated,
  onRegenerateSettled,
}: RegenerateImageButtonProps) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useRegenerateImageMutation({ onRegenerated });
  const savedPrompt = prompt?.trim();

  const run = async (nextPrompt: string) => {
    setError(null);
    setPromptOpen(false);
    onRegenerateStart?.();
    try {
      await mutation.mutateAsync({ assetId, prompt: nextPrompt });
    } catch (err) {
      if (isPromptRequired(err)) {
        setPromptOpen(true);
      } else {
        setError(err instanceof Error ? err.message : "Unable to regenerate this image.");
      }
    } finally {
      onRegenerateSettled?.();
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
          setPromptOpen(true);
        }}
        disabled={mutation.isPending}
        aria-busy={mutation.isPending || undefined}
        aria-label="Regenerate this image from its prompt"
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
        <span>{label}</span>
      </button>
      {error && !promptOpen ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
      <RegenerateAssetDialog
        open={promptOpen}
        initialPrompt={prompt ?? ""}
        message={
          savedPrompt
            ? "Review or edit the prompt before regenerating this image."
            : "This image doesn't have a saved prompt. Enter one to regenerate it."
        }
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
