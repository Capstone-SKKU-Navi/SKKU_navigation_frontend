import maplibregl from 'maplibre-gl';
import { ROOM_COLORS } from '../models/types';
import * as BackendService from '../services/backendService';
import * as FloatingLabels from './floatingLabels';
import { MapConfig } from '../config/mapConfig';
import { polygonGeomCenter } from '../utils/polygonCenter';

/**
 * IndoorLayer — stacked multi-floor 3D indoor rendering (multi-building).
 *
 * Architecture:
 * - One GeoJSON source per (building, feature-type), merged across all levels.
 *   Each feature carries `_alt_base`, `_alt_top`, `_level` baked at load.
 * - Two fill-extrusion layers per (building, feature-type): `-active` (filtered
 *   to `_level == currentLevel`, full opacity) and `-below` (filtered to
 *   `_level < currentLevel`, low opacity). Level changes swap filters; no
 *   source rebuild needed.
 * - 2D mode swaps paint to constant 0 for base/height; 3D uses data-driven
 *   `['get','_alt_*']` expressions.
 *
 * 3D mode: active floor at full opacity, floors below translucent (active +
 * all-below stack). Floors above the active level are filtered out.
 *
 * 2D mode: only the active floor is visible; below layers hidden, walls
 * hidden, corridor outlines hidden (they overlap rooms).
 */

// ===== Configurable Heights =====
export const DEFAULT_FLOOR_HEIGHT = 8; // vertical spacing between floors
export const ROOM_THICKNESS = 3;       // how tall the room slab is
const WALL_EXTRA = 4;                  // wall extends this much above room top
const CORRIDOR_THICKNESS = 1.5;
const STAIRS_THICKNESS = 4;
const OUTLINE_LIFT = 0.3;              // extra lift for the room outline above the room top
const OUTLINE_THICKNESS_2D = 0.2;      // outline slab height in 2D mode

// Opacity
const ACTIVE_ROOM_OPACITY = 0.88;
const INACTIVE_ROOM_OPACITY = 0.3;
const ACTIVE_WALL_OPACITY = 0.35;
const INACTIVE_WALL_OPACITY = 0.1;
const ACTIVE_CORRIDOR_OPACITY = 0.6;
const INACTIVE_CORRIDOR_OPACITY = 0.15;
const ACTIVE_STAIRS_OPACITY = 0.7;
const INACTIVE_STAIRS_OPACITY = 0.25;
const ACTIVE_ROOM_OUTLINE_OPACITY = 0.75;
const ACTIVE_CORRIDOR_OUTLINE_OPACITY = 0.6;

// Colors
const DEFAULT_ROOM_COLOR = '#B0BEC5';
const CORRIDOR_COLOR = '#D5D0C8';
const WALL_COLOR = '#9E9E9E';
const OUTLINE_COLOR = '#546E7A';
const ROOM_OUTLINE_COLOR = '#1A237E';
const FOOTPRINT_COLOR = '#CFD8DC';      // flat fill for non-focused buildings in 3D
const FOOTPRINT_OUTLINE_COLOR = '#90A4AE';

const FOOTPRINTS_SOURCE = 'building-footprints';
const FOOTPRINTS_FILL_LAYER = 'building-footprints-fill';
const FOOTPRINTS_LINE_LAYER = 'building-footprints-line';

// Runtime properties baked into features for data-driven extrusion expressions.
// Stripped on the way out (handleRoomExport / publishCombined) so they don't
// leak into source-of-truth geojson files.
const RUNTIME_PROPS = ['_alt_base', '_alt_top', '_level'] as const;

// ===== State =====
let currentLevel = 1;
let is3DMode = false;
const addedBuildings = new Set<string>();

/** Camera-driven focus set (which buildings render full interior in 3D).
 *  Recomputed on every moveend. In 2D the focus rule is bypassed. */
let focusedBuildings: Set<string> = new Set();

/** Pin override — when set, takes precedence over camera-driven focus.
 *  Cleared by clearPinnedFocus(). Used by route + search flows. */
let pinnedBuildings: Set<string> | null = null;

/** Cached outline centroid per building (for "outside" fallback). Computed
 *  once when addIndoorLayers runs. */
const outlineCentroidCache = new Map<string, [number, number]>();

/** @deprecated Altitudes are baked into feature properties at load. Honoring
 *  this would require a global re-bake + refreshAll. There are no current
 *  callers; kept as a no-op stub for API stability. */
