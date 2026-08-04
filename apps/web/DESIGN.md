---
name: Popcorn Ready
description: AI-native video studio — a warm, editorial dark surface where the agent does the heavy lifting
colors:
  popcorn-gold: "#f5b62a"
  ember-coral: "#ff7a4d"
  reel-green: "#5fd39a"
  signal-red: "#ff6b6b"
  near-black-violet: "#08070a"
  twilight-panel: "#14111c"
  raised-panel: "#1c1827"
  violet-border: "#2a2440"
  moonlight-ink: "#f6f2ff"
  lavender-muted: "#a59bc0"
  espresso-ink: "#1a1206"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "38px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "0"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 800
    lineHeight: 1.35
    letterSpacing: "0"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "32px"
  "8": "48px"
components:
  button-primary:
    backgroundColor: "{colors.popcorn-gold}"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "38px"
  button-cta:
    backgroundColor: "{colors.popcorn-gold}"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.md}"
    padding: "0 24px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.raised-panel}"
    textColor: "{colors.moonlight-ink}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "38px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.lavender-muted}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "38px"
  card:
    backgroundColor: "{colors.twilight-panel}"
    textColor: "{colors.moonlight-ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input:
    backgroundColor: "{colors.raised-panel}"
    textColor: "{colors.moonlight-ink}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  nav-link-active:
    backgroundColor: "{colors.raised-panel}"
    textColor: "{colors.ember-coral}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  chip:
    backgroundColor: "{colors.raised-panel}"
    textColor: "{colors.lavender-muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
---

# Design System: Popcorn Ready

## 1. Overview

**Creative North Star: "The Warm Workshop"**

Popcorn Ready is the workshop of a trusted assistant — the one who quietly smooths
out the hard parts, gets the work done, and brings the project to life because it
knows how to implement. The room is dark and calm, lit by a warm popcorn-gold
glow. You don't operate machinery here; you describe what you want, watch it take
shape, and ask for changes. The interface is observe-first: it shows the work and
its provenance, then steps back. Warmth comes from the accent, the type, and the
imagery — never from decoration, and never from a cream background.

The system is **warm, approachable, and editorial** on a committed dark surface
(near-black violet). Density is earned, not front-loaded: a creator sees a quiet,
uncrowded view; operator depth (evals, runs, diagnostics) is reachable but never
the first thing on screen. There is exactly one loud move per screen — the
popcorn-gold CTA — and everything else stays restrained so content and generated
media lead.

This system explicitly rejects the **generic AI-SaaS template** (gradient-text
heroes, identical icon-card grids, an eyebrow over every section, decorative
glassmorphism), the **toy/gimmicky AI generator** (a slot-machine "Generate"
button with opaque random results), the **overwhelming pro NLE** (a wall of
panels and exposed controls), and the **sterile enterprise dashboard** (gray-on-
gray admin with no warmth).

**Key Characteristics:**
- Dark by default — near-black violet surfaces, warm gold/coral accents.
- One CTA per screen; restraint everywhere else.
- Layered, lifted depth — tonal panels that visibly sit above the background.
- System sans only — no display pairing; the tool disappears into the task.
- Warm and tactile components: a subtle lift on hover, confident gold fills.
- Three first-class themes: `popcorn` (dark), `popcorn-night` (warm dark),
  `popcorn-warm` (warm cream light).

## 2. Colors

A warm, cinematic palette: popcorn-gold and ember-coral accents glowing on deep
near-black violet, with a small, disciplined set of state colors.

