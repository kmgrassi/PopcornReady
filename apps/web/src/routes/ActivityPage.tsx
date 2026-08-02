import { Link } from "react-router-dom";
import { ActiveRunsPanel } from "../components/home/ActiveRunsPanel";
import { RecentOutputsStrip } from "../components/home/RecentOutputsStrip";
import { ErrorState } from "../components/ui/StateCard";
import { useAuth } from "../components/auth/AuthProvider";
import { StudioCrewLoadingState } from "../components/creation/StudioCrewLoadingState";
import { useDashboardSummaryQuery } from "../lib/queryClient";
import styles from "./ActivityPage.module.css";

const DEV_AUTOPILOT = import.meta.env.DEV;

export function ActivityPage() {
  const auth = useAuth();
  const authScope = auth.user?.id ?? (DEV_AUTOPILOT ? "dev-autopilot" : auth.status);
  const { data, error, loading, refresh } = useDashboardSummaryQuery(authScope);
  const activeRuns = data?.summary.activeRuns ?? [];
  const recentOutputs = data?.summary.recentOutputs ?? [];
  const hasActivity = activeRuns.length > 0 || recentOutputs.length > 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Activity</h1>
        <p>
          Follow active generations and recent exports without digging through
          each project.
        </p>
      </header>

      {loading ? <ActivitySkeleton /> : null}

      {!loading && error ? (
        <ErrorState
          title="Unable to load activity"
          body="We could not load your current runs and recent outputs."
          error={error}
          onRetry={refresh}
        />
      ) : null}

      {!loading && !error && hasActivity ? (
        <>
          <ActiveRunsPanel runs={activeRuns} />
          <RecentOutputsStrip outputs={recentOutputs} />
        </>
      ) : null}

      {!loading && !error && !hasActivity ? (
        <section className={styles.empty}>
          <h2>No active generations</h2>
          <p>
            Start a full video or create one project asset. This screen will
            track the work until it is ready.
          </p>
          <Link to="/create">Create</Link>
        </section>
      ) : null}
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <StudioCrewLoadingState
      title="Loading activity"
      description="Gathering active runs and recent outputs."
      reservation={(
        <div className={styles.skeleton}>
          <span />
          <span />
          <span />
        </div>
      )}
      variant="page"
    />
  );
}
