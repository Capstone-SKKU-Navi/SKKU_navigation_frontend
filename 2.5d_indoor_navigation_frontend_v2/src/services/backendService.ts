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

// ===== Per-Building Data Stores =====

const buildingManifests = new Map<string, BuildingManifest>();
const buildingInterfaces = new Map<string, BuildingInterface>();
const levelDataCaches = new Map<string, Map<number, LevelData>>();

let buildingCodes: string[] = [];
let buildingConstants: BuildingConstants;
let buildingDescription = '';
let roomList: RoomListItem[] = [];
let mapCenter: [number, number] = [126.9766, 37.2939];

// ===== Base URLs (configurable for backend API) =====

let geojsonBase = '/geojson';
let videoBase = '/videos';

export function setGeojsonBase(base: string): void {
  geojsonBase = base;
}

export function setVideoBase(base: string): void {
  videoBase = base;
}

export function getVideoUrl(filename: string): string {
  return `${videoBase}/${filename}`;
}

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
  // 1. Discover available buildings
  const codes = await fetchJson<string[]>(`${geojsonBase}/buildings.json`);
  if (!codes || codes.length === 0) throw new Error('buildings.json 로딩 실패');
  buildingCodes = codes;

  // 2. Load all buildings in parallel
  await Promise.all(codes.map(code => loadBuilding(code)));

  // 3. Build aggregate room list
  roomList = [];
  for (const code of buildingCodes) {
    const manifest = buildingManifests.get(code)!;
    const cache = levelDataCaches.get(code)!;
    for (const level of manifest.levels) {
      const data = cache.get(level);
      if (!data) continue;
      for (const f of data.rooms.features) {
        if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
        if (!f.properties.ref) continue;
        const fLevels = Array.isArray(f.properties.level) ? f.properties.level : [level];
        roomList.push({
          building: code,
          ref: f.properties.ref,
          name: f.properties.name ?? '',
          level: fLevels,
          roomType: f.properties.room_type ?? '',
          featureId: String(f.properties._idx ?? ''),
        });
      }
    }
  }

  // 4. Building constants — use first building's view config
  const primaryCode = buildingCodes[0];
  const view = BUILDING_VIEW[primaryCode] ?? DEFAULT_VIEW;
  buildingConstants = {
    standardZoom: view.STANDARD_ZOOM,
    maxZoom: view.MAX_ZOOM,
    minZoom: view.MIN_ZOOM,
    standardBearing: view.STANDARD_BEARING_3D_MODE,
    standardBearing3DMode: view.STANDARD_BEARING_3D_MODE,
    standardPitch3DMode: view.STANDARD_PITCH_3D_MODE,
    standardZoom3DMode: view.STANDARD_ZOOM_3D_MODE,
  };

  // 5. Map center — union bounding box center
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const bi of buildingInterfaces.values()) {
    const [w, s, e, n] = bi.boundingBox;
    if (w < minLng) minLng = w;
    if (s < minLat) minLat = s;
    if (e > maxLng) maxLng = e;
    if (n > maxLat) maxLat = n;
  }
  mapCenter = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];

  buildingDescription = buildingManifests.get(primaryCode)?.name ?? '';
  const locRef = buildingManifests.get(primaryCode)?.loc_ref;
  if (locRef) buildingDescription += ` (${locRef})`;
}

async function loadBuilding(code: string): Promise<void> {
  const base = `${geojsonBase}/${code}`;

  // Manifest
  const m = await fetchJson<BuildingManifest>(`${base}/manifest.json`);
  if (!m) throw new Error(`${code}/manifest.json 로딩 실패`);
  buildingManifests.set(code, m);

  // Outline
  const outlineGeoJson = await fetchJson<GeoJSON.FeatureCollection>(`${base}/${code}_outline.geojson`);
  const outlineFeature = outlineGeoJson?.features?.[0];
  if (!outlineFeature) throw new Error(`${code} 건물 외곽선을 찾을 수 없습니다.`);

  const allCoords = extractAllCoords(outlineFeature.geometry);
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of allCoords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  buildingInterfaces.set(code, { boundingBox: [minLng, minLat, maxLng, maxLat], feature: outlineFeature });

  // Per-level files (parallel)
  const cache = new Map<number, LevelData>();
  await Promise.all(m.levels.map(async (level) => {
    const [rooms, colliders, walls] = await Promise.all([
      fetchJson<GeoJSON.FeatureCollection>(`${base}/${code}_room_L${level}.geojson`),
      fetchJson<GeoJSON.FeatureCollection>(`${base}/${code}_collider_L${level}.geojson`),
      fetchJson<GeoJSON.FeatureCollection>(`${base}/${code}_wall_L${level}.geojson`),
    ]);

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

    cache.set(level, {
      rooms: roomFC,
      colliders: colliderFC,
      walls: walls ?? emptyFC(),
    });
  }));

  levelDataCaches.set(code, cache);
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

export function getBuildingConstants(): BuildingConstants { return buildingConstants; }
export function getBuildingDescription(): string { return buildingDescription; }
export function getMapCenter(): [number, number] { return mapCenter; }
export function getRoomList(): RoomListItem[] { return roomList; }
export function getBuildingCodes(): string[] { return buildingCodes; }

export function getBoundingBox(): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const bi of buildingInterfaces.values()) {
    const [w, s, e, n] = bi.boundingBox;
    if (w < minLng) minLng = w;
    if (s < minLat) minLat = s;
    if (e > maxLng) maxLng = e;
    if (n > maxLat) maxLat = n;
  }
  return [minLng, minLat, maxLng, maxLat];
}

