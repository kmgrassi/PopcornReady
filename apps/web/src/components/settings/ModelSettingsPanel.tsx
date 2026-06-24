import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ModelSettingPurpose, WorkspaceModelSetting } from "../../lib/api-client";
import {
  MODEL_PURPOSES,
  providerConfig,
  type ModelPurposeConfig as PurposeConfig,
} from "../../lib/modelOptions";
import {
  useSaveWorkspaceModelSettingMutation,
  useWorkspaceModelSettingsQuery,
} from "../../lib/queryClient";
import { Button } from "../ui/Button";
import styles from "./ModelSettingsPanel.module.css";

const PURPOSES = MODEL_PURPOSES;

function settingsByPurpose(
  defaults: WorkspaceModelSetting[],
  settings: WorkspaceModelSetting[]
): Record<ModelSettingPurpose, WorkspaceModelSetting> {
  const entries = [...defaults, ...settings].map((setting) => [setting.purpose, setting]);
  return Object.fromEntries(entries) as Record<ModelSettingPurpose, WorkspaceModelSetting>;
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

function PurposeIcon({ icon }: { icon: PurposeConfig["icon"] }) {
  if (icon === "image") {
    return (
      <svg className={styles.purposeIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="3" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="m7 17 4.2-4.2a1.4 1.4 0 0 1 2 0L17 16.6" />
        <path d="m14.5 15 1.3-1.3a1.3 1.3 0 0 1 1.9 0L20 16" />
      </svg>
    );
  }

  if (icon === "video") {
    return (
      <svg className={styles.purposeIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="6" width="11" height="12" rx="2.5" />
        <path d="m15 10 4.2-2.4a.6.6 0 0 1 .8.5v7.8a.6.6 0 0 1-.8.5L15 14" />
      </svg>
    );
  }

  if (icon === "audio") {
    return (
      <svg className={styles.purposeIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 14H5a2 2 0 0 1 0-4h2l5-4v12l-5-4Z" />
        <path d="M16 9.2a4 4 0 0 1 0 5.6" />
        <path d="M18.5 6.7a7.5 7.5 0 0 1 0 10.6" />
      </svg>
    );
  }

  return (
    <svg className={styles.purposeIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 6h14" />
      <path d="M12 6v12" />
      <path d="M8 18h8" />
    </svg>
  );
}

export function ModelSettingsPanel({
  workspaceId,
  enabled = true,
}: {
  workspaceId: string | null | undefined;
  enabled?: boolean;
}) {
  const settingsQuery = useWorkspaceModelSettingsQuery(workspaceId, {
    enabled: enabled && Boolean(workspaceId),
  });
  const saveMutation = useSaveWorkspaceModelSettingMutation(workspaceId);
  const effectiveSettings = useMemo(
    () =>
      settingsByPurpose(
        settingsQuery.data?.defaults ?? [],
        settingsQuery.data?.settings ?? []
      ),
    [settingsQuery.data]
  );
  const [drafts, setDrafts] = useState<
    Partial<Record<ModelSettingPurpose, { provider: string; model: string }>>
  >({});
  const [activePurpose, setActivePurpose] = useState<ModelSettingPurpose | null>(null);

  useEffect(() => {
    if (!settingsQuery.data) return;
    setDrafts(
      Object.fromEntries(
        PURPOSES.map((purpose) => {
          const setting = effectiveSettings[purpose.id];
          return [
            purpose.id,
            {
              provider: setting?.provider ?? purpose.providers[0].id,
              model: setting?.model ?? purpose.providers[0].models[0],
            },
          ];
        })
      ) as Partial<Record<ModelSettingPurpose, { provider: string; model: string }>>
    );
  }, [effectiveSettings, settingsQuery.data]);

  function updateDraft(
    purpose: PurposeConfig,
    patch: Partial<{ provider: string; model: string }>
  ) {
    setDrafts((current) => {
      const previous = current[purpose.id] ?? {
        provider: purpose.providers[0].id,
        model: purpose.providers[0].models[0],
      };
      const nextProvider = patch.provider ?? previous.provider;
      const nextProviderConfig = providerConfig(purpose, nextProvider);
      return {
        ...current,
        [purpose.id]: {
          provider: nextProvider,
          model:
            patch.model ??
            (patch.provider ? nextProviderConfig.models[0] : previous.model),
        },
      };
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>, purpose: PurposeConfig) {
    event.preventDefault();
    const draft = drafts[purpose.id];
    if (!draft) return;
    setActivePurpose(purpose.id);
    try {
      await saveMutation.mutateAsync({
        purpose: purpose.id,
        provider: draft.provider,
        model: draft.model.trim(),
      });
    } finally {
      setActivePurpose(null);
    }
  }

  const mutationError = errorMessage(saveMutation.error);
  const disabled = !workspaceId || !enabled;

  return (
    <article className={styles.panel}>
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>Model defaults</p>
          <h2>Purpose routing</h2>
        </div>
        {settingsQuery.isFetching ? <span className={styles.status}>Syncing</span> : null}
      </div>
      <p className={styles.muted}>
        Choose the default provider and model for each broad generation purpose.
        Explicit project or agent requests still override these defaults.
      </p>

      <div className={styles.rows}>
        {PURPOSES.map((purpose) => {
          const draft = drafts[purpose.id] ?? {
            provider: purpose.providers[0].id,
            model: purpose.providers[0].models[0],
          };
          const models = providerConfig(purpose, draft.provider).models;
          const isBusy = saveMutation.isPending && activePurpose === purpose.id;
          const modelListId = `model-options-${purpose.id}`;

          return (
            <form
              key={purpose.id}
              className={styles.row}
              onSubmit={(event) => void onSubmit(event, purpose)}
            >
              <div className={styles.copy}>
                <div className={styles.purposeTitle}>
                  <PurposeIcon icon={purpose.icon} />
                  <h3>{purpose.label}</h3>
                </div>
                <p>{purpose.description}</p>
              </div>
              <div className={styles.controls}>
                <label>
                  <span>Provider</span>
                  <select
                    value={draft.provider}
                    disabled={disabled}
                    onChange={(event) =>
                      updateDraft(purpose, { provider: event.target.value })
                    }
                  >
                    {purpose.providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Model</span>
                  <input
                    value={draft.model}
                    list={modelListId}
                    disabled={disabled}
                    onChange={(event) => updateDraft(purpose, { model: event.target.value })}
                  />
                  <datalist id={modelListId}>
                    {models.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </label>
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  isLoading={isBusy}
                  disabled={disabled || !draft.model.trim()}
                >
                  Save
                </Button>
              </div>
            </form>
          );
        })}
      </div>

      {settingsQuery.error ? (
        <p className={styles.error}>{errorMessage(settingsQuery.error)}</p>
      ) : null}
      {mutationError ? <p className={styles.error}>{mutationError}</p> : null}
    </article>
  );
}
