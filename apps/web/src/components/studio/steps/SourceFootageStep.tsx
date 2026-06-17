import { useRef, useState } from "react";
import { FOOTAGE_ACCEPT, readSelectedFootage } from "../../../lib/upload";
import type { StepProps } from "../useStudioFlow";
import { StepShell } from "./StepShell";
import styles from "./SourceFootageStep.module.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "duration unavailable";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

export function SourceFootageStep({ draft, update, next, back }: StepProps) {
  const [isReading, setIsReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const selectionRequestId = useRef(0);
  const isUploadMode = draft.footageChoice === "upload";
  const hasVisualFootage = draft.selectedFootage.some(
    (selected) =>
      selected.file.type.startsWith("video/") || selected.file.type.startsWith("image/"),
  );

  async function onFilesSelected(files: FileList | null) {
    const requestId = selectionRequestId.current + 1;
    selectionRequestId.current = requestId;
    setIsReading(true);
    setReadError(null);
    try {
      const selectedFootage = await readSelectedFootage(files);
      if (selectionRequestId.current !== requestId) return;
      update({ footageChoice: "upload", selectedFootage });
    } catch (error) {
      if (selectionRequestId.current !== requestId) return;
      setReadError(
        error instanceof Error ? error.message : "Could not read the selected footage.",
      );
    } finally {
      if (selectionRequestId.current === requestId) {
        setIsReading(false);
      }
    }
  }

  function selectPromptOnly() {
    selectionRequestId.current += 1;
    setReadError(null);
    setIsReading(false);
    update({
      footageChoice: "prompt_only",
      selectedFootage: [],
    });
  }

  return (
    <StepShell
      heading="Do you have any of your own assets/footage to use for this video?"
      onNext={next}
      onBack={back}
      nextLabel="Continue"
      nextDisabled={isReading || (isUploadMode && !hasVisualFootage)}
    >
      <div className={styles.choiceGrid}>
        <label className={styles.choiceCard}>
          <input
            type="radio"
            name="footage-choice"
            checked={draft.footageChoice === "prompt_only"}
            onChange={selectPromptOnly}
          />
          <span className={styles.choiceTitle}>No</span>
        </label>

        <label className={styles.choiceCard}>
          <input
            type="radio"
            name="footage-choice"
            checked={draft.footageChoice === "upload"}
            onChange={() =>
              update({
                footageChoice: "upload",
                footageMode: "hybrid",
              })
            }
          />
          <span className={styles.choiceTitle}>Yes</span>
        </label>
      </div>

      {isUploadMode ? (
        <section className={styles.uploadPanel} aria-label="Selected footage">
          <div className={styles.uploadHeader}>
            <div>
              <p className={styles.uploadTitle}>Source files</p>
              <p className={styles.uploadHelp}>Videos, images, or audio can guide the cut.</p>
            </div>
            <input
              className={styles.fileInput}
              type="file"
              accept={FOOTAGE_ACCEPT}
              multiple
              onChange={(event) => void onFilesSelected(event.currentTarget.files)}
            />
          </div>

          {isReading ? <p className={styles.status}>Reading file metadata...</p> : null}
          {readError ? <p className={styles.status}>{readError}</p> : null}

          {draft.selectedFootage.length > 0 ? (
            <ul className={styles.fileList}>
              {draft.selectedFootage.map((file) => (
                <li className={styles.fileItem} key={`${file.name}-${file.sizeBytes}`}>
                  <span className={styles.fileName}>{file.name}</span>
                  <span className={styles.fileMeta}>
                    {formatBytes(file.sizeBytes)} · {formatDuration(file.durationSec)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.status}>
              Select at least one video or image before continuing with footage.
            </p>
          )}
        </section>
      ) : null}
    </StepShell>
  );
}
