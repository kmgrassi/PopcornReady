# Feedback: WEBAPI-20260805-SCRIPT-FIRST

<!-- agent-summary: Task feedback for the script-first full-video creation boundary. -->
<!-- agent-summary: A review gate must constrain the model's visible capabilities, not only stop after a tool. -->
<!-- agent-summary: User-supplied creative text should be preserved exactly until revision is requested. -->
<!-- agent-summary: Text-only refinement can stay on the root gate without entering media rerun proposals. -->
<!-- agent-summary: Sequential after-tool gates require terminal projections to remain actionable. -->
<!-- agent-summary: Eager decorative generation is still media generation and belongs after script approval. -->
<!-- agent-summary: This feedback ships with worksheet WEBAPI-20260805-SCRIPT-FIRST. -->

## Lesson

A post-tool gate alone is not a complete phase boundary. The model can still
choose delegation or another media tool before it reaches the gated tool, and
it can try to finish while an unresolved mandatory gate remains. The safe
contract filters the model-visible registry for the phase and rejects premature
completion in addition to parking after the script tool.

Supplied scripts and generated scripts share one authoritative relational
surface, but their first-draft semantics differ. Treating supplied text as a
prompt silently changes creator-owned words; preserving it exactly makes the
review meaningful. Once the creator asks for changes, the agent should persist
a complete rewritten draft that supersedes the old one, not append feedback
instructions to the script content.

Automatic poster work is part of the media boundary even when it looks
decorative. Removing only the most visible trigger is insufficient because
project, brief, prompt, upload, and storyboard entrypoints can each initiate it.
The trigger belongs on successful script approval, where the creator has
explicitly authorized downstream visual work.

Direct transaction writes must preserve the same typed JSON envelope as the
normal action store. Satisfying a generic JSONB column type is not enough: the
schema marker and target nesting are what let later orchestrator turns consume
feedback consistently. Likewise, a multi-gate status surface must project the
complete gate set and treat a terminalized after-gate pass as reusable; omitting
either rule can hide the active review and allow a duplicate root run.

## Follow-up

- Keep future phase gates paired with an allowlisted registry and adversarial
  tests for delegation, later-stage tools, and premature model completion.
- Keep approval updates inside a transactional compare-and-set that locks the
  gate, root run, active project pointer, and exact script draft together.
- Preserve separate script and storyboard review stops when adding future
  creator checkpoints; terminal run status alone must not hide an active gate.
- When merging test inventories, keep the dedicated script-gate reject action
  as an explicit exception to the broader rule that media feedback uses durable
  Request Changes proposals.
