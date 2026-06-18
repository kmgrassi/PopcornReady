import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { ButtonLink } from "../components/ui/Button";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import { useCatalogMineQuery, type CatalogEntry } from "../lib/catalog";
import styles from "./AnchorsMinePage.module.css";

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function AnchorPreview({ entry }: { entry: CatalogEntry }) {
  if (entry.previewUrl) {
    return <img className={styles.preview} src={entry.previewUrl} alt="" loading="lazy" />;
  }
  return (
    <div className={`${styles.preview} ${styles.previewEmpty}`} aria-hidden="true">
      <span>{titleCase(entry.kind)}</span>
    </div>
  );
}

export function AnchorsMinePage() {
  const mineQuery = useCatalogMineQuery();
  const entries = mineQuery.data?.entries ?? [];

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Anchors"
        title="Published anchors"
        description="Manage the starting points you have published from assets and stories."
        action={
          <ButtonLink variant="secondary" to="/library/assets">
            Find assets
          </ButtonLink>
        }
      />

      {mineQuery.isLoading ? (
        <div className={styles.grid} aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div className={styles.skeleton} key={index}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : null}

      {!mineQuery.isLoading && mineQuery.error ? (
        <ErrorState
          title="Unable to load anchors"
          body="We could not load your published anchors."
          error={mineQuery.error}
          onRetry={() => void mineQuery.refetch()}
        />
      ) : null}

      {!mineQuery.isLoading && !mineQuery.error && entries.length === 0 ? (
        <EmptyState
          title="No anchors published yet"
          body="Publish one from an image asset or a saved storyboard when you want to reuse it."
          action={<ButtonLink variant="secondary" to="/library/assets">Open assets</ButtonLink>}
        />
      ) : null}

      {!mineQuery.isLoading && !mineQuery.error && entries.length > 0 ? (
        <div className={styles.grid}>
          {entries.map((entry) => (
            <article className={styles.card} key={entry.id}>
              <AnchorPreview entry={entry} />
              <div className={styles.body}>
                <div>
                  <h2>{entry.title}</h2>
                  {entry.summary ? <p>{entry.summary}</p> : null}
                </div>
                <div className={styles.meta}>
                  <span>{titleCase(entry.kind)}</span>
                  <span>{titleCase(entry.status)}</span>
                  <span>{entry.useCount} uses</span>
                  <span>{formatDate(entry.updatedAt ?? entry.createdAt)}</span>
                </div>
                {entry.tags.length > 0 ? (
                  <div className={styles.tags}>
                    {entry.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}
              </div>
              <footer className={styles.footer}>
                <Link to={`/anchors/${encodeURIComponent(entry.id)}`}>View details</Link>
              </footer>
            </article>
          ))}
        </div>
      ) : null}
    </main>
  );
}
