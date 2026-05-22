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

// ===== Video availability =====
// Which video files actually exist on the server (from GET /api/videos-list).
// Lets the walkthrough gray out missing clips instead of 404-ing and freezing.
let availableVideos: Set<string> | null = null;

export async function loadAvailableVideos(): Promise<void> {
  if (availableVideos) return; // already loaded
  try {
    const res = await fetch('/api/videos-list');
    if (!res.ok) return;
    const { files } = (await res.json()) as { files?: string[] };
    if (!Array.isArray(files)) return;
    // Store by basename — clips reference files flat (e.g. "slib_e_1_1e.mp4").
    availableVideos = new Set(files.map(f => f.split('/').pop() ?? f));
  } catch {
    // Leave null → isVideoAvailable assumes present (never a false "missing").
  }
}

export function isVideoAvailable(filename: string): boolean {
  if (!availableVideos) return true; // list unknown → assume present, never block
  return availableVideos.has(filename);
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

// ===== API mode: re-fetch GeoJSON from backend /api/geojson/all =====

interface BackendStateSnapshot {
  manifests: Map<string, BuildingManifest>;
  interfaces: Map<string, BuildingInterface>;
  caches: Map<string, Map<number, LevelData>>;
  codes: string[];
  constants: BuildingConstants;
  description: string;
  rooms: RoomListItem[];
  center: [number, number];
}

let localSnapshot: BackendStateSnapshot | null = null;

function snapshotCurrentState(): BackendStateSnapshot {
  return {
    manifests: new Map(buildingManifests),
    interfaces: new Map(buildingInterfaces),
    caches: new Map(levelDataCaches),
    codes: [...buildingCodes],
    constants: { ...buildingConstants },
    description: buildingDescription,
    rooms: [...roomList],
    center: [...mapCenter] as [number, number],
  };
}

function applySnapshot(s: BackendStateSnapshot): void {
  buildingManifests.clear(); s.manifests.forEach((v, k) => buildingManifests.set(k, v));
  buildingInterfaces.clear(); s.interfaces.forEach((v, k) => buildingInterfaces.set(k, v));
  levelDataCaches.clear(); s.caches.forEach((v, k) => levelDataCaches.set(k, v));
  buildingCodes = [...s.codes];
  buildingConstants = { ...s.constants };
  buildingDescription = s.description;
  roomList = [...s.rooms];
  mapCenter = [...s.center] as [number, number];
}

/**
 * Re-fetch all GeoJSON from the backend's /api/geojson/all endpoint and
 * rebuild the per-building / per-level caches in place. Snapshots the current
 * (locally-loaded) state on first call so `restoreLocalData()` can roll back.
 */
export async function fetchBackendDataFromApi(apiBase: string): Promise<void> {
  if (!localSnapshot) localSnapshot = snapshotCurrentState();

  const url = `${apiBase}/geojson/all`;
  const fc = await fetchJson<GeoJSON.FeatureCollection>(url);
  if (!fc || !Array.isArray(fc.features)) {
    throw new Error(`API geojson/all returned no features (${url})`);
  }

  // Partition features by _building / _level / _featureType
  type Bucket = { rooms: GeoJSON.Feature[]; colliders: GeoJSON.Feature[]; walls: GeoJSON.Feature[]; outline?: GeoJSON.Feature };
  const byBuilding = new Map<string, { outline?: GeoJSON.Feature; perLevel: Map<number, Bucket> }>();

  for (const f of fc.features) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const building = String(props._building ?? '');
    const featureType = String(props._featureType ?? '');
    const level = props._level === null || props._level === undefined ? null : Number(props._level);
    if (!building || !featureType) continue;

    let entry = byBuilding.get(building);
    if (!entry) { entry = { perLevel: new Map() }; byBuilding.set(building, entry); }

    if (featureType === 'outline') {
      entry.outline = f;
      continue;
    }
    if (level === null || Number.isNaN(level)) continue;

    let bucket = entry.perLevel.get(level);
    if (!bucket) {
      bucket = { rooms: [], colliders: [], walls: [] };
      entry.perLevel.set(level, bucket);
    }
    if (featureType === 'room') {
      // Frontend convention: room.properties.level may be a parsed array
      if (f.properties && (f.properties as any).level !== undefined) {
        (f.properties as any).level = extractLevels(String((f.properties as any).level));
      }
      bucket.rooms.push(f);
    } else if (featureType === 'collider') {
      if (f.properties && (f.properties as any).level !== undefined) {
        (f.properties as any).level = extractLevels(String((f.properties as any).level));
      }
      bucket.colliders.push(f);
    } else if (featureType === 'wall') {
      bucket.walls.push(f);
    }
  }

  // Replace state from the partitioned data
  buildingManifests.clear();
  buildingInterfaces.clear();
  levelDataCaches.clear();

  const newCodes: string[] = [];
  for (const [code, entry] of byBuilding.entries()) {
    newCodes.push(code);

    // Per-level data
    const cache = new Map<number, LevelData>();
    for (const [level, b] of entry.perLevel.entries()) {
      cache.set(level, {
        rooms: { type: 'FeatureCollection', features: b.rooms },
        colliders: { type: 'FeatureCollection', features: b.colliders },
        walls: { type: 'FeatureCollection', features: b.walls },
      });
    }
    levelDataCaches.set(code, cache);

    // Manifest: derived from level set + name from the local snapshot if available
    const sortedLevels = [...entry.perLevel.keys()].sort((a, b) => a - b);
    const localManifest = localSnapshot?.manifests.get(code);
    buildingManifests.set(code, {
      building: code,
      name: localManifest?.name ?? code,
      loc_ref: localManifest?.loc_ref ?? '',
      levels: sortedLevels,
    });

    // Interface: bbox from outline (if present), else from union of all coords
    const outline = entry.outline ?? localSnapshot?.interfaces.get(code)?.feature;
    if (outline) {
      const allCoords = extractAllCoords(outline.geometry);
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const [lng, lat] of allCoords) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
      buildingInterfaces.set(code, { boundingBox: [minLng, minLat, maxLng, maxLat], feature: outline });
    }
  }
  buildingCodes = newCodes.length > 0 ? newCodes : (localSnapshot?.codes ?? []);

  // Rebuild aggregate room list (same logic as fetchBackendData step 3)
  roomList = [];
  for (const code of buildingCodes) {
    const manifest = buildingManifests.get(code);
    const cache = levelDataCaches.get(code);
    if (!manifest || !cache) continue;
    for (const level of manifest.levels) {
      const data = cache.get(level);
      if (!data) continue;
      for (const f of data.rooms.features) {
        if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
        if (!f.properties || !(f.properties as any).ref) continue;
        const fLevels = Array.isArray((f.properties as any).level) ? (f.properties as any).level : [level];
        roomList.push({
          building: code,
          ref: (f.properties as any).ref,
          name: (f.properties as any).name ?? '',
          level: fLevels,
          roomType: (f.properties as any).room_type ?? '',
          featureId: String((f.properties as any)._idx ?? ''),
        });
      }
    }
  }

  // Recompute map center from union bbox
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const bi of buildingInterfaces.values()) {
    const [w, s, e, n] = bi.boundingBox;
    if (w < minLng) minLng = w;
    if (s < minLat) minLat = s;
    if (e > maxLng) maxLng = e;
    if (n > maxLat) maxLat = n;
  }
  if (Number.isFinite(minLng)) mapCenter = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