export function setFloorHeight(level: number, _height: number): void {
  void level;
  if (typeof console !== 'undefined') {
    console.warn('[IndoorLayer] setFloorHeight is deprecated and has no effect.');
  }
}

/** Get the base altitude for a given level. Iterates only EXISTING levels so
 *  non-existent floors (e.g. level 0 between B1 and L1) don't accumulate
 *  phantom height. Basement levels (negative) default to 0 height — they sit
 *  at the same base as ground floor so 3D stacking starts from L1 upward. */
export function getLevelBase(level: number): number {
  const levels = [...BackendService.getAllLevels()].sort((a, b) => a - b);
  let base = 0;
  for (const l of levels) {
    if (l >= level) break;
    const h = l < 0 ? 0 : DEFAULT_FLOOR_HEIGHT;
    base += h;
  }
  return base;
}

// ===== Bake helpers =====

type FeatureType = 'room' | 'stair' | 'corridor' | 'wall' | 'rooms-edge' | 'corridors-edge';

function altOffsets(featureType: FeatureType): { baseDelta: number; topDelta: number } {
  switch (featureType) {
    case 'room':           return { baseDelta: 0, topDelta: ROOM_THICKNESS };
    case 'stair':          return { baseDelta: 0, topDelta: STAIRS_THICKNESS };
    case 'corridor':       return { baseDelta: 0, topDelta: CORRIDOR_THICKNESS };
    case 'wall':           return { baseDelta: ROOM_THICKNESS, topDelta: ROOM_THICKNESS + WALL_EXTRA };
    case 'rooms-edge':     return { baseDelta: 0, topDelta: ROOM_THICKNESS + OUTLINE_LIFT };
    case 'corridors-edge': return { baseDelta: 0, topDelta: CORRIDOR_THICKNESS + OUTLINE_LIFT };
  }
}

/** Stamp `_alt_base`, `_alt_top`, `_level` on each feature. Idempotent. */
function bakeFeatureAltitudes(features: GeoJSON.Feature[], featureType: FeatureType, level: number): void {
  const base = getLevelBase(level);
  const { baseDelta, topDelta } = altOffsets(featureType);
  const altBase = base + baseDelta;
  const altTop = base + topDelta;
  for (const f of features) {
    const props = (f.properties ??= {}) as Record<string, unknown>;
    props._alt_base = altBase;
    props._alt_top = altTop;
    props._level = level;
  }
}

/** Shallow copy of feature with `_alt_base/_alt_top/_level` removed. Used by
 *  editor export/publish so saved geojson files stay clean. */
export function stripRuntimeProps(feature: GeoJSON.Feature): GeoJSON.Feature {
  if (!feature.properties) return feature;
  const props: Record<string, unknown> = { ...feature.properties };
  for (const k of RUNTIME_PROPS) delete props[k];
  return { ...feature, properties: props };
}

// ===== Public API =====

export function addIndoorLayers(map: maplibregl.Map): void {
  const levels = BackendService.getAllLevels();
  const positives = levels.filter(l => l > 0);
  currentLevel = positives.includes(1)
    ? 1
    : positives.length > 0
      ? Math.min(...positives)
      : levels[levels.length - 1] || 1;

  // Drop stale "already added" entries if a previous map style was wiped but
  // our Set survived. Without this, addBuildingLayers skips re-adding and the
  // map renders blank.
  for (const building of BackendService.getBuildingCodes()) {
    if (!addedBuildings.has(building)) continue;
    if (!map.getLayer(`${building}-rooms-active`) && !map.getLayer(`${building}-corridors-active`)) {
      addedBuildings.delete(building);
    }
  }

  // Footprints layer is shared across all buildings; add it before per-
  // building extrusions so it sits at the bottom of the z-stack. (For
  // focused buildings, the filter excludes them anyway.)
  addBuildingFootprintsLayer(map);

  for (const building of BackendService.getBuildingCodes()) {
    try {
      addBuildingLayers(map, building);
    } catch (e) {
      console.warn(`Layer init for ${building} failed:`, e);
    }
  }

  primeOutlineCentroidCache();

  applyVisibility(map);
}

/** Single fill (no extrusion) layer covering every building's outline. Visible
 *  only in 3D mode, filtered to non-focused buildings. Provides spatial
 *  context for buildings whose interior we're not rendering. */
