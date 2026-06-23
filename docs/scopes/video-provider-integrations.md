# Video Provider Integrations

## Context

The May 2026 video-model research report ranks these production-relevant
families:

- Google Veo 3.1
- Kling VIDEO 3.0 Omni
- Runway Gen-4.5
- Seedance 2.0
- LTX-2.3
- Wan 2.1 VACE

Popcorn Ready already has working provider paths for Google Veo through Gemini
and OpenAI Sora. This scope tracks how to integrate the rest without hiding
provider-specific constraints.

## Provider URL Index

### Google Veo / Gemini API

- Veo video generation docs: https://ai.google.dev/gemini-api/docs/video
- Google AI Studio Veo page: https://aistudio.google.com/models/veo-3

### Kling / Kuaishou

- Kling API overview: https://kling.ai/document-api/quickStart/productIntroduction/overview
- Kling quick start: https://kling.ai/document-api/guides/get-started/quick-start
- Kling video models reference: https://kling.ai/document-api/apiReference/model/videoModels
- Kling Omni video generation reference: https://kling.ai/document-api/apiReference/model/OmniVideo

### Seedance 2.0 / ByteDance

- Seedance 2.0 official model page: https://seed.bytedance.com/en/seedance2_0
- Seedance 2.0 official launch post: https://seed.bytedance.com/en/blog/official-launch-of-seedance-2-0
- BytePlus Seedance product/API access page: https://www.byteplus.com/en/product/seedance
- Seedance 2.0 on Replicate: https://replicate.com/bytedance/seedance-2.0
- Seedance 2.0 Replicate API page: https://replicate.com/bytedance/seedance-2.0/api
- Seedance 2.0 on fal.ai: https://fal.ai/seedance-2.0
- fal.ai Seedance 2.0 API docs repository: https://github.com/fal-ai/seedance-2.0-api

Note: first-party global access is less settled than Google or Kling. Treat
fal.ai, Replicate, and BytePlus as candidate access paths until this project has
a confirmed direct ByteDance contract and API surface.

### xAI Grok Imagine

- xAI developer docs overview: https://docs.x.ai/overview
- xAI Imagine API overview: https://docs.x.ai/developers/model-capabilities/imagine
- xAI video generation docs: https://docs.x.ai/developers/model-capabilities/video/generation
- xAI Grok Imagine API announcement: https://x.ai/news/grok-imagine-api

## Implemented In This Pass

### Runway

Provider key: `runway`

Environment:

- `RUNWAYML_API_SECRET`
- fallback alias: `RUNWAY_API_KEY`

Supported:

- Text-to-video through Runway `POST /v1/text_to_video`
- Image-to-video through Runway `POST /v1/image_to_video` when a local
  reference path is present
- Polling `GET /v1/tasks/:id`
- Downloading the first returned output URL into Popcorn Ready storage
- Duration normalization to 5 or 10 seconds for the current Gen-4.5 endpoint
  limits

Default model:

- `gen4.5`

Why this matters:

- Covers Runway Gen-4.5 directly.
- Gives us a likely path for Seedance through Runway if the workspace has model
  access and the requested model name is supported.

### LTX

Provider key: `ltx`

Environment:

- `LTX_API_KEY`

Supported:

- Text-to-video through LTX `POST /v1/text-to-video`
- Image-to-video through LTX `POST /v1/image-to-video` when a local reference
  path is present
- Data URI references for local image inputs

Default model:

- `ltx-2-3-fast`

Notes:

- LTX supports data URI media inputs with size limits, so local hero/reference
  images can be passed without first uploading them.
- This implementation requests silent video (`generate_audio: false`) because
  Popcorn Ready already has a separate soundtrack/audio pipeline.

### Kling

Provider key: `kling`

Environment:

- `KLING_API_KEY`
- AK/SK fallback: `KLING_ACCESS_KEY` + `KLING_SECRET_KEY`
- optional base URL override: `KLING_BASE_URL`

Supported:

- Text-to-video through Kling `POST /v1/videos/text2video`
- Image-to-video through Kling `POST /v1/videos/image2video` when a local
  reference path is present
- Polling the created task by id
- Downloading the returned output URL into Popcorn Ready storage
- Duration normalization to 5 or 10 seconds

Default model:

- `kling-v3`

### Seedance 2.0

Provider key: `seedance`

Environment:

- `FAL_KEY`
- fallback alias: `SEEDANCE_API_KEY`
- optional queue URL override: `FAL_QUEUE_BASE_URL`

Supported:

- Text-to-video through fal.ai queue endpoint
  `bytedance/seedance-2.0/text-to-video`
- Image-to-video-style conditioning when a local reference path is present and
  the selected fal model accepts `image_url`
- Queue status polling and result fetch
- Downloading the returned output URL into Popcorn Ready storage

Default model:

- `bytedance/seedance-2.0/text-to-video`

Note:

- This is intentionally the fal.ai access path, not a direct ByteDance API
  wrapper. Replace or add a separate direct provider only after first-party
  global access is confirmed for this project.

### xAI Grok Imagine

Provider key: `xai`

Environment:

- `XAI_API_KEY`

Supported:

- Image generation through xAI image generation endpoints
- Image editing/reference conditioning when a local reference path is present
- Video generation through xAI video generation endpoints
- Polling the created video request by id
- Downloading the returned output URL into Popcorn Ready storage

Default models:

- Image: `grok-imagine-image-quality`
- Video: `grok-imagine-video`

## Still Scoped

### Wan 2.1 VACE

Wan 2.1 VACE is open/self-hosted rather than a simple hosted API integration.
The likely production path is a local or hosted worker, not a direct SaaS
provider call:

- Dedicated worker service with GPU scheduling.
- Input asset staging.
- Job polling and cancellation.
- Output upload back into Popcorn Ready storage.
- Separate config for model checkpoint, resolution, and task type.

Suggested provider key:

- `wan`

Do not add this as a synchronous Next.js route call. The model runtime and job
duration need the async jobs pipeline.

## Routing Recommendation

Default one-shot video provider should remain Gemini/Veo for now:

1. `gemini`
2. fallback `openai`
3. explicit opt-in to `runway`, `ltx`, `kling`, `seedance`, or `xai`

Reason:

- Gemini is already proven locally.
- Runway and LTX require new keys and account-specific model access.
- LTX can be especially useful for lower-cost iteration, but its minimum
  supported durations differ from Gemini/OpenAI.

## Manual Test Plan

HTTP smoke examples for xAI, Kling, and Seedance live in
`docs/examples/agent-video-generation/provider-generation.http`.

Run through `/api/generate-assets`:

```json
{
  "kind": "video",
  "provider": "runway",
  "model": "gen4.5",
  "prompt": "A cinematic shot of a young filmmaker opening a laptop at night.",
  "seconds": 5,
  "size": "1280x720"
}
```

```json
{
  "kind": "video",
  "provider": "ltx",
  "model": "ltx-2-3-fast",
  "prompt": "A cinematic shot of a young filmmaker opening a laptop at night.",
  "seconds": 6,
  "size": "1280x720"
}
```

For character consistency, first generate or select an image asset and pass it
as a reference clip. Runway and LTX both route local image references into
image-to-video requests.
