# Mobile minimal redesign — making the PWA feel like a real mobile app

**Status:** Proposal (2026-07-07)
**Owner:** —
**Applies to:** `apps/web` (Vite SPA / PWA), all authenticated mobile surfaces

## The problem

The recent mobile work (drawer nav #704, camera/library upload #690, PWA share
target #676, background upload queue #709, device testing loop #692) made the
app *work* on phones. It does not yet *feel* like a phone app. The reference
bar is Uber, Robinhood, and Google Photos: at any moment you know exactly where
you are, there is one obvious thing to do, and everything else is a tap away —
not on screen.

Today the mobile experience is the desktop experience squeezed into one column.
Almost every `@media` block in the app resolves to
`grid-template-columns: 1fr`, so a phone user gets every desktop panel, stat
tile, section header, and side rail — stacked into a very tall scroll. That is
the opposite of minimal: the information didn't get prioritized, it got
rearranged.

### Audit findings (what's actually on screen today)

1. **Desktop panels merely stacked.** `ProjectDetailPage` is the worst case:
   a `repeat(4, 1fr)` stats grid, a `repeat(3, 1fr)` grid, a two-column page
   layout, a hero grid, and a context grid all flatten into one column across
   three cascading breakpoints (1100/900/760px in
   `ProjectDetailPage.module.css`). The stage side-panel just reorders
   (`order: -1`) instead of becoming an on-demand surface.
2. **Generation progress is over-dense.** `ProgressView.tsx:601–648` renders a
   status panel with up to five labeled fields (Status, Last completed, Current
   step, Next step, Progress) plus a meter — then the asset grid, the pipeline
   stage rail, and diagnostics all pile below it at ≤920px.
3. **Too many simultaneous decisions in the review gate.**
   `ReviewGatePanel.tsx:218–247` puts a 6-field brief card, a feedback
   textarea, and three stacked full-width buttons (Stop here / Request changes
   / Approve and continue) on screen at once. Miller's-law budget for a
   decision point is ~4 items; this is well past it.
4. **Hamburger drawer instead of visible navigation.** Primary nav is only two
   items (`PRIMARY_NAV` in `AppLayout.tsx:44` — Library, Inspiration) plus the
   "Create new video" action, yet all of it hides behind a 40×40 hamburger
   (below the 44px touch guideline) at the *top* of the screen — the hardest
   place to reach one-handed.
5. **Ad-hoc breakpoints everywhere.** At least ten distinct max-widths
   (360, 460, 560, 640, 680, 720, 760, 860, 900, 920, 980, 1100) with no shared
   token. The shell collapses at 860px while pages collapse at 760/900/920px,
   so the app changes shape at different widths per screen.
6. **Horizontal-scroll rows on the dashboard.** `RecentOutputsStrip` is a
   side-scroller — a desktop pattern that fights one-handed thumb use.
7. **Incomplete safe-area handling.** Only the shell uses
   `env(safe-area-inset-*)` (`AppLayout.module.css:369,423`); `index.html`
   lacks `viewport-fit=cover`, so the fixed bottom intent bar in
   `ProjectMediaGalleryPage` and the watch screen collide with the home
   indicator on notched devices.

One genuine strength to preserve: this is a single responsive codebase, not a
stripped mobile bundle. Camera capture, library upload, share-target, and the
background upload queue are real mobile-first features. The fix is
**subtraction and prioritization**, not a rewrite.

## What "minimal" means here (the reference apps, decoded)

The apps the team is pointing at share four structural moves, and none of them
are about visual styling:

| Pattern | Uber | Robinhood | Google Photos | Popcorn Ready translation |
|---|---|---|---|---|
| **Bottom tab bar, ≤4 tabs** | Home / Services / Activity / Account | Home / Investing / Discover / Account | Photos / Collections / Search | Library / Create / Activity / Account |
| **One screen = one job** | The map + "Where to?" — nothing else | One chart + one Buy button | The grid, edge to edge | Project screen = the video + its status + one next action |
| **Status as a sentence, not a dashboard** | "Your driver is 3 min away" | "+$12.40 today" | "Backing up 3 items" | "Generating your storyboard — about 2 min left" |
| **Depth via sheets, not stacking** | Trip details slide up | Stock details slide up | Photo info slides up | Stage details / provenance slide up on demand |

This also maps directly onto our own design principles: "Calm by default,
depth on demand" (PRODUCT.md principle 3) and the observe-first dashboard
(docs/ui-interaction-model.md). The mobile view should be the *most*
observe-first surface we have — a creator on a phone is reviewing and nudging,
never operating.

## Recommendations

Ordered by impact. P0 items change how the app fundamentally feels; P1 items
finish the job; P2 items are polish.

### P0-1 · Replace the hamburger drawer with a bottom tab bar

We have exactly the right amount of navigation for a tab bar and we hid it.

- **Tabs (4):** `Library` · `Create` · `Activity` · `Account`.
  - *Library* → `/projects` (current Library).
  - *Create* → the new-video entry point. This is the screen's popcorn-gold
    element — the mobile equivalent of the sidebar's "Create new video"
    button, satisfying the One Gold Rule.
  - *Activity* → active runs / recent generations (the content of
    `ActiveRunsPanel` + `RecentOutputsStrip`, given a real home). Badge it
    while a run is live — this is the "your driver is 3 min away" surface.
  - *Account* → credits, settings, theme, FAQ, admin (for operators).
    Inspiration moves here or into Library as a filter — it does not earn a
    tab.
- Fixed to the bottom, 44px+ targets, `env(safe-area-inset-bottom)` padding,
  icon + label (never icon-only — recognition over recall).
- The top bar shrinks to: screen title + contextual back. `CreditsBadge`
  moves into Account (Robinhood does not show buying power in the nav bar).
- Keep the drawer code path for tablet/desktop-narrow if needed, but ≤640px
  the tab bar is the navigation. Delete the mobile hamburger.

*Files:* `AppLayout.tsx` (new `MobileTabBar` alongside
`AuthenticatedAppLayout`), `AppLayout.module.css`. Route additions for
`Activity` can reuse existing dashboard panels.

### P0-2 · One screen = one job: rebuild the mobile project screen as a "status card," not a stacked dashboard

On mobile, `ProjectDetailPage` should render a different composition, not the
same composition in one column:

1. **Hero:** the latest visual (keyframe/clip/poster), edge to edge.
2. **One status sentence:** "Generating storyboard — 2 of 6 stages" with a
   single progress bar. Not the 4-up stats grid, not the context grid.
3. **One primary action:** whatever the pipeline needs next — `Review
   storyboard`, `Watch`, or `Request changes`. One popcorn-gold button in the
   thumb zone.
4. **Everything else behind disclosure:** scenes/beats/panels, stage history,
   provenance, and uploads live in either (a) a segmented control of 2–3
   views, or (b) bottom sheets opened from the hero. The stage rail becomes a
   "View stages" sheet.

The desktop layout keeps its density — this is a mobile composition switch
(CSS reordering won't get there; it needs a `useIsMobile`-style branch or a
mobile-specific child component tree).

*Files:* `ProjectDetailPage.tsx` + module CSS; extract the status sentence
from existing run state (already computed for `ProgressView`).

### P0-3 · Collapse the progress view to a single narrative

`ProgressView` on mobile should read like Uber's trip screen:

- Replace the five-field status panel with **one line + one meter**:
  "Rendering scene 3 of 5 · about 4 min left." Last/next step are one-liners
  under it at most, not labeled grid cells.
- The stage rail becomes a collapsed **"Show pipeline"** sheet/accordion —
  this keeps "show the work, never the slot machine" (provenance one tap
  away) without front-loading it.
- Diagnostics are operator depth: hidden behind the same sheet, never inline
  on mobile.

*Files:* `ProgressView.tsx`, `ProgressView.module.css` (the 920px block
becomes a real recomposition, not a column collapse).

### P0-4 · Simplify the review gate to one decision

`ReviewGatePanel` currently asks the user to read six fields, consider a
textarea, and choose between three buttons. Restructure:

- **Primary:** `Approve and continue` (gold, full-width, bottom).
- **Secondary:** `Request changes` — tapping it *reveals* the feedback
  textarea (or opens the Request Changes sheet), rather than showing an empty
  textarea up front.
- **Stop here** moves to an overflow/"more" affordance. It's a rare,
  destructive-ish action and doesn't deserve equal billing.
- The 6-field brief card becomes 2–3 fields visible (Hook, Big idea) with
  "Show all" disclosure.

This aligns the mobile gate with the product rule that the agent is the single
edit path — the gate becomes "looks good / needs changes," which is exactly
the review-and-nudge posture PRODUCT.md describes.

*Files:* `ReviewGatePanel.tsx`, `ReviewGatePanel.module.css`; the lighter
`GateCard` in `StudioShell.tsx:712–735` already has the right shape — converge
on it.

### P1-1 · Standardize breakpoints and touch targets as tokens

- Add to `tokens.css`: `--bp-mobile: 640px`, `--bp-tablet: 900px` (values to
  be agreed — the point is *two* breakpoints, not twelve). Custom media via
  PostCSS (`@custom-media --mobile (max-width: 640px)`) keeps modules clean.
- Migrate the ad-hoc 360–1100px queries screen by screen; shell and page
  should change shape at the same width.
- Enforce `min-height: 44px` / `min-width: 44px` on all interactive elements
  at mobile widths in `base.css` (the token/base/utility layer), instead of
  the current per-component opt-ins. Per the styling guidance in `AGENTS.md`,
  do **not** add this to the legacy `globals.css` monolith — it is retired
  and must not grow; component-specific sizing belongs in co-located
  `*.module.css`. Fix the 40×40 hamburger (or delete it per P0-1).

### P1-2 · Make the dashboard a feed, not a panel collection

`LaunchpadPage` on mobile should be: one hero next-action card, then a single
vertical list of projects/outputs (Google Photos: the grid IS the app).

- Kill the horizontal `RecentOutputsStrip` on mobile; recent outputs become
  the top of the vertical feed or live in the Activity tab.
- `OverviewStats` (counts row) is dashboard furniture — drop it from the
  mobile composition entirely. Nobody opens Uber to see how many trips
  they've taken.

*Files:* `LaunchpadPage.tsx`, `RecentOutputsStrip.*`, `OverviewStats.*`.

### P1-3 · Safe areas and standalone-display polish

- Add `viewport-fit=cover` to the viewport meta in `index.html` (without it,
  the `env(safe-area-inset-*)` values are always 0 in standalone mode).
- Apply `env(safe-area-inset-bottom)` to: the new bottom tab bar, the
  `ProjectMediaGalleryPage` intent bar, and the watch screen controls.
- Audit for 100vh usage → prefer `100dvh` on mobile (URL-bar collapse).

### P1-4 · Media gallery goes full Google Photos

`ProjectMediaGalleryPage` is closest to the reference already. Push it:
edge-to-edge thumbnail grid (no card chrome per tile), tap → full-screen
viewer with swipe, info/provenance as a slide-up sheet, selection via
long-press. The existing bottom intent bar is the right instinct — give it
safe-area padding and make it the only chrome on screen.

### P2-1 · Studio wizard: one step per screen

On mobile, `StudioShell`'s persistent stepper + step body + review split
competes for vertical space. Collapse the stepper to a thin progress indicator
("Step 2 of 4 · Brief") and give each step the full viewport. Back is in the
top bar; the step's single CTA is at the bottom.

### P2-2 · PWA install prompt

There is no `beforeinstallprompt` handling. Add a quiet, dismissible "Add to
home screen" affordance in Account (not a popup on first visit — calm by
default).

