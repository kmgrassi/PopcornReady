export type ToastVariant = "success" | "error";
export type ToastPlacement = "top" | "bottom";

export interface ToastInput {
  title: string;
  message?: string;
  variant?: ToastVariant;
  placement?: ToastPlacement;
  durationMs?: number;
}

export interface Toast extends Required<Omit<ToastInput, "message">> {
  id: string;
  message?: string;
}

type ToastListener = (toast: Toast) => void;

const listeners = new Set<ToastListener>();

export function subscribeToasts(listener: ToastListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showToast(input: ToastInput): Toast {
  const toast: Toast = {
    id: `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: input.title,
    message: input.message,
    variant: input.variant ?? "success",
    placement: input.placement ?? "bottom",
    durationMs: input.durationMs ?? 4_500,
  };

  for (const listener of listeners) {
    listener(toast);
  }

  return toast;
}

export function showSuccessToast(title: string, message?: string) {
  return showToast({ title, message, variant: "success" });
}

export function showErrorToast(title: string, message?: string) {
  return showToast({ title, message, variant: "error", durationMs: 6_000 });
}