function addBuildingFootprintsLayer(map: maplibregl.Map): void {
  if (map.getSource(FOOTPRINTS_SOURCE)) return;
  map.addSource(FOOTPRINTS_SOURCE, {
    type: 'geojson',
    data: BackendService.getAllBuildingOutlines(),
  });
  map.addLayer({
    id: FOOTPRINTS_FILL_LAYER,
    type: 'fill',
    source: FOOTPRINTS_SOURCE,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': FOOTPRINT_COLOR,
      'fill-opacity': 0.55,
    },
  });
  map.addLayer({
    id: FOOTPRINTS_LINE_LAYER,
    type: 'line',
    source: FOOTPRINTS_SOURCE,
    layout: { visibility: 'none' },
    paint: {
      'line-color': FOOTPRINT_OUTLINE_COLOR,
      'line-width': 1.2,
      'line-opacity': 0.9,
    },
  });
}

function applyFootprintsFilter(map: maplibregl.Map): void {
  if (!map.getLayer(FOOTPRINTS_FILL_LAYER)) return;
  if (!is3DMode) {
    setLayerVis(map, FOOTPRINTS_FILL_LAYER, 'none');
    setLayerVis(map, FOOTPRINTS_LINE_LAYER, 'none');
    return;
  }
  const focused = [...effectiveFocusSet()];
  const excludeFilter: any = ['!', ['in', ['get', '_building'], ['literal', focused]]];
  map.setFilter(FOOTPRINTS_FILL_LAYER, excludeFilter);
  map.setFilter(FOOTPRINTS_LINE_LAYER, excludeFilter);
  setLayerVis(map, FOOTPRINTS_FILL_LAYER, 'visible');
  setLayerVis(map, FOOTPRINTS_LINE_LAYER, 'visible');
}

export function getCurrentLevel(): number {
  return currentLevel;
}

/** Switch active level — swaps filter expressions across per-building layers. */
export function setVisibleLevel(map: maplibregl.Map, level: number): void {
  currentLevel = level;
  applyVisibility(map);
}

/** Switch between 2D (flat) and 3D (stacked). */
export function setExtrusionHeight(map: maplibregl.Map, enable3D: boolean): void {
  is3DMode = enable3D;
  applyVisibility(map);
}

/** Highlight a room by ref across all buildings' active+below room layers. */
export function highlightRoom(map: maplibregl.Map, ref: string | null): void {
  for (const building of BackendService.getBuildingCodes()) {
    for (const variant of ['active', 'below'] as const) {
      const layerId = `${building}-rooms-${variant}`;
      if (!map.getLayer(layerId)) continue;

      if (ref) {
        map.setPaintProperty(layerId, 'fill-extrusion-color', [
          'case',
          ['==', ['get', 'ref'], ref],
          '#FF6F03',
          buildRoomColorExpression(),
        ] as any);
      } else {
        map.setPaintProperty(layerId, 'fill-extrusion-color', buildRoomColorExpression());
      }
    }
  }
}

type LayerGroup = 'rooms' | 'corridors' | 'walls' | 'labels';
const disabledGroups = new Set<LayerGroup>();

/** Toggle visibility for a layer group, then re-apply normal visibility rules. */
export function setLayerGroupVisibility(
  map: maplibregl.Map,
  group: LayerGroup,
  visible: boolean,
): void {
  if (visible) {
    disabledGroups.delete(group);
  } else {
    disabledGroups.add(group);
  }
  applyVisibility(map);
}

/** Get which level a room ref belongs to. */
export function getRoomLevel(ref: string): number | null {
  const rooms = BackendService.getRoomList();
  const room = rooms.find(r => r.ref === ref);
  return room && room.level.length > 0 ? room.level[0] : null;
}

/**
 * Recompute camera-driven focus from the map's current center. If the camera
 * target sits inside a building outline → that building. If not, fall back to
 * the nearest building by outline-centroid Euclidean distance. Cheap; called
 * on `moveend`. While pinned, the camera-driven set is still updated so that
 * unpinning snaps to the right place, but applyVisibility ignores it.
 */
export function updateCameraFocus(map: maplibregl.Map): void {
  const center = map.getCenter();
  const coord: [number, number] = [center.lng, center.lat];
  let target = BackendService.getBuildingForCoordinates(coord);
  if (!target) {
    target = nearestBuildingByCentroid(coord);
  }
  const next = new Set<string>();
  if (target) next.add(target);

  // Skip the visibility re-apply if nothing changed (avoids redundant work
  // on moveend when the user pans within the same building).
  if (setsEqual(next, focusedBuildings)) return;
  focusedBuildings = next;
  applyVisibility(map);
}

/** Pin focus to a specific set of buildings (route active / search result).
 *  Takes precedence over camera-driven focus until cleared. */
