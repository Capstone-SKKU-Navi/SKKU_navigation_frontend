"""
QGIS GeoJSON → 앱용 개별 파일 변환 (범용)

사용법: python convert.py <building_code> <level> [level ...]
  예시: python convert.py eng1 1
        python convert.py eng2 1 2 3 4 5

입력 (Geojson/ 폴더):
  {code}_outline.geojson
  {code}_room_L{n}.geojson
  {code}_wall_l{n}.geojson
  {code}_collider_L{n}.geojson

출력 (public/geojson/{code}/ 폴더):
  manifest.json
  {code}_outline.geojson
  {code}_room_L{n}.geojson      ← 슬리버 제거 + 속성 부여
  {code}_collider_L{n}.geojson
  {code}_wall_L{n}.geojson
"""
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
INPUT_DIR = os.path.join(PROJECT_DIR, "Geojson")
V2_DIR = os.path.join(PROJECT_DIR, "2.5d_indoor_navigation_frontend_v2")
PUBLIC_GEOJSON = os.path.join(V2_DIR, "public", "geojson")

# 슬리버 판정 기준 (Shoelace 좌표 면적, ≈5m² at lat37)
MIN_AREA = 5e-10

# 건물 한국어 이름 (manifest.name 용)
BUILDING_NAMES = {
    "eng1": "제1공학관", "eng2": "제2공학관",
    "sci1": "제1과학관", "sci2": "제2과학관",
    "res1": "제1종합연구동", "res2": "제2종합연구동",
    "slib": "삼성학술정보관", "iac": "산학협력센터",
    "bio": "생명공학관", "chem": "화학관",
    "semi": "반도체관", "bas": "기초학문관",
    "med": "의학관", "phar": "약학관",
}


# ──────────────────────────────────────────
# 유틸
# ──────────────────────────────────────────

def polygon_area(ring):
    area = 0
    n = len(ring)
    for i in range(n - 1):
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return abs(area / 2)


def feature_area(geom):
    if geom["type"] == "Polygon":
        return polygon_area(geom["coordinates"][0])
    if geom["type"] == "MultiPolygon":
        return sum(polygon_area(p[0]) for p in geom["coordinates"])
    return 0


def is_sliver(geom):
    return feature_area(geom) <= MIN_AREA


def multi_to_single(geom):
    if geom["type"] == "MultiPolygon" and len(geom["coordinates"]) == 1:
        return {"type": "Polygon", "coordinates": geom["coordinates"][0]}
    return geom


def calc_centroid(geom):
    if geom["type"] == "Polygon":
        ring = geom["coordinates"][0]
    elif geom["type"] == "MultiPolygon":
        ring = geom["coordinates"][0][0]
    else:
        return None
    n = len(ring) - 1
    if n <= 0:
        return None
    cx = sum(p[0] for p in ring[:n]) / n
    cy = sum(p[1] for p in ring[:n]) / n
    return [round(cx, 7), round(cy, 7)]


def coord_area_m2(geom):
    a = feature_area(geom)
    return a * 111000 * 88000


def try_open(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_geojson(path, features):
    data = {"type": "FeatureCollection", "features": features}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ──────────────────────────────────────────
# 메인 변환
# ──────────────────────────────────────────

def convert(code, levels):
    out_dir = os.path.join(PUBLIC_GEOJSON, code)
    os.makedirs(out_dir, exist_ok=True)

    # === 1. 외곽선 ===
    outline_src = try_open(os.path.join(INPUT_DIR, f"{code}_outline.geojson"))
    if outline_src and outline_src["features"]:
        feat = outline_src["features"][0]
        geom = multi_to_single(feat["geometry"])
        outline_feature = {
            "type": "Feature",
            "properties": {
                "building": "university",
                "name": BUILDING_NAMES.get(code, ""),
                "loc_ref": code.upper(),
            },
            "geometry": geom,
        }
        write_geojson(os.path.join(out_dir, f"{code}_outline.geojson"), [outline_feature])
        print(f"  외곽선: 1개")
    else:
        print(f"  [경고] {code}_outline.geojson 없음")

    # === 2. 층별 처리 ===
    for level in levels:
        print(f"\n--- Level {level} ---")

        # 복도 (collider)
        collider = try_open(os.path.join(INPUT_DIR, f"{code}_collider_L{level}.geojson"))
        if collider:
            collider_feats = []
            for i, feat in enumerate(collider["features"]):
                geom = multi_to_single(feat["geometry"])
                collider_feats.append({
                    "type": "Feature",
                    "properties": {"indoor": "corridor", "level": str(level)},
                    "geometry": geom,
                })
            write_geojson(os.path.join(out_dir, f"{code}_collider_L{level}.geojson"), collider_feats)
            print(f"  복도: {len(collider_feats)}개")

        # 방 (슬리버 제거 + 정렬 + 속성)
        rooms = try_open(os.path.join(INPUT_DIR, f"{code}_room_L{level}.geojson"))
        if rooms:
            total = len(rooms["features"])
            sliver_n = 0
            room_entries = []

            for feat in rooms["features"]:
                geom = multi_to_single(feat["geometry"])
                if is_sliver(geom):
                    sliver_n += 1
                    continue
                centroid = calc_centroid(geom)
                area = round(coord_area_m2(geom), 1)
                room_entries.append((centroid, area, geom))

            # 위치 순 정렬 (위→아래, 왼→오)
            room_entries.sort(key=lambda e: (-e[0][1], e[0][0]) if e[0] else (0, 0))

            room_feats = []
            for idx, (centroid, area, geom) in enumerate(room_entries):
                room_feats.append({
                    "type": "Feature",
                    "properties": {
                        "indoor": "room",
                        "level": str(level),
                        "ref": "",
                        "name": "",
                        "room_type": "",
                        "_idx": idx + 1,
                        "_centroid": centroid,
                        "_area_m2": area,
                    },
                    "geometry": geom,
                })

            write_geojson(os.path.join(out_dir, f"{code}_room_L{level}.geojson"), room_feats)
            print(f"  방: {total}개 → 슬리버 {sliver_n}개 제거 → {len(room_feats)}개")

        # 벽
        walls = try_open(os.path.join(INPUT_DIR, f"{code}_wall_l{level}.geojson"))
        wall_feats = []
        if walls:
            for feat in walls["features"]:
                if feat["geometry"].get("coordinates"):
                    geom = multi_to_single(feat["geometry"])
                    wall_feats.append({
                        "type": "Feature",
                        "properties": {"indoor": "wall", "level": str(level)},
                        "geometry": geom,
                    })
        write_geojson(os.path.join(out_dir, f"{code}_wall_L{level}.geojson"), wall_feats)
        print(f"  벽: {len(wall_feats)}개")

    # === 3. manifest.json ===
    manifest = {
        "building": code,
        "name": BUILDING_NAMES.get(code, ""),
        "loc_ref": code.upper(),
        "levels": sorted(levels),
    }
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"\n=== 변환 완료 ===")
    print(f"  출력: {out_dir}")
    print(f"  manifest.json + 외곽선 + {len(levels)}개 층 파일")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("사용법: python convert.py <building_code> <level> [level ...]")
        print("  예시: python convert.py eng1 1")
        print("        python convert.py eng2 1 2 3 4 5")
        sys.exit(1)

    code = sys.argv[1]
    levels = [int(x) for x in sys.argv[2:]]
    convert(code, levels)
