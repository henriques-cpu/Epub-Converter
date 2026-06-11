"""Image processing tuned for e-ink readers.

Key findings (see SPEC.md):

* Resize to the device's *exact native resolution*. Downscaling "in the dark"
  (e.g. an arbitrary 1050px) is what makes text look bad. Fit the page inside
  the native panel, preserving aspect ratio.
* E-ink is grayscale, so converting to mode ``L`` (8-bit) saves a lot of bytes
  with no visible loss.
* ``ImageOps.autocontrast(cutoff=1)`` noticeably improves perceived contrast.
* JPEG quality should be chosen adaptively: pick the highest ``q`` (<= cap)
  that keeps the encoded page under budget.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageOps

# Be tolerant of slightly broken JPEGs that appear in real archives.
ImageFile_LOAD_TRUNCATED = True
try:  # pragma: no cover - defensive
    from PIL import ImageFile

    ImageFile.LOAD_TRUNCATED_IMAGES = True
except Exception:  # pragma: no cover
    pass


@dataclass
class ProcessedPage:
    """A page after processing, ready to embed in an EPUB."""

    data: bytes
    width: int
    height: int
    media_type: str  # "image/jpeg" or "image/png"
    ext: str  # "jpg" or "png"


def _load(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


def split_spread(img: Image.Image, *, right_to_left: bool = True) -> list[Image.Image]:
    """Split a landscape (double-page) image into two portrait halves.

    For manga (right-to-left), the right half is page N and the left half is
    page N+1, so the right half is yielded first.
    """
    w, h = img.size
    mid = w // 2
    left = img.crop((0, 0, mid, h))
    right = img.crop((mid, 0, w, h))
    return [right, left] if right_to_left else [left, right]


def fit_to_screen(img: Image.Image, width: int, height: int) -> Image.Image:
    """Scale ``img`` to fit within ``width x height`` preserving aspect ratio.

    Uses high-quality Lanczos resampling. The result is never upscaled beyond
    the native panel; it is scaled so the longest dimension matches the screen.
    """
    target_ratio = width / height
    src_ratio = img.width / img.height
    if src_ratio > target_ratio:
        new_w = width
        new_h = max(1, round(width / src_ratio))
    else:
        new_h = height
        new_w = max(1, round(height * src_ratio))
    return img.resize((new_w, new_h), Image.LANCZOS)


def _encode(img: Image.Image, *, quality: int, fmt: str) -> bytes:
    buf = io.BytesIO()
    if fmt == "PNG":
        img.save(buf, format="PNG", optimize=True)
    else:
        img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def process_image(
    img: Image.Image,
    width: int,
    height: int,
    *,
    grayscale: bool = True,
    autocontrast: bool = True,
    max_quality: int = 90,
    min_quality: int = 40,
    target_bytes: int | None = None,
    prefer_png: bool = False,
) -> ProcessedPage:
    """Process one already-decoded image into final bytes.

    If ``target_bytes`` is given, performs a binary search for the highest
    JPEG quality (<= ``max_quality``) that fits the budget, never dropping
    below ``min_quality``.
    """
    # Flatten transparency onto white before mode conversion.
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, img).convert("RGB")

    if grayscale:
        img = img.convert("L")
    elif img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    img = fit_to_screen(img, width, height)

    if autocontrast:
        img = ImageOps.autocontrast(img, cutoff=1)

    fmt = "PNG" if prefer_png else "JPEG"
    if fmt == "PNG":
        data = _encode(img, quality=max_quality, fmt="PNG")
        return ProcessedPage(data, img.width, img.height, "image/png", "png")

    if target_bytes is None:
        data = _encode(img, quality=max_quality, fmt="JPEG")
        return ProcessedPage(data, img.width, img.height, "image/jpeg", "jpg")

    # Adaptive quality: largest q in [min, max] with size <= target.
    best = _encode(img, quality=min_quality, fmt="JPEG")
    lo, hi = min_quality, max_quality
    while lo <= hi:
        mid = (lo + hi) // 2
        candidate = _encode(img, quality=mid, fmt="JPEG")
        if len(candidate) <= target_bytes:
            best = candidate
            lo = mid + 1
        else:
            hi = mid - 1
    return ProcessedPage(best, img.width, img.height, "image/jpeg", "jpg")


def process_page(
    data: bytes,
    width: int,
    height: int,
    *,
    grayscale: bool = True,
    autocontrast: bool = True,
    max_quality: int = 90,
    split_spreads: bool = False,
    right_to_left: bool = True,
    **kwargs,
) -> list[ProcessedPage]:
    """Process raw page bytes, optionally splitting detected spreads.

    Returns a list because one input spread can yield two output pages.
    A page is considered a spread when it is landscape (wider than tall).
    """
    img = _load(data)
    if split_spreads and img.width > img.height:
        halves = split_spread(img, right_to_left=right_to_left)
        return [
            process_image(
                half, width, height,
                grayscale=grayscale, autocontrast=autocontrast,
                max_quality=max_quality, **kwargs,
            )
            for half in halves
        ]
    return [
        process_image(
            img, width, height,
            grayscale=grayscale, autocontrast=autocontrast,
            max_quality=max_quality, **kwargs,
        )
    ]
