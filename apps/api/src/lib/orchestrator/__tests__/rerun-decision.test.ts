import assert from "node:assert/strict";
import test from "node:test";
import type { RerunTarget } from "@popcorn/shared/rerun-proposal";
import {
  clarificationAnswerFingerprint,
  finalizeRerunProposal,
} from "../rerun-decision-adapter";
import type { RerunDecisionPacket } from "../rerun-decision-context";
import { parseRerunModelDecision } from "../rerun-decision";

const project = (id: string): RerunTarget => ({ kind: "project", projectId: id });
const asset = (projectId: string, assetId: string): RerunTarget =>
  ({ kind: "asset", projectId, assetId });

function baseDecision() {
  return {
    preservedAssetIds: [],
    rationale: "The requested change is local.",
    userFacingSummary: "Revise only the requested output.",
    checklist: [],
  };
}

test("strict parser enforces the discriminated outcomes and rejects model-authored policy", () => {
  assert.throws(() => parseRerunModelDecision({
    ...baseDecision(),
    outcome: "no_op",
    selectedWork: [{
      owner: "visuals",
      kind: "revise_visuals",
      targets: [project("p")],
      requiredOutputs: [{
        target: project("p"), kind: "image", role: "image", ordinal: 0,
      }],
    }],
  }), /no_op cannot contain work/);
  assert.throws(() => parseRerunModelDecision({
    ...baseDecision(),
    outcome: "revision",
    selectedWork: [],
  }), /revision must contain/);
  assert.throws(() => parseRerunModelDecision({
    ...baseDecision(),
    outcome: "ask_clarification",
    selectedWork: [],
    clarification: {
      question: "Which pacing?",
      targets: [project("p")],
      options: [{ id: "a", label: "A", tradeoff: "A" }],
    },
  }), /between 2 and 5 options/);
  assert.throws(() => parseRerunModelDecision({
    ...baseDecision(),
    outcome: "ask_clarification",
    selectedWork: [],
    clarification: {
      question: "Which pacing?",
      targets: [project("p")],
      options: [
        { id: "a", label: "A", tradeoff: "A" },
        { id: "b", label: "B", tradeoff: "B" },
      ],
      answerFingerprint: "model-owned",
    },
  }), /cannot author server policy field answerFingerprint/);
  assert.throws(() => parseRerunModelDecision({
    ...baseDecision(),
    outcome: "revision",
    requiresApproval: false,
    selectedWork: [{
      owner: "visuals",
      kind: "revise_visuals",
      targets: [project("p")],
      requiredOutputs: [],
    }],
  }), /cannot author server policy field requiresApproval/);
});

function packet(): RerunDecisionPacket {
  return {
    schemaVersion: "RerunDecisionPacket.v1",
    projectId: "p",
    rootRun: { id: "root", status: "waiting", spentUsd: 1, budgetUsd: 10 },
    userIntent: "Brighten this shot",
    targets: [asset("p", "keyframe")],
    assets: [{
      id: "keyframe",
      kind: "keyframe",
      role: "beat_keyframe",
      name: null,
      description: null,
      durationSec: null,
      lineageId: "keyframe-lineage",
      version: 1,
      contentHash: "h1",
      inputsFingerprint: "f1",
      inputs: [],
      selectionRefs: [{
        slotOwnerLineageId: "beat-lineage",
        slotRole: "beat_keyframe",
        seq: 2,
      }],
      relationToTarget: "target",
      depth: null,
    }, {
      id: "clip",
      kind: "clip",
      role: "beat_clip",
      name: null,
      description: null,
      durationSec: null,
      lineageId: "clip-lineage",
      version: 1,
      contentHash: "h2",
      inputsFingerprint: "f2",
      inputs: [{ assetId: "keyframe", relation: "input" }],
      selectionRefs: [],
      relationToTarget: "downstream",
      depth: 1,
    }, {
      id: "keyframe-2",
      kind: "keyframe",
      role: "beat_keyframe",
      name: null,
      description: null,
      durationSec: null,
      lineageId: "keyframe-lineage-2",
      version: 1,
      contentHash: "h4",
      inputsFingerprint: "f4",
      inputs: [],
      selectionRefs: [{
        slotOwnerLineageId: "beat-lineage-2",
        slotRole: "beat_keyframe",
        seq: 1,
      }],
      relationToTarget: "sibling",
      depth: null,
    }, {
      id: "anchor",
      kind: "anchor",
      role: "character_anchor",
      name: null,
      description: null,
      durationSec: null,
      lineageId: "anchor-lineage",
      version: 1,
      contentHash: "h3",
      inputsFingerprint: "f3",
      inputs: [],
      selectionRefs: [],
      relationToTarget: "upstream",
      depth: null,
    }],
    candidateAffectedAssetIds: ["clip"],
    relatedAssetIds: [],
    story: { blueprint: null, storyboards: [], scenes: [], beats: [], panels: [] },
    recentActions: [],
    terminalDomainReports: [],
    capabilities: [],
    pins: {
      assets: [
        { assetId: "keyframe", contentHash: "h1", inputsFingerprint: "f1" },
        { assetId: "clip", contentHash: "h2", inputsFingerprint: "f2" },
        { assetId: "anchor", contentHash: "h3", inputsFingerprint: "f3" },
        { assetId: "keyframe-2", contentHash: "h4", inputsFingerprint: "f4" },
      ],
      selections: [{
          slotOwnerLineageId: "beat-lineage",
          slotRole: "beat_keyframe",
          expectedActiveAssetId: "keyframe",
          expectedSeq: 2,
        }, {
          slotOwnerLineageId: "beat-lineage-2",
          slotRole: "beat_keyframe",
          expectedActiveAssetId: "keyframe-2",
          expectedSeq: 1,
        }],
      storySnapshots: [],
    },
    truncation: {
      assets: false,
      downstreamCandidates: false,
      relatedAssets: false,
      actions: false,
      terminalReports: false,
      storyRows: false,
      assetInputs: false,
      selectionRefs: false,
      selectionPins: false,
    },
  };
}

