import maplibregl from 'maplibre-gl';
import { ROOM_COLORS } from '../models/types';
import * as BackendService from '../services/backendService';
import * as FloatingLabels from './floatingLabels';
import { MapConfig } from '../config/mapConfig';

/**
 * IndoorLayer — stacked multi-floor 3D indoor rendering (multi-building)
 *
 * 3D mode: ALL floors visible simultaneously, stacked vertically.
 *   - Active floor: full opacity
 *   - Floors below active: translucent
 *   - Floors above active: hidden (so you can look down into the building)
 *
 * 2D mode: single floor, flat (pitch 0).
 */

// ===== Configurable Heights =====
// Per-floor vertical height (meters in extrusion space)
export const DEFAULT_FLOOR_HEIGHT = 8; // vertical spacing between floors
export const ROOM_THICKNESS = 3;       // how tall the room slab is
const WALL_EXTRA = 4;           // wall extends this much above room top
const CORRIDOR_THICKNESS = 1.5;
const STAIRS_THICKNESS = 4;

// Opacity
const ACTIVE_ROOM_OPACITY = 0.88;
const INACTIVE_ROOM_OPACITY = 0.3;
const ACTIVE_WALL_OPACITY = 0.35;
const INACTIVE_WALL_OPACITY = 0.1;
const ACTIVE_CORRIDOR_OPACITY = 0.6;
const INACTIVE_CORRIDOR_OPACITY = 0.15;

// Colors
const DEFAULT_ROOM_COLOR = '#B0BEC5';
const CORRIDOR_COLOR = '#D5D0C8';
const WALL_COLOR = '#9E9E9E';
const OUTLINE_COLOR = '#546E7A';

// ===== State =====
let currentLevel = 1;
let is3DMode = false;
const addedBuildingLevels = new Set<string>(); // "eng1-1", "eng1-2", etc.

// Per-building floor height config (can be customized)
let floorHeights: Map<number, number> = new Map(); // level -> height override

/** Set custom height for a specific floor */
export function setFloorHeight(level: number, height: number): void {
  floorHeights.set(level, height);
}

/** Get the base altitude for a given level */
export function getLevelBase(level: number): number {
  const levels = BackendService.getAllLevels(); // [5,4,3,2,1] descending
  const minLevel = Math.min(...levels);

  let base = 0;
  for (let l = minLevel; l < level; l++) {
    base += floorHeights.get(l) ?? DEFAULT_FLOOR_HEIGHT;
  }
  return base;
}

// ===== Public API =====

export function addIndoorLayers(map: maplibregl.Map): void {
  const levels = BackendService.getAllLevels();
  currentLevel = levels[levels.length - 1] || 1; // start at lowest

  for (const building of BackendService.getBuildingCodes()) {
    const bLevels = BackendService.getBuildingLevels(building);
    for (const level of bLevels) {
      try {
        addBuildingLevelLayers(map, building, level);
      } catch (e) {
        console.warn(`Layer init for ${building} level ${level} failed:`, e);
      }
    }
  }

  // Initial state: 2D mode, show only current level flat
  applyVisibility(map);
}

export function getCurrentLevel(): number {
  return currentLevel;
}

/** Switch active level */
export function setVisibleLevel(map: maplibregl.Map, level: number): void {
  currentLevel = level;
  applyVisibility(map);
}

/** Switch between 2D (flat) and 3D (stacked) */
export function setExtrusionHeight(map: maplibregl.Map, enable3D: boolean): void {
  is3DMode = enable3D;
  applyVisibility(map);
}

