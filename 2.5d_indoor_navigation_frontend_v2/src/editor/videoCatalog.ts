// ===== 360° Video Catalog for eng1 Building =====
// Corridor videos only — stair/elevator videos are auto-computed at runtime.

import { NavNode } from './graphEditorTypes';

export interface VideoEntry {
  filename: string;
  type: 'corridor';    // catalog is corridor-only; vertical videos are auto-computed
  floor?: number;      // 1-5
  direction?: string;  // "cw"|"ccw"
  id?: number;         // segment id
  label: string;       // human-readable
}

// ===== Corridor catalog: 3 segments × 5 floors × 2 directions = 30 =====

function buildCatalog(): VideoEntry[] {
  const entries: VideoEntry[] = [];

  // Naming: eng1_c_F{floor}_{id}_{cw|ccw}.mp4
  // 3 segments per floor, ids numbered sequentially across floors
  let segId = 1;
  for (let floor = 1; floor <= 5; floor++) {
    for (let seg = 0; seg < 3; seg++) {
      for (const dir of ['cw', 'ccw'] as const) {
        const dirLabel = dir === 'cw' ? '시계방향' : '반시계방향';
        entries.push({
          filename: `eng1_c_F${floor}_${segId}_${dir}.mp4`,
          type: 'corridor',
          floor,
          direction: dir,
          id: segId,
          label: `F${floor} seg${segId} ${dirLabel}`,
        });
      }
      segId++;
    }
  }

  return entries;
}

const CATALOG = buildCatalog();

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
