// ===== 360° Video Catalog =====
// Corridor videos only — stair/elevator videos are auto-computed at runtime.
//
// Catalog is hydrated from GET /api/videos-list at startup so any building
// dropped under videos/<building>_mp4/ shows up in the edge picker. The eng1
// fallback below seeds the catalog before the network response arrives, so
// the editor still works synchronously on first paint.

import { NavNode } from './graphEditorTypes';

export interface VideoEntry {
  filename: string;
  type: 'corridor';    // catalog is corridor-only; vertical videos are auto-computed
  building?: string;   // e.g. 'eng1', 'slib'
  floor?: number;      // 1-5 (negative for basements)
  direction?: string;  // "cw"|"ccw"
  id?: number;         // segment id
  label: string;       // human-readable
}

// ===== Filename parser: {building}_c_F{floor}_{id}_{cw|ccw}.mp4 =====

function parseCorridorFilename(filename: string): VideoEntry | null {
  const m = filename.match(/^(.+?)_c_F(-?\d+)_(\d+)_(cw|ccw)\.mp4$/i);
  if (!m) return null;
  const [, building, floorStr, idStr, dir] = m;
  const floor = +floorStr;
  const id = +idStr;
  const dirLabel = dir === 'cw' ? '시계방향' : '반시계방향';
  return {
    filename,
    type: 'corridor',
    building,
    floor,
    direction: dir,
    id,
    label: `${building} F${floor} seg${id} ${dirLabel}`,
  };
}

// ===== Default eng1 fallback (used until /api/videos-list responds) =====

function buildEng1Fallback(): VideoEntry[] {
  const entries: VideoEntry[] = [];
  let segId = 1;
  for (let floor = 1; floor <= 5; floor++) {
    for (let seg = 0; seg < 3; seg++) {
      for (const dir of ['cw', 'ccw'] as const) {
        const filename = `eng1_c_F${floor}_${segId}_${dir}.mp4`;
        entries.push(parseCorridorFilename(filename)!);
      }
      segId++;
    }
  }
  return entries;
}

let CATALOG: VideoEntry[] = buildEng1Fallback();

/**
 * Refresh the catalog from the dev server's recursive videos/ index.
 * Safe to call multiple times — replaces the catalog atomically.
 */
export async function loadVideoCatalog(): Promise<void> {
  try {
    const res = await fetch('/api/videos-list');
    if (!res.ok) return;
    const { files } = (await res.json()) as { files?: string[] };
    if (!Array.isArray(files)) return;
    const next: VideoEntry[] = [];
    for (const f of files) {
      const entry = parseCorridorFilename(f);
      if (entry) next.push(entry);
    }
    if (next.length > 0) CATALOG = next;
  } catch {
    // Keep fallback catalog on error.
  }
}

export function getAllVideos(): VideoEntry[] {
  return CATALOG;
}

export function getVideosByType(type: VideoEntry['type']): VideoEntry[] {
  return CATALOG.filter(v => v.type === type);
}

/** Returns the opposite-direction video filename. Corridors only (cw↔ccw). */
export function getOppositeVideo(filename: string): string | undefined {
  if (filename.includes('_cw.')) return filename.replace('_cw.', '_ccw.');
  if (filename.includes('_ccw.')) return filename.replace('_ccw.', '_cw.');
  return undefined;
}

// ===== Smart-suggest: rank videos by relevance to an edge =====

export function suggestVideosForEdge(fromNode: NavNode, toNode: NavNode): VideoEntry[] {
  const floor = fromNode.level;

  const scored = CATALOG.map(v => {
    let score = 0;

    // Floor match
    if (v.floor === floor) score += 50;

    // Same-floor corridors preferred for non-vertical edges
    if (v.type === 'corridor') score += 20;

    return { entry: v, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.filename.localeCompare(b.entry.filename);
  });

  return scored.map(s => s.entry);
}
