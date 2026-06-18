# Landing Page — "The Production Workflow for AI Video" — Scope

## Objective

Re-position the public landing page (`/`) from **"the agent harness for video /
Like Claude Code, but for video"** to **"the production workflow for AI video."**
The new framing is the Retool move applied to AI video: the category of *clip
generators* is crowded and commoditizing; Popcorn Ready's durable value is the
**workflow around generation** — planning, generating, editing, reviewing, and
publishing a coherent, finished cut. This is a **clean replacement** of the
hero/positioning copy (no A/B, no legacy framing left behind), implemented on the
existing landing route and design system.

> **Supersedes** the Positioning section of
> [`website-and-productization.md`](./website-and-productization.md). That doc's
> pricing, two-track productization, and MVP→hosted pathway remain authoritative;
> only the public *framing* changes here.

## Positioning (what the copy leads with)

**Popcorn Ready is the production workflow for AI video.** Most AI video tools
stop at generation: prompt → clip → prompt again → a pile of disconnected
moments. Popcorn Ready owns everything *around* generation — it turns one idea
into a structured production: plan, generated shots, an editable timeline,
continuity review, targeted revisions, and a finished export.

Lead line:

> **Prompt-to-video is only step one.**
> Popcorn Ready gives AI video the missing workflow: planning, editing, critique,
> revision, and final export.

Core contrast (repeat across the page):

> **AI video tools generate moments. Popcorn Ready builds the whole production.**

### The AI-first reconciliation (read before writing any "Edit" copy)

This is **not** a pivot to a manual editor, and it does not contradict the
[North Star](../NORTH_STAR.md). "Workflow" describes the *product surface* (the
visitor sees plan → generate → edit → review → publish as legible stages);
**the AI executes every stage.** The human **directs and approves**; the agent
plans, generates, edits, critiques, and revises.

Two rules this imposes on all copy and mockups:

1. **AI-first, non-one-directional.** The agent can make edits at *any* stage,
   not just a final "edit step." "Edit" copy means *the agent revises the
   structured timeline on your direction* — e.g. "regenerate the weak shot," not
   "drag clips on a track." Re-triggering a stage recomputes only the affected
   assets (North Star provenance graph). Never present the stages as a strict
   one-way pipeline.
2. **No manual timeline tool.** We do **not** market a hand-editing NLE. A
   timeline appears **only as a viewer** — how the user watches the cut and sees
   its structure/checkpoints — never as a drag-to-trim surface. (The current page
   is already honest about this; keep that honesty.) Selective regeneration,
   continuity fixes, and pacing changes are all **agent actions the user
   requests**, shown as directable controls, not manual edits.

The Retool parallel is exact: Retool isn't "an app generator," it's where
generated/quickly-built apps become governed, production software. Popcorn Ready
is where generated clips become coherent, editable, production-ready video — with
the agent, not the user, doing the editing.

## What already exists (reuse, don't rebuild)

| Surface | File | Disposition |
|---|---|---|
| Landing route `/` | [`apps/web/src/routes/HomePage.tsx`](../../apps/web/src/routes/HomePage.tsx) | **Rewrite** sections in place; keep as the home route. |
| Landing module CSS | `apps/web/src/routes/HomePage.module.css` | Extend for `HomePage`-level layout; per-section styles live in the section component's own module. |
| Global landing styles | `apps/web/src/styles/globals.css` (`.landing`, `.lp-*`) | **Frozen for new work.** Keep existing `.lp-*` only while code still uses them; migrate styles into co-located modules as sections are rewritten — do not add new `.lp-*` rules here (AGENTS.md styling rule). |
| Design tokens / themes | `apps/web/src/styles/tokens.css` + `globals.css` (`popcorn`, `popcorn-warm`, `popcorn-night`) | **Reuse as-is.** See "Visual system" below. |
| Prompt entry | [`apps/web/src/components/PromptComposer.tsx`](../../apps/web/src/components/PromptComposer.tsx) | Keep; it stays the hero CTA (prompt → `/studio?autostart=1`). |
| Logo | `apps/web/src/components/LogoMark.tsx`, `/public/brand/popcorn-ready-logo.svg` | Reuse. |
| Nav + footer shell | `apps/web/src/components/AppLayout.tsx` | Reuse; update nav labels (below). |
| Heatmap | `HomePage.tsx` `HEATMAP_*` | Keep; re-frame the section intro to the new contrast. |
| Pricing | `HomePage.tsx` `PRICING` | Keep as-is (still authoritative per the productization doc). |
| One-shot backend | `POST /api/oneshot` (`src/app/api/oneshot/`, `src/lib/runs/execute.ts`) | Reuse; it already powers the hero handoff. |
| Home dashboard components | `apps/web/src/components/home/*` | These are the **authed dashboard**, not the marketing page — do not repurpose. New marketing sections go in a new `components/home/marketing/` (or `components/landing/`) folder to avoid collision. |
| UI primitives | `apps/web/src/components/ui/*` (`Button`, `Card`, `StatusChecklist`, `Stepper`, …) | Reuse — esp. `StatusChecklist`/`Stepper` for the checkpoint mockup. |

