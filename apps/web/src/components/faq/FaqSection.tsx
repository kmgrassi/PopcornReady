import { useId } from "react";
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
  const headingId = useId();

  if (faqs.length === 0) return null;

  return (
    <section
      className={cx(styles.section, variant === "compact" && styles.compact)}
      aria-labelledby={headingId}
    >
      <header className={styles.header}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2 id={headingId}>{title}</h2>
      </header>
      <div className={styles.list}>
        {faqs.map((faq) => (
          <article className={styles.item} key={faq.id}>
            <h3>{faq.question}</h3>
            <p>{faq.answer}</p>
            {faq.links && faq.links.length > 0 ? (
              <div className={styles.links}>
                {faq.links.map((link) => (
                  <a
                    href={link.href}
                    key={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
