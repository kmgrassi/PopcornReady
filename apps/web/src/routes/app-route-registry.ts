export type RouteLayout = "public" | "authenticated" | "fallback";
export type RouteAccess = "public" | "authenticated" | "admin";
export type RouteAvailability = "production" | "development";
export type RouteKind = "index" | "page" | "dynamic" | "redirect" | "catchall";
export type RouteFixture =
  | "none"
  | "managed-auth-user"
  | "owned-project"
  | "public-project"
  | "admin-user"
  | "development-harness";
export type RouteViewport = "desktop" | "mobile";
export type NavigationWrite =
  | "auth.session.exchange"
  | "auth.session.refresh"
  | "media.delivery_authorization"
  | "project.activity";

export interface AppRouteDefinition {
  id: string;
  path: string;
  layout: RouteLayout;
  access: RouteAccess;
  availability: RouteAvailability;
  kind: RouteKind;
  element: string;
  routeSmokeFlowId: string;
  featureFlowIds: readonly string[];
  fixture: RouteFixture;
  viewports: readonly RouteViewport[];
  allowedNavigationWrites: readonly NavigationWrite[];
}
const bothViewports = ["desktop", "mobile"] as const;
const desktopOnly = ["desktop"] as const;
const authRefresh = ["auth.session.refresh"] as const;
const projectReadWrites = [
  "auth.session.refresh",
  "project.activity",
] as const;
const projectMediaWrites = [
  "auth.session.refresh",
  "project.activity",
  "media.delivery_authorization",
] as const;

function route<const T extends AppRouteDefinition>(definition: T): T {
  return definition;
}

