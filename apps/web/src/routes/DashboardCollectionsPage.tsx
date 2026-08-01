import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { GenerationRunStatus } from "@popcorn/shared/v1/types";
import {
  type WorkspaceAsset,
  type WorkspaceAssetSource,
  type WorkspaceOutput,
} from "../lib/api-client";
import { PublishAnchorDialog } from "../components/anchors/PublishAnchorDialog";
import { useAuth } from "../components/auth/AuthProvider";
import { PageHeader } from "../components/ui/PageHeader";
import { Toolbar, ToolbarField } from "../components/ui/Toolbar";
import { Button, ButtonLink } from "../components/ui/Button";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import { ImageWithSkeleton } from "../components/ui/ImageWithSkeleton";
import { VisibilityBadge } from "../components/ui/VisibilityBadge";
import { MediaViewer, type MediaViewerItem } from "../components/media/MediaViewer";
import { AssetImage } from "../components/media/AssetImage";
import { RegenerateImageButton } from "../components/media/RegenerateImageButton";
import { useAssetBillingQuery } from "../lib/queryClient";
import {
  useAssetMediaMutation,
  useAssetRegenerateMutation,
  useAssetVisibilityMutation,
  useDashboardAssetsQuery,
  useDashboardOutputsQuery,
  useDashboardProjectsQuery,
  useDashboardRunsQuery,
  type LibraryScope,
} from "../lib/v1/dashboard/query";
import styles from "./DashboardCollections.module.css";

const PAGE_SIZE = 24;
const DEV_AUTOPILOT = import.meta.env.DEV;
const RUN_STATUSES = ["all", "queued", "running", "succeeded", "failed", "canceled"] as const;
const ASSET_KINDS = ["all", "image", "video", "audio"] as const;
const ASSET_SOURCES = ["all", "uploaded", "generated"] as const;
const LIBRARY_SCOPES: { id: LibraryScope; label: string }[] = [
  { id: "mine", label: "My library" },
  { id: "public", label: "All public" },
];

type RunStatusFilter = (typeof RUN_STATUSES)[number];
type AssetKindFilter = (typeof ASSET_KINDS)[number];
type AssetSourceFilter = (typeof ASSET_SOURCES)[number];

function formatDate(value?: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatDuration(seconds?: number) {
  if (!Number.isFinite(seconds)) return null;
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function useDashboardAuthScope() {
  const auth = useAuth();
  return auth.user?.id ?? (DEV_AUTOPILOT ? "dev-autopilot" : auth.status);
}

function projectCollectionPath(projectId: string, extraParams?: Record<string, string | undefined>) {
  const params = new URLSearchParams({ projectId });
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value) params.set(key, value);
  }
  return `/library/projects?${params.toString()}`;
}

function projectDetailPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}`;
}

function publicProjectPath(projectId: string) {
  return `/p/${encodeURIComponent(projectId)}`;
}

function projectWatchPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/watch`;
}

function statusChipClass(status: string) {
  if (status === "running" || status === "processing") return styles.statusRunning;
  if (status === "succeeded" || status === "ready" || status === "active") return styles.statusSucceeded;
  if (status === "failed" || status === "canceled") return styles.statusFailed;
  return "";
}

function statusDotClass(status: string) {
  if (status === "running" || status === "processing") return styles.statusDotRunning;
  if (status === "succeeded" || status === "ready" || status === "active") return styles.statusDotActive;
  if (status === "failed" || status === "canceled" || status === "deleted") return styles.statusDotFailed;
  return styles.statusDotNeutral;
}

function StatusChip({
  status,
  label,
}: {
  status: GenerationRunStatus | WorkspaceAsset["status"];
  label?: string;
}) {
  return <span className={`${styles.chip} ${statusChipClass(status)}`}>{label ?? titleCase(status)}</span>;
}

function assetViewerItem(asset: WorkspaceAsset): MediaViewerItem {
  const id = asset.assetId ?? asset.id;
  return {
    id,
    kind: asset.kind,
    title: asset.title ?? asset.filename ?? id,
    filename: asset.filename,
    projectName: asset.projectName,
    durationSec: asset.durationSec,
    url: asset.url,
    thumbnailUrl: asset.thumbnailUrl,
  };
}

