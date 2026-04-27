// ===== Building Detection — shared utility =====
// Extracted to avoid circular dependency between graphService and graphEditorState.

import * as BackendService from '../services/backendService';

export function detectBuilding(coords: [number, number], _level?: number): string {
  // Point-in-polygon against each loaded building's outline. Returns the
  // building code ("eng1", "slib", ...) or "outside" if no outline contains it.
  return BackendService.getBuildingForCoordinates(coords) ?? 'outside';
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
