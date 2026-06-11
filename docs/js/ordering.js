// Reading-order page sorting — ported from mangaconv/core/ordering.py.
// Alphabetical != reading order: handle no zero-padding, chapter prefixes,
// letter suffixes, spreads, and cover/extras separation.

const BACK_MATTER = new Set([
  "extra", "extras", "bonus", "omake", "afterword", "credit", "credits",
  "postface", "thanks", "advert", "ad", "preview", "spine",
]);
const FRONT_MATTER = new Set(["cover", "front", "frontcover"]);

// Split into alternating text/number chunks; numbers compare as integers.
function naturalKey(name) {
  const norm = name.replace(/\\/g, "/").toLowerCase();
  const parts = [];
  const re = /(\d+)/g;
  let last = 0;
  let m;
  while ((m = re.exec(norm)) !== null) {
    if (m.index > last) parts.push([0, 0, norm.slice(last, m.index)]);
    parts.push([1, parseInt(m[0], 10), ""]);
    last = m.index + m[0].length;
  }
  if (last < norm.length) parts.push([0, 0, norm.slice(last)]);
  return parts;
}

function stem(name) {
  const base = name.replace(/\\/g, "/").split("/").pop();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

// -1 front matter, +1 back matter, 0 story page.
function classify(name) {
  const tokens = stem(name).toLowerCase().split(/[\s_\-.]+/).filter(Boolean);
  const set = new Set(tokens);
  const hasDigit = tokens.some((t) => /^\d+$/.test(t));
  if ([...set].some((t) => FRONT_MATTER.has(t)) && !hasDigit) return -1;
  if ([...set].some((t) => BACK_MATTER.has(t))) return 1;
  return 0;
}

// Compare two naturalKey arrays.
function cmpKey(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const [at, an, as] = a[i];
    const [bt, bn, bs] = b[i];
    if (at !== bt) return at - bt;
    if (at === 1) {
      if (an !== bn) return an - bn;
    } else if (as !== bs) {
      return as < bs ? -1 : 1;
    }
  }
  return a.length - b.length;
}

// items: array; keyFn extracts the page name (default identity).
export function orderPages(items, { keyFn = (x) => x, separateMatter = true } = {}) {
  const decorated = items.map((item) => {
    const name = keyFn(item);
    return { item, bucket: separateMatter ? classify(name) : 0, key: naturalKey(name) };
  });
  decorated.sort((x, y) => (x.bucket !== y.bucket ? x.bucket - y.bucket : cmpKey(x.key, y.key)));
  return decorated.map((d) => d.item);
}

export function isSpread(name) {
  const m = stem(name).match(/(\d+)\s*[-_]\s*(\d+)/);
  if (!m) return false;
  return parseInt(m[2], 10) === parseInt(m[1], 10) + 1;
}