test("server derives approval, estimates, pins, moves, and unambiguous duplicate bindings", () => {
  const decision = parseRerunModelDecision({
    ...baseDecision(),
    outcome: "revision",
    preservedAssetIds: ["anchor"],
    checklist: [
      { target: asset("p", "keyframe"), decision: "change", reason: "Requested shot." },
      { target: asset("p", "anchor"), decision: "preserve", reason: "Identity is unchanged." },
    ],
    selectedWork: [{
      owner: "visuals",
      kind: "revise_visuals",
      targets: [asset("p", "keyframe"), asset("p", "keyframe-2"), asset("p", "clip")],
      requiredOutputs: [
        { target: asset("p", "keyframe"), kind: "keyframe", role: "shot", ordinal: 0 },
        { target: asset("p", "keyframe-2"), kind: "keyframe", role: "shot", ordinal: 1 },
        { target: asset("p", "clip"), kind: "clip", role: "shot", ordinal: 0 },
      ],
    }],
  });
  const proposal = finalizeRerunProposal({
    packet: packet(),
    decision,
    source: "request_changes",
  });
  assert.equal(proposal.outcome, "revision");
  assert.equal(proposal.requiresApproval, true);
  assert.equal(proposal.estimate.latencyClass, "media");
  assert.deepEqual(proposal.preservedAssetIds, ["anchor"]);
  assert.deepEqual(
    proposal.selectedWork[0].requiredOutputs.map((output) => output.bindingId),
    ["binding-1", "binding-2", "binding-3"]
  );
  assert.equal(new Set(proposal.selectedWork[0].requiredOutputs.map((output) => output.bindingId)).size, 3);
  assert.equal(proposal.plannedSelectionMoves.length, 2);
});

test("invented IDs and sibling-domain output kinds fail closed", () => {
  const invented = parseRerunModelDecision({
    ...baseDecision(),
    outcome: "revision",
    checklist: [{
      target: asset("p", "keyframe"), decision: "preserve", reason: "Keep requested shot.",
    }],
    selectedWork: [{
      owner: "visuals",
      kind: "revise_visuals",
      targets: [asset("p", "invented")],
      requiredOutputs: [{
        target: asset("p", "invented"), kind: "image", role: "image", ordinal: 0,
      }],
    }],
  });
  assert.throws(() => finalizeRerunProposal({
    packet: packet(), decision: invented, source: "request_changes",
  }), /unauthorized target/);

  const wrongKind = parseRerunModelDecision({
    ...baseDecision(),
    outcome: "revision",
    checklist: [{
      target: asset("p", "keyframe"), decision: "preserve", reason: "Keep requested shot.",
    }],
    selectedWork: [{
      owner: "audio",
      kind: "revise_audio",
      targets: [asset("p", "clip")],
      requiredOutputs: [{
        target: asset("p", "clip"), kind: "clip", role: "clip", ordinal: 0,
      }],
    }],
  });
  assert.throws(() => finalizeRerunProposal({
    packet: packet(), decision: wrongKind, source: "request_changes",
  }), /audio cannot propose output kind clip/);
});

