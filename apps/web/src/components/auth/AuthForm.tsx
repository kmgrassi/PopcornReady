import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogoMark } from "../LogoMark";
import { Button } from "../ui/Button";
import { clearAllSupabaseAuthStorage, getSupabaseClient } from "../../lib/supabase/browser";
import { usePendingQuickStartRun } from "../../lib/quickStartRun";
import { useAuth } from "./AuthProvider";
import styles from "./AuthForm.module.css";

type AuthFormProps = {
  mode: "login" | "signup";
};

function postAuthRedirectPath(state: unknown): string {
  if (
    typeof state === "object" &&
    state !== null &&
    "from" in state &&
    typeof state.from === "string" &&
    state.from.startsWith("/") &&
    !state.from.startsWith("//")
  ) {
    return state.from;
  }

  return "/dashboard";
}

export function AuthForm({ mode }: AuthFormProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, error, configured, signIn, signUp, clearError } = useAuth();
  const quickStartResume = usePendingQuickStartRun(status, location.state);
  const [ready, setReady] = useState(false);
  const [showSignupIntro, setShowSignupIntro] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const loading = status === "loading";
  const isSignup = mode === "signup";

  // Drop any error left over from the other auth form so switching
  // login <-> signup doesn't start with an unrelated message.
  useEffect(() => {
    clearError();
  }, [mode, clearError]);

  useEffect(() => {
    if (!configured) {
      setReady(true);
      return;
    }

    if (status === "loading") {
      setReady(false);
      return;
    }

    if (status === "authenticated") {
      setReady(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await getSupabaseClient().auth.signOut({ scope: "local" });
      } catch {
        // Ignore transient sign-out errors while clearing stale local sessions.
      } finally {
        clearAllSupabaseAuthStorage();
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [configured, status]);

  useEffect(() => {
    if (
      status === "authenticated" &&
      !quickStartResume.hasPending &&
      !quickStartResume.starting
    ) {
      navigate(postAuthRedirectPath(location.state), { replace: true });
    }
  }, [
    location.state,
    navigate,
    quickStartResume.hasPending,
    quickStartResume.starting,
    status,
  ]);

  useEffect(() => {
    if (!isSignup) {
      setShowSignupIntro(false);
      return;
    }

    const query = window.matchMedia("(min-width: 1024px)");
    const syncSignupIntro = () => setShowSignupIntro(query.matches);

    syncSignupIntro();
    query.addEventListener("change", syncSignupIntro);
    return () => query.removeEventListener("change", syncSignupIntro);
  }, [isSignup]);

  async function submit() {
    if (!ready || loading || !email.trim() || !password) return;
    if (isSignup) await signUp(email.trim(), password);
    else await signIn(email.trim(), password);
  }

  const pageClassName = isSignup
    ? `${styles.page} ${styles.signupPage}`
    : styles.page;

  return (
    <main className={pageClassName}>
      {showSignupIntro && (
        <aside className={styles.signupIntro} aria-label="Popcorn Ready overview">
          <Link to="/" className={styles.introBrand}>
            <LogoMark className={styles.introBrandMark} />
            <span>Popcorn Ready</span>
          </Link>
          <div className={styles.introCopy}>
            <p className={styles.eyebrow}>AI-native video studio</p>
            <h1>Turn an idea into a structured video pipeline.</h1>
            <p>
              Build projects, collect assets, and keep every generated version
              organized from prompt to final render.
            </p>
          </div>
          <figure className={styles.previewImage}>
            <img
              src="/images/pc-ai-orchestrator-overview.png"
              alt="Popcorn Ready orchestrator overview showing the brief, planning, generated assets, and render pipeline."
              width="1535"
              height="1024"
            />
          </figure>
        </aside>
      )}

      <section className={styles.card}>
        <Link to="/" className={styles.brand}>
          <LogoMark className={styles.brandMark} />
          <span>Popcorn Ready</span>
        </Link>

        <div className={styles.heading}>
          <h1>{isSignup ? "Create your account" : "Sign in"}</h1>
          <p>
            {isSignup
              ? "Start saving projects, assets, and finished videos."
              : "Continue to your video studio."}
          </p>
        </div>

        {!configured && (
          <p className={styles.error}>
            Supabase login is not configured yet. Set the public Supabase URL
            and anon key, then restart the app.
          </p>
        )}

        <div className={styles.fields}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void submit()}
            disabled={!ready || loading || !configured}
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void submit()}
            disabled={!ready || loading || !configured}
          />
        </div>

        {error && <p className={styles.error}>{error}</p>}
        {quickStartResume.error && (
          <p className={styles.error}>{quickStartResume.error}</p>
        )}

        {quickStartResume.starting && (
          <p className={styles.status}>Starting your video...</p>
        )}

        <Button
          className={styles.submit}
          variant="cta"
          size="lg"
          fullWidth
          type="button"
          onClick={() => void submit()}
          isLoading={loading || quickStartResume.starting}
          disabled={
            !ready ||
            loading ||
            quickStartResume.starting ||
            !configured ||
            !email.trim() ||
            !password
          }
        >
          {!ready
            ? "Preparing..."
            : loading || quickStartResume.starting
              ? isSignup
                ? "Creating..."
                : "Signing in..."
              : isSignup
                ? "Create account"
                : "Sign in"}
        </Button>

        <p className={styles.switch}>
          {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
          <Link to={isSignup ? "/login" : "/signup"} state={location.state}>
            {isSignup ? "Sign in" : "Sign up"}
          </Link>
        </p>
      </section>
    </main>
  );
}
