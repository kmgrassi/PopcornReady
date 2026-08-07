# Feedback: WEB-20260807-SCRIPT-CREATION

<!-- agent-summary: Dedicated script creation needs a durable server-owned scope, not only a UI route. -->
<!-- agent-summary: The model must author the story blueprint and scene-level script content. -->
<!-- agent-summary: A script-scoped root must never expose media, dispatch, or production tools. -->
<!-- agent-summary: Final script approval completes the writing run atomically and starts no poster work. -->
<!-- agent-summary: Creator projections must distinguish ready scripts from standalone media outputs. -->
<!-- agent-summary: Script intake belongs beside Full video and Single asset as a first-class outcome. -->
<!-- agent-summary: This feedback ships with worksheet WEB-20260807-SCRIPT-CREATION. -->

## Lesson

A text-only promise cannot live solely in route copy. The run needs an immutable
creation scope that constrains every initial, resumed, and recovery turn. Without
that server-owned boundary, approving a script can silently widen the task into
poster or storyboard production even when the intake never mentioned media.

Writing quality also depends on the tool contract. Deterministic placeholders are
useful fallbacks, but a dedicated writing product must let the Creative Director
persist a fully authored story blueprint and scene-level script. The review surface
then has to project that outline and draft as writing artifacts, not classify the
completed run through standalone image/video/audio readiness rules.

Any new column read inside the direct script-review transaction must ship with
the matching `popcorn_api` column grant and exact release-readiness inventory.
Local tests running as an owner do not expose a missing least-privilege grant.

## Follow-up

- Keep future “turn into video” work as a new full-video run derived from the
  approved script; never mutate or broaden the completed script run.
- Consider a separately editable outline checkpoint only when its durable review
  and revision contract can be completed end to end.
- Retire the unused legacy script-handoff helper after its compatibility window.