test("bounded clarification is inert and has no work or policy bypass", () => {
  const decision = parseRerunModelDecision({
    ...baseDecision(),
    outcome: "ask_clarification",
    selectedWork: [],
    checklist: [{
      target: asset("p", "keyframe"), decision: "clarify", reason: "Brightness is ambiguous.",
    }],
    clarification: {
      question: "Do you mean exposure or a daytime setting?",
      targets: [asset("p", "keyframe")],
      options: [
        { id: "exposure", label: "Raise exposure", tradeoff: "Keeps the setting." },
        { id: "daytime", label: "Change to day", tradeoff: "Changes scene continuity." },
      ],
    },
  });
  const proposal = finalizeRerunProposal({
    packet: packet(), decision, source: "request_changes",
  });
  assert.equal(proposal.outcome, "ask_clarification");
  assert.equal(proposal.requiresApproval, false);
  assert.deepEqual(proposal.selectedWork, []);
  assert.equal(proposal.estimate.costUsd, 0);
  assert.match(proposal.clarification.answerFingerprint, /^[a-f0-9]{64}$/);
});

test("clarification fingerprint is server-derived from the question, choices, targets, and every freshness pin", () => {
  const basePacket = packet();
  const clarification = {
    question: "Which treatment?",
    targets: [asset("p", "keyframe")],
    options: [
      { id: "warm", label: "Warm", tradeoff: "Changes the palette." },
      { id: "cool", label: "Cool", tradeoff: "Preserves night mood." },
    ],
  };
  const fingerprint = clarificationAnswerFingerprint({
    clarification,
    pins: basePacket.pins,
  });
  assert.equal(clarificationAnswerFingerprint({
    clarification: {
      ...clarification,
      question: "  Which   treatment? ",
    },
    pins: {
      assets: basePacket.pins.assets.slice().reverse(),
      selections: basePacket.pins.selections.slice().reverse(),
      storySnapshots: basePacket.pins.storySnapshots.slice().reverse(),
    },
  }), fingerprint);

  const variants = [
    () => ({ ...clarification, question: "Which treatment now?" }),
    () => ({ ...clarification, targets: [asset("p", "clip")] }),
    () => ({
      ...clarification,
      options: clarification.options.map((option, index) =>
        index === 0 ? { ...option, tradeoff: "A different tradeoff." } : option),
    }),
  ];
  for (const makeClarification of variants) {
    assert.notEqual(clarificationAnswerFingerprint({
      clarification: makeClarification(),
      pins: basePacket.pins,
    }), fingerprint);
  }

  const pinVariants = [
    () => ({
      ...basePacket.pins,
      assets: basePacket.pins.assets.map((pin, index) =>
        index === 0 ? { ...pin, contentHash: "changed" } : pin),
    }),
    () => ({
      ...basePacket.pins,
      selections: basePacket.pins.selections.map((pin, index) =>
        index === 0 ? { ...pin, expectedSeq: pin.expectedSeq + 1 } : pin),
    }),
    () => ({
      ...basePacket.pins,
      storySnapshots: [{
        rowKind: "story_beat" as const,
        rowId: "beat",
        expectedSnapshotAssetId: "story-v2",
      }],
    }),
  ];
  for (const makePins of pinVariants) {
    assert.notEqual(clarificationAnswerFingerprint({
      clarification,
      pins: makePins(),
    }), fingerprint);
  }
});

test("asset outputs active in multiple slots require an explicit selection target", () => {
  const ambiguousPacket = packet();
  ambiguousPacket.assets[0]!.selectionRefs.push({
    slotOwnerLineageId: "alternate-beat",
    slotRole: "beat_keyframe",
    seq: 1,
  });
  ambiguousPacket.pins.selections.push({
    slotOwnerLineageId: "alternate-beat",
    slotRole: "beat_keyframe",
    expectedActiveAssetId: "keyframe",
    expectedSeq: 1,
  });
  const decision = parseRerunModelDecision({
    ...baseDecision(),
    outcome: "revision",
    checklist: [{
      target: asset("p", "keyframe"),
      decision: "change",
      reason: "Change the requested frame.",
    }],
    selectedWork: [{
      owner: "visuals",
      kind: "revise_visuals",
      targets: [asset("p", "keyframe")],
      requiredOutputs: [{
        target: asset("p", "keyframe"),
        kind: "keyframe",
        role: "shot",
        ordinal: 0,
      }],
    }],
  });
  assert.throws(() => finalizeRerunProposal({
    packet: ambiguousPacket,
    decision,
    source: "request_changes",
  }), /active in multiple slots/);
});

