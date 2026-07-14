import type {
  AgentRole,
  DomainTarget,
} from "@popcorn/shared/domain-agent-contract";
import {
  getToolCapability,
  isToolName,
  TOOL_NAMES,
  type ToolName,
} from "@/lib/orchestrator-tools/capability-catalog";

interface RawRecoveryCandidate {
  tool?: unknown;
  inputHint?: unknown;
}

interface RawPreconditionMiss {
  requirement?: unknown;
  because?: unknown;
  satisfyWith?: RawRecoveryCandidate;
}

export interface RawToolRecovery {
  suggestedNextTools?: readonly RawRecoveryCandidate[];
  unmetRequirements?: readonly RawPreconditionMiss[];
}

export interface DomainSafeToolCandidate {
  tool: ToolName;
  targets: readonly DomainTarget[];
}

export interface DomainSafePreconditionMiss {
  requirement: string;
  because: string;
  satisfyWith: DomainSafeToolCandidate;
}

type RecoveryCandidateSource =
  | "suggested_next_tool"
  | "unmet_requirement";

export interface DomainBlockedCandidate {
  requiredDomain: AgentRole;
  targets: readonly DomainTarget[];
  sources: readonly RecoveryCandidateSource[];
  reason: string;
}

export interface DomainRecoveryProjection {
  suggestedNextTools: readonly DomainSafeToolCandidate[];
  unmetRequirements: readonly DomainSafePreconditionMiss[];
  blockedCandidates: readonly DomainBlockedCandidate[];
  unknownCandidateCount: number;
}

export const MAX_DOMAIN_RECOVERY_TARGETS = 32;
export const MAX_TRUSTED_DOMAIN_TARGETS = 256;
const MAX_HINT_IDS_PER_FIELD = 128;
const MAX_STABLE_ID_LENGTH = 128;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .slice(0, MAX_HINT_IDS_PER_FIELD)
    .filter((candidate): candidate is string => isStableId(candidate));
}

function isStableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_STABLE_ID_LENGTH &&
    STABLE_ID_PATTERN.test(value)
  );
}

function canonicalTrustedTarget(
  value: DomainTarget,
  projectId: string
): DomainTarget | undefined {
  if (typeof value !== "object" || value === null || value.projectId !== projectId) {
    return undefined;
  }
  switch (value.kind) {
    case "project":
      return { kind: "project", projectId };
    case "storyboard":
      return isStableId(value.storyboardId)
        ? { kind: "storyboard", projectId, storyboardId: value.storyboardId }
        : undefined;
    case "scene":
      return isStableId(value.sceneId)
        ? { kind: "scene", projectId, sceneId: value.sceneId }
        : undefined;
    case "beat":
      return isStableId(value.beatId)
        ? { kind: "beat", projectId, beatId: value.beatId }
        : undefined;
    case "panel":
      return isStableId(value.panelId)
        ? { kind: "panel", projectId, panelId: value.panelId }
        : undefined;
    case "asset":
      return isStableId(value.assetId)
        ? { kind: "asset", projectId, assetId: value.assetId }
        : undefined;
    case "lineage":
      return isStableId(value.lineageId)
        ? { kind: "lineage", projectId, lineageId: value.lineageId }
        : undefined;
    case "timeline_item":
      return isStableId(value.timelineItemId)
        ? { kind: "timeline_item", projectId, timelineItemId: value.timelineItemId }
        : undefined;
    case "export":
      return isStableId(value.exportId)
        ? { kind: "export", projectId, exportId: value.exportId }
        : undefined;
  }
}

function targetKey(target: DomainTarget): string {
  return JSON.stringify(target);
}