export function getOutline(): number[][] {
  // Return first building's outline for backward compat
  const first = buildingInterfaces.values().next().value;
  if (!first) return [];
  const geom = first.feature.geometry;
  if (geom.type === 'MultiPolygon') return (geom as GeoJSON.MultiPolygon).coordinates[0][0];
  return (geom as GeoJSON.Polygon).coordinates[0];
}

/** All levels across all buildings, sorted descending */
export function getAllLevels(): number[] {
  const set = new Set<number>();
  for (const m of buildingManifests.values()) {
    for (const l of m.levels) set.add(l);
  }
  return [...set].sort((a, b) => b - a);
}

/** Levels for a specific building */
export function getBuildingLevels(building: string): number[] {
  const m = buildingManifests.get(building);
  return m ? [...m.levels].sort((a, b) => b - a) : [];
}

/** Merged level data across all buildings (backward compat) */
export function getLevelData(level: number): LevelData {
  const allRooms: GeoJSON.Feature[] = [];
  const allColliders: GeoJSON.Feature[] = [];
  const allWalls: GeoJSON.Feature[] = [];

  for (const cache of levelDataCaches.values()) {
    const data = cache.get(level);
    if (!data) continue;
    allRooms.push(...data.rooms.features);
    allColliders.push(...data.colliders.features);
    allWalls.push(...data.walls.features);
  }

  return {
    rooms: { type: 'FeatureCollection', features: allRooms },
    colliders: { type: 'FeatureCollection', features: allColliders },
    walls: { type: 'FeatureCollection', features: allWalls },
  };
}

/** Level data for a specific building */
export function getLevelDataForBuilding(building: string, level: number): LevelData {
  const cache = levelDataCaches.get(building);
  if (!cache) return { rooms: emptyFC(), colliders: emptyFC(), walls: emptyFC() };
  return cache.get(level) ?? { rooms: emptyFC(), colliders: emptyFC(), walls: emptyFC() };
}

/** Room features for a specific level (all buildings) */
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
  for (const [code, cache] of levelDataCaches) {
    const manifest = buildingManifests.get(code);
    if (!manifest) continue;
    for (const level of manifest.levels) {
      const data = cache.get(level);
      if (!data) continue;
      features.push(...data.rooms.features, ...data.colliders.features);
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Get room centroid by ref (searches all buildings) */
export function getRoomCentroid(ref: string): [number, number] | null {
  for (const cache of levelDataCaches.values()) {
    for (const data of cache.values()) {
      for (const f of data.rooms.features) {
        if (f.properties.ref !== ref) continue;
        if (f.properties._centroid) return f.properties._centroid as [number, number];
        if (f.geometry.type === 'Polygon') {
          const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
          const n = ring.length - 1;
          let sx = 0, sy = 0;
          for (let i = 0; i < n; i++) { sx += ring[i][0]; sy += ring[i][1]; }
          return [sx / n, sy / n];
        }
      }
    }
  }
  return null;
}

/** Get room polygon coordinates (outer ring) by ref */
export function getRoomPolygon(ref: string): number[][] | null {
  for (const cache of levelDataCaches.values()) {
    for (const data of cache.values()) {
      for (const f of data.rooms.features) {
        if (f.properties.ref !== ref) continue;
        if (f.geometry.type === 'Polygon') {
          return (f.geometry as GeoJSON.Polygon).coordinates[0];
        }
        if (f.geometry.type === 'MultiPolygon') {
          return (f.geometry as GeoJSON.MultiPolygon).coordinates[0][0];
        }
      }
    }
  }
  return null;
}

/** Get which level a room ref belongs to */
export function getRoomLevel(ref: string): number | null {
  const room = roomList.find(r => r.ref === ref);
  return room && room.level.length > 0 ? room.level[0] : null;
}

/** Search rooms by ref/name (all buildings) */
export function searchRooms(query: string): RoomListItem[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return roomList.filter(r =>
    r.ref.toLowerCase().startsWith(q) ||
    r.name.toLowerCase().includes(q) ||
    r.roomType.toLowerCase().startsWith(q)
  ).slice(0, 20);
}
