# Scope: HomePage landing polish (parallelizable)

Status: ready for parallel execution
Owner surface: `apps/web` — the public marketing **landing** rendered by
`apps/web/src/routes/HomePage.tsx`
Source of truth: [`apps/web/PRODUCT.md`](../../apps/web/PRODUCT.md),
[`apps/web/DESIGN.md`](../../apps/web/DESIGN.md)

## Context

An Impeccable `critique` of the HomePage landing scored it **31/40 (Good)**. It is
a well-built, product-true landing — the competitive heatmap and the hero prompt
composer are genuine strengths — but it leans on several named anti-references and
breaks two committed DESIGN.md rules. This scope turns the critique's priority
issues into **four file-disjoint workstreams** so they can be built in parallel,
each as its own PR, with near-zero merge conflicts.

Important scoping fact: `HomePage.tsx` renders the **logged-out marketing landing
only**. The `components/home/*` files (HeroCard, OverviewStats, ActiveRunsPanel…)
belong to `LaunchpadPage` and are **out of scope here**. The lone detector finding
(`ActiveRunsPanel.module.css:111`, `transition: width`) is therefore a false
positive for this surface and is tracked separately under the Launchpad critique.

## DESIGN.md rules being enforced

These are the committed rules the landing currently violates or strains. Every
workstream is in service of them:

- **The One Gold Rule** — exactly one popcorn-gold (`--accent`/`--cta`) fill per
  screen. Today there are 3–4.
- **Focus ring everywhere** — every interactive element shows
  `box-shadow: var(--ring)` on `:focus-visible`. Today only the textarea/select do.
- **No `background-clip: text` gradient text** — banned outright; the landing
  exception covers `clamp()` headings only, not gradient text.
- **No decorative glassmorphism by default** — `backdrop-filter: blur` is a moment
  (the modal backdrop), not the default surface treatment.
- **No eyebrow over every section / numbered section markers as scaffolding** —
  one named kicker can be brand voice; an eyebrow on most sections is AI grammar.
- **Warm, approachable, editorial; calm by default** — observe-first, the AI does
  the work without bureaucratic speed bumps at the magic moment.

## Shared decisions (every workstream honors these)

These cross-cut more than one file. Agreeing them up front is what makes the
streams independent — each agent applies the relevant half in its own files
without coordinating live.

1. **Gold:** the hero prompt-composer submit is the **single** gold fill on the
   page. Every other former-gold control (featured pricing CTA, "Most popular"
   badge, CTA-card "View on GitHub") becomes **secondary**: `--panel`/`--panel-2`
   fill with a `--accent`-colored 1px border, text in `--text`/`--accent`. The
   "Most popular" badge becomes an outline/soft chip (`--accent-soft` bg +
   `--accent` text), not a solid gold fill.
2. **Focus:** every interactive control gets
   `:focus-visible { outline: none; box-shadow: var(--ring); }`. Use the token,
   never a hand-rolled outline.
3. **Gradient text → solid:** any `-webkit-background-clip: text` /
   `background-clip: text` headline renders in a solid color (`--text` for the
   headline, `--accent` for the emphasized span). The aurora/dot-grid hero
   backdrop stays — it is the one allowed "wow."
4. **Glass:** `backdrop-filter: blur` is allowed **only** on the modal backdrop.
   Cards, the composer, the eyebrow, and the CTA card get solid `--panel` +
   tonal `--border`, no blur.
5. **Eyebrow cadence:** keep **at most one** kicker on the landing (the hero
   "New · AI-native video production" may stay as deliberate brand voice). Remove
   per-section kickers. Drop the numbered `01–05` markers in WorkflowStages unless
   the sequence itself carries information the reader needs (it does not here).
