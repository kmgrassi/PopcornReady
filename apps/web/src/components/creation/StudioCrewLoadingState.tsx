import type { ReactNode } from "react";
import { StudioCrewLoader } from "./StudioCrewLoader";
import styles from "./StudioCrewLoadingState.module.css";

interface StudioCrewLoadingStateProps {
  title: string;
  description?: string;
  reservation?: ReactNode;
  variant: "page" | "panel";
}

export function StudioCrewLoadingState({
  title,
  description,
  reservation,
  variant,
}: StudioCrewLoadingStateProps) {
  return (
    <div className={styles.frame} data-variant={variant}>
      <section
        className={styles.state}
        data-variant={variant}
        data-testid="studio-crew-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <StudioCrewLoader active />
        <div className={styles.copy}>
          <strong>{title}</strong>
          {description ? <p>{description}</p> : null}
        </div>
      </section>
      {reservation ? (
        <div
          className={styles.reservation}
          data-testid="studio-crew-loading-reservation"
          aria-hidden="true"
        >
          {reservation}
        </div>
      ) : null}
    </div>
  );
}
