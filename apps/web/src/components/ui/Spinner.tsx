import styles from "./Spinner.module.css";

export type SpinnerSize = "sm" | "md" | "lg";

/**
 * Dashboard-wide loading primitive. Use anywhere an async/background process is
 * in flight — pair with a short status label so the indicator explains itself.
 * For button-local loading prefer `<Button isLoading>`.
 */
export function Spinner({
  size = "md",
  label,
  className,
}: {
  size?: SpinnerSize;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={[styles.spinner, styles[size], className].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
    >
      <span className={styles.ring} aria-hidden="true" />
      {label ? (
        <span className={styles.label}>{label}</span>
      ) : (
        <span className={styles.visuallyHidden}>Loading</span>
      )}
    </span>
  );
}
