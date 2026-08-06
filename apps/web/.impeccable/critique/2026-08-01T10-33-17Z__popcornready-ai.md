---
target: signed-in production experience (owner/admin session)
total_score: 23
p0_count: 0
p1_count: 4
timestamp: 2026-08-01T10-33-17Z
slug: popcornready-ai
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Production clearly surfaces active, failed, and queued runs, but the project hierarchy lets pipeline status overpower the creative object. |
| 2 | Match between system and real world | 2 | Creator language is mixed with assets, runs, providers, models, provenance, and immutable-output terminology. |
| 3 | User control and freedom | 2 | Back and recovery paths exist, but the ten-second automatic generation approval lacks an immediate pause/manual-only control. |
| 4 | Consistency and standards | 2 | Shared components are coherent, while creation is split between asset and full-video systems and direct regeneration conflicts with Request Changes. |
| 5 | Error prevention | 2 | Stale proposals and invalid submissions are guarded, but automatic spend approval and equal prominence for a full-account bearer token increase avoidable risk. |
| 6 | Recognition rather than recall | 3 | Navigation and breadcrumbs are clear, but users must infer whether to use Create, New project, Library, a project, or Activity. |
| 7 | Flexibility and efficiency | 2 | Command search and direct links help, while unbounded draft lists, few bulk actions, and one-item flows slow experienced users. |
| 8 | Aesthetic and minimalist design | 2 | The dark palette is coherent, but repeated panels, uppercase labels, active stripes, and equal-weight actions make the product feel templated and dense. |
| 9 | Error recovery | 3 | Failed runs explain recovery and many error states preserve context, though raw provider messages can leak into creator UI. |
| 10 | Help and documentation | 2 | FAQ exists, but creation, cost, provider, provenance, and Request Changes decisions lack contextual guidance. |
| **Total** |  | **23/40** | **Acceptable; significant improvements needed** |

## Anti-Patterns Verdict

**LLM assessment:** The interface does not look like a garish generated mockup, but it does look like a familiar dark AI-creative SaaS product. Its warmth is mostly token-deep. Repeated uppercase labels, bordered panels, identical card structures, active side stripes, and operator vocabulary crowd out the promised editorial workshop. The production project page is the clearest example: pipeline chrome owns the opening viewport while the creative work is pushed below it.

**Deterministic scan:** The Impeccable detector scanned 127 markup files and returned 12 warnings: ten `layout-transition` warnings, one `bounce-easing` warning, and one `side-tab` warning. The layout warnings occur in progress/upload meters across `ActiveRunsPanel.module.css`, `ProgressView.module.css`, `StoryboardBoard.module.css`, `StudioShell.module.css`, `HomePage.module.css`, `ProjectMobileStatus.module.css`, `StoryboardPreview.module.css`, and two legacy `globals.css` locations. They are lower impact than arbitrary layout animation but still animate width. The clapperboard transition in `AgentRunPreview.module.css` uses an overshooting Bézier, and `StateCard.module.css` uses a 3px danger stripe. Reduced-motion handling mitigates several progress meters but does not make the detector findings false positives.

**Visual overlays:** No detector overlay was injected. The isolated evidence agent had no in-app-browser backend, and the main browser's inspection surface is read-only for script evaluation, so mutable injection could not be established reliably. Live production was instead verified with direct desktop/mobile DOM and screenshot inspection.

## Overall Impression

The product has a good systems-status foundation but no single, legible creator journey. The biggest opportunity is to decide that the user's primary intent is “make or improve a video,” then make assets, runs, providers, and pipeline stages subordinate evidence rather than competing destinations.

## What's Working

- Production status communication is strong. The dashboard distinguishes running, failed, queued, and ready states, gives failed runs a clear recovery path, and uses skeletons and progress semantics thoughtfully.
- Mobile has a strong visual seed. A current project's image leads, touch targets are large, navigation is labeled, focus/reduced-motion foundations exist, and the interface feels calmer than desktop.
- Concept, Brief, Script, and Storyboard largely converge on observe-first presentation with scoped Request Changes entry points.

## Priority Issues

### [P1] Creation is split into competing product models

**Why it matters:** The shell says “Create new asset,” mobile says “Create,” Activity points toward video creation, `/create` makes an asset for an existing project, and `/projects/new` is the separate full-video path. In production, the new-project page opens with a long, unbounded “Continue a draft” list; the actual new-project action is not visible in the first viewport. Library Projects compounds this with a gold “Projects” link that points back to the current page.

**Fix:** Create one intent-first launcher—“What do you want to make?”—with a clearly dominant “Full video” path and a secondary “Project asset” path. Use the same wording from desktop, mobile, Library, and Activity. Move draft recovery into a searchable/recent section that cannot bury the new-project action, and replace circular Library actions with the launcher.

