import { useState } from "react";
import type { Clip, Project, Timeline, TimelineSegment } from "@popcorn/shared/types";
import { DEFAULT_DURATION_POLICY } from "@popcorn/shared/audio-alignment";
import {
  GENERATION_STAGE_LABELS,
  type BoardRevisionTarget,
  type GenerationStage,
} from "@popcorn/shared/v1/types";
import { RerunProposalDialog } from "../ai-edit/RerunProposalDialog";
import { cutSelectionRerunTarget } from "../../lib/rerunTargets";
import { Button } from "../ui/Button";
import { PreviewPanel } from "../editor/PreviewPanel";
import { PreviewPlayer } from "../PreviewPlayer";
import { TimelinePanel } from "./TimelinePanel";
import type { BriefDraft } from "./useStudioFlow";
import styles from "./ReviewStep.module.css";

interface ReviewStepProps {
  draft: BriefDraft;
  projectId: string;
  rootRunId?: string | null;
  project: Project | null | undefined;
  timeline: Timeline | null | undefined;
  timelineId?: string;
  clips: Clip[];
  stages: GenerationStage[];
  segmentNotes: Record<string, string>;
  loading: boolean;
  error?: string;
  onSegmentChange(segmentId: string, patch: Partial<TimelineSegment>): void;
  onSegmentNoteChange(segmentId: string, note: string): void;
  onExport(): void;
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function timelineDuration(timeline: Timeline | null | undefined) {
  if (!timeline) return 0;
  return timeline.segments.reduce(
    (total, segment) => total + Math.max(0, segment.sourceOutSec - segment.sourceInSec),
    0,
  );
}

function statusLabel(status: GenerationStage["status"]) {
  return status.replace(/_/g, " ");
}

export function ReviewStep({
  draft,
  projectId,
  rootRunId,
  project,
  timeline,
  timelineId,
  clips,
  stages,
  segmentNotes,
  loading,
  error,
  onSegmentChange,
  onSegmentNoteChange,
  onExport,
}: ReviewStepProps) {
  const [note, setNote] = useState("");
  const [proposalOpen, setProposalOpen] = useState(false);
  const [targetSegmentId, setTargetSegmentId] = useState("whole_cut");
  const hasTimeline = !!timeline && timeline.segments.length > 0;
  const selectedSegment =
    targetSegmentId === "whole_cut"
      ? null
      : timeline?.segments.find((segment) => segment.id === targetSegmentId) ?? null;
  const proposalTarget: BoardRevisionTarget | null = selectedSegment
    ? selectedSegment.beatId
      ? {
          scope: "tile",
          runId: rootRunId ?? undefined,
          beatId: selectedSegment.beatId,
          label: selectedSegment.role,
        }
      : null
    : null;
  const directProposalTarget =
    !selectedSegment && timelineId
      ? cutSelectionRerunTarget(projectId)
      : null;
  const completedStages = [...stages]
    .sort((left, right) => left.order - right.order)
    .filter((stage) => stage.status === "succeeded" || stage.completedAt || stage.reviewedAt);
  const summaryItems = [
    { label: "Goal", value: project?.goal || draft.goal },
    { label: "Hook", value: draft.hook || project?.storyContext?.hookQuestion },
    {
      label: "Format",
      value: [draft.format, draft.platform, draft.aspectRatio].filter(Boolean).join(" · "),
    },
    {
      label: "Cut length",
      value: hasTimeline ? formatDuration(timelineDuration(timeline)) : `${draft.targetLengthSec}s target`,
    },
  ].filter((item) => item.value);

  return (
    <section className={styles.review} aria-labelledby="studio-review-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Review & edit</p>
          <h2 id="studio-review-heading" className={styles.heading}>
            Your rough cut is ready
          </h2>
          {project?.goal ? (
            <p className={styles.planRecap}>{project.goal}</p>
          ) : null}
          <p className={styles.headerCopy}>
            Review the cut in the same workspace, then send whole-cut or beat-level
            feedback before export.
          </p>
        </div>
        <Button variant="cta" onClick={onExport} disabled={!hasTimeline}>
          Continue to export
        </Button>
      </header>

      {loading ? <p className="muted">Loading the generated timeline...</p> : null}
      {error ? <p className="new-project-error">{error}</p> : null}

      <div className={styles.continuityGrid} aria-label="Plan and stage history">
        <article className={styles.contextCard}>
          <div className={styles.cardHeader}>
            <p className={styles.cardEyebrow}>Plan recap</p>
            <strong>Approved direction</strong>
          </div>
          <dl className={styles.summaryList}>
            {summaryItems.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </article>

        <article className={styles.contextCard}>
          <div className={styles.cardHeader}>
            <p className={styles.cardEyebrow}>Stage history</p>
            <strong>{completedStages.length || stages.length} production steps</strong>
          </div>
          {stages.length > 0 ? (
            <ol className={styles.stageList}>
              {[...(completedStages.length ? completedStages : stages)]
                .sort((left, right) => left.order - right.order)
                .map((stage) => (
                  <li className={styles.stageItem} key={stage.stageId}>
                    <span>{GENERATION_STAGE_LABELS[stage.type]}</span>
                    <em>{stage.reviewedAt ? "reviewed" : statusLabel(stage.status)}</em>
                  </li>
                ))}
            </ol>
          ) : (
            <p className={styles.emptyHistory}>Stage history appears after production.</p>
          )}
        </article>
      </div>

      <div className={styles.layout}>
        <div className={styles.previewColumn}>
          <PreviewPanel
            Preview={PreviewPlayer}
            audioClips={clips.filter((clip) => clip.kind === "audio")}
            busy={loading}
            createdVideos={[]}
            durationPolicy={DEFAULT_DURATION_POLICY}
            exportResult={null}
            galleryLoading={false}
            loadedVideoThumbs={{}}
            plan={project?.plan ?? undefined}
            selectedAudioClipId=""
            setDurationPolicy={() => {}}
            setLoadedVideoThumbs={() => {}}
            setSelectedAudioClipId={() => {}}
            timeline={timeline ?? null}
            clips={clips}
            onAlignAudio={() => {}}
            onExport={onExport}
            onRefreshCreatedVideos={() => {}}
            showActions={false}
          />

          {hasTimeline ? (
            <div className={styles.feedback}>
              <label className={styles.feedbackLabel} htmlFor="studio-review-feedback">
                Feedback for regeneration
              </label>
              <label className={styles.targetField} htmlFor="studio-review-target">
                <span>Target</span>
                <select
                  id="studio-review-target"
                  value={targetSegmentId}
                  onChange={(event) => {
                    setTargetSegmentId(event.target.value);
                  }}
                >
                  <option value="whole_cut">Whole cut</option>
                  {timeline.segments.map((segment, index) => (
                    <option value={segment.id} key={segment.id}>
                      Beat {index + 1}: {segment.role}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                id="studio-review-feedback"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                placeholder={
                  selectedSegment
                    ? "Tell the agent what should change in this beat or scene."
                    : "Tell the agent what should change across the whole cut."
                }
                rows={4}
              />
              <div className={styles.feedbackActions}>
                <Button
                  variant="secondary"
                  onClick={() => setProposalOpen(true)}
                  disabled={
                    !note.trim() ||
                    !timelineId ||
                    (!proposalTarget && !directProposalTarget)
                  }
                >
                  Review proposed changes
                </Button>
                {!timelineId ? (
                  <span className={styles.hint}>
                    Feedback will activate once the run exposes a timeline id.
                  </span>
                ) : null}
                {selectedSegment && !selectedSegment.beatId ? (
                  <span className={styles.hint}>
                    This segment needs a beat identity before it can be revised safely.
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {hasTimeline ? (
          <TimelinePanel
            timeline={timeline}
            clips={clips}
            selectedSegmentId={selectedSegment?.id}
            segmentNotes={segmentNotes}
            onSegmentChange={onSegmentChange}
            onSegmentNoteChange={onSegmentNoteChange}
            onSelectSegment={(segmentId) => setTargetSegmentId(segmentId)}
          />
        ) : null}
      </div>
      <RerunProposalDialog
        open={proposalOpen}
        projectId={projectId}
        rootRunId={rootRunId}
        target={proposalTarget}
        rerunTarget={directProposalTarget}
        title={selectedSegment ? `Change ${selectedSegment.role}` : "Change the whole cut"}
        subtitle="The Creative Director will preview the affected picture and audio before approval."
        initialMessage={note}
        onClose={() => setProposalOpen(false)}
        asset={
          <div className={styles.proposalPreview}>
            <strong>{selectedSegment ? selectedSegment.role : "Whole cut"}</strong>
            <p>
              {selectedSegment
                ? `Beat ${selectedSegment.beatId ?? "unresolved"}`
                : `${formatDuration(timelineDuration(timeline))} assembled timeline`}
            </p>
          </div>
        }
      />
    </section>
  );
}
