# Feedback: API-20260805-EMBEDDING-GRAPH-KIND

<!-- agent-summary: Task feedback for preserving graph identity at the embedding boundary. -->
<!-- agent-summary: Media-shaped compatibility projections must not become semantic identity sources. -->
<!-- agent-summary: Re-read immutable database identity before enqueueing or processing derived work. -->
<!-- agent-summary: Required private types are safer than optional public compatibility fields. -->
<!-- agent-summary: Preserve hash formats when correcting identity to bound provider backfill cost. -->
<!-- agent-summary: Tests should use conflicting role and provenance to prove persisted identity wins. -->
<!-- agent-summary: This feedback ships with worksheet API-20260805-EMBEDDING-GRAPH-KIND. -->

## Task

Carry persisted graph identity through the production embedding boundary.

## What worked

- A private persisted-source contract fixed the bug without versioning the
  public V1 asset response.
- Injecting only the source loader gave the job path a provider-free assertion
  without introducing a broad dependency container.

## Friction

- Two embedding source builders exist, and only one is active in production.
  Tests for the newer shared builder did not protect the worker using the older
  builder.
- The worktree initially lacked installed dependencies, so the focused test
  runner was unavailable until a frozen-lockfile install.

## Follow-up improvement

- Converge on one embedding source builder through an explicitly versioned
  source-rule/backfill plan so hash and provider-cost changes are deliberate.
- Generate database vocabulary types and use them to retire handwritten graph
  kind unions incrementally.
