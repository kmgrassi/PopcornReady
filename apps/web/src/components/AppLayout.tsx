import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { canAccessAdminSurface } from "./auth/AdminRoute";
import { AuthNavButton } from "./auth/AuthNavButton";
import { CreditsBadge } from "./credits/CreditsBadge";
import { Breadcrumbs } from "./Breadcrumbs";
import { LogoMark } from "./LogoMark";
import { CommandPalette } from "./palette/Palette";
import ThemeToggle from "./ThemeToggle";
import { Button } from "./ui/Button";
import { CloseButton } from "./ui/CloseButton";
import { ToastProvider } from "./ui/Toast";
import { useCatalogEntryQuery } from "../lib/catalog";
import {
  getDashboardBreadcrumbParams,
  getDashboardBreadcrumbs,
} from "../lib/dashboardBreadcrumbs";
import { queryClient, useMeQuery, useProjectQuery } from "../lib/queryClient";
import { UploadQueueProvider } from "../lib/uploadQueue";
import styles from "./AppLayout.module.css";

const STORAGE_KEY = "popcorn-ready-theme";
const DEFAULT_THEME = "popcorn";
const VALID_THEMES = new Set(["popcorn", "popcorn-warm", "popcorn-night", "popcorn-studio"]);

// Primary workspace nav. Library groups the collection routes until PR 5 gives
// it a dedicated tab shell.
const PRIMARY_NAV = [
  {
    label: "Library",
    to: "/library",
    activePaths: ["/library", "/projects", "/assets"],
  },
  {
    label: "Inspiration",
    to: "/inspiration",
    activePaths: ["/inspiration"],
  },
];

function applyStoredTheme() {
  try {
    const theme = window.localStorage.getItem(STORAGE_KEY);
    if (VALID_THEMES.has(theme ?? "")) {
      document.documentElement.dataset.theme = theme ?? "";
    } else {
      document.documentElement.dataset.theme = DEFAULT_THEME;
    }
  } catch {
    document.documentElement.dataset.theme = DEFAULT_THEME;
  }
}

export function RootLayout() {
  return (
    <RootProviders>
      <Outlet />
    </RootProviders>
  );
}

export function AppLayout() {
  return (
    <div className="web-shell">
      <header className={`web-shell-header ${styles.publicHeader}`}>
        <Link className={`web-shell-brand ${styles.publicBrand}`} to="/">
          <LogoMark
            className={`web-shell-logo ${styles.publicLogo} ${styles.logoStyleGlow} ${styles.logoColorPopcornYellow}`}
          />
          <span className={styles.wordmarkRounded}>Popcorn Ready</span>
        </Link>
        <nav className="web-shell-nav" aria-label="Primary">
          <a href="/#workflow">Workflow</a>
          <a href="/#pricing">Pricing</a>
          <AuthNavButton />
        </nav>
      </header>
      {/* Non-landmark wrapper: each route owns its own <main> (HomePage,
          AuthForm, …), so this must not be a second <main> landmark. */}
      <div className="web-shell-body">
        <Outlet />
      </div>
      <footer className="web-shell-footer">
        <span className={`web-shell-footer-brand ${styles.footerWordmark}`}>
          Popcorn Ready
        </span>
        <ThemeToggle />
      </footer>
    </div>
  );
}

// In local dev (`vite dev`) an unauthenticated visitor still gets the dashboard
// via the API's hybrid "autopilot" identity; logging in takes over with the real
// session. Production builds (DEV=false) always require login.
const DEV_AUTOPILOT = import.meta.env.DEV;
const MOBILE_NAV_MEDIA_QUERY = "(max-width: 860px)";

