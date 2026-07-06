import type { SelectedFootage } from "./upload";

const DATABASE_NAME = "popcorn-share-target-v1";
const STORE_NAME = "shared-files";
const LATEST_SHARE_KEY = "latest";

interface SharedFilesRecord {
  createdAt: string;
  files: File[];
}

function openShareTargetDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function drainShareTargetFiles(): Promise<File[]> {
  if (!("indexedDB" in window)) return [];

  const database = await openShareTargetDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const record = await requestToPromise<SharedFilesRecord | undefined>(
      store.get(LATEST_SHARE_KEY),
    );
    await requestToPromise(store.delete(LATEST_SHARE_KEY));
    return record?.files.filter((file) => file instanceof File) ?? [];
  } finally {
    database.close();
  }
}

export function sharedFootageNames(footage: SelectedFootage[]) {
  return footage.map((item) => item.name).join(", ");
}
