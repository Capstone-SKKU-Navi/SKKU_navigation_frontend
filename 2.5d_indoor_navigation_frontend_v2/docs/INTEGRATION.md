# Backend ↔ Frontend Integration

How the SKKU 2.5D Navigation frontend (`:8082`) talks to the Spring Boot
backend (`:8080`), how to bring the whole stack up, and how to verify the
connection visually.

---

## 1. Quickstart

From this directory (`2.5d_indoor_navigation_frontend_v2`):

```powershell
# Windows PowerShell
npm run dev:full
```
or
```bash
# Git Bash / WSL
npm run dev:full:bash
```

That single command:

1. `docker compose up -d` in the backend repo (PostgreSQL + PostGIS).
2. Ensures `psycopg2-binary` is installed.
3. Runs the seed wrapper `scripts/seed.py` (which loads the upstream
   `import_to_db.py` and overrides its hardcoded paths).
4. Starts Spring Boot via `gradlew.bat bootRun` (background job).
5. Polls `http://localhost:8080/api/nodes` until 200 OK.
6. Smoke-tests: prints `Seeded: 27 nodes, 20 edges`.
7. `npm run dev` (Webpack on `:8082`, browser auto-opens).

When the browser opens you should see:

- The map loaded normally.
- A small pill in the **top-right at top:64 / right:12**, reading
  `LOCAL · graph.json` (gray dot). It sits below the existing top bar so it
  doesn't cover the search box / building info, and is **draggable**
  anywhere on screen.

### The 3-step manual form (if you don't want the orchestrator)

```powershell
# 1. PostgreSQL
docker run --name skku_nav_db `
  -e POSTGRES_DB=skku_nav -e POSTGRES_USER=skku -e POSTGRES_PASSWORD=skku1234 `
  -p 5432:5432 -d postgis/postgis:16-3.4
docker ps   # wait for (healthy)

# 2. Seed (from the frontend repo root)
pip install psycopg2-binary
python scripts/seed.py

# 3. Backend (separate shell)
cd ..\..\SKKU-2.5D-Navigation
.\gradlew.bat bootRun

# 4. Frontend (separate shell)
cd ...frontend...\2.5d_indoor_navigation_frontend_v2
npm run dev
```

Expected console milestones:
- Docker → `(healthy)`
- Seed wrapper → `[seed] backend = …`, then upstream output:
  `nav_nodes : 27/27`, `nav_edges : 20/20`, `geojson_files : 16/16`,
  `video_files : N/N`
- Spring Boot → `Started SkkuNavApplication in X.XXX seconds`
- Webpack → `compiled successfully`
- Browser opens at `http://localhost:8082`

---

## 2. Repo layout

```
e:\260301\
├── SKKU-2.5D-Navigation\               (backend, untouched by this work)
│   ├── docker-compose.yaml
│   ├── gradlew.bat
│   ├── scripts\import_to_db.py         ← official seed (psycopg2)
│   └── src\main\…
│
└── SKKU-2.5D-Navigation_frontend\
    └── 2.5d_indoor_navigation_frontend_v2\
        ├── public\geojson\graph.json   ← seed source (27 nodes, 20 edges)
        ├── videos\                     ← .mp4 files scanned by import_to_db.py
        ├── scripts\
        │   ├── seed.py                 ← wrapper for import_to_db.py
        │   ├── bootstrap.ps1           ← one-shot orchestrator (Windows)
        │   └── bootstrap.sh            ← bash mirror
        ├── src\
        │   ├── components\apiModeBadge.ts   ← draggable LOCAL/API pill
        │   └── services\
        │       ├── apiClient.ts             ← LOCAL ↔ API switch (existing)
        │       └── api\apiRoute.ts          ← POST /api/route + apiRouteCall event
        ├── docs\INTEGRATION.md         ← (this file)
        └── package.json                ← `seed`, `dev:full`, `dev:full:bash`
```

The backend repo is **not modified**. Only the wrapper and the badge live on
the frontend side.

---

## 3. Why the seed wrapper exists

The upstream `SKKU-2.5D-Navigation/scripts/import_to_db.py` hardcodes its
input directory as a sibling repo named `SKKU_navigation_frontend`
(underscore). The actual sibling on this machine is
`SKKU-2.5D-Navigation_frontend` (hyphenated), so the upstream script can't
find `graph.json` and exits with `[ERROR] 파일 없음`.

`scripts/seed.py` solves this without touching the backend file: it loads
`import_to_db.py` as a Python module via `importlib`, overrides the path
globals (`FRONTEND_APP`, `GEOJSON_DIR`, `VIDEOS_DIR`, `GRAPH_JSON`,
`BUILDINGS_JSON`, `VIDEO_SETTINGS_JSON`), and calls `mod.main()`. Both paths
are flag-overridable:

```bash
python scripts/seed.py --backend  E:/260301/SKKU-2.5D-Navigation
python scripts/seed.py --frontend E:/260301/SKKU-2.5D-Navigation_frontend/2.5d_indoor_navigation_frontend_v2
```

When upstream fixes its path resolution, this wrapper can be deleted and the
seed step in `bootstrap.{ps1,sh}` can call `import_to_db.py` directly.

---

## 4. Wire contract

### `POST /api/route` — primary route endpoint

Request (`ApiRouteRequestDto`):
```json
{
  "from": { "lng": 126.97608, "lat": 37.29362, "level": 1 },
  "to":   { "lng": 126.97697, "lat": 37.29420, "level": 3 }
}
```

