import { PageHeader } from "../components/ui/PageHeader";
import { ButtonLink } from "../components/ui/Button";
import { EmptyState } from "../components/ui/StateCard";
import styles from "./AnchorsMinePage.module.css";

export function AnchorsMinePage() {
  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Anchors"
        title="Published anchors"
        description="Manage the starting points you have published from assets and stories."
        action={
          <ButtonLink variant="secondary" to="/library/assets">
            Find assets
          </ButtonLink>
        }
      />

      <EmptyState
        title="Catalog publishing is waiting on the API"
        body="The publish controls are in place, but the catalog endpoints need to land before entries can be listed here."
        action={<ButtonLink variant="secondary" to="/library/assets">Open assets</ButtonLink>}
      />
    </main>
  );
}
