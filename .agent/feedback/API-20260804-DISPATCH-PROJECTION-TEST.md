# Feedback: API-20260804-DISPATCH-PROJECTION-TEST

<!-- agent-summary: Task feedback for the stale dispatch-tool projection metadata test fix. -->
<!-- agent-summary: A compat-preservation test can outlive the behavior it froze. -->
<!-- agent-summary: Decide stale-test-vs-regression from commit intent, not from which side is older. -->
<!-- agent-summary: Verify a fallback value is unreachable before deciding it needs no display metadata. -->
<!-- agent-summary: Repository changes must ship worksheet and feedback records in the same PR. -->
<!-- agent-summary: Pre-existing suite failures get verified against clean main and left out of scope. -->
<!-- agent-summary: This feedback ships with worksheet API-20260804-DISPATCH-PROJECTION-TEST. -->

## Lesson

The metadata test froze "legacy projection behavior" at a moment when
`toolStage()` had a catch-all `creative_plan` fallback. When 55421ff3
deliberately removed that catch-all, the frozen expectation silently became a
claim about behavior nobody intended anymore. Resolving this kind of failure
requires reading the intent of both commits: the newer projection change was
typed, filtered, and consistent (clearly deliberate), while the old `['Plan',
101]` values were an accident of a default branch, not designed metadata —
the catalog had already declared `runProjection: {label: null, order: null}`.

Before concluding the raw-name fallback needed no real display metadata, it
was necessary to prove the value is unreachable: `projectStages` drops
dispatch actions before reading label/order, and the hierarchy view only
labels domain child-run actions while delegate_* tools are root-only. Without
that reachability check, "update the test" could have hidden a snake_case
label leaking into the UI.

Process: the first commit shipped only the test file. AGENTS.md requires the
worksheet and feedback record to be committed with the implementation, and
the Codex PR review correctly flagged the omission at P1. Records written
after the fact are recoverable but weaker; start the worksheet at task start.

## Follow-up

- When a "preserve legacy behavior" test fails, check whether the frozen
  behavior was itself a fallback accident before restoring it.
- If any surface begins rendering root-run dispatch actions, give it an
  explicit label source (catalog `label`) instead of widening `toolLabel`.
- The 4 pre-existing API-suite failures (guest-retention purge, anonymous-user
  purge, production graph reader, discover uuid check) are red on clean main
  and deserve their own task.
- Start the worksheet before the first commit, even for one-line fixes.
