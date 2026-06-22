# Landing guest generation PR 1 verification

Scope: verify that Supabase anonymous users can use the existing auth identity
path before adding the landing-page guest-generation UI.

## Result

No runtime migration is needed for the anonymous identity path.

The existing schema already mirrors an anonymous `auth.users` row into
`public.users`:

- `public.users.email` is nullable.
- `users_unique_unlinked_email` only applies when `email is not null` and
  non-blank, so multiple anonymous users with null email do not collide.
- `handle_new_user()` only performs email adoption when `v_email` is present.
- The unconditional insert path writes `(auth_id, email)` as `(new.id, v_email)`,
  which covers anonymous users with `email = null`.

The existing API auth middleware already resolves the anonymous session through
the same app identity path as normal users:

- `current_app_user_id()` maps `auth.uid()` to `public.users.id`.
- `current_app_user_id()` is executable by the `authenticated` role, which is the
  role used by signed-in Supabase users, including anonymous sessions.
- `authMiddleware` calls `resolveAppUserId()` with the user-scoped Supabase
  client and exposes only `public.users.id` as `req.publicUserId`.

## Automated guard

`apps/api/src/lib/supabase/__tests__/anonymous-identity-path.test.ts` statically
checks the SQL and middleware invariants above. This is intentionally not a fake
integration test: the repo does not currently include a Supabase SQL test
harness, and anonymous sign-ins still require the project-setting toggle before
live end-to-end verification.

## Remaining live verification

After anonymous sign-ins are enabled in Supabase project settings:

1. Call `supabase.auth.signInAnonymously()` from a browser client.
2. Confirm the inserted `auth.users.id` has one matching `public.users.auth_id`
   row with `email = null`.
3. Use the returned access token against a protected v1 route such as
   `POST /api/v1/projects`; it should resolve `current_app_user_id()` and create
   user-owned data without middleware changes.
