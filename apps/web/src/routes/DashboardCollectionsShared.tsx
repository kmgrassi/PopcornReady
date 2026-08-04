import type { ReactNode } from "react";
import type { GenerationRunStatus } from "@popcorn/shared/v1/types";
import type { WorkspaceAsset } from "../lib/api-client";
import { PageHeader } from "../components/ui/PageHeader";
import { Toolbar, ToolbarField } from "../components/ui/Toolbar";
import { Button, ButtonLink } from "../components/ui/Button";
import styles from "./DashboardCollections.module.css";
import type { LibraryScope } from "../lib/v1/dashboard/query";

export const PAGE_SIZE = 24;
export const DEV_AUTOPILOT = import.meta.env.DEV;
export const RUN_STATUSES = ["all", "queued", "running", "succeeded", "failed", "canceled"] as const;
export const ASSET_KINDS = ["all", "image", "video", "audio"] as const;
export const ASSET_SOURCES = ["all", "uploaded", "generated"] as const;
const LIBRARY_SCOPES: { id: LibraryScope; label: string }[] = [
  { id: "mine", label: "My library" },
  { id: "public", label: "All public" },
];

export type RunStatusFilter = (typeof RUN_STATUSES)[number];
export type AssetKindFilter = (typeof ASSET_KINDS)[number];
export type AssetSourceFilter = (typeof ASSET_SOURCES)[number];

export function formatDate(value?: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDuration(seconds?: number) {
  if (!Number.isFinite(seconds)) return null;
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function projectCollectionPath(projectId: string, extraParams?: Record<string, string | undefined>) {
  const params = new URLSearchParams({ projectId });
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value) params.set(key, value);
  }
  return `/library/projects?${params.toString()}`;
}

export function projectDetailPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function publicProjectPath(projectId: string) {
  return `/p/${encodeURIComponent(projectId)}`;
}

export function projectWatchPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/watch`;
}

export function statusChipClass(status: string) {
  if (status === "running" || status === "processing") return styles.statusRunning;
  if (status === "succeeded" || status === "ready" || status === "active") return styles.statusSucceeded;
  if (status === "failed" || status === "canceled") return styles.statusFailed;
  return "";
}

export function statusDotClass(status: string) {
  if (status === "running" || status === "processing") return styles.statusDotRunning;
  if (status === "succeeded" || status === "ready" || status === "active") return styles.statusDotActive;
  if (status === "failed" || status === "canceled" || status === "deleted") return styles.statusDotFailed;
  return styles.statusDotNeutral;
}

export function StatusChip({
  status,
  label,
}: {
  status: GenerationRunStatus | WorkspaceAsset["status"];
  label?: string;
}) {
  return <span className={`${styles.chip} ${statusChipClass(status)}`}>{label ?? titleCase(status)}</span>;
}

export function DashboardFrame({
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
              {showNewVideoAction ? <ButtonLink variant="primary" to="/library/projects">Projects</ButtonLink> : null}
            </>
          ) : null
        }
      />
      {children}
    </div>
  );
}

export function DashboardSkeleton({
  variant = "rows",
}: {
  variant?: "rows" | "grid";
}) {
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

export function ScopeField({ scope, onChange }: { scope: LibraryScope; onChange: (scope: LibraryScope) => void }) {
  return (
    <ToolbarField label="Show">
      <select value={scope} onChange={(event) => onChange(event.target.value as LibraryScope)}>
        {LIBRARY_SCOPES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </ToolbarField>
  );
}

function ScopeIcon({ scope }: { scope: LibraryScope }) {
  if (scope === "public") {
    return (
      <svg className={styles.scopeIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 2.25c1.65 1.45 2.5 3.38 2.5 5.75s-.85 4.3-2.5 5.75C6.35 12.3 5.5 10.37 5.5 8s.85-4.3 2.5-5.75ZM2.75 8h10.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg className={styles.scopeIcon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function ScopeToggle({ scope, onChange }: { scope: LibraryScope; onChange: (scope: LibraryScope) => void }) {
  return (
    <div className={styles.scopeToggle} role="radiogroup" aria-label="Show projects">
      {LIBRARY_SCOPES.map((option) => {
        const isSelected = option.id === scope;
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
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className={styles.loadMore}>
      <Button variant="secondary" disabled={loading} onClick={onClick}>
        {loading ? "Loading..." : "Load more"}
      </Button>
    </div>
  );
}
