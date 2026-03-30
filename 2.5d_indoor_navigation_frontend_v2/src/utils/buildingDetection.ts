// ===== Building Detection — shared utility =====
// Extracted to avoid circular dependency between graphService and graphEditorState.

import * as BackendService from '../services/backendService';

export function detectBuilding(coords: [number, number], level: number): string {
  const [lng, lat] = coords;

  // Try room polygon containment
  try {
    const levelGeoJson = BackendService.getLevelGeoJson(level);
    for (const f of levelGeoJson.features) {
      if (f.properties.indoor !== 'room' || !f.properties.ref) continue;
      if (f.geometry.type !== 'Polygon') continue;

      const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
      if (pointInPolygon(lng, lat, ring)) {
        const ref = f.properties.ref as string;
        if (ref.startsWith('21')) return '21';
        if (ref.startsWith('22')) return '22';
        if (ref.startsWith('23')) return '23';
      }
    }
  } catch { /* data not loaded yet */ }

  // Fallback: geographic heuristic
  if (lat < 37.29418 && lng < 126.97693) return '21';
  if (lng >= 126.97693) return '22';
  if (lat >= 37.29418) return '23';
  return 'ENG1';
}

export function pointInPolygon(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
