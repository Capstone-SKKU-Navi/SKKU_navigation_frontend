#!/usr/bin/env python3
"""Remove duplicate overlapping room polygons from a *_room_L*.geojson file.

Root cause: the QGIS revise/re-import pipeline can emit each room polygon twice
— once with its original classification (ref/name/room_type) and once as an
unclassified empty copy with identical geometry. In the map's fill-extrusion
layer the empty copy (room_type='') draws on top of the classified one and
paints it the default grey, so room-type colours disappear.

Fix: group features by (_centroid, _area_m2). Within each group keep the most
informative feature (has room_type, else ref, else name) and drop exact-geometry
duplicates. Groups with a single feature pass through untouched. Geometry is
verified identical within a group before dropping, so no area is lost.

Usage:  python dedup_room_polygons.py <file.geojson> [<file.geojson> ...]
Writes <file>.bak once, then overwrites <file> in place.
"""
import collections
import json
import os
import sys


def info_rank(props):
    """Higher = more informative. Prefer room_type, then ref, then name."""
    return (
        1 if props.get("room_type") else 0,
        1 if props.get("ref") else 0,
        1 if props.get("name") else 0,
    )


def group_key(feature):
    props = feature.get("properties", {}) or {}
    centroid = props.get("_centroid")
    centroid = tuple(centroid) if centroid else None
    return (centroid, props.get("_area_m2"))


def geom_signature(feature):
    return json.dumps(feature.get("geometry", {}).get("coordinates"), sort_keys=True)


def dedup(features):
    groups = collections.OrderedDict()
    for f in features:
        groups.setdefault(group_key(f), []).append(f)

    kept = []
    removed = 0
    for key, members in groups.items():
        # Singletons or groups with no centroid fingerprint: keep all as-is.
        if len(members) == 1 or key[0] is None:
            kept.extend(members)
            continue
        # Only collapse members that are exact geometric duplicates of each
        # other. Distinct geometries sharing a fingerprint stay separate.
        by_geom = collections.OrderedDict()
        for m in members:
            by_geom.setdefault(geom_signature(m), []).append(m)
        for dupes in by_geom.values():
            best = max(dupes, key=lambda m: info_rank(m.get("properties", {}) or {}))
            kept.append(best)
            removed += len(dupes) - 1
    return kept, removed


def main(paths):
    for path in paths:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        before = len(data["features"])
        data["features"], removed = dedup(data["features"])
        after = len(data["features"])

        bak = path + ".bak"
        if not os.path.exists(bak):
            os.replace(path, bak)
            # os.replace moved the original to .bak; re-read is not needed.
        else:
            print(f"  ({os.path.basename(bak)} already exists, not overwriting backup)")

        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print(f"{os.path.basename(path)}: {before} -> {after} features ({removed} duplicates removed)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
