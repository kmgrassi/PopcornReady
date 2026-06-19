# Catalog seed assets

Pre-generated source images for the anchor-catalog seed set. They're reviewed
here (in PRs) before they go live, then uploaded as assets and published as
catalog entries during the seed run — see
[`docs/scopes/anchor-catalog-seed-plan.md`](../../docs/scopes/anchor-catalog-seed-plan.md).

- **`manifest.json`** — one entry per seed anchor: the image file, the catalog
  publish metadata (kind / title / summary / tags), and full generation
  provenance (provider / model / size / quality + the exact prompt).
- **`images/`** — the generated source images.

> "Available to users" happens when these are published to the **production**
> catalog (needs an auth token / the seed run). Committing them here just
> preserves the approved generations and keeps them reviewable. If we later
> prefer not to version binaries, the alternative is to upload straight to prod
> during the seed run and drop these files.
