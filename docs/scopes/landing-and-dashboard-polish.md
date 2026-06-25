# Scope: Landing + Dashboard polish (parallelizable)

Status: ready for parallel execution
Owner surface: `apps/web` — two surfaces:
- **Landing** — the public marketing page rendered by `apps/web/src/routes/HomePage.tsx` (register: brand)
- **Dashboard** — the authenticated "Home"/Launchpad rendered by `apps/web/src/routes/LaunchpadPage.tsx` + `components/home/*` (register: product)

Source of truth: [`apps/web/PRODUCT.md`](../../apps/web/PRODUCT.md),
[`apps/web/DESIGN.md`](../../apps/web/DESIGN.md)

## How this scope was produced (repeatable process)

Each surface went through the Impeccable `critique` flow, which is three pieces —
run them again on any surface to extend this doc:

1. **Deterministic scan (Assessment B):**
   `node .claude/skills/impeccable/scripts/detect.mjs --json <markup files/dirs>`
   (pass `.tsx`/markup, not CSS-only files).
2. **LLM design review (Assessment A):** an independent reviewer reads the source
   + `PRODUCT.md`/`DESIGN.md` and scores Nielsen's 10 heuristics, cognitive load,
   states, persona red flags. Kept isolated from the detector until synthesis.
3. **Persist the snapshot:**
   `IMPECCABLE_CRITIQUE_META='{...}' node .claude/skills/impeccable/scripts/critique-storage.mjs write <slug> <body-file>`
   (`slug` computes the id, `trend <slug> 5` shows score history).

Synthesis = weave A+B → priority issues → partition into **file-disjoint
workstreams** (below). Baseline snapshots live in `apps/web/.impeccable/critique/`.

| Surface | Score | P1s | Snapshot slug |
|---|---|---|---|
| Landing (HomePage) | 31/40 | 3 | `apps-web-src-routes-homepage-tsx` |
| Dashboard (Launchpad) | 27/40 | 4 | `apps-web-src-routes-launchpadpage-tsx` |

## DESIGN.md rules being enforced (both surfaces)

- **The One Gold Rule** — exactly one popcorn-gold (`--accent`/`--cta`) fill per
  screen. Landing has 3–4; dashboard has 2 (banner + hero) for anonymous users.
- **Focus ring everywhere** — `box-shadow: var(--ring)` on `:focus-visible` for
  every interactive element. (Landing CTAs miss it; dashboard mostly has it.)
- **Reduced motion required** — every animation/transition needs a
  `@media (prefers-reduced-motion: reduce)` fallback. (Dashboard progress/skeleton
  motion is unguarded.)
- **No `background-clip: text` gradient text** (landing hero).
- **No decorative glassmorphism by default** — blur is a moment, not a surface.
- **No hero-metric template** (big number + label trio) — the dashboard's
  `OverviewStats`.
- **No eyebrow over every section / tracked uppercase labels** — DESIGN.md sets
  label tracking at 0; landing + dashboard eyebrows use `0.08em`.
- **No numbered section markers as scaffolding** (landing WorkflowStages `01–05`).
- **Warm, approachable, editorial; calm by default; observe-first** — the magic
  shouldn't be gated behind bureaucracy (landing account modal), and the agent /
  "Request Changes" path is the product's core interaction (dashboard misses it).

## Shared decisions (every workstream honors these)

These cross more than one file/surface. Agreeing them up front is what keeps the
streams independent — each agent applies the relevant slice in its own files.

1. **Gold:** one gold fill per screen. Landing → the hero composer submit only;
   demote featured pricing CTA, "Most popular" badge, CTA-card button to secondary
   (`--panel` fill + `--accent` border; badge → `--accent-soft` chip). Dashboard →
   the `HeroCard` CTA only; demote the `AnonymousUpgradeBanner` submit to
   `variant="primary"`/`"secondary"`.
2. **Focus:** every interactive control gets
   `:focus-visible { outline: none; box-shadow: var(--ring); }` — use the token.
3. **Reduced motion:** every `@keyframes`/`transition` driving visible motion gets
   `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }`
   (mirror `Spinner.module.css`). Progress + skeleton must stay legible with motion
   off.
4. **Gradient text → solid** (`--text` headline, `--accent` emphasis). Aurora
   backdrop stays.
5. **Glass = modal backdrop only.** Cards/composer/eyebrow/CTA-card/banner get
   solid `--panel` + tonal `--border`.
6. **Eyebrow cadence:** at most one kicker per surface, tracked at `0` (not
   `0.08em`). Drop per-section kickers and the numbered `01–05` markers.
