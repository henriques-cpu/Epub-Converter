// End-to-end pipeline orchestrator — ported from mangaconv/core/converter.py.
// extract -> order -> process -> split -> build, all in the browser.

import { getDevice } from "./devices.js";
import { orderPages } from "./ordering.js";
import { processPage } from "./imageopt.js";
import { buildFixedLayoutEpub } from "./epub.js";
import { extractArchive } from "./extract.js";

function safeTitle(title, fallback) {
  if (title && title.trim()) return title.trim();
  const base = (fallback || "Untitled").replace(/\\/g, "/").split("/").pop();
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base) || "Untitled";
}

// Greedy size-based packing — ported from splitter.py.
function splitBySize(pages, budget, overhead = 64 * 1024) {
  if (!pages.length) return [];
  if (budget <= 0) return [pages];
  const effective = Math.max(1, budget - overhead);
  const parts = [];
  let current = [];
  let size = 0;
  for (const p of pages) {
    const ps = p.bytes.length;
    if (current.length && size + ps > effective) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += ps;
  }
  if (current.length) parts.push(current);
  return parts;
}

async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

// options: { device, title, rightToLeft, grayscale, autocontrast, maxQuality,
//            splitSpreads, separateMatter, sizeLimit, onProgress }
// Returns { parts: [{ filename, bytes, pageCount }], skipped, totalPages, device }.
export async function convert(bytes, filename, options = {}) {
  const {
    device: deviceKey = "paperwhite",
    title = "",
    rightToLeft = true,
    grayscale = null,
    autocontrast = true,
    maxQuality = 0.9,
    splitSpreads = false,
    separateMatter = true,
    sizeLimit = null,
    onProgress = () => {},
  } = options;

  const device = getDevice(deviceKey);
  const finalTitle = safeTitle(title, filename);
  const gray = grayscale == null ? device.grayscale : grayscale;

  onProgress({ phase: "extract" });
  const { pages: rawPages, skipped } = await extractArchive(bytes, filename);
  if (!rawPages.length) throw new Error("No readable image pages found in the archive.");

  const ordered = orderPages(rawPages, { keyFn: (p) => p.name, separateMatter });

  const processed = [];
  for (let i = 0; i < ordered.length; i++) {
    const page = ordered[i];
    onProgress({ phase: "process", current: i + 1, total: ordered.length });
    try {
      const results = await processPage(page.data, device.width, device.height, {
        grayscale: gray,
        autocontrast,
        maxQuality,
        splitSpreads,
        rightToLeft,
      });
      for (const r of results) {
        processed.push({
          bytes: await blobToBytes(r.blob),
          width: r.width,
          height: r.height,
          mediaType: r.mediaType,
          ext: r.ext,
        });
      }
    } catch (e) {
      skipped.push([page.name, String(e.message || e)]);
    }
  }
  if (!processed.length) throw new Error("All pages failed to process.");

  const budget = sizeLimit == null ? device.partBudget : sizeLimit;
  const parts = splitBySize(processed, budget);
  const multi = parts.length > 1;

  onProgress({ phase: "build", total: parts.length });
  const outParts = parts.map((partPages, idx) => {
    const partTitle = multi ? `${finalTitle} (Part ${idx + 1} of ${parts.length})` : finalTitle;
    const epubBytes = buildFixedLayoutEpub(partPages, { title: partTitle, rightToLeft });
    const suffix = multi ? ` - Part ${String(idx + 1).padStart(2, "0")}` : "";
    return { filename: `${finalTitle}${suffix}.epub`, bytes: epubBytes, pageCount: partPages.length };
  });

  return { parts: outParts, skipped, totalPages: processed.length, device };
}

// Preview: process only the first `limit` pages for a quick visual check.
export async function preview(bytes, filename, options = {}, limit = 6) {
  const {
    device: deviceKey = "paperwhite",
    rightToLeft = true,
    grayscale = null,
    autocontrast = true,
    splitSpreads = false,
    separateMatter = true,
  } = options;

  const device = getDevice(deviceKey);
  const gray = grayscale == null ? device.grayscale : grayscale;

  const { pages: rawPages, skipped } = await extractArchive(bytes, filename);
  if (!rawPages.length) throw new Error("No readable image pages found in the archive.");

  const ordered = orderPages(rawPages, { keyFn: (p) => p.name, separateMatter });
  const out = [];
  for (const page of ordered) {
    if (out.length >= limit) break;
    try {
      const results = await processPage(page.data, device.width, device.height, {
        grayscale: gray,
        autocontrast,
        maxQuality: 0.75,
        splitSpreads,
        rightToLeft,
      });
      for (const r of results) {
        out.push({ blob: r.blob, width: r.width, height: r.height, name: page.name });
        if (out.length >= limit) break;
      }
    } catch (e) {
      skipped.push([page.name, String(e.message || e)]);
    }
  }
  if (!out.length) throw new Error("Could not render any preview pages.");

  return { pages: out, sourcePageCount: ordered.length, shown: out.length, skipped, device, rightToLeft };
}
