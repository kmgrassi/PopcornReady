import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { ErrorState } from "../components/ui/StateCard";
import {
  type InspirationElement,
  type InspirationIngredientGroup,
  type RandomStoryInspiration,
  type StoryConceptPoster,
  useRandomStoryInspiration,
  useStartInspirationStoryboardRunMutation,
  useStoryConceptPosterMutation,
} from "../lib/inspiration";
import { runProgressPath } from "../lib/quickStartRun";
import styles from "./InspirationPage.module.css";

interface IngredientConfig {
  key: InspirationIngredientGroup;
  label: string;
}

const INGREDIENTS: IngredientConfig[] = [
  { key: "setting", label: "Setting" },
  { key: "antagonist", label: "Antagonist" },
  { key: "stakes", label: "Stakes" },
  { key: "plot", label: "Plot" },
  { key: "arc", label: "Inner Change" },
  { key: "theme", label: "Theme" },
  { key: "structure", label: "Structure" },
];

const DISABLE_LOCAL_POSTER_GENERATION = import.meta.env.DEV;

export function InspirationPage() {
  const navigate = useNavigate();
  const [nonce, setNonce] = useState(0);
  const [story, setStory] = useState<RandomStoryInspiration | null>(null);
  const [visualTheme, setVisualTheme] = useState<"classic" | "cinema">("classic");
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
    if (DISABLE_LOCAL_POSTER_GENERATION) return;
    posterMutation.mutate(story, {
      onSuccess: ({ movieTitle, poster }) => {
        setStory((current) => (current ? { ...current, movieTitle, poster } : current));
      },
    });
  }, [storySignature]);

  const poster = story?.poster ?? posterMutation.data?.poster ?? null;

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
    <div
      className={`${styles.page} ${visualTheme === "cinema" ? styles.cinemaTheme : ""}`}
      data-inspiration-theme={visualTheme}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Inspiration</p>
          <h1>Story generator</h1>
          <p className={styles.helper}>
            AI-ranked story plots built from a random mix of story ingredients.
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.themeToggle} aria-label="Inspiration page theme">
            <button
              type="button"
              className={visualTheme === "classic" ? styles.themeToggleActive : undefined}
              onClick={() => setVisualTheme("classic")}
              aria-pressed={visualTheme === "classic"}
            >
              Classic
            </button>
            <button
              type="button"
              className={visualTheme === "cinema" ? styles.themeToggleActive : undefined}
              onClick={() => setVisualTheme("cinema")}
              aria-pressed={visualTheme === "cinema"}
            >
              Cinema
            </button>
          </div>
          <Button
            variant="primary"
            onClick={() => setNonce((current) => current + 1)}
            disabled={query.isFetching}
            className={styles.primaryAction}
          >
            {query.isFetching ? "Generating" : "Regenerate"}
          </Button>
        </div>
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
          posterDisabled={DISABLE_LOCAL_POSTER_GENERATION}
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
  posterDisabled,
  startingRun,
  startRunError,
  onStartFromPrompt,
}: {
  inspiration: RandomStoryInspiration;
  poster: StoryConceptPoster | null;
  posterError: Error | null;
  posterGenerating: boolean;
  posterDisabled: boolean;
  startingRun: boolean;
  startRunError: string | null;
  onStartFromPrompt: (inspiration: RandomStoryInspiration) => void;
}) {
  const emojiSet = INGREDIENTS.map((ingredient) => inspiration.ingredients[ingredient.key]?.emoji)
    .filter(Boolean);

  return (
    <>
      <section className={styles.hero} aria-label="Generated story">
        <PosterPanel
          poster={poster}
          error={posterError}
          generating={posterGenerating}
          disabled={posterDisabled}
        />
        <div className={styles.promptPanel}>
          <p className={styles.promptLabel}>Generated plot</p>
          {inspiration.movieTitle ? (
            <h2 className={styles.movieTitle}>{inspiration.movieTitle}</h2>
          ) : null}
          {emojiSet.length ? (
            <div className={styles.emojiRow} aria-hidden="true">
              {emojiSet.map((emoji, index) => (
                <span key={`${emoji}-${index}`}>{emoji}</span>
              ))}
            </div>
          ) : null}
          <Logline logline={inspiration.logline} />
          {inspiration.premise ? (
            <p className={styles.premise}>{inspiration.premise}</p>
          ) : null}
          <div className={styles.promptActions}>
            <Button
              variant="cta"
              onClick={() => onStartFromPrompt(inspiration)}
              isLoading={startingRun}
              className={styles.ctaAction}
            >
              Turn this into a video
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
              emoji={inspiration.ingredients[ingredient.key]?.emoji ?? ""}
              summary={inspiration.ingredients[ingredient.key]?.summary ?? ""}
              elements={inspiration.elements[ingredient.key]}
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
  disabled,
}: {
  poster: StoryConceptPoster | null;
  error: Error | null;
  generating: boolean;
  disabled: boolean;
}) {
  if (poster?.url) {
    return <img className={styles.poster} src={poster.url} alt="Generated movie poster concept" />;
  }

  const isGenerating = generating || poster?.status === "generating" || poster?.status === "queued";
  const status = error
    ? "Poster generation failed"
    : disabled
      ? "Poster disabled locally"
      : poster?.status === "failed"
        ? "Poster generation failed"
        : isGenerating
          ? "Generating poster"
          : "Poster pending";

  return (
    <div
      className={`${styles.poster} ${styles.posterEmpty}`}
      aria-live={isGenerating ? undefined : "polite"}
    >
      {isGenerating ? (
        <Spinner size="lg" label={status} className={styles.posterSpinner} />
      ) : (
        <span>{status}</span>
      )}
    </div>
  );
}

function Logline({ logline }: { logline: string }) {
  const sentences = useMemo(() => splitSentences(logline), [logline]);
  return (
    <div className={styles.logline}>
      {sentences.map((sentence, index) => (
        <p className={styles.loglineSentence} key={`${sentence}-${index}`}>
          {sentence}
        </p>
      ))}
    </div>
  );
}

function splitSentences(text: string): string[] {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  return normalized.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)?.map((part) => part.trim()) ?? [
    normalized,
  ];
}

function IngredientGroup({
  label,
  emoji,
  summary,
  elements,
}: {
  label: string;
  emoji: string;
  summary: string;
  elements: InspirationElement[];
}) {
  return (
    <article className={styles.ingredient}>
      <div className={styles.ingredientHeader}>
        <div>
          <h2>
            {emoji ? <span className={styles.ingredientEmoji}>{emoji}</span> : null} {label}
          </h2>
          {summary ? <p>{summary}</p> : null}
        </div>
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
  return [elementSignature, inspiration.logline].join("|");
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
