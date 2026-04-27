// ===== Vertical Video Filename Computation =====
// Computes stair/elevator video filenames from node properties.
// Naming convention:
//   Stairs:    {building}_s_{stairId}_{floor}{e|o}{u|d}.mp4
//   Elevators: {building}_e_{elevId}_{floor}{e|o}.mp4

export function toBuildingCode(building: string): string {
  return building.toLowerCase();
}

/**
 * Pick the building code that should be used for vertical video filenames
 * given the two endpoint buildings of a stair/elevator edge. "outside" means
 * the node lives outside any loaded building outline — never a real video
 * prefix. Returns null if no usable building can be determined; callers must
 * handle this (skip the clip / show "(building unknown)").
 */
export function pickVerticalBuilding(a: string | undefined, b: string | undefined): string | null {
  const aOk = a && a !== 'outside' ? a : null;
  const bOk = b && b !== 'outside' ? b : null;
  return aOk ?? bOk;
}

// ===== Stair Videos =====

export interface StairVideoResult {
  entryVideo: string;
  exitVideo: string;
}

/**
 * Compute stair video filenames for a floor transition.
 * e.g., stair 1 from 1F→2F: entry=eng1_s_1_1eu.mp4, exit=eng1_s_1_2ou.mp4
 */
export function computeStairVideos(
  building: string,
  stairId: number,
  fromFloor: number,
  toFloor: number,
): StairVideoResult {
  const prefix = toBuildingCode(building);
  const dir = toFloor > fromFloor ? 'u' : 'd';
  return {
    entryVideo: `${prefix}_s_${stairId}_${fromFloor}e${dir}.mp4`,
    exitVideo: `${prefix}_s_${stairId}_${toFloor}o${dir}.mp4`,
  };
}

// ===== Elevator Videos =====

export interface ElevatorVideoResult {
  entryVideo: string;
  exitVideo: string;
}

/**
 * Compute elevator video filenames for a floor transition.
 * e.g., elevator 1 from 1F→5F: entry=eng1_e_1_1e.mp4, exit=eng1_e_1_5o.mp4
 */
export function computeElevatorVideos(
  building: string,
  elevId: number,
  fromFloor: number,
  toFloor: number,
): ElevatorVideoResult {
  const prefix = toBuildingCode(building);
  return {
    entryVideo: `${prefix}_e_${elevId}_${fromFloor}e.mp4`,
    exitVideo: `${prefix}_e_${elevId}_${toFloor}o.mp4`,
  };
}

// ===== Enumerate all vertical video filenames for a building =====

export interface VerticalVideoConfig {
  building: string;
  stairs: number[];     // e.g. [1, 2, 3, 4]
  elevators: number[];  // e.g. [1, 2]
  floors: number[];     // e.g. [1, 2, 3, 4, 5]
}

export interface VerticalVideoEntry {
  filename: string;
  type: 'stair' | 'elevator';
  id: number;
  floor: number;
  action: 'enter' | 'exit';
  direction?: 'up' | 'down'; // stairs only
  label: string;
}

/**
 * Generate all expected stair/elevator video filenames for a building.
 * Used by video settings panel and catalog.
 */
export function getAllVerticalVideos(config: VerticalVideoConfig): VerticalVideoEntry[] {
  const prefix = toBuildingCode(config.building);
  const entries: VerticalVideoEntry[] = [];
  const minFloor = Math.min(...config.floors);
  const maxFloor = Math.max(...config.floors);

  // Stairs
  for (const stairId of config.stairs) {
    for (const floor of config.floors) {
      // Enter going up — exists on floors 1..4 (can't go up from top floor)
      if (floor < maxFloor) {
        entries.push({
          filename: `${prefix}_s_${stairId}_${floor}eu.mp4`,
          type: 'stair', id: stairId, floor, action: 'enter', direction: 'up',
          label: `계단${stairId} ${floor}F 진입↑`,
        });
      }
      // Enter going down — exists on floors 2..5 (can't go down from bottom floor)
      if (floor > minFloor) {
        entries.push({
          filename: `${prefix}_s_${stairId}_${floor}ed.mp4`,
          type: 'stair', id: stairId, floor, action: 'enter', direction: 'down',
          label: `계단${stairId} ${floor}F 진입↓`,
        });
      }
      // Exit after ascending — exists on floors 2..5 (arrived here going up)
      if (floor > minFloor) {
        entries.push({
          filename: `${prefix}_s_${stairId}_${floor}ou.mp4`,
          type: 'stair', id: stairId, floor, action: 'exit', direction: 'up',
          label: `계단${stairId} ${floor}F 나옴↑`,
        });
      }
      // Exit after descending — exists on floors 1..4 (arrived here going down)
      if (floor < maxFloor) {
        entries.push({
          filename: `${prefix}_s_${stairId}_${floor}od.mp4`,
          type: 'stair', id: stairId, floor, action: 'exit', direction: 'down',
          label: `계단${stairId} ${floor}F 나옴↓`,
        });
      }
    }
  }

  // Elevators
  for (const elevId of config.elevators) {
    for (const floor of config.floors) {
      entries.push({
        filename: `${prefix}_e_${elevId}_${floor}e.mp4`,
        type: 'elevator', id: elevId, floor, action: 'enter',
        label: `엘리베이터${elevId} ${floor}F 진입`,
      });
      entries.push({
        filename: `${prefix}_e_${elevId}_${floor}o.mp4`,
        type: 'elevator', id: elevId, floor, action: 'exit',
        label: `엘리베이터${elevId} ${floor}F 나옴`,
      });
    }
  }

  return entries;
}

// Default config for eng1 building
export const ENG1_VERTICAL_CONFIG: VerticalVideoConfig = {
  building: 'eng1',
  stairs: [1, 2, 3, 4],
  elevators: [1, 2],
  floors: [1, 2, 3, 4, 5],
};

// Estimated duration per clip (seconds) — used for playlist planning
export const STAIR_CLIP_DURATION = 4;
export const ELEVATOR_CLIP_DURATION = 3;
