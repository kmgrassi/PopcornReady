# Mobile Emulation & PWA Testing Harness — Scope & PR Plan

## Objective

Make the **progressive mobile experience testable without a phone in hand** —
for developers, for agents verifying changes, and for CI — and make the
things that *do* require a phone one-tap cheap. The mobile scopes
([mobile-landing-upload.md](mobile-landing-upload.md),
[media-gallery-intent-actions.md](media-gallery-intent-actions.md)) and the
already-shipped PWA share target (PR #676: `manifest.webmanifest`,
`share-target-sw.js`, icons) are only trustworthy if the mobile experience is
exercised continuously, not on a borrowed iPhone once a quarter.

## Can you simulate mobile in the browser? (the fidelity ladder)

Yes — at four levels, each catching what the previous one can't:

| Level | What it is | What it proves | What it can't prove |
| --- | --- | --- | --- |
| 1. DevTools device mode | Chrome/Edge device toolbar: viewport, touch events, UA, DPR, network throttling | Responsive layout, touch targets, thumb-reach bars; manifest + service worker inspectable in the Application panel | Rendering engine is still desktop Blink; no real Safari behavior, no native pickers |
| 2. Claude Preview / dev harness | `preview_resize` mobile preset (375×812, dark) over mock-data `/dev/*` routes | Pure UI states quickly, no backend needed; what agents use to verify PRs in-session | Interaction fidelity limited; mock data only |
| 3. Playwright device profiles | `devices["iPhone 13"]` etc. — viewport + touch + UA **on the WebKit engine** | The closest thing to iOS Safari without hardware: WebKit rendering/JS quirks, mobile flows scripted end-to-end, runs in CI | Installed-PWA behaviors (share target invocation, A2HS), real camera/photo picker |
| 4. Real device via deploy preview | Netlify already posts a **deploy-preview URL on every PR** — open it on a phone; HTTPS is included, so PWA install + share target work | Everything: share sheet entry, camera roll, HEVC capture, real uplink | Nothing — this is ground truth, kept cheap |

The honest gaps at levels 1–3, so nobody is surprised: the **native share
sheet** (share target requires an installed PWA on a real device — though the
share-target service worker's *handling* can be simulated by POSTing to its
route), the **camera-roll picker / `capture` attribute**, HEVC/HEIC files
produced by real iPhone cameras (covered by fixtures instead), and true
background-tab/App-switch behavior.

## Current state (verified)

