import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { StoryboardEditor } from "../components/storyboard/StoryboardEditor";
import { StoryboardOverview } from "../components/storyboard/StoryboardOverview";
import { useStoryboardPageQuery } from "../lib/project-queries";
import { useProjectQuery } from "../lib/queryClient";

// Storyboard surface for a project. The default view is a read-first overview
// (poster + process state + high-level scene/beat assets); editing the
// structure is a deliberate switch into the dense StoryboardEditor. The
// project-specific route loads the requested project; the dashboard route
// falls back to the current studio project selector.

export function StoryboardPage() {
  const { projectId: routeProjectId } = useParams();
  const storyboardQuery = useStoryboardPageQuery(routeProjectId ?? null);
  const projectId = storyboardQuery.data?.projectId ?? null;
  const storyboard = storyboardQuery.data?.storyboard ?? null;
  const hasLoadedData = storyboardQuery.data !== undefined;
  const [editing, setEditing] = useState(false);

  const projectQuery = useProjectQuery(projectId ?? "", Boolean(projectId));

  const error = !hasLoadedData && storyboardQuery.error
    ? storyboardQuery.error instanceof Error
      ? storyboardQuery.error.message
      : "Failed to load the storyboard."
    : projectId
      ? null
      : !storyboardQuery.isLoading
        ? "No project found for storyboard editing."
        : null;

  if (storyboardQuery.isLoading) {
    return (
      <main className="sb-shell">
        <h1>Storyboard</h1>
        <p className="muted">Loading storyboard...</p>
      </main>
    );
  }

  if (error || !projectId) {
    return (
      <main className="sb-shell">
        <h1>Storyboard</h1>
        <p className="muted">{error ?? "No project found for this storyboard."}</p>
        <Link className="sb-btn" to="/studio">
          Back to studio
        </Link>
      </main>
    );
  }

  if (editing) {
    return (
      <StoryboardEditor
        projectId={projectId}
        initialStoryboard={storyboard}
        onBack={() => setEditing(false)}
      />
    );
  }

  return (
    <StoryboardOverview
      projectId={projectId}
      project={projectQuery.data?.project}
      storyboard={storyboard}
      onEdit={() => setEditing(true)}
    />
  );
}
