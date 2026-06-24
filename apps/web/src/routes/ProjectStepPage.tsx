import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import type {
  BoardRevisionTarget,
  ProjectStoryboard,
  V1Project,
  VideoBriefInput,
} from "@popcorn/shared/v1/types";
import { AiAssetFeedbackDialog } from "../components/ai-edit/AiAssetFeedbackDialog";
import { ButtonLink } from "../components/ui/Button";
import { ImageWithSkeleton } from "../components/ui/ImageWithSkeleton";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import { useProjectQuery, useProjectStoryboardQuery } from "../lib/queryClient";
import { v1Api } from "../lib/api-client";
import styles from "./ProjectStepPage.module.css";

type ProjectStep = "concept" | "brief" | "script";
type EditableScope = Extract<BoardRevisionTarget["scope"], "concept" | "brief" | "script">;

interface FieldItem {
  id: string;
  label: string;
  value: string | null;
  scope: EditableScope;
  kind?: "poster" | "text";
  target?: Partial<BoardRevisionTarget>;
}

interface ActiveEdit {
  item: FieldItem;
  title: string;
  subtitle: string;
}

const STEP_COPY: Record<ProjectStep, { title: string; eyebrow: string; description: string }> = {
  concept: {
    title: "Concept",
    eyebrow: "Project concept",
    description: "Review the project idea, format, aspect, length, and poster.",
  },
  brief: {
    title: "Brief",
    eyebrow: "Project direction",
    description: "Review the prompt, audience, style, hook, payoff, and creative constraints.",
  },
  script: {
    title: "Script",
    eyebrow: "Narration and dialogue",
    description: "Review the narration script or beat-level spoken moments.",
  },
};

