import { matchPath, type Location } from "react-router-dom";
import type { BreadcrumbItem } from "../components/Breadcrumbs";

type ProjectStep = "concept" | "brief" | "script" | "storyboard" | "watch";
type LibraryTab = "projects" | "assets" | "runs" | "outputs";

export interface DashboardBreadcrumbLabels {
  projectName?: string | null;
  anchorTitle?: string | null;
}

export interface DashboardBreadcrumbParams {
  projectId?: string;
  anchorEntryId?: string;
}

const STEP_LABELS: Record<ProjectStep, string> = {
  concept: "Concept",
  brief: "Brief",
  script: "Script",
  storyboard: "Storyboard",
  watch: "Watch",
};

const LIBRARY_TAB_LABELS: Record<LibraryTab, string> = {
  projects: "Projects",
  assets: "Assets",
  runs: "Runs",
  outputs: "Outputs",
};

function encodePathSegment(value: string) {
  return encodeURIComponent(value);
}

function projectCrumbs(projectId: string, labels: DashboardBreadcrumbLabels): BreadcrumbItem[] {
  const projectPath = `/projects/${encodePathSegment(projectId)}`;

  return [
    { label: "Dashboard", to: "/dashboard" },
    { label: "Library", to: "/library/projects" },
    { label: labels.projectName || "Project", to: projectPath },
  ];
}

function staticCrumbs(items: BreadcrumbItem[]): BreadcrumbItem[] {
  return [{ label: "Dashboard", to: "/dashboard" }, ...items];
}

function normalizePathname(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function getDashboardBreadcrumbParams(location: Location): DashboardBreadcrumbParams {
  const pathname = normalizePathname(location.pathname);
  if (pathname === "/projects/new" || pathname === "/anchors/mine") {
    return {};
  }

  const projectRunMatch = matchPath(
    { path: "/projects/:projectId/runs/:runId", end: true },
    pathname,
  );
  if (projectRunMatch?.params.projectId) {
    return { projectId: projectRunMatch.params.projectId };
  }

  const projectMatch = matchPath(
    { path: "/projects/:projectId/*", end: false },
    pathname,
  );
  if (projectMatch?.params.projectId) {
    return { projectId: projectMatch.params.projectId };
  }

  const exactProjectMatch = matchPath(
    { path: "/projects/:projectId", end: true },
    pathname,
  );
  if (exactProjectMatch?.params.projectId) {
    return { projectId: exactProjectMatch.params.projectId };
  }

  const anchorMatch = matchPath(
    { path: "/anchors/:entryId", end: true },
    pathname,
  );
  if (anchorMatch?.params.entryId) {
    return { anchorEntryId: anchorMatch.params.entryId };
  }

  return {};
}

export function getDashboardBreadcrumbs(
  location: Location,
  labels: DashboardBreadcrumbLabels = {},
): BreadcrumbItem[] {
  const pathname = normalizePathname(location.pathname);

  if (pathname === "/dashboard") {
    return [{ label: "Dashboard" }];
  }

  const libraryMatch = matchPath({ path: "/library/:tab", end: true }, pathname);
  if (libraryMatch?.params.tab && isLibraryTab(libraryMatch.params.tab)) {
    return staticCrumbs([
      { label: "Library", to: "/library" },
      { label: LIBRARY_TAB_LABELS[libraryMatch.params.tab] },
    ]);
  }

  if (pathname === "/library") {
    return staticCrumbs([{ label: "Library" }]);
  }

  if (pathname === "/projects/new") {
    return staticCrumbs([
      { label: "Create", to: "/create" },
      { label: "Full video" },
    ]);
  }

  if (pathname === "/create") {
    return staticCrumbs([{ label: "Create" }]);
  }

  if (pathname === "/create/asset") {
    return staticCrumbs([
      { label: "Create", to: "/create" },
      { label: "Project asset" },
    ]);
  }

  if (pathname === "/create/review") {
    return staticCrumbs([
      { label: "Create", to: "/create" },
      { label: "Review" },
    ]);
  }

  const projectRunMatch = matchPath(
    { path: "/projects/:projectId/runs/:runId", end: true },
    pathname,
  );
  if (projectRunMatch?.params.projectId) {
    return [
      ...projectCrumbs(projectRunMatch.params.projectId, labels),
      { label: "Runs", to: `${projectPath(projectRunMatch.params.projectId)}#runs` },
      { label: "Run detail" },
    ];
  }

  const projectStepMatch = matchPath(
    { path: "/projects/:projectId/:step", end: true },
    pathname,
  );
  if (
    projectStepMatch?.params.projectId &&
    projectStepMatch.params.step &&
    isProjectStep(projectStepMatch.params.step)
  ) {
    return [
      ...projectCrumbs(projectStepMatch.params.projectId, labels),
      { label: STEP_LABELS[projectStepMatch.params.step] },
    ];
  }

  const projectMatch = matchPath({ path: "/projects/:projectId", end: true }, pathname);
  if (projectMatch?.params.projectId) {
    const crumbs = projectCrumbs(projectMatch.params.projectId, labels);
    return crumbs.map((crumb, index) =>
      index === crumbs.length - 1 ? { label: crumb.label } : crumb,
    );
  }

  if (pathname === "/anchors/mine") {
    return staticCrumbs([
      { label: "Anchors", to: "/anchors" },
      { label: "My anchors" },
    ]);
  }

  const anchorMatch = matchPath({ path: "/anchors/:entryId", end: true }, pathname);
  if (anchorMatch?.params.entryId) {
    return staticCrumbs([
      { label: "Anchors", to: "/anchors" },
      { label: labels.anchorTitle || "Anchor" },
    ]);
  }

  if (pathname === "/anchors") {
    return staticCrumbs([{ label: "Anchors" }]);
  }

  if (pathname === "/admin/evals") {
    return staticCrumbs([
      { label: "Admin", to: "/admin" },
      { label: "Evals" },
    ]);
  }

  const staticRoute = STATIC_ROUTE_LABELS[pathname];
  if (staticRoute) {
    return staticCrumbs([{ label: staticRoute }]);
  }

  return [];
}

function projectPath(projectId: string) {
  return `/projects/${encodePathSegment(projectId)}`;
}

function isProjectStep(value: string): value is ProjectStep {
  return value in STEP_LABELS;
}

function isLibraryTab(value: string): value is LibraryTab {
  return value in LIBRARY_TAB_LABELS;
}

const STATIC_ROUTE_LABELS: Record<string, string> = {
  "/activity": "Activity",
  "/inspiration": "Inspiration",
  "/templates": "Templates",
  "/brand": "Brand Kit",
  "/uploads": "Uploads",
  "/account": "Credits & billing",
  "/settings": "Settings",
  "/faq": "FAQs",
  "/admin": "Admin",
  "/dev/design-system": "Design system",
  "/dev/generation-cards": "Generation cards",
};