export function AuthenticatedAppLayout() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Mobile-only drawer state; on desktop the sidebar is always visible and the
  // toggle button is hidden, so this never becomes true there.
  const [navOpen, setNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const wasNavOpen = useRef(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const mobileNavQuery = window.matchMedia(MOBILE_NAV_MEDIA_QUERY);
    const closeWhenDesktop = () => {
      if (!mobileNavQuery.matches) setNavOpen(false);
    };
    closeWhenDesktop();
    mobileNavQuery.addEventListener("change", closeWhenDesktop);
    return () => {
      mobileNavQuery.removeEventListener("change", closeWhenDesktop);
    };
  }, []);

  useEffect(() => {
    if (navOpen) {
      sidebarRef.current?.focus();
    } else if (wasNavOpen.current) {
      menuButtonRef.current?.focus();
    }
    wasNavOpen.current = navOpen;
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [navOpen]);
  const dashboardQueriesEnabled =
    auth.status !== "loading" &&
    (auth.status !== "unauthenticated" || DEV_AUTOPILOT);
  const breadcrumbParams = getDashboardBreadcrumbParams(location);
  const breadcrumbProjectQuery = useProjectQuery(
    breadcrumbParams.projectId ?? "",
    dashboardQueriesEnabled && Boolean(breadcrumbParams.projectId),
  );
  const breadcrumbAnchorQuery = useCatalogEntryQuery(
    breadcrumbParams.anchorEntryId ?? "",
    dashboardQueriesEnabled && Boolean(breadcrumbParams.anchorEntryId),
  );
  const breadcrumbItems = getDashboardBreadcrumbs(location, {
    projectName: breadcrumbProjectQuery.data?.project.name,
    anchorTitle: breadcrumbAnchorQuery.data?.entry.title,
  });
  const authScope = auth.user?.id ?? (DEV_AUTOPILOT ? "dev-autopilot" : auth.status);
  const meQuery = useMeQuery(authScope, {
    enabled: dashboardQueriesEnabled,
  });
  const me = meQuery.data ?? null;
  const accountLabel = useMemo(() => {
    if (auth.isAnonymous) return "Guest account";
    if (auth.user?.email) return auth.user.email;
    if (me?.actor && typeof me.actor === "object" && me.actor.email) {
      return me.actor.email;
    }
    if (me?.isLocal || auth.status === "disabled") return "Local developer";
    return "Account";
  }, [auth.isAnonymous, auth.status, auth.user?.email, me]);

  const showAdmin = canAccessAdminSurface(auth);
  const canSignOut = auth.configured && auth.status === "authenticated";
  async function signOut() {
    if (!canSignOut) return;
    await auth.signOut();
    navigate("/login", { replace: true });
  }

  if (auth.status === "loading") {
    return (
      <div className="web-shell">
        <main className="web-shell-main">
          <h1>Checking session</h1>
          <p className="muted">Preparing your workspace.</p>
        </main>
      </div>
    );
  }

  if (auth.status === "unauthenticated" && !DEV_AUTOPILOT) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return (
    <div className={styles.shell}>
      <aside
        id="dashboard-sidebar"
        ref={sidebarRef}
        tabIndex={-1}
        className={
          navOpen ? `${styles.sidebar} ${styles.sidebarOpen}` : styles.sidebar
        }
      >
        <div className={styles.sidebarHeader}>
          <Link className={styles.brand} to="/dashboard">
            <LogoMark className={styles.logo} />
            <span>Popcorn Ready</span>
          </Link>
          <CloseButton
            className={styles.sidebarClose}
            aria-label="Close navigation menu"
            onClick={() => setNavOpen(false)}
          />
        </div>

        <Button
          className={styles.newVideo}
          variant="primary"
          onClick={() => {
            setNavOpen(false);
            navigate(`/projects/new?new=${Date.now()}`);
          }}
        >
          Create new video
        </Button>

        <nav className={styles.nav} aria-label="Dashboard">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/settings"}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                isActive ||
                item.activePaths.some((path) =>
                  path === "/" ? location.pathname === path : location.pathname.startsWith(path)
                )
                  ? `${styles.navLink} ${styles.active}`
                  : styles.navLink
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          {showAdmin ? (
            <nav className={styles.footerNav} aria-label="Admin">
              <span className={styles.footerLabel}>Admin</span>
              <NavLink
                to="/admin"
                onClick={() => setNavOpen(false)}
                className={({ isActive }) =>
                  isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
                }
              >
                Workbench
              </NavLink>
              <NavLink
                to="/admin/evals"
                onClick={() => setNavOpen(false)}
                className={({ isActive }) =>
                  isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
                }
              >
                Admin evals
              </NavLink>
            </nav>
          ) : null}

          <nav className={styles.footerNav} aria-label="Account">
            <span className={styles.footerLabel}>Account</span>
            <NavLink
              to="/account"
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
              }
            >
              Credits &amp; billing
            </NavLink>
            <NavLink
              to="/settings"
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
              }
            >
              Settings
            </NavLink>
            <NavLink
              to="/faq"
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
              }
            >
              FAQs
            </NavLink>
          </nav>

          {/* Mobile drawer only - on desktop the account lives in the topbar. */}
          <div className={styles.drawerAccount}>
            <span className={styles.drawerAccountLabel} title={accountLabel}>
              {accountLabel}
            </span>
            {canSignOut ? (
              <Button variant="secondary" size="sm" onClick={() => void signOut()}>
                Log out
              </Button>
            ) : null}
          </div>
        </div>
      </aside>

      {navOpen ? (
        <button
          type="button"
          className={styles.scrim}
          aria-label="Close navigation menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <div className={styles.content}>
        <header className={styles.topbar}>
          <button
            ref={menuButtonRef}
            type="button"
            className={styles.menuButton}
            aria-label="Open navigation menu"
            aria-expanded={navOpen}
            aria-controls="dashboard-sidebar"
            onClick={() => setNavOpen(true)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className={styles.breadcrumbSlot}>
            <Breadcrumbs items={breadcrumbItems} />
          </div>
          <div className={styles.commandSlot}>
            <CommandPalette showAdminCommands={showAdmin} />
          </div>
          <div className={styles.account}>
            <CreditsBadge
              authScope={authScope}
              enabled={auth.status !== "unauthenticated" || DEV_AUTOPILOT}
            />
            <Link
              className={`${styles.accountLink} ${styles.desktopOnly}`}
              to="/account"
            >
              {accountLabel}
            </Link>
            {canSignOut ? (
              <Button
                className={styles.desktopOnly}
                variant="secondary"
                size="sm"
                onClick={() => void signOut()}
              >
                Log out
              </Button>
            ) : null}
          </div>
        </header>
        <main className={styles.routeFrame}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function RootProviders({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    applyStoredTheme();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <UploadQueueProvider>{children}</UploadQueueProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
