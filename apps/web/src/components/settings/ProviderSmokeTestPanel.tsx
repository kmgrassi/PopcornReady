import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type {
  ProviderSmokeAssetKind,
  ProviderSmokeAssetProvider,
  ProviderSmokeAssetResponse,
} from "../../lib/api-client";
import { useCreateProviderSmokeAssetMutation } from "../../lib/queryClient";
import { Button } from "../ui/Button";
import styles from "./ProviderSmokeTestPanel.module.css";

type ProviderOption = {
  id: ProviderSmokeAssetProvider;
  label: string;
  models: string[];
  sizes?: string[];
  aspectRatios?: string[];
  durationSec?: number[];
};

const IMAGE_PROVIDERS: ProviderOption[] = [
  {
    id: "xai",
    label: "xAI Grok Imagine",
    models: ["grok-imagine-image-quality"],
    sizes: ["1024x1024"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    models: ["gemini-2.5-flash-image"],
    aspectRatios: ["1:1", "16:9", "9:16"],
  },
  {
    id: "openai",
    label: "OpenAI",
    models: ["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"],
    sizes: ["1024x1024", "1536x1024", "1024x1536"],
  },
  {
    id: "ideogram",
    label: "Ideogram",
    models: ["ideogram-v4", "ideogram-v3"],
    aspectRatios: ["1:1", "16:9", "9:16"],
  },
];

const VIDEO_PROVIDERS: ProviderOption[] = [
  {
    id: "xai",
    label: "xAI Grok Imagine",
    models: ["grok-imagine-video", "grok-imagine-video-1.5"],
    durationSec: [6, 10, 15],
  },
  {
    id: "gemini",
    label: "Google Veo / Gemini",
    models: ["veo-3.1-generate-preview"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durationSec: [4, 8],
  },
  {
    id: "kling",
    label: "Kling",
    models: ["kling-v3"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durationSec: [5, 10],
  },
  {
    id: "seedance",
    label: "Seedance",
    models: ["bytedance/seedance-2.0/text-to-video"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durationSec: [5, 10],
  },
  {
    id: "openai",
    label: "OpenAI Sora",
    models: ["sora-2"],
    sizes: ["1280x720", "720x1280"],
    durationSec: [4, 8, 12],
  },
  {
    id: "runway",
    label: "Runway",
    models: ["gen4.5"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durationSec: [5, 10],
  },
  {
    id: "ltx",
    label: "LTX",
    models: ["ltx-2-3-fast"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durationSec: [5, 10],
  },
  {
    id: "nvidia_api_catalog",
    label: "NVIDIA API Catalog",
    models: ["nvidia/cosmos3-nano"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durationSec: [5, 10],
  },
];

function providersFor(kind: ProviderSmokeAssetKind): ProviderOption[] {
  return kind === "image" ? IMAGE_PROVIDERS : VIDEO_PROVIDERS;
}

function firstProvider(kind: ProviderSmokeAssetKind): ProviderOption {
  return providersFor(kind)[0];
}

function defaultPrompt(kind: ProviderSmokeAssetKind): string {
  if (kind === "video") {
    return "A polished five second cinematic shot of a popcorn kernel transforming into a glowing storyboard frame on a dark studio desk.";
  }
  return "A crisp product-style hero image of a popcorn kernel transforming into a glowing storyboard frame on a clean studio desk.";
}

function providerById(kind: ProviderSmokeAssetKind, provider: ProviderSmokeAssetProvider) {
  return (
    providersFor(kind).find((option) => option.id === provider) ?? firstProvider(kind)
  );
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

export function ProviderSmokeTestPanel() {
  const createMutation = useCreateProviderSmokeAssetMutation();
  const [kind, setKind] = useState<ProviderSmokeAssetKind>("image");
  const [provider, setProvider] = useState<ProviderSmokeAssetProvider>(
    firstProvider("image").id
  );
  const [model, setModel] = useState(firstProvider("image").models[0]);
  const [prompt, setPrompt] = useState(defaultPrompt("image"));
  const [size, setSize] = useState(firstProvider("image").sizes?.[0] ?? "");
  const [aspectRatio, setAspectRatio] = useState(
    firstProvider("image").aspectRatios?.[0] ?? ""
  );
  const [durationSec, setDurationSec] = useState(
    firstProvider("image").durationSec?.[0] ?? 5
  );
  const [result, setResult] = useState<ProviderSmokeAssetResponse | null>(null);

  const providerOptions = providersFor(kind);
  const selectedProvider = useMemo(
    () => providerById(kind, provider),
    [kind, provider]
  );

  function resetProviderFields(nextKind: ProviderSmokeAssetKind, nextProvider: ProviderOption) {
    setProvider(nextProvider.id);
    setModel(nextProvider.models[0]);
    setSize(nextProvider.sizes?.[0] ?? "");
    setAspectRatio(nextProvider.aspectRatios?.[0] ?? "");
    setDurationSec(nextProvider.durationSec?.[0] ?? (nextKind === "video" ? 5 : 0));
  }

  function onKindChange(nextKind: ProviderSmokeAssetKind) {
    setKind(nextKind);
    setPrompt(defaultPrompt(nextKind));
    resetProviderFields(nextKind, firstProvider(nextKind));
    setResult(null);
  }

  function onProviderChange(nextProviderId: ProviderSmokeAssetProvider) {
    const nextProvider = providerById(kind, nextProviderId);
    resetProviderFields(kind, nextProvider);
    setResult(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await createMutation.mutateAsync({
      kind,
      provider,
      prompt,
      model: model.trim() || undefined,
      size: size || undefined,
      aspectRatio: aspectRatio || undefined,
      durationSec: kind === "video" ? durationSec : undefined,
    });
    setResult(created);
  }

  const mutationError = errorMessage(createMutation.error);
  const actionLabel = kind === "image" ? "Create image asset" : "Create video asset";

  return (
    <article className={styles.panel}>
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>Admin test</p>
          <h2>Provider asset smoke test</h2>
        </div>
      </div>
      <p className={styles.muted}>
        Credential, storage, job, and asset graph check for live generation
        providers.
      </p>

      <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
        <div className={styles.typeToggle} aria-label="Asset type">
          {(["image", "video"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={option === kind ? styles.typeButtonActive : styles.typeButton}
              onClick={() => onKindChange(option)}
              aria-pressed={option === kind}
            >
              {option === "image" ? "Image" : "Video"}
            </button>
          ))}
        </div>

        <div className={styles.fields}>
          <label className={styles.field}>
            <span>Provider</span>
            <select
              value={provider}
              onChange={(event) =>
                onProviderChange(event.target.value as ProviderSmokeAssetProvider)
              }
            >
              {providerOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Model</span>
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {selectedProvider.models.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          {selectedProvider.sizes?.length ? (
            <label className={styles.field}>
              <span>Size</span>
              <select value={size} onChange={(event) => setSize(event.target.value)}>
                {selectedProvider.sizes.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {selectedProvider.aspectRatios?.length ? (
            <label className={styles.field}>
              <span>Aspect ratio</span>
              <select
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value)}
              >
                {selectedProvider.aspectRatios.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {kind === "video" && selectedProvider.durationSec?.length ? (
            <label className={styles.field}>
              <span>Duration</span>
              <select
                value={durationSec}
                onChange={(event) => setDurationSec(Number(event.target.value))}
              >
                {selectedProvider.durationSec.map((option) => (
                  <option key={option} value={option}>
                    {option}s
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <label className={styles.promptField}>
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
          />
        </label>

        {mutationError ? <p className={styles.error}>{mutationError}</p> : null}

        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            isLoading={createMutation.isPending}
            disabled={!prompt.trim()}
          >
            {actionLabel}
          </Button>
          {result ? (
            <Link className={styles.resultLink} to={`/projects/${result.project.id}`}>
              Open created project
            </Link>
          ) : null}
        </div>

        {result ? (
          <div className={styles.result} aria-live="polite">
            <span>{result.project.name}</span>
            <code>{result.assetIds[0] ?? result.job.id}</code>
          </div>
        ) : null}
      </form>
    </article>
  );
}
