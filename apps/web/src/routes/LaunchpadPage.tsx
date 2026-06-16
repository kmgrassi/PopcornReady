import { ActiveRunsPanel } from "../components/home/ActiveRunsPanel";
import { EmptyDashboard } from "../components/home/EmptyDashboard";
import { HeroCard } from "../components/home/HeroCard";
import { OverviewStats } from "../components/home/OverviewStats";
import { RecentOutputsStrip } from "../components/home/RecentOutputsStrip";
import { Button } from "../components/ui/Button";
import { ErrorState } from "../components/ui/StateCard";
import { useAuth } from "../components/auth/AuthProvider";
import { deriveNextAction } from "../lib/nextAction";
import { useDashboardSummaryQuery } from "../lib/queryClient";
import styles from "./LaunchpadPage.module.css";

const EMPTY_COUNTS = { projects: 0, activeRuns: 0, outputs: 0 } as const;

const DEV_AUTOPILOT = import.meta.env.DEV;

export function LaunchpadPage() {
  const auth = useAuth();
  const authScope = auth.user?.id ?? (DEV_AUTOPILOT ? "dev-autopilot" : auth.status);
  const { data, error, loading, refresh } = useDashboardSummaryQuery(authScope);

  const pulse = data?.summary ?? null;
  const action = deriveNextAction(pulse, []);

  return (
    <div className={styles.page}>
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
          <EmptyDashboard action={action} />
        ) : (
          <>
            <HeroCard action={action} />
            <OverviewStats counts={pulse?.counts ?? EMPTY_COUNTS} />
            <ActiveRunsPanel runs={pulse?.activeRuns ?? []} />
            <RecentOutputsStrip outputs={pulse?.recentOutputs ?? []} />
          </>
        )
      ) : null}
    </div>
  );
}

function LaunchpadSkeleton() {
  return (
    <div className={styles.skeleton} aria-label="Loading Home">
      <span />
      <span />
      <span />
      <Button variant="cta" size="lg" disabled>
        Loading
      </Button>
    </div>
  );
}
