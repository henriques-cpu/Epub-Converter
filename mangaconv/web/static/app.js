const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file");
const dropText = document.getElementById("drop-text");
const submitBtn = document.getElementById("submit-btn");
const form = document.getElementById("convert-form");
const statusEl = document.getElementById("status");

function setStatus(kind, html) {
  statusEl.className = "status " + kind;
  statusEl.innerHTML = html;
}

function refreshFileLabel() {
  if (fileInput.files.length) {
    dropText.textContent = fileInput.files[0].name;
    submitBtn.disabled = false;
  } else {
    submitBtn.disabled = true;
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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!fileInput.files.length) return;

  const fd = new FormData();
  fd.append("file", fileInput.files[0]);
  fd.append("device", form.device.value);
  fd.append("title", form.title.value);
  fd.append("output_format", form.output_format.value);
  fd.append("max_quality", form.max_quality.value);
  fd.append("right_to_left", form.right_to_left.checked);
  fd.append("grayscale", form.grayscale.checked);
  fd.append("autocontrast", form.autocontrast.checked);
  fd.append("split_spreads", form.split_spreads.checked);

  submitBtn.disabled = true;
  statusEl.classList.remove("hidden");
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
