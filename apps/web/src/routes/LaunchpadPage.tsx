import type { DashboardSummary } from "@popcorn/shared/v1/dashboard";
import { ActiveRunsPanel } from "../components/home/ActiveRunsPanel";
import { EmptyDashboard } from "../components/home/EmptyDashboard";
import { HeroCard } from "../components/home/HeroCard";
import { OverviewStats } from "../components/home/OverviewStats";
import { RecentOutputsStrip } from "../components/home/RecentOutputsStrip";
import { Button } from "../components/ui/Button";
import { ErrorState } from "../components/ui/StateCard";
import { useAuth } from "../components/auth/AuthProvider";
import { AnonymousUpgradeBanner } from "../components/auth/AnonymousUpgradeBanner";
import { QuickLoadingState } from "../components/ui/QuickLoadingState";
import { deriveNextAction } from "../lib/nextAction";
import { useDashboardSummaryQuery } from "../lib/queryClient";
import styles from "./LaunchpadPage.module.css";

const DEV_AUTOPILOT = import.meta.env.DEV;

export function LaunchpadPage() {
  const auth = useAuth();
  const authScope = auth.user?.id ?? (DEV_AUTOPILOT ? "dev-autopilot" : auth.status);
  const {
    data,
    error,
    loading,
    refresh,
    refreshError,
    refreshing,
  } = useDashboardSummaryQuery(authScope);

  const pulse = data?.summary ?? null;
  const summaryState = getSummaryState(pulse);
  const action = deriveNextAction(summaryState.summary);

  return (
    <div className={styles.page}>
      <AnonymousUpgradeBanner />

      {loading ? <LaunchpadSkeleton /> : null}

      {!loading && error ? (
        <ErrorState
          title="Unable to load Home"
          body="We could not load the workspace summary."
          error={error}
          onRetry={refresh}
        />
      ) : null}

      {!loading && !error ? (
        action.type === "start" ? (
          <>
            <DashboardRefreshNotice
              refreshing={refreshing}
              refreshError={refreshError}
              onRetry={refresh}
            />
            <EmptyDashboard action={action} />
          </>
        ) : (
          <>
            <DashboardRefreshNotice
              refreshing={refreshing}
              refreshError={refreshError}
              onRetry={refresh}
            />
            {summaryState.isPartial ? (
              <PartialSummaryNotice missing={summaryState.missing} />
            ) : null}
            <HeroCard action={action} />
            {summaryState.summary.counts ? (
              <div className={styles.desktopStats}>
                <OverviewStats counts={summaryState.summary.counts} />
              </div>
            ) : null}
            <div className={styles.mobileFeed}>
              <ActiveRunsPanel runs={summaryState.summary.activeRuns ?? []} />
              <RecentOutputsStrip outputs={summaryState.summary.recentOutputs ?? []} />
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

function DashboardRefreshNotice({
  refreshing,
  refreshError,
  onRetry,
}: {
  refreshing: boolean;
  refreshError: Error | null;
  onRetry: () => void;
}) {
  if (refreshError) {
    return (
      <div className={styles.refreshError}>
        <span role="status">Showing your last update. We could not refresh Home.</span>
        <Button
          variant="ghost"
          size="sm"
          aria-busy={refreshing || undefined}
          aria-disabled={refreshing || undefined}
          onClick={() => {
            if (!refreshing) onRetry();
          }}
        >
          {refreshing ? "Trying again…" : "Try again"}
        </Button>
      </div>
    );
  }

  return refreshing ? <p className={styles.refreshing}>Updating Home…</p> : null;
}

function getSummaryState(summary: DashboardSummary | null) {
  const normalized: Partial<DashboardSummary> = summary ?? {};
  const missing = [
    normalized.counts ? null : "counts",
    Array.isArray(normalized.activeRuns) ? null : "active runs",
    Array.isArray(normalized.recentOutputs) ? null : "recent outputs",
  ].filter((value): value is string => Boolean(value));

  return {
    summary: normalized,
    missing,
    isPartial: missing.length > 0,
  };
}

function PartialSummaryNotice({ missing }: { missing: readonly string[] }) {
  return (
    <p className={styles.partialNotice} role="status">
      Home loaded with a partial summary. Missing {formatMissing(missing)} will
      appear after the workspace refreshes.
    </p>
  );
}

function formatMissing(missing: readonly string[]) {
  if (missing.length === 0) return "workspace details";
  if (missing.length === 1) return missing[0];
  return `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
}

function LaunchpadSkeleton() {
  return (
    <QuickLoadingState
      title="Loading Home"
      description="Gathering the latest work from your studio."
      reservation={(
        <div className={styles.skeleton}>
          <span />
          <span />
          <span />
          <Button variant="cta" size="lg" disabled>
            Loading
          </Button>
        </div>
      )}
      variant="page"
    />
  );
}
