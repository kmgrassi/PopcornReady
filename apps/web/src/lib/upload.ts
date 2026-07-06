import {
  inferMobileUploadKind,
  validateMobileUploadCandidate,
  validateMobileUploadCount,
} from "@popcorn/shared/mobile-upload-policy";

// Footage-upload helpers, lifted out of the retired NewProjectPage / Editor so
// the Source Footage step (PR 3) and the Studio shell share one implementation
// instead of re-deriving file metadata inline. PR 3 wires these to the real
// asset-upload endpoint; today they cover selection + local metadata, which is
// all the prompt-only / hybrid flow needs.

/** A locally selected footage file plus the metadata the wizard displays. */
export interface SelectedFootage {
  file: File;
  name: string;
  sizeBytes: number;
  /** Best-effort duration in seconds (4 for images, measured for video). */
  durationSec: number;
  kind: "video" | "image" | "audio";
  requiresTranscode: boolean;
}

export type UploadAnalyticsEvent =
  | {
      type: "selection_rejected";
      reason: string;
      filename?: string;
    }
  | {
      type: "selection_accepted";
      fileCount: number;
      requiresTranscodeCount: number;
    }
  | {
      type: "upload_interrupted";
      reason: "hidden" | "offline";
    }
  | {
      type: "upload_resumed";
      reason: "visible" | "online";
    };

/** File input accept string for the footage picker. */
export const FOOTAGE_ACCEPT =
  "video/*,image/*,audio/*,.mov,.m4v,.heic,.heif";

export function emitUploadAnalytics(event: UploadAnalyticsEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("popcornready:upload", {
      detail: event,
    }),
  );
}

export function watchUploadInterruptions(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const onVisibilityChange = () => {
    if (document.hidden) {
      emitUploadAnalytics({ type: "upload_interrupted", reason: "hidden" });
    } else {
      emitUploadAnalytics({ type: "upload_resumed", reason: "visible" });
    }
  };
  const onOffline = () =>
    emitUploadAnalytics({ type: "upload_interrupted", reason: "offline" });
  const onOnline = () =>
    emitUploadAnalytics({ type: "upload_resumed", reason: "online" });

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
  };
}

/**
 * Measure a clip's duration without uploading it. Images default to 4s;
 * video/audio are probed via a transient media element. Resolves 0 on error so
 * a single bad file never blocks selection.
 */
export function readDuration(file: File): Promise<number> {
  if (file.type.startsWith("image/")) return Promise.resolve(4);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(
      file.type.startsWith("audio/") ? "audio" : "video",
    );
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(media.duration) ? media.duration : 0);
    };
    media.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    media.src = url;
  });
}

/** Read a FileList from a picker into SelectedFootage entries with durations. */
export async function readSelectedFootage(
  files: FileList | File[] | null,
): Promise<SelectedFootage[]> {
  const list = files ? Array.from(files) : [];
  const countIssue = validateMobileUploadCount(list.length);
  if (countIssue) {
    emitUploadAnalytics({
      type: "selection_rejected",
      reason: countIssue.code,
    });
    throw new Error(countIssue.message);
  }

  const selected = await Promise.all(
    list.map(async (file) => {
      const kind = inferMobileUploadKind(file.name, file.type);
      const durationSec = await readDuration(file);
      const validation = validateMobileUploadCandidate({
        filename: file.name,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
        durationSec,
        transport: "base64_json",
        ...(kind ? { kind } : {}),
      });
      if (!validation.ok || !validation.kind) {
        emitUploadAnalytics({
          type: "selection_rejected",
          reason: validation.issue?.code ?? "media_unreadable",
          filename: file.name,
        });
        throw new Error(validation.issue?.message ?? "Could not read this media file.");
      }
      return {
        file,
        name: file.name,
        sizeBytes: file.size,
        durationSec,
        kind: validation.kind,
        requiresTranscode: validation.requiresTranscode,
      };
    }),
  );
  emitUploadAnalytics({
    type: "selection_accepted",
    fileCount: selected.length,
    requiresTranscodeCount: selected.filter((file) => file.requiresTranscode).length,
  });
  return selected;
}
