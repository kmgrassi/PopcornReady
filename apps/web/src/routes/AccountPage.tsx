import { useMemo } from "react";
import { Link } from "react-router-dom";
import { canAccessAdminSurface } from "../components/auth/AdminRoute";
import { useAuth } from "../components/auth/AuthProvider";
import { Button } from "../components/ui/Button";
import {
  useBuyCreditsMutation,
  useCreditPacksQuery,
  useCreditTransactionsQuery,
  useCreditsQuery,
} from "../lib/queryClient";
import type { CreditTransaction } from "../lib/api-client";
import styles from "./AccountPage.module.css";

const DEV_AUTOPILOT = import.meta.env.DEV;

const REASON_LABEL: Record<CreditTransaction["reason"], string> = {
  signup_grant: "Starter grant",
  purchase: "Purchase",
  generation_debit: "Generation",
  refund: "Refund",
  adjustment: "Adjustment",
};

function usd(credits: number, creditValueUsd: number): string {
  return `$${(credits * creditValueUsd).toFixed(2)}`;
}

export function AccountPage() {
  const auth = useAuth();
  const authScope = auth.user?.id ?? (DEV_AUTOPILOT ? "dev-autopilot" : auth.status);
  const enabled =
    auth.status !== "loading" &&
    (auth.status !== "unauthenticated" || DEV_AUTOPILOT);

  const creditsQuery = useCreditsQuery(authScope, { enabled });
  const packsQuery = useCreditPacksQuery();
  const txQuery = useCreditTransactionsQuery(authScope, { enabled });
  const buy = useBuyCreditsMutation();

  const credits = creditsQuery.data;
  const showAdmin = canAccessAdminSurface(auth);
  const balance = credits?.balanceCredits ?? null;
  const creditValueUsd = credits?.creditValueUsd ?? 0.01;
  // Local mode is an explicit server flag — never inferred from a missing balance
  // (which is just loading/error). Otherwise a hosted account would see the
  // local-dev message and lose the Buy-credits section while loading or on error.
  const isLocal = credits?.isLocal === true;

  const transactions = useMemo(() => txQuery.data?.transactions ?? [], [txQuery.data]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Credits &amp; billing</h1>
        <p className="muted">
          Generations on our hosted keys spend credits. Bring your own API keys in{" "}
          <Link to="/settings">Settings</Link> to generate for free.
        </p>
      </header>

      <section className={styles.balanceCard}>
        <span className={styles.balanceLabel}>Balance</span>
        {creditsQuery.isLoading ? (
          <p className="muted">Loading your balance…</p>
        ) : creditsQuery.isError ? (
          <div className={styles.balanceError}>
            <p className={styles.outOfCredits}>Couldn’t load your balance.</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void creditsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : isLocal ? (
          <p className="muted">
            Credits apply to hosted generation. In local dev, generation uses the
            platform keys and isn’t billed.
          </p>
        ) : (
          <>
            <div className={styles.balanceValue}>
              {(balance ?? 0).toLocaleString()}{" "}
              <span className={styles.balanceUnit}>credits</span>
            </div>
            <span className="muted">≈ {usd(balance ?? 0, creditValueUsd)} of hosted generation</span>
            {balance !== null && balance <= 0 ? (
              <p className={styles.outOfCredits}>
                You’re out of credits. Buy more below, or add your own API keys in{" "}
                <Link to="/settings">Settings</Link>.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className={styles.section}>
        <h2>More</h2>
        <div className={styles.linkGrid}>
          <Link to="/settings">Settings</Link>
          <Link to="/faq">FAQ</Link>
          <Link to="/inspiration">Inspiration</Link>
          {showAdmin ? <Link to="/admin">Admin workbench</Link> : null}
        </div>
      </section>

      {!isLocal ? (
        <section className={styles.section}>
          <h2>Buy credits</h2>
          <p className="muted">One-time top-up. 1 credit = ${creditValueUsd.toFixed(2)}.</p>
          <div className={styles.packs}>
            {(packsQuery.data?.packs ?? []).map((pack) => (
              <div key={pack.id} className={styles.pack}>
                <div className={styles.packCredits}>{pack.credits.toLocaleString()}</div>
                <div className="muted">credits</div>
                <Button
                  variant="primary"
                  disabled={buy.isPending}
                  onClick={() => buy.mutate(pack.id)}
                >
                  Buy ${pack.usd}
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2>History</h2>
        {transactions.length === 0 ? (
          <p className="muted">No credit activity yet.</p>
        ) : (
          <table className={styles.txTable}>
            <thead>
              <tr>
                <th>When</th>
                <th>Activity</th>
                <th className={styles.num}>Change</th>
                <th className={styles.num}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td>{new Date(tx.createdAt).toLocaleString()}</td>
                  <td>{REASON_LABEL[tx.reason] ?? tx.reason}</td>
                  <td className={`${styles.num} ${tx.deltaCredits < 0 ? styles.debit : styles.credit}`}>
                    {tx.deltaCredits > 0 ? "+" : ""}
                    {tx.deltaCredits.toLocaleString()}
                  </td>
                  <td className={styles.num}>{tx.balanceAfter.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