- **PWA foundation shipped** (PR #676): `apps/web/public/manifest.webmanifest`,
  `share-target-sw.js`, `icon-192/512.png`, manifest `<link>` in
  `index.html`. Nothing tests it — a manifest typo or SW registration break
  would ship silently.
- **Playwright is installed and wired** (`apps/web/playwright.config.ts`,
  `e2e/` specs for auth, run-progress, API routing) but the only project is
  `devices["Desktop Chrome"]` — zero mobile coverage.
- **A `/dev` route pattern exists** (`apps/web/src/routes/dev/` —
  DesignSystemPage, GenerationCardsPage) for mock-data UI harness pages.
- **Claude Preview caveat** (session memory): vite hardcodes port 3000 and
  turbo swallows `PORT` — run `npm --prefix apps/web run dev` (bypass turbo)
  for preview sessions.
- **Netlify deploy previews already post on every PR** (netlify bot) — the
  real-device path exists today; it's just undocumented as a testing step.

## PR plan

### PR 1 — Playwright mobile device projects

**Scope:** add two projects to `apps/web/playwright.config.ts`:
`mobile-safari` (`devices["iPhone 13"]`, WebKit) and `mobile-chrome`
(`devices["Pixel 7"]`, Chromium) — viewport, touch, UA, DPR all come with the
profile. Tag mobile-critical specs (landing, upload entry, gallery/intent bar
as those ship) to run under all three projects; desktop-only specs stay
scoped. Add `test:e2e:mobile` script. Install the WebKit browser in CI.

**Tests (this PR is tests):** existing landing/run-progress specs green under
both mobile projects; one new spec asserting no horizontal scroll and a
tappable primary CTA at 390×844 on the landing page.

**Done when:** `npm run test:e2e:mobile` exercises the core flows on WebKit +
mobile Chromium locally and in CI.

### PR 2 — PWA regression spec (manifest + service worker + share target)

**Scope:** a Playwright spec that: fetches `/manifest.webmanifest` and
validates required fields (name, icons incl. 192/512, `start_url`,
`display`, `share_target` declaration); asserts the share-target service
worker registers successfully; **simulates a share** by POSTing a fixture
file to the share-target route the way the OS would and asserts the handler
responds/redirects into the upload flow. This is the level-3 stand-in for the
uninvokable native share sheet.

**Must run against a production build, not the dev server.** SW registration
is gated on `import.meta.env.PROD` (`apps/web/src/main.tsx:19`), while the
default local Playwright web server runs `vite` dev — so this spec would fail
under the dev server for reasons unrelated to the PWA. The config already
contains the needed mechanism: hosted mode's web server runs
`vite build && vite preview` (`apps/web/playwright.config.ts:85`). Add a
dedicated `pwa` Playwright project that always uses the build+preview server
command (regardless of auth mode) and scope this spec to it; keep it out of
the dev-server projects. CI runs the `pwa` project alongside the mobile
projects.

**Tests:** the spec itself + a deliberate-breakage check in review (rename an
icon → CI red; and confirm the spec fails-loud, not skips, if accidentally
run under a dev server — assert on `import.meta.env`-visible build mode or SW
registration state rather than silently passing).

**Done when:** a manifest typo, SW registration failure, or share-target
route regression fails CI instead of shipping.

### PR 3 — Mobile dev harness routes (mock-data, agent-verifiable)

**Scope:** extend the `/dev` pattern with mock-data harness pages for the
mobile surfaces as they ship: `/dev/landing-upload` (upload states: queued/
uploading/progress/failed-retry), `/dev/media-gallery` (tiles in all statuses,
numbered ordered selection, intent bar with presets) — pure UI, fixture data,
no backend. These are what Claude Preview sessions and quick human checks
use; dev-only routes, excluded from production builds.

**Tests:** unit — dev routes render fixture states; excluded from prod bundle
(build-time env gate). Preview verification at mobile viewport is the point
of the PR.

**Done when:** an agent (or human) can open `/dev/media-gallery` at 375×812
and see every UI state without seeding a backend.

### PR 4 — Real-device testing loop, documented + smoothed

**Scope:** a `docs/manual-tests/mobile-device-checklist.md` covering: open
the PR's Netlify deploy preview on iPhone/Android; install the PWA (A2HS);
verify share-sheet entry ("Share → Popcorn Ready" with a camera-roll video);
camera `capture` recording; upload over cellular; background-mid-upload
resume. Plus local-network device testing for pre-PR work: `vite --host`
+ trusted local HTTPS (mkcert) — required because PWA features demand a
secure context off-localhost — with the setup scripted
(`npm run dev:device`).

**Tests:** the checklist itself (living doc, linked from PR template for
mobile-touching changes); the `dev:device` script verified on macOS + iPhone
on the same network.

**Done when:** "test it on your phone" is a two-minute loop (deploy preview
for PRs, `dev:device` for local), not an infrastructure project.

## Out of scope

- Device farms (BrowserStack/Sauce) — revisit only if WebKit emulation +
  deploy-preview-on-phone prove insufficient.
- Native app shells / app-store packaging.
- Performance budgets/Lighthouse CI — worthwhile, separate scope.

## Open questions

- Should the mobile Playwright projects run on every PR or nightly + on
  `apps/web` changes only? (Suggest: mobile projects on `apps/web`-touching
  PRs, full matrix nightly — WebKit runs are slower.)
- Fixture set for share-target simulation: reuse the media fixtures from the
  upload scopes (portrait MP4, HEVC `.mov`, HEIC) so the same known-answer
  files flow through every layer?