## Decision (settled before scoping)

- **Replace, don't layer.** The "agent harness / Like Claude Code, but for video"
  hero is fully retired. No A/B, no toggle, no second hero.
- **AI-first stays the spine.** The workflow framing is the *surface*; the agent
  owning every stage is the *mechanism* (see reconciliation above). North Star is
  unchanged.
- **Honest launch copy.** Every claim maps to a shipped capability; aspirational
  UI moments live in a clearly-labeled roadmap, not as if-they-exist mockups.
- **No new color system.** The brief's raw hex palette (`--bg:#0f1117`, etc.) is
  **not** adopted. Per the tokens convention, new UI consumes existing tokens and
  never inlines a hex/px. The existing dark + popcorn themes already deliver the
  "creative software + warm popcorn accent" look the brief asks for.

## Page architecture (target)

Order top-to-bottom. "Status" = does the supporting capability ship today.

| # | Section | Component | Replaces / Adds | Status |
|---|---|---|---|---|
| 1 | **Nav** | `AppLayout.tsx` | Update labels → Product · Workflow · Examples · Pricing · Learn | ✅ ships (label edit) |
| 2 | **Hero** | `HeroProduction` | Replaces current hero copy; keeps `PromptComposer`; adds a static product-mockup panel (prompt → plan → preview → checkpoints) | ✅ ships |
| 3 | **Problem / contrast** | `ProblemContrast` | New: "AI video tools generate moments. Popcorn Ready builds the whole production." | ✅ ships |
| 4 | **Workflow** | `WorkflowStages` | Replaces "How it works" 4-step → **Plan · Generate · Edit · Review · Publish** (AI-first copy) | ✅ ships |
| 5 | **Product moments** | reuse `overview` + `orchestrator` image sections; add `SelectiveRegen`, `CritiqueReport` | Reuses the two existing screenshot sections; adds directable-regen + critique callouts | ⬜ partial (see roadmap) |
| 6 | **Use-case gallery** | `UseCaseGallery` | New: finished-video format cards (ad, founder story, explainer, …) | 🔄 needs example assets |
| 7 | **Where it fits** | existing heatmap | Keep; re-frame intro to the new contrast | ✅ ships |
| 8 | **Pricing** | existing `PRICING` | Keep | ✅ ships |
| 9 | **Final CTA** | `FinalCTA` | Reframe current OSS CTA: "Give it an idea. Get a production." + self-host | ✅ ships |

### Hero (section 2)

- **Eyebrow:** `New · AI-native video production`
- **Headline:** `Prompt-to-video is only step one.`
- **Subhead:** "Popcorn Ready plans the scenes, generates the shots, edits the
  sequence, checks continuity, and refines the final cut — one AI-native workflow,
  not a pile of clips."
- **CTA:** primary `Start creating` (→ `PromptComposer` / `/studio`), secondary
  `See how it works` (anchor to Workflow).
- **Product mockup panel** (static, not interactive at launch): left = the prompt;
  center = video preview frame; right = checkpoint list rendered with
  `ui/StatusChecklist` (`Scene plan ✓ · Keyframes ✓ · Clips ✓ · Continuity ✓ ·
  Ready for review`). Built from real run-shaped data, no fake numbers.

### Workflow (section 4) — copy

Each stage card must say *the agent does X on your direction*:

- **Plan** — "The agent turns your idea into a structured plan: scenes, beats,
  shots, timing, continuity rules — before anything is generated."
- **Generate** — "It generates the shot for each beat (Veo / Sora video,
  keyframes, voiceover, captions). Regenerate a single shot without starting over."
- **Edit** — "Edits happen on the structured timeline, by the agent: tighten
  pacing, swap a weak shot, fix continuity. You direct; it revises. *(There is no
  manual track to drag — the AI makes the edit.)*"
- **Review** — "An AI critic checks visual consistency, narrative clarity,
  pacing, and missing scenes, then proposes targeted fixes."
- **Publish** — "Deterministic export to vertical, square, or widescreen via
  Remotion. The agent only edits structured data; rendering never touches raw
  video."

> Layout note: render as connected stages that explicitly **loop back** (any
> stage re-triggerable), not a one-way arrow chain — this is the visual that keeps
> us North-Star-honest.

### Use-case gallery (section 6)

Cards for finished formats — Product launch, Founder story, Explainer, Social ad,
App demo, YouTube Short, Investor update, Testimonial, Mini-lesson. Each card:
thumbnail/still + format + length + scene count + aspect ratios. **Blocked on real
example renders** — do not ship lorem thumbnails; gate this section behind having
≥6 real finished examples (good dogfooding task for the one-shot pipeline).

## Copy bank (approved phrases)

Lead: `Prompt-to-video is only step one.` · `AI video tools generate moments.
Popcorn Ready builds the whole production.` · `The missing workflow layer for AI
video.` · `Generate less. Direct more.` · `Regenerate the weak shot, not the
entire project.` · `Keep the story, swap the scene.` · `Turn scattered clips into
a finished cut.` · `A video agent that plans before it generates.` · `AI video
without the slot-machine feeling.`

