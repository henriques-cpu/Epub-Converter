// UI wiring for the fully client-side converter.

import { DEVICE_PROFILES } from "./devices.js";
import { convert, preview } from "./converter.js";
import { zipSync } from "../vendor/fflate.js";

const $ = (id) => document.getElementById(id);
const dropZone = $("drop-zone");
const fileInput = $("file");
const dropText = $("drop-text");
const submitBtn = $("submit-btn");
const previewBtn = $("preview-btn");
const form = $("convert-form");
const statusEl = $("status");
const previewEl = $("preview");
const previewGrid = $("preview-grid");
const previewMeta = $("preview-meta");
const previewHint = $("preview-hint");
const deviceSelect = $("device");
const resultActions = $("result-actions");
const kindleBtn = $("kindle-btn");
const downloadBtn = $("download-btn");
const kindleHint = $("kindle-hint");

const SEND_TO_KINDLE_WEB = "https://www.amazon.com/sendtokindle";

// Holds the most recent conversion so the user can re-download or send it.
// { shareFiles: File[], download: { bytes, filename, mime } }
let lastResult = null;

// Populate device dropdown.
for (const [key, p] of Object.entries(DEVICE_PROFILES)) {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = `${p.name} (${p.width}×${p.height})`;
  deviceSelect.appendChild(opt);
}
deviceSelect.value = "paperwhite";

function setStatus(kind, html) {
  statusEl.classList.remove("hidden");
  statusEl.className = "status " + kind;
  statusEl.innerHTML = html;
}

function refreshFileLabel() {
  const has = fileInput.files.length > 0;
  submitBtn.disabled = !has;
  previewBtn.disabled = !has;
  if (has) {
    dropText.textContent = fileInput.files[0].name;
    previewEl.classList.add("hidden");
    previewGrid.innerHTML = "";
    resultActions.classList.add("hidden");
    lastResult = null;
  }
}

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", refreshFileLabel);
["dragover", "dragenter"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  })
);
["dragleave", "dragend", "drop"].forEach((ev) =>
  dropZone.addEventListener(ev, () => dropZone.classList.remove("dragover"))
);
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    refreshFileLabel();
  }
});

function currentOptions() {
  return {
    device: form.device.value,
    rightToLeft: $("right_to_left").checked,
    grayscale: $("grayscale").checked,
    autocontrast: $("autocontrast").checked,
    splitSpreads: $("split_spreads").checked,
  };
}

async function readFile() {
  const f = fileInput.files[0];
  return { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name };
}

