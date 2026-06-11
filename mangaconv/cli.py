"""Command-line interface — a thin convenience wrapper over the core pipeline.

Examples
--------
Convert a single volume for a Paperwhite::

    python -m mangaconv.cli convert vol01.cbz --device paperwhite -o out/

Launch the web app::

    python -m mangaconv.cli serve --port 8000
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .core import DEVICE_PROFILES
from .core.converter import ConversionOptions, convert


def _cmd_convert(args: argparse.Namespace) -> int:
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    options = ConversionOptions(
        device=args.device,
        title=args.title,
        output_format=args.format,
        right_to_left=not args.left_to_right,
        grayscale=None if args.color else True,
        autocontrast=not args.no_autocontrast,
        split_spreads=args.split_spreads,
        max_quality=args.quality,
        size_limit=args.size_limit,
    )

    for src in args.inputs:
        print(f"Converting {src} …")
        result = convert(src, options)
        for part in result.parts:
            dest = out_dir / part.filename
            dest.write_bytes(part.data)
            print(f"  → {dest}  ({part.page_count} pages, {len(part.data) / 1e6:.1f} MB)")
        if result.skipped:
            print(f"  ! skipped {len(result.skipped)} unreadable page(s)")
    return 0


def _cmd_devices(_args: argparse.Namespace) -> int:
    for key, p in DEVICE_PROFILES.items():
        limit = "no limit" if p.size_limit == 0 else f"{p.size_limit // (1024 * 1024)} MB"
        print(f"{key:18} {p.name:38} {p.width}x{p.height}  gray={p.grayscale}  limit={limit}")
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("mangaconv.web.app:app", host=args.host, port=args.port, reload=args.reload)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="mangaconv", description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    c = sub.add_parser("convert", help="Convert one or more archives")
    c.add_argument("inputs", nargs="+", help="CBZ/CBR/ZIP/RAR files")
    c.add_argument("-o", "--output", default="output", help="Output directory")
    c.add_argument("-d", "--device", default="paperwhite", choices=sorted(DEVICE_PROFILES))
    c.add_argument("-t", "--title", default=None, help="Override title")
    c.add_argument("-f", "--format", default="epub", choices=["epub", "pdf"])
    c.add_argument("-q", "--quality", type=int, default=90, help="JPEG quality cap (40-95)")
    c.add_argument("--size-limit", type=int, default=None, help="Per-part byte budget (0=unlimited)")
    c.add_argument("--left-to-right", action="store_true", help="Western reading direction")
    c.add_argument("--color", action="store_true", help="Keep color (default follows device)")
    c.add_argument("--no-autocontrast", action="store_true")
    c.add_argument("--split-spreads", action="store_true", help="Split double-page spreads")
    c.set_defaults(func=_cmd_convert)

    sub.add_parser("devices", help="List device profiles").set_defaults(func=_cmd_devices)

    s = sub.add_parser("serve", help="Run the web app")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--reload", action="store_true")
    s.set_defaults(func=_cmd_serve)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
