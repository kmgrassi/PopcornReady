import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FOOTAGE_ACCEPT, readSelectedFootage } from "../lib/upload";
import {
  useProjectAssetsQuery,
  useRefreshAssetMediaMutation,
  useRegisterProjectUploadMutation,
} from "../lib/queryClient";
import { MediaViewer, type MediaViewerItem } from "../components/media/MediaViewer";
import {
  assetDisplayTitle,
  assetPreviewUrl,
  formatDuration,
  galleryRenderState,
  kindLabel,
  projectMediaQueryParams,
  statusLabel,
  type ProjectMediaAsset,
} from "./projectMediaGallery";
import styles from "./ProjectMediaGalleryPage.module.css";

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

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

export function ProjectMediaGalleryPage() {
  const projectId = useParams().projectId ?? "";
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const assetsQuery = useProjectAssetsQuery(projectId, projectMediaQueryParams());
  const registerUpload = useRegisterProjectUploadMutation(projectId);
  const refreshMedia = useRefreshAssetMediaMutation();

  const assets = (assetsQuery.data?.assets ?? []) as ProjectMediaAsset[];
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
  const statusMessage = useMemo(() => {
    if (uploadingCount > 0) {
      return `Uploading ${uploadingCount} ${uploadingCount === 1 ? "file" : "files"}...`;
    }
    if (assetsQuery.isFetching && !assetsQuery.isLoading) {
      return "Refreshing media status...";
    }
    if (processingCount > 0) {
      return `${processingCount} ${processingCount === 1 ? "asset is" : "assets are"} processing.`;
    }
    return "";
  }, [assetsQuery.isFetching, assetsQuery.isLoading, processingCount, uploadingCount]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !projectId) return;
    setUploadError(null);
    try {
      const selected = await readSelectedFootage(files);
      setUploadingCount(selected.length);
      for (const item of selected) {
        const dataBase64 = await fileToBase64(item.file);
        await registerUpload.mutateAsync({
          source: {
            type: "multipart_upload",
            dataBase64,
            mimeType: item.file.type || undefined,
          },
          kind: item.kind,
          filename: item.name,
          durationSec: item.durationSec,
          userContext: {
            description: `Added from the project media gallery: ${item.name}`,
            intendedUse:
              item.kind === "audio"
                ? ["music", "voiceover", "dialogue"]
                : ["primary_footage"],
          },
        });
        setUploadingCount((current) => Math.max(0, current - 1));
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not add media.");
    } finally {
      setUploadingCount(0);
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
        </div>
      </header>

      <div
        className={styles.statusLine}
        role={uploadError || assetsQuery.error ? "alert" : "status"}
      >
        {uploadError ?? (assetsQuery.error ? "Could not load project media." : statusMessage)}
      </div>

      {state === "loading" ? (
        <section className={styles.empty} aria-label="Loading project media">
          <h2>Loading media</h2>
          <p>Fetching the project asset list from the API.</p>
        </section>
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

          {assets.map((asset) => {
            const duration = formatDuration(asset.durationSec);
            const previewUrl = assetPreviewUrl(asset);
            return (
              <article className={styles.tile} key={asset.id}>
                <span className={statusClassName(asset)}>{statusLabel(asset.status)}</span>
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
                    {kindLabel(asset.kind)} / {asset.source}
                  </span>
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

      <MediaViewer
        item={selectedAsset ? viewerItem(selectedAsset) : null}
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