### P2-3 · Motion for state, 150–250ms

Sheets slide up, tab transitions crossfade, progress meters animate width —
all with `prefers-reduced-motion` fallbacks. No page-load choreography.

## Guardrails (what NOT to do)

- **Don't fork a mobile app.** One codebase, one component tree; mobile
  compositions are branches inside existing routes, not `/m/*` routes. The
  `/dev/*` harness routes (#696) stay dev-only.
- **Don't add edit controls while simplifying.** Minimal ≠ more inline
  editors. Every mobile surface stays read-only + "Request Changes"
  (ui-interaction-model.md); if anything, mobile is where observe-first is
  easiest to honor.
- **One gold per screen.** The tab bar's Create action, the project screen's
  next-step button, the gate's Approve — never two at once.
- **Don't hide the pipeline, defer it.** "Show the work" survives as
  one-tap-away sheets with full stage/provenance detail — reachable, not
  front-loaded. Operators still get density on desktop.
- **Keep the warm dark surface.** Minimal is composition and hierarchy, not a
  gray-out. Tinted neutrals, popcorn-gold CTA, editorial type per DESIGN.md.

## Suggested sequencing

| Phase | Scope | Outcome |
|---|---|---|
| 1 | P0-1 bottom tabs + P1-1 breakpoint/touch tokens | The app *navigates* like a mobile app |
| 2 | P0-2 project status card + P0-3 progress narrative | The core loop (watch it generate) feels calm |
| 3 | P0-4 review gate + P1-2 dashboard feed | The decision surfaces are one-tap |
| 4 | P1-3 safe areas + P1-4 gallery + P2-x | Native-feel polish |

Each phase is independently shippable and testable with the existing
`@mobile` Playwright projects (iPhone 13 / Pixel 7, #695) and the device loop
(#692). Add a viewport-overflow assertion (from `landing-mobile.spec.ts`) to
every authenticated screen as each phase lands.