/** Restore the local-static GeoJSON state captured on the first API fetch. */
export function restoreLocalData(): boolean {
  if (!localSnapshot) return false;
  applySnapshot(localSnapshot);
  return true;
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

/**
 * All buildings' outline polygons as a single FeatureCollection. Each feature
 * carries `_building` in its properties so the consumer can filter/style by
 * building code. Used by IndoorLayer's footprints layer (rendered for
 * non-focused buildings in 3D mode).
 */
export function getAllBuildingOutlines(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [code, bi] of buildingInterfaces.entries()) {
    features.push({
      ...bi.feature,
      properties: { ...(bi.feature.properties ?? {}), _building: code },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Resolve which building owns a coordinate by point-in-polygon test against
 * each building's outline. Returns null if no outline contains it. Used by
 * the editor's per-building reset to filter graph nodes (whose `building`
 * field is the wing prefix "21|22|23|ENG1", not the building-code namespace).
 */
export function getBuildingForCoordinates(coords: [number, number]): string | null {
  const [lng, lat] = coords;
  for (const [code, bi] of buildingInterfaces.entries()) {
    const [w, s, e, n] = bi.boundingBox;
    if (lng < w || lng > e || lat < s || lat > n) continue;
    const geom = bi.feature.geometry;
    const rings: number[][][] = geom.type === 'Polygon'
      ? [(geom as GeoJSON.Polygon).coordinates[0]]
      : geom.type === 'MultiPolygon'
        ? (geom as GeoJSON.MultiPolygon).coordinates.map(p => p[0])
        : [];
    for (const ring of rings) {
      if (pointInRing(lng, lat, ring)) return code;
    }
  }
  return null;
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
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

function pointInGeometry(lng: number, lat: number, geom: GeoJSON.Geometry): boolean {
  if (geom.type === 'Polygon') {
    const rings = (geom as GeoJSON.Polygon).coordinates;
    if (rings.length === 0 || !pointInRing(lng, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(lng, lat, rings[i])) return false;
    }
    return true;
  }
  if (geom.type === 'MultiPolygon') {
    for (const poly of (geom as GeoJSON.MultiPolygon).coordinates) {
      if (poly.length === 0 || !pointInRing(lng, lat, poly[0])) continue;
      let inHole = false;
      for (let i = 1; i < poly.length; i++) {
        if (pointInRing(lng, lat, poly[i])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

/**
 * Indoor test: point falls inside a building outline OR inside any room /
 * collider polygon. Rooms can extend beyond the outline (overhangs,
 * balconies), and some indoor space is only covered by colliders (walls,
 * stairs, lifts), so neither check alone is sufficient.
 */
export function isPointIndoors(coords: [number, number]): boolean {
  const [lng, lat] = coords;
  if (getBuildingForCoordinates(coords) !== null) return true;
  for (const cache of levelDataCaches.values()) {
    for (const data of cache.values()) {
      for (const f of data.rooms.features) {
        if (pointInGeometry(lng, lat, f.geometry)) return true;
      }
      for (const f of data.colliders.features) {
        if (pointInGeometry(lng, lat, f.geometry)) return true;
      }
    }
  }
  return false;
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
