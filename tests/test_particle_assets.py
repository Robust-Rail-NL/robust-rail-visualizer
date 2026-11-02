"""Service particle sprites must stay small transparent PNGs.

They are drawn at ~16 px, up to 15 at a time; multi-megapixel JPEGs made the
service animations heavy on the browser.
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from visualize_plan import IMAGES_DIR, PARTICLE_FILES, load_particle_images

MAX_BYTES = 100 * 1024
MAX_PIXELS = 256


def png_header(path):
    b = path.read_bytes()
    assert b[:8] == b"\x89PNG\r\n\x1a\n", f"{path.name} is not a PNG"
    w, h, _depth, color_type = struct.unpack(">IIBB", b[16:26])
    return w, h, color_type


def test_sprites_small_transparent_png():
    for name, filename in PARTICLE_FILES.items():
        path = IMAGES_DIR / filename
        assert path.suffix == ".png", f"{filename}: use PNG for alpha"
        assert path.stat().st_size <= MAX_BYTES, f"{filename} too big"
        w, h, color_type = png_header(path)
        assert max(w, h) <= MAX_PIXELS, f"{filename} is {w}x{h}"
        assert color_type in (4, 6), f"{filename} has no alpha channel"


def test_embedded_uris_are_png():
    uris = load_particle_images()
    assert set(uris) == set(PARTICLE_FILES)
    for name, uri in uris.items():
        assert uri.startswith("data:image/png;base64,"), name