function outputViewerItem(output: WorkspaceOutput): MediaViewerItem {
  return {
    id: output.artifactId,
    kind: "video",
    title: output.projectName,
    projectName: output.projectName,
    durationSec: output.durationSec,
    url: output.playbackUrl ?? output.url,
    thumbnailUrl: output.thumbnailUrl,
  };
}

function DashboardFrame({
  title,
  description,
  children,
  action,
  showNewVideoAction = true,
}: {
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
  showNewVideoAction?: boolean;
}) {
  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Library"
        title={title}
        description={description}
        action={
          action || showNewVideoAction ? (
            <>
              {action}
              {showNewVideoAction ? (
                <ButtonLink variant="primary" to="/library/projects">
                  Projects
                </ButtonLink>
              ) : null}
            </>
          ) : null
        }
      />
      {children}
    </div>
  );
}

function DashboardSkeleton({ variant = "rows" }: { variant?: "rows" | "grid" }) {
  const isGrid = variant === "grid";
  return (
    <div className={isGrid ? styles.grid : styles.list} aria-hidden="true">
      {Array.from({ length: isGrid ? 8 : 5 }, (_, index) => (
        <div className={`${styles.skeleton} ${isGrid ? styles.skeletonGrid : ""}`} key={index}>
          <span /><span /><span />
        </div>
      ))}
    </div>
  );
}

