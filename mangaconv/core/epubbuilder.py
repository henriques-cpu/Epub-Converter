"""Build a fixed-layout (pre-paginated) EPUB 3 from a list of page images.

Fixed-layout is the right format for manga on Kindle (see SPEC.md):

* Accepted by Send to Kindle and converted natively by Amazon.
* Each page fills the screen; nothing reflows or shrinks.

Container requirements that actually matter:

* ``mimetype`` MUST be the first entry in the ZIP and stored uncompressed
  (``ZIP_STORED``). We write the archive by hand to guarantee this — EbookLib
  is reserved for *validation* of the result.
* The OPF declares ``rendition:layout = pre-paginated``,
  ``rendition:orientation = portrait`` and ``rendition:spread = none``.
* Each page is an XHTML file whose ``<meta name="viewport">`` matches the
  embedded image's pixel dimensions exactly.
"""

from __future__ import annotations

import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class EpubPage:
    """One page to place in the EPUB."""

    data: bytes
    width: int
    height: int
    media_type: str  # "image/jpeg" | "image/png"
    ext: str  # "jpg" | "png"


_CONTAINER_XML = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""

_PAGE_XHTML = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <title>{title}</title>
  <meta name="viewport" content="width={w}, height={h}"/>
  <style>
    html, body {{ margin: 0; padding: 0; }}
    img {{ width: 100%; height: 100%; object-fit: contain; display: block; }}
  </style>
</head>
<body>
  <div class="page">
    <img src="../images/{img}" alt="{title}" width="{w}" height="{h}"/>
  </div>
</body>
</html>
"""


def _opf(book_id: str, title: str, language: str, pages: list[EpubPage], direction: str) -> str:
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    manifest = [
        '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    ]
    spine = []
    for i, page in enumerate(pages):
        pid = f"page{i:04d}"
        iid = f"img{i:04d}"
        manifest.append(
            f'    <item id="{pid}" href="xhtml/{pid}.xhtml" media-type="application/xhtml+xml"/>'
        )
        manifest.append(
            f'    <item id="{iid}" href="images/{iid}.{page.ext}" media-type="{page.media_type}"/>'
        )
        spine.append(f'    <itemref idref="{pid}"/>')
        # First image doubles as the cover.
        if i == 0:
            manifest[-1] = manifest[-1].replace("/>", ' properties="cover-image"/>')

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"
         prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:{book_id}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:language>{language}</dc:language>
    <dc:creator>mangaconv</dc:creator>
    <meta property="dcterms:modified">{modified}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">portrait</meta>
    <meta property="rendition:spread">none</meta>
  </metadata>
  <manifest>
{chr(10).join(manifest)}
  </manifest>
  <spine page-progression-direction="{direction}">
{chr(10).join(spine)}
  </spine>
</package>
"""


def _nav(title: str, n_pages: int) -> str:
    links = "\n".join(
        f'        <li><a href="xhtml/page{i:04d}.xhtml">Page {i + 1}</a></li>'
        for i in range(min(n_pages, 1))  # keep nav tiny; first page only
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>{title}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>{title}</h1>
    <ol>
{links}
    </ol>
  </nav>
</body>
</html>
"""


def build_fixed_layout_epub(
    pages: list[EpubPage],
    *,
    title: str = "Untitled",
    language: str = "en",
    right_to_left: bool = True,
) -> bytes:
    """Assemble pages into a fixed-layout EPUB 3 and return the bytes."""
    if not pages:
        raise ValueError("Cannot build an EPUB with zero pages.")

    book_id = str(uuid.uuid4())
    direction = "rtl" if right_to_left else "ltr"

    import io

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        # 1) mimetype — first, uncompressed.
        zf.writestr(
            zipfile.ZipInfo("mimetype"),
            "application/epub+zip",
            compress_type=zipfile.ZIP_STORED,
        )
        # 2) container.
        zf.writestr("META-INF/container.xml", _CONTAINER_XML, compress_type=zipfile.ZIP_DEFLATED)
        # 3) package document + nav.
        zf.writestr("OEBPS/content.opf", _opf(book_id, title, language, pages, direction))
        zf.writestr("OEBPS/nav.xhtml", _nav(title, len(pages)))
        # 4) pages + images.
        for i, page in enumerate(pages):
            pid = f"page{i:04d}"
            iid = f"img{i:04d}"
            xhtml = _PAGE_XHTML.format(
                title=f"{title} — {i + 1}",
                w=page.width,
                h=page.height,
                img=f"{iid}.{page.ext}",
            )
            zf.writestr(f"OEBPS/xhtml/{pid}.xhtml", xhtml)
            # Images are already compressed; store to avoid wasted CPU/size.
            zf.writestr(
                f"OEBPS/images/{iid}.{page.ext}",
                page.data,
                compress_type=zipfile.ZIP_STORED,
            )
    return buf.getvalue()


def validate_epub(data: bytes) -> bool:
    """Sanity-check that the bytes parse as an EPUB via EbookLib.

    Returns True on success; raises on a structurally broken file.
    """
    import os
    import tempfile

    from ebooklib import epub

    with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        epub.read_epub(tmp_path)
        return True
    finally:
        os.unlink(tmp_path)
