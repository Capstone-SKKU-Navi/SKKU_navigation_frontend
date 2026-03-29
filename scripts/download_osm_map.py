"""Download high-resolution OpenStreetMap image of SKKU Natural Science Campus."""

import math
import urllib.request
from PIL import Image
from pathlib import Path

# SKKU Natural Science Campus center
LAT, LON = 37.29422, 126.97451
ZOOM = 19          # high detail
GRID = 16          # 6x6 tiles → 1536x1536 px
TILE_SIZE = 256
OUTPUT = Path(__file__).resolve().parent.parent / "skku_osm_map.png"


def deg2tile(lat, lon, zoom):
    n = 2 ** zoom
    x = int((lon + 180) / 360 * n)
    lat_rad = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * n)
    return x, y


def download_tile(z, x, y):
    url = f"https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    req = urllib.request.Request(url, headers={"User-Agent": "SKKU-CapstoneProject/1.0"})
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def main():
    cx, cy = deg2tile(LAT, LON, ZOOM)
    half = GRID // 2
    x_start, y_start = cx - half, cy - half

    total = GRID * GRID
    img = Image.new("RGB", (GRID * TILE_SIZE, GRID * TILE_SIZE))

    print(f"Downloading {total} tiles at zoom {ZOOM} …")
    for dy in range(GRID):
        for dx in range(GRID):
            tx, ty = x_start + dx, y_start + dy
            idx = dy * GRID + dx + 1
            print(f"  [{idx}/{total}] tile ({tx}, {ty})")
            data = download_tile(ZOOM, tx, ty)
            tile_path = Path(f"/tmp/tile_{tx}_{ty}.png")
            tile_path.write_bytes(data)
            tile_img = Image.open(tile_path)
            img.paste(tile_img, (dx * TILE_SIZE, dy * TILE_SIZE))

    img.save(OUTPUT, "PNG")
    print(f"\nSaved: {OUTPUT}  ({img.size[0]}x{img.size[1]} px)")


if __name__ == "__main__":
    main()
