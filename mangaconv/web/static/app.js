const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file");
const dropText = document.getElementById("drop-text");
const submitBtn = document.getElementById("submit-btn");
const previewBtn = document.getElementById("preview-btn");
const form = document.getElementById("convert-form");
const statusEl = document.getElementById("status");
const previewEl = document.getElementById("preview");
const previewGrid = document.getElementById("preview-grid");
const previewMeta = document.getElementById("preview-meta");
const previewHint = document.getElementById("preview-hint");

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
    // A new file invalidates any previous preview.
    previewEl.classList.add("hidden");
    previewGrid.innerHTML = "";
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

function optionsFormData() {
  const fd = new FormData();
  fd.append("file", fileInput.files[0]);
  fd.append("device", form.device.value);
  fd.append("right_to_left", form.right_to_left.checked);
  fd.append("grayscale", form.grayscale.checked);
  fd.append("autocontrast", form.autocontrast.checked);
  fd.append("split_spreads", form.split_spreads.checked);
  return fd;
}

previewBtn.addEventListener("click", async () => {
  if (!fileInput.files.length) return;
  previewBtn.disabled = true;
  setStatus("working", '<span class="spinner"></span>Rendering preview…');

  try {
    const resp = await fetch("/api/preview", { method: "POST", body: optionsFormData() });
    if (!resp.ok) {
      let detail = resp.statusText;
      try { detail = (await resp.json()).detail || detail; } catch (_) {}
      throw new Error(detail);
    }
    const data = await resp.json();

    previewGrid.innerHTML = "";
    previewGrid.classList.toggle("rtl", data.right_to_left);
    data.pages.forEach((p) => {
      const cell = document.createElement("div");
      cell.className = "thumb";
      const img = document.createElement("img");
      img.src = p.src;
      img.alt = "Page " + p.index;
      img.loading = "lazy";
      const cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = `#${p.index} · ${p.width}×${p.height}`;
      cell.append(img, cap);
      previewGrid.appendChild(cell);
    });

    previewMeta.textContent =
      `${data.device} · ${data.resolution} · ${data.source_page_count} pages total`;
    previewHint.textContent = data.right_to_left
      ? "Showing the first pages in right-to-left reading order (manga)."
      : "Showing the first pages in left-to-right reading order.";
    if (data.skipped.length) {
      previewHint.textContent += `  ⚠ ${data.skipped.length} page(s) skipped.`;
    }
    previewEl.classList.remove("hidden");
    setStatus("ok", `Preview ready — first ${data.shown} of ${data.source_page_count} pages. Looks right? Hit Convert.`);
  } catch (err) {
    setStatus("error", "❌ " + err.message);
  } finally {
    previewBtn.disabled = false;
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!fileInput.files.length) return;

  const fd = optionsFormData();
  fd.append("title", form.title.value);
  fd.append("output_format", form.output_format.value);
  fd.append("max_quality", form.max_quality.value);

  submitBtn.disabled = true;
  setStatus("working", '<span class="spinner"></span>Converting… this can take a moment for large volumes.');

  try {
    const resp = await fetch("/api/convert", { method: "POST", body: fd });
    if (!resp.ok) {
      let detail = resp.statusText;
      try { detail = (await resp.json()).detail || detail; } catch (_) {}
      throw new Error(detail);
    }

    const pageCount = resp.headers.get("X-Page-Count");
    const partCount = resp.headers.get("X-Part-Count");
    const blob = await resp.blob();

    // Derive filename from Content-Disposition.
    let filename = "output";
    const cd = resp.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="?([^"]+)"?/);
    if (m) filename = m[1];

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const partMsg = partCount > 1 ? ` across ${partCount} parts (zipped)` : "";
    setStatus("ok", `✅ Done — ${pageCount} pages${partMsg}. Download started: <strong>${filename}</strong>`);
  } catch (err) {
    setStatus("error", "❌ " + err.message);
  } finally {
    submitBtn.disabled = false;
  }
});
