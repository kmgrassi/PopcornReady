import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { V1Asset } from "@popcorn/shared/v1/types";
import type { RegisterProjectUploadInput } from "./api-client";
import {
  newLandingUploadId,
  registerProjectUploadFile,
  type LandingUploadStatus,
} from "./landingUpload";
import { queryKeys } from "./queryClient";
import type { SelectedFootage } from "./upload";

export interface UploadQueueItem {
  id: string;
  projectId: string;
  file: File;
  name: string;
  sizeBytes: number;
  durationSec: number;
  kind: SelectedFootage["kind"];
  status: LandingUploadStatus;
  progress: number;
  assetId?: string;
  error?: string;
  source: "landing" | "project";
  addedAt: number;
}

interface UploadQueueValue {
  items: UploadQueueItem[];
  enqueueUploads: (
    projectId: string,
    selected: SelectedFootage[],
    options: { source: UploadQueueItem["source"] },
  ) => UploadQueueItem[];
  retryUpload: (item: UploadQueueItem) => void;
  projectItems: (projectId: string) => UploadQueueItem[];
}

const UploadQueueContext = createContext<UploadQueueValue | null>(null);

export function isActiveUploadStatus(status: LandingUploadStatus): boolean {
  return status === "queued" || status === "uploading" || status === "processing";
}

function contextForItem(
  item: UploadQueueItem,
): NonNullable<RegisterProjectUploadInput["userContext"]> {
  if (item.source === "project") {
    return {
      description: `Added from the project media gallery: ${item.name}`,
      intendedUse:
        item.kind === "audio"
          ? ["music", "voiceover", "dialogue"]
          : ["primary_footage"],
    };
  }
  return {
    description: `Selected from the landing page: ${item.name}`,
    intendedUse: ["primary_footage"],
  };
}

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const activeUploads = useRef(new Set<string>());

  const updateItem = useCallback((id: string, patch: Partial<UploadQueueItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const invalidateProjectMedia = useCallback(
    (projectId: string) => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "assets"],
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    [queryClient],
  );

  const uploadItems = useCallback(
    async (batch: UploadQueueItem[]) => {
      let cursor = 0;
      const workerCount = Math.min(2, batch.length);
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (cursor < batch.length) {
            const item = batch[cursor];
            cursor += 1;
            if (activeUploads.current.has(item.id)) continue;
            activeUploads.current.add(item.id);
            updateItem(item.id, {
              status: "uploading",
              progress: Math.max(1, item.progress),
              error: undefined,
            });
            try {
              const asset: V1Asset = await registerProjectUploadFile(
                item.projectId,
                item,
                (progress) => updateItem(item.id, { progress }),
                contextForItem(item),
              );
              updateItem(item.id, {
                status: "ready",
                progress: 100,
                assetId: asset.id,
              });
              invalidateProjectMedia(item.projectId);
            } catch (err) {
              updateItem(item.id, {
                status: "failed",
                error: err instanceof Error ? err.message : "Upload failed.",
              });
            } finally {
              activeUploads.current.delete(item.id);
            }
          }
        }),
      );
    },
    [invalidateProjectMedia, updateItem],
  );

  const enqueueUploads = useCallback(
    (
      projectId: string,
      selected: SelectedFootage[],
      options: { source: UploadQueueItem["source"] },
    ) => {
      const nextItems = selected.map<UploadQueueItem>((footage) => ({
        id: newLandingUploadId(),
        projectId,
        file: footage.file,
        name: footage.name,
        sizeBytes: footage.sizeBytes,
        durationSec: footage.durationSec,
        kind: footage.kind,
        status: "queued",
        progress: 0,
        source: options.source,
        addedAt: Date.now(),
      }));
      setItems((current) => [...current, ...nextItems]);
      void uploadItems(nextItems);
      return nextItems;
    },
    [uploadItems],
  );

  const retryUpload = useCallback(
    (item: UploadQueueItem) => {
      if (isActiveUploadStatus(item.status)) return;
      const retryItem = { ...item, status: "queued" as const, progress: 0 };
      updateItem(item.id, { status: "queued", progress: 0, error: undefined });
      void uploadItems([retryItem]);
    },
    [updateItem, uploadItems],
  );

  const projectItems = useCallback(
    (projectId: string) => items.filter((item) => item.projectId === projectId),
    [items],
  );

  const value = useMemo<UploadQueueValue>(
    () => ({ items, enqueueUploads, retryUpload, projectItems }),
    [enqueueUploads, items, projectItems, retryUpload],
  );

  return (
    <UploadQueueContext.Provider value={value}>
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue(): UploadQueueValue {
  const value = useContext(UploadQueueContext);
  if (!value) throw new Error("useUploadQueue must be used within UploadQueueProvider.");
  return value;
}
