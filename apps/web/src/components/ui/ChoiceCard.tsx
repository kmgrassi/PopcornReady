import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./ChoiceCard.module.css";

export interface ChoiceCardProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "children" | "className" | "type"> {
  label: ReactNode;
  description?: ReactNode;
  className?: string;
  type?: "radio" | "checkbox";
}

export function ChoiceCard({
  label,
  description,
  className,
  disabled,
  type = "radio",
  ...rest
}: ChoiceCardProps) {
  return (
    <label
      className={[styles.root, disabled ? styles.disabled : null, className]
        .filter(Boolean)
        .join(" ")}
    >
      <input className={styles.input} type={type} disabled={disabled} {...rest} />
      <span className={styles.copy}>
        <span className={styles.label}>{label}</span>
        {description ? <span className={styles.description}>{description}</span> : null}
      </span>
      <span className={styles.indicator} aria-hidden="true">
        <span className={styles.indicatorDot} />
      </span>
    </label>
  );
}
