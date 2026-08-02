# Feedback: WEBAPI-20260802-STORYBOARD-ORCHESTRATION

<!-- agent-summary: Task feedback for the creator-facing storyboard orchestration repair. -->
<!-- agent-summary: A product CTA must own its internal prerequisites or make them explicitly actionable. -->
<!-- agent-summary: Storyboard planning remains internal even though it uses shot-plan data structures. -->
<!-- agent-summary: Project run reuse must be bounded by hierarchy identity and an unresolved target gate. -->
<!-- agent-summary: Low-level precondition codes should name the missing artifact, not a nearby prerequisite. -->
<!-- agent-summary: Tool identity must outrank broad stage-type fallbacks in creator progress. -->
<!-- agent-summary: This feedback ships with worksheet WEBAPI-20260802-STORYBOARD-ORCHESTRATION. -->

## Lesson

Creator language and internal generation structure do not need to be identical.
The storyboard can remain the first visual planning artifact while the agent
quietly persists the scene-and-moment plan required to generate its panels. A
creator-facing “Create storyboard” action therefore needs to start the agent
workflow at the storyboard boundary, not call the lowest-level rendering tool.

Run reuse is part of that contract. An arbitrary active project run is not
enough: the reusable run must be a Creative Director hierarchy root and still
have an unresolved storyboard gate. Otherwise a convenient CTA can navigate to
unrelated asset work or a run that has already passed the requested outcome.
The find-or-create decision also needs a cross-instance lock; request-level
idempotency alone cannot prevent two different tabs from racing with different
keys.

Progress projection needs the same identity discipline. Once a stage has a
tool name, that tool must map explicitly or remain absent; falling back only on
the broad stage type can make poster or unknown legacy work appear to complete
Brief, Script, or Shots.

Creator progress and operator diagnostics are separate projections. Unknown
tools should not invent a creator stage, but their job and failure history must
remain available to operators. Likewise, a high-frequency project status poll
should return the one relevant boundary, not rebuild every historical run and
its asset metadata.

## Follow-up

- Prefer outcome-oriented generation entrypoints for future creator CTAs and
  keep low-level tools available only to the orchestrator and diagnostic paths.
- Keep new precondition codes paired with model-readable recovery guidance and
  a targeted test of the suggested tool.
- Add explicit progress groups whenever a durable tool becomes creator-visible;
  do not expand stage-type fallbacks to absorb it.
