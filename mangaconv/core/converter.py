"""End-to-end conversion pipeline: archive bytes -> one or more EPUB parts.

Orchestrates extract -> order -> process -> split -> build, applying a device
profile and producing optimized fixed-layout EPUBs (optionally PDF).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .devices import DeviceProfile, get_device
from .epubbuilder import EpubPage, build_fixed_layout_epub, validate_epub
from .extract import extract_archive
from .imageopt import ProcessedPage, process_page
from .ordering import order_pages
from .splitter import split_pages_by_size


@dataclass
class ConversionOptions:
    """User-facing knobs for a conversion run."""

    device: str = "paperwhite"
    title: str | None = None
    right_to_left: bool = True
    grayscale: bool | None = None  # None => follow device profile
    autocontrast: bool = True
    max_quality: int = 90
    split_spreads: bool = False
    separate_matter: bool = True
    output_format: str = "epub"  # "epub" | "pdf"
    size_limit: int | None = None  # None => follow device profile; 0 => unlimited
    validate: bool = True


@dataclass
class OutputPart:
    """A single produced file."""

    filename: str
    data: bytes
    page_count: int


@dataclass
class ConversionResult:
    parts: list[OutputPart] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)
    device: DeviceProfile | None = None
    total_pages: int = 0

    @property
    def part_count(self) -> int:
        return len(self.parts)


@dataclass
class PreviewPage:
    """One processed page returned for preview (image bytes + dimensions)."""

    data: bytes
    width: int
    height: int
    media_type: str
    source_name: str


@dataclass
class PreviewResult:
    """Outcome of a preview run: the first few processed pages plus metadata."""

    pages: list[PreviewPage] = field(default_factory=list)
    source_page_count: int = 0  # pages found in the archive (before spread split)
    shown: int = 0
    skipped: list[tuple[str, str]] = field(default_factory=list)
    device: DeviceProfile | None = None
    title: str = ""


def _safe_title(opts: ConversionOptions, fallback: str) -> str:
    if opts.title:
        return opts.title
    return Path(fallback).stem or "Untitled"


def convert(
    source: str | Path | bytes,
    options: ConversionOptions | None = None,
    *,
    filename: str | None = None,
) -> ConversionResult:
    """Run the full pipeline and return the produced parts in memory."""
    opts = options or ConversionOptions()
    device = get_device(opts.device)

    if isinstance(source, (str, Path)):
        filename = filename or Path(source).name

    title = _safe_title(opts, filename or "Untitled")
    grayscale = device.grayscale if opts.grayscale is None else opts.grayscale

    # 1) Extract.
    report = extract_archive(source, filename=filename)
    if not report.ok:
        raise ValueError("No readable image pages found in the archive.")

    # 2) Order.
    ordered = order_pages(
        report.pages, key=lambda p: p.name, separate_matter=opts.separate_matter
    )

    # 3) Process each page (a spread may yield two pages).
    processed: list[ProcessedPage] = []
    w, h = device.resolution
    for page in ordered:
        try:
            processed.extend(
                process_page(
                    page.data, w, h,
                    grayscale=grayscale,
                    autocontrast=opts.autocontrast,
                    max_quality=opts.max_quality,
                    split_spreads=opts.split_spreads,
                    right_to_left=opts.right_to_left,
                )
            )
        except Exception as exc:  # bad image — skip, keep batch alive
            report.skipped.append((page.name, str(exc)))

    if not processed:
        raise ValueError("All pages failed to process.")

    result = ConversionResult(
        skipped=report.skipped, device=device, total_pages=len(processed)
    )

    # 4) Split by size budget.
    budget = device.part_budget if opts.size_limit is None else opts.size_limit
    parts = split_pages_by_size(processed, budget=budget, size_of=lambda p: len(p.data))

    # 5) Build outputs.
    multi = len(parts) > 1
    for idx, part_pages in enumerate(parts, start=1):
        part_title = f"{title} (Part {idx} of {len(parts)})" if multi else title
        if opts.output_format == "pdf":
            data = _build_pdf(part_pages)
            ext = "pdf"
        else:
            epub_pages = [
                EpubPage(p.data, p.width, p.height, p.media_type, p.ext)
                for p in part_pages
            ]
            data = build_fixed_layout_epub(
                epub_pages, title=part_title, right_to_left=opts.right_to_left
            )
            if opts.validate:
                validate_epub(data)
            ext = "epub"

        suffix = f" - Part {idx:02d}" if multi else ""
        result.parts.append(
            OutputPart(
                filename=f"{title}{suffix}.{ext}",
                data=data,
                page_count=len(part_pages),
            )
        )

    return result


def preview(
    source: str | Path | bytes,
    options: ConversionOptions | None = None,
    *,
    filename: str | None = None,
    limit: int = 6,
) -> PreviewResult:
    """Process only the first ``limit`` pages so the user can sanity-check
    reading order, orientation, grayscale and resolution before committing to a
    full conversion. Much faster than :func:`convert` for large volumes.
    """
    opts = options or ConversionOptions()
    device = get_device(opts.device)

    if isinstance(source, (str, Path)):
        filename = filename or Path(source).name
    title = _safe_title(opts, filename or "Untitled")
    grayscale = device.grayscale if opts.grayscale is None else opts.grayscale

    report = extract_archive(source, filename=filename)
    if not report.ok:
        raise ValueError("No readable image pages found in the archive.")

    ordered = order_pages(
        report.pages, key=lambda p: p.name, separate_matter=opts.separate_matter
    )

    result = PreviewResult(
        source_page_count=len(ordered),
        skipped=list(report.skipped),
        device=device,
        title=title,
    )

    w, h = device.resolution
    for page in ordered:
        if len(result.pages) >= limit:
            break
        try:
            for pp in process_page(
                page.data, w, h,
                grayscale=grayscale,
                autocontrast=opts.autocontrast,
                max_quality=opts.max_quality,
                split_spreads=opts.split_spreads,
                right_to_left=opts.right_to_left,
            ):
                result.pages.append(
                    PreviewPage(pp.data, pp.width, pp.height, pp.media_type, page.name)
                )
                if len(result.pages) >= limit:
                    break
        except Exception as exc:  # bad image — skip, keep going
            result.skipped.append((page.name, str(exc)))

    if not result.pages:
        raise ValueError("Could not render any preview pages.")

    result.shown = len(result.pages)
    return result


def _build_pdf(pages: list[ProcessedPage]) -> bytes:
    """Assemble processed pages into a PDF (optional alternative format)."""
    import img2pdf

    return img2pdf.convert([p.data for p in pages])
