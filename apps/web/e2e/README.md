# Web E2E Tests

<!-- agent-summary: This document owns Playwright coverage across the split Vite SPA and Express API. -->
<!-- agent-summary: The default suite uses local auth and starts both application servers. -->
<!-- agent-summary: Local Supabase parity runs through the dedicated local-database command. -->
<!-- agent-summary: Hosted auth and PWA checks use explicit opt-in production-preview modes. -->
<!-- agent-summary: GitHub runs E2E for runtime-affecting pull requests and main pushes. -->
<!-- agent-summary: Superseded runs cancel, jobs have a 15-minute cap, and failure reports upload. -->
<!-- agent-summary: Required checks need a successful no-op path before workflow filters are enabled. -->

This suite covers split-app browser behavior with Playwright. The mounted route
source of truth is `apps/web/src/routes/app-route-registry.ts`. It separates
route-smoke IDs from feature-flow coverage and classifies access, fixture needs,
required viewports, and allowed navigation writes. `App.tsx` renders that
registry directly, while unit parity tests keep production and development-only
paths distinct. The remote production runner remains PR 2 scope; this local
suite does not claim deployed-browser evidence.

The default mode is local auth:

```sh
pnpm --filter @popcorn/web test:e2e
```

`specs/auth-and-routing.spec.ts` verifies public authentication routes,
protected-route compatibility redirects, the branded not-found recovery page,
and protected local-mode direct loads through a deliberately delayed workspace
bootstrap. The direct-load case waits for an authoritative populated result on
Library and Activity, and proves neither route flashes a false empty state while
`/me` is pending; it does not treat the shared 180ms anti-flash interval as a
completed request.

`dashboard-cached-refresh.spec.ts` verifies Home's cold-refresh perceived
performance in a new browser document: an exact actor/workspace session snapshot
renders while the authoritative response is delayed, a failed background refresh
retains that content with an in-place retry, and a successful retry replaces it.
Pure unit coverage owns the five-minute expiry, malformed/future fail-closed
behavior, identity/workspace isolation, and omission of signed delivery URLs.

`studio-draft-opening.spec.ts` verifies a saved draft acknowledges keyboard or
pointer activation immediately, preserves focused-row semantics, fences duplicate
opens and delete races, restores the exact draft, and recovers from a failed open.
The busy state runs in Chromium plus both mobile projects.

`script-creation.spec.ts` verifies the dedicated `/create/script` outcome: calm
story intake, script-specific length choices without media-cost warnings, no
footage or production-plan UI, a project-backed script entrypoint request, and
desktop/mobile containment. Script is no longer a fourth Asset Studio choice.

`asset-studio-projects.spec.ts`, `asset-studio-review.spec.ts`, and
`asset-studio-progress.spec.ts` use browser API fixtures to verify the production
`/create/asset` route, the 30/70 desktop context-to-prompt workspace, responsive
mobile collapse, update-ordered recent-project loading/selection with real
project media, expired-poster fallback and fresh-signed-URL recovery,
default Image selection, accessible media-type targets, proposal review,
default-on image and video prompt refinement, motion-specific progress, exact
effective-prompt preview, creator bypass, draft-preserving video revision,
immediate navigation to `/create/review`, manual **Approve this** confirmation,
the visible 10-second automatic-confirmation boundary, at-most-once dispatch,
Back/Forward proposal restoration without reposting, stale-proposal recovery,
queued status, invalid review-state recovery, desktop/mobile Create and review
layouts, project-picker keyboard behavior, existing/first/new-project selection,
automatic AI-named project creation when review starts without a selection,
same-tick duplicate-submit protection, draft-preserving automatic-create
failure, stale-completion suppression after leaving Create, open-picker locking,
and project-list, proposal, confirmation, and creation failure recovery. It also
verifies that revising preserves the editable draft, failed confirmation remains
manual-only on Forward, a delayed project creation cannot override a newer
selection, and pagination failures preserve loaded projects, without spending
provider credits. After confirmation, it also covers human-readable
queued/running/terminal progress, four-role studio-crew artwork and its
production-set backdrop from compact progress-only resources, the active desktop
hierarchy (status, prominent full-width crew, supporting progress and brief),
the shared development preview at `/dev/creation-progress`, semantic
request-brief truncation, active-only indeterminate progress, reduced motion,
mobile overflow, successful asset links, and truthful failed, canceled, blocked,
and question outcomes.

