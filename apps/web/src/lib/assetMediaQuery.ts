import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssetMediaResponse } from "./api-client";
import { v1Api } from "./api-client";
import { queryKeys } from "./queryKeys";

export const ASSET_MEDIA_REFRESH_BUFFER_MS = 5 * 60 * 1_000;
const ASSET_MEDIA_SESSION_PREFIX = "popcornready:asset-media:v1:";

interface PersistedAssetMedia {
  media: AssetMediaResponse;
  savedAt: number;
  seedIdentity: string | null;
}

export interface AssetMediaRetryState {
  blockedUrls: Set<string>;
  inFlight: Promise<AssetMediaResponse | null> | null;
}

const assetMediaRetryStates = new Map<string, AssetMediaRetryState>();
const assetMediaSeedIdentities = new Map<string, string | null>();

export interface AssetMediaSeed {
  url?: string | null;
  thumbnailUrl?: string | null;
  expiresAt?: string | null;
  updatedAt?: string | null;
  visibility?: "public" | "private" | null;
}

export interface UseAssetMediaQueryInput {
  authScope: string;
  workspaceId: string;
  assetId: string;
  initialMedia?: AssetMediaSeed | null;
  enabled?: boolean;
  fetchWhenMissing?: boolean;
  proactiveRefresh?: boolean;
}

function mediaResponse(seed: AssetMediaSeed | null | undefined): AssetMediaResponse | undefined {
  if (!seed) return undefined;
  return {
    url: seed.url ?? null,
    thumbnailUrl: seed.thumbnailUrl ?? null,
    expiresAt: seed.expiresAt ?? null,
  };
}

export function assetMediaSeedIdentity(
  seed: AssetMediaSeed | null | undefined,
): string | null {
  if (!seed?.updatedAt && !seed?.visibility) return null;
  return `${seed.updatedAt ?? ""}|${seed.visibility ?? ""}`;
}

export function assetMediaSessionKey(
  authScope: string,
  workspaceId: string,
  assetId: string,
): string {
  return `${ASSET_MEDIA_SESSION_PREFIX}${encodeURIComponent(authScope)}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(assetId)}`;
}

export function isReusableAssetMedia(
  media: AssetMediaResponse | undefined,
  now = Date.now(),
): boolean {
  if (!media || (!media.url && !media.thumbnailUrl)) return false;
  if (!media.expiresAt) return true;
  const expiresAt = Date.parse(media.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - now > ASSET_MEDIA_REFRESH_BUFFER_MS;
}

export function assetMediaStaleTime(
  media: AssetMediaResponse | undefined,
  dataUpdatedAt: number,
): number {
  if (!media || (!media.url && !media.thumbnailUrl)) return 0;
  if (!media.expiresAt) return Number.POSITIVE_INFINITY;
  const expiresAt = Date.parse(media.expiresAt);
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, expiresAt - ASSET_MEDIA_REFRESH_BUFFER_MS - dataUpdatedAt);
}

export function assetMediaRefreshDelay(
  expiresAt: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!expiresAt) return null;
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - now - ASSET_MEDIA_REFRESH_BUFFER_MS);
}

export function readPersistedAssetMedia(
  storage: Pick<Storage, "getItem" | "removeItem">,
  key: string,
  seedIdentity: string | null = null,
  now = Date.now(),
): PersistedAssetMedia | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedAssetMedia>;
    if (
      typeof parsed.savedAt !== "number" ||
      parsed.seedIdentity !== seedIdentity ||
      !parsed.media ||
      typeof parsed.media !== "object" ||
      !isReusableAssetMedia(parsed.media as AssetMediaResponse, now)
    ) {
      safeRemove(storage, key);
      return null;
    }
    return parsed as PersistedAssetMedia;
  } catch {
    safeRemove(storage, key);
    return null;
  }
}

