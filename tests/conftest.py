"""Shared test fixtures: synthetic comic archives built with Pillow."""

from __future__ import annotations

import io
import os
import zipfile

import pytest
from PIL import Image, ImageDraw


def make_page_bytes(
    text: str, size=(1000, 1500), color=(255, 255, 255), fmt="JPEG", noise=False
) -> bytes:
    """Render a labelled page image to bytes.

    ``noise=True`` fills the page with random data so it does not compress to
    near-nothing — useful for exercising the size-based splitter.
    """
    if noise:
        img = Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3))
    else:
        img = Image.new("RGB", size, color)
        draw = ImageDraw.Draw(img)
        draw.rectangle([10, 10, size[0] - 10, size[1] - 10], outline=(0, 0, 0), width=4)
        draw.text((size[0] // 2 - 40, size[1] // 2), text, fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def make_cbz(names_to_size: dict[str, tuple], *, noise=False) -> bytes:
    """Build a CBZ (zip) from {name: (w, h)} entries."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, size in names_to_size.items():
            zf.writestr(name, make_page_bytes(name, size=size, noise=noise))
    return buf.getvalue()


@pytest.fixture
def simple_cbz() -> bytes:
    return make_cbz(
        {
            "cover.jpg": (1000, 1500),
            "page1.jpg": (1000, 1500),
            "page2.jpg": (1000, 1500),
            "page10.jpg": (1000, 1500),
            "credits.jpg": (1000, 1500),
        }
    )
