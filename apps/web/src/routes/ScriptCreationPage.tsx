import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { VideoBriefInput } from "@popcorn/shared/v1/types";
import { Button } from "../components/ui/Button";
import { useCreateProjectMutation } from "../lib/queryClient";
import { v1Api } from "../lib/api-client";
import styles from "./ScriptCreationPage.module.css";

const lengths = [
  { seconds: 60, label: "1 minute", hint: "A focused scene" },
  { seconds: 180, label: "3 minutes", hint: "A short story" },
  { seconds: 300, label: "5 minutes", hint: "A fuller arc" },
  { seconds: 600, label: "10 minutes", hint: "A short film" },
] as const;

export function ScriptCreationPage() {
  const navigate = useNavigate();
  const createProject = useCreateProjectMutation({ notifications: false });
  const [idea, setIdea] = useState("");
  const [direction, setDirection] = useState("");
  const [targetLengthSec, setTargetLengthSec] = useState(180);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const starting = useRef(false);

  async function start() {
    if (!idea.trim() || starting.current) return;
    starting.current = true;
    setIsStarting(true);
    setError(null);
    const brief: VideoBriefInput = {
      goal: idea.trim(),
      targetLengthSec,
      aspectRatio: "16:9",
      platform: "general",
      format: "visual_reveal",
      style: direction.trim() || "character-led, emotionally specific",
      narration: { mode: "generate" },
    };
    try {
      const created = await createProject.mutateAsync({
        brief,
        namingPrompt: idea.trim().slice(0, 500),
        namingContext: "script",
      });
      if (!created.briefVersion?.id) throw new Error("The script brief was not saved.");
      const { runId } = await v1Api.startScriptGenerationRun(created.project.id, {
        briefVersionId: created.briefVersion.id,
      });
      if (!runId) throw new Error("The writing run did not start.");
      navigate(`/projects/${encodeURIComponent(created.project.id)}/runs/${encodeURIComponent(runId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the script.");
      starting.current = false;
      setIsStarting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.step}>Story idea <span>→</span> Story outline <span>→</span> Script</p>
        <h1>Create a script</h1>
        <p>Tell us the story. The Creative Director will shape the arc and plot points, then write the complete first draft for your review.</p>
      </header>

      <section className={styles.workspace}>
        <label className={styles.field}>
          <span>What is the story?</span>
          <textarea
            autoFocus
            value={idea}
            maxLength={4000}
            onChange={(event) => setIdea(event.target.value)}
            placeholder="A coming-of-age story set after AI abundance, following a teenager who discovers what earlier generations had to overcome…"
          />
        </label>

        <fieldset className={styles.lengths}>
          <legend>Approximate script length</legend>
          <div>
            {lengths.map((length) => (
              <label key={length.seconds}>
                <input
                  type="radio"
                  name="script-length"
                  checked={targetLengthSec === length.seconds}
                  onChange={() => setTargetLengthSec(length.seconds)}
                />
                <strong>{length.label}</strong>
                <small>{length.hint}</small>
              </label>
            ))}
          </div>
        </fieldset>

        <details className={styles.direction}>
          <summary>Add writing direction</summary>
          <label className={styles.field}>
            <span>Tone, genre, audience, or constraints</span>
            <textarea
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
              placeholder="Hopeful science fiction with grounded family relationships. Avoid exposition-heavy dialogue."
            />
          </label>
        </details>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <p>No footage or media will be generated. You’ll review the outline and script together.</p>
          <Button variant="cta" size="lg" disabled={!idea.trim()} isLoading={isStarting} onClick={() => void start()}>
            Develop story
          </Button>
        </div>
      </section>
    </main>
  );
}
