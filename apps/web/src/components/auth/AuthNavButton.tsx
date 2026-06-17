import { Link } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import styles from "./AuthNavButton.module.css";

export function AuthNavButton() {
  const { status, user } = useAuth();

  // Don't flash "Sign in" before the session resolves.
  if (status === "loading") {
    return null;
  }

  // Signed in (or local/no-auth mode): link into the app instead of "Sign in".
  // Sign-out lives in the dashboard account menu.
  if (status === "authenticated" || status === "disabled") {
    return (
      <span className={styles.authActions}>
        <Link
          className={styles.cta}
          to="/dashboard"
          title={user?.email ?? "Go to dashboard"}
        >
          Open dashboard
        </Link>
      </span>
    );
  }

  return (
    <span className={styles.authActions}>
      <Link className={styles.secondary} to="/login">
        Sign in
      </Link>
      <Link className={styles.cta} to="/signup">
        Sign up
      </Link>
    </span>
  );
}
