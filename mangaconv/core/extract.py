"""Extract images from comic/manga archives (CBZ, CBR, ZIP, plain RAR).

Hard-won lessons baked into this module (see SPEC.md):

* A ``.cbr`` is just a RAR file with a different extension; ``.cbz`` is a ZIP.
* RAR3/4 use a proprietary compression that ``unrar-free`` and ``bsdtar``
  (libarchive) cannot decode. The reliable pure-python-ish option is the
  pre-built ``unrar2-cffi`` wheel, imported as ``unrar.cffi.rarfile``.
* In that library, reading several members from a single open handle can
  raise ``BadRarFile error 12``. We therefore read each member with its own
  ``rf.read(name)`` call.
* Source archives occasionally contain a corrupt image. A single bad page
  must not abort the whole batch — we skip it and record the failure.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

# Image extensions we treat as comic pages.
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff"}


@dataclass
class ExtractedPage:
    """A single image extracted from an archive."""

    name: str  # original path/name inside the archive
    data: bytes


@dataclass
class ExtractionReport:
    """Outcome of an extraction, including any per-file failures."""

    pages: list[ExtractedPage] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)  # (name, reason)

    @property
    def ok(self) -> bool:
        return bool(self.pages)


def _is_image(name: str) -> bool:
    return Path(name).suffix.lower() in IMAGE_EXTENSIONS


def _looks_like_rar(data: bytes) -> bool:
    # RAR4 signature: "Rar!\x1a\x07\x00"; RAR5: "Rar!\x1a\x07\x01\x00".
    return data[:6] == b"Rar!\x1a\x07" or data[:7] == b"Rar!\x1a\x07\x00"


def _looks_like_zip(data: bytes) -> bool:
    return data[:2] == b"PK"


def extract_archive(source: str | Path | bytes, *, filename: str | None = None) -> ExtractionReport:
    """Extract image pages from a comic archive.

    ``source`` may be a path or raw bytes. Format is detected by magic bytes
    first, falling back to the file extension. Returns an
    :class:`ExtractionReport` containing the pages (unordered) and any skips.
    """
    if isinstance(source, (str, Path)):
        path = Path(source)
        data = path.read_bytes()
        filename = filename or path.name
    else:
        data = bytes(source)

    if _looks_like_zip(data):
        return _extract_zip(data)
    if _looks_like_rar(data):
        return _extract_rar(data)

    # Fall back to extension if magic bytes were inconclusive.
    ext = Path(filename or "").suffix.lower()
    if ext in {".cbz", ".zip"}:
        return _extract_zip(data)
    if ext in {".cbr", ".rar"}:
        return _extract_rar(data)

    raise ValueError(
        "Unrecognized archive format. Supported: CBZ/ZIP and CBR/RAR "
        f"(filename={filename!r})."
    )


def _extract_zip(data: bytes) -> ExtractionReport:
    report = ExtractionReport()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            if info.is_dir() or not _is_image(info.filename):
                continue
            try:
                payload = zf.read(info)
            except Exception as exc:  # corrupt member — skip, keep going
                report.skipped.append((info.filename, str(exc)))
                continue
            report.pages.append(ExtractedPage(name=info.filename, data=payload))
    return report


def _extract_rar(data: bytes) -> ExtractionReport:
    # Imported lazily so ZIP-only environments need not have the wheel.
    from unrar.cffi import rarfile

    report = ExtractionReport()

    # unrar2-cffi opens from a path; write to a temp file.
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".rar", delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        rf = rarfile.RarFile(tmp.name)
        names = [n for n in rf.namelist() if _is_image(n)]
        for name in names:
            # Per-member read avoids the "BadRarFile error 12" multi-read quirk.
            try:
                payload = rf.read(name)
            except Exception as exc:
                report.skipped.append((name, str(exc)))
                continue
            report.pages.append(ExtractedPage(name=name, data=payload))
    return report
