import { ChangeEvent, FormEvent, useState } from "react";
import { Button } from "../ui/Button";
import { useAuth } from "./AuthProvider";
import styles from "./AnonymousUpgradeBanner.module.css";

type UpgradeStep = "email" | "verify";

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Could not create your account. Try again.";
}

function emailValueIsValid(value: string): boolean {
  const normalizedValue = value.trim();
  if (!normalizedValue) return false;

  const input = document.createElement("input");
  input.type = "email";
  input.required = true;
  input.value = normalizedValue;
  return input.checkValidity();
}

export function AnonymousUpgradeBanner({
  className,
}: {
  className?: string;
}) {
  const auth = useAuth();
  const [step, setStep] = useState<UpgradeStep>("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [pending, setPending] = useState(false);
  const [emailIsValid, setEmailIsValid] = useState(false);
  const showUpgrade = auth.isAnonymous || step === "verify" || pending || complete;
  const normalizedEmail = email.trim();

  if (!auth.configured || auth.status !== "authenticated" || !showUpgrade) {
    return null;
  }

  function updateEmail(event: ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value);
    setEmailIsValid(emailValueIsValid(event.target.value));
  }

  async function sendVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !emailIsValid) return;
    setError(null);
    setComplete(false);
    setPending(true);
    try {
      await auth.beginAnonymousAccountUpgrade(normalizedEmail);
      setStep("verify");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  async function confirmUpgrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !emailIsValid || !token.trim() || !password) return;
    if (password.length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }
    setError(null);
    setComplete(false);
    setPending(true);
    try {
      await auth.completeAnonymousAccountUpgrade(normalizedEmail, token, password);
      setComplete(true);
      setStep("email");
      setToken("");
      setPassword("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className={[styles.banner, className].filter(Boolean).join(" ")}
      aria-labelledby="anonymous-upgrade-heading"
    >
      <div className={styles.copy}>
        <p className={styles.eyebrow}>Guest workspace</p>
        <h2 id="anonymous-upgrade-heading" className={styles.title}>
          Saved for 30 days
        </h2>
        <p className={styles.body}>
          {step === "email"
            ? "Create a free account to keep this project forever. Guest projects are removed after 30 days of inactivity."
            : "Enter the verification code from your email, then choose a password for this account."}
        </p>
      </div>
      {step === "email" ? (
        <form
          className={`${styles.form} ${styles.emailForm}`}
          onSubmit={(event) => void sendVerification(event)}
        >
          <div className={styles.field}>
            <label htmlFor="anonymous-upgrade-email">Email</label>
            <input
              id="anonymous-upgrade-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={updateEmail}
              disabled={pending}
              required
            />
          </div>
          <Button variant="secondary" type="submit" isLoading={pending} disabled={!emailIsValid}>
            Send code
          </Button>
        </form>
      ) : (
        <form className={styles.form} onSubmit={(event) => void confirmUpgrade(event)}>
          <div className={styles.field}>
            <label htmlFor="anonymous-upgrade-email">Email</label>
            <input
              id="anonymous-upgrade-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={updateEmail}
              disabled={pending}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="anonymous-upgrade-token">Code</label>
            <input
              id="anonymous-upgrade-token"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={pending}
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="anonymous-upgrade-password">Password</label>
            <input
              id="anonymous-upgrade-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
              minLength={6}
              required
            />
          </div>
          <Button
            variant="secondary"
            type="submit"
            isLoading={pending}
            disabled={!emailIsValid || !token.trim() || password.length < 6}
          >
            Create account
          </Button>
        </form>
      )}
      {step === "verify" && !complete ? (
        <button
          className={styles.linkButton}
          type="button"
          onClick={() => void setStep("email")}
          disabled={pending}
        >
          Use a different email
        </button>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {complete ? (
        <p className={styles.success}>
          Account created. This project is saved to your workspace.
        </p>
      ) : null}
    </section>
  );
}