export function ProjectStepPage({ step }: { step: ProjectStep }) {
  const { projectId } = useParams();
  const projectQuery = useProjectQuery(projectId ?? "", Boolean(projectId));
  const storyboardQuery = useProjectStoryboardQuery(
    projectId ?? "",
    Boolean(projectId && step === "script")
  );
  const [activeEdit, setActiveEdit] = useState<ActiveEdit | null>(null);
  const [pending, setPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [sentLabel, setSentLabel] = useState<string | null>(null);

  const project = projectQuery.data?.project ?? null;
  const storyboard = storyboardQuery.data?.storyboard ?? null;
  const copy = STEP_COPY[step];
  const fields = useMemo(() => {
    if (!project) return [];
    if (step === "concept") return conceptFields(project);
    if (step === "brief") return briefFields(project.brief ?? null);
    return scriptFields(project, storyboard);
  }, [project, step, storyboard]);

  if (!projectId) return <Navigate to="/library/projects" replace />;

  const loading = projectQuery.isLoading || (step === "script" && storyboardQuery.isLoading);
  const error = projectQuery.error ?? (step === "script" ? storyboardQuery.error : null);

  async function submitEdit(message: string) {
    if (!activeEdit || !projectId) return;
    setPending(true);
    setEditError(null);
    try {
      await v1Api.createProjectAssetRevision(projectId, {
        message,
        target: editTarget(activeEdit.item, project?.brief ?? null),
      });
      setSentLabel(activeEdit.item.label);
      setActiveEdit(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} to={`/projects/${encodeURIComponent(projectId)}`}>
            {project?.name ?? "Project"}
          </Link>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <div className={styles.headerActions}>
          <ButtonLink
            variant="secondary"
            to={`/projects/${encodeURIComponent(projectId)}/concept`}
          >
            Concept
          </ButtonLink>
          <ButtonLink
            variant="secondary"
            to={`/projects/${encodeURIComponent(projectId)}/brief`}
          >
            Brief
          </ButtonLink>
          <ButtonLink
            variant="secondary"
            to={`/projects/${encodeURIComponent(projectId)}/script`}
          >
            Script
          </ButtonLink>
          <ButtonLink
            variant="secondary"
            to={`/projects/${encodeURIComponent(projectId)}/storyboard`}
          >
            Storyboard
          </ButtonLink>
        </div>
      </header>

      {loading ? <div className={styles.summary}>Loading {copy.title.toLowerCase()}...</div> : null}

      {!loading && error ? (
        <ErrorState
          title={`Unable to load ${copy.title.toLowerCase()}`}
          body="We couldn't load this project step."
          error={error}
          onRetry={() => {
            void projectQuery.refetch();
            if (step === "script") void storyboardQuery.refetch();
          }}
        />
      ) : null}

      {!loading && !error && project ? (
        <div className={styles.layout}>
          <StepSummary
            project={project}
            step={step}
            storyboard={storyboard}
            onEdit={(item) => {
              setEditError(null);
              setSentLabel(null);
              setActiveEdit({
                item,
                title: `Edit ${item.label}`,
                subtitle: `${copy.eyebrow} - ${item.label}`,
              });
            }}
          />
          <section className={styles.fieldGrid} aria-label={`${copy.title} editable objects`}>
            {sentLabel ? (
              <p className={styles.sent} role="status">
                Sent {sentLabel} feedback to the agent. The run will update this project in context.
              </p>
            ) : null}
            {fields.length > 0 ? (
              fields.map((field) => (
                <FieldButton
                  item={field}
                  key={field.id}
                  onClick={() => {
                    setEditError(null);
                    setSentLabel(null);
                    setActiveEdit({
                      item: field,
                      title: `Edit ${field.label}`,
                      subtitle: `${copy.eyebrow} - ${field.label}`,
                    });
                  }}
                />
              ))
            ) : (
              <EmptyState
                title={`No ${copy.title.toLowerCase()} content yet`}
                body="This step will become editable once the agent has produced content for it."
              />
            )}
          </section>
        </div>
      ) : null}

      <AiAssetFeedbackDialog
        open={Boolean(activeEdit)}
        title={activeEdit?.title ?? "Edit with AI"}
        subtitle={activeEdit?.subtitle}
        pending={pending}
        error={editError}
        onClose={() => {
          if (!pending) setActiveEdit(null);
        }}
        onSubmit={submitEdit}
        asset={activeEdit ? <EditPreview item={activeEdit.item} project={project} /> : null}
      />
    </main>
  );
}

function StepSummary({
  project,
  step,
  storyboard,
  onEdit,
}: {
  project: V1Project;
  step: ProjectStep;
  storyboard: ProjectStoryboard | null;
  onEdit: (item: FieldItem) => void;
}) {
  const brief = project.brief;
  const scriptCount = storyboardScriptLines(storyboard).length;
  const posterItem = conceptFields(project).find((field) => field.id === "poster");

  return (
    <aside className={styles.summary}>
      {step === "concept" && posterItem ? (
        <button
          type="button"
          className={styles.posterButton}
          onClick={() => onEdit(posterItem)}
          aria-label="Movie poster"
        >
          <Poster project={project} />
          <span className={styles.posterHint}>Movie poster</span>
        </button>
      ) : null}
      <div>
        <span className={styles.backLink}>{STEP_COPY[step].eyebrow}</span>
        <h2>{step === "concept" ? brief?.oneBigIdea ?? project.name : project.name}</h2>
        <p>{summaryText(project, step, storyboard)}</p>
      </div>
      <dl className={styles.metaList}>
        <div>
          <dt>Length</dt>
          <dd>{formatDuration(brief?.targetLengthSec) ?? "Unset"}</dd>
        </div>
        <div>
          <dt>Aspect</dt>
          <dd>{brief?.aspectRatio ?? "Unset"}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{brief?.format ?? "Unset"}</dd>
        </div>
        {step === "script" ? (
          <div>
            <dt>Lines</dt>
            <dd>{brief?.narration?.script ? "1" : String(scriptCount)}</dd>
          </div>
        ) : null}
      </dl>
    </aside>
  );
}

function FieldButton({ item, onClick }: { item: FieldItem; onClick: () => void }) {
  return (
    <button type="button" className={styles.fieldButton} onClick={onClick}>
      <span className={styles.fieldTopline}>
        <span>{item.label}</span>
        <span>Request Changes</span>
      </span>
      <p className={`${styles.fieldValue} ${item.value ? "" : styles.emptyValue}`}>
        {item.value || "Not set"}
      </p>
    </button>
  );
}

function EditPreview({ item, project }: { item: FieldItem; project: V1Project | null }) {
  if (item.kind === "poster" && project) {
    return (
      <div className={styles.modalPreview}>
        {project.posterUrl ? (
          <img className={styles.modalPoster} src={project.posterUrl} alt="" />
        ) : (
          <Poster project={project} />
        )}
      </div>
    );
  }

  return (
    <dl className={styles.modalPreview}>
      <div>
        <dt>{item.label}</dt>
        <dd>{item.value || "Not set"}</dd>
      </div>
    </dl>
  );
}

function Poster({ project }: { project: V1Project }) {
  if (project.posterUrl) {
    return <ImageWithSkeleton className={styles.poster} src={project.posterUrl} alt="" />;
  }
  return (
    <div className={styles.posterEmpty} aria-hidden="true">
      <span>{project.name.trim().charAt(0).toUpperCase() || "?"}</span>
    </div>
  );
}

function editTarget(
  item: FieldItem,
  currentBrief: VideoBriefInput | null
): BoardRevisionTarget {
  return {
    scope: item.scope,
    fieldId: item.id,
    label: item.label,
    currentValue: item.value ?? "",
    ...(currentBrief ? { currentBrief } : {}),
    ...item.target,
  };
}

function conceptFields(project: V1Project): FieldItem[] {
  const brief = project.brief;
  const posterTarget: Partial<BoardRevisionTarget> = {};
  if (project.posterAssetId) posterTarget.assetId = project.posterAssetId;

  return [
    {
      id: "poster",
      label: "Movie poster",
      value: project.posterUrl ?? null,
      scope: "concept",
      kind: "poster",
      target: posterTarget,
    },
    { id: "oneBigIdea", label: "Big idea", value: brief?.oneBigIdea ?? null, scope: "concept" },
    { id: "goal", label: "Prompt", value: brief?.goal ?? null, scope: "concept" },
    {
      id: "strongestVisual",
      label: "Strongest visual",
      value: brief?.strongestVisual ?? null,
      scope: "concept",
    },
    {
      id: "targetLengthSec",
      label: "Length",
      value: formatDuration(brief?.targetLengthSec),
      scope: "concept",
    },
    { id: "aspectRatio", label: "Aspect ratio", value: brief?.aspectRatio ?? null, scope: "concept" },
    { id: "format", label: "Format", value: brief?.format ?? null, scope: "concept" },
    { id: "platform", label: "Platform", value: brief?.platform ?? null, scope: "concept" },
  ];
}

function briefFields(brief: VideoBriefInput | null): FieldItem[] {
  if (!brief) return [];
  return [
    { id: "goal", label: "Prompt", value: brief.goal, scope: "brief" },
    { id: "audience", label: "Audience", value: brief.audience ?? null, scope: "brief" },
    { id: "style", label: "Style", value: brief.style ?? null, scope: "brief" },
    { id: "format", label: "Format", value: brief.format ?? null, scope: "brief" },
    { id: "platform", label: "Platform", value: brief.platform ?? null, scope: "brief" },
    { id: "hookQuestion", label: "Hook", value: brief.hookQuestion ?? null, scope: "brief" },
    { id: "payoff", label: "Payoff", value: brief.payoff ?? null, scope: "brief" },
    { id: "caveat", label: "Caveat", value: brief.caveat ?? null, scope: "brief" },
    {
      id: "callToAction",
      label: "Call to action",
      value: brief.constraints?.callToAction ?? null,
      scope: "brief",
    },
    {
      id: "requiredBeats",
      label: "Required beats",
      value: brief.constraints?.requiredBeats?.join("\n") ?? null,
      scope: "brief",
    },
    {
      id: "forbiddenClaims",
      label: "Forbidden claims",
      value: brief.constraints?.forbiddenClaims?.join("\n") ?? null,
      scope: "brief",
    },
    {
      id: "brandVoice",
      label: "Brand voice",
      value: brief.constraints?.brandVoice ?? null,
      scope: "brief",
    },
  ];
}

function scriptFields(project: V1Project, storyboard: ProjectStoryboard | null): FieldItem[] {
  const narrationScript = project.brief?.narration?.script?.trim();
  if (narrationScript) {
    return [
      {
        id: "narration.script",
        label: "Narration script",
        value: narrationScript,
        scope: "script",
      },
    ];
  }
  return storyboardScriptLines(storyboard).map((line) => ({
    id: line.id,
    label: line.label,
    value: line.text,
    scope: "script",
    target: line.target,
  }));
}

function storyboardScriptLines(storyboard: ProjectStoryboard | null) {
  if (!storyboard) return [];
  return storyboard.scenes.flatMap((scene) =>
    scene.beats.flatMap((beat) => {
      const text = beat.narration?.trim() || beat.dialogueSummary?.trim();
      if (!text) return [];
      return [
        {
          id: beat.id,
          label: `Scene ${scene.sceneIndex + 1}, beat ${beat.beatIndex + 1}`,
          text,
          target: {
            storyboardId: storyboard.id,
            sceneId: scene.id,
            beatId: beat.id,
          },
        },
      ];
    })
  );
}

function summaryText(project: V1Project, step: ProjectStep, storyboard: ProjectStoryboard | null) {
  if (step === "concept") {
    return project.brief?.strongestVisual ?? project.brief?.goal ?? "No concept details yet.";
  }
  if (step === "brief") {
    return project.brief?.goal ?? "No brief has been saved for this project yet.";
  }
  const narrationScript = project.brief?.narration?.script?.trim();
  if (narrationScript) return narrationScript;
  const firstLine = storyboardScriptLines(storyboard)[0]?.text;
  return firstLine ?? "No script or narrated storyboard moments are ready yet.";
}

function formatDuration(seconds?: VideoBriefInput["targetLengthSec"]) {
  if (!Number.isFinite(seconds)) return null;
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
