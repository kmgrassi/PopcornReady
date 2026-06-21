import { FormEvent, useState } from "react";
import { Button } from "../ui/Button";
import { useAuth } from "./AuthProvider";
import styles from "./AnonymousUpgradeBanner.module.css";

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Could not create your account. Try again.";
}

export function AnonymousUpgradeBanner({
  className,
}: {
  className?: string;
}) {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [pending, setPending] = useState(false);

  if (!auth.configured || auth.status !== "authenticated" || !auth.isAnonymous) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !email.trim() || !password) return;
    setError(null);
    setComplete(false);
    setPending(true);
    try {
      await auth.upgradeAnonymousAccount(email, password);
      setComplete(true);
      setPassword("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={[styles.banner, className].filter(Boolean).join(" ")} aria-labelledby="anonymous-upgrade-heading">
      <div className={styles.copy}>
        <p className={styles.eyebrow}>Guest workspace</p>
        <h2 id="anonymous-upgrade-heading" className={styles.title}>
          Save your video - create an account
        </h2>
        <p className={styles.body}>
          Add an email and password to keep this project, revisit the run, and make more videos from the same workspace.
        </p>
      </div>
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <div className={styles.field}>
          <label htmlFor="anonymous-upgrade-email">Email</label>
          <input
            id="anonymous-upgrade-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
            required
          />
        </div>
        <Button variant="cta" type="submit" isLoading={pending} disabled={!email.trim() || !password}>
          Create account
        </Button>
      </form>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {complete ? <p className={styles.success}>Account created. This video is saved to your workspace.</p> : null}
    </section>
  );
}
