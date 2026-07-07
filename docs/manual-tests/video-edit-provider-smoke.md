# Video Edit Provider Smoke Rig

`/api/v1/dev/video-edit` is a dev-only Gemini Omni smoke rig. It exists to test
the shared Gemini provider edit path with real uploaded footage, without writing
assets, selections, or actions to the database.

## Requirements

- `NODE_ENV=development`
- `ENABLE_VIDEO_EDIT_HARNESS=1`
- `GEMINI_API_KEY`, or the configured provider-key source used by
  `resolveProviderApiKey("gemini")`
- `ffmpeg` on `PATH`, or `FFMPEG_PATH=/absolute/path/to/ffmpeg`, for the
  retry-once H.264 transcode fallback used when phone footage is rejected

Start the API:

```sh
NODE_ENV=development ENABLE_VIDEO_EDIT_HARNESS=1 pnpm dev:api
```

Post raw video bytes with a prompt:

```sh
curl -X POST \
  "http://localhost:3001/api/v1/dev/video-edit?prompt=add%20a%20dinosaur%20sitting%20on%20the%20couch" \
  -H "Content-Type: video/quicktime" \
  --data-binary @fixture.mov
```

The response is `202` with a `jobId`. Poll the job:

```sh
curl "http://localhost:3001/api/v1/dev/video-edit/<jobId>"
```

When the job reaches `done`, download `artifacts.video`.

## Operator Caveats

- The provider uses `gemini-omni-flash-preview`, a preview model. It may be
  renamed, rate-limited, unavailable in some regions, or return provider errors
  that are not recoverable by retrying the same prompt.
- Uploaded-video editing is not available to EEA, Switzerland, or UK users at
  the time this harness was scoped. Treat those provider failures as
  user-visible capability limits, not app bugs.
- The smoke rig accepts up to 250 MB, but long clips are not well characterized
  on the Omni preview path. Keep manual fixtures short, preferably under 60
  seconds, until production tooling enforces a duration cap.
- Phone footage is commonly HEVC in a QuickTime container. The provider retries
  one rejected edit after transcoding the first video track, and optional first
  audio track, to H.264/AAC MP4.
- This endpoint is not an editing product surface. User-facing video edits must
  flow through Request Changes and the asset graph so the source asset remains
  immutable and lineage is visible.
