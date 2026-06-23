import { useMemo, useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import type { ModelProvider, ProviderApiKey } from "../../lib/api-client";
import {
  useDeleteProviderApiKeyMutation,
  useProviderApiKeysQuery,
  useSaveProviderApiKeyMutation,
} from "../../lib/queryClient";
import styles from "./ProviderApiKeysPanel.module.css";

const PROVIDERS: Array<{
  id: ModelProvider;
  label: string;
  env: string;
  use: string;
}> = [
  {
    id: "openai",
    label: "OpenAI",
    env: "OPENAI_API_KEY",
    use: "LLM, image, embedding, and review calls.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    env: "ANTHROPIC_API_KEY",
    use: "LLM orchestration and review calls.",
  },
  {
    id: "gemini",
    label: "Gemini",
    env: "GEMINI_API_KEY",
    use: "Image and video generation, including minor-safe image edits.",
  },
  {
    id: "ideogram",
    label: "Ideogram",
    env: "IDEOGRAM_API_KEY",
    use: "Image generation and storyboard/keyframe visual exploration.",
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    env: "ELEVENLABS_API_KEY",
    use: "Narration and voice generation.",
  },
  {
    id: "runway",
    label: "Runway",
    env: "RUNWAYML_API_SECRET",
    use: "Video generation.",
  },
  {
    id: "ltx",
    label: "LTX",
    env: "LTX_API_KEY",
    use: "Video generation.",
  },
  {
    id: "nvidia",
    label: "NVIDIA API Catalog",
    env: "NVIDIA_API_KEY",
    use: "NVIDIA-hosted video models.",
  },
];

function keyedByProvider(keys: ProviderApiKey[]): Partial<Record<ModelProvider, ProviderApiKey>> {
  return Object.fromEntries(keys.map((key) => [key.provider, key]));
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved";
  return `Saved ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

export function ProviderApiKeysPanel({
  authScope,
  enabled = true,
}: {
  authScope: string;
  enabled?: boolean;
}) {
  const keysQuery = useProviderApiKeysQuery(authScope, { enabled });
  const saveMutation = useSaveProviderApiKeyMutation(authScope);
  const deleteMutation = useDeleteProviderApiKeyMutation(authScope);
  const [values, setValues] = useState<Partial<Record<ModelProvider, string>>>({});
  const [activeProvider, setActiveProvider] = useState<ModelProvider | null>(null);
  const savedKeys = useMemo(
    () => keyedByProvider(keysQuery.data ?? []),
    [keysQuery.data]
  );

  function updateValue(provider: ModelProvider, value: string) {
    setValues((current) => ({ ...current, [provider]: value }));
  }

  async function onSave(event: FormEvent<HTMLFormElement>, provider: ModelProvider) {
    event.preventDefault();
    const apiKey = values[provider]?.trim() ?? "";
    setActiveProvider(provider);
    try {
      await saveMutation.mutateAsync({ provider, apiKey });
      setValues((current) => ({ ...current, [provider]: "" }));
    } finally {
      setActiveProvider(null);
    }
  }

  async function onDelete(provider: ModelProvider) {
    setActiveProvider(provider);
    try {
      await deleteMutation.mutateAsync(provider);
    } finally {
      setActiveProvider(null);
    }
  }

  const mutationError = errorMessage(saveMutation.error ?? deleteMutation.error);
  const busyProvider =
    saveMutation.isPending || deleteMutation.isPending ? activeProvider : null;

  return (
    <article className={styles.panel}>
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>Model providers</p>
          <h2>API keys</h2>
        </div>
        {keysQuery.isFetching ? <span className={styles.status}>Syncing</span> : null}
      </div>
      <p className={styles.muted}>
        Store per-account keys for generation providers. Saved keys are encrypted
        on the API and only shown here as redacted hints.
      </p>

      <div className={styles.providerList}>
        {PROVIDERS.map((provider) => {
          const saved = savedKeys[provider.id];
          const inputId = `provider-key-${provider.id}`;
          const isBusy = busyProvider === provider.id;
          const hasDraftKey = Boolean(values[provider.id]?.trim());

          return (
            <form
              key={provider.id}
              className={styles.providerRow}
              onSubmit={(event) => void onSave(event, provider.id)}
            >
              <div className={styles.providerInfo}>
                <label htmlFor={inputId}>{provider.label}</label>
                <p>{provider.use}</p>
                <code>{provider.env}</code>
              </div>

              <div className={styles.keyControls}>
                <input
                  id={inputId}
                  type="password"
                  autoComplete="off"
                  placeholder={saved ? saved.keyHint : "Paste API key"}
                  value={values[provider.id] ?? ""}
                  onChange={(event) => updateValue(provider.id, event.target.value)}
                />
                <div className={styles.actions}>
                  {hasDraftKey ? (
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      isLoading={isBusy && saveMutation.isPending}
                    >
                      {saved ? "Update" : "Save"}
                    </Button>
                  ) : null}
                  {saved ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      isLoading={isBusy && deleteMutation.isPending}
                      onClick={() => void onDelete(provider.id)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                <span className={saved ? styles.saved : styles.empty}>
                  {saved ? `${saved.keyHint} · ${formatSavedAt(saved.updatedAt)}` : "Not set"}
                </span>
              </div>
            </form>
          );
        })}
      </div>

      {keysQuery.error ? <p className={styles.error}>{errorMessage(keysQuery.error)}</p> : null}
      {mutationError ? <p className={styles.error}>{mutationError}</p> : null}
    </article>
  );
}
