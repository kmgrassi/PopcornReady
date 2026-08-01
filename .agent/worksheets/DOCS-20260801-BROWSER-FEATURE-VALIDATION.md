# Worksheet: DOCS-20260801-BROWSER-FEATURE-VALIDATION

<!-- agent-summary: Clarify mandatory browser validation for browser-facing feature changes. -->
<!-- agent-summary: Require agents to exercise the changed feature through its actual browser entry point. -->
<!-- agent-summary: Require desktop and mobile inspection before handoff. -->
<!-- agent-summary: State that automated browser tests complement rather than replace inspection. -->
<!-- agent-summary: Keep the change limited to repository agent-process documentation. -->
<!-- agent-summary: Record docs validation and independent checkpoint reviews here. -->
<!-- agent-summary: Link the ready pull request and worksheet tag after publication. -->

## Goal and acceptance criteria

Make the existing browser-inspection rule unequivocal: every browser-facing
feature change must be manually exercised through its actual browser entry point
against the locally running web app at desktop and mobile widths before handoff.
Automated tests and type-checking must not be treated as substitutes.

## Context and source-of-truth documents

- `AGENTS.md`
- `AGENT_WORKFLOW.md`
- `CLAUDE.md`
- `docs/repository-structure.md`
- `docs/agent-system/README.md`
- `docs/agent-system/testing-policy.md`
- `docs/agent-system/reviews.md`
- `docs/agent-system/worksheets-and-feedback.md`
- `.agent/feedback/README.md`

## Decisions

- Put the concise routing requirement in `AGENTS.md`.
- Put the mandatory execution rule and no-substitution language in
  `AGENT_WORKFLOW.md`.
- Put the durable testing-policy detail and evidence requirement in
  `docs/agent-system/testing-policy.md`.
- Add the browser-evidence check to the wrap-up reviewer prompt so the gate is
  independently verified.
- Align the worksheet/feedback system document with the current task-scoped
  feedback-record contract and leave the historical shared log unchanged.
- Do not require launching the product for this documentation-only change; run
  the repository's documentation validation path.

## Changes

- Expanded the agent router to cover every browser-facing feature and require
  exercising its actual browser entry point.
- Made live-browser exercise to an observable changed result a mandatory
  workflow step and prohibited complete handoff/PR publication when it is
  blocked unless the user explicitly accepts the documented exception.
- Defined browser-facing scope and the worksheet evidence required by the
  testing policy.
- Added browser evidence to the independent wrap-up review checkpoint.
- Repaired stale feedback guidance so the system doc agrees with the
  task-scoped record format in `.agent/feedback/README.md`.

## Validation evidence

- `pnpm agent:lint:fix` — initial run correctly rejected the new feedback record
  because it lacked seven `agent-summary` lines; added them and reran.
- `pnpm agent:lint:fix` — passed for seven changed files after implementation
  review fixes.
- `pnpm agent:validate -- --scope docs` — passed: agent lint, two GitHub Actions
  policy tests, two migration-validator tests, and validation of 98 migration
  filenames.
- `git diff --check` — passed after all implementation-review fixes.

## Independent reviews

- Research: `/root/research_review` confirmed that the existing wording left
  ambiguity between generic inspection, headless automation, and actual
  changed-feature exercise. It recommended an explicit live-browser gate,
  concrete worksheet evidence, and a user-approved exception path.
- Plan: `/root/research_review` approved the minimal authoritative-doc set and
  recommended adding `docs/agent-system/reviews.md` so wrap-up independently
  checks the evidence. Incorporated.
- Implementation: `/root/implementation_review` requested clarity about local
  execution, consistent entry-point terminology, the wrap-up evidence gate, and
  the stale feedback-record contract. All findings were incorporated; final
  re-review approved with no remaining actionable findings.
- Wrap-up: `/root/wrapup_review` independently reran scoped docs validation and
  `git diff --check`, requested explicit summary-line wording and a worksheet
  link from the feedback record, then approved the corrected final diff with no
  remaining required work.

## Blockers and risks

- None currently.

## Next action / handoff

Commit and push the approved documentation and task artifacts, open a
ready-for-review pull request, then add the worksheet tag and publication
metadata.
