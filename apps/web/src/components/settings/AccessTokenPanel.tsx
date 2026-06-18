import { useCallback, useState } from "react";
import { getSupabaseClient } from "../../lib/supabase/browser";
import { Button } from "../ui/Button";
import { useAuth } from "../auth/AuthProvider";
import styles from "./AccessTokenPanel.module.css";

function maskToken(token: string): string {
  if (token.length <= 14) return "•".repeat(token.length);
  return `${token.slice(0, 6)}${"•".repeat(20)}${token.slice(-4)}`;
}

// Surfaces the signed-in user's Supabase access token (the `Authorization:
// Bearer` value) so it can be copied for API/CLI calls without digging through
// browser storage. Masked by default; the token is read on demand from the live
// session, never persisted by this component.
export function AccessTokenPanel() {
  const auth = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = auth.configured && auth.status === "authenticated";

  const fetchToken = useCallback(async (): Promise<string | null> => {
    if (token) return token;
    setBusy(true);
    setError(null);
    try {
      const { data, error: sessionError } = await getSupabaseClient().auth.getSession();
      if (sessionError) throw sessionError;
      const value = data.session?.access_token ?? null;
      if (!value) throw new Error("No active session token — try signing in again.");
      setToken(value);
      return value;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, [token]);

  const onToggleReveal = useCallback(async () => {
    if (revealed) {
      setRevealed(false);
      return;
    }
    const value = await fetchToken();
    if (value) setRevealed(true);
  }, [revealed, fetchToken]);

  const onCopy = useCallback(async () => {
    const value = await fetchToken();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically — reveal the token and copy it manually.");
    }
  }, [fetchToken]);

  if (!available) {
    return (
      <article className={styles.panel}>
        <p className={styles.kicker}>Developer</p>
        <h2>API access token</h2>
        <p className={styles.muted}>Sign in to view your API access token.</p>
      </article>
    );
  }

  return (
    <article className={styles.panel}>
      <p className={styles.kicker}>Developer</p>
      <h2>API access token</h2>
      <p className={styles.muted}>
        Bearer token for calling the API as you (<code>Authorization: Bearer …</code>).
        Treat it like a password — it grants full access to your account and
        expires after about an hour.
      </p>
      <div className={styles.tokenBox} aria-label="API access token">
        {revealed && token ? token : token ? maskToken(token) : "•••••••••••••• (hidden)"}
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => void onToggleReveal()} disabled={busy}>
          {revealed ? "Hide" : "Reveal"}
        </Button>
        <Button variant="primary" onClick={() => void onCopy()} disabled={busy}>
          {copied ? "Copied" : "Copy token"}
        </Button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </article>
  );
}