### Primary
- **Popcorn Gold** (#f5b62a): The signature accent and the single CTA color. Used
  for the one primary action per screen, the active-selection fill, and key state
  indicators. Its scarcity is the point — it should never become decoration.

### Secondary
- **Ember Coral** (#ff7a4d): The link and interaction-echo color. Used for
  hyperlinks, hover text shifts, active nav labels, and the warm end of progress
  gradients. It partners with gold but never competes with the CTA.

### Tertiary
- **Reel Green** (#5fd39a): Success and "ready" — completed stages, passing eval
  verdicts, healthy status.
- **Signal Red** (#ff6b6b): Danger and failure — destructive actions, failed
  stages, error verdicts. Always paired with an icon or label, never color alone.

### Neutral
- **Near-Black Violet** (#08070a): The body background. The dark room the gold
  light glows in.
- **Twilight Panel** (#14111c): The primary surface — cards, sidebars, panels.
- **Raised Panel** (#1c1827): The second surface layer — inputs, chips, hovered
  rows, nested panels. The tonal step that creates depth without a shadow.
- **Violet Border** (#2a2440): Hairline borders and dividers. Soft, pulled toward
  the panel so surfaces read as edges, not boxes.
- **Moonlight Ink** (#f6f2ff): Primary text — near-white with a violet warmth.
- **Lavender Muted** (#a59bc0): Secondary text, captions, inactive nav. Tinted
  toward the surface hue, not a flat gray.
- **Espresso Ink** (#1a1206): The dark text that sits on top of gold/coral fills.

### Named Rules
**The One Gold Rule.** Popcorn Gold marks exactly one primary action per screen.
If two things are gold, one of them is wrong. Selection and CTA borrow it; nothing
decorative does.

**The Warmth-Not-Cream Rule.** Warmth is carried by accent, type, and imagery on a
dark surface — never by a warm-tinted near-white background. The `popcorn-warm`
light theme is a deliberate, fully-resolved peer, not a default fallback.

**The Tinted-Neutral Rule.** Muted text and borders are tinted toward the surface's
violet hue, never flat gray. Gray-on-violet reads as washed out.

## 3. Typography

**Display / Body Font:** System sans stack (`-apple-system, BlinkMacSystemFont,
"Segoe UI", Roboto, sans-serif`)
**Label/Mono Font:** None distinct — the same sans carries labels in heavier
weight and uppercase.

**Character:** One family, many weights. This is product UI: a single well-tuned
sans carries headings, buttons, labels, and data so nothing feels costumed. Weight
(800 for headings and labels, 400 for body) and case do the hierarchy work, not a
second typeface.

### Hierarchy
- **Display** (800, 38px, line 1.15): The active step heading and empty-state
  headline in the guided studio — the one element that should dominate the view.
- **Headline** (800, 30px, line 1.2): Page titles and section headers.
- **Title** (800, 24px, line 1.2): Card and panel titles; eval/admin section heads
  (set in normal case, not uppercase).
- **Body** (400, 15px, line 1.5): Default prose and UI text. Cap prose at 65–75ch;
  dense tables and data may run wider.
- **Label** (800, 12px, line 1.35, uppercase): Eyebrows, metadata pills, workspace
  labels. Tracked at 0 — weight and case carry it, not letter-spacing.

### Named Rules
**The One-Family Rule.** No display/body pairing. Hierarchy is weight, size, and
case within the system sans. A second typeface in product chrome is forbidden.

**The Fixed-Scale Rule.** Headings use fixed px steps, not fluid `clamp()`. Users
view at consistent DPI; a heading that shrinks inside a sidebar looks worse, not
designed. (The marketing landing is the one allowed exception.)

## 4. Elevation

Depth is **layered and lifted**: surfaces stack tonally (background → twilight
panel → raised panel) and the resting look includes soft, dark-tuned shadows so
panels and cards visibly sit above the page rather than lying flat on it. Shadows
intensify on hover and on the CTA, reinforcing the "warm and tactile" feel.

### Shadow Vocabulary
- **Resting / small** (`box-shadow: 0 1px 2px rgba(0,0,0,0.3)`): Buttons on hover,
  the CTA at rest — the first millimeter of lift.
- **Elevated / medium** (`box-shadow: 0 10px 30px rgba(0,0,0,0.32)`): Elevated
  cards, popovers, the CTA on hover. The default "this floats" shadow.
- **Overlay / large** (`box-shadow: 0 26px 64px rgba(0,0,0,0.45)`): Modals,
  account menus, the highest layer.

### Named Rules
**The Lift-On-Touch Rule.** Interactive elements gain shadow and a 1px upward
`translateY` on hover, and settle back on `:active`. The lift is feedback — it
must always reverse on press.

**The Dark-Shadow Rule.** Shadows are tuned for dark surfaces (high alpha, soft
spread). A thin, low-alpha shadow that works on white reads as nothing here.

## 5. Components

### Buttons
- **Shape:** Gently rounded (`--radius-sm`, 8px; the `lg`/CTA size steps up to
  `--radius-md`, 12px). Min-height 38px standard, 48px for the CTA.
- **Primary:** Popcorn-gold fill, espresso-ink text, weight 800. Hover lifts
  (`translateY(-1px)` + small shadow + `brightness(1.07)`); `:active` settles and
  darkens.
- **CTA:** The single prominent popcorn-gold action — carries a resting shadow and
  a stronger hover shadow. One per screen.
- **Secondary:** Raised-panel fill, violet border, moonlight text. Hover shifts the
  border to the gold-tinted `--accent-border` and lifts.
- **Ghost:** Transparent with muted text until hover, then fills to raised-panel and
  brightens text. For low-emphasis and icon actions.
- **Focus:** All buttons show the accent-derived focus ring
  (`box-shadow: 0 0 0 3px color-mix(accent 55%, transparent)`); never `outline:
  none` without it.

### Chips / Pills
- **Style:** Raised-panel background, hairline violet border, muted text, fully
  pill (999px), 12px. Status chips (live/queued/ready/failed) tint background and
  text toward the matching state color.

### Cards / Containers
- **Corner Style:** `--radius-lg` (16px) for cards, `--radius-md`/`sm` for denser
  panels.
- **Background:** Twilight panel on the near-black-violet body; nested content
  steps up to raised-panel.
- **Shadow Strategy:** Flat-bordered by default; the `elevated` variant adds the
  medium shadow. See Elevation.
- **Border:** 1px violet border, softened toward the panel.
- **Internal Padding:** `--section-gap` rhythm — tight 8px, default 16px, loose
  24px.

### Inputs / Fields
- **Style:** Raised-panel fill, 1px violet border, 8px radius, 8–10px padding.
- **Focus:** Accent-derived focus ring; border warms toward gold.
- **Error / Disabled:** Error text in `--danger-text`; disabled drops to ~0.55
  opacity with `not-allowed` cursor.

### Navigation
- **Style:** Sidebar (248px) for the dashboard, sticky blurred top bar elsewhere.
  Links are muted weight-750; hover fills raised-panel and brightens to moonlight.
- **Active:** Gold-soft background (`--accent-soft`) with coral text and an inset
  gold-border ring — clearly current without shouting.
- **Mobile:** Sidebar collapses to a horizontal scrolling nav row; top bar stacks.

### Signature: Generation Stage Flow & Loading States
The pipeline timeline (`admin-flow` / stage rows) renders stages as a vertical
connected sequence with state-colored index nodes (running = coral glow, complete
= reel-green). Ordinary route and data loading waits briefly before revealing a
shared quick-loading state: content-dense routes show content-shaped skeleton
geometry, while routes without useful geometry use a compact progress treatment.
The active pixel-art studio crew is reserved for known queued or running creative
production, where the wait is part of the product story rather than an incidental
fetch. The same scene may rest in its idle frame as context after that production
finishes; it is not then a loading indicator. Compact buttons, pagination,
thumbnails, upload progress, and background refreshes keep their purpose-sized
indicators. This is where "show the work, not the slot machine" lives — make it
legible and provenance-rich.

Specialized recovery states may retain their own layout when they expose useful
pending-state context or escape actions; the Run Progress opener keeps its
stored-run hint and project link before handing off to the crew-based production
view.

Hierarchy-backed full-video production replaces the primitive stage rail with a
quiet, divider-based Creative Director summary. Visuals and Audio appear as
semantic lanes: active or blocked work is open, completed work compresses to a
checked row, and implementation-level assignments are a nested disclosure.
State always pairs color with a label and shape. On narrow screens the director
and current lane precede the approved-plan recap so the live production state is
visible without navigating an internal pipeline.

## 6. Do's and Don'ts

### Do:
- **Do** keep one popcorn-gold CTA per screen (The One Gold Rule); use gold only
  for primary action, selection, and key state.
- **Do** carry warmth through accent, type, and imagery on the dark surface — and
  treat `popcorn-warm` (cream light) as a fully-resolved peer theme.
- **Do** use one system-sans family in multiple weights; hierarchy is weight/size/
  case, never a second typeface.
- **Do** convey depth with tonal layers (bg → twilight → raised) plus dark-tuned
  shadows, and lift interactive elements on hover (reversing on `:active`).
- **Do** make generation legible: stages, status, provenance, studio crew for
  known creative production, delayed content-shaped route loading, and a path to
  re-trigger any stage.
- **Do** keep the creator view quiet; reach operator density (evals/runs) only
  through progressive disclosure.
- **Do** show the accent-derived focus ring on every interactive element, and pair
  every state color with an icon or label.

### Don't:
- **Don't** ship the generic AI-SaaS template: no gradient-text heroes, no
  `background-clip: text`, no identical icon-card grids, no tiny tracked uppercase
  eyebrow over every section, no decorative glassmorphism, no hero-metric template.
- **Don't** build a toy/gimmicky generator: no opaque slot-machine "Generate"
  button with random, unexplained results and no provenance.
- **Don't** recreate the overwhelming pro NLE — no wall of panels or dozens of
  controls exposed at once; depth is progressive.
- **Don't** drift into a sterile enterprise dashboard: no gray-on-gray, no
  charts-for-charts'-sake; operator surfaces keep the brand's warmth.
- **Don't** use flat gray for muted text or borders — tint toward the violet
  surface hue (The Tinted-Neutral Rule).
- **Don't** put a second loud color next to the gold CTA, and never use a colored
  `border-left`/`border-right` stripe as an accent.
- **Don't** use fluid `clamp()` heading scales in product chrome; fixed px steps
  only (the marketing landing is the lone exception).
