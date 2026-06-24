import { Navigate, useNavigate, useParams } from "react-router-dom";
import { canAccessAdminSurface } from "../components/auth/AdminRoute";
import { useAuth } from "../components/auth/AuthProvider";
import { usePublicProjectQuery } from "../lib/project-queries";
import { useAdminDeletePublicProjectMutation } from "../lib/queryClient";
import { storyboardProgress } from "../lib/v1/storyboard/progress";
import { ProjectDangerSection, ProjectOverviewPage } from "./ProjectDetailPage";

// Public, no-login read-only view of a shared project. Reuses the same
// presentational components as the authenticated project page.
export function PublicProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const query = usePublicProjectQuery(projectId ?? null);
  const deleteProjectMutation = useAdminDeletePublicProjectMutation(projectId ?? "");

  if (!projectId) return <Navigate to="/" replace />;

  const data = query.data ?? null;
  const project = data?.project ?? null;
  const storyboard = data?.storyboard ?? null;
  const canAdminDelete = canAccessAdminSurface(auth);

  return (
    <ProjectOverviewPage
      projectId={projectId}
      project={project}
      storyboard={storyboard}
      loading={query.isLoading}
      error={query.error}
      onProjectRetry={() => void query.refetch()}
      backLink={{ to: "/", label: "Popcorn Ready" }}
      titleFallback="Shared project"
      loadingSubtitle="Loading the shared project."
      readOnly
      storyboardPreview={{
        loading: false,
        error: null,
        onRetry: () => void query.refetch(),
        generating: false,
        progress: storyboardProgress(storyboard),
        generationError: null,
      }}
      media={data?.media ?? null}
      dangerSection={
        canAdminDelete && project ? (
          <ProjectDangerSection
            project={project}
            deleting={deleteProjectMutation.isPending}
            error={deleteProjectMutation.error}
            onDelete={() => {
              void deleteProjectMutation.mutateAsync().then(() => {
                navigate("/library/projects", { replace: true });
              });
            }}
          />
        ) : null
      }
    />
  );
}