export function setPinnedFocus(map: maplibregl.Map, buildings: Iterable<string>): void {
  const next = new Set(buildings);
  if (pinnedBuildings && setsEqual(next, pinnedBuildings)) return;
  pinnedBuildings = next;
  applyVisibility(map);
}

/** Clear the pin and re-apply (camera-driven focus takes over). */
export function clearPinnedFocus(map: maplibregl.Map): void {
  if (pinnedBuildings === null) return;
  pinnedBuildings = null;
  applyVisibility(map);
}

/** Diagnostic: read the current effective focus set. */
export function getFocusedBuildings(): ReadonlySet<string> {
  return effectiveFocusSet();
}

/** Effective focus precedence: pin > camera > all. */
function effectiveFocusSet(): Set<string> {
  if (pinnedBuildings && pinnedBuildings.size > 0) return pinnedBuildings;
  if (focusedBuildings.size > 0) return focusedBuildings;
  // Initial state — focus not yet computed; allow all buildings to render.
  return new Set(BackendService.getBuildingCodes());
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function nearestBuildingByCentroid(coord: [number, number]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [code, c] of outlineCentroidCache) {
    const dx = c[0] - coord[0];
    const dy = c[1] - coord[1];
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = code;
    }
  }
  return best;
}

function primeOutlineCentroidCache(): void {
  outlineCentroidCache.clear();
  // Build a lookup from the single getAllBuildingOutlines() call so we don't
  // reconstruct the FeatureCollection once per building (O(n²) → O(n)).
  const fc = BackendService.getAllBuildingOutlines();
  for (const f of fc.features) {
    const code = (f.properties as any)?._building as string | undefined;
    if (!code) continue;
    const center = polygonGeomCenter(f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);
    outlineCentroidCache.set(code, center);
  }
}

/** Query the topmost room feature under the given screen point. */
export function queryRoomAt(
  map: maplibregl.Map,
  point: { x: number; y: number },
  radiusPx: number = 12,
): { ref: string; name: string; roomType: string; level: number; lngLat: [number, number] } | null {
  const layerIds: string[] = [];
  for (const building of BackendService.getBuildingCodes()) {
    const id = `${building}-rooms-active`;
    if (map.getLayer(id)) layerIds.push(id);
  }
  if (layerIds.length === 0) return null;

  const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
    [point.x - radiusPx, point.y - radiusPx],
    [point.x + radiusPx, point.y + radiusPx],
  ];

  const features = map.queryRenderedFeatures(bbox, { layers: layerIds });
  if (!features || features.length === 0) return null;

  const f = features[0];
  const ref = f.properties?.ref;
  if (!ref) return null;

  const lngLat = polygonGeomCenter(f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);

  return {
    ref,
    name: f.properties?.name ?? '',
    roomType: f.properties?.room_type ?? '',
    level: currentLevel,
    lngLat,
  };
}

// ===== Core: apply visibility + heights based on mode =====

function applyVisibility(map: maplibregl.Map): void {
  for (const building of BackendService.getBuildingCodes()) {
    try {
      applyBuildingVisibility(map, building);
    } catch (e) {
      console.warn(`applyVisibility error for ${building}:`, e);
    }
  }

  applyFootprintsFilter(map);

  if (is3DMode) {
    const altitude = getLevelBase(currentLevel) + ROOM_THICKNESS + 0.5;
    FloatingLabels.updateLabels(currentLevel, true, altitude);
  } else {
    FloatingLabels.updateLabels(currentLevel, false, 0);
  }
}

function groupVis(group: LayerGroup, modeVis: string): string {
  return disabledGroups.has(group) ? 'none' : modeVis;
}

