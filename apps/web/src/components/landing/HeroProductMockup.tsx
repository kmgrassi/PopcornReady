import { StatusChecklist } from "../ui/StatusChecklist";
import type { ChecklistItem } from "../ui/StatusChecklist";
import styles from "./HeroProductMockup.module.css";

const CHECKPOINTS: ChecklistItem[] = [
  {
    id: "scene-plan",
    label: "Scene plan",
    status: "done",
    detail: "Five beats with continuity notes",
  },
  {
    id: "keyframes",
    label: "Keyframes",
    status: "done",
    detail: "Product, founder, and close-up frames",
  },
  {
    id: "clips",
    label: "Clips",
    status: "active",
    detail: "Generating the weak-shot replacement",
  },
  {
    id: "continuity",
    label: "Continuity",
    status: "pending",
    detail: "Pending critic pass",
  },
  {
    id: "review",
    label: "Ready for review",
    status: "pending",
    detail: "Final cut checkpoint",
  },
];

export function HeroProductMockup() {
  return (
    <aside
      className={styles.mockup}
      aria-label="Example Popcorn Ready production workflow"
    >
      <div className={styles.promptPanel}>
        <span className={styles.panelLabel}>Prompt</span>
        <p>
          Make a launch video for a neighborhood bakery's midnight cookie menu.
          Keep it warm, close-up, and social-first.
        </p>
        <div className={styles.promptMeta}>
          <span>30 sec</span>
          <span>Vertical</span>
        </div>
      </div>

      <div className={styles.previewPanel}>
        <div className={styles.previewHeader}>
          <span>Plan to preview</span>
          <strong>Autonomous run</strong>
        </div>
        <div className={styles.previewFrame} aria-hidden="true">
          <div className={styles.videoSurface}>
            <div className={styles.playhead} />
            <div className={styles.captionStrip}>Fresh at midnight</div>
          </div>
        </div>
        <ol className={styles.timeline} aria-label="Example structured timeline">
          <li>Hook</li>
          <li>Close-up</li>
          <li>Offer</li>
          <li>CTA</li>
        </ol>
      </div>

      <div className={styles.checkpointPanel}>
        <span className={styles.panelLabel}>Checkpoints</span>
        <StatusChecklist items={CHECKPOINTS} className={styles.checklist} />
      </div>
    </aside>
  );
}
