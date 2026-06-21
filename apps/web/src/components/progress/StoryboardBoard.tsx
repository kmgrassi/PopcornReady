"use client";

import { useMemo, useState } from "react";
import type {
  BoardRevisionTarget,
  GenerationStageItem,
  ProjectStoryboard,
  StoryboardBeat,
  StoryboardPanel,
  StoryboardScene,
} from "@popcorn/shared/v1/types";
import { AiAssetFeedbackDialog } from "../ai-edit/AiAssetFeedbackDialog";
import dialogStyles from "../ai-edit/AiAssetFeedbackDialog.module.css";
import { RegenerateImageButton } from "../media/RegenerateImageButton";
import styles from "./StoryboardBoard.module.css";

interface StoryboardBoardProps {
  runId: string;
  items: GenerationStageItem[];
  storyboard?: ProjectStoryboard | null;
  pendingTargetKey?: string | null;
  error?: string | null;
  onFeedback: (input: { message: string; target: BoardRevisionTarget }) => Promise<void>;
}

interface Tile {
  key: string;
  label: string;
  intent?: string | null;
  sceneLabel?: string | null;
  item?: GenerationStageItem;
  scene?: StoryboardScene;
  beat?: StoryboardBeat;
  panel?: StoryboardPanel;
  mediaUrl?: string;
  target: BoardRevisionTarget;
}

const VISUAL_KINDS = new Set<GenerationStageItem["kind"]>(["image", "video"]);

function targetKey(target: BoardRevisionTarget): string {
  return [
    target.scope,
    target.storyboardId,
    target.sceneId,
    target.beatId,
    target.panelId,
    target.stageId,
    target.itemId,
    target.assetId,
    target.artifactId,
  ]
    .filter(Boolean)
    .join(":");
}

function selectedPanel(beat: StoryboardBeat): StoryboardPanel | undefined {
  return beat.panels.find((panel) => panel.isSelected) ?? beat.panels[0];
}

function storyboardTiles(
  runId: string,
  storyboard: ProjectStoryboard,
  items: GenerationStageItem[],
): Tile[] {
  const itemsByAsset = new Map<string, GenerationStageItem>();
  for (const item of items) {
    if (item.assetId) itemsByAsset.set(item.assetId, item);
    if (item.artifactId) itemsByAsset.set(item.artifactId, item);
  }

  return storyboard.scenes.flatMap((scene) =>
    scene.beats.map((beat) => {
      const panel = selectedPanel(beat);
      const item =
        (panel?.imageAssetId ? itemsByAsset.get(panel.imageAssetId) : undefined) ??
        (beat.beatAssetId ? itemsByAsset.get(beat.beatAssetId) : undefined);
      const key = beat.id;
      return {
        key,
        label: `Beat ${beat.beatIndex + 1}`,
        intent: beat.intent || beat.visualDescription,
        sceneLabel: scene.title || `Scene ${scene.sceneIndex + 1}`,
        item,
        scene,
        beat,
        panel,
        mediaUrl: panel?.url ?? panel?.thumbnailUrl,
        target: {
          scope: "tile",
          runId,
          storyboardId: storyboard.id,
          sceneId: scene.id,
          beatId: beat.id,
          ...(panel ? { panelId: panel.id } : {}),
          ...(panel?.imageAssetId ? { assetId: panel.imageAssetId, keyframeAssetId: panel.imageAssetId } : {}),
          ...(item?.stageId ? { stageId: item.stageId } : {}),
          ...(item?.itemId ? { itemId: item.itemId } : {}),
          ...(item?.artifactId ? { artifactId: item.artifactId } : {}),
          label: beat.intent || `Beat ${beat.beatIndex + 1}`,
        },
      };
    }),
  );
}

function itemTiles(runId: string, items: GenerationStageItem[]): Tile[] {
  return items.map((item, index) => ({
    key: item.itemId,
    label: item.label || `Frame ${index + 1}`,
    intent: item.promptPreview,
    item,
    target: {
      scope: "tile",
      runId,
      stageId: item.stageId,
      itemId: item.itemId,
      ...(item.assetId ? { assetId: item.assetId, keyframeAssetId: item.assetId } : {}),
      ...(item.artifactId ? { artifactId: item.artifactId } : {}),
      label: item.label,
    },
  }));
}