export function writePersistedAssetMedia(
  storage: Pick<Storage, "setItem" | "removeItem">,
  key: string,
  media: AssetMediaResponse,
  seedIdentity: string | null = null,
  now = Date.now(),
): void {
  try {
    if (!isReusableAssetMedia(media, now)) {
      safeRemove(storage, key);
      return;
    }
    storage.setItem(
      key,
      JSON.stringify({ media, savedAt: now, seedIdentity } satisfies PersistedAssetMedia),
    );
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

function safeRemove(storage: Pick<Storage, "removeItem">, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage access failures.
  }
}

export function createAssetMediaRetryState(): AssetMediaRetryState {
  return { blockedUrls: new Set(), inFlight: null };
}

export function refreshAssetMediaAfterError(
  state: AssetMediaRetryState,
  failedUrl: string | null | undefined,
  refresh: () => Promise<AssetMediaResponse>,
): Promise<AssetMediaResponse | null> {
  if (!failedUrl || state.blockedUrls.has(failedUrl)) {
    return Promise.resolve(null);
  }
  if (state.inFlight) return state.inFlight;

  state.blockedUrls.add(failedUrl);
  const request = refresh().then(
    (media) => {
      const retryTarget = media.url ?? media.thumbnailUrl;
      if (retryTarget) state.blockedUrls.add(retryTarget);
      return media;
    },
    (error: unknown) => {
      state.blockedUrls.delete(failedUrl);
      throw error;
    },
  );
  state.inFlight = request;
  const clearInFlight = () => {
    if (state.inFlight === request) state.inFlight = null;
  };
  void request.then(clearInFlight, clearInFlight);
  return request;
}

export function recordAssetMediaLoad(
  state: AssetMediaRetryState,
  loadedUrl: string | null | undefined,
): void {
  if (loadedUrl) state.blockedUrls.delete(loadedUrl);
}

function browserSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function clearPersistedAssetMedia(): void {
  assetMediaRetryStates.clear();
  assetMediaSeedIdentities.clear();
  const storage = browserSessionStorage();
  if (!storage) return;
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(ASSET_MEDIA_SESSION_PREFIX)) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

export function clearPersistedAssetMediaFor(
  authScope: string,
  workspaceId: string,
  assetId: string,
): void {
  const key = assetMediaSessionKey(authScope, workspaceId, assetId);
  assetMediaRetryStates.delete(key);
  assetMediaSeedIdentities.delete(key);
  const storage = browserSessionStorage();
  if (!storage) return;
  safeRemove(storage, key);
}

export function useAssetMediaQuery({
  authScope,
  workspaceId,
  assetId,
  initialMedia,
  enabled = true,
  fetchWhenMissing = false,
  proactiveRefresh = false,
}: UseAssetMediaQueryInput) {
  const queryClient = useQueryClient();
  const sessionKey = assetMediaSessionKey(authScope, workspaceId, assetId);
  const seedIdentity = assetMediaSeedIdentity(initialMedia);
  const seedMedia = useMemo(
    () => mediaResponse(initialMedia),
    [initialMedia?.expiresAt, initialMedia?.thumbnailUrl, initialMedia?.url],
  );
  const cachedSeedIdentity = assetMediaSeedIdentities.get(sessionKey);
  const shouldReplaceCachedSeed =
    cachedSeedIdentity !== undefined && cachedSeedIdentity !== seedIdentity;
  const initial = useMemo(() => {
    const storage = browserSessionStorage();
    const persisted = storage
      ? readPersistedAssetMedia(storage, sessionKey, seedIdentity)
      : null;
    return {
      media: persisted?.media ?? seedMedia,
      savedAt: persisted?.savedAt ?? Date.now(),
    };
  }, [seedIdentity, seedMedia, sessionKey]);
  const queryKey = useMemo(
    () => queryKeys.assetMedia(authScope, workspaceId, assetId),
    [assetId, authScope, workspaceId],
  );
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => v1Api.refreshAssetMedia(assetId, signal),
    enabled:
      enabled &&
      Boolean(authScope && workspaceId && assetId) &&
      (fetchWhenMissing || Boolean(initial.media?.url || initial.media?.thumbnailUrl)),
    initialData: initial.media,
    initialDataUpdatedAt: initial.media ? initial.savedAt : undefined,
    staleTime: (current) =>
      assetMediaStaleTime(
        current.state.data as AssetMediaResponse | undefined,
        current.state.dataUpdatedAt,
      ),
  });

  useEffect(() => {
    if (shouldReplaceCachedSeed && seedMedia) {
      queryClient.setQueryData(queryKey, seedMedia);
    }
    assetMediaSeedIdentities.set(sessionKey, seedIdentity);
  }, [queryClient, queryKey, seedIdentity, seedMedia, sessionKey, shouldReplaceCachedSeed]);

  useEffect(() => {
    if (!query.data || shouldReplaceCachedSeed) return;
    const storage = browserSessionStorage();
    if (storage) {
      writePersistedAssetMedia(storage, sessionKey, query.data, seedIdentity);
    }
  }, [query.data, seedIdentity, sessionKey, shouldReplaceCachedSeed]);

  useEffect(() => {
    if (!proactiveRefresh || !query.data?.expiresAt || !query.isEnabled) return;
    const delay = assetMediaRefreshDelay(query.data.expiresAt);
    if (delay === null) return;
    if (delay <= 0) {
      void query.refetch();
      return;
    }
    const timer = window.setTimeout(() => void query.refetch(), delay);
    return () => window.clearTimeout(timer);
  }, [proactiveRefresh, query.data?.expiresAt, query.isEnabled, query.refetch]);

  const refresh = useCallback(async () => {
    const result = await query.refetch({ throwOnError: true });
    return result.data ?? { url: null, thumbnailUrl: null, expiresAt: null };
  }, [query.refetch]);

  const refreshAfterError = useCallback(
    (failedUrl: string | null | undefined) => {
      let state = assetMediaRetryStates.get(sessionKey);
      if (!state) {
        state = createAssetMediaRetryState();
        assetMediaRetryStates.set(sessionKey, state);
      }
      return refreshAssetMediaAfterError(state, failedUrl, refresh);
    },
    [refresh, sessionKey],
  );

  const markLoaded = useCallback((loadedUrl: string | null | undefined) => {
    const state = assetMediaRetryStates.get(sessionKey);
    if (state) recordAssetMediaLoad(state, loadedUrl);
  }, [sessionKey]);

  return { ...query, refresh, refreshAfterError, markLoaded };
}
