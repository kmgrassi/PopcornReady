import { useState } from "react";
import { Button } from "../components/ui/Button";
import { ErrorState } from "../components/ui/StateCard";
import {
  type InspirationElement,
  type RandomStoryInspiration,
  useRandomStoryInspiration,
} from "../lib/inspiration";
import styles from "./InspirationPage.module.css";

const CATEGORY_LABELS: Record<keyof RandomStoryInspiration["elements"], string> = {
  plot: "Plot",
  setting: "Setting",
  arc: "Arc",
  antagonist: "Antagonist",
  theme: "Theme",
  stakes: "Stakes",
  structure: "Structure",
};

export function InspirationPage() {
  const [nonce, setNonce] = useState(0);
  const query = useRandomStoryInspiration(nonce);
  const inspiration = query.data?.inspiration ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Inspiration</p>
          <h1>Story generator</h1>
        </div>
        <Button
          variant="primary"
          onClick={() => setNonce((current) => current + 1)}
          disabled={query.isFetching}
        >
          {query.isFetching ? "Generating" : "Regenerate"}
        </Button>
      </header>

      {query.isLoading ? <InspirationSkeleton /> : null}

      {!query.isLoading && query.error ? (
        <ErrorState
          title="Unable to generate a story"
          body="The story element catalog could not be loaded."
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {inspiration ? <InspirationResult inspiration={inspiration} /> : null}
    </div>
  );
}

function InspirationResult({ inspiration }: { inspiration: RandomStoryInspiration }) {
  return (
    <>
      <section className={styles.loglinePanel} aria-label="Generated story">
        <p className={styles.formula}>{inspiration.formula}</p>
        <p className={styles.logline}>{inspiration.logline}</p>
      </section>

      <section className={styles.breakdown} aria-label="Story ingredients">
        {Object.entries(inspiration.elements).map(([key, elements]) => (
          <IngredientGroup
            key={key}
            label={CATEGORY_LABELS[key as keyof RandomStoryInspiration["elements"]]}
            elements={elements}
          />
        ))}
      </section>

      <dl className={styles.fields} aria-label="Formula fields">
        <Field label="Type of person" value={inspiration.typeOfPerson} />
        <Field label="Setting" value={inspiration.setting} />
        <Field label="External goal" value={inspiration.externalGoal} />
        <Field label="Antagonistic force" value={inspiration.antagonisticForce} />
        <Field label="Inner flaw or lie" value={inspiration.innerFlawOrLie} />
        <Field label="Old self" value={inspiration.oldSelf} />
        <Field label="New truth" value={inspiration.newTruth} />
        <Field label="Ending type" value={inspiration.endingType} />
      </dl>
    </>
  );
}

function IngredientGroup({
  label,
  elements,
}: {
  label: string;
  elements: InspirationElement[];
}) {
  return (
    <article className={styles.ingredient}>
      <h2>{label}</h2>
      <div className={styles.chips}>
        {elements.map((element) => (
          <span key={element.id} className={styles.chip}>
            {element.name}
          </span>
        ))}
      </div>
      <p>{elements.map((element) => element.coreIdea).filter(Boolean).join(" ")}</p>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.field}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function InspirationSkeleton() {
  return (
    <div className={styles.skeleton} aria-label="Loading inspiration">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
