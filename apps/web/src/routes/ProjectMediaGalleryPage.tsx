import { useMemo, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FOOTAGE_ACCEPT, readSelectedFootage } from "../lib/upload";
import {
  useAssetBillingQuery,
  useProjectAssetsQuery,
  useRefreshAssetMediaMutation,
  useStartUploadedFootageGenerationRunMutation,
} from "../lib/queryClient";
import { useAuth } from "../components/auth/AuthProvider";
import { QuickLoadingState } from "../components/ui/QuickLoadingState";
import { v1Api } from "../lib/api-client";
import { formatUploadSize } from "../lib/landingUpload";
import { useUploadQueue } from "../lib/uploadQueue";
import { MediaViewer, type MediaViewerItem } from "../components/media/MediaViewer";
import {
  assetDisplayTitle,
  assetPreviewUrl,
  assetSourceLabel,
  editedAssetLineageLabel,
  formatDuration,
  galleryRenderState,
  kindLabel,
  projectMediaQueryParams,
  statusLabel,
  type ProjectMediaAsset,
} from "./projectMediaGallery";
import {
  MEDIA_INTENT_PRESETS,
  buildMediaIntentBrief,
  canCreateMediaIntentRun,
  presetConstraintHint,
  selectedPosition,
  selectionReducer,
} from "./project-media-intent";
import styles from "./ProjectMediaGalleryPage.module.css";

function viewerItem(asset: ProjectMediaAsset): MediaViewerItem {
  return {
    id: asset.id,
    kind: asset.kind,
    title: assetDisplayTitle(asset),
    filename: asset.filename,
    url: asset.remoteUrl ?? asset.url,
    thumbnailUrl: asset.thumbnailUrl ?? undefined,
    durationSec: asset.durationSec,
  };
}

function statusClassName(asset: ProjectMediaAsset) {
  if (asset.status === "ready") return `${styles.badge} ${styles.statusReady}`;
  if (asset.status === "failed") return `${styles.badge} ${styles.statusFailed}`;
  return `${styles.badge} ${styles.statusProcessing}`;
}

function uploadStatusLabel(status: string) {
  if (status === "queued") return "Queued";
  if (status === "uploading") return "Uploading";
  return statusLabel(status as ProjectMediaAsset["status"]);
}

