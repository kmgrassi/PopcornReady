import { ButtonLink } from "../components/ui/Button";
import styles from "./NotFoundPage.module.css";

export function NotFoundPage() {
  return (
    <main className={styles.page}>
      <section className={styles.content} aria-labelledby="not-found-title">
        <div className={styles.mark} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1 id="not-found-title">That page isn’t here.</h1>
        <p>
          The link may be outdated, or the page may have moved. Start from the
          homepage, or return to your studio.
        </p>
        <div className={styles.actions}>
          <ButtonLink to="/" variant="cta" size="lg">
            Go to homepage
          </ButtonLink>
          <ButtonLink to="/dashboard" variant="secondary" size="lg">
            Open dashboard
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
