import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api-client";
import { Button } from "../components/ui/Button";
import { ErrorState } from "../components/ui/StateCard";
import {
  type InspirationElement,
  type RandomStoryInspiration,
  type StoryConceptPoster,
  useRandomStoryInspiration,
  useStartInspirationStoryboardRunMutation,
  useStoryConceptPosterMutation,
} from "../lib/inspiration";
import { runProgressPath } from "../lib/quickStartRun";
import styles from "./InspirationPage.module.css";

type IngredientKey = keyof RandomStoryInspiration["elements"];

interface IngredientConfig {
  key: IngredientKey;
  label: string;
  summary: (inspiration: RandomStoryInspiration) => string;
}

const INGREDIENTS: IngredientConfig[] = [
  { key: "setting", label: "Setting", summary: (story) => story.setting },
  { key: "antagonist", label: "Antagonist", summary: (story) => story.antagonisticForce },
  { key: "stakes", label: "Stakes", summary: (story) => story.endingType },
  { key: "plot", label: "Plot", summary: (story) => story.externalGoal },
  { key: "arc", label: "Inner Change", summary: (story) => story.innerFlawOrLie },
  { key: "theme", label: "Theme", summary: (story) => story.newTruth },
  { key: "structure", label: "Structure", summary: (story) => story.oldSelf },
];

const ELEMENT_FIELD_PATCHES: Record<IngredientKey, (keyof RandomStoryInspiration)[]> = {
  plot: ["externalGoal"],
  setting: ["setting"],
  arc: ["innerFlawOrLie", "oldSelf", "newTruth"],
  antagonist: ["antagonisticForce"],
  theme: ["newTruth"],
  stakes: ["endingType"],
  structure: ["oldSelf"],
};

export function InspirationPage() {
  const navigate = useNavigate();
  const [nonce, setNonce] = useState(0);
  const [story, setStory] = useState<RandomStoryInspiration | null>(null);
  const [regeneratingKey, setRegeneratingKey] = useState<IngredientKey | null>(null);
  const query = useRandomStoryInspiration(nonce);
  const posterMutation = useStoryConceptPosterMutation();
  const startRunMutation = useStartInspirationStoryboardRunMutation();
  const storySignature = story ? conceptSignature(story) : null;

  useEffect(() => {
    if (query.data?.inspiration) {
      setStory(stripPoster(query.data.inspiration));
    }
  }, [query.data?.inspiration]);

  useEffect(() => {
    if (!story) return;
    posterMutation.reset();
    posterMutation.mutate(story, {
      onSuccess: ({ poster }) => {
        setStory((current) => (current ? { ...current, poster } : current));
      },
    });
  }, [storySignature]);

  const poster = story?.poster ?? posterMutation.data?.poster ?? null;

  async function regenerateIngredient(key: IngredientKey) {
    setRegeneratingKey(key);
    try {
      const response = await apiRequest<{ inspiration: RandomStoryInspiration }>(
        "/api/v1/inspiration/random",
        { headers: { "Cache-Control": "no-store" } }
      );
      setStory((current) =>
        current ? mergeIngredient(current, stripPoster(response.inspiration), key) : response.inspiration
      );
    } finally {
      setRegeneratingKey(null);
    }
  }

  async function startFromPrompt(inspiration: RandomStoryInspiration) {
    if (startRunMutation.isPending) return;
    try {
      const result = await startRunMutation.mutateAsync(inspiration);
      navigate(runProgressPath(result));
    } catch {
      // The mutation error is rendered below.
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Inspiration</p>
          <h1>Story generator</h1>
          <p className={styles.helper}>These are randomly generated story plots that you can use.</p>
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

      {story ? (
        <InspirationResult
          inspiration={story}
          poster={poster}
          posterError={posterMutation.error}
          posterGenerating={posterMutation.isPending}
          regeneratingKey={regeneratingKey}
          onRegenerateIngredient={(key) => void regenerateIngredient(key)}
          startingRun={startRunMutation.isPending}
          startRunError={
            startRunMutation.error instanceof Error
              ? startRunMutation.error.message
              : startRunMutation.error
                ? String(startRunMutation.error)
                : null
          }
          onStartFromPrompt={(inspiration) => void startFromPrompt(inspiration)}
        />
      ) : null}
    </div>
  );
}

function InspirationResult({
  inspiration,
  poster,
  posterError,
  posterGenerating,
  regeneratingKey,
  onRegenerateIngredient,
  startingRun,
  startRunError,
  onStartFromPrompt,
}: {
  inspiration: RandomStoryInspiration;
  poster: StoryConceptPoster | null;
  posterError: Error | null;
  posterGenerating: boolean;
  regeneratingKey: IngredientKey | null;
  onRegenerateIngredient: (key: IngredientKey) => void;
  startingRun: boolean;
  startRunError: string | null;
  onStartFromPrompt: (inspiration: RandomStoryInspiration) => void;
}) {
  return (
    <>
      <section className={styles.hero} aria-label="Generated story">
        <PosterPanel poster={poster} error={posterError} generating={posterGenerating} />
        <div className={styles.promptPanel}>
          <p className={styles.promptLabel}>Generated plot</p>
          <p className={styles.logline}>
            <HighlightedLogline inspiration={inspiration} />
          </p>
          <div className={styles.promptActions}>
            <Button
              variant="cta"
              onClick={() => onStartFromPrompt(inspiration)}
              isLoading={startingRun}
            >
              Start from this prompt
            </Button>
            {startRunError ? (
              <p className={styles.promptError}>{startRunError}</p>
            ) : null}
          </div>
        </div>
      </section>

      <details className={styles.drawer}>
        <summary>
          <span>Story ingredients</span>
          <span>{INGREDIENTS.length} sections</span>
        </summary>
        <div className={styles.breakdown}>
          {INGREDIENTS.map((ingredient) => (
            <IngredientGroup
              key={ingredient.key}
              label={ingredient.label}
              summary={ingredient.summary(inspiration)}
              elements={inspiration.elements[ingredient.key]}
              regenerating={regeneratingKey === ingredient.key}
              onRegenerate={() => onRegenerateIngredient(ingredient.key)}
            />
          ))}
        </div>
      </details>
    </>
  );
}

function PosterPanel({
  poster,
  error,
  generating,
}: {
  poster: StoryConceptPoster | null;
  error: Error | null;
  generating: boolean;
}) {
  if (poster?.url) {
    return <img className={styles.poster} src={poster.url} alt="Generated movie poster concept" />;
  }

  const status = error
    ? "Poster generation failed"
    : poster?.status === "failed"
      ? "Poster generation failed"
      : generating || poster?.status === "generating" || poster?.status === "queued"
        ? "Generating poster"
        : "Poster pending";

  return (
    <div className={`${styles.poster} ${styles.posterEmpty}`} aria-live="polite">
      <span>{status}</span>
    </div>
  );
}

function HighlightedLogline({ inspiration }: { inspiration: RandomStoryInspiration }) {
  const parts = useMemo(
    () => [
      { value: inspiration.typeOfPerson, className: styles.person },
      { value: inspiration.setting, className: styles.setting },
      { value: inspiration.externalGoal, className: styles.goal },
      { value: inspiration.antagonisticForce, className: styles.antagonist },
      { value: inspiration.innerFlawOrLie, className: styles.flaw },
      { value: inspiration.oldSelf, className: styles.oldSelf },
      { value: inspiration.newTruth, className: styles.truth },
      { value: inspiration.endingType, className: styles.ending },
    ],
    [inspiration]
  );

  return <>{highlightText(inspiration.logline, parts)}</>;
}

function highlightText(
  text: string,
  highlights: { value: string; className: string }[]
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length) {
    const match = highlights
      .map((highlight) => ({
        ...highlight,
        index: remaining.toLowerCase().indexOf(highlight.value.toLowerCase()),
      }))
      .filter((highlight) => highlight.value && highlight.index >= 0)
      .sort((a, b) => a.index - b.index || b.value.length - a.value.length)[0];

    if (!match) {
      nodes.push(remaining);
      break;
    }

    if (match.index > 0) nodes.push(remaining.slice(0, match.index));
    const value = remaining.slice(match.index, match.index + match.value.length);
    nodes.push(
      <mark key={`${match.value}-${key}`} className={`${styles.highlight} ${match.className}`}>
        {value}
      </mark>
    );
    key += 1;
    remaining = remaining.slice(match.index + match.value.length);
  }

  return nodes;
}

