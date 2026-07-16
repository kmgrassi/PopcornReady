// Specialist-agent orchestration PR 7 — bounded session continuity.
//
// A compact summary is routing context only. Its shape deliberately cannot hold
// an asset/project snapshot: it retains concise control facts and stable IDs,
// then the next turn re-reads current graph state through graph-snapshot.ts.

const MAX_HISTORY_EVENTS = 24;
const MAX_REFERENCED_IDS = 64;
const MAX_TEXT_LENGTH = 480;
const MAX_TOTAL_TEXT_LENGTH = 3_200;

export interface SessionHistoryEvent {
  sequence: number;
  constraints?: readonly string[];
  unresolvedQuestion?: string;
  reportSummary?: string;
  assetIds?: readonly string[];
  actionIds?: readonly string[];
}

export interface AgentSessionSummaryV1 {
  schemaVersion: "AgentSessionSummary.v1";
  constraints: string[];
  unresolvedQuestions: Array<{ sequence: number; question: string }>;
  reportSummaries: Array<{ sequence: number; summary: string }>;
  referencedAssetIds: string[];
  referencedActionIds: string[];
}

export interface SessionSummaryState {
  summaryThroughSequence: number;
  summaryVersion: number;
  nextSequence: number;
}

export interface SessionSummaryCasUpdate {
  summary: AgentSessionSummaryV1;
  summaryThroughSequence: number;
  summaryVersion: number;
}

function compactText(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, MAX_TEXT_LENGTH);
}

function stableIds(values: readonly string[] | undefined): string[] {
  const result: string[] = [];
  for (const value of values ?? []) {
    if (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 128 &&
      !/[\r\n]/.test(value) &&
      !result.includes(value)
    ) {
      result.push(value);
      if (result.length === MAX_REFERENCED_IDS) break;
    }
  }
  return result;
}

function boundedText<T extends { question?: string; summary?: string }>(
  entries: T[],
  field: "question" | "summary"
): T[] {
  let remaining = MAX_TOTAL_TEXT_LENGTH;
  const result: T[] = [];
  for (const entry of entries) {
    const value = entry[field];
    if (!value || remaining <= 0) continue;
    const clipped = value.slice(0, remaining);
    remaining -= clipped.length;
    result.push({ ...entry, [field]: clipped });
  }
  return result;
}

/**
 * Deterministically compact terminal/report control facts. Callers pass only
 * typed history fields; raw task payloads, graph rows, provider responses, and
 * tool histories have no representation in this API.
 */
export function compactSessionHistory(input: {
  prior?: AgentSessionSummaryV1 | null;
  events: readonly SessionHistoryEvent[];
}): AgentSessionSummaryV1 {
  const events = [...input.events]
    .filter((event) => Number.isInteger(event.sequence) && event.sequence > 0)
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-MAX_HISTORY_EVENTS);

  const constraints = [...(input.prior?.constraints ?? [])];
  const unresolvedQuestions = [...(input.prior?.unresolvedQuestions ?? [])];
  const reportSummaries = [...(input.prior?.reportSummaries ?? [])];
  const referencedAssetIds = [...(input.prior?.referencedAssetIds ?? [])];
  const referencedActionIds = [...(input.prior?.referencedActionIds ?? [])];

  for (const event of events) {
    for (const constraint of event.constraints ?? []) {
      const text = compactText(constraint);
      if (text && !constraints.includes(text)) constraints.push(text);
    }
    const question = event.unresolvedQuestion ? compactText(event.unresolvedQuestion) : undefined;
    if (question) {
      const existing = unresolvedQuestions.findIndex((entry) => entry.sequence === event.sequence);
      const entry = { sequence: event.sequence, question };
      if (existing >= 0) unresolvedQuestions[existing] = entry;
      else unresolvedQuestions.push(entry);
    }
    const summary = event.reportSummary ? compactText(event.reportSummary) : undefined;
    if (summary) {
      const existing = reportSummaries.findIndex((entry) => entry.sequence === event.sequence);
      const entry = { sequence: event.sequence, summary };
      if (existing >= 0) reportSummaries[existing] = entry;
      else reportSummaries.push(entry);
    }
    for (const id of stableIds(event.assetIds)) {
      if (!referencedAssetIds.includes(id)) referencedAssetIds.push(id);
    }
    for (const id of stableIds(event.actionIds)) {
      if (!referencedActionIds.includes(id)) referencedActionIds.push(id);
    }
  }

  return {
    schemaVersion: "AgentSessionSummary.v1",
    constraints: constraints.slice(-MAX_HISTORY_EVENTS).map((value) => value.slice(0, MAX_TEXT_LENGTH)),
    unresolvedQuestions: boundedText(
      unresolvedQuestions.slice(-MAX_HISTORY_EVENTS),
      "question"
    ),
    reportSummaries: boundedText(reportSummaries.slice(-MAX_HISTORY_EVENTS), "summary"),
    referencedAssetIds: stableIds(referencedAssetIds.slice(-MAX_REFERENCED_IDS)),
    referencedActionIds: stableIds(referencedActionIds.slice(-MAX_REFERENCED_IDS)),
  };
}

/**
 * Produce the optimistic-CAS payload for `agent_sessions`. A stale worker gets
 * `null` and must reload; it can never overwrite a newer summary.
 */
export function buildSessionSummaryCasUpdate(input: {
  state: SessionSummaryState;
  expectedSummaryVersion: number;
  throughSequence: number;
  summary: AgentSessionSummaryV1;
}): SessionSummaryCasUpdate | null {
  if (
    input.state.summaryVersion !== input.expectedSummaryVersion ||
    !Number.isInteger(input.throughSequence) ||
    input.throughSequence < input.state.summaryThroughSequence ||
    input.throughSequence >= input.state.nextSequence
  ) {
    return null;
  }
  return {
    summary: input.summary,
    summaryThroughSequence: input.throughSequence,
    summaryVersion: input.state.summaryVersion + 1,
  };
}
