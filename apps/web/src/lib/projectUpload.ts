import { useState } from "react";
import type { RegisterProjectUploadInput } from "./api-client";
import {
  preflightLandingFootage,
  LANDING_FOOTAGE_ACCEPT,
  landingAssetKindForFile,
} from "./landingUpload";
import { readSelectedFootage, type SelectedFootage } from "./upload";
import { useRegisterProjectUploadMutation } from "./queryClient";

export const PROJECT_UPLOAD_ACCEPT = LANDING_FOOTAGE_ACCEPT;

export type ProjectUploadSource = "project_view" | "project_media_gallery";

export interface ProjectUploadState {
  error: string | null;
  uploadingCount: number;
  isUploading: boolean;
}

export interface ProjectUploadManager extends ProjectUploadState {
  handleFiles: (files: FileList | null) => Promise<void>;
  clearError: () => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, dataBase64 = ""] = result.split(",", 2);
      if (!dataBase64) {
        reject(new Error("Could not read uploaded file bytes."));
        return;
      }
      resolve(dataBase64);
    };
    reader.readAsDataURL(file);
  });
}

export function projectUploadDescription(source: ProjectUploadSource, filename: string) {
  return source === "project_view"
    ? `Added from the project dashboard: ${filename}`
    : `Added from the project media gallery: ${filename}`;
}

export function buildProjectUploadInput(
  item: SelectedFootage,
  dataBase64: string,
  source: ProjectUploadSource,
): RegisterProjectUploadInput {
  const kind = landingAssetKindForFile(item.file);
  if (kind !== "video" && kind !== "image") {
    throw new Error(`${item.name} is not a supported video or image file.`);
  }

  return {
    source: {
      type: "multipart_upload",
      dataBase64,
      mimeType: item.file.type || undefined,
    },
    kind,
    filename: item.name,
    durationSec: item.durationSec,
    userContext: {
      description: projectUploadDescription(source, item.name),
      intendedUse: ["primary_footage"],
    },
  };
}

export function projectUploadStatusMessage(input: {
  uploadingCount: number;
  refreshing: boolean;
  processingCount: number;
}): string {
  if (input.uploadingCount > 0) {
    return `Uploading ${input.uploadingCount} ${
      input.uploadingCount === 1 ? "file" : "files"
    }...`;
  }
  if (input.refreshing) return "Refreshing media status...";
  if (input.processingCount > 0) {
    return `${input.processingCount} ${
      input.processingCount === 1 ? "asset is" : "assets are"
    } processing.`;
  }
  return "";
}

export function useProjectUploadManager(
  projectId: string,
  source: ProjectUploadSource,
): ProjectUploadManager {
  const [error, setError] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const registerUpload = useRegisterProjectUploadMutation(projectId);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || !projectId) return;
    setError(null);
    try {
      const selected = await readSelectedFootage(files);
      const { accepted, errors } = preflightLandingFootage(selected, 0);
      if (errors.length > 0) setError(errors.join(" "));
      if (accepted.length === 0) return;

      setUploadingCount(accepted.length);
      for (const item of accepted) {
        const dataBase64 = await fileToBase64(item.file);
        await registerUpload.mutateAsync(
          buildProjectUploadInput(item, dataBase64, source),
        );
        setUploadingCount((current) => Math.max(0, current - 1));
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Could not add media.",
      );
    } finally {
      setUploadingCount(0);
    }
  }

  return {
    error,
    uploadingCount,
    isUploading: uploadingCount > 0 || registerUpload.isPending,
    handleFiles,
    clearError: () => setError(null),
  };
}
