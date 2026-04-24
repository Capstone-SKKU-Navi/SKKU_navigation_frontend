#!/usr/bin/env python3
"""
seed.py — wrapper for the backend's scripts/import_to_db.py.

The upstream importer hardcodes the frontend repo path as
"SKKU_navigation_frontend" (underscore), but the actual sibling repo on this
machine is "SKKU-2.5D-Navigation_frontend" (hyphenated). Rather than patch
the backend file, this wrapper loads it as a module and overrides the
relevant globals before calling main().

Usage:
  python scripts/seed.py
  python scripts/seed.py --backend  E:/260301/SKKU-2.5D-Navigation
  python scripts/seed.py --frontend E:/260301/SKKU-2.5D-Navigation_frontend/2.5d_indoor_navigation_frontend_v2

Defaults assume the standard sibling layout:
  E:\\260301\\
    ├── SKKU-2.5D-Navigation\\               (backend)
    └── SKKU-2.5D-Navigation_frontend\\
        └── 2.5d_indoor_navigation_frontend_v2\\   (this directory)
"""
import argparse
import importlib.util
import sys
from pathlib import Path


def main() -> int:
    here = Path(__file__).resolve()
    frontend_default = here.parents[1]
    backend_default = here.parents[3] / "SKKU-2.5D-Navigation"

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--backend", default=str(backend_default),
                    help="Path to the SKKU-2.5D-Navigation repo")
    ap.add_argument("--frontend", default=str(frontend_default),
                    help="Path to the frontend app dir (contains public/geojson, videos)")
    args = ap.parse_args()

    backend = Path(args.backend).resolve()
    frontend = Path(args.frontend).resolve()
    importer = backend / "scripts" / "import_to_db.py"

    if not importer.exists():
        print(f"[seed] ERROR: backend importer not found: {importer}", file=sys.stderr)
        return 1
    geojson_dir = frontend / "public" / "geojson"
    if not (geojson_dir / "graph.json").exists():
        print(f"[seed] ERROR: graph.json not found under {geojson_dir}", file=sys.stderr)
        return 1

    spec = importlib.util.spec_from_file_location("import_to_db", importer)
    if spec is None or spec.loader is None:
        print(f"[seed] ERROR: cannot load module from {importer}", file=sys.stderr)
        return 1
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    # Override the upstream module's hardcoded paths
    mod.FRONTEND_APP        = frontend
    mod.GEOJSON_DIR         = geojson_dir
    mod.VIDEOS_DIR          = frontend / "videos"
    mod.GRAPH_JSON          = geojson_dir / "graph.json"
    mod.BUILDINGS_JSON      = geojson_dir / "buildings.json"
    mod.VIDEO_SETTINGS_JSON = geojson_dir / "video_settings.json"

    print(f"[seed] backend  = {backend}")
    print(f"[seed] frontend = {frontend}\n")
    mod.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
