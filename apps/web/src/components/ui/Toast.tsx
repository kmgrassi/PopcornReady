import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  showErrorToast,
  showSuccessToast,
  showToast,
  subscribeToasts,
  type Toast,
  type ToastInput,
} from "../../lib/toast";
import styles from "./Toast.module.css";

interface ToastContextValue {
  showToast: (toast: ToastInput) => void;
  showSuccess: (title: string, message?: string) => void;
  showError: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    return subscribeToasts((toast) => {
      setToasts((current) => [...current.slice(-2), toast]);
      window.setTimeout(() => dismiss(toast.id), toast.durationMs);
    });
  }, [dismiss]);

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast: (toast) => {
        showToast(toast);
      },
      showSuccess: (title, message) => {
        showSuccessToast(title, message);
      },
      showError: (title, message) => {
        showErrorToast(title, message);
      },
    }),
    [],
  );

  const topToasts = toasts.filter((toast) => toast.placement === "top");
  const bottomToasts = toasts.filter((toast) => toast.placement === "bottom");

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastRegion placement="top" toasts={topToasts} onDismiss={dismiss} />
      <ToastRegion placement="bottom" toasts={bottomToasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within ToastProvider.");
  }
  return value;
}

function ToastRegion({
  placement,
  toasts,
  onDismiss,
}: {
  placement: Toast["placement"];
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      className={`${styles.region} ${styles[placement]}`}
      role="region"
      aria-label={`${placement} notifications`}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${styles[toast.variant]}`}
          role={toast.variant === "error" ? "alert" : "status"}
        >
          <span className={styles.indicator} aria-hidden="true" />
          <div className={styles.copy}>
            <strong>{toast.title}</strong>
            {toast.message ? <span>{toast.message}</span> : null}
          </div>
          <button
            className={styles.dismiss}
            type="button"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