export const appRouteRegistry = [
  route({ id: "home", path: "/", layout: "public", access: "public", availability: "production", kind: "index", element: "home", routeSmokeFlowId: "route.home", featureFlowIds: ["landing"], fixture: "none", viewports: bothViewports, allowedNavigationWrites: [] }),
  route({ id: "auth-callback", path: "/auth/callback", layout: "public", access: "public", availability: "production", kind: "page", element: "authCallback", routeSmokeFlowId: "route.auth-callback", featureFlowIds: ["authentication"], fixture: "none", viewports: bothViewports, allowedNavigationWrites: ["auth.session.exchange"] }),
  route({ id: "login", path: "/login", layout: "public", access: "public", availability: "production", kind: "page", element: "login", routeSmokeFlowId: "route.login", featureFlowIds: ["authentication"], fixture: "none", viewports: bothViewports, allowedNavigationWrites: [] }),
  route({ id: "signup", path: "/signup", layout: "public", access: "public", availability: "production", kind: "page", element: "signup", routeSmokeFlowId: "route.signup", featureFlowIds: ["authentication"], fixture: "none", viewports: bothViewports, allowedNavigationWrites: [] }),
  route({ id: "sprite", path: "/sprite", layout: "public", access: "public", availability: "production", kind: "page", element: "sprite", routeSmokeFlowId: "route.sprite", featureFlowIds: ["sprite"], fixture: "none", viewports: bothViewports, allowedNavigationWrites: [] }),
  route({ id: "public-project", path: "/p/:projectId", layout: "public", access: "public", availability: "production", kind: "dynamic", element: "publicProject", routeSmokeFlowId: "route.public-project", featureFlowIds: ["public-project-read"], fixture: "public-project", viewports: bothViewports, allowedNavigationWrites: ["media.delivery_authorization"] }),

  route({ id: "dev-creation-progress", path: "/dev/creation-progress", layout: "public", access: "public", availability: "development", kind: "page", element: "devCreationProgress", routeSmokeFlowId: "route.dev-creation-progress", featureFlowIds: ["development-harness"], fixture: "development-harness", viewports: bothViewports, allowedNavigationWrites: [] }),
  route({ id: "dev-design-system", path: "/dev/design-system", layout: "public", access: "public", availability: "development", kind: "page", element: "devDesignSystem", routeSmokeFlowId: "route.dev-design-system", featureFlowIds: ["development-harness"], fixture: "development-harness", viewports: bothViewports, allowedNavigationWrites: [] }),
  route({ id: "dev-generation-cards", path: "/dev/generation-cards", layout: "public", access: "public", availability: "development", kind: "page", element: "devGenerationCards", routeSmokeFlowId: "route.dev-generation-cards", featureFlowIds: ["development-harness"], fixture: "development-harness", viewports: bothViewports, allowedNavigationWrites: [] }),
  route({ id: "dev-landing-upload", path: "/dev/landing-upload", layout: "public", access: "public", availability: "development", kind: "page", element: "devLandingUpload", routeSmokeFlowId: "route.dev-landing-upload", featureFlowIds: ["development-harness"], fixture: "development-harness", viewports: bothViewports, allowedNavigationWrites: [] }),
  route({ id: "dev-media-gallery", path: "/dev/media-gallery", layout: "public", access: "public", availability: "development", kind: "page", element: "devMediaGallery", routeSmokeFlowId: "route.dev-media-gallery", featureFlowIds: ["development-harness"], fixture: "development-harness", viewports: bothViewports, allowedNavigationWrites: [] }),
  route({ id: "dev-video-edit", path: "/dev/video-edit", layout: "public", access: "public", availability: "development", kind: "page", element: "devVideoEdit", routeSmokeFlowId: "route.dev-video-edit", featureFlowIds: ["development-harness"], fixture: "development-harness", viewports: bothViewports, allowedNavigationWrites: [] }),

  route({ id: "dashboard", path: "/dashboard", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "dashboard", routeSmokeFlowId: "route.dashboard", featureFlowIds: ["dashboard-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "activity", path: "/activity", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "activity", routeSmokeFlowId: "route.activity", featureFlowIds: ["activity-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "inspiration", path: "/inspiration", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "inspiration", routeSmokeFlowId: "route.inspiration", featureFlowIds: ["inspiration-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "library", path: "/library", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "library", routeSmokeFlowId: "route.library", featureFlowIds: ["library-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: ["auth.session.refresh", "media.delivery_authorization"] }),
  route({ id: "library-tab", path: "/library/:tab", layout: "authenticated", access: "authenticated", availability: "production", kind: "dynamic", element: "libraryTab", routeSmokeFlowId: "route.library-tab", featureFlowIds: ["library-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: ["auth.session.refresh", "media.delivery_authorization"] }),
  route({ id: "projects-compat", path: "/projects", layout: "authenticated", access: "authenticated", availability: "production", kind: "redirect", element: "projectsCompat", routeSmokeFlowId: "route.projects-compat", featureFlowIds: [], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "project-new", path: "/projects/new", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "projectNew", routeSmokeFlowId: "route.project-new", featureFlowIds: ["full-video-create"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "create", path: "/create", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "create", routeSmokeFlowId: "route.create", featureFlowIds: ["creation-launcher"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "create-asset", path: "/create/asset", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "createAsset", routeSmokeFlowId: "route.create-asset", featureFlowIds: ["standalone-creation"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "create-review", path: "/create/review", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "createReview", routeSmokeFlowId: "route.create-review", featureFlowIds: ["standalone-creation"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "runs-compat", path: "/runs", layout: "authenticated", access: "authenticated", availability: "production", kind: "redirect", element: "runsCompat", routeSmokeFlowId: "route.runs-compat", featureFlowIds: [], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "assets-compat", path: "/assets", layout: "authenticated", access: "authenticated", availability: "production", kind: "redirect", element: "assetsCompat", routeSmokeFlowId: "route.assets-compat", featureFlowIds: [], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "outputs-compat", path: "/outputs", layout: "authenticated", access: "authenticated", availability: "production", kind: "redirect", element: "outputsCompat", routeSmokeFlowId: "route.outputs-compat", featureFlowIds: [], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "anchors", path: "/anchors", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "anchors", routeSmokeFlowId: "route.anchors", featureFlowIds: ["anchors-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "anchors-mine", path: "/anchors/mine", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "anchorsMine", routeSmokeFlowId: "route.anchors-mine", featureFlowIds: ["anchors-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "anchor-detail", path: "/anchors/:entryId", layout: "authenticated", access: "authenticated", availability: "production", kind: "dynamic", element: "anchorDetail", routeSmokeFlowId: "route.anchor-detail", featureFlowIds: ["anchors-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: ["auth.session.refresh", "media.delivery_authorization"] }),
  route({ id: "uploads", path: "/uploads", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "uploads", routeSmokeFlowId: "route.uploads", featureFlowIds: ["uploads"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "templates", path: "/templates", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "templates", routeSmokeFlowId: "route.templates", featureFlowIds: ["templates-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "brand", path: "/brand", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "brand", routeSmokeFlowId: "route.brand", featureFlowIds: ["brand-kit-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "storyboard-compat", path: "/storyboard", layout: "authenticated", access: "authenticated", availability: "production", kind: "redirect", element: "storyboardCompat", routeSmokeFlowId: "route.storyboard-compat", featureFlowIds: [], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "project", path: "/projects/:projectId", layout: "authenticated", access: "authenticated", availability: "production", kind: "dynamic", element: "project", routeSmokeFlowId: "route.project", featureFlowIds: ["project-read"], fixture: "owned-project", viewports: bothViewports, allowedNavigationWrites: projectReadWrites }),
  route({ id: "project-concept", path: "/projects/:projectId/concept", layout: "authenticated", access: "authenticated", availability: "production", kind: "dynamic", element: "projectConcept", routeSmokeFlowId: "route.project-concept", featureFlowIds: ["project-read"], fixture: "owned-project", viewports: bothViewports, allowedNavigationWrites: projectReadWrites }),
  route({ id: "project-brief", path: "/projects/:projectId/brief", layout: "authenticated", access: "authenticated", availability: "production", kind: "dynamic", element: "projectBrief", routeSmokeFlowId: "route.project-brief", featureFlowIds: ["project-read"], fixture: "owned-project", viewports: bothViewports, allowedNavigationWrites: projectReadWrites }),
  route({ id: "project-script", path: "/projects/:projectId/script", layout: "authenticated", access: "authenticated", availability: "production", kind: "dynamic", element: "projectScript", routeSmokeFlowId: "route.project-script", featureFlowIds: ["project-read"], fixture: "owned-project", viewports: bothViewports, allowedNavigationWrites: projectReadWrites }),
  route({ id: "project-storyboard", path: "/projects/:projectId/storyboard", layout: "authenticated", access: "authenticated", availability: "production", kind: "dynamic", element: "projectStoryboard", routeSmokeFlowId: "route.project-storyboard", featureFlowIds: ["storyboard-read"], fixture: "owned-project", viewports: bothViewports, allowedNavigationWrites: projectMediaWrites }),
  route({ id: "project-media", path: "/projects/:projectId/media", layout: "authenticated", access: "authenticated", availability: "production", kind: "dynamic", element: "projectMedia", routeSmokeFlowId: "route.project-media", featureFlowIds: ["project-media-read"], fixture: "owned-project", viewports: bothViewports, allowedNavigationWrites: projectMediaWrites }),
  route({ id: "project-watch", path: "/projects/:projectId/watch", layout: "authenticated", access: "authenticated", availability: "production", kind: "dynamic", element: "projectWatch", routeSmokeFlowId: "route.project-watch", featureFlowIds: ["project-watch-read"], fixture: "owned-project", viewports: bothViewports, allowedNavigationWrites: projectMediaWrites }),
  route({ id: "project-section", path: "/projects/:projectId/:section", layout: "authenticated", access: "authenticated", availability: "production", kind: "dynamic", element: "projectSection", routeSmokeFlowId: "route.project-section", featureFlowIds: ["project-read"], fixture: "owned-project", viewports: bothViewports, allowedNavigationWrites: projectReadWrites }),
  route({ id: "account", path: "/account", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "account", routeSmokeFlowId: "route.account", featureFlowIds: ["account-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "settings", path: "/settings", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "settings", routeSmokeFlowId: "route.settings", featureFlowIds: ["settings-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "faq", path: "/faq", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "faq", routeSmokeFlowId: "route.faq", featureFlowIds: ["faq-read"], fixture: "managed-auth-user", viewports: bothViewports, allowedNavigationWrites: authRefresh }),
  route({ id: "evals-compat", path: "/evals", layout: "authenticated", access: "authenticated", availability: "production", kind: "redirect", element: "evalsCompat", routeSmokeFlowId: "route.evals-compat", featureFlowIds: [], fixture: "managed-auth-user", viewports: desktopOnly, allowedNavigationWrites: authRefresh }),
  route({ id: "admin", path: "/admin", layout: "authenticated", access: "authenticated", availability: "production", kind: "page", element: "admin", routeSmokeFlowId: "route.admin", featureFlowIds: ["admin-workbench"], fixture: "managed-auth-user", viewports: desktopOnly, allowedNavigationWrites: authRefresh }),
  route({ id: "admin-evals", path: "/admin/evals", layout: "authenticated", access: "admin", availability: "production", kind: "page", element: "adminEvals", routeSmokeFlowId: "route.admin-evals", featureFlowIds: ["admin-evals"], fixture: "admin-user", viewports: desktopOnly, allowedNavigationWrites: authRefresh }),
  route({ id: "run-progress", path: "/projects/:projectId/runs/:runId", layout: "authenticated", access: "authenticated", availability: "production", kind: "dynamic", element: "runProgress", routeSmokeFlowId: "route.run-progress", featureFlowIds: ["run-progress-read"], fixture: "owned-project", viewports: bothViewports, allowedNavigationWrites: projectMediaWrites }),

  route({ id: "not-found", path: "*", layout: "fallback", access: "public", availability: "production", kind: "catchall", element: "notFound", routeSmokeFlowId: "route.not-found", featureFlowIds: [], fixture: "none", viewports: bothViewports, allowedNavigationWrites: [] }),
] as const satisfies readonly AppRouteDefinition[];

export type AppRouteElementKey = (typeof appRouteRegistry)[number]["element"];

export const devHarnessRoutes = {
  creationProgress: routePath("dev-creation-progress"),
  designSystem: routePath("dev-design-system"),
  generationCards: routePath("dev-generation-cards"),
  landingUpload: routePath("dev-landing-upload"),
  mediaGallery: routePath("dev-media-gallery"),
  videoEdit: routePath("dev-video-edit"),
} as const;

export function appRoutesForBuild(isDevelopment: boolean) {
  return appRouteRegistry.filter(
    (definition) =>
      definition.availability === "production" || isDevelopment,
  );
}

function routePath(id: string): string {
  const definition = appRouteRegistry.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown app route: ${id}`);
  return definition.path;
}
