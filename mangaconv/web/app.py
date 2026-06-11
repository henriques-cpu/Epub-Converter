"""FastAPI app: upload a comic archive, convert it, download the result.

Single-volume conversions return the EPUB directly. When a volume is split
into multiple parts, the parts are bundled into a ZIP for download.
"""

from __future__ import annotations

import base64
import io
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from ..core import DEVICE_PROFILES
from ..core.converter import ConversionOptions, convert, preview

PREVIEW_PAGE_LIMIT = 6

BASE_DIR = Path(__file__).parent
MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB upload ceiling

app = FastAPI(title="mangaconv", description="Manga/comic to e-reader converter")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


def _sanitize_filename(name: str) -> str:
    """Strip path components and characters unsafe for a download header."""
    name = Path(name).name
    return "".join(c for c in name if c.isalnum() or c in " ._-()").strip() or "output"


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    devices = [
        {"key": k, "name": p.name, "resolution": f"{p.width}×{p.height}"}
        for k, p in DEVICE_PROFILES.items()
    ]
    return templates.TemplateResponse(
        request, "index.html", {"devices": devices}
    )


@app.get("/api/devices")
async def list_devices():
    return {
        k: {
            "name": p.name,
            "width": p.width,
            "height": p.height,
            "grayscale": p.grayscale,
            "size_limit": p.size_limit,
        }
        for k, p in DEVICE_PROFILES.items()
    }


@app.post("/api/preview")
async def api_preview(
    file: UploadFile = File(...),
    device: str = Form("paperwhite"),
    right_to_left: bool = Form(True),
    grayscale: bool = Form(True),
    autocontrast: bool = Form(True),
    split_spreads: bool = Form(False),
    limit: int = Form(PREVIEW_PAGE_LIMIT),
):
    """Render the first few pages so the user can verify the result before
    committing to a full conversion. Returns the images as base64 data URLs.
    """
    if device not in DEVICE_PROFILES:
        raise HTTPException(400, f"Unknown device profile: {device}")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty upload.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Upload exceeds the 500 MB limit.")

    options = ConversionOptions(
        device=device,
        right_to_left=right_to_left,
        grayscale=grayscale,
        autocontrast=autocontrast,
        split_spreads=split_spreads,
        max_quality=75,  # lighter encoding is plenty for a thumbnail preview
    )

    try:
        result = preview(data, options, filename=file.filename, limit=max(1, min(12, limit)))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # pragma: no cover - surfaced to client
        raise HTTPException(500, f"Preview failed: {exc}") from exc

    pages = [
        {
            "index": i + 1,
            "src": f"data:{p.media_type};base64,{base64.b64encode(p.data).decode()}",
            "width": p.width,
            "height": p.height,
        }
        for i, p in enumerate(result.pages)
    ]
    return JSONResponse(
        {
            "device": result.device.name if result.device else device,
            "resolution": f"{result.device.width}×{result.device.height}" if result.device else "",
            "source_page_count": result.source_page_count,
            "shown": result.shown,
            "right_to_left": right_to_left,
            "skipped": [name for name, _ in result.skipped],
            "pages": pages,
        }
    )


@app.post("/api/convert")
async def api_convert(
    file: UploadFile = File(...),
    device: str = Form("paperwhite"),
    title: str = Form(""),
    output_format: str = Form("epub"),
    right_to_left: bool = Form(True),
    grayscale: bool = Form(True),
    autocontrast: bool = Form(True),
    split_spreads: bool = Form(False),
    max_quality: int = Form(90),
):
    if device not in DEVICE_PROFILES:
        raise HTTPException(400, f"Unknown device profile: {device}")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty upload.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Upload exceeds the 500 MB limit.")

    options = ConversionOptions(
        device=device,
        title=title.strip() or None,
        output_format=output_format,
        right_to_left=right_to_left,
        grayscale=grayscale,
        autocontrast=autocontrast,
        split_spreads=split_spreads,
        max_quality=max(40, min(95, max_quality)),
    )

    try:
        result = convert(data, options, filename=file.filename)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # pragma: no cover - surfaced to client
        raise HTTPException(500, f"Conversion failed: {exc}") from exc

    # Single part: return the file directly.
    if result.part_count == 1:
        part = result.parts[0]
        media = "application/epub+zip" if part.filename.endswith(".epub") else "application/pdf"
        fname = _sanitize_filename(part.filename)
        return StreamingResponse(
            io.BytesIO(part.data),
            media_type=media,
            headers={
                "Content-Disposition": f'attachment; filename="{fname}"',
                "X-Page-Count": str(part.page_count),
                "X-Part-Count": "1",
            },
        )

    # Multiple parts: bundle into a ZIP.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        for part in result.parts:
            zf.writestr(part.filename, part.data)
    buf.seek(0)
    base = _sanitize_filename((options.title or Path(file.filename).stem))
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{base} (parts).zip"',
            "X-Page-Count": str(result.total_pages),
            "X-Part-Count": str(result.part_count),
        },
    )
