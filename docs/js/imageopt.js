// Canvas-based image processing — ported from mangaconv/core/imageopt.py.
// Runs entirely in the browser: resize to native resolution, grayscale,
// autocontrast, adaptive JPEG quality, and spread splitting.

// Decode bytes into an ImageBitmap (fast, off-thread decode).
async function decode(bytes) {
  const blob = new Blob([bytes]);
  return await createImageBitmap(blob);
}

// Scale to fit within width x height preserving aspect ratio (never distorts).
function fitDimensions(srcW, srcH, width, height) {
  const targetRatio = width / height;
  const srcRatio = srcW / srcH;
  if (srcRatio > targetRatio) {
    return [width, Math.max(1, Math.round(width / srcRatio))];
  }
  return [Math.max(1, Math.round(height * srcRatio)), height];
}

function newCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Histogram-based autocontrast equivalent to PIL autocontrast(cutoff=1):
// clip 1% of pixels from each end of the luminance histogram, then stretch.
function applyAutocontrast(data, cutoffPercent = 1) {
  const hist = new Array(256).fill(0);
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) hist[data[i]]++; // R==G==B after grayscale
  const cut = Math.floor((n * cutoffPercent) / 100);

  let lo = 0;
  let acc = 0;
  for (; lo < 256; lo++) {
    acc += hist[lo];
    if (acc > cut) break;
  }
  let hi = 255;
  acc = 0;
  for (; hi > 0; hi--) {
    acc += hist[hi];
    if (acc > cut) break;
  }
  if (hi <= lo) return; // degenerate; leave as-is

  const scale = 255 / (hi - lo);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.max(0, Math.min(255, Math.round((v - lo) * scale)));
  }
  for (let i = 0; i < data.length; i += 4) {
    const v = lut[data[i]];
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

// Encode a canvas to a JPEG/PNG Blob at the given quality.
async function encode(canvas, { type, quality }) {
  if (canvas.convertToBlob) return await canvas.convertToBlob({ type, quality });
  return await new Promise((res) => canvas.toBlob(res, type, quality));
}

// Process one bitmap (already cropped if it was a spread half) into final bytes.
async function processBitmap(bitmap, width, height, opts) {
  const {
    grayscale = true,
    autocontrast = true,
    maxQuality = 0.9,
    minQuality = 0.4,
    targetBytes = null,
    preferPng = false,
  } = opts;

  const [w, h] = fitDimensions(bitmap.width, bitmap.height, width, height);
  const canvas = newCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // White background so transparency flattens to white (manga pages are white).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);

  if (grayscale || autocontrast) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    if (grayscale) {
      for (let i = 0; i < d.length; i += 4) {
        // Rec. 601 luma, matching PIL's "L" conversion.
        const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114 + 500) / 1000 | 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    if (autocontrast) applyAutocontrast(d, 1);
    ctx.putImageData(img, 0, 0);
  }

  if (preferPng) {
    const blob = await encode(canvas, { type: "image/png" });
    return { blob, width: w, height: h, mediaType: "image/png", ext: "png" };
  }

  if (targetBytes == null) {
    const blob = await encode(canvas, { type: "image/jpeg", quality: maxQuality });
    return { blob, width: w, height: h, mediaType: "image/jpeg", ext: "jpg" };
  }

  // Adaptive quality: largest q in [min,max] whose size <= target (binary search
  // over a quantized 0..100 scale to keep the number of encodes small).
  let best = await encode(canvas, { type: "image/jpeg", quality: minQuality });
  let lo = Math.round(minQuality * 100);
  let hi = Math.round(maxQuality * 100);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cand = await encode(canvas, { type: "image/jpeg", quality: mid / 100 });
    if (cand.size <= targetBytes) {
      best = cand;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { blob: best, width: w, height: h, mediaType: "image/jpeg", ext: "jpg" };
}

// Crop a landscape bitmap into two portrait halves (RTL: right half first).
function spreadHalves(bitmap, rightToLeft) {
  const mid = Math.floor(bitmap.width / 2);
  const left = { x: 0, w: mid };
  const right = { x: mid, w: bitmap.width - mid };
  return rightToLeft ? [right, left] : [left, right];
}

async function cropBitmap(bitmap, region) {
  return await createImageBitmap(bitmap, region.x, 0, region.w, bitmap.height);
}

// Public: process raw page bytes, optionally splitting detected spreads.
// Returns an array of { blob, width, height, mediaType, ext }.
export async function processPage(bytes, width, height, opts = {}) {
  const { splitSpreads = false, rightToLeft = true } = opts;
  const bitmap = await decode(bytes);
  try {
    if (splitSpreads && bitmap.width > bitmap.height) {
      const out = [];
      for (const region of spreadHalves(bitmap, rightToLeft)) {
        const half = await cropBitmap(bitmap, region);
        out.push(await processBitmap(half, width, height, opts));
        half.close?.();
      }
      return out;
    }
    return [await processBitmap(bitmap, width, height, opts)];
  } finally {
    bitmap.close?.();
  }
}
