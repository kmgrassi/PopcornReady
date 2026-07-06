const DATABASE_NAME = "popcorn-share-target-v1";
const STORE_NAME = "shared-files";
const LATEST_SHARE_KEY = "latest";
const SHARE_TARGET_PATH = "/share-target";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTargetPost(event.request));
  }
});

async function handleShareTargetPost(request) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("media")
      .filter((value) => value instanceof File && value.size > 0);

    if (files.length > 0) {
      await writeLatestShare(files);
      return Response.redirect("/?share-target=ready", 303);
    }

    return Response.redirect("/?share-target=empty", 303);
  } catch {
    return Response.redirect("/?share-target=failed", 303);
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function writeLatestShare(files) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      transaction.objectStore(STORE_NAME).put(
        {
          createdAt: new Date().toISOString(),
          files,
        },
        LATEST_SHARE_KEY,
      );
    });
  } finally {
    database.close();
  }
}
