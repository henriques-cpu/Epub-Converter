// Device profiles — ported from mangaconv/core/devices.py.
// Resolutions are the native portrait panel resolution (width x height).

export const SEND_TO_KINDLE_LIMIT = 50 * 1024 * 1024; // 50 MB
export const DEFAULT_PART_BUDGET = 48 * 1024 * 1024; // ~48 MB headroom

export const DEVICE_PROFILES = {
  paperwhite: { name: "Kindle Paperwhite (11th/12th gen)", width: 1236, height: 1648, grayscale: true, partBudget: DEFAULT_PART_BUDGET },
  "paperwhite-older": { name: "Kindle Paperwhite (7th-10th gen)", width: 1072, height: 1448, grayscale: true, partBudget: DEFAULT_PART_BUDGET },
  basic: { name: "Kindle Basic (2022/2024)", width: 1072, height: 1448, grayscale: true, partBudget: DEFAULT_PART_BUDGET },
  oasis: { name: "Kindle Oasis", width: 1264, height: 1680, grayscale: true, partBudget: DEFAULT_PART_BUDGET },
  scribe: { name: "Kindle Scribe", width: 1860, height: 2480, grayscale: true, partBudget: DEFAULT_PART_BUDGET },
  colorsoft: { name: "Kindle Colorsoft", width: 1264, height: 1680, grayscale: false, partBudget: DEFAULT_PART_BUDGET },
  "kobo-clara": { name: "Kobo Clara (2E/Colour/BW)", width: 1072, height: 1448, grayscale: true, partBudget: 0 },
  "kobo-libra": { name: "Kobo Libra (2/Colour)", width: 1264, height: 1680, grayscale: true, partBudget: 0 },
  "kobo-sage": { name: "Kobo Sage / Elipsa", width: 1440, height: 1920, grayscale: true, partBudget: 0 },
  remarkable: { name: "reMarkable 2", width: 1404, height: 1872, grayscale: true, partBudget: 0 },
  "tablet-hd": { name: "Generic tablet (1600x2560)", width: 1600, height: 2560, grayscale: false, partBudget: 0 },
};

export function getDevice(key) {
  const d = DEVICE_PROFILES[key];
  if (!d) throw new Error(`Unknown device profile: ${key}`);
  return d;
}
