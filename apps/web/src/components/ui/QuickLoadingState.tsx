import { useEffect, useState, type ReactNode } from "react";
import styles from "./QuickLoadingState.module.css";

const REVEAL_DELAY_MS = 180;

interface QuickLoadingStateProps {
  title: string;
  description?: string;
  reservation?: ReactNode;
  showCompactWithReservation?: boolean;
  variant: "page" | "panel";
}

export function QuickLoadingState({
  title,
  description,
  reservation,
  showCompactWithReservation = false,
  variant,
}: QuickLoadingStateProps) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), REVEAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className={styles.frame} data-variant={variant}>
      {reservation ? (
        <div
          className={styles.reservation}
          data-visible={revealed || undefined}
          data-testid="quick-loading-reservation"
          aria-hidden="true"
        >
          {reservation}
        </div>
      ) : (
        <div className={styles.compactReservation} aria-hidden="true" />
      )}

      {revealed ? (
        <div
          className={reservation && !showCompactWithReservation ? styles.srOnly : styles.compact}
          data-testid="quick-loading"
          data-variant={variant}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          {!reservation || showCompactWithReservation ? (
            <span className={styles.track} aria-hidden="true">
              <span />
            </span>
          ) : null}
          <strong>{title}</strong>
          {description ? <span>{description}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
