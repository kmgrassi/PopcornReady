# Feedback: WEB-20260806-CREATE-SCRIPT-ENTRY

<!-- agent-summary: Task feedback for adding Script discovery to the Create workspace. -->
<!-- agent-summary: Product outcome choices do not have to share one execution domain. -->
<!-- agent-summary: Script remains Creative Director work and is not a Visuals or Audio media task. -->
<!-- agent-summary: Existing-project script creation would mutate authoritative project structure. -->
<!-- agent-summary: Cross-route creative text uses validated navigation state instead of URL parameters. -->
<!-- agent-summary: A handoff must not silently auto-start generation or inherit stale proposal authority. -->
<!-- agent-summary: This feedback ships with worksheet WEB-20260806-CREATE-SCRIPT-ENTRY. -->

## Lesson

A unified Create surface can present several creator outcomes without forcing
them into one backend contract. Image, Video, and Audio are bounded pooled-media
tasks owned by Visuals or Audio. Script is authoritative project structure owned
by the Creative Director, persisted through relational script drafts and an
immutable graph asset. Treating Script as a fourth media enum would make the UI
look uniform while weakening the agent boundary underneath it.

Creating a script inside an existing produced project is not an inert pool
addition: it replaces the active script pointer and can stale dependent work.
The safe discovery slice therefore starts a new project and reuses the mandatory
script-first review gate. Existing scripts continue to change only through the
object-scoped Request Changes path.

Cross-route creator text should not be placed in query parameters. A versioned,
discriminated navigation-state envelope can transfer the intent once, validate
length and shape, reconstruct only trusted fields, and disappear when Studio
replaces the history entry with its durable draft URL.

Async handoffs also need route ownership. A durable draft response may arrive
after the creator uses Back; success and fallback branches must both verify that
their destination is still mounted before mutating state or replacing browser
history. The regression should hold the response open, leave the destination,
then prove its eventual settlement cannot reclaim navigation.

## Follow-up

- If a truly standalone script workflow is added later, design a Creative
  Director proposal/output contract rather than extending the media-task enum.
- Keep existing-project script creation behind Request Changes or an explicit
  empty-project precondition with dependency-aware semantics.
- Preserve tests that prove the handoff does not post an asset proposal or start
  a production run before the creator completes the brief.
