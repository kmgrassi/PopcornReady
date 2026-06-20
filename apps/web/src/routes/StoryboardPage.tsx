import { Navigate, useParams } from "react-router-dom";

function projectWorkspacePath(projectId?: string): string {
  if (!projectId) return "/studio";
  const params = new URLSearchParams({ projectId });
  return `/library/runs?${params.toString()}`;
}

export function StoryboardPage() {
  const { projectId: routeProjectId } = useParams();
  return <Navigate to={projectWorkspacePath(routeProjectId)} replace />;
}