export function ProjectMediaGalleryPage() {
  const projectId = useParams().projectId ?? "";
  const auth = useAuth();
  const authScope = auth.user?.id ?? (import.meta.env.DEV ? "dev-autopilot" : auth.status);
  const navigate = useNavigate();
  const uploadQueue = useUploadQueue();
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedIds, dispatchSelection] = useReducer(selectionReducer, []);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [intentText, setIntentText] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const createInFlightRef = useRef(false);
  const assetsQuery = useProjectAssetsQuery(projectId, projectMediaQueryParams());
  const refreshMedia = useRefreshAssetMediaMutation();
  const startRun = useStartUploadedFootageGenerationRunMutation(projectId);
  const queuedUploads = uploadQueue.projectItems(projectId);
  const activeQueuedUploads = queuedUploads.filter((item) =>
    item.status === "queued" ||
    item.status === "uploading" ||
    item.status === "processing"
  );

  const assets = (assetsQuery.data?.assets ?? []) as ProjectMediaAsset[];
  const assetIds = useMemo(() => new Set(assets.map((asset) => asset.id)), [assets]);
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );
  const visibleQueuedUploads = queuedUploads.filter(
    (item) => !item.assetId || !assetIds.has(item.assetId),
  );
  const selectedAssets = selectedIds
    .map((id) => assetById.get(id))
    .filter((asset): asset is ProjectMediaAsset => Boolean(asset));
  const readyVisualAssets = assets.filter(
    (asset) =>
      (asset.kind === "image" || asset.kind === "video") && asset.status === "ready",
  );
  const selectedPreset =
    MEDIA_INTENT_PRESETS.find((preset) => preset.id === selectedPresetId) ?? null;
  const intentHint = presetConstraintHint(selectedPreset, selectedAssets);
  const canCreate = canCreateMediaIntentRun({
    intentText,
    selectedAssets,
    preset: selectedPreset,
  });
  const creating = createPending || startRun.isPending;
  const state = galleryRenderState({
    loading: assetsQuery.isLoading,
    error: assetsQuery.error,
    assets,
  });
  const readyCount = assets.filter((asset) => asset.status === "ready").length;
  const processingCount = assets.filter(
    (asset) => asset.status === "processing" || asset.status === "pending",
  ).length;
  const selectedIndex = selectedAssetId
    ? assets.findIndex((asset) => asset.id === selectedAssetId)
    : -1;
  const selectedAsset = selectedIndex >= 0 ? assets[selectedIndex] : null;
  const billingQuery = useAssetBillingQuery(
    authScope,
    projectId,
    selectedAsset?.id ?? null,
    Boolean(selectedAsset),
  );
  const statusMessage = useMemo(() => {
    if (activeQueuedUploads.length > 0) {
      return `Uploading ${activeQueuedUploads.length} ${
        activeQueuedUploads.length === 1 ? "file" : "files"
      }...`;
    }
    if (assetsQuery.isFetching && !assetsQuery.isLoading) {
      return "Refreshing media status...";
    }
    if (processingCount > 0) {
      return `${processingCount} ${processingCount === 1 ? "asset is" : "assets are"} processing.`;
    }
    return "";
  }, [activeQueuedUploads.length, assetsQuery.isFetching, assetsQuery.isLoading, processingCount]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !projectId) return;
    setUploadError(null);
    try {
      const selected = await readSelectedFootage(files);
      uploadQueue.enqueueUploads(projectId, selected, { source: "project" });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not add media.");
    }
  }

  async function createRun() {
    if (!projectId || !canCreate || createInFlightRef.current) return;
    createInFlightRef.current = true;
    setCreatePending(true);
    setCreateError(null);
    try {
      const orderedAssetIds = selectedAssets.map((asset) => asset.id);
      const brief = buildMediaIntentBrief(intentText, orderedAssetIds, selectedPreset);
      const { briefVersion } = await v1Api.createBriefVersion(projectId, brief);
      const run = await startRun.mutateAsync({
        briefVersionId: briefVersion.id,
        assetIds: orderedAssetIds,
      });
      if (run.runId) {
        navigate(
          `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(run.runId)}`,
        );
      }
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Could not start the media run.",
      );
    } finally {
      createInFlightRef.current = false;
      setCreatePending(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Project media</p>
          <h1 className={styles.title}>Choose from the clips attached to this project</h1>
          <p className={styles.subtitle}>
            Uploaded videos, images, and audio stay attached to the project so the next
            step can select from real assets instead of this browser session.
          </p>
        </div>
        <div className={styles.summary} aria-label="Media summary">
          <span className={styles.summaryPill}>
            <strong>{assets.length}</strong>
            Total
          </span>
          <span className={styles.summaryPill}>
            <strong>{readyCount}</strong>
            Ready
          </span>
          <span className={styles.summaryPill}>
            <strong>{processingCount}</strong>
            Processing
          </span>
          <span className={styles.summaryPill}>
            <strong>{selectedIds.length}</strong>
            Selected
          </span>
        </div>
      </header>

      <div className={styles.selectionActions}>
        <button
          className={styles.secondaryButton}
          disabled={readyVisualAssets.length === 0}
          onClick={() =>
            dispatchSelection({
              type: "selectAll",
              assetIds: readyVisualAssets.map((asset) => asset.id),
            })
          }
          type="button"
        >
          Select all ready visuals
        </button>
        <button
          className={styles.secondaryButton}
          disabled={selectedIds.length === 0}
          onClick={() => dispatchSelection({ type: "clear" })}
          type="button"
        >
          Clear selection
        </button>
      </div>

      <div
        className={styles.statusLine}
        role={uploadError || assetsQuery.error ? "alert" : "status"}
      >
        {uploadError ?? (assetsQuery.error ? "Could not load project media." : statusMessage)}
      </div>

      {state === "loading" ? (
        <QuickLoadingState
          title="Loading media"
          description="Fetching the project asset list."
          variant="page"
        />
      ) : null}

      {state === "error" ? (
        <section className={styles.error} aria-label="Project media load error">
          <h2>Media could not load</h2>
          <p>Refresh the page or return to the project while the asset API catches up.</p>
        </section>
      ) : null}

      {state === "empty" ? (
        <section className={styles.empty} aria-label="No project media">
          <h2>No media yet</h2>
          <p>Add the first clip or image here. It will still be here after refresh.</p>
        </section>
      ) : null}

      {state === "ready" || state === "empty" ? (
        <section className={styles.grid} aria-label="Project media gallery">
          <label className={styles.addTile}>
            <input
              accept={FOOTAGE_ACCEPT}
              multiple
              type="file"
              onChange={(event) => {
                void handleFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <span className={styles.addContent}>
              <span className={styles.addIcon} aria-hidden="true">
                +
              </span>
              <span className={styles.addTitle}>Add media</span>
              <span className={styles.addHint}>Upload videos, images, or audio to this project.</span>
            </span>
          </label>

          {visibleQueuedUploads.map((item) => (
            <article className={styles.tile} key={item.id}>
              <span className={statusClassName({ status: item.status } as ProjectMediaAsset)}>
                {uploadStatusLabel(item.status)}
              </span>
              <span className={styles.previewButton}>
                <span className={styles.placeholder}>{kindLabel(item.kind)}</span>
              </span>
              <span className={styles.tileBody}>
                <span className={styles.tileTitle}>{item.name}</span>
                <span className={styles.tileMeta}>
                  {formatUploadSize(item.sizeBytes)} / upload
                </span>
                <span
                  className={styles.statusLine}
                  aria-label={`${item.name} ${Math.round(item.progress)} percent ${item.status}`}
                >
                  {item.status === "failed"
                    ? item.error ?? "Upload failed."
                    : `${Math.round(item.progress)}%`}
                </span>
                {item.status === "failed" ? (
                  <button
                    className={styles.selectButton}
                    onClick={() => uploadQueue.retryUpload(item)}
                    type="button"
                  >
                    Retry upload
                  </button>
                ) : null}
              </span>
            </article>
          ))}

          {assets.map((asset) => {
            const duration = formatDuration(asset.durationSec);
            const previewUrl = assetPreviewUrl(asset);
            const selected = selectedPosition(selectedIds, asset.id);
            const lineageLabel = editedAssetLineageLabel(asset, assetById);
            const canSelect =
              (asset.kind === "image" || asset.kind === "video") && asset.status === "ready";
            return (
              <article
                className={`${styles.tile} ${selected ? styles.tileSelected : ""}`}
                key={asset.id}
              >
                <span className={statusClassName(asset)}>{statusLabel(asset.status)}</span>
                {selected ? (
                  <span className={styles.selectionBadge}>{selected}</span>
                ) : null}
                <button
                  aria-label={`View ${assetDisplayTitle(asset)}`}
                  className={styles.previewButton}
                  type="button"
                  onClick={() => setSelectedAssetId(asset.id)}
                >
                  {asset.kind === "image" && previewUrl ? (
                    <img alt="" src={previewUrl} />
                  ) : null}
                  {asset.kind === "video" && previewUrl ? (
                    <video
                      muted
                      playsInline
                      preload="metadata"
                      src={asset.remoteUrl ?? asset.url}
                      poster={asset.thumbnailUrl ?? undefined}
                    />
                  ) : null}
                  {(!previewUrl || asset.kind === "audio") ? (
                    <span className={styles.placeholder}>{kindLabel(asset.kind)}</span>
                  ) : null}
                </button>
                {duration ? <span className={styles.duration}>{duration}</span> : null}
                <span className={styles.tileBody}>
                  <span className={styles.tileTitle}>{assetDisplayTitle(asset)}</span>
                  <span className={styles.tileMeta}>
                    {kindLabel(asset.kind)} / {assetSourceLabel(asset.source)}
                  </span>
                  {lineageLabel ? (
                    <span className={styles.lineageMeta}>{lineageLabel}</span>
                  ) : null}
                  <button
                    className={styles.selectButton}
                    disabled={!canSelect}
                    onClick={() =>
                      dispatchSelection({ type: "toggle", assetId: asset.id })
                    }
                    type="button"
                  >
                    {selected ? `Selected ${selected}` : "Select"}
                  </button>
                  {asset.status === "failed" ? (
                    <span className={styles.failedActions}>
                      <button className={styles.secondaryButton} type="button" disabled>
                        Retry
                      </button>
                      <button className={styles.secondaryButton} type="button" disabled>
                        Remove
                      </button>
                    </span>
                  ) : null}
                </span>
              </article>
            );
          })}
        </section>
      ) : null}

      {selectedIds.length > 0 ? (
        <form
          className={styles.intentBar}
          onSubmit={(event) => {
            event.preventDefault();
            void createRun();
          }}
        >
          <div className={styles.intentField}>
            <label htmlFor="media-intent">What should we make with these?</label>
            <input
              id="media-intent"
              onChange={(event) => {
                setSelectedPresetId("");
                setIntentText(event.currentTarget.value);
              }}
              placeholder={`${selectedIds.length} selected`}
              value={intentText}
            />
          </div>
          <div className={styles.presetField}>
            <label htmlFor="media-preset">Idea</label>
            <select
              id="media-preset"
              onChange={(event) => {
                const preset =
                  MEDIA_INTENT_PRESETS.find(
                    (item) => item.id === event.currentTarget.value,
                  ) ?? null;
                setSelectedPresetId(preset?.id ?? "");
                if (preset) setIntentText(preset.briefTemplate);
              }}
              value={selectedPresetId}
            >
              <option value="">Choose an idea...</option>
              {MEDIA_INTENT_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>
          <button className={styles.createButton} disabled={!canCreate || creating} type="submit">
            {creating ? "Creating..." : "Create"}
          </button>
          {intentHint ? <p className={styles.intentHint}>{intentHint}</p> : null}
          {createError ? <p className={styles.intentError}>{createError}</p> : null}
        </form>
      ) : null}

      <MediaViewer
        item={selectedAsset ? viewerItem(selectedAsset) : null}
        creditsCharged={billingQuery.data?.creditsCharged}
        hasPrevious={selectedIndex > 0}
        hasNext={selectedIndex >= 0 && selectedIndex < assets.length - 1}
        onClose={() => setSelectedAssetId(null)}
        onPrevious={() => {
          if (selectedIndex > 0) setSelectedAssetId(assets[selectedIndex - 1].id);
        }}
        onNext={() => {
          if (selectedIndex >= 0 && selectedIndex < assets.length - 1) {
            setSelectedAssetId(assets[selectedIndex + 1].id);
          }
        }}
        onRefresh={async (item) => refreshMedia.mutateAsync(item.id)}
        actions={
          projectId ? (
            <Link to={`/projects/${encodeURIComponent(projectId)}`}>Back to project</Link>
          ) : null
        }
      />
    </main>
  );
}
