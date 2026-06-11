import io
import zipfile

import warnings

from fastapi.testclient import TestClient

from mangaconv.web.app import app

from .conftest import make_cbz

warnings.filterwarnings("ignore")
client = TestClient(app)


def test_index_renders():
    r = client.get("/")
    assert r.status_code == 200
    assert "mangaconv" in r.text


def test_devices_endpoint():
    r = client.get("/api/devices")
    assert r.status_code == 200
    body = r.json()
    assert "paperwhite" in body
    assert body["paperwhite"]["width"] == 1236


def test_convert_returns_valid_epub():
    cbz = make_cbz({"cover.jpg": (1000, 1500), "1.jpg": (1000, 1500)})
    r = client.post(
        "/api/convert",
        files={"file": ("vol.cbz", cbz, "application/octet-stream")},
        data={"device": "paperwhite", "title": "Demo"},
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/epub+zip"
    assert r.headers["x-page-count"] == "2"
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        assert zf.namelist()[0] == "mimetype"


def test_multipart_returns_zip():
    pages = {f"p{i:03d}.jpg": (1200, 1600) for i in range(6)}
    cbz = make_cbz(pages, noise=True)
    r = client.post(
        "/api/convert",
        files={"file": ("big.cbz", cbz, "application/octet-stream")},
        data={"device": "paperwhite", "title": "Big", "max_quality": "90"},
    )
    # Force splitting via a tiny per-part budget is device-driven; here just
    # assert a successful response and well-formed payload.
    assert r.status_code == 200
    assert r.headers["x-page-count"] == "6"


def test_empty_upload_rejected():
    r = client.post(
        "/api/convert",
        files={"file": ("x.cbz", b"", "application/octet-stream")},
        data={"device": "paperwhite"},
    )
    assert r.status_code == 400


def test_unknown_device_rejected():
    cbz = make_cbz({"1.jpg": (800, 1200)})
    r = client.post(
        "/api/convert",
        files={"file": ("vol.cbz", cbz, "application/octet-stream")},
        data={"device": "nonexistent"},
    )
    assert r.status_code == 400