6. **Tokens only:** no raw hex/px in new CSS — consume the existing
   `--accent`, `--cta`, `--ring`, `--panel*`, `--radius-*`, `--space-*`,
   `--accent-soft/-border` tokens (CLAUDE.md convention; see PR #624).

## Workstreams

Each workstream owns a disjoint set of files (see the ownership matrix). Each ships
as its own PR off `main`.

### WS-1 — Landing system CSS (`globals.css` `.lp-*`)
Owned file: `apps/web/src/styles/globals.css` (the `.lp-*` landing block, ~L2535–3600)
Impeccable lens: `quieter` + `audit`

- **[P1] One Gold Rule:** demote `.lp-price-cta.featured` /
  `.lp-price-card.featured .lp-price-cta` (L3534–3535) and the `.lp-badge`
  (L3446) off solid `--accent`; make them secondary per Shared Decision 1.
- **[P1] Focus rings:** add `:focus-visible { box-shadow: var(--ring) }` to
  `.lp-price-cta` (L3517) and any other focusable `.lp-*` control.
- **[P2] Glass:** remove `backdrop-filter: blur` from `.lp-card` (L3057),
  `.lp-step` (L3016), `.lp-price-card` (L3431), `.lp-eyebrow` (L2535) and the
  other `.lp-*` blur sites (L2783 etc.); solid `--panel` + `--border`.
- **[P2] Gradient text:** if `.lp-accent` (L2556) carries a gradient/clip, make it
  solid `--accent`.
- **[Minor] `.lp-code` accent:** the CTA-card code block uses `--accent-2` (cool
  blue) on a warm dark surface; switch to `--text`/`--muted` and verify ≥4.5:1 on
  `--bg`.
- Acceptance: zero solid-gold `.lp-*` fills remain; all `.lp-*` controls show the
  `--ring` on keyboard focus; no `backdrop-filter` outside the modal; landing
  scan clean.

### WS-2 — Hero/modal CSS (`HomePage.module.css`)
Owned file: `apps/web/src/routes/HomePage.module.css`
Impeccable lens: `quieter` + `audit`

- **[P2] Gradient text:** replace `background-clip: text` (L533–534, 541–542) with
  solid colors per Shared Decision 3.
- **[P2] Glass:** keep `backdrop-filter` on the modal backdrop only (the
  `.modalBackdrop` blur stays); remove it from the composer (L42), cards, eyebrow,
  and CTA-card surfaces (L247, L567, etc.). The hero `.promptSubmit` stays the one
  gold fill (`var(--cta)`, L122) — do **not** change its color.
- **[P1] Focus rings:** add `:focus-visible { box-shadow: var(--ring) }` to
  `.promptSubmit`, `.modalPrimary`, `.modalSecondary` (the inputs already set
  `outline: none`, so this closes the gap).
- **[Minor] Fine print:** `.pricingNote` (L227) uses `--text-lg`; drop to
  `--text-sm` so the footnote is smaller than the body it annotates.
- Acceptance: no `background-clip: text` anywhere; `backdrop-filter` only on the
  modal backdrop; hero submit still the single gold; every hero/modal button shows
  the `--ring` on focus.

### WS-3 — Landing structure + guest flow (`HomePage.tsx` + lib)
Owned files: `apps/web/src/routes/HomePage.tsx`,
`apps/web/src/lib/guestGeneration.ts`
Impeccable lens: `onboard` + `clarify`

- **[P1] Defer the account modal (the headline UX fix):** today submitting the
  hero composer opens "Do you want to create an account?" (L621) *before* anything
  generates — friction at the exact moment the brand promises the AI does the
  work. Start the guest run **immediately** on submit when a guest run is
  available (`canStartGuestRun()`), and surface the account choice only when the
  user later tries to **save/export** or when the guest limit is reached
  (`mode === "limit"`). Keep the limit-reached modal. Adjust
  `openAccountChoice` / `skipAccount` and the relevant `guestGeneration.ts`
  helpers; preserve the pending-prompt persistence contract.
- **[P2] Eyebrow cadence:** remove the per-section `kicker` props —
  `kicker="Full run overview"` (L355) and `kicker="AI orchestrator"` (L369).
  Leave the hero `lp-eyebrow` (L291) as the single allowed kicker.
- **[Minor] Modal Escape:** ensure the account modal closes on `Esc` (add a
  keydown handler or confirm the shared modal layer provides it); the backdrop
  currently only closes on `onMouseDown`.
- Acceptance: a guest's first generation starts with no account interstitial; the
  account ask appears only at save/export or at the guest limit; at most one
  kicker renders; the modal is keyboard-dismissable.

### WS-4 — Shared landing section components (`components/landing/*`)
Owned files: `apps/web/src/components/landing/LandingSection.{tsx,module.css}`,
`apps/web/src/components/landing/WorkflowStages.{tsx,module.css}`
Impeccable lens: `quieter` + `distill`

- **[P2] Kicker support:** the `.kicker` style (`LandingSection.module.css:51`)
  stays available but is no longer applied per-section by callers (WS-3 removes the
  props). If `LandingSection` renders a kicker only when the prop is present, no
  change is needed beyond confirming the empty/no-kicker layout looks right
  (spacing, heading rhythm) without it.
- **[P2] Numbered markers:** remove the `01–05` `.lp-step-n` / stage-index chips in
  `WorkflowStages` (`WorkflowStages.tsx:46`, `WorkflowStages.module.css:19–34`) per
  Shared Decision 5, or convert them to non-numbered visual anchors. Keep the
  stage titles/copy.
- Acceptance: no numbered scaffolding markers; section headers read correctly with
  zero or one kicker; no layout regression at the documented breakpoints.

## File-ownership matrix (disjointness proof)

| File | WS-1 | WS-2 | WS-3 | WS-4 |
|---|:--:|:--:|:--:|:--:|
| `styles/globals.css` (`.lp-*`) | ● | | | |
| `routes/HomePage.module.css` | | ● | | |
| `routes/HomePage.tsx` | | | ● | |
| `lib/guestGeneration.ts` | | | ● | |
| `components/landing/LandingSection.*` | | | | ● |
| `components/landing/WorkflowStages.*` | | | | ● |

No file is owned by two workstreams. The only inter-stream *contracts* are the
Shared Decisions above (gold demotion, focus token, gradient→solid, glass→modal,
one kicker) — applied independently in each owner's files, so no live coordination
is required.

## Cross-stream contracts (the only coupling)

- **Kicker removal:** WS-3 stops passing `kicker` props; WS-4 makes
  `LandingSection` render nothing when no kicker is passed. Both are consistent and
  in different files — no conflict.
- **Focus token:** WS-1 and WS-2 both use `box-shadow: var(--ring)`. Same token,
  same result, different selectors.
- **Gold demotion:** WS-1 restyles the pricing/badge gold (in `globals.css`); WS-2
  preserves the hero gold (in `HomePage.module.css`). Together they yield exactly
  one gold fill.

## PR / merge strategy

- Four independent PRs off `main`, one per workstream, each titled
  `HomePage landing: WS-N <summary>`.
- Merge order is **irrelevant** (files are disjoint); rebase is only needed if a
  later, unrelated `main` change touches the same file.
- Each PR is documentation-faithful: tokens only, no raw hex/px (PR #624
  convention), and includes a before/after note for its acceptance criteria.
- Optional: run each workstream in its own git worktree to build them truly
  concurrently.

## Out of scope

- `LaunchpadPage` / `components/home/*` (separate surface, separate critique).
- The `ActiveRunsPanel` `transition: width` perf nit (tracked under Launchpad).
- Content/copy rewrites beyond removing kicker strings.
- Reworking the heatmap, FAQ, or pricing data.
- Net-new sections or a structural redesign of the landing (a possible follow-up:
  the critique questioned whether the landing should compress to composer + run
  preview + one proof artifact — deliberately deferred).

## Verification

After all four land, re-run `/impeccable critique HomePage` and confirm the score
moves off **31/40**. Target gains: Aesthetic & Minimalist (2→3+, glass/eyebrow
cleanup), Consistency (gold + focus unification), and the three P1s cleared
(One Gold Rule, focus rings, account-modal friction). The snapshot at
`apps/web/.impeccable/critique/` records the baseline.
