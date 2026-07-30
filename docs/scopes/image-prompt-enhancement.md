# Image Prompt Enhancement

<!-- agent-summary: Asset Studio image requests use a default-on text-model art-direction pass. -->
<!-- agent-summary: The creator can disable enhancement and send the trimmed original prompt exactly. -->
<!-- agent-summary: Enhancement runs inside the idempotent proposal operation before image generation. -->
<!-- agent-summary: The approved effective prompt is bound to the digest, task, run, action, and preview. -->
<!-- agent-summary: Proposal provenance retains the original prompt, effective prompt, and policy version. -->
<!-- agent-summary: Invalid or failed enhancement creates no run, action, gate, or silent fallback. -->
<!-- agent-summary: Video and soundtrack creation remain outside this image-only policy. -->

## Purpose

Asset Studio should help creators avoid generic, glossy image-model defaults
without asking them to learn prompt engineering. For `image_create`, the web UI
offers **Improve image prompt** as a default-on control. The configured fast text
model turns the creator's request into concrete art direction while preserving
the subject, action, named entities, requested text, format, style, mood, and
explicit constraints.

The policy favors one coherent visual idea; physical relationships; useful
composition and camera choices; understandable lighting; specific materials and
surface texture; restrained color and detail hierarchy; and believable
imperfection. It replaces empty quality praise with visible decisions and must
not invent people, products, logos, visible text, lettering, copy, brand facts,
or plot points.

## Proposal and provenance contract

Enhancement is part of `POST
/api/v1/projects/:projectId/agent-creations/proposals`. The endpoint requires an
`Idempotency-Key` before it validates project references or calls the text
model. The shared mutation wrapper reserves that key around the complete route
operation, so a retry replays the same effective prompt and proposal instead of
calling the model again.

The server:

1. parses `improvePrompt` as a strict boolean (absent means false for API
   compatibility);
2. verifies the authenticated project and referenced assets before model spend;
3. enhances only `image_create` requests whose flag is true;
4. validates a non-empty result no longer than 4,000 characters;
5. binds the effective prompt to the request digest, domain task objective and
   instruction, acceptance criteria, run summary, and proposal rationale; and
6. stores the original prompt, effective prompt, applied state, and versioned
   enhancement policy in proposal action parameters.

The proposal response returns `effectivePrompt` and `enhancementApplied`.
Asset Studio keeps the creator's original textarea untouched and shows the
effective prompt read-only before confirmation. Image generation is not
enqueued until the creator confirms the existing one-use proposal gate.

If enhancement fails, times out, or returns invalid output, the endpoint returns
`model_output_invalid` and creates no creator-direct run, proposal action, or
gate. The UI retains the form so the creator can retry or disable enhancement;
there is no silent pass-through.

## Cost boundary

Prompt refinement is a small text-model call during proposal review and is
recorded against the project through the shared LLM cost ledger. It occurs
before confirmation and is outside the proposal's approved maximum for asset
generation. UI copy therefore says that **asset generation** has not begun,
rather than claiming that no model work has occurred.

## Ownership and validation

- Policy and structured call:
  `apps/api/src/lib/api/v1/image-prompt-enhancement.ts`
- Proposal binding and provenance:
  `apps/api/src/routes/v1/agent-creations.ts`
- Typed client mutation:
  `apps/web/src/lib/agent-creations.ts`
- Creator control and review:
  `apps/web/src/routes/StandaloneCreationPage.tsx`

Required coverage includes policy/output validation, exact bypass, non-image
pass-through, typed failure, default-on browser state, effective-prompt preview,
and stale-response invalidation when the creator changes the project or
enhancement toggle. Prompt and goal changes use the same proposal-reset path;
dedicated delayed-response browser cases for those two inputs remain a focused
coverage gap.
