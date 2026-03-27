import { BuildingInterface, BuildingConstants, BuildingManifest, LevelData, RoomListItem } from '../models/types';
import { extractLevels } from '../utils/extractLevels';

// Building view config (zoom, pitch, etc.)
const BUILDING_VIEW = {
  eng1: {
    STANDARD_ZOOM: 19.5,
    MAX_ZOOM: 21,
    MIN_ZOOM: 15,
    STANDARD_BEARING_3D_MODE: -45,
    STANDARD_PITCH_3D_MODE: 72,
    STANDARD_ZOOM_3D_MODE: 20.0,
  },
} as Record<string, {
  STANDARD_ZOOM: number; MAX_ZOOM: number; MIN_ZOOM: number;
  STANDARD_BEARING_3D_MODE: number; STANDARD_PITCH_3D_MODE: number; STANDARD_ZOOM_3D_MODE: number;
}>;

const DEFAULT_VIEW = {
  STANDARD_ZOOM: 19.5, MAX_ZOOM: 21, MIN_ZOOM: 15,
  STANDARD_BEARING_3D_MODE: -45, STANDARD_PITCH_3D_MODE: 72, STANDARD_ZOOM_3D_MODE: 20.0,
};

const currentBuilding = 'eng1';

let manifest: BuildingManifest;
let buildingInterface: BuildingInterface;
let buildingConstants: BuildingConstants;
let buildingDescription = '';
let roomList: RoomListItem[] = [];

// Per-level categorized data
const levelDataCache = new Map<number, LevelData>();

// ===== Fetching =====

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch { return null; }
}

const emptyFC = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export async function fetchBackendData(): Promise<void> {
  const code = currentBuilding;
  const base = `/geojson/${code}`;

  // 1. Manifest
  const m = await fetchJson<BuildingManifest>(`${base}/manifest.json`);
  if (!m) throw new Error('manifest.json 로딩 실패');
  manifest = m;

  // 2. Outline
  const outlineGeoJson = await fetchJson<GeoJSON.FeatureCollection>(`${base}/${code}_outline.geojson`);
  const outlineFeature = outlineGeoJson?.features?.[0];
  if (!outlineFeature) throw new Error('건물 외곽선을 찾을 수 없습니다.');

  // Bounding box
  const allCoords = extractAllCoords(outlineFeature.geometry);
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of allCoords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }

  buildingInterface = { boundingBox: [minLng, minLat, maxLng, maxLat], feature: outlineFeature };

  // Description
  const props = outlineFeature.properties ?? {};
  buildingDescription = props.name ?? manifest.name ?? '';
  if (manifest.loc_ref) buildingDescription += ` (${manifest.loc_ref})`;

  // 3. Per-level files (parallel)
  const levels = manifest.levels;
  await Promise.all(levels.map(async (level) => {
    const [rooms, colliders, walls] = await Promise.all([
      fetchJson<GeoJSON.FeatureCollection>(`${base}/${code}_room_L${level}.geojson`),
      fetchJson<GeoJSON.FeatureCollection>(`${base}/${code}_collider_L${level}.geojson`),
      fetchJson<GeoJSON.FeatureCollection>(`${base}/${code}_wall_L${level}.geojson`),
    ]);

    // Parse level strings to arrays on room features
    const roomFC = rooms ?? emptyFC();
    for (const f of roomFC.features) {
      if (f.properties.level !== undefined) {
        f.properties.level = extractLevels(String(f.properties.level));
      }
    }

    const colliderFC = colliders ?? emptyFC();
    for (const f of colliderFC.features) {
      if (f.properties.level !== undefined) {
        f.properties.level = extractLevels(String(f.properties.level));
      }
    }

    levelDataCache.set(level, {
      rooms: roomFC,
      colliders: colliderFC,
      walls: walls ?? emptyFC(),
    });
  }));

  // 4. Build room list (for search)
  roomList = [];
  for (const level of levels) {
    const data = levelDataCache.get(level);
    if (!data) continue;
    for (const f of data.rooms.features) {
      if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
      if (!f.properties.ref) continue;
      const fLevels = Array.isArray(f.properties.level) ? f.properties.level : [level];
      roomList.push({
        ref: f.properties.ref,
        name: f.properties.name ?? '',
        level: fLevels,
        roomType: f.properties.room_type ?? '',
        featureId: String(f.properties._idx ?? ''),
      });
    }
  }

  // 5. Building constants
  const view = BUILDING_VIEW[code] ?? DEFAULT_VIEW;
  buildingConstants = {
    standardZoom: view.STANDARD_ZOOM,
    maxZoom: view.MAX_ZOOM,
    minZoom: view.MIN_ZOOM,
    standardBearing: view.STANDARD_BEARING_3D_MODE,
    standardBearing3DMode: view.STANDARD_BEARING_3D_MODE,
    standardPitch3DMode: view.STANDARD_PITCH_3D_MODE,
    standardZoom3DMode: view.STANDARD_ZOOM_3D_MODE,
  };

  // Map center = bounding box center
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  mapCenter = [centerLng, centerLat];
}

function extractAllCoords(geom: GeoJSON.Geometry): number[][] {
  const coords: number[][] = [];
  function walk(arr: any): void {
    if (typeof arr[0] === 'number') { coords.push(arr); }
    else { for (const c of arr) walk(c); }
  }
  if ('coordinates' in geom) walk(geom.coordinates);
  return coords;
}

// ===== Public API =====

let mapCenter: [number, number] = [126.9766, 37.2939];

export function getBuildingConstants(): BuildingConstants { return buildingConstants; }
export function getBuildingDescription(): string { return buildingDescription; }
export function getMapCenter(): [number, number] { return mapCenter; }
export function getBoundingBox(): [number, number, number, number] { return buildingInterface.boundingBox; }
export function getRoomList(): RoomListItem[] { return roomList; }

export function getOutline(): number[][] {
  const geom = buildingInterface.feature.geometry;
  if (geom.type === 'MultiPolygon') return (geom as GeoJSON.MultiPolygon).coordinates[0][0];
  return (geom as GeoJSON.Polygon).coordinates[0];
}

export function getAllLevels(): number[] {
  return [...manifest.levels].sort((a, b) => b - a);
}

/** Pre-categorized level data (rooms, colliders, walls) */
export function getLevelData(level: number): LevelData {
  return levelDataCache.get(level) ?? { rooms: emptyFC(), colliders: emptyFC(), walls: emptyFC() };
}

/** Room features for a specific level */
export function getRoomFeaturesForLevel(level: number): GeoJSON.Feature[] {
  return getLevelData(level).rooms.features;
}

/** Backward-compat: all features for a level merged */
export function getLevelGeoJson(level: number): GeoJSON.FeatureCollection {
  const data = getLevelData(level);
  return {
    type: 'FeatureCollection',
    features: [...data.rooms.features, ...data.colliders.features, ...data.walls.features],
  };
}

/** Backward-compat: all indoor features across all levels */
export function getGeoJson(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const level of manifest.levels) {
    const data = levelDataCache.get(level);
    if (!data) continue;
    features.push(...data.rooms.features, ...data.colliders.features);
  }
  return { type: 'FeatureCollection', features };
}

/** Search rooms by ref/name */
export function searchRooms(query: string): RoomListItem[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return roomList.filter(r =>
    r.ref.toLowerCase().startsWith(q) ||
    r.name.toLowerCase().includes(q) ||
    r.roomType.toLowerCase().startsWith(q)
  ).slice(0, 20);
}
