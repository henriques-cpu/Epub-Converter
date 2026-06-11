"""Device profiles describing target e-reader screens and size limits.

Resolutions are the *native* panel resolution in portrait orientation
(width x height in pixels). Rendering to the exact native resolution is the
single most important factor for crisp text on e-ink — see SPEC.md.

``send_to_kindle_limit`` is the per-file upload limit of Amazon's
Send to Kindle service (50 MB at time of writing). We target a slightly
smaller budget per part to leave headroom for the EPUB container overhead.
"""

from __future__ import annotations

from dataclasses import dataclass


# Amazon Send to Kindle hard limit per file.
SEND_TO_KINDLE_LIMIT = 50 * 1024 * 1024  # 50 MB

# Default safety budget per output part (leaves headroom for EPUB overhead).
DEFAULT_PART_BUDGET = 48 * 1024 * 1024  # ~48 MB


@dataclass(frozen=True)
class DeviceProfile:
    """A target reading device."""

    key: str
    name: str
    width: int
    height: int
    grayscale: bool = True
    size_limit: int = SEND_TO_KINDLE_LIMIT
    part_budget: int = DEFAULT_PART_BUDGET

    @property
    def resolution(self) -> tuple[int, int]:
        return (self.width, self.height)


DEVICE_PROFILES: dict[str, DeviceProfile] = {
    # --- Kindle family ---
    "paperwhite": DeviceProfile(
        key="paperwhite",
        name="Kindle Paperwhite (11th/12th gen)",
        width=1236,
        height=1648,
    ),
    "paperwhite-older": DeviceProfile(
        key="paperwhite-older",
        name="Kindle Paperwhite (7th-10th gen)",
        width=1072,
        height=1448,
    ),
    "basic": DeviceProfile(
        key="basic",
        name="Kindle Basic (2022/2024)",
        width=1072,
        height=1448,
    ),
    "oasis": DeviceProfile(
        key="oasis",
        name="Kindle Oasis",
        width=1264,
        height=1680,
    ),
    "scribe": DeviceProfile(
        key="scribe",
        name="Kindle Scribe",
        width=1860,
        height=2480,
    ),
    "colorsoft": DeviceProfile(
        key="colorsoft",
        name="Kindle Colorsoft",
        width=1264,
        height=1680,
        grayscale=False,
    ),
    # --- Kobo family ---
    "kobo-clara": DeviceProfile(
        key="kobo-clara",
        name="Kobo Clara (2E/Colour/BW)",
        width=1072,
        height=1448,
        size_limit=0,  # 0 == no enforced limit (sideloaded)
        part_budget=0,
    ),
    "kobo-libra": DeviceProfile(
        key="kobo-libra",
        name="Kobo Libra (2/Colour)",
        width=1264,
        height=1680,
        size_limit=0,
        part_budget=0,
    ),
    "kobo-sage": DeviceProfile(
        key="kobo-sage",
        name="Kobo Sage / Elipsa",
        width=1440,
        height=1920,
        size_limit=0,
        part_budget=0,
    ),
    # --- Other ---
    "remarkable": DeviceProfile(
        key="remarkable",
        name="reMarkable 2",
        width=1404,
        height=1872,
        size_limit=0,
        part_budget=0,
    ),
    "tablet-hd": DeviceProfile(
        key="tablet-hd",
        name="Generic tablet (1600x2560)",
        width=1600,
        height=2560,
        grayscale=False,
        size_limit=0,
        part_budget=0,
    ),
}


def get_device(key: str) -> DeviceProfile:
    """Look up a device profile by key, raising a helpful error otherwise."""
    try:
        return DEVICE_PROFILES[key]
    except KeyError:
        available = ", ".join(sorted(DEVICE_PROFILES))
        raise KeyError(
            f"Unknown device profile {key!r}. Available profiles: {available}"
        ) from None
