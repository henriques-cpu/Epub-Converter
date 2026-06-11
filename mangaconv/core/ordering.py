"""Determine reading order of pages.

Alphabetical order is *not* reading order. Real-world archives throw several
curveballs (see SPEC.md):

* No zero-padding: ``1, 2, ... 10`` sorts as ``1, 10, 2`` lexically.
* Chapter prefixes: ``ch17/page_03``.
* Spreads / double pages: ``004-005``.
* Letter suffixes: ``000a, 000b``.
* Extras / credits / afterword that belong at the very end.

The strategy: natural-sort by the numeric tokens within each path, but route
anything that looks like front/back matter to the end (or front) so the story
pages stay contiguous and correctly numbered.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable, Sequence, TypeVar

T = TypeVar("T")

_NUM_RE = re.compile(r"(\d+)")

# Tokens that usually mark non-story material that should sort to the end.
_BACK_MATTER = (
    "extra", "extras", "bonus", "omake", "afterword", "credit", "credits",
    "postface", "thanks", "advert", "ad", "preview", "spine",
)
# Tokens that usually mark material that should sort to the front.
_FRONT_MATTER = ("cover", "front", "frontcover")


def _natural_key(name: str) -> list:
    """Split a string into alternating text/number chunks for natural sort.

    Numbers compare as integers, text compares case-insensitively. Path
    separators are normalised so directory depth sorts before filename.
    """
    norm = name.replace("\\", "/").lower()
    parts: list = []
    for token in _NUM_RE.split(norm):
        if token.isdigit():
            parts.append((1, int(token), ""))
        elif token:
            parts.append((0, 0, token))
    return parts


def _classify(name: str) -> int:
    """Return -1 for front matter, +1 for back matter, 0 for story pages."""
    stem = Path(name.replace("\\", "/")).stem.lower()
    tokens = re.split(r"[\s_\-.]+", stem)
    token_set = set(tokens)
    # Only treat a cover as front matter when it carries no story page number.
    if token_set & set(_FRONT_MATTER) and not any(t.isdigit() for t in tokens):
        return -1
    if token_set & set(_BACK_MATTER):
        return 1
    return 0


def order_pages(
    items: Sequence[T],
    *,
    key=lambda x: x,
    separate_matter: bool = True,
) -> list[T]:
    """Return ``items`` in reading order.

    ``key`` extracts the page name from each item (default: identity, for a
    sequence of strings). When ``separate_matter`` is true, cover-like pages
    are floated to the front and extras/credits sink to the end.
    """
    def sort_key(item: T):
        name = key(item)
        bucket = _classify(name) if separate_matter else 0
        return (bucket, _natural_key(name))

    return sorted(items, key=sort_key)


def is_spread(name: str, *, min_aspect: float = 1.0) -> bool:
    """Heuristic: does the *filename* suggest a double-page spread?

    Matches patterns like ``004-005`` or ``004_005`` where two consecutive
    numbers are joined. (Aspect-ratio based detection lives in imageopt.)
    """
    stem = Path(name.replace("\\", "/")).stem
    m = re.search(r"(\d+)\s*[-_]\s*(\d+)", stem)
    if not m:
        return False
    a, b = int(m.group(1)), int(m.group(2))
    return b == a + 1
