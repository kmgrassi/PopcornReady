import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import type { StudioDraftSummary } from "../../lib/draftStore";
import styles from "./StudioShell.module.css";

export interface StudioEmptyStateProps {
  drafts?: StudioDraftSummary[];
  loading?: boolean;
  error?: string | null;
  creating?: boolean;
  openingDraftId?: string | null;
  onCreate?: () => void;
  onResume?: (draftId: string) => void;
  onDelete?: (draftId: string) => void;
}

/**
 * StudioEmptyState — the Studio zero state (PR 1). The first thing a new user
 * sees: one headline, one line of support, and a direct create action. Saved
 * drafts replace that zero state with a focused resumable draft list.
 */
export function StudioEmptyState({
  drafts = [],
  loading = false,
  error = null,
  creating = false,
  openingDraftId = null,
  onCreate,
  onResume,
  onDelete,
}: StudioEmptyStateProps) {
  const hasDrafts = drafts.length > 0;
  const showZeroState = !loading && !error && !hasDrafts;
  const isOpeningDraft = openingDraftId !== null;

  return (
    <div className={styles.startScreen}>
      {showZeroState ? (
        <EmptyState
          headline={creating ? "Creating your new video" : "Create your first AI rough cut"}
          supporting={
            creating
              ? "Preparing a fresh Studio draft."
              : "Start with a brief, add footage, then review an editable timeline."
          }
          action={
            onCreate || creating ? (
              <Button
                className={styles.firstVideoButton}
                variant="cta"
                size="lg"
                isLoading={creating}
                onClick={onCreate}
              >
                {creating ? "Creating..." : "Create your first video"}
              </Button>
            ) : null
          }
        />
      ) : null}

      {loading || error || hasDrafts ? (
        <section className={styles.draftPanel} aria-label="Continue a draft">
          <div className={styles.draftHeader}>
            <h2>Continue a draft</h2>
            {loading ? <span className="muted">Loading...</span> : null}
          </div>
          {error ? <p className={styles.draftError}>{error}</p> : null}
          {hasDrafts ? (
            <ul className={styles.draftList}>
              {drafts.map((draft) => {
                const isOpening = openingDraftId === draft.draftId;
                return (
                  <li className={styles.draftRow} key={draft.draftId}>
                    <button
                      className={`${styles.draftOpen} ${isOpening ? styles.draftOpenPending : ""}`}
                      type="button"
                      aria-busy={isOpening || undefined}
                      aria-disabled={isOpeningDraft || undefined}
                      aria-label={isOpening ? `Opening draft ${draft.excerpt}` : undefined}
                      onClick={() => {
                        if (!isOpeningDraft) onResume?.(draft.draftId);
                      }}
                    >
                      <span className={styles.draftTitle}>{draft.excerpt}</span>
                      <span className={styles.draftMeta}>
                        {isOpening ? (
                          <span className={styles.draftOpening}>
                            <span className={styles.draftSpinner} aria-hidden="true" />
                            Opening draft…
                          </span>
                        ) : (
                          <>{stepLabel(draft)} - updated {formatUpdatedAt(draft.updatedAt)}</>
                        )}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isOpeningDraft}
                      onClick={() => onDelete?.(draft.draftId)}
                    >
                      Delete
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function stepLabel(draft: StudioDraftSummary): string {
  const labels: Record<StudioDraftSummary["step"], string> = {
    brief: "Brief",
    footage: "Footage",
    plan: "Plan",
    story: "Story",
    generate: "Produce",
    review: "Review",
    export: "Export",
  };
  if (draft.runId && draft.step === "generate") return "Active run - Produce";
  if (draft.runId && draft.step === "review") return "Rough cut ready - Review";
  return labels[draft.step];
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
