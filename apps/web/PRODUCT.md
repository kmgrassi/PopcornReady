# Product

## Register

product

## Users

Two audiences, **creators primary**:

- **Creators / marketers (primary):** People making short-form and social video
  who want the AI to do the heavy lifting. Their context is "I have an idea (or a
  brief, or some footage) and I want a finished video without learning a timeline
  editor." They mostly *review and nudge* — they should never feel they're
  operating professional NLE machinery.
- **Operators (you + team, secondary):** People who run, debug, and evaluate the
  generation pipeline — evals, admin, runs, generation diagnostics. They want
  power tooling: density, provenance, and the ability to re-trigger any stage.

The design serves the creator first and exposes operator depth progressively,
never at the cost of the creator's calm.

## Product Purpose

Popcorn Ready is an **AI-native video studio**. The product never touches raw
video — agents produce and edit a **structured timeline**, and rendering is
deterministic. Per the North Star, generation is one agent-orchestrated,
non-one-directional pipeline: stages are tools the agent calls, runs are
autonomous by default, any stage can be re-triggered, and a change recomputes
only the affected assets via a dependency/provenance graph.

The UI is **observe-first**: the dashboard is read-optimized with minimal
direct-edit controls, and the *only* way to change content is the object-scoped
**"Request Changes"** modal — every change flows through the agent. Nothing is
edited in isolation.

Success looks like: a creator describes or uploads something, watches the studio
generate it autonomously, and reaches a finished, on-brand video by reviewing and
asking for changes — never by wrestling controls. For operators, success is being
able to see and re-run any stage with full provenance.

## Brand Personality

**Warm, approachable, editorial.** Friendly and human; magazine-like restraint
that lowers the intimidation of pro video tooling. The interface should read as a
confident creative collaborator, not a control panel and not a slot machine.

Warmth is carried by the **accent (popcorn amber/coral), typography, and
imagery** — not by decoration and not by a cream body background. The committed
surface is dark, near-black violet (`popcorn` / `popcorn-night` themes), with a
warm cream light theme (`popcorn-warm`) as a peer. The single popcorn-yellow CTA
is the one loud move per screen; everything else is calm.

Voice: plain, encouraging, specific. It tells you what's happening and what it
just did, in human language.

## Anti-references

This should NOT look or feel like:

- **Generic AI-SaaS template.** No gradient-text heroes, no identical icon-card
  grids, no tiny tracked uppercase eyebrow on every section, no decorative
  glassmorphism, no hero-metric template (big number + label + gradient).
- **Toy / gimmicky AI generation.** No slot-machine "Generate" button with
  random, opaque results. Generation is legible: stages, status, and provenance
  are visible; the user can always see why an asset looks the way it does and
  re-trigger it.
- **Overwhelming pro NLE.** Not Premiere/After Effects — no wall of panels, no
  dozens of controls exposed at once. Depth is progressive, not front-loaded.
- **Sterile enterprise dashboard.** No gray-on-gray soulless admin, no
  charts-for-charts'-sake. Even operator surfaces keep the brand's warmth.

## Design Principles

1. **Observe first, change through the agent.** Default every object surface to
   read-only plus a "Request Changes" entry point. Resist adding form fields and
   inline editors; the agent is the single edit path. (North Star Principle 10.)
2. **Show the work, never the slot machine.** Make generation legible — stages,
   status, provenance, and the ability to re-run any stage. Trust comes from the
   pipeline being visible, not hidden behind a magic button.
3. **Calm by default, depth on demand.** The creator's view is quiet and
   uncrowded; operator density (evals, runs, diagnostics) is reachable but never
   the first thing a creator sees. Progressive disclosure over wall-of-controls.
4. **Warmth without cream.** Carry the brand through accent, type, and imagery on
   a committed dark surface. One popcorn-yellow CTA per screen; everything else
   restrained.
5. **Earned familiarity.** Reuse standard product affordances (nav, tabs,
   command-style actions, real loading/empty/error states) so the tool disappears
   into the task. Surprise is reserved for moments, not pages.
6. **Don't entrench the old forward-only model.** Align new surfaces to the
   re-entrant asset-graph pipeline; flag deviations rather than rebuilding
   patch-the-timeline flows.

## Accessibility & Inclusion

- Target **WCAG 2.1 AA**: body text ≥4.5:1, large text ≥3:1, including on the
  dark themes and the warm light theme. Watch muted text on tinted panels — the
  most likely failure here.
- All three themes (`popcorn`, `popcorn-night`, `popcorn-warm`) must clear
  contrast independently; the warm light theme is a first-class peer, not an
  afterthought.
- **Reduced motion is required.** Every animation needs a
  `prefers-reduced-motion: reduce` fallback (crossfade or instant). Generation
  progress and skeletons must remain legible with motion off.
- Don't encode state in color alone (generation status, eval verdicts): pair with
  icon, label, or shape so it survives color-blindness.
- Keyboard and focus: visible focus ring (the accent-derived `--ring`), full
  keyboard reach for the "Request Changes" flow and primary actions.
