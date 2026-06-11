import io
import zipfile

from PIL import Image

from mangaconv.core import (
    ConversionOptions,
    convert,
    extract_archive,
    process_page,
)
from mangaconv.core.converter import OutputPart

from .conftest import make_cbz, make_page_bytes


def test_extract_cbz(simple_cbz):
    report = extract_archive(simple_cbz, filename="vol.cbz")
    assert report.ok
    assert len(report.pages) == 5


def test_process_page_resizes_to_native_grayscale():
    raw = make_page_bytes("x", size=(2000, 3000))
    out = process_page(raw, 1236, 1648, grayscale=True)
    assert len(out) == 1
    p = out[0]
    # Fit within the panel preserving aspect ratio (2:3 -> height bound).
    assert p.width <= 1236 and p.height <= 1648
    img = Image.open(io.BytesIO(p.data))
    assert img.mode == "L"


def test_spread_splitting_yields_two_pages():
    raw = make_page_bytes("spread", size=(3000, 1500))  # landscape
    out = process_page(raw, 1236, 1648, split_spreads=True)
    assert len(out) == 2


def test_full_conversion_to_epub(simple_cbz):
    result = convert(
        simple_cbz,
        ConversionOptions(device="paperwhite", title="Test Vol"),
        filename="testvol.cbz",
    )
    assert result.part_count == 1
    part = result.parts[0]
    assert part.filename == "Test Vol.epub"
    assert part.page_count == 5
    # Verify the EPUB container is well-formed and mimetype is first+stored.
    with zipfile.ZipFile(io.BytesIO(part.data)) as zf:
        names = zf.namelist()
        assert names[0] == "mimetype"
        info = zf.getinfo("mimetype")
        assert info.compress_type == zipfile.ZIP_STORED
        assert zf.read("mimetype") == b"application/epub+zip"
        opf = zf.read("OEBPS/content.opf").decode()
        assert "pre-paginated" in opf
        assert 'page-progression-direction="rtl"' in opf


def test_splitting_into_parts_by_size():
    # Build many large pages so the volume exceeds a small budget.
    pages = {f"p{i:03d}.jpg": (1200, 1600) for i in range(8)}
    cbz = make_cbz(pages, noise=True)
    result = convert(
        cbz,
        ConversionOptions(device="paperwhite", title="Big", size_limit=300_000),
        filename="big.cbz",
    )
    assert result.part_count >= 2
    assert all(isinstance(p, OutputPart) for p in result.parts)
    assert all(" - Part " in p.filename for p in result.parts)
