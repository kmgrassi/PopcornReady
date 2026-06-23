import { FaqSection } from "../components/faq/FaqSection";
import { faqsForPlacement } from "../content/faqs";
import styles from "./FaqPage.module.css";

export function FaqPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>FAQ</p>
        <h1>Frequently asked questions</h1>
        <p>
          Quick answers for workspace setup, generation, credits, and exports.
        </p>
      </header>

      <FaqSection
        faqs={faqsForPlacement("dashboard")}
        title="Quick answers"
        eyebrow="Help"
      />
    </div>
  );
}
