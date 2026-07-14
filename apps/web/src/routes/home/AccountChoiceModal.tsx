import { useEffect } from "react";
import { AnonymousUpgradeBanner } from "../../components/auth/AnonymousUpgradeBanner";
import { CloseButton } from "../../components/ui/CloseButton";
import styles from "../HomePage.module.css";

interface AccountChoiceModalProps {
  authConfigured: boolean;
  error: string | null;
  mode: "choice" | "limit";
  onClose: () => void;
  onCreateAccount: () => void;
  onSkipAccount: () => void;
  skippingAccount: boolean;
  targetLengthSec: number;
  variant?: "prompt" | "upload";
}

export function AccountChoiceModal({
  authConfigured,
  error,
  mode,
  onClose,
  onCreateAccount,
  onSkipAccount,
  skippingAccount,
  targetLengthSec,
  variant = "prompt",
}: AccountChoiceModalProps) {
  const guestLimitReached = mode === "limit";
  const isUpload = variant === "upload";

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="account-choice-title"
        aria-modal="true"
        className={styles.accountModal}
        role="dialog"
      >
        <CloseButton className={styles.modalClose} onClick={onClose} />
        <p className={styles.modalKicker}>Ready to generate</p>
        <h2 id="account-choice-title">Do you want to create an account?</h2>
        <p>
          {guestLimitReached
            ? "Create an account to make more videos and keep every project tied to your workspace."
            : isUpload
            ? `Your clips are uploaded. Create an account in this guest workspace, or start one ${targetLengthSec}-second run now.`
            : `Create an account before starting, or skip this step and generate one ${targetLengthSec}-second video as a guest.`}
        </p>
        {isUpload && <AnonymousUpgradeBanner className={styles.inlineUpgrade} />}
        {!authConfigured && (
          <p className={styles.modalError}>
            Supabase auth is not configured in this environment.
          </p>
        )}
        {error && <p className={styles.modalError}>{error}</p>}
        <div
          className={
            isUpload
              ? `${styles.modalActions} ${styles.modalActionsSingle}`
              : styles.modalActions
          }
        >
          {!isUpload && (
            <button
              className={styles.modalPrimary}
              type="button"
              onClick={onCreateAccount}
            >
              Create account
            </button>
          )}
          <button
            className={styles.modalSecondary}
            type="button"
            onClick={onSkipAccount}
            disabled={!authConfigured || guestLimitReached || skippingAccount}
          >
            {skippingAccount
              ? "Starting guest session..."
              : isUpload
              ? "Create uploaded run"
              : "Skip this step"}
          </button>
        </div>
      </section>
    </div>
  );
}
