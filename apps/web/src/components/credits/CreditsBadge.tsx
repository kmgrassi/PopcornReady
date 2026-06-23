import { Link } from "react-router-dom";
import { useCreditsQuery } from "../../lib/queryClient";
import styles from "./CreditsBadge.module.css";

// Compact credit balance for the dashboard top bar. Links to the account page.
// Hidden in local/guest mode (no per-user wallet) and while the balance loads.
export function CreditsBadge({
  authScope,
  enabled,
}: {
  authScope: string;
  enabled: boolean;
}) {
  const { data } = useCreditsQuery(authScope, { enabled });
  const balance = data?.balanceCredits;
  if (typeof balance !== "number") return null;

  const low = balance <= 0;
  return (
    <Link
      className={`${styles.badge} ${low ? styles.low : ""}`}
      to="/account"
      title={low ? "Out of credits — buy more or add your own API keys" : "Credits — manage in your account"}
    >
      <span className={styles.value}>{balance.toLocaleString()}</span>
      <span className={styles.label}>credits</span>
    </Link>
  );
}
