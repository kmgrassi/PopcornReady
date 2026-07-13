# Worksheet: AGENT-OPS-001

<!-- agent-summary: Establishes the first repository-wide agent operating-system foundation. -->
<!-- agent-summary: Scope is routing, workflow, documentation, reviews, traces, validation scripts, and task queue. -->
<!-- agent-summary: It documents provider adapters rather than embedding unavailable external-agent credentials. -->
<!-- agent-summary: This worksheet is committed with the foundation and tagged worksheet/AGENT-OPS-001. -->
<!-- agent-summary: Validation includes repository hygiene tooling and targeted command checks. -->
<!-- agent-summary: Follow-up queue items cover visual regression and performance baselines. -->
<!-- agent-summary: The next agent can extend the foundation without reopening existing UI or API work. -->

## Goal and acceptance criteria

Create a router-style agent system that makes work discoverable, testable, reviewable, resumable, and ready for iterative improvement.

## Context and source-of-truth documents

`AGENTS.md`, `CLAUDE.md`, `docs/testing/e2e-test-inventory-and-gaps.md`, and the new `docs/agent-system/` policy set.

## Decisions

- Keep the foundation provider-neutral; the review adapter uses an explicit environment-configured command instead of assuming a particular CLI/account.
- Do not install a hook-framework dependency; use a tracked `.githooks` hook plus an explicit installer script.

## Changes

- Added `AGENT_WORKFLOW.md` and converted `AGENTS.md` into a task router while preserving existing conventions.
- Added agent-system policies, queue, worksheet/feedback templates, hook installer, lint, validation, sweep, and external-review adapter.

## Validation evidence

- `node --check` passed for all four Node scripts.
- `pnpm agent:lint -- --staged --fix` passed for the staged repository changes.
- `pnpm agent:validate -- --scope docs` passed.
- `git diff --cached --check` passed.
- Runtime application execution is not applicable: this PR changes repository process documentation and local tooling only, not web or API behavior.

## Independent reviews

Unavailable. The workspace exposes no configured alternate-agent CLI or `AGENT_REVIEW_COMMAND`; this limitation and adapter setup are recorded in the feedback log.

## Blockers and risks

Visual-regression and performance budgets need stable fixtures and a product decision about the first representative route; queued in `TODOS.md`.

## Next action / handoff

Open a review-ready PR. The first follow-up should configure an independent reviewer, then use it at all four checkpoints.
