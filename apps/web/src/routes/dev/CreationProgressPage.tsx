import { CreationProgressExperience } from "../../components/creation/CreationProgressExperience";
import styles from "./CreationProgressPage.module.css";

const presentation = {
  label: "In progress",
  tone: "active",
  isActive: true,
} as const;

export function CreationProgressPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.projectContext}>
          Creating for Star Duo On Logo Carpet
        </p>
        <h1>The studio is making it</h1>
        <p>Your crew is working through the brief now.</p>
      </header>
      <CreationProgressExperience
        presentation={presentation}
        inputSummary="Cartoon illustration: two celebrity-like figures (non-identifying, generic stars) standing side-by-side on a white carpet in front of a backdrop covered with venue logos."
      >
        <p className={styles.continuationCopy}>
          This page updates automatically. You can leave and come back without
          interrupting the work.
        </p>
      </CreationProgressExperience>
    </main>
  );
}
