import type { ButtonHTMLAttributes } from "react";
import styles from "./CloseButton.module.css";

export type CloseButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export function CloseButton({
  className,
  type = "button",
  "aria-label": ariaLabel = "Close",
  ...props
}: CloseButtonProps) {
  return (
    <button
      className={[styles.button, className].filter(Boolean).join(" ")}
      type={type}
      aria-label={ariaLabel}
      {...props}
    />
  );
}