function ScopeField({ scope, onChange }: { scope: LibraryScope; onChange: (scope: LibraryScope) => void }) {
  return (
    <ToolbarField label="Show">
      <select value={scope} onChange={(event) => onChange(event.target.value as LibraryScope)}>
        {LIBRARY_SCOPES.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
    </ToolbarField>
  );
}

function ScopeIcon({ scope }: { scope: LibraryScope }) {
  if (scope === "public") {
    return (
      <svg className={styles.scopeIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 2.25c1.65 1.45 2.5 3.38 2.5 5.75s-.85 4.3-2.5 5.75C6.35 12.3 5.5 10.37 5.5 8s.85-4.3 2.5-5.75ZM2.75 8h10.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  // "My library" is the whole workspace (public + private projects), not a
  // private-only view — so use a neutral collection glyph, never a lock.
  return (
    <svg className={styles.scopeIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ScopeToggle({ scope, onChange }: { scope: LibraryScope; onChange: (scope: LibraryScope) => void }) {
  return (
    <div className={styles.scopeToggle} role="radiogroup" aria-label="Show projects">
      {LIBRARY_SCOPES.map((option) => {
        const isSelected = option.id === scope;
        const label = option.label;
        return (
          <button
            key={option.id}
            className={styles.scopeButton}
            type="button"
            role="radio"
            aria-checked={isSelected}
            data-active={isSelected}
            onClick={() => onChange(option.id)}
          >
            <ScopeIcon scope={option.id} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className={styles.loadMore}>
      <Button variant="secondary" disabled={loading} onClick={onClick}>
        {loading ? "Loading..." : "Load more"}
      </Button>
    </div>
  );
}

export function RunsPage() {
  const [searchParams] = useSearchParams();
  const authScope = useDashboardAuthScope();
  const projectId = searchParams.get("projectId") ?? undefined;
  const [status, setStatus] = useState<RunStatusFilter>("all");
  const runsQuery = useDashboardRunsQuery(authScope, {
    status,
    projectId,
    limit: PAGE_SIZE,
  });

  return (
    <DashboardFrame
      title="Runs"
      description="Track generation runs in this workspace."
      showNewVideoAction={false}
    >
      <Toolbar>
        <ToolbarField label="Status">
          <select value={status} onChange={(event) => setStatus(event.target.value as RunStatusFilter)}>
            {RUN_STATUSES.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}
          </select>
        </ToolbarField>
      </Toolbar>
      {runsQuery.loading ? <DashboardSkeleton /> : null}
      {!runsQuery.loading && runsQuery.error ? (
        <ErrorState
          title="Unable to load runs"
          body="We couldn’t load generation runs for this workspace."
          error={runsQuery.error}
          onRetry={runsQuery.refetch}
        />
      ) : null}
      {!runsQuery.loading && !runsQuery.error && runsQuery.items.length === 0 ? (
        <EmptyState
          title="No runs match this filter"
          body="Start a new video or choose another status to see past generation work."
          action={<ButtonLink variant="secondary" to="/library/projects">View projects</ButtonLink>}
        />
      ) : null}
      {!runsQuery.loading && !runsQuery.error && runsQuery.items.length > 0 ? (
        <>
          <div className={styles.list}>
            {runsQuery.items.map((run) => (
              <Link className={styles.runRow} to={`/projects/${encodeURIComponent(run.projectId)}/runs/${encodeURIComponent(run.runId)}`} key={run.runId}>
                <div>
                  <span className={styles.rowTitle}>{run.projectName}</span>
                  <span className={styles.rowSub}>{run.currentStageType ? titleCase(run.currentStageType) : "Preparing"} - updated {formatDate(run.updatedAt)}</span>
                </div>
                <div
                  className={`${styles.progress} ${run.progressPercent == null && run.status === "running" ? styles.progressIndeterminate : ""}`}
                  role={run.status === "running" || run.progressPercent != null ? "progressbar" : undefined}
                  aria-valuenow={run.progressPercent ?? undefined}
                  aria-valuemin={run.progressPercent != null ? 0 : undefined}
                  aria-valuemax={run.progressPercent != null ? 100 : undefined}
                  aria-label={run.progressPercent == null && run.status === "running" ? "Generation in progress; percentage unavailable" : run.progressPercent != null ? `${run.progressPercent}% complete` : undefined}
                >
                  <span style={run.progressPercent == null ? (run.status === "running" ? undefined : { width: "0%" }) : { width: `${Math.max(0, Math.min(100, run.progressPercent))}%` }} />
                </div>
                <StatusChip status={run.status} />
              </Link>
            ))}
          </div>
          <LoadMore hasMore={runsQuery.hasMore} loading={runsQuery.loadingMore} onClick={() => void runsQuery.fetchNextPage()} />
        </>
      ) : null}
    </DashboardFrame>
  );
}

// Poster art with a graceful fallback: rows can reference media whose bytes
// are gone (e.g. pre-storage-cutover dev assets), so a failed image load
// degrades to the initial-letter placeholder instead of a broken-image glyph.
// The failure is keyed to the URL that failed, not a sticky flag, so a
// refreshed URL on the same mounted card retries automatically.
function ProjectPoster({ name, posterUrl }: { name: string; posterUrl?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (posterUrl && posterUrl !== failedUrl) {
    return (
      <ImageWithSkeleton
        className={styles.poster}
        src={posterUrl}
        alt=""
        loading="lazy"
        onError={() => setFailedUrl(posterUrl)}
      />
    );
  }
  return (
    <div className={`${styles.poster} ${styles.posterEmpty}`} aria-hidden="true">
      <span>{name.trim().charAt(0).toUpperCase() || "?"}</span>
    </div>
  );
}

export function ProjectsPage() {
  const authScope = useDashboardAuthScope();
  const [scope, setScope] = useState<LibraryScope>("mine");
  const projectsQuery = useDashboardProjectsQuery(authScope, PAGE_SIZE, scope);
  const isPublic = scope === "public";

  return (
    <DashboardFrame
      title="Projects"
      description={
        isPublic
          ? "Public video projects shared across Popcorn Ready."
          : "All active video projects in this workspace."
      }
      action={<ScopeToggle scope={scope} onChange={setScope} />}
    >
      {projectsQuery.loading ? <DashboardSkeleton variant="grid" /> : null}
      {!projectsQuery.loading && projectsQuery.error ? (
        <ErrorState
          title="Unable to load projects"
          body="We couldn’t load projects for this workspace."
          error={projectsQuery.error}
          onRetry={projectsQuery.refetch}
        />
      ) : null}
      {!projectsQuery.loading && !projectsQuery.error && projectsQuery.items.length === 0 ? (
        isPublic ? (
          <EmptyState
            title="No public projects yet"
            body="Projects appear here once they’re shared publicly."
          />
        ) : (
          <EmptyState
            title="No projects yet"
            body="Create a video to start building your project library."
            action={<ButtonLink variant="secondary" to="/library/projects">View projects</ButtonLink>}
          />
        )
      ) : null}
      {!projectsQuery.loading && !projectsQuery.error && projectsQuery.items.length > 0 ? (
        <>
          <div className={`${styles.grid} ${styles.gridProjects}`}>
            {projectsQuery.items.map((project) => (
              <article className={styles.projectCard} key={project.id}>
                {/* Public projects belong to other workspaces; the owner detail
                    route is workspace-scoped, so public cards open the no-login
                    read-only share page instead. */}
                <Link
                  className={styles.cardLink}
                  to={isPublic ? publicProjectPath(project.id) : projectDetailPath(project.id)}
                  aria-label={`Open ${project.name}. Status: ${titleCase(
                    project.status,
                  )}. Visibility: ${titleCase(project.visibility ?? "public")}`}
                >
                  <span
                    className={`${styles.statusDot} ${statusDotClass(project.status)}`}
                    aria-hidden="true"
                  />
                  <ProjectPoster name={project.name} posterUrl={project.posterUrl} />
                </Link>
                <div className={styles.projectCardBody}>
                  <div>
                    <Link
                      className={`${styles.rowTitle} ${styles.titleLink}`}
                      to={isPublic ? publicProjectPath(project.id) : projectDetailPath(project.id)}
                    >
                      {project.name}
                    </Link>
                    <span className={styles.rowSub}>Updated {formatDate(project.updatedAt)}</span>
                  </div>
                  <div className={styles.cardMeta}>
                    <span className={styles.visibilityMeta}>
                      <VisibilityBadge visibility={project.visibility} />
                    </span>
                    <span>{project.hasStoryboard ? "Storyboard ready" : "No storyboard yet"}</span>
                    <span>Created {formatDate(project.createdAt)}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <LoadMore hasMore={projectsQuery.hasMore} loading={projectsQuery.loadingMore} onClick={() => void projectsQuery.fetchNextPage()} />
        </>
      ) : null}
    </DashboardFrame>
  );
}

export function AssetsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const authScope = useDashboardAuthScope();
  const [scope, setScope] = useState<LibraryScope>("mine");
  const [kind, setKind] = useState<AssetKindFilter>("all");
  const [source, setSource] = useState<AssetSourceFilter>("all");
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [openingIds, setOpeningIds] = useState<Set<string>>(() => new Set());
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [publishingAsset, setPublishingAsset] = useState<WorkspaceAsset | null>(null);
  const isPublic = scope === "public";
  const assetFilters = { kind, source, limit: PAGE_SIZE };
  const assetsQuery = useDashboardAssetsQuery(authScope, assetFilters, scope);
  const visibilityMutation = useAssetVisibilityMutation(authScope, assetFilters);
  const mediaMutation = useAssetMediaMutation(authScope, assetFilters);
  const regenerateMutation = useAssetRegenerateMutation(authScope, assetFilters);
  const setSelectedAsset = useCallback((assetId: string) => {
    setSelectedAssetId(assetId);
    const next = new URLSearchParams(searchParams);
    next.set("assetId", assetId);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const toggleVisibility = useCallback(async (asset: WorkspaceAsset) => {
    const id = asset.assetId ?? asset.id;
    const previous = asset.visibility === "private" ? "private" : "public";
    const next = previous === "private" ? "public" : "private";
    setPendingIds((current) => new Set(current).add(id));
    try {
      await visibilityMutation.mutateAsync({ asset, visibility: next });
    } finally {
      setPendingIds((current) => {
        const updated = new Set(current);
        updated.delete(id);
        return updated;
      });
    }
  }, [visibilityMutation]);

  const openAsset = useCallback(async (asset: WorkspaceAsset) => {
    const id = asset.assetId ?? asset.id;
    if (asset.url || asset.thumbnailUrl) {
      setSelectedAsset(id);
      return;
    }

    setOpeningIds((current) => new Set(current).add(id));
    try {
      await mediaMutation.mutateAsync(id);
      setSelectedAsset(id);
    } catch {
      setSelectedAsset(id);
    } finally {
      setOpeningIds((current) => {
        const updated = new Set(current);
        updated.delete(id);
        return updated;
      });
    }
  }, [mediaMutation]);

  const selectedIndex = selectedAssetId
    ? assetsQuery.items.findIndex((asset) => (asset.assetId ?? asset.id) === selectedAssetId)
    : -1;
  const selectedAsset = selectedIndex >= 0 ? assetsQuery.items[selectedIndex] : null;
  const billingQuery = useAssetBillingQuery(
    authScope,
    selectedAsset?.projectId ?? "",
    selectedAsset ? selectedAsset.assetId ?? selectedAsset.id : null,
    Boolean(selectedAsset && !isPublic),
  );
  const requestedAssetId = searchParams.get("assetId");

  useEffect(() => {
    if (!requestedAssetId || selectedAssetId) return;
    const requestedAsset = assetsQuery.items.find(
      (asset) => (asset.assetId ?? asset.id) === requestedAssetId,
    );
    if (!requestedAsset) return;
    void openAsset(requestedAsset);
  }, [assetsQuery.items, openAsset, requestedAssetId, selectedAssetId]);

  const closeAssetViewer = useCallback(() => {
    setSelectedAssetId(null);
    if (!searchParams.has("assetId")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("assetId");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <DashboardFrame
      title="Assets"
      description={
        isPublic
          ? "Public media shared across Popcorn Ready projects."
          : "Generated and uploaded media across all projects in this workspace."
      }
    >
      <Toolbar>
        <ScopeField scope={scope} onChange={setScope} />
        <ToolbarField label="Kind">
          <select value={kind} onChange={(event) => setKind(event.target.value as AssetKindFilter)}>
            {ASSET_KINDS.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}
          </select>
        </ToolbarField>
        {!isPublic ? (
          <ToolbarField label="Source">
            <select value={source} onChange={(event) => setSource(event.target.value as AssetSourceFilter)}>
              {ASSET_SOURCES.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}
            </select>
          </ToolbarField>
        ) : null}
      </Toolbar>
      {assetsQuery.loading ? <DashboardSkeleton variant="grid" /> : null}
      {!assetsQuery.loading && assetsQuery.error ? (
        <ErrorState
          title="Unable to load assets"
          body="We couldn’t load media assets for this workspace."
          error={assetsQuery.error}
          onRetry={assetsQuery.refetch}
        />
      ) : null}
      {!assetsQuery.loading && !assetsQuery.error && assetsQuery.items.length === 0 ? (
        isPublic ? (
          <EmptyState
            title="No public assets match this filter"
            body="Public media appears here once projects share their assets."
          />
        ) : (
          <EmptyState
            title="No assets match this filter"
            body="Upload source media or generate assets to build the workspace library."
            action={<ButtonLink variant="secondary" to="/library/projects">View projects</ButtonLink>}
          />
        )
      ) : null}
      {!assetsQuery.loading && !assetsQuery.error && assetsQuery.items.length > 0 ? (
        <>
          <div className={styles.grid}>
            {assetsQuery.items.map((asset) => {
              const id = asset.assetId ?? asset.id;
              // Owned image with no deliverable bytes (or an outright failure) is
              // regenerable in place — offer it as an overlay (sibling to the
              // card button, not nested inside it).
              const canRegenerate =
                !isPublic &&
                asset.kind === "image" &&
                (asset.status === "failed" || !(asset.thumbnailUrl ?? asset.url));
              return (
                <div className={styles.card} key={id}>
                  <button
                    className={styles.cardButton}
                    type="button"
                    disabled={openingIds.has(id)}
                    onClick={() => void openAsset(asset)}
                    aria-label={`View ${asset.title ?? asset.filename ?? id}`}
                  >
                    <AssetPreview asset={asset} />
                    <div className={styles.cardBody}>
                      <div><span className={styles.rowTitle}>{asset.title ?? asset.filename ?? asset.id}</span><span className={styles.rowSub}>{asset.projectName}</span></div>
                      <div className={styles.cardMeta}>
                        <span>{titleCase(asset.kind)}</span>
                        <VisibilityBadge visibility={asset.visibility} />
                        <StatusChip status={asset.status} />
                      </div>
                    </div>
                  </button>
                  {canRegenerate ? (
                    <div className={styles.cardRegen}>
                      <RegenerateImageButton
                        assetId={id}
                        prompt={asset.prompt ?? asset.promptPreview ?? null}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <LoadMore hasMore={assetsQuery.hasMore} loading={assetsQuery.loadingMore} onClick={() => void assetsQuery.fetchNextPage()} />
        </>
      ) : null}
      <MediaViewer
        item={selectedAsset ? assetViewerItem(selectedAsset) : null}
        creditsCharged={isPublic ? undefined : billingQuery.data?.creditsCharged}
        hasPrevious={selectedIndex > 0}
        hasNext={selectedIndex >= 0 && selectedIndex < assetsQuery.items.length - 1}
        onClose={closeAssetViewer}
        onPrevious={() => {
          if (selectedIndex > 0) {
            setSelectedAsset(assetsQuery.items[selectedIndex - 1].assetId ?? assetsQuery.items[selectedIndex - 1].id);
          }
        }}
        onNext={() => {
          if (selectedIndex >= 0 && selectedIndex < assetsQuery.items.length - 1) {
            setSelectedAsset(assetsQuery.items[selectedIndex + 1].assetId ?? assetsQuery.items[selectedIndex + 1].id);
          }
        }}
        onRefresh={
          isPublic
            ? undefined
            : async (item) => {
                return mediaMutation.mutateAsync(item.id);
              }
        }
        onRegenerate={
          isPublic
            ? undefined
            : async (item, input) => {
                return regenerateMutation.mutateAsync({
                  assetId: item.id,
                  prompt: input?.prompt,
                  provider: input?.provider,
                  model: input?.model,
                });
              }
        }
        actions={
          selectedAsset ? (
            <div className={styles.viewerActions}>
              {!isPublic ? (
                <ButtonLink
                  variant="ghost"
                  size="sm"
                  to={projectCollectionPath(selectedAsset.projectId)}
                >
                  Project
                </ButtonLink>
              ) : null}
              {!isPublic && selectedAsset.kind === "image" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPublishingAsset(selectedAsset)}
                >
                  Publish as anchor
                </Button>
              ) : null}
              {!isPublic ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pendingIds.has(selectedAsset.assetId ?? selectedAsset.id)}
                  onClick={() => void toggleVisibility(selectedAsset)}
                >
                  {selectedAsset.visibility === "private" ? "Make public" : "Make private"}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />
      <PublishAnchorDialog
        source={
          publishingAsset
            ? {
                type: "asset",
                assetId: publishingAsset.assetId ?? publishingAsset.id,
                defaultKind: "image",
                title: publishingAsset.title ?? publishingAsset.filename ?? null,
                summary: publishingAsset.description ?? null,
              }
            : null
        }
        onClose={() => setPublishingAsset(null)}
      />
    </DashboardFrame>
  );
}

function AssetPreview({ asset }: { asset: WorkspaceAsset }) {
  // Rows can reference media whose bytes are gone (pre-storage-cutover dev
  // assets); AssetImage degrades to the kind placeholder on error instead of a
  // broken-image glyph. Recovery is disabled here because the surrounding card
  // is a <button>; the grid renders a sibling regenerate overlay (cardRegen).
  return (
    <AssetImage
      kind={asset.kind === "video" ? "video" : asset.kind === "audio" ? "audio" : "image"}
      url={asset.url}
      thumbnailUrl={asset.thumbnailUrl}
      status={asset.status}
      mediaClassName={styles.media}
      placeholderClassName={`${styles.media} ${styles.mediaEmpty}`}
      placeholder={<span>{titleCase(asset.kind)}</span>}
      allowRegenerate={false}
    />
  );
}

export function OutputsPage() {
  const authScope = useDashboardAuthScope();
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const outputsQuery = useDashboardOutputsQuery(authScope, PAGE_SIZE);

  const selectedIndex = selectedOutputId
    ? outputsQuery.items.findIndex((output) => output.artifactId === selectedOutputId)
    : -1;
  const selectedOutput = selectedIndex >= 0 ? outputsQuery.items[selectedIndex] : null;

  return (
    <DashboardFrame title="Outputs" description="Finished exported videos from every project in the active workspace.">
      {outputsQuery.loading ? <DashboardSkeleton variant="grid" /> : null}
      {!outputsQuery.loading && outputsQuery.error ? (
        <ErrorState
          title="Unable to load outputs"
          body="We couldn’t load exported videos for this workspace."
          error={outputsQuery.error}
          onRetry={outputsQuery.refetch}
        />
      ) : null}
      {!outputsQuery.loading && !outputsQuery.error && outputsQuery.items.length === 0 ? (
        <EmptyState
          title="No finished outputs yet"
          body="Exports appear here after a video finishes rendering successfully."
          action={<ButtonLink variant="secondary" to="/library/projects">View projects</ButtonLink>}
        />
      ) : null}
      {!outputsQuery.loading && !outputsQuery.error && outputsQuery.items.length > 0 ? (
        <>
          <div className={`${styles.grid} ${styles.gridOutputs}`}>
            {outputsQuery.items.map((output) => {
              const playbackUrl = output.playbackUrl ?? output.url;
              return (
                <article className={styles.card} key={output.artifactId}>
                  <button
                    className={styles.cardButton}
                    type="button"
                    onClick={() => setSelectedOutputId(output.artifactId)}
                    aria-label={`View ${output.projectName} output`}
                  >
                  <div className={styles.outputMedia}>
                    {playbackUrl ? <video className={styles.media} src={playbackUrl} poster={output.thumbnailUrl} muted playsInline preload="metadata" /> : output.thumbnailUrl ? <ImageWithSkeleton className={styles.media} src={output.thumbnailUrl} alt="" loading="lazy" /> : <div className={`${styles.media} ${styles.mediaEmpty}`}><span>Output</span></div>}
                  </div>
                  <div className={styles.cardBody}>
                    <div><span className={styles.rowTitle}>{output.projectName}</span><span className={styles.rowSub}>Exported {formatDate(output.createdAt)}</span></div>
                    <div className={styles.cardMeta}>{output.format ? <span>{output.format.toUpperCase()}</span> : null}{formatDuration(output.durationSec) ? <span>{formatDuration(output.durationSec)}</span> : null}{output.timelineId ? <span>Timeline</span> : <span>Project</span>}</div>
                  </div>
                  </button>
                  <div className={styles.cardActions}>
                    <ButtonLink
                      variant="ghost"
                      size="sm"
                      to={projectCollectionPath(output.projectId, { timelineId: output.timelineId })}
                    >
                      Project
                    </ButtonLink>
                    <ButtonLink
                      variant="ghost"
                      size="sm"
                      to={projectWatchPath(output.projectId)}
                    >
                      Watch
                    </ButtonLink>
                  </div>
                </article>
              );
            })}
          </div>
          <LoadMore hasMore={outputsQuery.hasMore} loading={outputsQuery.loadingMore} onClick={() => void outputsQuery.fetchNextPage()} />
        </>
      ) : null}
      <MediaViewer
        item={selectedOutput ? outputViewerItem(selectedOutput) : null}
        hasPrevious={selectedIndex > 0}
        hasNext={selectedIndex >= 0 && selectedIndex < outputsQuery.items.length - 1}
        onClose={() => setSelectedOutputId(null)}
        onPrevious={() => {
          if (selectedIndex > 0) setSelectedOutputId(outputsQuery.items[selectedIndex - 1].artifactId);
        }}
        onNext={() => {
          if (selectedIndex >= 0 && selectedIndex < outputsQuery.items.length - 1) {
            setSelectedOutputId(outputsQuery.items[selectedIndex + 1].artifactId);
          }
        }}
      />
    </DashboardFrame>
  );
}
