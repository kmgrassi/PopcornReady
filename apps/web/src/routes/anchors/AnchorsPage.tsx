import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../components/auth/AuthProvider";
import { Button } from "../../components/ui/Button";
import { ImageWithSkeleton } from "../../components/ui/ImageWithSkeleton";
import { EmptyState, ErrorState } from "../../components/ui/StateCard";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  useCatalogEntriesQuery,
  useCatalogLikeMutation,
  useCatalogLikesQuery,
  type CatalogEntry,
  type CatalogEntryKind,
} from "../../lib/catalog";
import {
  ANCHOR_KINDS,
  entrySummary,
  formatUseCount,
  isAnchorKind,
  kindLabel,
} from "./anchorDisplay";
import styles from "./AnchorsPage.module.css";

const PAGE_SIZE = 24;
const DEV_AUTOPILOT = import.meta.env.DEV;

function catalogLikesAuthScope(auth: ReturnType<typeof useAuth>): string {
  if (auth.user?.id) return auth.user.id;
  if (auth.status === "disabled") return "local-disabled-auth";
  if (DEV_AUTOPILOT && auth.status === "unauthenticated") return "dev-autopilot";
  return "";
}

function SkeletonGrid() {
  return (
    <div className={styles.grid} aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div className={`${styles.card} ${styles.skeleton}`} key={index}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function AnchorPreview({ entry }: { entry: CatalogEntry }) {
  if (entry.previewUrl) {
    return (
      <ImageWithSkeleton
        className={styles.previewImage}
        src={entry.previewUrl}
        alt=""
        loading="lazy"
      />
    );
  }

  return (
    <div className={styles.previewFallback} aria-hidden="true">
      <span>{entry.title.trim().charAt(0).toUpperCase() || "A"}</span>
    </div>
  );
}

function formatLikeCount(count: number) {
  return `${count} ${count === 1 ? "like" : "likes"}`;
}

function AnchorLikeButton({
  entry,
  liked,
  pending,
  onToggle,
}: {
  entry: CatalogEntry;
  liked: boolean;
  pending: boolean;
  onToggle: (entryId: string, shouldLike: boolean) => void;
}) {
  return (
    <button
      className={`${styles.likeButton} ${liked ? styles.liked : ""}`}
      type="button"
      aria-pressed={liked}
      disabled={pending}
      onClick={() => onToggle(entry.id, !liked)}
    >
      <span>{liked ? "Liked" : "Like"}</span>
      <span>{formatLikeCount(entry.likeCount)}</span>
    </button>
  );
}

function AnchorCard({
  entry,
  liked,
  pending,
  onToggleLike,
}: {
  entry: CatalogEntry;
  liked: boolean;
  pending: boolean;
  onToggleLike: (entryId: string, shouldLike: boolean) => void;
}) {
  return (
    <article className={styles.card}>
      <Link className={styles.cardLink} to={`/anchors/${encodeURIComponent(entry.id)}`}>
        <div className={styles.preview}>
          <AnchorPreview entry={entry} />
          <span className={styles.kind}>{kindLabel(entry.kind)}</span>
        </div>
        <div className={styles.cardBody}>
          <h2>{entry.title}</h2>
          <p>{entrySummary(entry)}</p>
          <div className={styles.meta}>
            <span>{formatUseCount(entry.useCount)}</span>
            {entry.tags.slice(0, 3).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
      </Link>
      <div className={styles.cardActions}>
        <AnchorLikeButton
          entry={entry}
          liked={liked}
          pending={pending}
          onToggle={onToggleLike}
        />
      </div>
    </article>
  );
}

export function AnchorsPage() {
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftQuery, setDraftQuery] = useState(searchParams.get("q") ?? "");
  const kind = isAnchorKind(searchParams.get("kind"))
    ? (searchParams.get("kind") as CatalogEntryKind)
    : "all";
  const queryText = searchParams.get("q")?.trim() ?? "";
  const entriesQuery = useCatalogEntriesQuery({
    kind,
    q: queryText,
    limit: PAGE_SIZE,
  });
  const entries = useMemo(
    () => entriesQuery.data?.pages.flatMap((page) => page.entries) ?? [],
    [entriesQuery.data?.pages],
  );
  const entryIds = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const authScope = catalogLikesAuthScope(auth);
  const likesQuery = useCatalogLikesQuery(entryIds, authScope);
  const likedEntryIds = useMemo(
    () => new Set(likesQuery.data?.likedEntryIds ?? []),
    [likesQuery.data?.likedEntryIds],
  );
  const likeMutation = useCatalogLikeMutation();

  function toggleLike(entryId: string, shouldLike: boolean) {
    likeMutation.mutate({ entryId, shouldLike });
  }

  function updateFilters(next: { kind?: CatalogEntryKind | "all"; q?: string }) {
    const params = new URLSearchParams(searchParams);
    const nextKind = next.kind ?? kind;
    const nextQuery = next.q ?? queryText;

    if (nextKind === "all") {
      params.delete("kind");
    } else {
      params.set("kind", nextKind);
    }

    if (nextQuery.trim()) {
      params.set("q", nextQuery.trim());
    } else {
      params.delete("q");
    }

    setSearchParams(params);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateFilters({ q: draftQuery });
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Anchors"
        title="Reusable starting points"
        description="Browse published characters, story overviews, and reference images you can copy into a project."
      />

      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Anchor kind">
          {ANCHOR_KINDS.map((item) => (
            <button
              className={`${styles.filter} ${kind === item.id ? styles.activeFilter : ""}`}
              key={item.id}
              type="button"
              onClick={() => updateFilters({ kind: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
        <form className={styles.search} onSubmit={submitSearch}>
          <label className={styles.searchLabel} htmlFor="anchor-search">
            Search anchors
          </label>
          <input
            id="anchor-search"
            type="search"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Search titles, tags, summaries"
          />
          <Button variant="secondary" type="submit">
            Search
          </Button>
        </form>
      </div>

      {entriesQuery.isLoading ? <SkeletonGrid /> : null}

      {!entriesQuery.isLoading && entriesQuery.error ? (
        <ErrorState
          title="Unable to load anchors"
          body="The catalog feed could not be loaded."
          error={entriesQuery.error}
          onRetry={() => void entriesQuery.refetch()}
        />
      ) : null}

      {!entriesQuery.isLoading && !entriesQuery.error && entries.length === 0 ? (
        <EmptyState
          title="No anchors found"
          body="Try another kind or clear the search."
        />
      ) : null}

      {!entriesQuery.isLoading && !entriesQuery.error && entries.length > 0 ? (
        <>
          <div className={styles.grid}>
            {entries.map((entry) => (
              <AnchorCard
                entry={entry}
                key={entry.id}
                liked={entry.viewerHasLiked ?? likedEntryIds.has(entry.id)}
                pending={
                  likeMutation.isPending && likeMutation.variables?.entryId === entry.id
                }
                onToggleLike={toggleLike}
              />
            ))}
          </div>
          {entriesQuery.hasNextPage ? (
            <div className={styles.loadMore}>
              <Button
                variant="secondary"
                disabled={entriesQuery.isFetchingNextPage}
                onClick={() => void entriesQuery.fetchNextPage()}
              >
                {entriesQuery.isFetchingNextPage ? "Loading..." : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
