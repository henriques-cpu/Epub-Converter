// Archive extraction — ported from mangaconv/core/extract.py.
// CBZ/ZIP via fflate; CBR/RAR via libarchive.js (WASM) loaded lazily.

import { unzipSync } from "../vendor/fflate.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff"]);

function isImage(name) {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function looksLikeZip(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
}
function looksLikeRar(bytes) {
  // "Rar!\x1a\x07"
  return bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21 &&
    bytes[4] === 0x1a && bytes[5] === 0x07;
}

// Returns { pages: [{ name, data: Uint8Array }], skipped: [[name, reason]] }.
export async function extractArchive(bytes, filename = "") {
  if (looksLikeZip(bytes)) return extractZip(bytes);
  if (looksLikeRar(bytes)) return extractRar(bytes);
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (ext === ".cbz" || ext === ".zip") return extractZip(bytes);
  if (ext === ".cbr" || ext === ".rar") return extractRar(bytes);
  throw new Error("Unrecognized archive format. Supported: CBZ/ZIP and CBR/RAR.");
}

function extractZip(bytes) {
  const pages = [];
  const skipped = [];
  let entries;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    throw new Error(`Could not read ZIP/CBZ archive: ${e.message}`);
  }
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/") || !isImage(name)) continue;
    if (!data || data.length === 0) {
      skipped.push([name, "empty entry"]);
      continue;
    }
    pages.push({ name, data });
  }
  return { pages, skipped };
}

let archiveModulePromise = null;
function loadLibarchive() {
  if (!archiveModulePromise) {
    archiveModulePromise = import("../vendor/libarchive/libarchive.js").then((mod) => {
      mod.Archive.init({
        workerUrl: new URL("../vendor/libarchive/worker-bundle.js", import.meta.url).href,
      });
      return mod.Archive;
    });
  }
  return archiveModulePromise;
}

async function extractRar(bytes) {
  const Archive = await loadLibarchive();
  const pages = [];
  const skipped = [];
  // libarchive.js works on File/Blob inputs.
  const file = new File([bytes], "archive.cbr");
  const archive = await Archive.open(file);
  try {
    const entries = await archive.getFilesArray(); // [{ file, path }]
    for (const { file: entry, path } of entries) {
      const fullName = (path || "") + entry.name;
      if (!isImage(entry.name)) continue;
      try {
        // Per-entry extract mirrors the per-member read that avoids the
        // BadRarFile quirk in the Python lib, and isolates corrupt pages.
        const extracted = await entry.extract();
        const buf = new Uint8Array(await extracted.arrayBuffer());
        if (buf.length === 0) {
          skipped.push([fullName, "empty entry"]);
          continue;
        }
        pages.push({ name: fullName, data: buf });
      } catch (e) {
        skipped.push([fullName, String(e.message || e)]);
      }
    }
  } finally {
    await archive.close();
  }
  return { pages, skipped };
}
