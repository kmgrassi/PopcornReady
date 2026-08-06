# Feedback: WEB-20260804-PROD-BROWSER-FIXES

<!-- agent-summary: Anti-flash loading states require outcome-based manual assertions. -->
<!-- agent-summary: A temporarily absent loading label is not proof that a query has finished. -->
<!-- agent-summary: Production observations should wait for data, an empty state, or an error state. -->
<!-- agent-summary: Network preflight responses must not be mistaken for application responses. -->
<!-- agent-summary: Product copy must not promise recovery controls that the route no longer owns. -->
<!-- agent-summary: Wildcard routes need durable recovery actions rather than migration commentary. -->
<!-- agent-summary: Browser regression fixtures can preserve lessons learned without changing correct runtime code. -->

## Lesson

Manual checks around anti-flash loading UI must wait for an authoritative
terminal state: expected data, an intentional empty state, or a visible error.
Checking that a loading label is absent immediately after navigation can sample
the deliberate pre-skeleton delay and produce a false empty-page finding.
Likewise, a `204` observed in browser network events may be a CORS preflight;
request method and the eventual application response must be distinguished.

## Follow-up

Keep production browser test notes explicit about the selector or state that
ended each wait. Prefer direct assertions against known safe read data for
managed QA identities, and retain a deterministic fixture that proves delayed
auth/bootstrap data ultimately renders.

When resolving a merge, also search incoming tests and documentation for the
behavior replaced by the conflict resolution. Git correctly identified the
route mount overlap, but it could not identify main's new production-build test
that still asserted the retired placeholder. Semantic conflict review must
extend beyond files containing conflict markers.