function applyBuildingVisibility(map: maplibregl.Map, building: string): void {
  const activeFilter: any = ['==', ['get', '_level'], currentLevel];
  const belowFilter: any = ['<', ['get', '_level'], currentLevel];

  // Update filters on every layer (sub-frame cost; doesn't re-tessellate).
  const activeLayers = [
    `${building}-rooms-active`,
    `${building}-rooms-edges-active`,
    `${building}-corridors-active`,
    `${building}-corridors-edges-active`,
    `${building}-stairs-active`,
    `${building}-walls-active`,
    `${building}-rooms-labels`,
  ];
  for (const id of activeLayers) {
    if (map.getLayer(id)) map.setFilter(id, activeFilter);
  }
  const belowLayers = [
    `${building}-rooms-below`,
    `${building}-rooms-edges-below`,
    `${building}-corridors-below`,
    `${building}-corridors-edges-below`,
    `${building}-stairs-below`,
    `${building}-walls-below`,
  ];
  for (const id of belowLayers) {
    if (map.getLayer(id)) map.setFilter(id, belowFilter);
  }

  if (is3DMode) {
    // In 3D, only "focused" buildings render their interior. Non-focused
    // buildings are hidden entirely — the building-footprints layer (added
    // in Phase 3) will surface them as flat outlines for spatial context.
    const focused = effectiveFocusSet().has(building);

    setLayerVis(map, `${building}-rooms-active`,            focused ? groupVis('rooms', 'visible') : 'none');
    setLayerVis(map, `${building}-rooms-below`,             focused ? groupVis('rooms', 'visible') : 'none');
    setLayerVis(map, `${building}-rooms-edges-active`,      focused ? groupVis('rooms', 'visible') : 'none');
    setLayerVis(map, `${building}-rooms-edges-below`,       'none');                        // outlines only on active level
    setLayerVis(map, `${building}-corridors-active`,        focused ? groupVis('corridors', 'visible') : 'none');
    setLayerVis(map, `${building}-corridors-below`,         focused ? groupVis('corridors', 'visible') : 'none');
    setLayerVis(map, `${building}-corridors-edges-active`,  focused ? groupVis('corridors', 'visible') : 'none');
    setLayerVis(map, `${building}-corridors-edges-below`,   'none');
    setLayerVis(map, `${building}-stairs-active`,           focused ? groupVis('rooms', 'visible') : 'none');
    setLayerVis(map, `${building}-stairs-below`,            focused ? groupVis('rooms', 'visible') : 'none');
    setLayerVis(map, `${building}-walls-active`,            focused ? groupVis('walls', 'visible') : 'none');
    setLayerVis(map, `${building}-walls-below`,             focused ? groupVis('walls', 'visible') : 'none');
    setLayerVis(map, `${building}-rooms-labels`,            'none');                        // FloatingLabels handles 3D

    if (focused) setExtrusionPaint(map, building);
  } else {
    setLayerVis(map, `${building}-rooms-active`,            groupVis('rooms', 'visible'));
    setLayerVis(map, `${building}-rooms-below`,             'none');
    setLayerVis(map, `${building}-rooms-edges-active`,      groupVis('rooms', 'visible'));
    setLayerVis(map, `${building}-rooms-edges-below`,       'none');
    setLayerVis(map, `${building}-corridors-active`,        groupVis('corridors', 'visible'));
    setLayerVis(map, `${building}-corridors-below`,         'none');
    setLayerVis(map, `${building}-corridors-edges-active`,  'none');                        // hide corridor outlines in 2D — they overlap rooms
    setLayerVis(map, `${building}-corridors-edges-below`,   'none');
    setLayerVis(map, `${building}-stairs-active`,           groupVis('rooms', 'visible'));
    setLayerVis(map, `${building}-stairs-below`,            'none');
    setLayerVis(map, `${building}-walls-active`,            'none');                        // no walls in 2D
    setLayerVis(map, `${building}-walls-below`,             'none');
    setLayerVis(map, `${building}-rooms-labels`,            groupVis('labels', 'visible'));

    setFlatPaint(map, building);
  }
}

function setExtrusionPaint(map: maplibregl.Map, building: string): void {
  const setLayer = (id: string, opacity: number) => {
    if (!map.getLayer(id)) return;
    map.setPaintProperty(id, 'fill-extrusion-base', ['get', '_alt_base'] as any);
    map.setPaintProperty(id, 'fill-extrusion-height', ['get', '_alt_top'] as any);
    map.setPaintProperty(id, 'fill-extrusion-opacity', opacity);
  };
  setLayer(`${building}-rooms-active`,           ACTIVE_ROOM_OPACITY);
  setLayer(`${building}-rooms-below`,            INACTIVE_ROOM_OPACITY);
  setLayer(`${building}-corridors-active`,       ACTIVE_CORRIDOR_OPACITY);
  setLayer(`${building}-corridors-below`,        INACTIVE_CORRIDOR_OPACITY);
  setLayer(`${building}-stairs-active`,          ACTIVE_STAIRS_OPACITY);
  setLayer(`${building}-stairs-below`,           INACTIVE_STAIRS_OPACITY);
  setLayer(`${building}-walls-active`,           ACTIVE_WALL_OPACITY);
  setLayer(`${building}-walls-below`,            INACTIVE_WALL_OPACITY);
  setLayer(`${building}-rooms-edges-active`,     ACTIVE_ROOM_OUTLINE_OPACITY);
  setLayer(`${building}-rooms-edges-below`,      ACTIVE_ROOM_OUTLINE_OPACITY);  // hidden anyway
  setLayer(`${building}-corridors-edges-active`, ACTIVE_CORRIDOR_OUTLINE_OPACITY);
  setLayer(`${building}-corridors-edges-below`,  ACTIVE_CORRIDOR_OUTLINE_OPACITY); // hidden anyway
}