function statusLabel(item?: GenerationStageItem, beat?: StoryboardBeat): string {
  if (item) return item.status;
  if (beat) return beat.status;
  return "ready";
}

export function StoryboardBoard({
  runId,
  items,
  storyboard,
  pendingTargetKey,
  error,
  onFeedback,
}: StoryboardBoardProps) {
  const visualItems = items.filter((item) => VISUAL_KINDS.has(item.kind));
  const tiles = useMemo(
    () =>
      storyboard
        ? storyboardTiles(runId, storyboard, visualItems)
        : itemTiles(runId, visualItems),
    [runId, storyboard, visualItems],
  );
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);

  if (tiles.length === 0) return null;

  const selectedKey = selectedTile ? targetKey(selectedTile.target) : null;
  const selectedPending = Boolean(selectedKey && pendingTargetKey === selectedKey);
  const selectedSubtitle = selectedTile
    ? [selectedTile.sceneLabel, selectedTile.intent].filter(Boolean).join(" - ")
    : null;

  return (
    <section className={styles.board} aria-labelledby="storyboard-board-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Storyboard</p>
          <h2 id="storyboard-board-heading">Direct the board</h2>
          <p className={styles.headerCopy}>
            Click any asset to send targeted feedback to the AI.
          </p>
        </div>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.grid}>
        {tiles.map((tile, index) => {
          const key = targetKey(tile.target);
          const regenAssetId = tile.target.assetId ?? tile.item?.assetId;
          const canRegenerate =
            !tile.mediaUrl && tile.item?.kind === "image" && Boolean(regenAssetId);
          return (
            <div className={styles.tileWrap} key={tile.key}>
              <button
                className={styles.tile}
                type="button"
                onClick={() => setSelectedTile(tile)}
                aria-label={`Edit ${tile.label} with AI`}
                aria-busy={pendingTargetKey === key || undefined}
              >
                <div className={styles.media}>
                  {tile.mediaUrl ? (
                    <img
                      src={tile.mediaUrl}
                      alt={tile.intent ? `${tile.label}: ${tile.intent}` : tile.label}
                    />
                  ) : (
                    <span aria-hidden="true">{index + 1}</span>
                  )}
                </div>
                <div className={styles.tileBody}>
                  <div className={styles.tileMeta}>
                    <span>{tile.sceneLabel ?? "Generated frame"}</span>
                    <span>{statusLabel(tile.item, tile.beat)}</span>
                  </div>
                  <h3>{tile.label}</h3>
                  {tile.intent ? <p>{tile.intent}</p> : null}
                </div>
              </button>
              {canRegenerate && regenAssetId ? (
                <div className={styles.tileRegen}>
                  <RegenerateImageButton assetId={regenAssetId} initialPrompt={tile.intent} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <AiAssetFeedbackDialog
        open={Boolean(selectedTile)}
        title={selectedTile?.label ?? "Edit asset"}
        subtitle={selectedSubtitle}
        pending={selectedPending}
        error={selectedTile ? error : null}
        onClose={() => {
          if (!selectedPending) setSelectedTile(null);
        }}
        onSubmit={async (message) => {
          if (!selectedTile) return;
          await onFeedback({ message, target: selectedTile.target });
          setSelectedTile(null);
        }}
        asset={
          selectedTile?.mediaUrl ? (
            selectedTile.item?.kind === "video" ? (
              <video
                src={selectedTile.mediaUrl}
                controls
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              <img
                src={selectedTile.mediaUrl}
                alt={selectedTile.intent ? `${selectedTile.label}: ${selectedTile.intent}` : selectedTile.label}
              />
            )
          ) : (
            <div className={dialogStyles.assetPlaceholder}>No preview available.</div>
          )
        }
      />
    </section>
  );
}

export { targetKey as storyboardFeedbackTargetKey };
