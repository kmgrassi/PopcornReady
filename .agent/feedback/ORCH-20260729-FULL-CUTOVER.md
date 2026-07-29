# Feedback: ORCH-20260729-FULL-CUTOVER

<!-- agent-summary: Task-scoped feedback for the Creative Director full production cutover. -->
<!-- agent-summary: Production architecture defaults should be encoded in code, not depend on an opt-in variable. -->
<!-- agent-summary: Per-run profile pinning keeps active work stable across rollout changes. -->
<!-- agent-summary: An emergency fallback must be explicit, observable, and automatically expiring. -->
<!-- agent-summary: Empty production environments can use controlled live testing instead of pre-cutover soak gates. -->
<!-- agent-summary: Health verification proves routing selection without incurring provider spend. -->
<!-- agent-summary: Full provider-backed behavior still needs an intentional controlled production test. -->

## Lesson

Once an architecture is accepted as the production path, making it the code
default avoids an absent or stale environment variable silently restoring the
retired behavior.

## Follow-up

Exercise a controlled full-video project, Request Changes paths, and export in
production, then decide whether to remove the remaining flat fallback.
