import { Navigate, NavLink, useParams, useSearchParams } from "react-router-dom";
import {
  AssetsPage,
  ProjectsPage,
} from "./DashboardCollectionsPage";
import styles from "./LibraryPage.module.css";

const LIBRARY_TABS = [
  { id: "projects", label: "Projects" },
  { id: "assets", label: "Assets" },
] as const;

type LibraryTab = (typeof LIBRARY_TABS)[number]["id"];

function isLibraryTab(value: string | undefined): value is LibraryTab {
  return LIBRARY_TABS.some((tab) => tab.id === value);
}

export function LibraryPage() {
  const { tab } = useParams();
  const [searchParams] = useSearchParams();

  if (!tab) return <Navigate to="/library/projects" replace />;
  if (!isLibraryTab(tab)) {
    const projectId = searchParams.get("projectId");
    if (tab === "runs" && projectId) {
      return <Navigate to={`/projects/${encodeURIComponent(projectId)}#runs`} replace />;
    }
    if (tab === "outputs" && projectId) {
      return <Navigate to={`/projects/${encodeURIComponent(projectId)}#outputs`} replace />;
    }
    if (tab === "evals") return <Navigate to="/admin/evals" replace />;
    return <Navigate to="/library/projects" replace />;
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.tabs} aria-label="Library collections">
        {LIBRARY_TABS.map((item) => (
          <NavLink
            className={({ isActive }) =>
              [styles.tab, isActive ? styles.active : ""].filter(Boolean).join(" ")
            }
            key={item.id}
            to={`/library/${item.id}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      {tab === "projects" ? <ProjectsPage /> : null}
      {tab === "assets" ? <AssetsPage /> : null}
    </div>
  );
}