`creation-entry-points.spec.ts` verifies that the desktop and
mobile shell, Dashboard, Activity, and both populated/empty Library actions use
the `/create` intent launcher; its keyboard/pointer choices reach the distinct
`/projects/new` full-video and `/create/asset` asset flows. It also covers Create
navigation ownership, mobile overflow, legacy query links, and validated legacy
draft-history restoration. A restored full-video Studio draft also proves the
generating workspace consumes the Creative Director hierarchy instead of its
legacy flat checklist.

`specs/library-collections.spec.ts` verifies that an owned generated asset's
detail viewer shows its exact attributed credit debit without spending provider
credits. Public asset viewers do not request or receive owner billing metadata.
It verifies that the project gallery and owned Library reuse the same scoped
media URL across navigation and a same-tab reload, and that an unloadable image
URL performs exactly one focused refresh to a working signed URL on desktop and
both mobile browser projects.
Project-media previews route to that same canonical viewer, including exact
asset hydration when the linked asset is outside the first workspace page; the
separate project-media selection control remains available for creation intent.
The production-shaped deep-link fixture verifies `remoteUrl` video source
normalization, and returning from preview restores the interrupted selection,
preset, and intent draft.
Owned ready assets expose a prominent exact-target **Request changes** entry
into the durable proposal lifecycle. Mobile coverage verifies its full-width
footer treatment and overflow containment; processing assets explain the
disabled state, while public assets remain read-only without the action. The
same suite covers advisory **Receive feedback** for an owned image, the
authoritative active-script endpoint's snapshot and exact asset ID, and the
selected final video. It verifies that the script preview includes narration
and dialogue, that remote-only Library media does not advertise an unavailable
critique action, and that project overview waits for that script
response and fails closed with retryable error UI when it is unavailable. It
also verifies the editable custom
question and idempotency header, the default “How can we improve upon this?”
question, structured answer rendering, sampled-video limitations, and mobile
dialog overflow without conflating feedback with Request Changes. The
same coverage protects the shared viewer's full desktop inspection height and
keeps native audio controls contained and reachable in short landscape views.
It also verifies the shared quick route-loading state on mobile, including its
180ms anti-flash threshold, accessible busy semantics, content-shaped layout
reservation, reduced motion, overflow containment, and transition into loaded
project content. A Watch-route case covers the compact panel variant. The
studio crew remains covered in `asset-studio-progress.spec.ts` for known queued/running
creative production rather than ordinary data fetches.

`project-mobile-status.spec.ts` verifies the responsive project overview keeps
one compact mobile status card, routes its current storyboard image to the
canonical asset viewer, and exposes separate desktop links for the project
poster, storyboard image, and storyboard scene navigation.

`project-upload-more.spec.ts` verifies a completed standalone media asset remains
directly viewable from the project overview on desktop and mobile after its parent
run fails. The fixture first lets polling discover the saved asset, then adds a
newer active full-video run and a newer empty standalone attempt to prove current
or unsuccessful activity does not hide the prior result. The link carries exact
project and asset identity into the canonical Library viewer.

`rerun-proposal-lifecycle.spec.ts` verifies the durable Request Changes UI
without provider spend: exact-target proposal preview, preserved/affected work,
cost approval, separate execution, waiting-state polling, reload recovery,
visible owning-surface refresh after restored completion, truthful cancellation,
terminal cleanup, keyboard focus restoration, and mobile overflow. The run and
storyboard suites also assert that their entry points open this lifecycle instead
of posting the retired reject, board-revision, or stage-restart mutations.
Run-progress and project-overview fixtures additionally cover successful
creator-direct image work as one **Image asset** activity, with asset-ready copy
and no inferred Brief, Script, or Storyboard pipeline stages. Progress output
coverage also keeps advisory feedback off queued, running, and failed items even
when their provider reservations already expose asset IDs.
`run-progress.spec.ts` also covers the full-video Creative Director projection:
Visuals/Audio lane copy and outputs, collapsed completed work, blocked and
queued states, plus the mandatory authoritative Script review and its direct
text-only rewrite request before media work. `creation-entry-points.spec.ts`
covers idea-first and script-first full-video intake at mobile width.
`storyboard-orchestration.spec.ts` covers returning to Project Detail at the
Script gate: the existing run is linked for review, duplicate storyboard
creation stays hidden, and the page does not mislabel review as generation.
The hierarchy coverage also includes root-owned specialist questions, sanitized production details,
responsive overflow, a response-driven polling transition, and the separate
server-authorized operator diagnostics disclosure on hierarchy-backed runs. A
terminal zero-session fixture prevents canceled production from reverting to
planning copy and verifies that long run-detail breadcrumbs scroll internally,
ellipsize linked labels, initially reveal the current location, and remain
contained at 390px.
Failed-run fixtures in `dashboard-indeterminate-progress.spec.ts` and
`run-progress-actions.spec.ts` additionally keep creator recovery copy aligned
with the object-scoped Request Changes flow and prevent the retired
failed-stage retry promise from returning. The separate insufficient-credit
continuation remains implemented because it owns a real recovery mutation;
unit coverage gives that direct continuation priority over generic Request
Changes guidance.
The same dashboard fixture asserts semantic **Status updated** `<time>` elements
for active and failed cards; deterministic unit tests own relative-time
thresholds, clock skew, invalid values, and absolute-date fallback.

