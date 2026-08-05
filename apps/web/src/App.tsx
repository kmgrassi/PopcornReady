import { lazy, Suspense, type LazyExoticComponent } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  AppLayout,
  AuthenticatedAppLayout,
  RootLayout,
} from "./components/AppLayout";
import { AdminRoute } from "./components/auth/AdminRoute";
import { RunProgressPage } from "./routes/RunProgressPage";
import { StoryboardPage } from "./routes/StoryboardPage";
import { AdminPage } from "./routes/AdminPage";
import { AdminEvalsPage } from "./routes/AdminEvalsPage";
import { ActivityPage } from "./routes/ActivityPage";
import { AnchorDetailPage } from "./routes/anchors/AnchorDetailPage";
import { AnchorsPage } from "./routes/anchors/AnchorsPage";
import { AnchorsMinePage } from "./routes/AnchorsMinePage";
import { BrandKitPage } from "./routes/BrandKitPage";
import { FaqPage } from "./routes/FaqPage";
import { HomePage } from "./routes/HomePage";
import { InspirationPage } from "./routes/InspirationPage";
import { LaunchpadPage } from "./routes/LaunchpadPage";
import { LibraryPage } from "./routes/LibraryPage";
import { LoginPage } from "./routes/LoginPage";
import { NotFoundPage } from "./routes/NotFoundPage";
import { ProjectCreationPage } from "./routes/ProjectCreationPage";
import { ProjectDetailPage } from "./routes/ProjectDetailPage";
import { ProjectMediaGalleryPage } from "./routes/ProjectMediaGalleryPage";
import { ProjectStepPage } from "./routes/ProjectStepPage";
import { ProjectWatchPage } from "./routes/ProjectWatchPage";
import { PublicProjectPage } from "./routes/PublicProjectPage";
import { SignupPage } from "./routes/SignupPage";
import { SpritePage } from "./routes/SpritePage";
import { AccountPage } from "./routes/AccountPage";
import { AuthCallbackPage } from "./routes/AuthCallbackPage";
import { SettingsPage } from "./routes/SettingsPage";
import { TemplatesPage } from "./routes/TemplatesPage";
import { UploadsPage } from "./routes/UploadsPage";
import { StandaloneCreationPage } from "./routes/StandaloneCreationPage";
import { AssetCreationReviewPage } from "./routes/AssetCreationReviewPage";
import { CreateLauncherPage } from "./routes/CreateLauncherPage";
import {
  appRoutesForBuild,
  type AppRouteElementKey,
  type RouteLayout,
} from "./routes/app-route-registry";
import { isDevHarnessEnabled } from "./routes/dev/devHarness";

function lazyDevPage(path: string, exportName: string) {
  return lazy(async () => {
    const module = (await import(/* @vite-ignore */ path)) as Record<
      string,
      () => JSX.Element
    >;
    return { default: module[exportName] };
  });
}

const DevDesignSystemPage = isDevHarnessEnabled
  ? lazyDevPage("/src/routes/dev/DesignSystemPage.tsx", "DesignSystemPage")
  : null;
const DevCreationProgressPage = isDevHarnessEnabled
  ? lazyDevPage(
      "/src/routes/dev/CreationProgressPage.tsx",
      "CreationProgressPage",
    )
  : null;
const DevGenerationCardsPage = isDevHarnessEnabled
  ? lazyDevPage("/src/routes/dev/GenerationCardsPage.tsx", "GenerationCardsPage")
  : null;
const DevLandingUploadPage = isDevHarnessEnabled
  ? lazyDevPage("/src/routes/dev/MobileHarnessPage.tsx", "DevLandingUploadPage")
  : null;
const DevMediaGalleryPage = isDevHarnessEnabled
  ? lazyDevPage("/src/routes/dev/MobileHarnessPage.tsx", "DevMediaGalleryPage")
  : null;
const DevVideoEditPage = isDevHarnessEnabled
  ? lazyDevPage("/src/routes/dev/VideoEditPage.tsx", "VideoEditPage")
  : null;

