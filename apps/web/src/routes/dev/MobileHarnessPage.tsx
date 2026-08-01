import { useState, type ReactNode } from "react";
import { MediaViewer } from "../../components/media/MediaViewer";
import {
  landingUploadHarnessItems,
  landingUploadStatusCounts,
  mediaGalleryHarnessAssets,
  mediaGalleryIntentPresets,
  selectedGalleryAssets,
  type GalleryHarnessAsset,
  type LandingUploadHarnessItem,
} from "./devHarness";
import styles from "./MobileHarnessPage.module.css";

function uploadStatusLabel(status: LandingUploadHarnessItem["status"]) {
  if (status === "failed") return "Failed - retry";
  if (status === "ready") return "Ready";
  if (status === "processing") return "Processing";
  if (status === "uploading") return "Uploading";
  return "Queued";
}

function assetStatusLabel(status: GalleryHarnessAsset["status"]) {
  if (status === "pending") return "Processing";
  return status[0].toUpperCase() + status.slice(1);
}

function statusClass(status: LandingUploadHarnessItem["status"] | GalleryHarnessAsset["status"]) {
  if (status === "ready") return `${styles.badge} ${styles.ready}`;
  if (status === "failed") return `${styles.badge} ${styles.failed}`;
  if (status === "queued" || status === "pending") return `${styles.badge} ${styles.queued}`;
  return `${styles.badge} ${styles.busy}`;
}

function HarnessShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </header>
      {children}
    </main>
  );
}

export function DevLandingUploadPage() {
  const counts = landingUploadStatusCounts(landingUploadHarnessItems);
  return (
    <HarnessShell
      eyebrow="Dev harness"
      title="Landing upload states"
      subtitle="Mock mobile upload states for queued, active, processed, ready, and failed-retry clips."
    >
      <section className={styles.phoneStage} aria-label="Landing upload mobile preview">
        <div className={styles.uploadComposer}>
          <label className={styles.promptLabel} htmlFor="dev-landing-prompt">
            What should the video be about?
          </label>
          <textarea
            id="dev-landing-prompt"
            value="A short launch video for a bakery's midnight cookie menu, using phone clips first."
            readOnly
          />
          <div className={styles.dropTarget}>
            <div>
              <strong>Start from your clips</strong>
              <span>5 files selected across every upload state.</span>
            </div>
            <div className={styles.pickRow}>
              <button type="button">Choose existing</button>
              <button type="button">Record new</button>
            </div>
          </div>
          <ul className={styles.uploadList}>
            {landingUploadHarnessItems.map((item) => (
              <li className={styles.uploadItem} key={item.id}>
                <div className={styles.itemTopline}>
                  <span>{item.name}</span>
                  <em>
                    {item.sizeLabel}
                    {item.durationLabel ? ` / ${item.durationLabel}` : ""}
                  </em>
                </div>
                <div className={styles.itemMeta}>
                  <span className={statusClass(item.status)}>{uploadStatusLabel(item.status)}</span>
                  <span>{item.kind}</span>
                </div>
                <div
                  className={styles.meter}
                  aria-label={`${item.name} ${item.progress} percent ${item.status}`}
                >
                  <span style={{ width: `${item.progress}%` }} />
                </div>
                {item.error ? (
                  <div className={styles.retryRow}>
                    <span>{item.error}</span>
                    <button type="button">Retry</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <button className={styles.ctaButton} type="button">
            Create from 1 clip
          </button>
        </div>
        <aside className={styles.statePanel} aria-label="Fixture state summary">
          <h2>Fixture coverage</h2>
          <dl>
            <div>
              <dt>Queued</dt>
              <dd>{counts.queued}</dd>
            </div>
            <div>
              <dt>Uploading</dt>
              <dd>{counts.uploading}</dd>
            </div>
            <div>
              <dt>Processing</dt>
              <dd>{counts.processing}</dd>
            </div>
            <div>
              <dt>Ready</dt>
              <dd>{counts.ready}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{counts.failed}</dd>
            </div>
          </dl>
        </aside>
      </section>
    </HarnessShell>
  );
}

export function DevMediaGalleryPage() {
  const selected = selectedGalleryAssets(mediaGalleryHarnessAssets);
  const [detailOpen, setDetailOpen] = useState(
    () => new URLSearchParams(window.location.search).get("asset-detail") === "credits",
  );
  return (
    <HarnessShell
      eyebrow="Dev harness"
      title="Media gallery states"
      subtitle="Mock project media with mixed asset statuses, ordered selection, and the mobile intent bar."
    >
      <section className={styles.galleryToolbar} aria-label="Media gallery summary">
        <div>
          <strong>{mediaGalleryHarnessAssets.length}</strong>
          <span>Assets</span>
        </div>
        <div>
          <strong>{selected.length}</strong>
          <span>Selected</span>
        </div>
        <div>
          <strong>4</strong>
          <span>Presets</span>
        </div>
      </section>

      <section className={styles.galleryGrid} aria-label="Mock media gallery">
        {mediaGalleryHarnessAssets.map((asset) => (
          <article className={styles.assetTile} key={asset.id}>
            <div className={`${styles.thumb} ${styles[asset.thumbTone]}`}>
              <span className={styles.kind}>{asset.kind}</span>
              {asset.selectedOrder ? (
                <span className={styles.orderBadge}>{asset.selectedOrder}</span>
              ) : null}
            </div>
            <div className={styles.assetBody}>
              <span className={statusClass(asset.status)}>{assetStatusLabel(asset.status)}</span>
              <h2>{asset.title}</h2>
              <p>
                {asset.source}
                {asset.durationLabel ? ` / ${asset.durationLabel}` : ""}
              </p>
            </div>
          </article>
        ))}
      </section>

      <section className={styles.intentBar} aria-label="Intent presets">
        <div className={styles.intentSummary}>
          <strong>Use {selected.length} selected assets as</strong>
          <span>{selected.map((asset) => asset.title).join(" + ")}</span>
        </div>
        <div className={styles.intentButtons}>
          {mediaGalleryIntentPresets.map((preset) => (
            <button
              className={preset.active ? styles.intentActive : undefined}
              key={preset.id}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>
      <MediaViewer
        item={detailOpen ? {
          id: "asset-ready",
          kind: "image",
          title: "Cookie box hero",
          projectName: "Midnight Bakery",
          thumbnailUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 960 540'%3E%3Crect width='960' height='540' fill='%2314111c'/%3E%3Ccircle cx='480' cy='270' r='150' fill='%23f5b62a'/%3E%3C/svg%3E",
        } : null}
        creditsCharged={84}
        onClose={() => setDetailOpen(false)}
      />
    </HarnessShell>
  );
}
