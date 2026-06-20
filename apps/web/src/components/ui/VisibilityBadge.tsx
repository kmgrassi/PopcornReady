import styles from "./VisibilityBadge.module.css";

export type VisibilityState = "public" | "private";

function PublicIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r="5.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 2.25c1.65 1.45 2.5 3.38 2.5 5.75s-.85 4.3-2.5 5.75C6.35 12.3 5.5 10.37 5.5 8s.85-4.3 2.5-5.75ZM2.75 8h10.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function LockClosedIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="3.25"
        y="7"
        width="9.5"
        height="6.25"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M5.25 7V5.6a2.75 2.75 0 0 1 5.5 0V7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M8 9.5v1.25"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function VisibilityBadge({
  visibility = "public",
}: {
  visibility?: VisibilityState | null;
}) {
  const isPrivate = visibility === "private";

  return (
    <span className={styles.badge} data-private={isPrivate}>
      {isPrivate ? <LockClosedIcon /> : <PublicIcon />}
      <span>{isPrivate ? "Private" : "Public"}</span>
    </span>
  );
}