test("explicit selection outputs fail closed instead of fabricating an absent sequence pin", () => {
  const missingPinPacket = packet();
  const selectionTarget: RerunTarget = {
    kind: "selection",
    projectId: "p",
    slotOwnerLineageId: "beat-lineage",
    slotRole: "beat_keyframe",
  };
  missingPinPacket.targets = [selectionTarget];
  missingPinPacket.pins.selections = [];
  const decision = parseRerunModelDecision({
    ...baseDecision(),
    outcome: "revision",
    checklist: [{
      target: selectionTarget,
      decision: "change",
      reason: "Change this slot.",
    }],
    selectedWork: [{
      owner: "visuals",
      kind: "revise_visuals",
      targets: [selectionTarget],
      requiredOutputs: [{
        target: selectionTarget,
        kind: "keyframe",
        role: "shot",
        ordinal: 0,
      }],
    }],
  });
  assert.throws(() => finalizeRerunProposal({
    packet: missingPinPacket,
    decision,
    source: "request_changes",
  }), /missing its current sequence pin/);
});

test("audio-only and mixed decisions retain the Creative Director ownership boundary", () => {
  const audioPacket = packet();
  audioPacket.userIntent = "Shorten the narration";
  audioPacket.targets = [asset("p", "audio")];
  audioPacket.assets.push({
    id: "audio",
    kind: "audio_track",
    role: "narration",
    name: null,
    description: null,
    durationSec: null,
    lineageId: "audio-lineage",
    version: 1,
    contentHash: "ha",
    inputsFingerprint: "fa",
    inputs: [],
    selectionRefs: [],
    relationToTarget: "target",
    depth: null,
  });
  audioPacket.pins.assets.push({
    assetId: "audio", contentHash: "ha", inputsFingerprint: "fa",
  });
  const audioOnly = parseRerunModelDecision({
    ...baseDecision(),
    outcome: "revision",
    checklist: [{
      target: asset("p", "audio"), decision: "change", reason: "Shorten narration.",
    }],
    selectedWork: [{
      owner: "audio",
      kind: "revise_audio",
      targets: [asset("p", "audio")],
      requiredOutputs: [{
        target: asset("p", "audio"), kind: "audio_track", role: "narration", ordinal: 0,
      }],
    }, {
      owner: "creative_director",
      kind: "reassemble_cut",
      targets: [asset("p", "clip")],
      requiredOutputs: [{
        target: asset("p", "clip"), kind: "composite", role: "cut", ordinal: 0,
      }],
    }],
  });
  const audioProposal = finalizeRerunProposal({
    packet: audioPacket, decision: audioOnly, source: "request_changes",
  });
  assert.deepEqual(audioProposal.selectedWork.map((work) => work.owner), [
    "audio", "creative_director",
  ]);
  assert.equal(audioProposal.selectedWork.some((work) => work.owner === "visuals"), false);

  audioPacket.userIntent = "Tighten pacing in picture and narration";
  const mixed = parseRerunModelDecision({
    ...baseDecision(),
    outcome: "revision",
    checklist: [{
      target: asset("p", "audio"), decision: "change", reason: "Change pacing.",
    }],
    selectedWork: [{
      owner: "visuals",
      kind: "revise_visuals",
      targets: [asset("p", "clip")],
      requiredOutputs: [{
        target: asset("p", "clip"), kind: "clip", role: "shot", ordinal: 0,
      }],
    }, {
      owner: "audio",
      kind: "revise_audio",
      targets: [asset("p", "audio")],
      requiredOutputs: [{
        target: asset("p", "audio"), kind: "audio_track", role: "narration", ordinal: 0,
      }],
    }, {
      owner: "creative_director",
      kind: "reassemble_cut",
      targets: [asset("p", "clip")],
      requiredOutputs: [{
        target: asset("p", "clip"), kind: "composite", role: "cut", ordinal: 0,
      }],
    }],
  });
  const mixedProposal = finalizeRerunProposal({
    packet: audioPacket, decision: mixed, source: "request_changes",
  });
  assert.deepEqual(new Set(mixedProposal.selectedWork.map((work) => work.owner)), new Set([
    "visuals", "audio", "creative_director",
  ]));
  assert.equal(mixedProposal.risk, "high");
});
