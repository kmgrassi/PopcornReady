import type {
  BoundRequiredOutput,
  PlannedSelectionMove,
  PlannedStoryPointerMove,
  RerunProposalV2,
  RerunTarget,
  RerunWorkItem,
} from "@popcorn/shared/rerun-proposal";
import { createHash } from "node:crypto";
import { ApiError } from "@/core/errors";
import { getLlmClient, type LlmClient } from "@/lib/llm";
import { CREATIVE_DIRECTOR_SYSTEM_PROMPT } from "./creative-director-agent";
import type { RerunDecisionPacket } from "./rerun-decision-context";
import {
  parseRerunModelDecision,
  RERUN_DECISION_JSON_SCHEMA,
  type RerunModelDecision,
} from "./rerun-decision";

const OUTPUT_KINDS = {
  creative_director: new Set(["story_snapshot", "composite", "critique"]),
  visuals: new Set(["image", "poster", "anchor", "keyframe", "clip", "composite", "render"]),
  audio: new Set(["audio_track", "audio_fit"]),
} as const;

export type RerunDecisionAdapter = (
  packet: RerunDecisionPacket
) => Promise<RerunModelDecision>;

export function createRerunDecisionAdapter(client: LlmClient = getLlmClient()): RerunDecisionAdapter {
  return async (packet) => {
    const raw = await client.structured<Record<string, unknown>>({
      cachedSystem:
        `${CREATIVE_DIRECTOR_SYSTEM_PROMPT} ` +
        "For this turn, make one inert selective-regeneration proposal. " +
        "Choose only stable targets present in the bounded packet. Do not author cost, risk, " +
        "approval, pins, binding IDs, work-item IDs, or planned pointer moves; the server owns them.",
      user: JSON.stringify(packet),
      schema: RERUN_DECISION_JSON_SCHEMA,
      maxTokens: 8_000,
      effort: "high",
    });
    return parseRerunModelDecision(raw);
  };
}