**Suggested command:** `$impeccable shape`

### [P1] Ten-second automatic approval turns silence into consent

**Why it matters:** Production tells users that image generation starts automatically ten seconds after proposal readiness. This is a high-stakes, cost-bearing moment with no obvious in-place pause or “manual approval only” control. The countdown's changing number is hidden from assistive technology in source, making urgency less legible for keyboard/screen-reader users.

**Fix:** Make timed approval explicitly opt-in, or add a persistent “Pause auto-start / approve manually” control before the timer begins. Announce time changes accessibly and preserve the user's revision without forcing navigation.

**Suggested command:** `$impeccable harden`

### [P1] Direct regeneration contradicts the product's Request Changes promise

**Why it matters:** Asset surfaces expose regeneration with prompt/provider/model inputs while project objects use scoped Request Changes. This recreates the isolated mutation path the interaction model explicitly rejects and forces creators to reason about implementation details and downstream consistency.

**Fix:** Route asset regeneration through the same object-scoped proposal lifecycle: current state, requested intent, blast radius, maximum cost, confirmation, and downstream reconciliation. Provider/model selection stays server-owned.

**Suggested command:** `$impeccable distill`

### [P1] Project overview makes pipeline machinery the visual protagonist

**Why it matters:** On production desktop, the first project viewport is dominated by “Run pipeline,” Current/Next/Updated panels, and a long stage rail. The project's story, concept, media, and next creative decision sit below. Many equal-weight panels and repeated uppercase labels make creators scan infrastructure before understanding their work.

**Fix:** Give the generated media/story and one next decision roughly 70% of the opening composition. Collapse the stage rail into a compact status summary with progressive disclosure, remove decorative eyebrows and redundant boxed metadata, and keep operator diagnostics one level deeper.

**Suggested command:** `$impeccable layout`

### [P2] Settings compresses basic, advanced, developer, and admin controls into one page

**Why it matters:** Model defaults and personal provider keys are intentional creator-facing capabilities, while the provider smoke test and secondary links are already limited to admin/operator roles. The hierarchy still compresses basic account and appearance controls, advanced creator generation settings, a full-account bearer token, and—during this owner/admin audit—the gated operator tools into one scroll. That makes routine settings harder to scan and gives a sensitive developer credential the same prominence as ordinary preferences.

**Fix:** Keep model defaults and BYOK available to creators under a clearly labeled, progressively disclosed generation section. Move the full-account bearer token to a separate Developer or Security surface, and keep the existing role-gated smoke test and operator links in an explicit admin area. Do not remove the documented creator choice of models and personal API keys.

**Suggested command:** `$impeccable distill`

## Persona Red Flags

**Alex — experienced creator:** New-project creation starts with a large draft backlog, there is no clear bulk asset workflow, and the product asks Alex to translate intent across asset, project, run, and provider systems.

**Sam — keyboard/screen-reader user:** Timed approval lacks a clear pause/extension control; changing countdown urgency is not continuously announced; the mobile bottom navigation competes with a page CTA; and the drawer implementation needs a verified focus trap. Strong focus rings, labeled navigation, 44px targets, and reduced-motion rules are positive foundations.

**Maya — creator/marketer:** “Create new asset” does not match the goal of finishing a social video. Model defaults and BYOK can be useful advanced choices, but placing them beside basic preferences and a full-account bearer token makes routine Settings feel like infrastructure tooling. The smoke test and secondary operator links seen in this audit were specific to the owner/admin session.

## Minor Observations

- Dashboard, Home, and Launchpad name the same conceptual destination in different layers.
- FAQ and FAQs are inconsistent.
- Mobile can show a gold Create navigation action and a gold page CTA simultaneously, weakening the one-gold rule.
- A long project title visibly clips within a production Library card.
- Production project metadata exposes raw machine identifiers without creator-friendly formatting.
- The desktop Dashboard and project page show strong state detail but rely heavily on uppercase labels and nested bordered panels.
- Ten width transitions can be moved to transform-based progress fills; the overshooting clapper motion and danger side stripe should be replaced.

## Questions to Consider

- Is the primary unit a finished video, a project, or an asset—and which single word should a first-time creator learn?
- How should Settings separate everyday preferences, advanced creator BYOK/model defaults, developer credentials, and already-gated admin diagnostics without removing documented customer capabilities?
- If the dashboard is for seeing and the agent is for changing, what justifies any prompt/provider regeneration form outside Request Changes?
- Is ten seconds of silence valid consent to spend credits?
- What would the project page become if the movie and its next creative decision owned the opening viewport?
