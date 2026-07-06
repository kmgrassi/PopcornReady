import { useRef } from "react";
import { Button, type ButtonVariant } from "../ui/Button";
import {
  PROJECT_UPLOAD_ACCEPT,
  useProjectUploadManager,
  type ProjectUploadSource,
} from "../../lib/projectUpload";
import styles from "./ProjectUploadButton.module.css";

interface ProjectUploadButtonProps {
  projectId: string;
  source: ProjectUploadSource;
  label?: string;
  busyLabel?: string;
  variant?: ButtonVariant;
}

export function ProjectUploadButton({
  projectId,
  source,
  label = "Upload more",
  busyLabel = "Uploading...",
  variant = "secondary",
}: ProjectUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const upload = useProjectUploadManager(projectId, source);

  return (
    <span className={styles.picker}>
      <input
        ref={inputRef}
        className={styles.input}
        accept={PROJECT_UPLOAD_ACCEPT}
        multiple
        type="file"
        onChange={(event) => {
          void upload.handleFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <Button
        variant={variant}
        disabled={!projectId || upload.isUploading}
        isLoading={upload.isUploading}
        onClick={() => inputRef.current?.click()}
      >
        {upload.isUploading ? busyLabel : label}
      </Button>
      <span
        className={styles.status}
        data-tone={upload.error ? "error" : "muted"}
        role={upload.error ? "alert" : "status"}
        aria-live="polite"
      >
        {upload.error ??
          (upload.uploadingCount > 0
            ? `${upload.uploadingCount} ${
                upload.uploadingCount === 1 ? "file" : "files"
              } uploading`
            : "")}
      </span>
    </span>
  );
}
