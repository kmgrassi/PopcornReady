import { Navigate, useParams } from "react-router-dom";

function projectWorkspacePath(projectId?: string): string {
  if (!projectId) return "/studio";
  return `/projects/${encodeURIComponent(projectId)}#runs`;
}

export function StoryboardPage() {
  const { projectId: routeProjectId } = useParams();
  return <Navigate to={projectWorkspacePath(routeProjectId)} replace />;
}
