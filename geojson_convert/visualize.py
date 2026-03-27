"""
GeoJSON 방 폴리곤 시각화 — idx 번호 라벨 포함 SVG 생성

사용법: python visualize.py <geojson_path> [output.svg]
  예시: python visualize.py geojson_attribute/eng1.geojson
"""
import json
import os
import sys


def calc_centroid(coords):
    ring = coords[0] if coords else []
    n = len(ring) - 1
    if n <= 0:
        return None
    cx = sum(p[0] for p in ring[:n]) / n
    cy = sum(p[1] for p in ring[:n]) / n
    return (cx, cy)


def main():
    if len(sys.argv) < 2:
        print("사용법: python visualize.py <geojson> [output.svg]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else input_path.replace(".geojson", "_map.svg")

    with open(input_path, encoding="utf-8") as f:
        data = json.load(f)

    rooms = [f for f in data["features"] if f["properties"].get("indoor") == "room"]
    corridors = [f for f in data["features"] if f["properties"].get("indoor") == "corridor"]

    if not rooms:
        print("방 피처가 없습니다.")
        sys.exit(1)

    # 전체 좌표 범위 계산
    all_lngs, all_lats = [], []
    for feat in rooms + corridors:
        geom = feat["geometry"]
        ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
        for p in ring:
            all_lngs.append(p[0])
            all_lats.append(p[1])

    min_lng, max_lng = min(all_lngs), max(all_lngs)
    min_lat, max_lat = min(all_lats), max(all_lats)

    # SVG 크기 (여백 포함)
    margin = 40
    width = 1200
    aspect = (max_lat - min_lat) / (max_lng - min_lng) if (max_lng - min_lng) > 0 else 1
    height = int(width * aspect)

    def to_svg(lng, lat):
        """WGS84 → SVG 좌표 (Y 반전: 북쪽이 위)"""
        x = margin + (lng - min_lng) / (max_lng - min_lng) * (width - 2 * margin)
        y = margin + (1 - (lat - min_lat) / (max_lat - min_lat)) * (height - 2 * margin)
        return x, y

    svg_parts = []
    svg_parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width + margin}" height="{height + margin}" '
                     f'viewBox="0 0 {width + margin} {height + margin}" '
                     f'style="background:#fff;font-family:sans-serif">')

    # 복도 (배경)
    for feat in corridors:
        geom = feat["geometry"]
        ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
        pts = " ".join(f"{to_svg(p[0], p[1])[0]:.1f},{to_svg(p[0], p[1])[1]:.1f}" for p in ring)
        svg_parts.append(f'<polygon points="{pts}" fill="#F0F0E8" stroke="#CCC" stroke-width="0.5"/>')

    # 방 폴리곤
    colors = {
        "classroom": "#8FB8D0",
        "lab": "#81C784",
        "restroom": "#CE93D8",
        "office": "#FFB74D",
        "stairs": "#A1887F",
        "elevator": "#B0BEC5",
    }

    for feat in rooms:
        props = feat["properties"]
        idx = props.get("_idx", "?")
        ref = props.get("ref", "")
        room_type = props.get("room_type", "")
        geom = feat["geometry"]
        ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]

        fill = colors.get(room_type, "#D0E8F0")
        pts = " ".join(f"{to_svg(p[0], p[1])[0]:.1f},{to_svg(p[0], p[1])[1]:.1f}" for p in ring)
        svg_parts.append(f'<polygon points="{pts}" fill="{fill}" stroke="#1A237E" stroke-width="1" opacity="0.8"/>')

        # 라벨
        centroid = props.get("_centroid")
        if centroid:
            cx, cy = to_svg(centroid[0], centroid[1])
            label = ref if ref else str(idx)
            font_size = 9 if not ref else 8
            svg_parts.append(
                f'<text x="{cx:.1f}" y="{cy:.1f}" text-anchor="middle" dominant-baseline="central" '
                f'font-size="{font_size}" font-weight="bold" fill="#222">{label}</text>'
            )

    # 방위 표시
    svg_parts.append(f'<text x="{width // 2}" y="15" text-anchor="middle" font-size="12" fill="#666">N ↑</text>')

    svg_parts.append("</svg>")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(svg_parts))

    print(f"SVG 생성: {output_path}")
    print(f"  방 {len(rooms)}개, 복도 {len(corridors)}개")


if __name__ == "__main__":
    main()
