import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState } from "../../components/ui/StateCard";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  useCatalogEntriesQuery,
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
      <img
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

function AnchorCard({ entry }: { entry: CatalogEntry }) {
  return (
    <Link className={styles.card} to={`/anchors/${encodeURIComponent(entry.id)}`}>
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
  );
}

export function AnchorsPage() {
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
              <AnchorCard entry={entry} key={entry.id} />
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
