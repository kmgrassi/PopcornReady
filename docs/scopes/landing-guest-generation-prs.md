# Landing input box + guest generation ("create account or skip & generate") — PR plan

## Goal

Rebuild a prompt box on the **public landing page** that lets anyone start a
video, and use it as the top of the signup funnel. On submit, present a
**"Do you want to create an account?"** choice:

- **Create account** (primary, nudged) → signup → start the run.
- **Skip this step** (secondary) → silently create a Supabase **anonymous
  session** → start the run as a guest.

Either path lands the user on the existing run-progress view. A guest can later
create a real account **in place**, and because Supabase preserves the
`auth.users.id` when an anonymous user is upgraded, **their work auto-claims with
zero data migration** — same auth id resolves to the same `public.users.id`.

Decisions locked with the product owner:

- Guest identity = **anonymous Supabase session** (not an ephemeral token, not a
  forced email).
- On later signup, the guest's project/run is **auto-claimed** (in-place
  upgrade, no merge).

## Why this is net-new, not a rewire

PR #491 ("Remove retired Studio route") deleted `PromptComposer.tsx` and
`StudioPage.tsx` and removed the `/studio` route. The landing hero
(`apps/web/src/routes/HomePage.tsx`) is now just "View projects" / GitHub
buttons — there is **no prompt box and no way to start a video from the landing
page**. The generation engine is intact but **orphaned**: `createAndStartRun`
(`apps/web/src/lib/startRun.ts:152`) and `useStudioFlow`
(`apps/web/src/components/studio/useStudioFlow.ts:354`) still call the same API
(`v1Api.createProject` → `startPromptGenerationRun` /
`startUploadedFootageGenerationRun`), and the backend entrypoints under
`/api/v1/projects/:id/generation-entrypoints/*` are untouched — but **nothing
renders `StudioShell` anymore**.

So this scope rebuilds a **thin prompt→run path** and deliberately does **not**
revive the multi-step Studio wizard. Reviving the wizard is a separate decision.

## Relationship to existing scopes (read before building)

- **[auth-login-signup-dashboard.md](./auth-login-signup-dashboard.md)** /
  **[express-auth-middleware.md](./express-auth-middleware.md)** — the auth
  provider, login/signup pages, and API auth middleware this scope extends. Do
  not fork a parallel guest auth path; an anonymous session is just an
  authenticated session.
- **[supabase-cutover-prs.md](./supabase-cutover-prs.md)** /
  **[docs/supabase-identity-and-rls.md](../supabase-identity-and-rls.md)** — the
  `public.users.auth_id` ≠ `auth.uid()` identity model and
  `current_app_user_id()`. PR 1 below verifies the anonymous user flows through
  `handle_new_user` and this mapping correctly; read the identity rules first.
- **[docs/NORTH_STAR.md](../NORTH_STAR.md)** /
  **[docs/ui-interaction-model.md](../ui-interaction-model.md)** — the landing
  prompt box is **top-of-funnel intake**, not an object-edit surface, so a
  direct input is appropriate here; the run itself stays agent-driven and
  autonomous-by-default. Do not add per-stage form editing to the landing flow.

## Current state (verified facts that drive the plan)

- **An anonymous Supabase session counts as `status: "authenticated"`** in
  `apps/web/src/components/auth/AuthProvider.tsx` and
  `apps/web/src/components/AppLayout.tsx`. Once a guest has an anon session,
  **all existing authed routes and API calls work unchanged** — no parallel
  guest code path through the SPA or the API.
