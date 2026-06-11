# 📚 mangaconv

Convert manga / comic archives (**CBZ, CBR, ZIP, RAR**) into **fixed-layout
EPUBs** optimized for e-readers — especially Kindle's *Send to Kindle*.

Why fixed-layout EPUB and not PDF or MOBI? PDFs don't reflow and look tiny on
e-ink; AZW3/MOBI is no longer accepted by Send to Kindle. Fixed-layout
(pre-paginated) EPUB is accepted, converted natively by Amazon, and renders
each page full-screen. See [SPEC.md](SPEC.md) for the full rationale and the
hard-won extraction/encoding details.

## Features

- **CBZ/CBR/ZIP/RAR** extraction (handles the proprietary RAR3/4 quirks via
  `unrar2-cffi`; a single corrupt page never aborts the batch).
- **Reading-order aware** page sorting: natural sort, chapter prefixes, letter
  suffixes, and cover/extras separation.
- **Native-resolution rendering** per device — the key to crisp e-ink text.
- **Grayscale + auto-contrast** for e-ink, with **adaptive JPEG quality**.
- **Auto-split** volumes that exceed the 50 MB Send to Kindle limit into parts,
  preserving native resolution instead of degrading quality.
- **Double-page spread** splitting (optional).
- Device profiles for **Kindle** (Paperwhite, Basic, Oasis, Scribe, Colorsoft),
  **Kobo**, **reMarkable**, and generic tablets.
- **Web app** (drag-and-drop upload) and a **CLI**.

## Two ways to use it

- **Browser version (no install, no server)** — a fully client-side build in
  [`docs/`](docs/). Files never leave your device; host it free on GitHub Pages.
  See [docs/README.md](docs/README.md). This is the easiest way to just "open a
  webpage and convert".
- **Python version** — the FastAPI web app + CLI described below, for local or
  self-hosted use.

## Install (Python version)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# or, as a package (provides the `mangaconv` command):
pip install -e .
```

## Web app

```bash
python -m mangaconv.cli serve --port 8000
# then open http://127.0.0.1:8000
```

Upload a `.cbz`/`.cbr`, pick a target device and options, and download the
resulting EPUB. If the volume needs to be split, you get a ZIP of the parts.

## CLI

```bash
# Convert a volume for a Paperwhite
python -m mangaconv.cli convert vol01.cbz --device paperwhite -o out/

# Batch, western reading direction, split spreads, keep color
python -m mangaconv.cli convert *.cbz -d colorsoft --left-to-right --split-spreads --color

# List available device profiles
python -m mangaconv.cli devices
```

## Python API

```python
from mangaconv.core import convert, ConversionOptions

result = convert("vol01.cbz", ConversionOptions(device="paperwhite", title="My Manga"))
for part in result.parts:
    open(part.filename, "wb").write(part.data)
```

## Development

```bash
pip install -e ".[dev]"
pytest -q
```

## License

MIT