/** Highlight a room by ref */
export function highlightRoom(map: maplibregl.Map, ref: string | null): void {
  for (const building of BackendService.getBuildingCodes()) {
    const levels = BackendService.getBuildingLevels(building);
    for (const l of levels) {
      const layerId = `${building}-floor-${l}-rooms-3d`;
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

/** Toggle visibility for a layer group, then re-apply normal visibility rules */
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

/** Get which level a room ref belongs to */
export function getRoomLevel(ref: string): number | null {
  const rooms = BackendService.getRoomList();
  const room = rooms.find(r => r.ref === ref);
  return room && room.level.length > 0 ? room.level[0] : null;
}

// ===== Core: apply visibility + heights based on mode =====

function applyVisibility(map: maplibregl.Map): void {
  for (const building of BackendService.getBuildingCodes()) {
    const bLevels = BackendService.getBuildingLevels(building);
    for (const level of bLevels) {
      try {
        applyBuildingLevelVisibility(map, building, level);
      } catch (e) {
        console.warn(`applyVisibility error for ${building} level ${level}:`, e);
      }
    }
  }

  // Update floating labels — 3D: show at altitude, 2D: clear (symbol layer takes over)
  if (is3DMode) {
    const altitude = getLevelBase(currentLevel) + ROOM_THICKNESS + 0.5;
    FloatingLabels.updateLabels(currentLevel, true, altitude);
  } else {
    FloatingLabels.updateLabels(currentLevel, false, 0);
  }
}

/** Resolve visibility: 'none' if group is disabled, otherwise use the mode-based value */
function groupVis(group: LayerGroup, modeVis: string): string {
  return disabledGroups.has(group) ? 'none' : modeVis;
}

function applyBuildingLevelVisibility(map: maplibregl.Map, building: string, level: number): void {
  const prefix = `${building}-floor-${level}`;
  const base = is3DMode ? getLevelBase(level) : 0;
  const isActive = level === currentLevel;
  const isBelow = level < currentLevel;

  if (is3DMode) {
    // 3D stacked mode: show active + below, hide above
    const show = isActive || isBelow;
    const vis = show ? 'visible' : 'none';

    setLayerVis(map, `${prefix}-rooms-3d`, groupVis('rooms', vis));
    setLayerVis(map, `${prefix}-rooms-outline`, groupVis('rooms', isActive ? 'visible' : 'none'));
    setLayerVis(map, `${prefix}-rooms-labels`, 'none'); // hidden in 3D — FloatingLabels handles this
    setLayerVis(map, `${prefix}-corridors-3d`, groupVis('corridors', vis));
    setLayerVis(map, `${prefix}-corridors-outline`, groupVis('corridors', isActive ? 'visible' : 'none'));
    setLayerVis(map, `${prefix}-stairs-3d`, groupVis('rooms', vis));
    setLayerVis(map, `${prefix}-walls-3d`, groupVis('walls', vis));

    if (show) {
      const roomTop = base + ROOM_THICKNESS;
      const wallTop = base + ROOM_THICKNESS + WALL_EXTRA;

      setPaint(map, `${prefix}-rooms-3d`, 'fill-extrusion-base', base);
      setPaint(map, `${prefix}-rooms-3d`, 'fill-extrusion-height', roomTop);
      setPaint(map, `${prefix}-rooms-3d`, 'fill-extrusion-opacity',
        isActive ? ACTIVE_ROOM_OPACITY : INACTIVE_ROOM_OPACITY);

      setPaint(map, `${prefix}-rooms-outline`, 'fill-extrusion-base', base);
      setPaint(map, `${prefix}-rooms-outline`, 'fill-extrusion-height', roomTop + 0.3);
      setPaint(map, `${prefix}-rooms-outline`, 'fill-extrusion-opacity', 0.75);

      setPaint(map, `${prefix}-corridors-3d`, 'fill-extrusion-base', base);
      setPaint(map, `${prefix}-corridors-3d`, 'fill-extrusion-height', base + CORRIDOR_THICKNESS);
      setPaint(map, `${prefix}-corridors-3d`, 'fill-extrusion-opacity',
        isActive ? ACTIVE_CORRIDOR_OPACITY : INACTIVE_CORRIDOR_OPACITY);

      setPaint(map, `${prefix}-corridors-outline`, 'fill-extrusion-base', base);
      setPaint(map, `${prefix}-corridors-outline`, 'fill-extrusion-height', base + CORRIDOR_THICKNESS + 0.3);
      setPaint(map, `${prefix}-corridors-outline`, 'fill-extrusion-opacity', 0.6);

      setPaint(map, `${prefix}-stairs-3d`, 'fill-extrusion-base', base);
      setPaint(map, `${prefix}-stairs-3d`, 'fill-extrusion-height', base + STAIRS_THICKNESS);
      setPaint(map, `${prefix}-stairs-3d`, 'fill-extrusion-opacity',
        isActive ? 0.7 : 0.25);

      setPaint(map, `${prefix}-walls-3d`, 'fill-extrusion-base', roomTop);
      setPaint(map, `${prefix}-walls-3d`, 'fill-extrusion-height', wallTop);
      setPaint(map, `${prefix}-walls-3d`, 'fill-extrusion-opacity',
        isActive ? ACTIVE_WALL_OPACITY : INACTIVE_WALL_OPACITY);
    }
  } else {
    // 2D flat mode: show only active level, height = 0
    const vis = isActive ? 'visible' : 'none';

    setLayerVis(map, `${prefix}-rooms-3d`, groupVis('rooms', vis));
    setLayerVis(map, `${prefix}-rooms-outline`, groupVis('rooms', vis));
    setLayerVis(map, `${prefix}-rooms-labels`, groupVis('labels', vis));
    setLayerVis(map, `${prefix}-corridors-3d`, groupVis('corridors', vis));
    setLayerVis(map, `${prefix}-corridors-outline`, 'none'); // hide corridor outlines in 2D — they overlap rooms
    setLayerVis(map, `${prefix}-stairs-3d`, groupVis('rooms', vis));
    setLayerVis(map, `${prefix}-walls-3d`, 'none'); // no walls in 2D

    if (isActive) {
      setPaint(map, `${prefix}-rooms-3d`, 'fill-extrusion-base', 0);
      setPaint(map, `${prefix}-rooms-3d`, 'fill-extrusion-height', 0);
      setPaint(map, `${prefix}-rooms-3d`, 'fill-extrusion-opacity', ACTIVE_ROOM_OPACITY);

      setPaint(map, `${prefix}-rooms-outline`, 'fill-extrusion-base', 0);
      setPaint(map, `${prefix}-rooms-outline`, 'fill-extrusion-height', 0.2);
      setPaint(map, `${prefix}-rooms-outline`, 'fill-extrusion-opacity', 0.75);

      setPaint(map, `${prefix}-corridors-3d`, 'fill-extrusion-base', 0);
      setPaint(map, `${prefix}-corridors-3d`, 'fill-extrusion-height', 0);
      setPaint(map, `${prefix}-corridors-3d`, 'fill-extrusion-opacity', ACTIVE_CORRIDOR_OPACITY);

      setPaint(map, `${prefix}-corridors-outline`, 'fill-extrusion-base', 0);
      setPaint(map, `${prefix}-corridors-outline`, 'fill-extrusion-height', 0.2);
      setPaint(map, `${prefix}-corridors-outline`, 'fill-extrusion-opacity', 0.6);

      setPaint(map, `${prefix}-stairs-3d`, 'fill-extrusion-base', 0);
      setPaint(map, `${prefix}-stairs-3d`, 'fill-extrusion-height', 0);
      setPaint(map, `${prefix}-stairs-3d`, 'fill-extrusion-opacity', 0.7);
    }
  }
}

// ===== Helpers =====

function setLayerVis(map: maplibregl.Map, layerId: string, vis: string): void {
  try {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', vis);
    }
  } catch (_) { /* layer not ready */ }
}

function setPaint(map: maplibregl.Map, layerId: string, prop: string, value: any): void {
  try {
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, prop, value);
    }
  } catch (_) { /* layer not ready */ }
}

