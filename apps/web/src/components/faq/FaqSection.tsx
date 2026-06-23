import type { FaqItem } from "../../content/faqs";
import styles from "./FaqSection.module.css";

type FaqSectionVariant = "full" | "compact";

interface FaqSectionProps {
  faqs: FaqItem[];
  title?: string;
  eyebrow?: string;
  variant?: FaqSectionVariant;
}

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function FaqSection({
  faqs,
  title = "Frequently asked questions",
  eyebrow = "FAQ",
  variant = "full",
}: FaqSectionProps) {
  if (faqs.length === 0) return null;

  return (
    <section
      className={cx(styles.section, variant === "compact" && styles.compact)}
      aria-labelledby={`${variant}-faq-title`}
    >
      <header className={styles.header}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2 id={`${variant}-faq-title`}>{title}</h2>
      </header>
      <div className={styles.list}>
        {faqs.map((faq) => (
          <article className={styles.item} key={faq.id}>
            <h3>{faq.question}</h3>
            <p>{faq.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
