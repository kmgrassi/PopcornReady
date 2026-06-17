import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogoMark } from "../LogoMark";
import { clearAllSupabaseAuthStorage, getSupabaseClient } from "../../lib/supabase/browser";
import { useAuth } from "./AuthProvider";
import styles from "./AuthForm.module.css";

type AuthFormProps = {
  mode: "login" | "signup";
};

export function AuthForm({ mode }: AuthFormProps) {
  const navigate = useNavigate();
  const { status, error, configured, signIn, signUp, clearError } = useAuth();
  const [ready, setReady] = useState(false);
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
    if (status === "authenticated") navigate("/dashboard", { replace: true });
  }, [navigate, status]);

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
      {isSignup && (
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
          <div
            className={styles.previewImage}
            role="img"
            aria-label="A stylized project board with video frames, timeline tracks, and review notes"
          >
            <div className={styles.previewTopbar}>
              <span />
              <span />
              <span />
            </div>
            <div className={styles.previewFrameGrid}>
              <span />
              <span />
              <span />
            </div>
            <div className={styles.previewTimeline}>
              <span />
              <span />
              <span />
            </div>
          </div>
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

        <button
          className={styles.submit}
          type="button"
          onClick={() => void submit()}
          disabled={!ready || loading || !configured || !email.trim() || !password}
        >
          {!ready
            ? "Preparing..."
            : loading
              ? isSignup
                ? "Creating..."
                : "Signing in..."
              : isSignup
                ? "Create account"
                : "Sign in"}
        </button>

        <p className={styles.switch}>
          {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
          <Link to={isSignup ? "/login" : "/signup"}>
            {isSignup ? "Sign in" : "Sign up"}
          </Link>
        </p>
      </section>
    </main>
  );
}