// ===== Layer creation per building per level =====

function addBuildingLevelLayers(map: maplibregl.Map, building: string, level: number): void {
  const key = `${building}-${level}`;
  if (addedBuildingLevels.has(key)) return;
  addedBuildingLevels.add(key);

  const levelData = BackendService.getLevelDataForBuilding(building, level);
  const sourceId = `${building}-floor-${level}`;

  // Classify room features: stairs/elevator vs regular rooms
  const rooms: GeoJSON.Feature[] = [];
  const stairs: GeoJSON.Feature[] = [];
  for (const f of levelData.rooms.features) {
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
    const rt = f.properties.room_type;
    if (rt === 'stairs' || rt === 'elevator') {
      stairs.push(f);
    } else {
      rooms.push(f);
    }
  }

  const corridors = levelData.colliders.features.filter(
    f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'
  );

  // Corridors (added first so rooms render on top in 2D)
  if (corridors.length > 0) {
    map.addSource(`${sourceId}-corridors`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: corridors },
    });

    map.addLayer({
      id: `${sourceId}-corridors-3d`,
      type: 'fill-extrusion',
      source: `${sourceId}-corridors`,
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': CORRIDOR_COLOR,
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': ACTIVE_CORRIDOR_OPACITY,
      },
    });

    // Corridor outline edges
    const corridorEdges = buildEdgePolygons(corridors);
    if (corridorEdges.length > 0) {
      map.addSource(`${sourceId}-corridors-edges`, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: corridorEdges },
      });

      map.addLayer({
        id: `${sourceId}-corridors-outline`,
        type: 'fill-extrusion',
        source: `${sourceId}-corridors-edges`,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': OUTLINE_COLOR,
          'fill-extrusion-height': 0,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.6,
        },
      });
    }
  }

  // Rooms (added after corridors so they render on top)
  if (rooms.length > 0) {
    map.addSource(`${sourceId}-rooms`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: rooms },
    });

    map.addLayer({
      id: `${sourceId}-rooms-3d`,
      type: 'fill-extrusion',
      source: `${sourceId}-rooms`,
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': buildRoomColorExpression(),
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': ACTIVE_ROOM_OPACITY,
        'fill-extrusion-vertical-gradient': true,
      } as any,
    });

    // Room outline — extract polygon edges into thin wall strips
    const edgeFeatures = buildEdgePolygons(rooms);
    if (edgeFeatures.length > 0) {
      map.addSource(`${sourceId}-rooms-edges`, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: edgeFeatures },
      });

      map.addLayer({
        id: `${sourceId}-rooms-outline`,
        type: 'fill-extrusion',
        source: `${sourceId}-rooms-edges`,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#1A237E',
          'fill-extrusion-height': 0,
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.75,
        },
      });
    }

    // Room labels — separate point source for manual positioning
    const labelPoints = buildLabelPoints(rooms);
    map.addSource(`${sourceId}-rooms-labelpts`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: labelPoints },
    });

    map.addLayer({
      id: `${sourceId}-rooms-labels`,
      type: 'symbol',
      source: `${sourceId}-rooms-labelpts`,
      minzoom: MapConfig.labelMinZoom,
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

  // Stairs
  if (stairs.length > 0) {
    map.addSource(`${sourceId}-stairs`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: stairs },
    });

    map.addLayer({
      id: `${sourceId}-stairs-3d`,
      type: 'fill-extrusion',
      source: `${sourceId}-stairs`,
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': ROOM_COLORS.stairs,
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.7,
      },
    });
  }

  // Walls
  const allPolygons = [...rooms, ...corridors, ...stairs];
  if (allPolygons.length > 0) {
    map.addSource(`${sourceId}-walls`, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: allPolygons },
    });

    map.addLayer({
      id: `${sourceId}-walls-3d`,
      type: 'fill-extrusion',
      source: `${sourceId}-walls`,
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': WALL_COLOR,
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': ACTIVE_WALL_OPACITY,
      },
    });
  }
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
// Each room gets a Point feature at _label_pos (custom) or _centroid (default).