`landing-mobile.spec.ts` keeps the mobile landing inside the viewport with a
tappable primary CTA. `landing-agent-content.spec.ts` protects the landing
page's agent-architecture content contract on desktop and both mobile browser
projects: the creative-director-with-specialists section, the workflow copy in
which the director delegates to visuals and audio specialists with current
providers (Gemini Veo, ElevenLabs), the agent-crew FAQ, mobile overflow
containment, and the absence of retired provider copy such as Sora.

The command starts the Express API and Vite app, using:

- `AUTH_MODE=local`
- `VITE_API_URL=http://127.0.0.1:4180`
- `WEB_ORIGIN=http://127.0.0.1:3100`

The API still uses the current Supabase-backed store in local auth mode, so the
repo's normal local Supabase service-role env must be available for assertions
that resolve `/api/v1/me`. Route and health checks still run without those
secrets.

For a true local-first database run, start and reset the Supabase CLI stack,
then use the local DB E2E command:

```sh
pnpm db:local:start
pnpm db:local:reset
pnpm test:e2e:local-db
```

That command wraps Playwright with `scripts/with-local-supabase-env.mjs`, reads
the local URL and keys from `supabase status -o json`, sets
`DB_BACKEND=supabase`, and loads `apps/web/e2e/e2e.local-db.env`. Unlike the
fast local-auth suite, it runs `AUTH_MODE=supabase` and signs up a real local
user to cover the production authentication path.

Hosted Supabase auth is opt-in and skipped unless all required secrets are
present:

```sh
POPCORN_E2E_SUPABASE_EMAIL=qa@example.com \
POPCORN_E2E_SUPABASE_PASSWORD='...' \
VITE_SUPABASE_URL='...' \
VITE_SUPABASE_ANON_KEY='...' \
SUPABASE_URL='...' \
SUPABASE_SERVICE_ROLE_KEY='...' \
pnpm --filter @popcorn/web test:e2e:hosted
```

Hosted mode builds the app and serves it through `vite preview` so protected
routes run with `import.meta.env.DEV === false`; this keeps the dev autopilot
path out of the hosted auth assertions.

PWA regressions also run against a production preview build because service
worker registration is gated behind `import.meta.env.PROD`:

```sh
pnpm --filter @popcorn/web test:e2e:pwa
```

That command validates the web app manifest, confirms the share-target service
worker registers, and simulates the OS share-target POST with a fixture file.

The release-identity route boundary has a focused local production-build check:

```sh
pnpm --filter @popcorn/web test:e2e:production-build
```

It verifies the build emits a typed `/release.json` and that `/dev/*` resolves
through the production catch-all without importing a development harness.

## GitHub Actions runner policy

The `Web E2E` workflow runs for pull requests and `main` pushes that include
runtime-affecting files. Changes made only to Markdown files and `.agent/**`
records skip the workflow. A newer commit to the same pull request or branch
cancels its superseded run, and each job has a 15-minute runner budget.
Playwright reports upload only after an ordinary test failure; cancellation or
job timeout may end before an artifact can be preserved.

The workflow-level path filter is safe while Web E2E is not a required branch
check. Before making it required, replace the filter with a path-classifier or
no-op job that reports success for documentation-only changes; otherwise GitHub
can leave the required check absent or pending.

Use `PLAYWRIGHT_WEB_PORT` or `POPCORN_E2E_WEB_PORT`, and
`POPCORN_E2E_API_PORT`, to override the default ports when running beside
another local stack.