const routeRenderers: Record<AppRouteElementKey, () => JSX.Element> = {
  home: () => <HomePage />,
  authCallback: () => <AuthCallbackPage />,
  login: () => <LoginPage />,
  signup: () => <SignupPage />,
  sprite: () => <SpritePage />,
  publicProject: () => <PublicProjectPage />,
  devCreationProgress: () => <DevPage element={DevCreationProgressPage} />,
  devDesignSystem: () => <DevPage element={DevDesignSystemPage} />,
  devGenerationCards: () => <DevPage element={DevGenerationCardsPage} />,
  devLandingUpload: () => <DevPage element={DevLandingUploadPage} />,
  devMediaGallery: () => <DevPage element={DevMediaGalleryPage} />,
  devVideoEdit: () => <DevPage element={DevVideoEditPage} />,
  dashboard: () => <LaunchpadPage />,
  activity: () => <ActivityPage />,
  inspiration: () => <InspirationPage />,
  library: () => <LibraryPage />,
  libraryTab: () => <LibraryPage />,
  projectsCompat: () => <RedirectWithSearch to="/library/projects" />,
  projectNew: () => <ProjectCreationPage />,
  create: () => <CreateLauncherPage />,
  createAsset: () => <StandaloneCreationPage />,
  createReview: () => <AssetCreationReviewPage />,
  runsCompat: () => <CollectionCompatRedirect section="runs" />,
  assetsCompat: () => <RedirectWithSearch to="/library/assets" />,
  outputsCompat: () => <CollectionCompatRedirect section="outputs" />,
  anchors: () => <AnchorsPage />,
  anchorsMine: () => <AnchorsMinePage />,
  anchorDetail: () => <AnchorDetailPage />,
  uploads: () => <UploadsPage />,
  templates: () => <TemplatesPage />,
  brand: () => <BrandKitPage />,
  storyboardCompat: () => <Navigate to="/library/projects" replace />,
  project: () => <ProjectDetailPage />,
  projectConcept: () => <ProjectStepPage step="concept" />,
  projectBrief: () => <ProjectStepPage step="brief" />,
  projectScript: () => <ProjectStepPage step="script" />,
  projectStoryboard: () => <StoryboardPage />,
  projectMedia: () => <ProjectMediaGalleryPage />,
  projectWatch: () => <ProjectWatchPage />,
  projectSection: () => <ProjectDetailPage />,
  account: () => <AccountPage />,
  settings: () => <SettingsPage />,
  faq: () => <FaqPage />,
  evalsCompat: () => <Navigate to="/admin/evals" replace />,
  admin: () => <AdminPage />,
  adminEvals: () => (
    <AdminRoute>
      <AdminEvalsPage />
    </AdminRoute>
  ),
  runProgress: () => <RunProgressPage />,
  notFound: () => <NotFoundPage />,
};

// The pure registry owns every mounted path and its production-test metadata.
// This renderer supplies components without making Node-side registry tests
// import the application or development-only pages.
export function App() {
  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route element={<AppLayout />}>
          {renderRegisteredRoutes("public")}
        </Route>

        <Route element={<AuthenticatedAppLayout />}>
          {renderRegisteredRoutes("authenticated")}
        </Route>

        <Route element={<AppLayout />}>
          {renderRegisteredRoutes("fallback")}
        </Route>
      </Route>
    </Routes>
  );
}

function renderRegisteredRoutes(layout: RouteLayout) {
  return appRoutesForBuild(isDevHarnessEnabled)
    .filter((definition) => definition.layout === layout)
    .map((definition) => {
      const element = routeRenderers[definition.element]();
      return definition.kind === "index" ? (
        <Route key={definition.id} index element={element} />
      ) : (
        <Route key={definition.id} path={definition.path} element={element} />
      );
    });
}

function DevPage({
  element: Page,
}: {
  element: LazyExoticComponent<() => JSX.Element> | null;
}) {
  if (!Page) return null;
  return (
    <Suspense fallback={<Placeholder name="Loading dev harness" />}>
      <Page />
    </Suspense>
  );
}

function RedirectWithSearch({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

function CollectionCompatRedirect({ section }: { section: "runs" | "outputs" }) {
  const location = useLocation();
  const projectId = new URLSearchParams(location.search).get("projectId");
  if (projectId) {
    return (
      <Navigate
        to={`/projects/${encodeURIComponent(projectId)}#${section}`}
        replace
      />
    );
  }
  return <Navigate to="/library/projects" replace />;
}

function Placeholder({ name }: { name: string }) {
  return (
    <main className="web-shell-main">
      <h1>Popcorn Ready</h1>
      <p className="muted">{name} is migrating from Next to Vite SPA.</p>
    </main>
  );
}