function buildLabelPoints(rooms: GeoJSON.Feature[]): GeoJSON.Feature[] {
  return rooms.map(room => {
    const props = room.properties;
    const pos: [number, number] = props._label_pos
      ? [props._label_pos[0], props._label_pos[1]]
      : props._centroid
        ? [props._centroid[0], props._centroid[1]]
        : polygonCentroid(room.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon);

    return {
      type: 'Feature' as const,
      properties: { ...props },
      geometry: { type: 'Point' as const, coordinates: pos },
    };
  });
}

function polygonCentroid(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
  const n = ring.length - 1;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += ring[i][0]; sy += ring[i][1]; }
  return [sx / n, sy / n];
}

/** Rebuild room sources for a level (called by editor when labels/properties change) */
export function refreshRoomLabels(map: maplibregl.Map, level: number): void {
  for (const building of BackendService.getBuildingCodes()) {
    const allRooms = BackendService.getLevelDataForBuilding(building, level).rooms.features;
    const prefix = `${building}-floor-${level}`;

    // Update label points source
    const labelSource = map.getSource(`${prefix}-rooms-labelpts`) as maplibregl.GeoJSONSource | undefined;
    if (labelSource) {
      labelSource.setData({ type: 'FeatureCollection', features: buildLabelPoints(allRooms) });
    }

    // Update room polygon source (so click queries + colors reflect edits)
    const roomSource = map.getSource(`${prefix}-rooms`) as maplibregl.GeoJSONSource | undefined;
    if (roomSource) {
      const rooms = allRooms.filter(f => {
        const rt = f.properties.room_type;
        return rt !== 'stairs' && rt !== 'elevator';
      });
      roomSource.setData({ type: 'FeatureCollection', features: rooms });
    }
  }
}

// ===== Edge geometry builder =====
// Converts room polygons into thin rectangular strips along each edge.
// This creates real 3D outlines that float at the correct floor height.

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

        // Perpendicular offset to create a thin rectangle
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-9) continue;

        // Normal vector scaled to EDGE_THICKNESS
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
              [a[0] - nx, a[1] - ny], // close ring
            ]],
          },
        });
      }
    }
  }

  return edges;
}