- **The identity path already covers anonymous users** (verify, don't rebuild).
  `handle_new_user()`
  (`supabase/migrations/20260603000000_init_schema.sql:111-159`, trigger
  `on_auth_user_created:157`) fires `after insert on auth.users`, and anonymous
  sign-in inserts a real `auth.users` row. The email-match lookup is guarded by
  `if v_email is not null` (`:124`), so for an anonymous user (`email` null)
  `v_existing` stays null and the function falls through to its **unconditional
  `else` insert** (`:140-150`), creating a `public.users` row with
  `auth_id = new.id` and `email` null (the column is nullable). The API
  middleware (`apps/api/src/middleware/auth.ts:109-117`) then resolves a valid
  domain id via `current_app_user_id()`. **No trigger/migration change is
  required** for an anon user to get an app identity.
- **Auto-claim is free.** In-place upgrade (`supabase.auth.updateUser` /
  `linkIdentity`) keeps `auth.uid()`, so `current_app_user_id()`
  (`...init_schema.sql:98-106`) resolves the **same** `public.users.id`. The
  guest's project is already theirs; nothing to migrate.
- **Anonymous sign-ins are not enabled or used today** — no code references
  `signInAnonymously` / `isAnonymous`. Enabling it is a Supabase project-settings
  toggle, not a code change.

---

## Work breakdown (parallelizable PRs)

> Dependency note: there is **no backend migration unblock** — the existing
> `handle_new_user` trigger already creates a `public.users` row for anonymous
> users (see Current state). The only true prerequisite is enabling anonymous
> sign-ins in Supabase (PR 2's ops step) plus the one-time identity-path
> verification in PR 1. PR 2 (web `signInAnonymous`) and PR 3 (landing UI) can
> be built in parallel; PRs 4–7 are largely independent once 2–3 are in.

### PR 1 — Verify the anonymous identity path (spike, likely no code)

The earlier draft of this plan assumed a missing-`public.users`-row gap that
**does not exist** — `handle_new_user`'s `else` branch already inserts a row for
email-less (anonymous) users. So PR 1 is a verification spike, not a migration:

Implementation artifact:
[landing-guest-generation-pr1-verification.md](./landing-guest-generation-pr1-verification.md).

- With anonymous sign-ins enabled, create an anon session and confirm a
  `public.users` row is created with `auth_id` = the anon `auth.users.id` and
  null `email`.
- Confirm `current_app_user_id()` / `resolveAppUserId`
  (`apps/api/src/middleware/auth.ts:109-117`) resolves a domain id for the anon
  token so a real authed API call (e.g. `createProject`) succeeds — **no
  middleware or trigger change expected**.
- Check the edge cases that *could* surface a real failing condition: multiple
  concurrent anon users with null `email` against any `public.users.email`
  uniqueness, and whether any RLS policy keyed on the `authenticated` role
  behaves differently for an `is_anonymous` JWT.
- **Only if** verification finds a concrete failure does this PR turn into a
  migration — and then it is an additive **drop+create** of `handle_new_user`
  with a unique timestamp (never edit an applied migration), documenting the
  exact failing condition.

### PR 2 — `signInAnonymous` in the web auth layer

- Add `signInAnonymous()` to `AuthContextValue`
  (`apps/web/src/components/auth/AuthProvider.tsx:20-29`) calling
  `supabase.auth.signInAnonymously()`.
- Surface an `isAnonymous` flag (from `user.is_anonymous`) on the context for
  the upgrade nudges in PR 5.
- **Ops:** enable anonymous sign-ins in the Supabase project settings (console
  toggle — call this out in the PR description; it is not code).

### PR 3 — Rebuild the landing prompt box + account-choice modal

- New prompt composer in the hero (`apps/web/src/routes/HomePage.tsx:209`):
  prompt textarea + length selector + "Create my N-second video".
- On submit → `AccountChoiceModal` titled **"Do you want to create an
  account?"**:
  - **Create account** → route to signup, carrying the pending prompt.
  - **Skip this step** → call `signInAnonymous()`, then proceed to PR 4's path.
- Gate submit through the **client-side run guard** from PR 6 (below) before
  either branch starts a run.

### PR 4 — Thin "quick start" run path

- Small helper that builds a `BriefDraft` from `{ goal, length }` and calls
  `createAndStartRun` (`apps/web/src/lib/startRun.ts:152`) directly — bypassing
  the orphaned wizard — then navigates to
  `/projects/:projectId/runs/:runId` (`apps/web/src/routes/RunProgressPage.tsx`).
- Both modal branches funnel here.
- **Pending-prompt persistence:** the prompt must survive the signup redirect
  (router state + `sessionStorage`) and **auto-fire once `status` becomes
  `authenticated`**. This is the fiddliest UX bit — handle the "auth resolves
  after redirect" race explicitly.

### PR 5 — In-place account upgrade (the claim + ongoing nudge)

- For an authenticated **anonymous** user, an upgrade entry point (banner on the
  run/dashboard: "Save your video — create an account") calling
  `supabase.auth.updateUser({ email, password })` (or `linkIdentity`). Same auth
  id → project already theirs; verify nothing else is needed to claim.
- **Edge case:** upgrading to an email that already has an unlinked
  `public.users` row (invite collision). For v1, detect and surface a clear
  error rather than silently merging two identities.

### PR 6 — Abuse guard: client-side run limit (localStorage) + server quota

Anonymous generation is free compute exposed to the internet, so it needs a
brake. This PR has two layers; **the localStorage layer is the v1 must-have**,
the server quota is the durable backstop.

- **Client-side (localStorage) limit — primary ask:**
  - Track guest runs in `localStorage` (e.g. a `pr.guestRuns` record holding a
    count + first-run timestamp window). Before starting a guest run in PR 3/PR 4,
    read the record; if the everyday user has already started their allowed run(s)
    in the window, **block the submit and show the account-creation modal as the
    way forward** ("Create an account to make more videos") instead of starting
    another run.
  - Pick a small allowance (suggest **1 guest run**, optionally a short
    rolling window) and a single constant so it's trivial to tune.
  - Increment on successful run start; surface remaining allowance in the UI
    copy so the limit is honest, not a silent dead-end.
  - **Known limitation, state it plainly in the PR:** localStorage is trivially
    cleared/incognito-bypassed. This is a *friction* control for the honest
    everyday user, **not** a security boundary — it exists so a normal user
    can't casually spin up multiple runs. The real enforcement is the server
    quota below.
- **Server-side quota (backstop):** per-anon `public.users` run quota enforced
  in the generation entrypoint so a cleared-localStorage / scripted client still
  can't generate unbounded runs. Consider a captcha before the first anon run if
  abuse shows up. Decide whether this gates the public launch of PR 3 or ships
  as a fast-follow.

---

## Open questions / risks

- **Supabase anonymous sign-ins must be toggled on** in project settings — a
  console step, blocks PR 2 end-to-end testing.
- **Abuse surface is the biggest real risk.** The localStorage guard (PR 6) is
  deliberately a UX brake, not security; do not let it be mistaken for the
  enforcement boundary. Decide the server-quota posture before PR 3 is public.
- **Pending-prompt-across-redirect race** (PR 4) is the most likely source of
  subtle bugs — design the auto-fire to be idempotent so a prompt can't double-
  submit.
- **Orphaned `StudioShell` wizard stays out of scope.** If the full wizard
  should come back, that is a separate scope, not this one.