Response (`ApiRouteResponseDto`):
```json
{
  "found": true,
  "route": {
    "coordinates":    [[126.97608, 37.29362], [126.97612, 37.29365], ...],
    "levels":         [1, 1, 1, 2, 2, 3, 3, ...],
    "totalDistance":  117.0,
    "estimatedTime":  "약 2분",
    "startLevel":     1,
    "endLevel":       3
  },
  "walkthrough": {
    "clips": [
      {
        "index": 0,
        "videoFile": "eng1_c_F1_1_cw.mp4",
        "videoStart": 0.0,
        "videoEnd":   63.66,
        "duration":   63.66,
        "yaw":        87.5,
        "level":      1,
        "isExitClip": false,
        "coordStartIdx": 0,
        "coordEndIdx":   12,
        "routeDistStart": 0.0,
        "routeDistEnd":   72.4
      }
    ],
    "videoStartCoordIdx": 0,
    "videoEndCoordIdx":   42
  }
}
```

All times in **seconds (DOUBLE)**. `coordinates` is `[lng, lat]` order
(GeoJSON convention). On no-route: `{ "found": false, "error": "..." }`.

### `GET /api/route?from={label}&to={label}` — legacy label-based

Returns a slimmer `RouteResponseDto`. Frontend doesn't use it; kept for
backward compat / debugging via `curl`.

### `GET /api/graph` — full graph

Returns `{ nodes: NodeDto[], edges: EdgeDto[] }`. The badge fires this once
on toggle to API mode, just to display `· N nodes loaded`.

### `GET /api/geojson/all` *(future)*

Single FeatureCollection merging all `geojson_files` rows, with injected
`_building` / `_level` / `_featureType` properties per feature. The
frontend currently loads GeoJSON statically from `/geojson/...`; switching
to this endpoint is a future cleanup, not part of this integration.

### `GET /api/videos/{filename}` *(future)*

Range-supporting MP4 streaming (206 Partial). Frontend currently reads from
its local `videos/` directory; switching is a future cleanup.

---

## 5. Frontend transformation (one paragraph)

`apiRoute.findRoute(from, to)` does `POST /api/route` with the two
`RouteCoord` objects and parses the response. The backend's
`ApiRouteResponseDto` shape is **structurally identical** to the frontend's
`ApiRouteResult` (sub-objects flattened: `route.*` and `walkthrough.*` →
top-level fields). No client enrichment, no yaw computation, no cumulative
distance. The result feeds `RouteOverlay.showRoute(...)` for the polyline
and `WalkthroughOverlay.showWalkthroughOverlay(playlist)` for the 360°
video. This contract was already correct in the frontend before this work;
the only addition is a single `apiRouteCall` `CustomEvent` dispatch so the
badge can render a request log.

---

## 6. Demo / proof of connection

The badge gives you four visible signals:

| What you see | What it proves |
|---|---|
| Gray pill `LOCAL · graph.json` on page load | Baseline: no backend involvement |
| Click toggle → green `API · localhost:8080 · 27 nodes loaded` | `GET /api/graph` round-trip succeeded; backend is reachable |
| Run a route → log line `POST /api/route · 200 in 41ms · 8 coords · 6 clips` | `POST /api/route` round-trip succeeded with that exact response |
| Stop backend, run again → red `API · ERROR · …` | The wire is real (not cached); failure is observable |

### Drag the pill

The whole left part (dot + label + detail) is the drag handle. Drop it
anywhere on screen; position persists in `localStorage['apiModeBadge.pos']`
and survives reload. Click on the **toggle** button, not the handle, to
switch modes.

### Side-by-side validation

Run the same route under LOCAL then API. The polyline, distance, time, and
walkthrough should look identical — that's the proof the local fallback and
backend produce the same result.

### Failure-mode demo

```bash
# Stop the backend mid-session
docker exec skku_nav_db pg_ctl stop -m fast    # or just Ctrl+C the gradle job
```

Click "경로 찾기" again with API mode still on → pill flips red, log shows
the failure. Restart the backend, click again → green on the next response.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `seed.py` ERROR `graph.json not found under …` | Wrong frontend dir | Pass `--frontend <path>` |
| `seed.py` ERROR `backend importer not found` | Wrong backend dir | Pass `--backend <path>` |
| `[ERROR] 파일 없음` from upstream importer | The wrapper isn't being used; called `import_to_db.py` directly | Use `npm run seed` or `python scripts/seed.py` |
| Badge red `API · ERROR · status 0` | Backend not running | `gradlew.bat bootRun` in the backend repo |
| Badge red after toggle to API | `/api/graph` failed | Check Spring Boot log; check CORS allows `http://localhost:8082` (`WebConfig.java` already does) |
| Flyway error `migration checksum mismatch` | Stale `flyway_schema_history` after a SQL edit | `docker compose down -v` to wipe the DB and reseed |
| `Found multiple migrations with version "4"` | A duplicate `V4__*.sql` exists | Delete extras; only `V4__drop_unused_schema.sql` should remain |
| Port 8080 in use | Stale gradle process | Find owner: `Get-NetTCPConnection -LocalPort 8080` (Win) / `lsof -i :8080`; kill |
| Port 5432 in use | Local Postgres already running | Stop it or change Docker port mapping |
| Walkthrough plays no video | Missing `.mp4` files | Drop the file referenced in the clip into the frontend's `videos/` directory |

---

## 8. Out of scope (explicit non-goals)

- Switching frontend GeoJSON loading from static `/geojson/...` to
  `GET /api/geojson/all`.
- Switching video streaming from local `videos/` to `GET /api/videos/{file}`.
- Replacing the local room search with `/api/nodes/search`.
- Any backend code change. The backend repo stays at `origin/main` exactly.