Avoid (off-positioning now): anything implying a manual editor, drag-to-trim, or
"clip generator." Retire "Like Claude Code, but for video" and "agent harness."

## Visual system (use existing tokens — no new palette)

- Consume `tokens.css` + the three popcorn themes. The brief's dark-with-warm-
  accent direction is already satisfied by `popcorn-night` (dark) and the default
  `popcorn` theme. **Do not** add the brief's literal hex variables.
- New section styles go in **co-located CSS Modules** (`HeroProduction.module.css`
  next to `HeroProduction.tsx`, etc.), per the AGENTS.md styling rule — **do not**
  add new `.lp-*` rules to `globals.css` or any legacy global sheet; that monolith
  is the biggest styling merge hotspot and is frozen for new work. The existing
  `.lp-*` selectors in `globals.css` stay only for code still on those classes;
  when a section is rewritten, migrate its styles into the section's module rather
  than extending the global block. Never inline hex/px — reference tokens
  (`--accent`, `--cta`, `--space-*`, `--radius-*`, `--shadow-*`) from the global
  token layer.
- Reuse `LogoMark`, `Button` (`cta` variant for the one CTA per screen),
  `Card`, `StatusChecklist`, `Stepper`.

## Roadmap (aspirational UI — not launch copy)

These appear in the brief but depend on surfaces not built yet. Track them to
North Star stages; **do not** market them as live until shipped. When built, they
slot into section 5 ("Product moments"):

- **EditPlan tree visualization** (Video → Scene → Beat) as an interactive
  inspector — ties to the asset-graph / provenance work
  ([`north-star-provenance-graph.md`](./north-star-provenance-graph.md),
  [`storyboard-scenes.md`](./storyboard-scenes.md)).
- **Selective regeneration controls** as a real directable surface (regenerate
  shot, change camera, keep character) — ties to granular generation
  ([`granular-generation-api.md`](./granular-generation-api.md),
  [`generation-review-checkpoints.md`](./generation-review-checkpoints.md)).
- **Before/after refinement** ("Draft 1 → critique → improved cut") — ties to the
  critic/OODA loop ([`ooda-feedback-loop.md`](./ooda-feedback-loop.md)).
- **Live (non-static) hero workspace** — only after the above are real.

Until then, section 5 reuses the two existing static screenshots
(`/images/popcorn-ready-full-run-overview.png`,
`/images/pc-ai-orchestrator-overview.png`) re-captioned to the new framing.

## Suggested PR breakdown

One PR per row. Open PRs only (no drafts). Each PR body links back to this scope.

| PR | Scope | Status | Depends on |
|----|-------|--------|-----------|
| 1 | **Hero + nav re-positioning.** Replace hero copy (eyebrow/headline/subhead/CTAs), keep `PromptComposer`, update `AppLayout` nav labels. Retire all "agent harness / Like Claude Code" copy. | ⬜ todo | — |
| 2 | **Hero product mockup panel.** Static prompt→plan→preview→checkpoint panel using `StatusChecklist`; tokens only. | ⬜ todo | PR 1 |
| 3 | **Problem/contrast section.** New `ProblemContrast` + co-located `ProblemContrast.module.css`. | ⬜ todo | PR 1 |
| 4 | **Workflow stages section.** Replace "How it works" with Plan·Generate·Edit·Review·Publish (AI-first copy, loop-back visual). | ⬜ todo | PR 1 |
| 5 | **Re-frame product-moment + heatmap intros.** Re-caption the two screenshot sections and the heatmap intro to the new contrast. | ⬜ todo | PR 1 |
| 6 | **Final CTA reframe.** "Give it an idea. Get a production." + self-host block. | ⬜ todo | PR 1 |
| 7 | **Use-case gallery.** Cards + layout. **Gated** on ≥6 real example renders. | 🧊 blocked (assets) | PR 1 |
| 8+ | **Roadmap UI moments** (EditPlan tree, selective-regen, before/after) — each its own PR when the backing surface ships. | 🧊 blocked (deps) | roadmap deps above |

Suggested component layout (avoid the authed `components/home/*` collision):

```
apps/web/src/components/landing/
  HeroProduction.tsx        ProblemContrast.tsx   WorkflowStages.tsx
  UseCaseGallery.tsx        FinalCTA.tsx          (+ .module.css each)
```

## Out of scope for this pass

- Billing/metering and final pricing (owned by
  [`website-and-productization.md`](./website-and-productization.md)).
- Any manual-editing UI — explicitly not a goal (AI-first).
- Interactive/live hero workspace and the roadmap UI moments (see Roadmap).
- New color system / design tokens.

## Definition of done (this pass)

- `/` leads with "Prompt-to-video is only step one." and the production-workflow
  framing; no "agent harness / Like Claude Code, but for video" copy remains.
- Hero `PromptComposer` still hands off to `/studio?autostart=1`.
- Workflow section presents Plan·Generate·Edit·Review·Publish as AI-driven,
  loop-back stages — no manual-edit implication.
- All new styling consumes tokens; no inline hex/px; themes still switch cleanly.
- `npm run build` and `npm run typecheck` pass.