function IngredientGroup({
  label,
  summary,
  elements,
  regenerating,
  onRegenerate,
}: {
  label: string;
  summary: string;
  elements: InspirationElement[];
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  return (
    <article className={styles.ingredient}>
      <div className={styles.ingredientHeader}>
        <div>
          <h2>{label}</h2>
          <p>{summary}</p>
        </div>
        <Button variant="secondary" onClick={onRegenerate} disabled={regenerating}>
          {regenerating ? "Regenerating" : "Regenerate"}
        </Button>
      </div>
      <div className={styles.chips}>
        {elements.map((element) => (
          <span key={element.id} className={styles.chip}>
            {element.name}
          </span>
        ))}
      </div>
      <p className={styles.coreIdea}>
        {elements.map((element) => element.coreIdea).filter(Boolean).join(" ")}
      </p>
    </article>
  );
}

function mergeIngredient(
  current: RandomStoryInspiration,
  next: RandomStoryInspiration,
  key: IngredientKey
): RandomStoryInspiration {
  const merged = {
    ...current,
    poster: undefined,
    elements: {
      ...current.elements,
      [key]: next.elements[key],
    },
  };

  for (const field of ELEMENT_FIELD_PATCHES[key]) {
    const value = next[field];
    if (typeof value === "string") {
      (merged as Record<string, unknown>)[field] = value;
    }
  }

  return {
    ...merged,
    logline: buildLogline(merged),
  };
}

function buildLogline(story: RandomStoryInspiration): string {
  return (
    `A ${story.typeOfPerson} in ${story.setting} wants to ${story.externalGoal}, ` +
    `but ${story.antagonisticForce} blocks them. To succeed, they must overcome ` +
    `${story.innerFlawOrLie} and choose between ${story.oldSelf} and "${story.newTruth}", ` +
    `leading to ${story.endingType}.`
  );
}

function stripPoster(inspiration: RandomStoryInspiration): RandomStoryInspiration {
  return { ...inspiration, poster: undefined };
}

function conceptSignature(inspiration: RandomStoryInspiration): string {
  const elementSignature = Object.entries(inspiration.elements)
    .flatMap(([key, elements]) =>
      elements.map((element, index) => `${key}:${index}:${element.id}`)
    )
    .sort()
    .join("|");
  return [
    elementSignature,
    inspiration.typeOfPerson,
    inspiration.setting,
    inspiration.externalGoal,
    inspiration.antagonisticForce,
    inspiration.innerFlawOrLie,
    inspiration.oldSelf,
    inspiration.newTruth,
    inspiration.endingType,
  ].join("|");
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
