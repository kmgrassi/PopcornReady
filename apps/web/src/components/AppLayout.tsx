import {
  useLayoutEffect,
  useMemo,
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
import { LogoMark } from "./LogoMark";
import { CommandPalette } from "./palette/Palette";
import ThemeToggle from "./ThemeToggle";
import { Button } from "./ui/Button";
import { queryClient, useMeQuery } from "../lib/queryClient";
import styles from "./AppLayout.module.css";

const STORAGE_KEY = "popcorn-ready-theme";
const DEFAULT_THEME = "popcorn";
const VALID_THEMES = new Set(["popcorn", "popcorn-warm", "popcorn-night"]);

// Primary workspace nav. Library groups the collection routes until PR 5 gives
// it a dedicated tab shell.
const PRIMARY_NAV = [
  {
    label: "Library",
    to: "/library",
    activePaths: ["/library", "/projects", "/assets"],
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
      <header className="web-shell-header">
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

export function AuthenticatedAppLayout() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const authScope = auth.user?.id ?? (DEV_AUTOPILOT ? "dev-autopilot" : auth.status);
  const meQuery = useMeQuery(authScope, {
    enabled:
      auth.status !== "loading" &&
      (auth.status !== "unauthenticated" || DEV_AUTOPILOT),
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
      <aside className={styles.sidebar}>
        <Link className={styles.brand} to="/dashboard">
          <LogoMark className={styles.logo} />
          <span>Popcorn Ready</span>
        </Link>

        <Button className={styles.newVideo} variant="primary" onClick={() => navigate("/library/projects")}>
          Projects
        </Button>

        <nav className={styles.nav} aria-label="Dashboard">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/settings"}
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
                className={({ isActive }) =>
                  isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
                }
              >
                Workbench
              </NavLink>
              <NavLink
                to="/admin/evals"
                className={({ isActive }) =>
                  isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
                }
              >
                Admin evals
              </NavLink>
            </nav>
          ) : null}

          <nav className={styles.footerNav} aria-label="Account">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
              }
            >
              Settings
            </NavLink>
          </nav>
        </div>
      </aside>

      <div className={styles.content}>
        <header className={styles.topbar}>
          <CommandPalette showAdminCommands={showAdmin} />
          <div className={styles.account}>
            <Link className={styles.accountLink} to="/settings">
              {accountLabel}
            </Link>
            {canSignOut ? (
              <Button variant="secondary" size="sm" onClick={() => void signOut()}>
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
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