7. **Tokens only:** no raw hex/px in new CSS (CLAUDE.md convention; PR #624).

---

# Part A — Landing (`HomePage.tsx`)

`HomePage.tsx` renders the **logged-out marketing landing only**. Four
file-disjoint workstreams.

### WS-H1 — Landing system CSS (`globals.css` `.lp-*`)
Owned file: `apps/web/src/styles/globals.css` (`.lp-*` block, ~L2535–3600) ·
lens: `quieter` + `audit`

- **[P1] One Gold Rule:** demote `.lp-price-cta.featured` /
  `.lp-price-card.featured .lp-price-cta` (L3534–3535) and `.lp-badge` (L3446) off
  solid `--accent` per Shared Decision 1.
- **[P1] Focus rings:** add `:focus-visible { box-shadow: var(--ring) }` to
  `.lp-price-cta` (L3517) and any focusable `.lp-*`.
- **[P2] Glass:** remove `backdrop-filter: blur` from `.lp-card` (L3057),
  `.lp-step` (L3016), `.lp-price-card` (L3431), `.lp-eyebrow` (L2535), etc.
- **[P2] Gradient text:** if `.lp-accent` (L2556) carries a gradient/clip, solidify.
- **[Minor] `.lp-code`:** swap `--accent-2` (cool blue) for `--text`/`--muted`;
  verify ≥4.5:1 on `--bg`.
- Acceptance: no solid-gold `.lp-*` fills; `--ring` on all `.lp-*` controls; no
  `backdrop-filter` outside the modal; landing scan clean.

### WS-H2 — Hero/modal CSS (`HomePage.module.css`)
Owned file: `apps/web/src/routes/HomePage.module.css` · lens: `quieter` + `audit`

- **[P2] Gradient text:** replace `background-clip: text` (L533–534, 541–542) with
  solid colors.
- **[P2] Glass:** keep blur on the modal backdrop only; remove from composer (L42),
  cards, eyebrow, CTA-card (L247, L567, …). Hero `.promptSubmit` stays the one gold
  (`var(--cta)`, L122) — do not change its color.
- **[P1] Focus rings:** add `:focus-visible { box-shadow: var(--ring) }` to
  `.promptSubmit`, `.modalPrimary`, `.modalSecondary`.
- **[Minor] Fine print:** `.pricingNote` (L227) `--text-lg` → `--text-sm`.
- Acceptance: no `background-clip: text`; blur only on modal backdrop; hero submit
  still the single gold; `--ring` on every hero/modal button.

### WS-H3 — Landing structure + guest flow (`HomePage.tsx` + lib)
Owned files: `apps/web/src/routes/HomePage.tsx`,
`apps/web/src/lib/guestGeneration.ts` · lens: `onboard` + `clarify`

- **[P1] Defer the account modal (headline fix):** start the guest run immediately
  on submit when `canStartGuestRun()`; surface the account choice only at
  save/export or when the guest limit is reached (`mode === "limit"`). Adjust
  `openAccountChoice`/`skipAccount` + `guestGeneration.ts`; preserve the
  pending-prompt persistence contract.
- **[P2] Eyebrow cadence:** remove the per-section `kicker` props (`HomePage.tsx`
  L355, L369); keep the hero `lp-eyebrow` (L291) as the single kicker.
- **[Minor] Modal Escape:** ensure the account modal closes on `Esc`.
- Acceptance: guest's first generation starts with no account interstitial; account
  ask only at save/export or guest limit; ≤1 kicker; modal keyboard-dismissable.

### WS-H4 — Shared landing section components (`components/landing/*`)
Owned files: `apps/web/src/components/landing/LandingSection.{tsx,module.css}`,
`WorkflowStages.{tsx,module.css}` · lens: `quieter` + `distill`

- **[P2] Numbered markers:** remove the `01–05` `.lp-step-n`/stage-index chips
  (`WorkflowStages.tsx:46`, `WorkflowStages.module.css:19–34`); keep stage copy.
- **[P2] Kicker:** confirm `LandingSection` renders nothing when no kicker prop is
  passed (WS-H3 removes them); fix any spacing left behind; set `.kicker`
  (`LandingSection.module.css:51`) tracking to `0` if kept.
- Acceptance: no numbered scaffolding; headers read with zero/one kicker; no
  breakpoint regression.

---

# Part B — Dashboard (`LaunchpadPage.tsx` + `components/home/*`)

The dashboard renders loading skeleton, error state, or empty
(`EmptyDashboard`) vs populated (`HeroCard` + `OverviewStats` + `ActiveRunsPanel` +
`RecentOutputsStrip`). Five file-disjoint workstreams, partitioned by component.

### WS-D1 — OverviewStats (kill the hero-metric template)
Owned files: `apps/web/src/components/home/OverviewStats.{tsx,module.css}` ·
lens: `distill` + `layout`

- **[P1] Hero-metric + same-destination tiles:** all three tiles link to
  `/library/projects` (`OverviewStats.tsx:6-8`). Either demote to one inline
  summary line ("3 projects · 1 active · 12 outputs") under the hero, **or** route
  each tile to a filtered view (`?status=active`, `#outputs`) so the count is a real
  affordance. Prefer the filtered-destination option if those routes exist.
- **[P2] `:active` settle:** add the Lift-On-Touch reverse (`:active`) to the tile.
- Acceptance: no big-number scoreboard trio; each remaining count is either
  informational text or a distinct, meaningful destination.

### WS-D2 — EmptyDashboard (make first-run teach)
Owned files: `apps/web/src/components/home/EmptyDashboard.{tsx,module.css}` ·
lens: `onboard`

- **[P1] Teaching empty state:** today it returns a bare `<HeroCard>`
  (`EmptyDashboard.tsx:5`) while its 85-line stylesheet (`.grid`/`.card`/`.hint`)
  is dead code. Build a real first-run state — what the studio does, a
  brief→footage→review 3-step preview — using the existing CSS, with the single
  gold CTA (keep the `HeroCard` action as that CTA).
- Acceptance: first-run teaches the interface; no dead CSS; one gold CTA.

### WS-D3 — AnonymousUpgradeBanner (One Gold Rule + eyebrow)
Owned files: `apps/web/src/components/auth/AnonymousUpgradeBanner.{tsx,module.css}`
· lens: `quieter`

- **[P1] Demote the gold CTA:** banner submit is `variant="cta"`
  (`AnonymousUpgradeBanner.tsx:104,149`), stacking a second gold against the hero
  CTA. Switch to `variant="primary"`/`"secondary"`.
- **[P2] Eyebrow:** the banner `.eyebrow` uses `0.08em` tracking; set to `0` per
  Shared Decision 6 (or drop the eyebrow).
- **[P2] Glass/gradient wash:** the `.banner` linear-gradient + `--cta`-tinted
  border is a decorative second gold surface; flatten to solid `--panel` +
  `--border` (or a restrained `--accent-soft`).
- Acceptance: no gold fill in the banner; eyebrow tracking `0`; no decorative
  gradient wash.

### WS-D4 — ActiveRunsPanel (reduced motion + failed-run recovery)
Owned files: `apps/web/src/components/home/ActiveRunsPanel.{tsx,module.css}` ·
lens: `harden` + `audit`

- **[P1] Reduced motion:** the progress bar `transition: width`
  (`ActiveRunsPanel.module.css:111`) has no `prefers-reduced-motion` guard (also the
  sole detector finding). Add the Shared Decision 3 fallback.
- **[P2] Failed-run recovery:** a failed run only colors a chip
  (`ActiveRunsPanel.module.css:156-160`) — the worst dead-end for the "did my video
  break?" persona. Add a retry / "see why" affordance on failed run cards.
- **[P2] `:active` settle** on the run card.
- Acceptance: progress bar honors reduced motion; failed runs offer a recovery
  path; run card has the lift-and-settle.

### WS-D5 — Launchpad shell, skeleton, next-action (`LaunchpadPage` + lib + Button)
Owned files: `apps/web/src/routes/LaunchpadPage.{tsx,module.css}`,
`apps/web/src/lib/nextAction.ts`, `apps/web/src/components/ui/Button.module.css` ·
lens: `harden` + `clarify`

- **[P1] Reduced motion:** the skeleton shimmer (`LaunchpadPage.module.css:31`) and
  the `Button` spinner (`Button.module.css:49`) have no reduced-motion guard. Add
  the Shared Decision 3 fallback to both. (Button is shared UI — the guard is purely
  additive and safe for all consumers.)
- **[Minor] `nextAction.ts` cleanup:** the `resume_draft` branch is effectively
  dead (always called with `[]`) and its copy says "Drafts are no longer available";
  `outputPath` (L146-148) ignores its `output` param. Remove the dead branch / fix
  the smell.
- **[Minor] Partial summary:** `EMPTY_COUNTS` / `?? []` fallbacks render zeros
  silently on a partial summary rather than a degraded-state hint.
- Acceptance: skeleton + spinner honor reduced motion; `nextAction.ts` has no dead
  branch; partial-summary fallback doesn't silently render misleading zeros.

---

## Combined file-ownership matrix (disjointness proof)

| File | H1 | H2 | H3 | H4 | D1 | D2 | D3 | D4 | D5 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `styles/globals.css` (`.lp-*`) | ● | | | | | | | | |
| `routes/HomePage.module.css` | | ● | | | | | | | |
| `routes/HomePage.tsx` | | | ● | | | | | | |
| `lib/guestGeneration.ts` | | | ● | | | | | | |
| `components/landing/*` | | | | ● | | | | | |
| `components/home/OverviewStats.*` | | | | | ● | | | | |
| `components/home/EmptyDashboard.*` | | | | | | ● | | | |
| `components/auth/AnonymousUpgradeBanner.*` | | | | | | | ● | | |
| `components/home/ActiveRunsPanel.*` | | | | | | | | ● | |
| `routes/LaunchpadPage.*` | | | | | | | | | ● |
| `lib/nextAction.ts` | | | | | | | | | ● |
| `components/ui/Button.module.css` | | | | | | | | | ● |

No file is owned by two workstreams. The only coupling is the **Shared
Decisions** list, applied independently per owner. (`HeroCard` and
`RecentOutputsStrip` need no mandatory edits this pass — see deferred/out-of-scope.)

## Cross-stream contracts (the only coupling)

- **Kicker removal:** WS-H3 stops passing `kicker` props; WS-H4 renders nothing
  when absent. Different files, consistent result.
- **Gold:** WS-H1 demotes landing pricing gold while WS-H2 preserves the hero gold;
  WS-D3 demotes the banner gold while WS-D2 preserves the `HeroCard` gold. Each
  surface ends with exactly one gold.
- **Reduced motion:** WS-D4 (ActiveRunsPanel) and WS-D5 (LaunchpadPage shimmer +
  Button spinner) split the guard by file owner; same `@media` pattern.
- **Focus token:** WS-H1/H2 both use `box-shadow: var(--ring)`.

## PR / merge strategy

- Up to **nine** independent PRs off `main` (four landing + five dashboard), one per
  workstream, titled `Landing: WS-H<n> …` / `Dashboard: WS-D<n> …`.
- Merge order is irrelevant (files disjoint); rebase only if an unrelated `main`
  change touches the same file.
- Tokens-only, no raw hex/px (PR #624 convention). Each PR notes its before/after
  against the acceptance criteria.
- Run each in its own git worktree to build truly concurrently. A reasonable first
  wave: H1, H2, H3, D1, D2, D3, D4, D5 (H4 is small and can ride with H3's review).

## Deferred / needs a product decision (not parallel-mechanical)

These came out of the critiques but are design decisions, not isolated edits:

- **Agent / "Request Changes" entry point on the dashboard** (D, P2). The product's
  defining interaction is invisible on its home screen; every path is a route push.
  Could the hero CTA itself become "Ask the AI what's next?" Needs a decision before
  scoping.
- **Collapse `OverviewStats` entirely** — six links resolve to one route; the
  populated dashboard might be "one next-action card + a live runs list." WS-D1 does
  the safe demotion; deleting the section outright is a bigger call.
- **Extract a shared `Card`/`Tile` primitive** — the same border+hover+lift recipe
  repeats across OverviewStats / ActiveRunsPanel / RecentOutputsStrip /
  EmptyDashboard. This refactor touches every component's CSS, so it is **not**
  parallel-safe; do it as a single coordinated PR *after* the parallel wave.
- **`StateCard` `border-left: 3px` side-stripe** (`StateCard.module.css:37`) —
  shared component, broader blast radius; reconsider as a deliberate error
  affordance vs the banned stripe in its own small PR.
- **Landing structural compression** — composer + run preview + one proof artifact,
  deleting later sections — explicitly deferred.

## Out of scope

- `RecentOutputsStrip` beyond the warmer empty/placeholder copy ("Output" chip →
  "No preview"); fold into a polish pass or assign a WS-D6 if desired.
- Reworking heatmap/FAQ/pricing data, or net-new sections.
- Content rewrites beyond removing kicker strings + the warmer chip labels noted.

## Verification

After each wave lands, re-run `/impeccable critique HomePage` and
`/impeccable critique LaunchpadPage` and confirm movement off **31/40** and
**27/40**. Target gains: Aesthetic & Minimalist (both), Consistency (gold + focus),
Help/Documentation (dashboard empty state), and the P1s cleared. Baseline snapshots:
`apps/web/.impeccable/critique/`.