function triggerDownload(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

previewBtn.addEventListener("click", async () => {
  if (!fileInput.files.length) return;
  previewBtn.disabled = true;
  setStatus("working", '<span class="spinner"></span>Rendering preview…');
  try {
    const { bytes, name } = await readFile();
    const result = await preview(bytes, name, currentOptions(), 6);

    previewGrid.innerHTML = "";
    previewGrid.classList.toggle("rtl", result.rightToLeft);
    let idx = 1;
    for (const p of result.pages) {
      const cell = document.createElement("div");
      cell.className = "thumb";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(p.blob);
      img.alt = "Page " + idx;
      img.loading = "lazy";
      const cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = `#${idx} · ${p.width}×${p.height}`;
      cell.append(img, cap);
      previewGrid.appendChild(cell);
      idx++;
    }
    previewMeta.textContent =
      `${result.device.name} · ${result.device.width}×${result.device.height} · ${result.sourcePageCount} pages total`;
    previewHint.textContent = result.rightToLeft
      ? "Showing the first pages in right-to-left reading order (manga)."
      : "Showing the first pages in left-to-right reading order.";
    if (result.skipped.length) {
      previewHint.textContent += `  ⚠ ${result.skipped.length} page(s) skipped.`;
    }
    previewEl.classList.remove("hidden");
    setStatus("ok", `Preview ready — first ${result.shown} of ${result.sourcePageCount} pages. Looks right? Hit Convert.`);
  } catch (err) {
    setStatus("error", "❌ " + (err.message || err));
  } finally {
    previewBtn.disabled = false;
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!fileInput.files.length) return;
  submitBtn.disabled = true;
  previewBtn.disabled = true;
  resultActions.classList.add("hidden");

  try {
    const { bytes, name } = await readFile();
    const opts = {
      ...currentOptions(),
      title: form.title.value,
      maxQuality: Math.max(40, Math.min(95, parseInt(form.max_quality.value, 10) || 90)) / 100,
      onProgress: (p) => {
        if (p.phase === "extract") setStatus("working", '<span class="spinner"></span>Extracting pages…');
        else if (p.phase === "process") setStatus("working", `<span class="spinner"></span>Processing page ${p.current} / ${p.total}…`);
        else if (p.phase === "build") setStatus("working", '<span class="spinner"></span>Building EPUB…');
      },
    };

    const result = await convert(bytes, name, opts);

    // Individual EPUBs make the best Send-to-Kindle payload (the app/web
    // uploader takes multiple files); the download bundles parts into a zip.
    const shareFiles = result.parts.map(
      (p) => new File([p.bytes], p.filename, { type: "application/epub+zip" })
    );
    let download;
    if (result.parts.length === 1) {
      const part = result.parts[0];
      download = { bytes: part.bytes, filename: part.filename, mime: "application/epub+zip" };
    } else {
      const files = {};
      for (const part of result.parts) files[part.filename] = [part.bytes, { level: 0 }];
      const zipped = zipSync(files, { level: 0 });
      const base = (opts.title.trim() || name.replace(/\.[^.]+$/, "")) + " (parts).zip";
      download = { bytes: zipped, filename: base, mime: "application/zip" };
    }
    lastResult = { shareFiles, download };
    triggerDownload(download.bytes, download.filename, download.mime);
    showResultActions(shareFiles);

    const partMsg = result.parts.length > 1 ? ` across ${result.parts.length} parts (zipped)` : "";
    let msg = `✅ Done — ${result.totalPages} pages${partMsg}. Download started.`;
    if (result.skipped.length) msg += `  ⚠ ${result.skipped.length} page(s) skipped.`;
    setStatus("ok", msg);
  } catch (err) {
    setStatus("error", "❌ " + (err.message || err));
  } finally {
    submitBtn.disabled = false;
    previewBtn.disabled = false;
  }
});

// --- Send to Kindle ---------------------------------------------------------
// A static page can't email an @kindle.com address (that needs an approved
// sender + a mail server) and can't push a file into Amazon's site (different
// origin + your Amazon login). So we do the two things a browser actually can:
//   1. On mobile with file-sharing support, hand the EPUB to the OS share sheet
//      (the Kindle app shows up there).
//   2. Otherwise, open Send to Kindle for Web so you can drop the file we just
//      downloaded (the uploader accepts up to 200 MB).
const canShareFiles =
  typeof navigator !== "undefined" &&
  navigator.canShare &&
  (() => {
    try {
      // Probe with a tiny dummy EPUB; some browsers reject .epub for sharing.
      const probe = new File([new Uint8Array([1])], "probe.epub", { type: "application/epub+zip" });
      return navigator.canShare({ files: [probe] });
    } catch {
      return false;
    }
  })();

function showResultActions(shareFiles) {
  resultActions.classList.remove("hidden");
  if (canShareFiles && shareFiles.length) {
    kindleBtn.textContent = "📨 Send to Kindle";
    kindleHint.textContent = "Opens your device's share sheet — pick the Kindle app.";
  } else {
    kindleBtn.textContent = "📨 Open Send to Kindle (Web)";
    kindleHint.textContent =
      "Opens Send to Kindle for Web in a new tab — sign in and drop the file your browser just downloaded.";
  }
}

kindleBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  if (canShareFiles && navigator.canShare({ files: lastResult.shareFiles })) {
    try {
      await navigator.share({
        files: lastResult.shareFiles,
        title: "Send to Kindle",
        text: "Manga converted with mangaconv",
      });
      setStatus("ok", "✅ Shared. Choose the Kindle app in the share sheet to send it.");
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return; // user dismissed the sheet
      // Anything else: fall back to the web uploader.
    }
  }
  window.open(SEND_TO_KINDLE_WEB, "_blank", "noopener");
  setStatus(
    "ok",
    'Opened <strong>Send to Kindle for Web</strong> in a new tab. Sign in and drop the downloaded file there (it accepts up to 200&nbsp;MB).'
  );
});

downloadBtn.addEventListener("click", () => {
  if (!lastResult) return;
  const d = lastResult.download;
  triggerDownload(d.bytes, d.filename, d.mime);
});