function setFlatPaint(map: maplibregl.Map, building: string): void {
  const setFlat = (id: string, height: number, opacity: number) => {
    if (!map.getLayer(id)) return;
    map.setPaintProperty(id, 'fill-extrusion-base', 0);
    map.setPaintProperty(id, 'fill-extrusion-height', height);
    map.setPaintProperty(id, 'fill-extrusion-opacity', opacity);
  };
  setFlat(`${building}-rooms-active`,           0,                     ACTIVE_ROOM_OPACITY);
  setFlat(`${building}-corridors-active`,       0,                     ACTIVE_CORRIDOR_OPACITY);
  setFlat(`${building}-stairs-active`,          0,                     ACTIVE_STAIRS_OPACITY);
  setFlat(`${building}-rooms-edges-active`,     OUTLINE_THICKNESS_2D,  ACTIVE_ROOM_OUTLINE_OPACITY);
  // walls + corridors-edges hidden in 2D; below layers hidden — no paint needed.
}

// ===== Helpers =====

function setLayerVis(map: maplibregl.Map, layerId: string, vis: string): void {
  try {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', vis);
    }
  } catch (_) { /* layer not ready */ }
}

// ===== Layer creation per building =====

function addBuildingLayers(map: maplibregl.Map, building: string): void {
  if (addedBuildings.has(building)) return;
  addedBuildings.add(building);

  const merged = collectMergedBuildingData(building);

  // Add order matters for paint stacking (later = on top in z-order). This
  // mirrors the order used by the previous per-(building, level) impl:
  //   corridors → corridors-edges → rooms → stairs → rooms-edges → walls → labels

  if (merged.corridors.length > 0) {
    map.addSource(`${building}-corridors`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: merged.corridors },
    });
    addExtrusionLayerPair(map, building, 'corridors', CORRIDOR_COLOR, true);

    if (merged.corridorEdges.length > 0) {
      map.addSource(`${building}-corridors-edges`, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: merged.corridorEdges },
      });
      addExtrusionLayerPair(map, building, 'corridors-edges', OUTLINE_COLOR, false);
    }
  }

  if (merged.rooms.length > 0) {
    map.addSource(`${building}-rooms`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: merged.rooms },
    });
    addExtrusionLayerPair(map, building, 'rooms', buildRoomColorExpression(), true);
  }

  if (merged.stairs.length > 0) {
    map.addSource(`${building}-stairs`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: merged.stairs },
    });
    addExtrusionLayerPair(map, building, 'stairs', ROOM_COLORS.stairs, true);
  }

  if (merged.roomEdges.length > 0) {
    map.addSource(`${building}-rooms-edges`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: merged.roomEdges },
    });
    addExtrusionLayerPair(map, building, 'rooms-edges', ROOM_OUTLINE_COLOR, false);
  }

  // Walls — last (paint on top of everything else). Source is union(rooms,
  // corridors, stairs) per level, with each feature's _alt_base/_alt_top set
  // to (roomTop, wallTop). The standalone _wall_L*.geojson files are NOT
  // used in rendering (matches the prior per-level impl's union approach).
  if (merged.walls.length > 0) {
    map.addSource(`${building}-walls`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: merged.walls },
    });
    addExtrusionLayerPair(map, building, 'walls', WALL_COLOR, true);
  }

  // Labels — separate symbol layer, single (no active/below split). Filter
  // by `_level == currentLevel` (text-opacity is data-driven but the simple
  // filter is enough since we only ever show labels on the active floor).
  if (merged.labelPoints.length > 0) {
    map.addSource(`${building}-rooms-labelpts`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: merged.labelPoints },
    });
    map.addLayer({
      id: `${building}-rooms-labels`,
      type: 'symbol',
      source: `${building}-rooms-labelpts`,
      minzoom: MapConfig.labelMinZoom,
      filter: ['==', ['get', '_level'], currentLevel] as any,
      layout: {
        visibility: 'none',
        'text-field': ['get', 'ref'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          19.5, 9, 20, 12, 20.5, 14, 21, 16,
        ],
        'text-font': ['Noto Sans Regular'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#263238',
        'text-halo-color': 'rgba(255,255,255,0.85)',
        'text-halo-width': 1.5,
      },
    });
  }
}

