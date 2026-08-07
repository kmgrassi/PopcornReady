# Railway deployment

<!-- agent-summary: The Express API deploys to Railway and the Vite SPA deploys to Netlify. -->
<!-- agent-summary: Production requires Node 22 or newer. -->
<!-- agent-summary: Hosted authentication uses Supabase while asset storage independently uses S3. -->
<!-- agent-summary: STORAGE_BACKEND=s3 enables durable public/private asset reads and writes. -->
<!-- agent-summary: Persisted storage buckets route server-side asset reads; DB_BACKEND does not. -->
<!-- agent-summary: Public delivery uses CloudFront and private delivery uses signed URLs. -->
<!-- agent-summary: Validate health, auth, storage, and generation handoffs after deployment changes. -->

The Express API deploys to Railway from the monorepo root. The Vite web app
deploys separately to Netlify and calls the Railway API through `VITE_API_URL`.
The checked-in `railway.toml` pins the API build/start commands and configures
the health route.

Current production origin: `https://popcornready-production.up.railway.app`
(generated Railway domain). Netlify's `VITE_API_URL` must point at this; if it is
unset the web client falls back to same-origin `/api/*`, which Netlify proxies to
this Railway origin before the SPA fallback.

The API must run on **Node 22+**. `@supabase/supabase-js` constructs a realtime
client (which needs a global `WebSocket`) when `createClient` is called; on Node
20 that throws `Node.js 20 detected without native WebSocket support`, 500-ing
every authenticated request in `authMiddleware`.

