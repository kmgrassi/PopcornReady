// Service layer for the eval HTTP API.
//
// Sits between the v1 routes (apps/api/src/routes/v1/eval.ts) and:
//   * the eval repository (./store) — persistence
//   * the portable runner/registry/verdict (@popcorn/eval) — the actual judging
//
// Routes stay thin: they validate input and shape the envelope; all the
// orchestration (drive the runner, persist run + judgments + expectation
// results, assemble run detail, diff two runs, fire one evaluator on demand)
// lives here.

import { ApiError } from "@/core/errors";
import {
  EvaluatorRegistry,
  computeVerdict,
  createEvaluatorContext,
  runEvalSuite,
  type EvalFixtureCase,
  type EvalRun,
  type EvalSuite,
  type EvalSuiteFixture,
  type Evaluator,
  type ExpectationResult,
  type GenerationStageType,
  type Judgment,
  type JudgmentVerdict,
} from "@popcorn/eval";

import { getEvalStore, type EvalStore } from "./store";

// ---------------------------------------------------------------------------
// Evaluator registry
// ---------------------------------------------------------------------------
// The judges themselves extract into packages/agent as follow-up work (scope §8).
// Until they register here, the registry is empty: a suite run still succeeds and
// produces zero judgments (a valid, inspectable run), and the on-demand judge
// reports a clear validation_failed for an unknown evaluatorId. Tests inject a
// deterministic registry via setEvalRegistryForTests.
let _registry: EvaluatorRegistry = new EvaluatorRegistry();

export function getEvalRegistry(): EvaluatorRegistry {
  return _registry;
}

export function setEvalRegistryForTests(registry: EvaluatorRegistry | null): void {
  _registry = registry ?? new EvaluatorRegistry();
}

// ---------------------------------------------------------------------------
// Run provenance (git sha / branch)
// ---------------------------------------------------------------------------
function gitSha(): string {
  return (process.env.GIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || "unknown").trim();
}