interface MergedBuildingData {
  rooms: GeoJSON.Feature[];
  stairs: GeoJSON.Feature[];
  corridors: GeoJSON.Feature[];
  walls: GeoJSON.Feature[];
  roomEdges: GeoJSON.Feature[];
  corridorEdges: GeoJSON.Feature[];
  labelPoints: GeoJSON.Feature[];
}

/**
 * Walk every level of `building` from BackendService, classify features, bake
 * altitudes in-place, and accumulate per-feature-type arrays for the merged
 * sources. Edge polygons and label points are built fresh on every call.
 */
function collectMergedBuildingData(building: string): MergedBuildingData {
  const out: MergedBuildingData = {
    rooms: [],
    stairs: [],
    corridors: [],
    walls: [],
    roomEdges: [],
    corridorEdges: [],
    labelPoints: [],
  };

  const levels = BackendService.getBuildingLevels(building);
  for (const level of levels) {
    const data = BackendService.getLevelDataForBuilding(building, level);

    const levelRooms: GeoJSON.Feature[] = [];
    const levelStairs: GeoJSON.Feature[] = [];
    for (const f of data.rooms.features) {
      if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
      const rt = f.properties?.room_type;
      if (rt === 'stairs' || rt === 'elevator') levelStairs.push(f);
      else levelRooms.push(f);
    }

    const levelCorridors = data.colliders.features.filter(
      f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'
    );

    bakeFeatureAltitudes(levelRooms, 'room', level);
    bakeFeatureAltitudes(levelStairs, 'stair', level);
    bakeFeatureAltitudes(levelCorridors, 'corridor', level);

    const levelRoomEdges = buildEdgePolygons([...levelRooms, ...levelStairs]);
    const levelCorridorEdges = buildEdgePolygons(levelCorridors);
    bakeFeatureAltitudes(levelRoomEdges, 'rooms-edge', level);
    bakeFeatureAltitudes(levelCorridorEdges, 'corridors-edge', level);

    // Walls source: union(rooms, corridors, stairs). Build shallow copies so
    // bakeFeatureAltitudes('wall', ...) doesn't overwrite the underlying
    // feature's per-feature-type bake (the same room object lives in both
    // the rooms source and the walls source).
    const levelWalls: GeoJSON.Feature[] = [];
    for (const f of [...levelRooms, ...levelCorridors, ...levelStairs]) {
      levelWalls.push({
        type: 'Feature',
        properties: { ...(f.properties ?? {}) },
        geometry: f.geometry,
      });
    }
    bakeFeatureAltitudes(levelWalls, 'wall', level);

    const levelLabels = buildLabelPoints(levelRooms);
    for (const lp of levelLabels) {
      const props = (lp.properties ??= {}) as Record<string, unknown>;
      props._level = level;
    }

    out.rooms.push(...levelRooms);
    out.stairs.push(...levelStairs);
    out.corridors.push(...levelCorridors);
    out.walls.push(...levelWalls);
    out.roomEdges.push(...levelRoomEdges);
    out.corridorEdges.push(...levelCorridorEdges);
    out.labelPoints.push(...levelLabels);
  }

  return out;
}

function addExtrusionLayerPair(
  map: maplibregl.Map,
  building: string,
  featureType: 'rooms' | 'rooms-edges' | 'corridors' | 'corridors-edges' | 'stairs' | 'walls',
  color: any,
  useGradient: boolean,
): void {
  const sourceId = `${building}-${featureType}`;

  const paint: Record<string, unknown> = {
    'fill-extrusion-color': color,
    'fill-extrusion-height': 0,
    'fill-extrusion-base': 0,
    'fill-extrusion-opacity': 0,
  };
  if (useGradient) paint['fill-extrusion-vertical-gradient'] = true;

  // -below (added first so -active paints on top in z-order)
  map.addLayer({
    id: `${building}-${featureType}-below`,
    type: 'fill-extrusion',
    source: sourceId,
    filter: ['<', ['get', '_level'], currentLevel] as any,
    layout: { visibility: 'none' },
    paint: paint as any,
  });

  map.addLayer({
    id: `${building}-${featureType}-active`,
    type: 'fill-extrusion',
    source: sourceId,
    filter: ['==', ['get', '_level'], currentLevel] as any,
    layout: { visibility: 'none' },
    paint: paint as any,
  });
}

