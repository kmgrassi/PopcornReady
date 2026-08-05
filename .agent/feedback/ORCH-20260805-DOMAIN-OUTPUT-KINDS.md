# Feedback: ORCH-20260805-DOMAIN-OUTPUT-KINDS

<!-- agent-summary: Task feedback for aligning semantic domain outputs with persisted graph asset kinds. -->
<!-- agent-summary: The asset graph kind and physical media kind are separate contracts. -->
<!-- agent-summary: Completion and rerun authorization must compare against graph kinds, never media kinds. -->
<!-- agent-summary: Persisted graph kind is authoritative except where one kind intentionally carries two semantics. -->
<!-- agent-summary: Keyframe roles distinguish storyboard outputs; critique roles distinguish audio-fit outputs. -->
<!-- agent-summary: Realistic database-shaped fixtures prevent legacy media-kind assumptions from surviving tests. -->
<!-- agent-summary: This feedback ships with worksheet ORCH-20260805-DOMAIN-OUTPUT-KINDS. -->

## Lesson

The graph asset kind (`clip`, `anchor`, `audio_track`) and the physical media
kind (`video`, `image`, `audio`) answer different questions. A validator that
maps semantic output intent to physical media can reject a perfectly valid,
ready graph asset after its provider job and action have both succeeded. The
database did exactly the right thing in this incident; the application contract
collapsed two independent classifications.

Use the persisted graph kind as the authorization boundary. Intrinsic roles
should refine semantics only when the graph schema intentionally overloads one
kind: `keyframe` represents semantic storyboards and keyframes, and `critique`
can represent `audio_fit` or other critiques. Other canonical graph kinds must
not depend on a brittle role allowlist to remain valid.

Tests need database-shaped fixtures. Legacy fixtures that store an anchor as
`kind: image` or a clip as `kind: video` make stale assumptions look correct and
can hide the exact post-generation failure users encounter. Cover the shared
mapping exhaustively and separately exercise each consumer, especially any
consumer that treats the mapping as authorization.

## Follow-up

- Keep graph-kind and media-kind terminology explicit in new contracts and
  reviews.
- When a persisted kind is overloaded, document and test every role family,
  including new roles such as `act_mockup`.
- Prefer full output-kind matrices for small closed unions; they expose latent
  sibling failures when one production case reveals a stale mapping.
- Run the direct local-Postgres rerun finalization test when Docker is responsive;
  deterministic unit coverage already locks its authorization helper.
