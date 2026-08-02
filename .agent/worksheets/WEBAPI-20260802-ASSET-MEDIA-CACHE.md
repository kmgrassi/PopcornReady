# Worksheet: WEBAPI-20260802-ASSET-MEDIA-CACHE

<!-- agent-summary: Repair private asset delivery when stored bytes are missing or signed URLs expire. -->
<!-- agent-summary: Project media and Library share one auth-and-workspace-scoped TanStack media cache. -->
<!-- agent-summary: Signed list JSON remains no-store while immutable media bytes receive visibility-aware cache metadata. -->
<!-- agent-summary: The focused media refresh verifies S3 existence without adding HEAD fanout to list endpoints. -->
<!-- agent-summary: Expiry-aware refresh runs before private URLs expire and retries each failed URL at most once. -->
<!-- agent-summary: Validate API, storage, web, Playwright, and live desktop/mobile application paths. -->
<!-- agent-summary: Use worksheet/WEBAPI-20260802-ASSET-MEDIA-CACHE as the git tag after completion. -->

## Goal and acceptance criteria

Make project and workspace asset media reliable across navigation, reload, and
signed-URL expiry. Detect missing managed bytes on the focused refresh path,
reuse media state across project media and Library, preserve real expiry
metadata, refresh shortly before expiry, retry a failed URL once, prevent stale
signed JSON caching, and give immutable S3 objects visibility-aware cache
metadata that is rewritten correctly during visibility moves.

## Context and source-of-truth documents

- `AGENTS.md`, `AGENT_WORKFLOW.md`, `CLAUDE.md`, `docs/repository-structure.md`
- `apps/web/PRODUCT.md`, `apps/web/DESIGN.md`, `docs/ui-interaction-model.md`
- `docs/supabase-identity-and-rls.md`, `docs/scopes/database-access-boundary.md`
- `docs/scopes/public-private-asset-storage.md`, `docs/scopes/media-viewing.md`
- `docs/testing/e2e-test-inventory-and-gaps.md`, `apps/web/e2e/README.md`
- `docs/agent-system/performance-and-visual-regression.md`
- Impeccable product-interface and in-app Browser instructions

## Decisions

- Keep asset list endpoints free of S3 `HeadObject` fanout. Only the focused
  authenticated `/assets/:assetId/media` refresh verifies managed objects.
- Treat an S3 404/`NoSuchKey` as missing media, but propagate IAM and network
  failures rather than misclassifying them as missing bytes.
- Scope canonical client media state by auth identity, workspace, and asset id.
- Use nullable expiry: stable public/remote media does not pretend to expire;
  private signed media uses the earliest expiry of its main and thumbnail URLs.
- Cache immutable public bytes as public and immutable private bytes as private;
  visibility copies rewrite the destination directive instead of preserving the
  source visibility's cache policy.
- Do not claim CloudTrail deletion evidence: S3 data events were not shown to be
  enabled, so an empty lookup is only a recorded limitation.

## Changes

- Added visibility-aware immutable S3 cache metadata to server writes,
  presigned direct uploads, and the shared metadata-preserving copy path.
- Made regeneration mint a fresh storage object id before writing replacement
  bytes so immutable cache entries are never overwritten.
- Added focused, privacy-safe managed-object verification and withheld missing
  or bucketless managed rows without hiding IAM/network failures.
- Preserved nullable signed URL expiry through shared/API response types and
  both project/workspace list projections; signed list JSON is private/no-store.
- Added one auth/workspace/asset-scoped TanStack media query shared by the
  project gallery and owned Library, with version/visibility-aware same-tab
  persistence, five-minute proactive refresh for selected media, and a shared
  concurrent one-error retry boundary.
- Visibility mutations clear persisted credentials and invalidate canonical
  media state. Managed signing failures cannot fall back to legacy public URLs.
- Added unit, route-policy, storage, and Playwright regression coverage and
  updated the owning storage/media/testing documentation.