function buildRoomColorExpression(): maplibregl.ExpressionSpecification {
  const entries: string[] = [];
  for (const [type, color] of Object.entries(ROOM_COLORS)) {
    if (type === 'corridor' || type === 'elevator') continue;
    entries.push(type, color);
  }
  return [
    'match', ['get', 'room_type'],
    ...entries,
    DEFAULT_ROOM_COLOR,
  ] as unknown as maplibregl.ExpressionSpecification;
}

// ===== Label point builder =====

function buildLabelPoints(rooms: GeoJSON.Feature[]): GeoJSON.Feature[] {
  return rooms.map(room => {
    const props = room.properties ?? {};
    const pos: [number, number] = (props as any)._label_pos
      ? [(props as any)._label_pos[0], (props as any)._label_pos[1]]
      : (props as any)._centroid
        ? [(props as any)._centroid[0], (props as any)._centroid[1]]
        : polygonGeomCenter(room.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);

    return {
      type: 'Feature' as const,
      properties: { ...props },
      geometry: { type: 'Point' as const, coordinates: pos },
    };
  });
}

/**
 * Rebuild every per-building merged source from the current BackendService
 * state. Used when the GeoJSON dataset has been replaced (e.g. after toggling
 * to API mode and re-fetching from /api/geojson/all).
 */
export function refreshAll(map: maplibregl.Map): void {
  for (const building of BackendService.getBuildingCodes()) {
    rebuildBuildingSources(map, building);
  }
  // BackendService.buildingInterfaces is replaced wholesale on API-mode
  // toggles, so refresh the footprints source from the new outlines and
  // re-prime the centroid cache for the "outside" fallback.
  const footprintSource = map.getSource(FOOTPRINTS_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (footprintSource) footprintSource.setData(BackendService.getAllBuildingOutlines());
  primeOutlineCentroidCache();
}

/**
 * Rebuild the merged sources for any building owning the given level. Building-
 * level dedup avoids 5–8x rebuild during restoreRoomEditsFromSnapshot when
 * several touched levels belong to the same building.
 */
export function refreshRoomLabels(map: maplibregl.Map, level: number): void {
  const buildings = new Set<string>();
  for (const building of BackendService.getBuildingCodes()) {
    if (BackendService.getBuildingLevels(building).includes(level)) {
      buildings.add(building);
    }
  }
  for (const b of buildings) {
    rebuildBuildingSources(map, b);
  }
}

function rebuildBuildingSources(map: maplibregl.Map, building: string): void {
  const merged = collectMergedBuildingData(building);
  const setSource = (id: string, fc: GeoJSON.FeatureCollection) => {
    const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(fc);
  };
  setSource(`${building}-corridors`,       { type: 'FeatureCollection', features: merged.corridors });
  setSource(`${building}-corridors-edges`, { type: 'FeatureCollection', features: merged.corridorEdges });
  setSource(`${building}-rooms`,           { type: 'FeatureCollection', features: merged.rooms });
  setSource(`${building}-rooms-edges`,     { type: 'FeatureCollection', features: merged.roomEdges });
  setSource(`${building}-rooms-labelpts`,  { type: 'FeatureCollection', features: merged.labelPoints });
  setSource(`${building}-stairs`,          { type: 'FeatureCollection', features: merged.stairs });
  setSource(`${building}-walls`,           { type: 'FeatureCollection', features: merged.walls });
}

// ===== Edge geometry builder =====
// Converts polygons into thin rectangular strips along each edge so they
// can be rendered as fill-extrusion at the correct floor altitude.

const EDGE_THICKNESS = 0.000003; // ~0.3m in degrees at SKKU latitude

function buildEdgePolygons(rooms: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const edges: GeoJSON.Feature[] = [];

  for (const room of rooms) {
    const geom = room.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    const rings = geom.type === 'Polygon'
      ? [geom.coordinates[0]]
      : geom.coordinates.map(c => c[0]);

    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];

        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-9) continue;

        const nx = (-dy / len) * EDGE_THICKNESS;
        const ny = (dx / len) * EDGE_THICKNESS;

        edges.push({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [a[0] - nx, a[1] - ny],
              [a[0] + nx, a[1] + ny],
              [b[0] + nx, b[1] + ny],
              [b[0] - nx, b[1] - ny],
              [a[0] - nx, a[1] - ny],
            ]],
          },
        });
      }
    }
  }

  return edges;
}
