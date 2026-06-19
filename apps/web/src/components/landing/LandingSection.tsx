import type { ReactNode } from "react";
import styles from "./LandingSection.module.css";

type SectionSpacing = "flush" | "tight" | "normal" | "spacious";
type SectionAlign = "start" | "center";

interface LandingSectionProps {
  children: ReactNode;
  id?: string;
  "aria-label"?: string;
  className?: string;
  contentClassName?: string;
  spacing?: SectionSpacing;
  align?: SectionAlign;
  kicker?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
}

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

export function LandingSection({
  children,
  id,
  "aria-label": ariaLabel,
  className,
  contentClassName,
  spacing = "normal",
  align = "center",
  kicker,
  title,
  subtitle,
}: LandingSectionProps) {
  const hasHeader = kicker || title || subtitle;

  return (
    <section
      id={id}
      aria-label={ariaLabel}
      className={cx(
        styles.section,
        styles[`spacing-${spacing}`],
        styles[`align-${align}`],
        className
      )}
    >
      {hasHeader ? (
        <LandingSectionHeader kicker={kicker} title={title} subtitle={subtitle} align={align} />
      ) : null}
      <div className={cx(styles.content, contentClassName)}>{children}</div>
    </section>
  );
}

export function LandingSectionHeader({
  kicker,
  title,
  subtitle,
  align = "center",
}: Pick<LandingSectionProps, "kicker" | "title" | "subtitle" | "align">) {
  return (
    <header className={cx(styles.header, styles[`align-${align}`])}>
      {kicker ? <span className={styles.kicker}>{kicker}</span> : null}
      {title ? <h2 className={styles.title}>{title}</h2> : null}
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </header>
  );
}
