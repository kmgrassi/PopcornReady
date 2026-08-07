import { Navigate, useLocation } from "react-router-dom";
import { ButtonLink } from "../components/ui/Button";
import { readCreationDraft } from "../lib/creationReview";
import styles from "./CreateLauncherPage.module.css";

export function CreateLauncherPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const isLegacyAssetLink =
    params.has("projectId") ||
    params.has("runId") ||
    Boolean(readCreationDraft(location.state));

  if (isLegacyAssetLink) {
    return (
      <Navigate
        to={`/create/asset${location.search}`}
        replace
        state={location.state}
      />
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>What do you want to make?</h1>
        <p>
          Start with the finished outcome. Popcorn Ready will keep the planning,
          media, and review work connected to the right project.
        </p>
      </header>

      <section className={styles.options} aria-label="Creation options">
        <article className={styles.fullVideo}>
          <div className={styles.optionCopy}>
            <h2>Full video</h2>
            <p>
              Turn an idea or source footage into a planned, storyboarded, and
              assembled video.
            </p>
            <ul>
              <li>Shape the story and creative direction</li>
              <li>Review the storyboard before production</li>
              <li>Finish with a complete cut</li>
            </ul>
          </div>
          <ButtonLink variant="cta" size="lg" to="/projects/new">
            Start a full video
          </ButtonLink>
        </article>

        <article className={styles.projectAsset}>
          <div className={styles.optionCopy}>
            <h2>Script</h2>
            <p>
              Develop the story arc and plot points, then write and review a complete draft.
            </p>
          </div>
          <ButtonLink variant="secondary" size="lg" to="/create/script">
            Start a script
          </ButtonLink>
        </article>
        <article className={styles.projectAsset}>
          <div className={styles.optionCopy}>
            <h2>Single asset</h2>
            <p>Make one image, short video, or audio asset for a project.</p>
          </div>
          <ButtonLink variant="secondary" size="lg" to="/create/asset">
            Create an asset
          </ButtonLink>
        </article>
      </section>
    </div>
  );
}
