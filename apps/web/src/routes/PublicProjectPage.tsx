import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../components/auth/AuthProvider";
import { Button, ButtonLink } from "../components/ui/Button";
import { usePublicProjectQuery } from "../lib/project-queries";
import { useForkPublicProjectMutation } from "../lib/queryClient";
import { storyboardProgress } from "../lib/v1/storyboard/progress";
import { ProjectOverviewPage } from "./ProjectDetailPage";

// Public, no-login read-only view of a shared project. Reuses the same
// presentational components as the authenticated project page.
export function PublicProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const query = usePublicProjectQuery(projectId ?? null);
  const forkProjectMutation = useForkPublicProjectMutation(projectId ?? "");

  if (!projectId) return <Navigate to="/" replace />;

  const data = query.data ?? null;
  const project = data?.project ?? null;
  const storyboard = data?.storyboard ?? null;
  const canFork = auth.status === "authenticated" || auth.status === "disabled";
  const copyAction = canFork ? (
    <Button
      variant="primary"
      onClick={() => {
        void forkProjectMutation.mutateAsync().then((response) => {
          navigate(`/projects/${encodeURIComponent(response.project.id)}`);
        });
      }}
      isLoading={forkProjectMutation.isPending}
    >
      Copy to my projects
    </Button>
  ) : (
    <ButtonLink variant="primary" to="/login">
      Sign in to copy
    </ButtonLink>
  );

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
      headerActions={copyAction}
      storyboardPreview={{
        loading: false,
        error: null,
        onRetry: () => void query.refetch(),
        generating: false,
        progress: storyboardProgress(storyboard),
        generationError: null,
      }}
      media={data?.media ?? null}
      mobilePrimaryAction={copyAction}
    />
  );
}