Railpack resolves the Node version in this order: `RAILPACK_NODE_VERSION` →
root `package.json` `engines.node` → `.nvmrc`. The authoritative repo pin is
therefore **`engines.node: ">=22"`** in the root manifest (checked before
`.nvmrc`, so a fresh deploy can't silently fall back to Node 20). The root
`.nvmrc` (`22`) keeps local `nvm` in sync, and the live service also sets
`RAILPACK_NODE_VERSION=22`. The Netlify web build pins `NODE_VERSION = "22"`
to match.

## Pricing notes

Railway pricing has two parts:

- A monthly plan subscription.
- Metered resource usage for CPU, RAM, egress, and volume storage.

The paid plan subscription counts toward usage. For example, if the Hobby plan
is $5/month and the project uses less than $5 of resources, the bill remains the
plan minimum. Check Railway's pricing page before launch because plan limits and
resource prices can change.

For this app, expect Railway usage from:

- The Express API service.
- Remotion export jobs, which temporarily use CPU and memory.
- Network egress for API responses and any server-mediated media paths.

Generated/uploaded asset bytes are planned to move to S3 + CloudFront after the
storage backend lands. Until then, do not rely on a Railway volume as durable
production asset storage.

## Deploy from the Railway dashboard

1. Push this repository to GitHub.
2. In Railway, create a new project.
3. Choose **Deploy from GitHub repo** and select this repository.
4. Railway should detect the root app and use `railway.toml`.
5. Add the service variables listed below.
6. Deploy the service.
7. In the service **Networking** settings, generate a public Railway domain or
   attach a custom domain.

## Deploy from the Railway CLI

Install and authenticate the Railway CLI, then run:

```bash
railway init
railway up
```

For automated deploys, use a Railway project token rather than a personal
account token:

```bash
export RAILWAY_TOKEN="your-project-token"
railway up --ci
```

## Required service variables

Set these in the service **Variables** tab:

```bash
AUTH_MODE=supabase
DB_BACKEND=supabase
WEB_ORIGIN=https://popcornready.ai,https://www.popcornready.ai
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...
IDEOGRAM_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
```

Creator-direct proposal confirmation uses direct Postgres, so production
requires `DATABASE_URL`. Use the dedicated `popcorn_api` role and retain the
Supabase SSL parameters. For the current Node `pg` driver, the Supavisor URL
must include `sslmode=require&uselibpqcompat=true`. Prefer the direct connection
when Railway has compatible networking; otherwise use Supavisor session mode on
port 5432. Do not configure the transaction-mode pooler URL for this persistent
application pool. See
[`docs/scopes/database-access-boundary.md`](scopes/database-access-boundary.md).

The Railway health route checks the creator-direct role, rejects unsafe role
attributes, memberships, ownership, or extra effective table/column privileges,
and requires the named RLS policies plus routine execution grants before
returning 200. Because Supabase migrations and Railway builds run independently,
a deployment remains unhealthy—and Railway keeps the prior version serving—
until the additive role migration is visible.

Notes:

- Railway injects `PORT`; do not hard-code a port.
- Keep provider API keys server-only. Do not rename them with `NEXT_PUBLIC_`.
- Hosted deploys should use `AUTH_MODE=supabase`. `AUTH_MODE=local` is for
  local development and private demos only.
- Hosted deploys must not emit `localhost` media URLs. If `STORAGE_BACKEND`
  remains `local` temporarily, set `STORAGE_LOCAL_URL_BASE` to the public
  Railway API origin, for example `https://<api-service>.up.railway.app`.
  Durable production delivery should use the S3/CloudFront configuration below.

## Provisioned asset storage

Asset sharing and delivery will use the S3 + CloudFront resources provisioned
for `docs/scopes/asset-sharing-delivery-prs.md` PR0. The runtime reads and writes
asset bytes through the configured storage backend. Production uses
`STORAGE_BACKEND=s3`; `DB_BACKEND=supabase` controls database persistence and
does not route asset bytes to Supabase Storage.

Stage these non-secret Railway values when enabling the S3 backend:

```bash
STORAGE_BACKEND=s3
AWS_REGION=us-east-1
S3_PUBLIC_BUCKET=popcornready-assets-public
S3_PRIVATE_BUCKET=popcornready-assets-private
S3_PUBLIC_URL_BASE=https://d22zp4rym9mw9c.cloudfront.net
CF_SIGN_KEY_PAIR_ID=K2GHXNWYN1I8EL
```

Stage these secret Railway values from AWS Secrets Manager when enabling the S3
backend:

```bash
AWS_ACCESS_KEY_ID=<popcornready/assets-api-iam-access-key.AWS_ACCESS_KEY_ID>
AWS_SECRET_ACCESS_KEY=<popcornready/assets-api-iam-access-key.AWS_SECRET_ACCESS_KEY>
CF_SIGN_PRIVATE_KEY=<popcornready/cloudfront-signing.CF_SIGN_PRIVATE_KEY>
```

Provisioned AWS resources:

| Resource | Value |
|---|---|
| Public bucket | `popcornready-assets-public` |
| Private bucket | `popcornready-assets-private` |
| Public CloudFront distribution | `E2W8U7YBN5I8LX` |
| Public CloudFront domain | `d22zp4rym9mw9c.cloudfront.net` |
| Public bucket OAC | `E2T9PBFSXQK26X` |
| Future signed-CDN public key | `K2GHXNWYN1I8EL` |
| Future signed-CDN key group | `c102ffbe-c797-476d-bebe-da5086b8ba60` |
| API IAM user | `popcornready-assets-api` |
| IAM access key secret | `popcornready/assets-api-iam-access-key` |
| CloudFront private key secret | `popcornready/cloudfront-signing` |

Both buckets are private with public access blocked, bucket-owner-enforced
object ownership, AES-256 default encryption, and versioning enabled. The public
bucket is readable only by the CloudFront distribution through OAC. The private
bucket has no distribution; private reads use S3 presigned GET first.

Bucket CORS is configured for:

```text
https://popcornready.ai
https://www.popcornready.ai
http://localhost:5173
http://localhost:3000
http://localhost:4000
```

Allowed browser methods are `GET`, `HEAD`, `PUT`, and `POST`; exposed headers
are `ETag`, `x-amz-request-id`, and `x-amz-id-2`.

## Healthcheck

The Railway config uses:

```toml
healthcheckPath = "/api/v1/health"
```

Railway calls this path during deployment and only marks the new deployment
active once it returns HTTP 200.

The API build writes an ignored `.release/release.json` manifest with the exact
full git SHA, shared release orchestration ID, API artifact SHA-256, build time,
and canonical required migration-version set. Production health returns 503
when that manifest is absent or invalid, Railway's commit disagrees, the
least-privilege migration-ledger read fails, or a required migration is absent.
Extra applied migrations remain compatible, including lower out-of-order
versions applied by the repository's supported `--include-all` workflow.

This makes a failed `Apply Supabase migrations` job intentionally block the new
Railway deployment at its health check while the previous API remains active.
Recover the serialized migration job first, then redeploy the same main commit;
rerunning only the release verifier cannot make an unapplied migration set
coherent. The migration workflow's exact Supabase CLI pin and upgrade policy
live in [`supabase/README.md`](../supabase/README.md).

Netlify independently emits `/release.json` after Vite builds, hashing the
deployed `dist` content while excluding the metadata file itself. Both metadata
surfaces use `Cache-Control: no-store` and expose only nonsecret release fields.

The `Verify API Deploy (Railway)` GitHub workflow builds the API, then observes
native Railway, Netlify, and Supabase deploys until the direct API is
database-compatible, Netlify serves the exact full `main` SHA, and Netlify's
same-origin `/api` proxy reaches that same API artifact. It does not serialize or
activate those deploys. A newer push cancels only obsolete observation; database
and hosted-auth mutation workflows stay serialized and are never canceled in
progress.

## File storage limitation

Local development can still store project state and media on the local
filesystem when `DB_BACKEND=local` or `STORAGE_BACKEND=local`:

- `data/project.json`
- `public/uploads/`
- `public/generated/`
- `public/exports/`

Railway deployment filesystems are ephemeral unless a volume is attached. The
current runtime can still write media to non-S3 paths; that is not durable
production asset storage. Hosted deploys should move project state to Supabase
and enable S3/CloudFront only after the storage backend PRs land.

## Public API automation

Railway's public API is GraphQL at:

```text
https://backboard.railway.com/graphql/v2
```

Use an account or workspace token with:

```text
Authorization: Bearer <token>
```

Use a project token with:

```text
Project-Access-Token: <token>
```

Useful automation tasks for this app:

- Create or update service variables.
- Trigger `railway up` from CI with a project token.
- Generate or attach a service domain.
- Query deployment status and logs after deploy.

For most deploys, the CLI and GitHub integration are simpler than direct API
calls. Use the GraphQL API when you need repeatable infrastructure automation.

## Smoke test

After deployment, verify:

```bash
curl https://your-domain.example/api/v1/health
```

Expected response:

```json
{"status":"ok","authMode":"local","time":"..."}
```

Then open the public URL and create a small test project. MP4 export is the
heaviest path, so test at least one export before sharing the service.
