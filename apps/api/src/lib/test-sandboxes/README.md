# Test Sandboxes

Shared service-role lifecycle for throwaway E2E fixture data.

Each sandbox creates:

- one `workspaces` row marked `purpose = 'internal_test'`
- one canonical project under that workspace
- one `test_sandboxes` row with a harness-specific `purpose`

Teardown calls `delete_test_sandbox(p_sandbox_id)`, which deletes the
`internal_test` workspace and lets foreign keys cascade all seeded project data.

## Web E2E Fixtures

Browser tests should use the dev-only HTTP lifecycle instead of direct database
access from Playwright:

```sh
NODE_ENV=development AUTH_MODE=local ENABLE_WEB_E2E_HARNESS=1 pnpm dev:api
```

Create a sandbox:

```http
POST /api/v1/dev/web-e2e/sandboxes
Content-Type: application/json

{ "projectName": "studio generation smoke", "featureSet": ["studio"] }
```

Delete it during teardown:

```http
DELETE /api/v1/dev/web-e2e/sandboxes/:sandboxId
Content-Type: application/json

{ "workspaceId": "...", "workspaceName": "__webe2e__..." }
```

The route is never mounted when `NODE_ENV=production`. A sweeper is available at
`POST /api/v1/dev/web-e2e/sandboxes/sweep` for crashed local runs.
