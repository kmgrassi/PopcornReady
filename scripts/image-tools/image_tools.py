#!/usr/bin/env python3
"""Local image-editing helper commands.

This sidecar intentionally stays small and dependency-light. The first command
removes light, edge-connected backgrounds from generated sprite sheets without
globally deleting every white/gray pixel in the artwork.
"""

from __future__ import annotations

import argparse
import sys
from collections import deque
from pathlib import Path
from typing import Iterable


RGBA = tuple[int, int, int, int]


def require_pillow():
    try:
        from PIL import Image
    except ImportError as exc:
        raise SystemExit(
            "Pillow is required. Install it with:\n"
            "  pip install -r scripts/image-tools/requirements.txt"
        ) from exc
    return Image


def parse_hex_color(value: str) -> RGBA:
    raw = value.strip().lstrip("#")
    if len(raw) not in (6, 8):
        raise argparse.ArgumentTypeError("Expected #RRGGBB or #RRGGBBAA.")
    try:
        parts = [int(raw[index : index + 2], 16) for index in range(0, len(raw), 2)]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Expected a valid hex color.") from exc
    if len(parts) == 3:
        parts.append(255)
    return tuple(parts)  # type: ignore[return-value]


def edge_points(width: int, height: int) -> Iterable[tuple[int, int]]:
    for x in range(width):
        yield x, 0
        yield x, height - 1
    for y in range(height):
        yield 0, y
        yield width - 1, y


def is_background_pixel(
    pixel: RGBA,
    *,
    light_threshold: int,
    gray_tolerance: int,
    alpha_threshold: int,
) -> bool:
    r, g, b, a = pixel
    if a <= alpha_threshold:
        return True
    is_light = r >= light_threshold and g >= light_threshold and b >= light_threshold
    is_grayish = max(r, g, b) - min(r, g, b) <= gray_tolerance
    return is_light and is_grayish


def remove_edge_connected_background(
    input_path: Path,
    output_path: Path,
    *,
    light_threshold: int,
    gray_tolerance: int,
    alpha_threshold: int,
) -> None:
    Image = require_pillow()
    image = Image.open(input_path).convert("RGBA")
    pixels = image.load()
    width, height = image.size
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque(edge_points(width, height))

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if visited[index]:
            continue
        visited[index] = 1

        pixel = pixels[x, y]
        if not is_background_pixel(
            pixel,
            light_threshold=light_threshold,
            gray_tolerance=gray_tolerance,
            alpha_threshold=alpha_threshold,
        ):
            continue

        r, g, b, _a = pixel
        pixels[x, y] = (r, g, b, 0)

        if x > 0:
            queue.append((x - 1, y))
        if x < width - 1:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y < height - 1:
            queue.append((x, y + 1))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


def preview_on_background(input_path: Path, output_path: Path, background: RGBA) -> None:
    Image = require_pillow()
    image = Image.open(input_path).convert("RGBA")
    preview = Image.new("RGBA", image.size, background)
    preview.alpha_composite(image)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    preview.save(output_path)


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 0 or parsed > 255:
        raise argparse.ArgumentTypeError("Expected an integer from 0 to 255.")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="image_tools.py",
        description="Local image-editing helper commands.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    remove = subparsers.add_parser(
        "remove-background",
        help="Remove light edge-connected background pixels from an image.",
    )
    remove.add_argument("input", type=Path)
    remove.add_argument("output", type=Path)
    remove.add_argument(
        "--light-threshold",
        type=positive_int,
        default=215,
        help="Minimum RGB value for light background candidates. Default: 215.",
    )
    remove.add_argument(
        "--gray-tolerance",
        type=positive_int,
        default=28,
        help="Maximum RGB channel spread for gray/white candidates. Default: 28.",
    )
    remove.add_argument(
        "--alpha-threshold",
        type=positive_int,
        default=0,
        help="Pixels at or below this alpha are treated as background. Default: 0.",
    )

    preview = subparsers.add_parser(
        "preview-background",
        help="Composite a transparent image onto a solid background for inspection.",
    )
    preview.add_argument("input", type=Path)
    preview.add_argument("output", type=Path)
    preview.add_argument(
        "--background",
        type=parse_hex_color,
        default=parse_hex_color("#1e1e1e"),
        help="Preview color as #RRGGBB or #RRGGBBAA. Default: #1e1e1e.",
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "remove-background":
        remove_edge_connected_background(
            args.input,
            args.output,
            light_threshold=args.light_threshold,
            gray_tolerance=args.gray_tolerance,
            alpha_threshold=args.alpha_threshold,
        )
        print(f"Saved transparent PNG to: {args.output}")
        return 0

    if args.command == "preview-background":
        preview_on_background(args.input, args.output, args.background)
        print(f"Saved preview PNG to: {args.output}")
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
