"""Render MusicXML with verovio to SVG (and optionally PNG via resvg) for eyeballing.

Usage:
    python -I render.py score.musicxml out.svg [--png out.png] [--page N] [--width PX]
License: MIT.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def make_toolkit(width: int = 2100, scale: int = 40):
    import verovio

    tk = verovio.toolkit()
    tk.setOptions({
        "pageWidth": width,
        "pageHeight": 2970,
        "scale": scale,
        "adjustPageHeight": True,
        "breaks": "auto",
        "footer": "none",
        "header": "none",
        "svgViewBox": True,
        "svgHtml5": False,
    })
    return tk


def render(xml_path: Path, page: int = 1, width: int = 2100) -> tuple[str, int, str]:
    """Return (svg, page_count, verovio_log)."""
    import verovio

    verovio.enableLog(verovio.LOG_WARNING)
    tk = make_toolkit(width)
    ok = tk.loadData(xml_path.read_text(encoding="utf-8"))
    if not ok:
        raise RuntimeError(f"verovio could not load {xml_path}")
    pages = tk.getPageCount()
    svg = tk.renderToSVG(page)
    log = tk.getLog() if hasattr(tk, "getLog") else ""
    return svg, pages, log


def svg_to_png(svg: str, png_path: Path, width: int | None = None) -> None:
    import resvg_py

    kwargs = {"svg_string": svg, "background": "white"}
    if width:
        kwargs["width"] = width
    data = resvg_py.svg_to_bytes(**kwargs)
    png_path.write_bytes(bytes(data))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("xml", type=Path)
    ap.add_argument("svg", type=Path)
    ap.add_argument("--png", type=Path)
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--width", type=int, default=2100)
    a = ap.parse_args(argv)
    svg, pages, log = render(a.xml, a.page, a.width)
    a.svg.write_text(svg, encoding="utf-8")
    if a.png:
        svg_to_png(svg, a.png, 1400)
    print(f"pages={pages} svg={len(svg)} bytes")
    if log:
        print(log)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
