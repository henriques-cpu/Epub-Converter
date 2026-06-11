"""Split a processed volume into multiple parts to respect a size limit.

Send to Kindle caps uploads at 50 MB. Rather than degrade image quality to
squeeze a whole volume under the cap, we keep native resolution and split the
volume into N contiguous parts, each below ``budget`` bytes (see SPEC.md).
"""

from __future__ import annotations

from typing import Sequence, TypeVar

T = TypeVar("T")


def split_pages_by_size(
    pages: Sequence[T],
    *,
    budget: int,
    size_of=len,
    container_overhead: int = 64 * 1024,
) -> list[list[T]]:
    """Greedily pack ``pages`` into parts whose total size stays under budget.

    ``size_of`` returns the byte size of a page. ``container_overhead`` is a
    fixed per-part allowance for the EPUB container/markup. A budget of 0 (or
    negative) means "no limit" — everything goes in a single part.

    A single page larger than the budget still gets its own part (we cannot
    split a page further here); callers should re-encode such pages.
    """
    pages = list(pages)
    if not pages:
        return []
    if budget <= 0:
        return [pages]

    effective = max(1, budget - container_overhead)
    parts: list[list[T]] = []
    current: list[T] = []
    current_size = 0

    for page in pages:
        psize = size_of(page)
        if current and current_size + psize > effective:
            parts.append(current)
            current = []
            current_size = 0
        current.append(page)
        current_size += psize

    if current:
        parts.append(current)
    return parts