## Validation evidence

- Live AWS read-only audit: the reported object key is absent from both
  `popcornready-assets-private` and `popcornready-assets-public`, with no other
  object under the asset-id prefix. CloudTrail lookup returned no event, which
  is inconclusive without S3 data-event logging.
- Authenticated production API projection: asset
  `e563b9e3-ee9f-44c1-9759-f3b3ef5fda5c` stores the legacy logical
  `storageBucket: assets-public`; both the asset and project are public. Its
  `updatedAt` is `2026-07-16T12:31:02.715Z`, within seconds of creation, so the
  row shows no recent visibility mutation. Direct action-table history remains
  blocked because this worktree has no production Supabase credentials.
- API/web type checks pass. Targeted API storage/media/visibility tests pass.
  Web unit tests pass, 65/65 after merging current main (including scope,
  version mismatch, expiry, persistence,
  concurrent retry dedupe, and stop-after-refreshed-failure guards).
- Playwright `library-collections.spec.ts` passes 6/6 in Chromium; its tagged
  failed-media recovery passes in mobile Chrome and mobile Safari (8/8 total).
- Final post-merge `pnpm agent:validate -- --scope all` passes.
- Manual local browser verification against the Vite app and deterministic
  same-origin API fixture:
  - Desktop 1440×1000: `/projects/proj-alpha/media` rendered the project-signed
    URL; `/library/assets` reused that exact URL instead of its list projection.
    A separate 404 asset made one focused request and rendered the fresh URL.
  - Mobile 390×844: both project media and Library retained the cached/fresh
    URLs after reload, with document width equal to viewport width (390px).
  - Transient focused refresh: a 503 rejected visibly to the query boundary,
    released the failed-URL guard, and the next error event retried successfully;
    the asset rendered the fresh URL with no browser console error.
- The full API suite remains red only on four unrelated baseline failures:
  two stale guest-retention migration filenames, graph-snapshot expectation
  drift, and the public-project UUID-shape assertion.

## Independent reviews

- Research review: `/root/research_review` mapped the duplicate signing paths,
  missing expiry propagation, cache-hostile URLs, and incomplete error refresh.
- Plan review: `/root/research_review` required nullable real expiries,
  auth/workspace isolation, scheduled refresh rather than stale-time alone,
  per-failed-URL retry guards, visibility-aware cache metadata, focused-only S3
  verification, and explicit live-audit limitations. The plan adopts these.
- Implementation review: `/root/research_review` found managed-URL fallback,
  concurrent retry, persisted-version, viewer retry, copy-path duplication,
  direct-upload signing, timer-coverage, route-header, and bucketless-row gaps.
  The implementation resolves each safety/correctness issue; direct PUT remains
  an API/storage-smoke contract rather than an active SPA upload path.
- Wrap-up review: `/root/research_review` approved the final load-success retry
  release for image, video, and audio, the owned-only query wiring, truthful E2E
  documentation, and the complete diff with no remaining blocker.
- PR follow-up review: the unresolved P2 correctly identified that TanStack
  `refetch()` can resolve with stale cached data after a request error. The
  focused refresh now throws on request errors, releases the failed URL guard,
  and has a regression test proving a later retry remains available.
- Follow-up wrap-up review: `/root/research_review` approved the README merge,
  throwing focused refetch, rejection cleanup, regression coverage, manual
  browser evidence, and documentation with no remaining blocker.

## Blockers and risks

- The reported object bytes are absent from both buckets and cannot be restored
  from a visibility move. The row needs regeneration or restoration from its
  recorded storyboard provenance.
- One-year immutable caching is safe only while asset byte changes mint a new
  asset/version key. Validation must confirm no overwrite path violates this.

## Next action / handoff

Commit and push the current-main merge and review fix, then resolve the addressed
review thread on PR #878. The missing production asset remains an operational
regeneration/restoration follow-up.
