# mangaconv — browser version (`docs/`)

A **fully client-side** version of the converter. It runs entirely in the
browser — your files never leave your device, there is no server, and it can be
hosted for free as a static site (e.g. GitHub Pages).

## What it does

Same pipeline as the Python app, reimplemented in JavaScript/WASM:

- **CBZ/ZIP** extraction via [fflate](https://github.com/101arrowz/fflate).
- **CBR/RAR** extraction via [libarchive.js](https://github.com/nika-begiashvili/libarchivejs)
  (WebAssembly) — handles the proprietary RAR3/4 compression.
- Reading-order page sorting (natural sort, chapter prefixes, letter suffixes,
  cover/extras separation, spread detection).
- Image processing on `<canvas>`: resize to the device's **native resolution**,
  grayscale, auto-contrast, **adaptive JPEG quality**, optional spread splitting.
- **Fixed-layout EPUB 3** output (mimetype stored first, `pre-paginated`,
  per-page viewport), with auto-split into parts under the 50 MB limit.

## Send to Kindle

After converting, a **Send to Kindle** button appears. Because this is a static
page with no backend, it can't email an `@kindle.com` address (that needs an
approved sender + a mail server) and can't push a file into Amazon's site
(different origin + your Amazon login). It does the two things a browser can:

- **Mobile** (with file-sharing support): opens the OS share sheet so you can
  pick the **Kindle app**. Note: some browsers don't yet allow sharing `.epub`
  via the Web Share API ([w3c/web-share#284](https://github.com/w3c/web-share/issues/284)),
  so the button falls back automatically.
- **Desktop / fallback**: opens **Send to Kindle for Web**
  (`amazon.com/sendtokindle`) in a new tab — sign in and drop the file your
  browser just downloaded. The web uploader accepts files up to **200 MB**
  (the 50 MB cap only applies to the email method).

## Run locally

It's a static site, but ES modules + the WASM worker need to be served over
HTTP (opening `index.html` via `file://` won't work). Any static server does:

```bash
cd docs
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this branch.
2. Repo **Settings → Pages**.
3. **Source:** *Deploy from a branch*. **Branch:** your branch, folder **`/docs`**.
4. Save. The site appears at `https://<user>.github.io/<repo>/`.

The `.nojekyll` file ensures the `vendor/` folder and the `.wasm` binary are
served as-is (Jekyll would otherwise interfere).

## Browser support

Needs a modern browser (Chrome/Edge/Firefox/Safari) for `createImageBitmap`,
`OffscreenCanvas`, module Web Workers, and WebAssembly. Large volumes are
processed page-by-page; very large files use a lot of memory since everything
stays in the tab.

## Vendored libraries

- `vendor/fflate.js` — MIT
- `vendor/libarchive/` — libarchive.js (see `vendor/libarchive/LICENSE`)