function gitBranch(): string {
  return (process.env.GIT_BRANCH || process.env.RAILWAY_GIT_BRANCH || "unknown").trim();
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------
export interface SuiteDetail {
  suite: EvalSuite;
  cases: EvalFixtureCase[];
}

export interface EvalSuiteSummary extends EvalSuite {
  latestPassRate: number;
  latestRunId: string | null;
  trend: number[];
  stageRates: Array<{
    stageType: GenerationStageType;
    passRate: number;
    verdict: JudgmentVerdict;
  }>;
}

const GENERATION_STAGE_TYPES: GenerationStageType[] = [
  "creative_plan",
  "storyboard",
  "asset_generation",
  "clip_generation",
  "timeline_assembly",
  "final_export",
];

function isGenerationStageType(value: string): value is GenerationStageType {
  return (GENERATION_STAGE_TYPES as string[]).includes(value);
}

function stageTypeFromStageId(stageId: string): GenerationStageType | null {
  const candidate = stageId.split(":").at(-1);
  return candidate && isGenerationStageType(candidate) ? candidate : null;
}

function stageTypeFromJudgment(
  judgment: Judgment,
  cases: EvalFixtureCase[]
): GenerationStageType | null {
  const stageFromId = stageTypeFromStageId(judgment.stageId);
  if (stageFromId) return stageFromId;

  for (const evalCase of cases) {
    const artifact = evalCase.artifacts.find((candidate) => {
      return (
        (judgment.artifactId && candidate.artifactId === judgment.artifactId) ||
        (judgment.itemId && candidate.itemId === judgment.itemId) ||
        (judgment.assetId && candidate.assetId === judgment.assetId)
      );
    });
    if (artifact) return artifact.stageType;
  }

  const evaluatorPrefix = judgment.evaluatorId.split(".")[0];
  return evaluatorPrefix && isGenerationStageType(evaluatorPrefix) ? evaluatorPrefix : null;
}

function passRate(judgments: Judgment[]): number {
  if (judgments.length === 0) return 0;
  return judgments.filter((judgment) => judgment.verdict === "pass").length / judgments.length;
}

function verdictForRate(rate: number): JudgmentVerdict {
  if (rate >= 1) return "pass";
  if (rate <= 0) return "fail";
  return "needs_review";
}

function stagesForCases(cases: EvalFixtureCase[]): GenerationStageType[] {
  const stages = new Set<GenerationStageType>();
  for (const evalCase of cases) {
    for (const stage of evalCase.stagesToRun) {
      stages.add(stage);
    }
    for (const artifact of evalCase.artifacts) {
      stages.add(artifact.stageType);
    }
  }
  return GENERATION_STAGE_TYPES.filter((stage) => stages.has(stage));
}

async function runPassRate(runId: string, store: EvalStore): Promise<number> {
  return passRate(await store.listJudgmentsForRun(runId));
}

export async function listSuites(store: EvalStore = getEvalStore()): Promise<EvalSuiteSummary[]> {
  const suites = await store.listSuites();
  return Promise.all(
    suites.map(async (suite) => {
      const runs = await store.listRunsForSuite(suite.id);
      const latestRun = runs[0] ?? null;
      const latestJudgments = latestRun ? await store.listJudgmentsForRun(latestRun.id) : [];
      const cases = await store.listCasesForSuite(suite.id);
      const stages = stagesForCases(cases);
      const stageRates = stages.map((stageType) => {
        const judgments = latestJudgments.filter(
          (judgment) => stageTypeFromJudgment(judgment, cases) === stageType
        );
        const rate = passRate(judgments);
        return {
          stageType,
          passRate: rate,
          verdict: verdictForRate(rate),
        };
      });

      const trend = await Promise.all(
        runs
          .slice(0, 5)
          .reverse()
          .map((run) => runPassRate(run.id, store))
      );

      return {
        ...suite,
        latestPassRate: passRate(latestJudgments),
        latestRunId: latestRun?.id ?? null,
        trend,
        stageRates,
      };
    })
  );
}

export async function getSuiteDetail(
  suiteId: string,
  store: EvalStore = getEvalStore()
): Promise<SuiteDetail> {
  const suite = await store.getSuite(suiteId);
  if (!suite) throw new ApiError("not_found", `Eval suite not found: ${suiteId}`);
  const cases = await store.listCasesForSuite(suiteId);
  return { suite, cases };
}

// ---------------------------------------------------------------------------
// Run detail (run + cases + judgments) — the dashboard grid
// ---------------------------------------------------------------------------
export interface RunDetail {
  run: EvalRun;
  cases: EvalFixtureCase[];
  judgments: Judgment[];
  expectationResults: ExpectationResult[];
}

export interface DashboardJudgment extends Judgment {
  stageType: GenerationStageType;
}

export interface DashboardRunDetail extends RunDetail {
  evalRun: EvalRun;
  suiteName: string | null;
  passRate: number;
  previousRunId: string | null;
  stages: GenerationStageType[];
  judgments: DashboardJudgment[];
  calibration: {
    matchRate: number;
    labeledCases: number;
  };
}

export async function getRunDetail(
  runId: string,
  store: EvalStore = getEvalStore()
): Promise<RunDetail> {
  const run = await store.getRun(runId);
  if (!run) throw new ApiError("not_found", `Eval run not found: ${runId}`);
  const cases = run.suiteId ? await store.listCasesForSuite(run.suiteId) : [];
  const [judgments, expectationResults] = await Promise.all([
    store.listJudgmentsForRun(runId),
    store.listExpectationResultsForRun(runId),
  ]);
  return { run, cases, judgments, expectationResults };
}

export async function getDashboardRunDetail(
  runId: string,
  store: EvalStore = getEvalStore()
): Promise<DashboardRunDetail> {
  const detail = await getRunDetail(runId, store);
  const suite = detail.run.suiteId ? await store.getSuite(detail.run.suiteId) : null;
  const runs = detail.run.suiteId ? await store.listRunsForSuite(detail.run.suiteId) : [];
  const currentRunIndex = runs.findIndex((run) => run.id === runId);
  const previousRunId =
    currentRunIndex >= 0 && currentRunIndex + 1 < runs.length
      ? runs[currentRunIndex + 1].id
      : null;
  const stages = stagesForCases(detail.cases);
  const judgments = detail.judgments.flatMap((judgment): DashboardJudgment[] => {
    const stageType = stageTypeFromJudgment(judgment, detail.cases);
    return stageType ? [{ ...judgment, stageType }] : [];
  });
  const labeledCases = detail.expectationResults.length;
  const matched = detail.expectationResults.filter((result) => result.matched).length;

  return {
    ...detail,
    evalRun: detail.run,
    suiteName: suite?.name ?? null,
    passRate: passRate(detail.judgments),
    previousRunId,
    stages,
    judgments,
    calibration: {
      matchRate: labeledCases > 0 ? matched / labeledCases : 0,
      labeledCases,
    },
  };
}

// ---------------------------------------------------------------------------
// Start a run for a suite
// ---------------------------------------------------------------------------
export interface StartRunInput {
  suiteId: string;
  gitSha?: string;
  branch?: string;
}

export async function startSuiteRun(
  input: StartRunInput,
  store: EvalStore = getEvalStore(),
  registry: EvaluatorRegistry = getEvalRegistry()
): Promise<RunDetail> {
  const suite = await store.getSuite(input.suiteId);
  if (!suite) throw new ApiError("not_found", `Eval suite not found: ${input.suiteId}`);
  const cases = await store.listCasesForSuite(input.suiteId);

  const fixture: EvalSuiteFixture = { suite, cases };
  // The runner builds the result graph in memory with its OWN ephemeral
  // correlation ids (judgments reference the run, expectation results reference
  // judgments). Those ids are never persisted as PKs: on persist below the DB
  // assigns the real uuids and we remap the cross-references to them.
  const result = await runEvalSuite({
    registry,
    fixture,
    gitSha: input.gitSha?.trim() || gitSha(),
    branch: input.branch?.trim() || gitBranch(),
  });

  // Persist run first (FK target), then its judgments (re-pointed at the run's DB
  // id), then expectation results (re-pointed at each judgment's DB id).
  const run = await store.saveRun(result.evalRun);
  const judgmentIdByTemp = new Map<string, string>();
  const judgments: Judgment[] = [];
  for (const judgment of result.judgments) {
    const persisted = await store.saveJudgment({ ...judgment, evalRunId: run.id });
    judgmentIdByTemp.set(judgment.id, persisted.id);
    judgments.push(persisted);
  }

  const expectationResults: ExpectationResult[] = [];
  for (const expectationResult of result.expectationResults) {
    const judgmentId =
      judgmentIdByTemp.get(expectationResult.judgmentId) ?? expectationResult.judgmentId;
    expectationResults.push(
      await store.saveExpectationResult({
        ...expectationResult,
        evalRunId: run.id,
        judgmentId,
      })
    );
  }

  return { run, cases, judgments, expectationResults };
}

// ---------------------------------------------------------------------------
// Diff two runs — verdict flips
// ---------------------------------------------------------------------------
export interface VerdictFlip {
  // The graph coordinate that flipped, keyed the way the dashboard groups cells.
  caseId?: string;
  caseLabel?: string;
  stageId: string;
  stageType?: GenerationStageType;
  evaluatorId: string;
  artifactId?: string;
  itemId?: string;
  assetId?: string;
  before: Judgment["verdict"];
  after: Judgment["verdict"];
}

export interface RunDiff {
  baseRunId: string;
  againstRunId: string;
  flips: VerdictFlip[];
}

// A judgment's identity for diffing: same case + same evaluator + same artifact
// across the two runs is "the same cell" whose verdict may have flipped.
function judgmentKey(j: Judgment): string {
  const targetId = j.artifactId
    ? `artifact:${j.artifactId}`
    : j.itemId
      ? `item:${j.itemId}`
      : j.assetId
        ? `asset:${j.assetId}`
        : `stage:${j.stageId}`;
  return `${j.caseId ?? ""}::${j.evaluatorId}::${targetId}`;
}

export async function diffRuns(
  baseRunId: string,
  againstRunId: string,
  store: EvalStore = getEvalStore()
): Promise<RunDiff> {
  const [baseRun, againstRun] = await Promise.all([
    store.getRun(baseRunId),
    store.getRun(againstRunId),
  ]);
  if (!baseRun) throw new ApiError("not_found", `Eval run not found: ${baseRunId}`);
  if (!againstRun) throw new ApiError("not_found", `Eval run not found: ${againstRunId}`);

  const [baseJudgments, againstJudgments] = await Promise.all([
    store.listJudgmentsForRun(baseRunId),
    store.listJudgmentsForRun(againstRunId),
  ]);
  const cases = baseRun.suiteId ? await store.listCasesForSuite(baseRun.suiteId) : [];
  const caseLabelById = new Map(cases.map((evalCase) => [evalCase.id, evalCase.label]));

  // Newest judgment wins per key within a run (re-judges append; the last is current).
  const baseByKey = latestByKey(baseJudgments);
  const againstByKey = latestByKey(againstJudgments);

  const flips: VerdictFlip[] = [];
  for (const [key, base] of baseByKey) {
    const after = againstByKey.get(key);
    if (!after) continue;
    if (base.verdict === after.verdict) continue;
    const flip: VerdictFlip = {
      stageId: base.stageId,
      evaluatorId: base.evaluatorId,
      before: base.verdict,
      after: after.verdict,
    };
    if (base.caseId != null) {
      flip.caseId = base.caseId;
      const caseLabel = caseLabelById.get(base.caseId);
      if (caseLabel != null) flip.caseLabel = caseLabel;
    }
    const stageType = stageTypeFromJudgment(base, cases);
    if (stageType != null) flip.stageType = stageType;
    if (base.artifactId != null) flip.artifactId = base.artifactId;
    if (base.itemId != null) flip.itemId = base.itemId;
    if (base.assetId != null) flip.assetId = base.assetId;
    flips.push(flip);
  }

  return { baseRunId, againstRunId, flips };
}

function latestByKey(judgments: Judgment[]): Map<string, Judgment> {
  const byKey = new Map<string, Judgment>();
  for (const judgment of judgments) {
    const key = judgmentKey(judgment);
    const existing = byKey.get(key);
    if (!existing || existing.createdAt <= judgment.createdAt) {
      byKey.set(key, judgment);
    }
  }
  return byKey;
}

// ---------------------------------------------------------------------------
// On-demand single-artifact judge (POST /judgments { evaluatorId, artifactId })
// ---------------------------------------------------------------------------
export interface OnDemandJudgeInput {
  evaluatorId: string;
  artifactId: string;
}

export async function judgeArtifact(
  input: OnDemandJudgeInput,
  store: EvalStore = getEvalStore(),
  registry: EvaluatorRegistry = getEvalRegistry()
): Promise<Judgment> {
  const evaluator: Evaluator | undefined = registry.get(input.evaluatorId);
  if (!evaluator) {
    throw new ApiError("validation_failed", `Unknown evaluator: ${input.evaluatorId}`, {
      fields: [{ path: "evaluatorId", message: "No evaluator registered with this id." }],
    });
  }

  // Resolve the artifact to judge. The on-demand path judges a frozen case
  // artifact (the workbench "Run judge" button, scope §6C); look it up across
  // stored cases by artifactId.
  const artifact = await findArtifactById(input.artifactId, store);
  if (!artifact) {
    throw new ApiError("not_found", `Artifact not found: ${input.artifactId}`);
  }

  // Context-isolated: only the artifact + an independently-derived intent reach
  // the judge (scope §3). createEvaluatorContext rejects any generator-private
  // field, so the bias guard is enforced at the boundary.
  const context = createEvaluatorContext({
    stageType: artifact.stageType,
    tool: artifact.tool,
    modality: evaluator.modality,
    artifact: artifact.artifact,
    intent: artifact.intent,
    evidenceRef: artifact.evidenceRef,
    stageId: `manual:${artifact.stageType}`,
    itemId: artifact.itemId,
    artifactId: artifact.artifactId ?? input.artifactId,
    assetId: artifact.assetId,
    trigger: "manual",
  });

  const startedAt = Date.now();
  const draft = await evaluator.run(context);
  const latencyMs = draft.latencyMs ?? Date.now() - startedAt;

  // The verdict is recomputed deterministically from grades, never trusted from
  // the model (scope §3 design principle).
  const judgment: Judgment = {
    // Placeholder; store.saveJudgment assigns the DB-generated id and returns it.
    id: "",
    evaluatorId: evaluator.id,
    rubricVersion: evaluator.rubricVersion,
    judgeModel: evaluator.judgeModel,
    stageId: context.stageId,
    grades: draft.grades,
    verdict: computeVerdict(draft.grades, evaluator.thresholds),
    rationale: draft.rationale,
    trigger: "manual",
    costUsd: draft.costUsd ?? 0,
    latencyMs,
    createdAt: new Date().toISOString(),
  };
  if (artifact.itemId != null) judgment.itemId = artifact.itemId;
  judgment.artifactId = artifact.artifactId ?? input.artifactId;
  if (artifact.assetId != null) judgment.assetId = artifact.assetId;
  if (draft.recommendedAction != null) judgment.recommendedAction = draft.recommendedAction;
  const evidenceRef = draft.evidenceRef ?? artifact.evidenceRef;
  if (evidenceRef != null) judgment.evidenceRef = evidenceRef;

  return store.saveJudgment(judgment);
}

async function findArtifactById(
  artifactId: string,
  store: EvalStore
): Promise<EvalFixtureCase["artifacts"][number] | null> {
  const suites = await store.listSuites();
  for (const suite of suites) {
    const cases = await store.listCasesForSuite(suite.id);
    for (const evalCase of cases) {
      const match = evalCase.artifacts.find((a) => a.artifactId === artifactId);
      if (match) return match;
    }
  }
  return null;
}
