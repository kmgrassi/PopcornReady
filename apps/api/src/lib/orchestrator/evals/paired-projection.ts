// Paired Gate-0 scenario projection (review follow-up on specialist-agents PR 1).
//
// The adoption-gate threshold compares non-acceptable rates "on the same
// scenarios/samples/provider", so the hierarchy surface must be scored on the
// SAME scenario matrix as the flat production registry — not on a separate,
// smaller set. This module deterministically projects every flat scenario onto
// the proposed hierarchy surfaces using the capability catalog's ownership:
//
// - Root projection (default): consecutive applied visuals/audio leaf results
//   collapse into one applied `delegate_visuals`/`delegate_audio` result that
//   carries the union of produced asset IDs (the root still sees stable graph
//   IDs); creative-director results pass through unchanged; failed leaf
//   results become failed dispatch results with their remedy tools mapped into
//   dispatch vocabulary. Expected leaf tools map to the owning dispatch tool.
// - In-domain projection: when the latest result is a FAILED visuals/audio
//   leaf whose every surfaced remedy lives in the same domain, the decision
//   belongs to that specialist (self-heal inside the assignment); the scenario
//   projects onto that domain surface with only its in-domain history and the
//   unchanged leaf expectation.
//
// Both sides of a pair share one scenario id so reports stay comparable row
// by row. Hand-written HIERARCHY_SCENARIOS remain unpaired diagnostics and are
// excluded from the gate comparison.

import { TOOL_CAPABILITY_CATALOG } from "@/lib/orchestrator-tools/capability-catalog";
import type { ToolName } from "../types";
import type { Gate0Scenario } from "./gate0-report";
import type { PriorResult } from "./types";
import {
  DELEGATE_AUDIO_FIXTURE,
  DELEGATE_VISUALS_FIXTURE,
  type FixturePriorResult,
  type HierarchyScenario,
} from "./hierarchy-fixture";

type OwnerRole = (typeof TOOL_CAPABILITY_CATALOG)[ToolName]["ownerRole"];
type DomainRole = Exclude<OwnerRole, "creative_director">;

const DISPATCH_TOOL: Record<DomainRole, string> = {
  visuals: DELEGATE_VISUALS_FIXTURE.name,
  audio: DELEGATE_AUDIO_FIXTURE.name,
};

function ownerOf(tool: ToolName): OwnerRole {
  return TOOL_CAPABILITY_CATALOG[tool].ownerRole;
}

function remedyTools(error: PriorResult["error"]): ToolName[] {
  if (!error) return [];
  const tools = [
    ...(error.suggestedNextTools ?? []).map((call) => call.tool),
    ...(error.unmetRequirements ?? []).map((miss) => miss.satisfyWith.tool),
  ];
  return [...new Set(tools)];
}

/** Map one flat tool name into the root surface vocabulary. */
function toRootTool(tool: ToolName): string {
  const owner = ownerOf(tool);
  return owner === "creative_director" ? tool : DISPATCH_TOOL[owner];
}

function mapErrorToRoot(error: PriorResult["error"]): FixturePriorResult["error"] {
  if (!error) return undefined;
  return {
    kind: error.kind,
    message: error.message,
    recoverable: error.recoverable,
    ...(error.unmetRequirements
      ? {
          unmetRequirements: error.unmetRequirements.map((miss) => ({
            requirement: miss.requirement,
            because: miss.because,
            satisfyWith: {
              tool: toRootTool(miss.satisfyWith.tool),
              inputHint: miss.satisfyWith.inputHint,
            },
          })),
        }
      : {}),
    ...(error.suggestedNextTools
      ? {
          suggestedNextTools: error.suggestedNextTools.map((call) => ({
            tool: toRootTool(call.tool),
            inputHint: call.inputHint,
          })),
        }
      : {}),
  };
}

function projectPriorResultsToRoot(priorResults: PriorResult[]): FixturePriorResult[] {
  const projected: FixturePriorResult[] = [];
  for (const result of priorResults) {
    const owner = ownerOf(result.tool);
    if (owner === "creative_director") {
      projected.push({
        tool: result.tool,
        status: result.status,
        outputAssetIds: [...result.outputAssetIds],
        ...(result.error ? { error: mapErrorToRoot(result.error) } : {}),
      });
      continue;
    }
    const dispatch = DISPATCH_TOOL[owner];
    const previous = projected.at(-1);
    if (
      result.status === "applied" &&
      previous?.tool === dispatch &&
      previous.status === "applied"
    ) {
      // One dispatch assignment covers the whole consecutive in-domain run;
      // the report keeps every produced stable asset id visible to the root.
      previous.outputAssetIds.push(...result.outputAssetIds);
      continue;
    }
    projected.push({
      tool: dispatch,
      status: result.status,
      outputAssetIds: [...result.outputAssetIds],
      ...(result.error ? { error: mapErrorToRoot(result.error) } : {}),
    });
  }
  return projected;
}

function projectExpectationToRoot(
  expect: Gate0Scenario["expect"]
): HierarchyScenario["expect"] {
  if (expect.type === "done") return { type: "done" };
  return { type: "tool_call", oneOf: [...new Set(expect.oneOf.map(toRootTool))] };
}

/**
 * The in-domain case: the flat scenario ends in a failed visuals/audio leaf
 * whose every remedy stays in the same domain — on the hierarchy this decision
 * happens inside the specialist assignment, not at the root.
 */
function inDomainProjection(scenario: Gate0Scenario): HierarchyScenario | undefined {
  const latest = scenario.priorResults.at(-1);
  if (latest?.status !== "failed") return undefined;
  const owner = ownerOf(latest.tool);
  if (owner === "creative_director") return undefined;
  const remedies = remedyTools(latest.error);
  if (remedies.length === 0 || !remedies.every((tool) => ownerOf(tool) === owner)) {
    return undefined;
  }
  return {
    id: scenario.id,
    family: scenario.family,
    surface: owner,
    description: `${scenario.description} (paired projection: ${owner} specialist surface)`,
    inputSummary: scenario.inputSummary,
    // The specialist assignment carries only its in-domain history.
    priorResults: scenario.priorResults
      .filter((result) => ownerOf(result.tool) === owner)
      .map((result) => ({
        tool: result.tool as string,
        status: result.status,
        outputAssetIds: [...result.outputAssetIds],
        ...(result.error ? { error: result.error } : {}),
      })),
    expect:
      scenario.expect.type === "done"
        ? { type: "done" }
        : { type: "tool_call", oneOf: [...scenario.expect.oneOf] },
  };
}

/** Deterministically project one flat scenario onto the hierarchy surface. */
export function projectToHierarchy(scenario: Gate0Scenario): HierarchyScenario {
  const inDomain = inDomainProjection(scenario);
  if (inDomain) return inDomain;
  return {
    id: scenario.id,
    family: scenario.family,
    surface: "root",
    description: `${scenario.description} (paired projection: creative-director surface)`,
    inputSummary: scenario.inputSummary,
    priorResults: projectPriorResultsToRoot(scenario.priorResults),
    expect: projectExpectationToRoot(scenario.expect),
  };
}

export interface PairedScenario {
  flat: Gate0Scenario;
  hierarchy: HierarchyScenario;
}

/**
 * The paired Gate-0 matrix: every flat scenario and its hierarchy projection,
 * sharing one id, so both surfaces are scored on identical project states.
 */
export function buildPairedMatrix(scenarios: Gate0Scenario[]): PairedScenario[] {
  return scenarios.map((flat) => ({ flat, hierarchy: projectToHierarchy(flat) }));
}
