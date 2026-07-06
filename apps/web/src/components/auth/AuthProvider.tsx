import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { v1Api } from "../../lib/api-client";
import {
  clearAllSupabaseAuthStorage,
  clearBrowserSessionState,
  clearOtherSupabaseAuthStorage,
  getSupabaseClient,
  resolveBrowserSupabaseConfig,
} from "../../lib/supabase/browser";
import {
  clearAnonymousDeviceRecoveryToken,
  ensureAnonymousDeviceRecoveryToken,
  getAnonymousDeviceRecoveryToken,
} from "../../lib/supabase/anonymous-device-recovery";

export type AuthStatus = "loading" | "disabled" | "unauthenticated" | "authenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  isAnonymous: boolean;
  error: string | null;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInAnonymous: () => Promise<void>;
  beginAnonymousAccountUpgrade: (email: string) => Promise<void>;
  completeAnonymousAccountUpgrade: (
    email: string,
    token: string,
    password: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Turn a Supabase auth error into a user-facing message. Falls back to the raw
// message so nothing is hidden; only the most common codes get friendlier copy.
function describeAuthError(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  if (code === "email_not_confirmed") {
    return "Your email isn't confirmed yet. Check your inbox for the verification link, then sign in.";
  }
  if (code === "invalid_credentials") {
    return "Incorrect email or password.";
  }
  if (code === "account_collision") {
    return "That email is already reserved for an invited account. Sign in with that account or use a different email.";
  }
  if (code === "user_already_exists" || code === "email_exists") {
    return "An account already exists for that email. Sign in instead, or use a different email.";
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function isAnonymousUser(user: User | null): boolean {
  return Boolean(user?.is_anonymous);
}

async function registerAnonymousDeviceTokenBestEffort() {
  try {
    await v1Api.registerAnonymousDeviceToken(ensureAnonymousDeviceRecoveryToken());
  } catch (err) {
    console.warn("Could not register anonymous device recovery token.", err);
  }
}

async function recoverAnonymousWorkspaceBestEffort(token: string) {
  try {
    await v1Api.recoverAnonymousDeviceWorkspace(token);
  } catch (err) {
    console.warn("Could not recover anonymous workspace from device token.", err);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = Boolean(resolveBrowserSupabaseConfig());

  useEffect(() => {
    if (!configured) {
      setStatus("disabled");
      return;
    }

    clearOtherSupabaseAuthStorage();
    const supabase = getSupabaseClient();
    let mounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setStatus(session?.user ? "authenticated" : "unauthenticated");
      // Only clear a surfaced error on a *successful* auth. A SIGNED_OUT event —
      // e.g. AuthForm defensively clearing a stale local session after a failed
      // sign-in — must not wipe the sign-in/sign-up error before the user reads it.
      if (session?.user) setError(null);
    });

    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!mounted) return;
        if (sessionError) throw sessionError;
        setUser(data.session?.user ?? null);
        setStatus(data.session?.user ? "authenticated" : "unauthenticated");
      })
      .catch((err) => {
        if (!mounted) return;
        setUser(null);
        setStatus("unauthenticated");
        setError(describeAuthError(err));
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [configured]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    setStatus("loading");
    try {
      clearAllSupabaseAuthStorage();
      clearAnonymousDeviceRecoveryToken();
      const { data, error: signInError } =
        await getSupabaseClient().auth.signInWithPassword({ email, password });
      if (signInError || !data.session?.user) {
        throw signInError || new Error("No Supabase session returned.");
      }
      setUser(data.session.user);
      setStatus("authenticated");
    } catch (err) {
      setUser(null);
      setStatus("unauthenticated");
      setError(describeAuthError(err));
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null);
    setStatus("loading");
    try {
      clearAllSupabaseAuthStorage();
      clearAnonymousDeviceRecoveryToken();
      const { data, error: signUpError } = await getSupabaseClient().auth.signUp({
        email,
        password,
      });
      if (signUpError) throw signUpError;

      if (data.session?.user) {
        setUser(data.session.user);
        setStatus("authenticated");
        return;
      }

      setUser(null);
      setStatus("unauthenticated");
      setError("Sign-up complete. Check your email for verification.");
    } catch (err) {
      setUser(null);
      setStatus("unauthenticated");
      setError(describeAuthError(err));
    }
  }, []);

  const signInAnonymous = useCallback(async () => {
    setError(null);
    setStatus("loading");
    try {
      const supabase = getSupabaseClient();
      const { data: existingData, error: existingError } = await supabase.auth.getSession();
      if (existingError) {
        clearAllSupabaseAuthStorage();
      } else if (existingData.session?.user) {
        setUser(existingData.session.user);
        setStatus("authenticated");
        if (isAnonymousUser(existingData.session.user)) {
          await registerAnonymousDeviceTokenBestEffort();
        }
        return;
      }

      const recoveryToken = getAnonymousDeviceRecoveryToken();
      const { data, error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError || !data.session?.user) {
        throw signInError || new Error("No Supabase anonymous session returned.");
      }
      if (recoveryToken) {
        await recoverAnonymousWorkspaceBestEffort(recoveryToken);
      }
      await registerAnonymousDeviceTokenBestEffort();
      setUser(data.session.user);
      setStatus("authenticated");
    } catch (err) {
      setUser(null);
      setStatus("unauthenticated");
      setError(describeAuthError(err));
      throw err;
    }
  }, []);

  const beginAnonymousAccountUpgrade = useCallback(async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    setError(null);
    try {
      await v1Api.preflightAnonymousAccountUpgrade(normalizedEmail);
      const { data, error: updateError } = await getSupabaseClient().auth.updateUser({
        email: normalizedEmail,
      });
      if (updateError || !data.user) {
        throw updateError || new Error("No Supabase user returned.");
      }
      setUser(data.user);
      setStatus("authenticated");
    } catch (err) {
      setStatus(user ? "authenticated" : "unauthenticated");
      const message = describeAuthError(err);
      setError(message);
      throw new Error(message);
    }
  }, [user]);

  const completeAnonymousAccountUpgrade = useCallback(async (
    email: string,
    token: string,
    password: string
  ) => {
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedToken = token.trim();
    setError(null);
    try {
      await v1Api.preflightAnonymousAccountUpgrade(normalizedEmail);
      const supabase = getSupabaseClient();
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: trimmedToken,
        type: "email_change",
      });
      if (verifyError || !verifyData.user) {
        throw verifyError || new Error("No Supabase user returned.");
      }

      const { data: passwordData, error: passwordError } =
        await supabase.auth.updateUser({ password });
      if (passwordError || !passwordData.user) {
        throw passwordError || new Error("No Supabase user returned.");
      }

      await supabase.auth.refreshSession();
      await v1Api.completeAnonymousAccountUpgrade(normalizedEmail);
      clearAnonymousDeviceRecoveryToken();
      setUser(passwordData.user);
      setStatus("authenticated");
    } catch (err) {
      setStatus(user ? "authenticated" : "unauthenticated");
      const message = describeAuthError(err);
      setError(message);
      throw new Error(message);
    }
  }, [user]);

  const signOut = useCallback(async () => {
    setError(null);
    if (configured) {
      try {
        const supabase = getSupabaseClient();
        await supabase.auth.signOut();
      } catch {
        // Still clear browser state so a stale local session cannot keep the
        // user signed in after an auth/network failure.
      }
    }
    clearAllSupabaseAuthStorage();
    clearBrowserSessionState();
    setUser(null);
    setStatus("unauthenticated");
  }, [configured]);

  // Lets a view drop a stale surfaced error without a status change — e.g. the
  // auth form clears the previous message when the user switches login <-> signup.
  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      isAnonymous: isAnonymousUser(user),
      error,
      configured,
      signIn,
      signUp,
      signInAnonymous,
      beginAnonymousAccountUpgrade,
      completeAnonymousAccountUpgrade,
      signOut,
      clearError,
    }),
    [
      status,
      user,
      error,
      configured,
      signIn,
      signUp,
      signInAnonymous,
      beginAnonymousAccountUpgrade,
      completeAnonymousAccountUpgrade,
      signOut,
      clearError,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
