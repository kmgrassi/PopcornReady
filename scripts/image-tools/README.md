# Image Tools Sidecar

Small Python helpers for local image cleanup tasks that are easier outside the
TypeScript app runtime. The first command removes light, edge-connected
background pixels from generated sprite sheets while preserving light pixels
inside the sprite artwork.

## Setup

```bash
python3 -m venv .venv-image-tools
. .venv-image-tools/bin/activate
pip install -r scripts/image-tools/requirements.txt
```

## Remove A Light Background

```bash
python scripts/image-tools/image_tools.py remove-background \
  ~/Downloads/worker_sprite_sheet.png \
  ~/Downloads/worker_sprite_sheet_transparent.png
```

Tune the detector if faint checkerboard pixels remain:

```bash
python scripts/image-tools/image_tools.py remove-background \
  input.png output.png \
  --light-threshold 200 \
  --gray-tolerance 32
```

For baked checkerboard sprite sheets, lower the threshold further:

```bash
python scripts/image-tools/image_tools.py remove-background \
  input.png output.png \
  --light-threshold 130 \
  --gray-tolerance 35
```

## Preview Transparency

```bash
python scripts/image-tools/image_tools.py preview-background \
  output.png preview_on_dark.png \
  --background "#1e1e1e"
```