function stableTargets(
  projectId: string,
  trustedTargets: readonly DomainTarget[],
  inputHint: unknown
): DomainTarget[] {
  const hint = asRecord(inputHint);
  const targets: DomainTarget[] = [];
  const trustedByKey = new Map<string, DomainTarget>();
  for (const target of trustedTargets.slice(0, MAX_TRUSTED_DOMAIN_TARGETS)) {
    const canonical = canonicalTrustedTarget(target, projectId);
    if (canonical && canonical.kind !== "project") {
      trustedByKey.set(targetKey(canonical), canonical);
    }
  }

  const add = (candidate: DomainTarget): void => {
    if (targets.length >= MAX_DOMAIN_RECOVERY_TARGETS) return;
    const key = targetKey(candidate);
    const trusted = trustedByKey.get(key);
    if (trusted && !targets.some((target) => targetKey(target) === key)) {
      targets.push(trusted);
    }
  };

  for (const storyboardId of readIds(hint.storyboardId)) {
    add({ kind: "storyboard", projectId, storyboardId });
  }
  for (const sceneId of readIds(hint.sceneId)) {
    add({ kind: "scene", projectId, sceneId });
  }
  for (const beatId of [
    ...readIds(hint.beatId),
    ...readIds(hint.beatIds),
  ]) {
    add({ kind: "beat", projectId, beatId });
  }
  for (const panelId of [
    ...readIds(hint.panelId),
    ...readIds(hint.panelIds),
  ]) {
    add({ kind: "panel", projectId, panelId });
  }
  for (const assetId of [
    ...readIds(hint.assetId),
    ...readIds(hint.assetIds),
    ...readIds(hint.sourceAssetId),
    ...readIds(hint.sourceAssetIds),
  ]) {
    add({ kind: "asset", projectId, assetId });
  }
  for (const lineageId of readIds(hint.lineageId)) {
    add({ kind: "lineage", projectId, lineageId });
  }
  for (const timelineItemId of [
    ...readIds(hint.timelineItemId),
    ...readIds(hint.timelineItemIds),
  ]) {
    add({ kind: "timeline_item", projectId, timelineItemId });
  }
  for (const exportId of readIds(hint.exportId)) {
    add({ kind: "export", projectId, exportId });
  }

  return targets.length ? targets : [{ kind: "project", projectId }];
}

function redactedText(value: unknown, ownerRole: AgentRole): string {
  let text = typeof value === "string" ? value : "";
  for (const name of TOOL_NAMES) {
    if (getToolCapability(name).ownerRole !== ownerRole) {
      text = text.split(name).join("another domain capability");
    }
  }
  return text;
}

function candidateKey(candidate: DomainSafeToolCandidate): string {
  return `${candidate.tool}:${JSON.stringify(candidate.targets)}`;
}

/**
 * Pure, dormant translation for future specialist model contexts. It never
 * mutates or persists the raw error. Same-owner primitives remain actionable;
 * cross-owner primitive names and raw input hints never enter the projection.
 */
export function projectDomainRecovery(args: {
  ownerRole: AgentRole;
  projectId: string;
  /** Server-authorized targets available to this finite domain turn. */
  trustedTargets: readonly DomainTarget[];
  error: RawToolRecovery;
}): DomainRecoveryProjection {
  const projectId = args.projectId;
  if (!isStableId(projectId)) {
    throw new Error("Domain recovery projection requires a trusted projectId.");
  }
  const suggestedNextTools: DomainSafeToolCandidate[] = [];
  const unmetRequirements: DomainSafePreconditionMiss[] = [];
  const blockedByKey = new Map<string, DomainBlockedCandidate>();
  let unknownCandidateCount = 0;

  const projectCandidate = (
    raw: RawRecoveryCandidate | undefined,
    source: RecoveryCandidateSource
  ): DomainSafeToolCandidate | undefined => {
    if (!raw || typeof raw.tool !== "string" || !isToolName(raw.tool)) {
      unknownCandidateCount += 1;
      return undefined;
    }

    const metadata = getToolCapability(raw.tool);
    const targets = stableTargets(projectId, args.trustedTargets, raw.inputHint);
    if (metadata.ownerRole === args.ownerRole) {
      return { tool: raw.tool, targets };
    }

    const key = `${metadata.ownerRole}:${JSON.stringify(targets)}`;
    const existing = blockedByKey.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) {
        blockedByKey.set(key, {
          ...existing,
          sources: [...existing.sources, source],
        });
      }
    } else {
      blockedByKey.set(key, {
        requiredDomain: metadata.ownerRole,
        targets,
        sources: [source],
        reason: "Another domain must satisfy this prerequisite.",
      });
    }
    return undefined;
  };

  const seenSuggestions = new Set<string>();
  for (const raw of args.error.suggestedNextTools ?? []) {
    const candidate = projectCandidate(raw, "suggested_next_tool");
    if (candidate && !seenSuggestions.has(candidateKey(candidate))) {
      seenSuggestions.add(candidateKey(candidate));
      suggestedNextTools.push(candidate);
    }
  }

  const seenRequirements = new Set<string>();
  for (const miss of args.error.unmetRequirements ?? []) {
    const candidate = projectCandidate(miss.satisfyWith, "unmet_requirement");
    if (!candidate) continue;
    const projected = {
      requirement: redactedText(miss.requirement, args.ownerRole),
      because: redactedText(miss.because, args.ownerRole),
      satisfyWith: candidate,
    };
    const key = JSON.stringify(projected);
    if (!seenRequirements.has(key)) {
      seenRequirements.add(key);
      unmetRequirements.push(projected);
    }
  }

  return {
    suggestedNextTools,
    unmetRequirements,
    blockedCandidates: [...blockedByKey.values()],
    unknownCandidateCount,
  };
}
