import {
  formatUploadSize,
  LANDING_FOOTAGE_ACCEPT,
  LANDING_MAX_FILES,
  LANDING_MAX_FILE_SIZE_BYTES,
} from "../../lib/landingUpload";
import { sharedFootageNames } from "../../lib/shareTargetFiles";
import type { SelectedFootage } from "../../lib/upload";
import type { UploadQueueItem } from "../../lib/uploadQueue";
import { LENGTH_OPTIONS } from "./homeContent";
import styles from "../HomePage.module.css";

export type UploadSourceMode = "upload" | "record";

interface LandingPromptComposerProps {
  authIsResolving: boolean;
  canSubmit: boolean;
  guestRunLabel: string;
  hasSharedFootage: boolean;
  isPreparingUploadDraft: boolean;
  isStartingRun: boolean;
  onFilesSelected: (files: FileList | null) => void;
  onPromptChange: (prompt: string) => void;
  onRetryUpload: (item: UploadQueueItem) => void;
  onSubmit: () => void;
  onTargetLengthChange: (targetLengthSec: number) => void;
  onUploadSourceModeChange: (mode: UploadSourceMode) => void;
  prompt: string;
  promptTooShort: boolean;
  shareTargetError: string | null;
  shareTargetFootage: SelectedFootage[];
  startError: string | null;
  targetLengthSec: number;
  uploadError: string | null;
  uploadIsBusy: boolean;
  uploadItems: UploadQueueItem[];
  uploadSourceMode: UploadSourceMode;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function LandingPromptComposer({
  authIsResolving,
  canSubmit,
  guestRunLabel,
  hasSharedFootage,
  isPreparingUploadDraft,
  isStartingRun,
  onFilesSelected,
  onPromptChange,
  onRetryUpload,
  onSubmit,
  onTargetLengthChange,
  onUploadSourceModeChange,
  prompt,
  promptTooShort,
  shareTargetError,
  shareTargetFootage,
  startError,
  targetLengthSec,
  uploadError,
  uploadIsBusy,
  uploadItems,
  uploadSourceMode,
}: LandingPromptComposerProps) {
  return (
    <form
      className={styles.promptComposer}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className={styles.promptLabel} htmlFor="landing-video-prompt">
        What should the video be about?
      </label>
      <textarea
        id="landing-video-prompt"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        placeholder="A 30-second launch video for a neighborhood bakery's new midnight cookie menu..."
        rows={4}
      />
      <div className={styles.uploadDrop}>
        <div className={styles.uploadCopy}>
          <strong>Or start from your clips</strong>
          <span>
            Pick up to {LANDING_MAX_FILES} short videos or stills,{" "}
            {formatUploadSize(LANDING_MAX_FILE_SIZE_BYTES)} each for now. Nothing
            generates until you tap create.
          </span>
        </div>
        <div className={styles.uploadControls}>
          <div
            className={styles.uploadModeToggle}
            role="radiogroup"
            aria-label="Clip source"
          >
            <button
              type="button"
              className={uploadSourceMode === "upload" ? styles.activeMode : undefined}
              role="radio"
              aria-checked={uploadSourceMode === "upload"}
              onClick={() => onUploadSourceModeChange("upload")}
            >
              Upload
            </button>
            <button
              type="button"
              className={uploadSourceMode === "record" ? styles.activeMode : undefined}
              role="radio"
              aria-checked={uploadSourceMode === "record"}
              onClick={() => onUploadSourceModeChange("record")}
            >
              Record
            </button>
          </div>
          <label className={styles.uploadPick}>
            <input
              key={uploadSourceMode}
              type="file"
              accept={uploadSourceMode === "record" ? "video/*" : LANDING_FOOTAGE_ACCEPT}
              multiple={uploadSourceMode === "upload"}
              capture={uploadSourceMode === "record" ? "environment" : undefined}
              onChange={(event) => {
                onFilesSelected(event.target.files);
                event.currentTarget.value = "";
              }}
              disabled={
                authIsResolving ||
                uploadItems.length >= LANDING_MAX_FILES ||
                isPreparingUploadDraft
              }
            />
            {authIsResolving
              ? "Loading session..."
              : isPreparingUploadDraft
              ? "Preparing..."
              : uploadSourceMode === "record"
              ? "Record new"
              : "Choose existing"}
          </label>
        </div>
      </div>
      {(uploadItems.length > 0 || uploadError) && (
        <div className={styles.uploadPanel} aria-live="polite">
          {uploadItems.length > 0 && (
            <ul className={styles.uploadList}>
              {uploadItems.map((item) => (
                <li className={styles.uploadItem} key={item.id}>
                  <div className={styles.uploadItemHeader}>
                    <span>{item.name}</span>
                    <em>
                      {formatUploadSize(item.sizeBytes)} · {item.status}
                    </em>
                  </div>
                  <div
                    className={styles.uploadMeter}
                    aria-label={`${item.name} ${Math.round(item.progress)} percent ${item.status}`}
                  >
                    <span style={{ width: `${item.progress}%` }} />
                  </div>
                  {item.error && (
                    <div className={styles.uploadFailure}>
                      <span>{item.error}</span>
                      <button
                        type="button"
                        onClick={() => onRetryUpload(item)}
                        disabled={uploadIsBusy}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {uploadError && <p className={styles.uploadError}>{uploadError}</p>}
        </div>
      )}
      {hasSharedFootage && (
        <section
          className={styles.sharedFootage}
          aria-label="Shared footage ready for upload"
        >
          <div>
            <strong>
              {shareTargetFootage.length === 1
                ? "1 shared clip is ready"
                : `${shareTargetFootage.length} shared clips are ready`}
            </strong>
            <p>Add a brief, then create a run with these clips.</p>
          </div>
          <ul>
            {shareTargetFootage.map((item) => (
              <li key={`${item.name}-${item.sizeBytes}`}>
                <span>{item.name}</span>
                <em>{formatBytes(item.sizeBytes)}</em>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className={styles.promptControls}>
        <label className={styles.lengthControl} htmlFor="landing-video-length">
          <span>Length</span>
          <select
            id="landing-video-length"
            value={targetLengthSec}
            onChange={(event) => onTargetLengthChange(Number(event.target.value))}
          >
            {LENGTH_OPTIONS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds} sec
              </option>
            ))}
          </select>
        </label>
        <button className={styles.promptSubmit} type="submit" disabled={!canSubmit}>
          {isStartingRun
            ? "Starting..."
            : `Create my ${targetLengthSec}-second video`}
        </button>
      </div>
      <p className={styles.promptHint}>
        {startError
          ? startError
          : uploadIsBusy
          ? "Uploading clips now. You can write the brief while they move."
          : shareTargetError
          ? shareTargetError
          : hasSharedFootage
          ? `Shared from your phone: ${sharedFootageNames(shareTargetFootage)}.`
          : promptTooShort
          ? `Add a little more detail before starting.`
          : `Guests can start ${guestRunLabel} before creating an account.`}
      </p>
    </form>
  );
}