function targetKey(target: RerunTarget): string {
  switch (target.kind) {
    case "project": return `project:${target.projectId}`;
    case "storyboard": return `storyboard:${target.storyboardId}`;
    case "scene": return `scene:${target.sceneId}`;
    case "beat": return `beat:${target.beatId}`;
    case "panel": return `panel:${target.panelId}`;
    case "asset": return `asset:${target.assetId}`;
    case "lineage": return `lineage:${target.lineageId}`;
    case "timeline_item": return `timeline_item:${target.timelineItemId}`;
    case "export": return `export:${target.exportId}`;
    case "selection":
      return `selection:${target.slotOwnerLineageId ?? "project"}:${target.slotRole}`;
    case "transcript_segment": return `transcript_segment:${target.transcriptSegmentId}`;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function clarificationAnswerFingerprint(input: {
  clarification: Extract<RerunModelDecision, { outcome: "ask_clarification" }>["clarification"];
  pins: RerunDecisionPacket["pins"];
}): string {
  const normalized = {
    question: input.clarification.question.trim().replace(/\s+/g, " "),
    targets: input.clarification.targets
      .map((target) => ({ key: targetKey(target), target }))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(({ target }) => target),
    options: input.clarification.options.map((option) => ({
      id: option.id.trim(),
      label: option.label.trim().replace(/\s+/g, " "),
      tradeoff: option.tradeoff.trim().replace(/\s+/g, " "),
    })),
    pins: {
      assets: input.pins.assets.slice().sort((a, b) => a.assetId.localeCompare(b.assetId)),
      selections: input.pins.selections.slice().sort((a, b) =>
        `${a.slotOwnerLineageId ?? ""}:${a.slotRole}`.localeCompare(
          `${b.slotOwnerLineageId ?? ""}:${b.slotRole}`
        )),
      storySnapshots: input.pins.storySnapshots.slice().sort((a, b) =>
        `${a.rowKind}:${a.rowId}`.localeCompare(`${b.rowKind}:${b.rowId}`)),
    },
  };
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

function authorizedTargetKeys(packet: RerunDecisionPacket): Set<string> {
  return new Set([
    ...packet.targets.map(targetKey),
    ...packet.assets.map((asset) => `asset:${asset.id}`),
    ...packet.assets.map((asset) => `lineage:${asset.lineageId}`),
    ...packet.story.storyboards.map((row) => `storyboard:${row.id}`),
    ...packet.story.scenes.map((row) => `scene:${row.id}`),
    ...packet.story.beats.map((row) => `beat:${row.id}`),
    ...packet.story.panels.map((row) => `panel:${row.id}`),
    ...packet.pins.selections.map((pin) =>
      `selection:${pin.slotOwnerLineageId ?? "project"}:${pin.slotRole}`),
  ]);
}

function validateDecision(packet: RerunDecisionPacket, decision: RerunModelDecision) {
  const authorized = authorizedTargetKeys(packet);
  const assertTarget = (target: RerunTarget) => {
    if (target.projectId !== packet.projectId || !authorized.has(targetKey(target))) {
      throw new ApiError("validation_failed", `Model selected unauthorized target ${targetKey(target)}.`);
    }
  };
  decision.checklist.forEach((item) => assertTarget(item.target));
  const checklistKeys = decision.checklist.map((item) => targetKey(item.target));
  if (new Set(checklistKeys).size !== checklistKeys.length) {
    throw new ApiError("validation_failed", "The rerun checklist cannot contain duplicate targets.");
  }
  for (const target of packet.targets) {
    if (!checklistKeys.includes(targetKey(target))) {
      throw new ApiError(
        "validation_failed",
        `The rerun checklist is missing requested target ${targetKey(target)}.`
      );
    }
  }
  decision.preservedAssetIds.forEach((id) => {
    if (!packet.assets.some((asset) => asset.id === id)) {
      throw new ApiError("validation_failed", `Model preserved an uninspected asset: ${id}.`);
    }
  });
  if (decision.outcome === "ask_clarification") {
    decision.clarification.targets.forEach(assertTarget);
  }
  if (decision.outcome !== "revision") return;
  decision.selectedWork.forEach((work) => {
    work.targets.forEach(assertTarget);
    const workTargetKeys = new Set(work.targets.map(targetKey));
    work.requiredOutputs.forEach((output) => {
      assertTarget(output.target);
      if (!workTargetKeys.has(targetKey(output.target))) {
        throw new ApiError(
          "validation_failed",
          "Every required output target must be inside its work item target boundary."
        );
      }
      if (!OUTPUT_KINDS[work.owner].has(output.kind as never)) {
        throw new ApiError(
          "validation_failed",
          `${work.owner} cannot propose output kind ${output.kind}.`
        );
      }
    });
  });
}

function selectionMoveForOutput(
  output: BoundRequiredOutput,
  packet: RerunDecisionPacket
): PlannedSelectionMove | null {
  const target = output.target;
  if (target.kind === "selection") {
    const pin = packet.pins.selections.find((candidate) =>
      candidate.slotOwnerLineageId === target.slotOwnerLineageId &&
      candidate.slotRole === target.slotRole);
    if (!pin) {
      throw new ApiError(
        "validation_failed",
        `Selection target is missing its current sequence pin: ${targetKey(target)}.`
      );
    }
    return {
      bindingId: output.bindingId,
      slotOwnerLineageId: target.slotOwnerLineageId,
      slotRole: target.slotRole,
      expectedActiveAssetId: pin.expectedActiveAssetId,
      expectedSeq: pin.expectedSeq,
    };
  }
  if (target.kind !== "asset") return null;
  const asset = packet.assets.find((candidate) => candidate.id === target.assetId);
  if ((asset?.selectionRefs.length ?? 0) > 1) {
    throw new ApiError(
      "validation_failed",
      `Asset ${target.assetId} is active in multiple slots; select an explicit selection target.`
    );
  }
  const pin = asset?.selectionRefs[0];
  return pin ? {
    bindingId: output.bindingId,
    slotOwnerLineageId: pin.slotOwnerLineageId,
    slotRole: pin.slotRole,
    expectedActiveAssetId: target.assetId,
    expectedSeq: pin.seq,
  } : null;
}

function storyMoveForOutput(
  output: BoundRequiredOutput,
  packet: RerunDecisionPacket
): PlannedStoryPointerMove | null {
  if (output.kind !== "story_snapshot") return null;
  const rowKind =
    output.target.kind === "storyboard" ? "storyboard" :
      output.target.kind === "scene" ? "story_scene" :
        output.target.kind === "beat" ? "story_beat" : null;
  if (!rowKind) return null;
  const rowId =
    output.target.kind === "storyboard" ? output.target.storyboardId :
      output.target.kind === "scene" ? output.target.sceneId :
        output.target.kind === "beat" ? output.target.beatId : "";
  const pin = packet.pins.storySnapshots.find((candidate) =>
    candidate.rowKind === rowKind && candidate.rowId === rowId);
  if (!pin) {
    throw new ApiError("validation_failed", `Story target is missing a pointer pin: ${rowId}.`);
  }
  return {
    bindingId: output.bindingId,
    rowKind,
    rowId,
    expectedSnapshotAssetId: pin.expectedSnapshotAssetId,
  };
}

function estimateForWork(work: RerunWorkItem[]) {
  const outputs = work.flatMap((item) => item.requiredOutputs);
  const mediaCount = outputs.filter((output) =>
    ["image", "poster", "anchor", "keyframe", "clip", "render", "audio_track"].includes(output.kind)
  ).length;
  const modelCount = work.filter((item) => item.owner === "creative_director").length;
  const costUsd = Number((mediaCount * 0.5 + modelCount * 0.02).toFixed(2));
  return {
    costUsd,
    maxCostUsd: Number((Math.max(costUsd, 0.01) * 1.25).toFixed(2)),
    latencyClass: mediaCount > 0 ? "media" as const : "interactive" as const,
  };
}

export function finalizeRerunProposal(input: {
  packet: RerunDecisionPacket;
  decision: RerunModelDecision;
  source: "request_changes" | "autonomous_review";
}): RerunProposalV2 {
  const { packet, decision } = input;
  validateDecision(packet, decision);
  const common = {
    schemaVersion: "RerunProposal.v2" as const,
    projectId: packet.projectId,
    rootRunId: packet.rootRun.id,
    source: input.source,
    userIntent: packet.userIntent,
    targets: packet.targets,
    inspectedAssetIds: packet.assets.map((asset) => asset.id),
    candidateAffectedAssetIds: packet.candidateAffectedAssetIds,
    preservedAssetIds: [...new Set(decision.preservedAssetIds)],
    checklist: decision.checklist,
    pins: packet.pins,
    rationale: decision.rationale,
    userFacingSummary: decision.userFacingSummary,
  };
  if (decision.outcome === "no_op") {
    return {
      ...common,
      outcome: "no_op",
      selectedWork: [],
      plannedSelectionMoves: [],
      plannedStoryPointerMoves: [],
      estimate: { costUsd: 0, maxCostUsd: 0, latencyClass: "interactive" },
      risk: "low",
      requiresApproval: false,
    };
  }
  if (decision.outcome === "ask_clarification") {
    return {
      ...common,
      outcome: "ask_clarification",
      selectedWork: [],
      plannedSelectionMoves: [],
      plannedStoryPointerMoves: [],
      estimate: { costUsd: 0, maxCostUsd: 0, latencyClass: "interactive" },
      risk: "low",
      requiresApproval: false,
      clarification: {
        ...decision.clarification,
        answerFingerprint: clarificationAnswerFingerprint({
          clarification: decision.clarification,
          pins: packet.pins,
        }),
      },
    };
  }
  let bindingIndex = 0;
  const selectedWork = decision.selectedWork.map((work, index): RerunWorkItem => {
    const workItemId = `work-${index + 1}`;
    return {
      ...work,
      workItemId,
      requiredOutputs: work.requiredOutputs.map((output) => ({
        ...output,
        workItemId,
        bindingId: `binding-${++bindingIndex}`,
      })),
    } as RerunWorkItem;
  }) as [RerunWorkItem, ...RerunWorkItem[]];
  const outputs = selectedWork.flatMap((work) => work.requiredOutputs);
  const plannedSelectionMoves = outputs.flatMap((output) => {
    const move = selectionMoveForOutput(output, packet);
    return move ? [move] : [];
  });
  const plannedStoryPointerMoves = outputs.flatMap((output) => {
    const move = storyMoveForOutput(output, packet);
    return move ? [move] : [];
  });
  const selectionMoveKeys = plannedSelectionMoves.map((move) =>
    `${move.slotOwnerLineageId ?? "project"}:${move.slotRole}`);
  if (new Set(selectionMoveKeys).size !== selectionMoveKeys.length) {
    throw new ApiError(
      "validation_failed",
      "A revision cannot bind multiple outputs to the same selection slot."
    );
  }
  const storyMoveKeys = plannedStoryPointerMoves.map((move) =>
    `${move.rowKind}:${move.rowId}`);
  if (new Set(storyMoveKeys).size !== storyMoveKeys.length) {
    throw new ApiError(
      "validation_failed",
      "A revision cannot bind multiple outputs to the same story pointer."
    );
  }
  const estimate = estimateForWork(selectedWork);
  const owners = new Set(selectedWork.map((work) => work.owner));
  const storyMutation = selectedWork.some((work) => work.kind === "revise_story");
  const risk =
    storyMutation || owners.size > 1 || plannedSelectionMoves.length > 1
      ? "high" as const
      : estimate.costUsd > 0
        ? "medium" as const
        : "low" as const;
  const requiresApproval =
    input.source === "request_changes" ||
    estimate.costUsd > 0 ||
    storyMutation ||
    owners.size > 1 ||
    plannedSelectionMoves.length > 1;
  return {
    ...common,
    outcome: "revision",
    selectedWork,
    plannedSelectionMoves,
    plannedStoryPointerMoves,
    estimate,
    risk,
    requiresApproval,
  };
}
