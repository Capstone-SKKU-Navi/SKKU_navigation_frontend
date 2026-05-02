#!/usr/bin/env node
// Bootstraps `public/geojson/editor/save.json` from the existing
// `graph.json`, `video_settings.json`, and per-building room geojson files.
//
// Idempotent — pass --force to overwrite an existing save.json.
//
// Re-running on a fresh checkout is safe: nothing breaks if the editor opens
// without ever running this. Hydration falls back to the legacy files and the
// next mutation creates the save file. This script is just a convenience for
// having the file present before the editor opens.

const fs = require('fs');
const path = require('path');

const GEOJSON_ROOT = path.join(__dirname, '..', 'public', 'geojson');
const GRAPH_JSON = path.join(GEOJSON_ROOT, 'graph.json');
const VIDEO_SETTINGS_JSON = path.join(GEOJSON_ROOT, 'video_settings.json');
const SAVE_PATH = path.join(GEOJSON_ROOT, 'editor', 'save.json');

const force = process.argv.includes('--force');

if (fs.existsSync(SAVE_PATH) && !force) {
  console.log(`[init-editor-save] save.json already exists at ${SAVE_PATH}`);
  console.log(`[init-editor-save] pass --force to overwrite`);
  process.exit(0);
}

const graph = readJson(GRAPH_JSON, { nodes: {}, edges: [] });
const videoSettingsRaw = readJson(VIDEO_SETTINGS_JSON, {});
const rooms = collectRoomEdits();

const videoSettings = {};
for (const [filename, entry] of Object.entries(videoSettingsRaw)) {
  // Stamp legacy entries with updatedAt: 0 so any later edit on either side
  // wins on first import.
  videoSettings[filename] = { ...entry, updatedAt: entry.updatedAt ?? 0 };
}

const save = {
  version: 1,
  metadata: {
    savedAt: new Date().toISOString(),
    note: '',
  },
  graph,
  videoSettings,
  rooms,
};

fs.mkdirSync(path.dirname(SAVE_PATH), { recursive: true });
fs.writeFileSync(SAVE_PATH, JSON.stringify(save, null, 2), 'utf-8');

console.log(`[init-editor-save] wrote ${SAVE_PATH}`);
console.log(`[init-editor-save]   nodes: ${Object.keys(graph.nodes).length}`);
console.log(`[init-editor-save]   edges: ${graph.edges.length}`);
console.log(`[init-editor-save]   videos with settings: ${Object.keys(videoSettings).length}`);
console.log(`[init-editor-save]   configured rooms: ${rooms.length}`);

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[init-editor-save] missing ${filePath} — using empty default`);
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function collectRoomEdits() {
  const out = [];
  for (const buildingDir of fs.readdirSync(GEOJSON_ROOT, { withFileTypes: true })) {
    if (!buildingDir.isDirectory() || buildingDir.name === 'editor') continue;
    const building = buildingDir.name;
    const buildingPath = path.join(GEOJSON_ROOT, building);
    for (const file of fs.readdirSync(buildingPath)) {
      const m = /^([a-z][a-z0-9_-]*)_room_L(-?\d+)\.geojson$/i.exec(file);
      if (!m || m[1] !== building) continue;
      const level = parseInt(m[2], 10);
      const fc = readJson(path.join(buildingPath, file), { features: [] });
      for (const f of fc.features) {
        const props = f && f.properties;
        if (!props) continue;
        const ref = props.ref || '';
        const name = props.name || '';
        const roomType = props.room_type || '';
        if (!ref && !name && !roomType) continue;       // unconfigured — skip
        const fingerprint = fingerprintFor(props);
        if (!fingerprint) continue;                      // missing centroid/area — skip
        out.push({
          building,
          level,
          fingerprint,
          ref,
          name,
          room_type: roomType,
          updatedAt: 0,
        });
      }
    }
  }
  return out;
}

function fingerprintFor(props) {
  const c = props._centroid;
  const a = props._area_m2;
  if (!Array.isArray(c) || c.length < 2 || a === undefined || a === null) return null;
  // Mirror geojson_convert/convert.py — lat/lng to 6 decimals, area to 1.
  return `${Number(c[0]).toFixed(6)}_${Number(c[1]).toFixed(6)}_${Number(a).toFixed(1)}`;
}
