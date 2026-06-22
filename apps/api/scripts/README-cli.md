# popcorn CLI

One thin HTTP client over the v1 API so the flows the UI runs are scriptable —
against a local server or a remote deploy. Everything the API does is JSON +
poll-based (no websockets/SSE, uploads are base64-in-JSON), so the CLI can reach
essentially everything the UI can.

## Run it

```bash
# canonical form (forwards args reliably)
pnpm --filter @popcorn/api exec tsx scripts/cli.ts <command> [options]

# or from apps/api
cd apps/api && npx tsx scripts/cli.ts <command> [options]

pnpm --filter @popcorn/api exec tsx scripts/cli.ts help
```

## Config

| flag | env | default | notes |
|------|-----|---------|-------|
| `--api <origin>` | `POPCORN_API_URL` | `http://localhost:4000` | API origin; `/api/v1` is appended |
| `--token <jwt>` | `POPCORN_API_TOKEN` | — | bearer; omit in `AUTH_MODE=local`/`hybrid` |
| `--json` | — | off | print raw JSON only (machine-readable) |

## Auth

- **`AUTH_MODE=local` (or `hybrid` with no token)** — no token needed. Every
  protected route resolves to the deterministic dev workspace, so you can just
  curl/CLI everything. This is the easy path for local testing.
- **`AUTH_MODE=supabase` (prod-like)** — needs a real bearer token. Mint one
  without a browser via the Supabase password grant:

  ```bash
  export SUPABASE_URL=... SUPABASE_ANON_KEY=...   # or VITE_ variants
  export POPCORN_API_TOKEN=$(pnpm --filter @popcorn/api exec tsx scripts/cli.ts \
    auth login --email you@example.com --password '***')
  ```

## Commands

```
health | me

project create --name <n> [--prompt <text> --length 30 --aspect 9:16 --format <f>]
project list [--limit 24] | project get <projectId>

upload --project <id> --file <path> [--kind image|video|audio]

run start  --project <id> --prompt <text> [--gates a,b --budget <usd>]
run get    --project <id> --run <id>
run watch  --project <id> --run <id> [--interval 4 --timeout 1800]   # polls until terminal/gate
run approve|reject|cancel --project <id> --run <id> [--note <text>]
run restart --project <id> --run <id> --stage <stageType>

discover projects|assets [--limit 24 --kind image|video|audio]

catalog list   [--limit 24 --kind character|story|image]
catalog search --q <text>
catalog publish --project <id> --kind image|character|story --title <t> \
                (--asset <assetId> | --story <storyBlueprintId>) [--summary <s> --tags a,b]
catalog use --entry <entryId> --project <targetProjectId>
```

## Example: prompt → finished video, end to end

```bash
export POPCORN_API_URL=http://localhost:4200
P=$(pnpm --filter @popcorn/api exec tsx scripts/cli.ts project create --name "Leaf blower" --json | jq -r .project.id)
R=$(pnpm --filter @popcorn/api exec tsx scripts/cli.ts run start --project $P \
      --prompt "A homeowner clears a leaf-covered driveway. Before/after reveal." | tail -1)
pnpm --filter @popcorn/api exec tsx scripts/cli.ts run watch --project $P --run $R
```

## regenerate-smoke — image regeneration against a real DB

Regenerating an image mints a **new immutable asset version** (same lineage,
`version + 1`) and repoints the storyboard panels / selection slots that pointed
at the old asset — the old in-place UPDATE violated `assets_guard_immutable`.
`regenerate-smoke` drives the real `regenerateImageAsset` executor with the image
provider + storage writer stubbed, so only the DB insert + repoint (the
`regenerate_asset_version` RPC) is live. Point it at the local Supabase stack:

```bash
node scripts/with-local-supabase-env.mjs \
  pnpm --filter @popcorn/api exec tsx scripts/regenerate-smoke.ts demo
# or: seed [--project <id>] | inspect <assetId> | run <assetId> [--prompt <text>]
```

`demo` seeds an image asset wired into a panel and a selection slot, regenerates
it, and prints the lineage before/after so you can see v2 minted and both
surfaces repointed while v1 stays intact.

## Known limits (CLI-drivability)

- The only browser/OAuth-shaped step is getting a Supabase token in
  `AUTH_MODE=supabase` — handled by `auth login` above.
- There is no HTTP RPC to invoke a single orchestrator tool in isolation
  (e.g. `generate_keyframe`); drive tools via `run start` or the typed
  per-capability routes.
