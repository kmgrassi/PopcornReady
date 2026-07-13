import { useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../components/auth/AuthProvider";
import styles from "./AuthCallbackPage.module.css";

function callbackError(searchParams: URLSearchParams): string | null {
  const message = searchParams.get("error_description") || searchParams.get("error");
  return message ? message.replace(/\+/g, " ") : null;
}

// Supabase completes email-confirmation, invite, and recovery redirects while
// initializing the browser client. This route gives that handoff a stable URL
// and waits for AuthProvider to observe the resulting session before sending
// the user into their workspace.
export function AuthCallbackPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const error = useMemo(() => callbackError(searchParams), [searchParams]);

  useEffect(() => {
    if (!error && auth.status === "authenticated" && !auth.isAnonymous) {
      navigate("/dashboard", { replace: true });
    }
  }, [auth.isAnonymous, auth.status, error, navigate]);

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-live="polite">
        {error ? (
          <>
            <h1>We couldn’t verify that link</h1>
            <p>{error}</p>
            <Link className={styles.link} to="/login">
              Return to sign in
            </Link>
          </>
        ) : auth.status === "authenticated" && auth.isAnonymous ? (
          <>
            <h1>Use your account invitation</h1>
            <p>This link needs to be opened without a guest session.</p>
            <Link className={styles.link} to="/login">
              Sign in to continue
            </Link>
          </>
        ) : (
          <>
            <h1>Signing you in</h1>
            <p>Verifying your email and opening your workspace…</p>
          </>
        )}
      </section>
    </main>
  );
}
