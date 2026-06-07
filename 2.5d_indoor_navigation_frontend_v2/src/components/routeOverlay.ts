import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { CylinderGeometry } from 'three';
import type maplibregl from 'maplibre-gl';
import { getLevelBase, ROOM_THICKNESS, getCurrentLevel } from './indoorLayer';
import { MapConfig } from '../config/mapConfig';
import * as BackendService from '../services/backendService';
import type { ApiRouteClip } from '../services/api/apiRoute';

// Outdoor route vertices (no floor slab beneath) sit just above the ground
// instead of at indoor floor-slab height, so the connector tail doesn't float.
const GROUND_LIFT = 0.5;

/**
 * RouteOverlay — deck.gl overlay for dynamic route visualization
 *
 * 3D 모드에서는 각 좌표의 층(level) 정보를 기반으로 정확한 높이를 적용.
 * 2D↔3D 전환 시 자동 재렌더링.
 *
 * 영상이 없는 구간(드롭 핀에서 가장 가까운 복도까지의 꼬리, 영상 미등록 edge)은
 * 흐리게 그려 사용자에게 360° 워크스루가 불가한 영역을 시각적으로 알린다.
 */

let overlay: MapboxOverlay | null = null;
let mapRef: maplibregl.Map | null = null;

// 저장된 경로 데이터 (2D↔3D 전환 시 재렌더링용)
let storedCoordinates: GeoJSON.Position[] | null = null;
let storedLevels: number[] | null = null;
let storedHasVideo: boolean[] | null = null; // length = coords.length - 1
let storedOutdoorMask: boolean[] | null = null; // length = coords.length; true = outdoor
let storedIs3D = false;

// IDs of the route PathLayers currently mounted — tracked here, NOT read back
// from `overlay.props.layers` (that field is undefined at runtime; the property
// only exists on the .d.ts, so reading it yields []). pickRouteCoordinate scopes
// its hit-test to these.
let routePathLayerIds: string[] = [];

// Walkthrough position indicator. Stores the RAW (lng/lat, level, heading) so a
// 2D↔3D toggle can recompute altitude/geometry on the spot — even while playback
// is paused (no onProgress tick to re-push the position).
interface PositionIndicator {
  position: GeoJSON.Position; // raw [lng, lat]
  level: number;
  heading: number;            // facing direction, compass degrees (0 = N, CW)
}
let positionIndicator: PositionIndicator | null = null;

const INDICATOR_COLOR: [number, number, number] = [255, 152, 0];       // orange (2D dot + fan)
const PUCK_COLOR: [number, number, number] = [255, 164, 32];           // a hair brighter so the
                                                                       // solid puck pops over the fan
const RING_COLOR: [number, number, number, number] = [255, 255, 255, 235]; // white casing/halo
const FAN_COLOR: [number, number, number, number] = [255, 152, 0, 128];    // translucent (== 2D rgba .5)

// ── 3D walkthrough marker: a "location puck" (Google/Apple/Mapbox pattern) ──
// A low orange disc (real but modest height) sitting ON the route line, ringed
// by a white casing that separates it from the same-altitude route + grounds it,
// trailing the flat translucent facing fan. NOT an upright pill — a pedestrian
// position cursor lies on the floor and foreshortens with the tilt.
//
// Everything is PIXEL-LOCKED to the live zoom so the 3D marker keeps the same
// on-screen size as the pixel-locked 2D dot (radiusMaxPixels 16) — fixing the
// "3D size doesn't match 2D" complaint (the old capsule was meter-sized and
// ballooned with zoom).
const TARGET_PUCK_RADIUS_PX = 16;   // == 2D dot radiusMaxPixels → 32px diameter
const RING_GAP_PX = 3;              // white casing radius = puck radius + this
const RING_WIDTH_PX = 4;            // stroke width (stays legible at the 72° pitch)
const FAN_REACH_PX = 40;            // == 2D CSS wedge border-top:40px
const SECTOR_HALF_ANGLE_DEG = 26.6; // == atan(20/40): matches the 2D 20/20/40px triangle
const FAN_LIFT_M = 0.05;            // float fan a hair off the slab; depth is won by
                                    // draw-order (layer index), not by lifting it

// Puck mesh proportions (METERS). Absolute size is irrelevant — the puck is
// pixel-locked via sizeScale; only the height:radius ratio (a low disc) matters.
const PUCK_RADIUS_M = 1.4;
const PUCK_HEIGHT_M = 0.6;          // ratio ~0.43 → ~7px tall on a 32px disc: clear
                                    // volume in tilt, but not a standing pill.
const PUCK_CYLINDER_SEGMENTS = 28;  // smooth disc rim at 16px

const M_PER_DEG_LAT = 111320;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

const R = MapConfig.route;
const NO_VIDEO_OPACITY_FACTOR = 0.35;

// Tap tolerance for clicking the route line (px). Generous so a finger tap on
// the thin line still registers on mobile. deck.gl picking, not maplibre
// ground-unproject, so it stays accurate on the elevated 3D line (no parallax).
const ROUTE_PICK_RADIUS_PX = 10;

// True only while a walkthrough is active — gates route-line click-to-seek so a
// plain route preview doesn't swallow room clicks. Set by walkthroughOverlay.
let routeSeekEnabled = false;

// One-tick memo: a single tap fires two pickRouteCoordinate calls (the seek
// handler + the room-click guard) for the same pixel. pickObject is a GPU
// readback (pipeline stall), so cache the result briefly to do it once per tap.
let lastPick: { x: number; y: number; ts: number; result: RoutePick | null } | null = null;

interface PoiData {
  position: number[];
  color: [number, number, number];
  radius: number;
  level?: number;
}

export function initOverlay(map: maplibregl.Map): void {
  mapRef = map;
  overlay = new MapboxOverlay({
    interleaved: true,
    layers: [],
  });
  map.addControl(overlay as unknown as maplibregl.IControl);

  // The 3D marker is pixel-locked from the *current* zoom (rebuildLayers reads
  // map.getZoom()). Active playback already rebuilds at 30fps, but a manual
  // zoom while paused would otherwise leave the puck/fan at a stale size — so
  // re-pin them as the user zooms. Throttled; only when a 3D marker is shown.
  let lastZoomRebuild = 0;
  map.on('zoom', () => {
    if (!positionIndicator || !storedIs3D) return;
    const now = performance.now();
    if (now - lastZoomRebuild < 40) return;
    lastZoomRebuild = now;
    rebuildLayers();
  });
  map.on('zoomend', () => {
    if (positionIndicator && storedIs3D) rebuildLayers();
  });
}

/**
 * Meters-per-pixel at `lat` and the current map zoom, using deck.gl / @math.gl's
 * own convention (TILE_SIZE 512 → C·cos(lat)/2^(z+9)). Matching this exactly is
 * what lets the formula-sized puck line up with the deck-native pixel-sized ring.
 */
function metersPerPixel(lat: number): number {
  const zoom = mapRef?.getZoom() ?? 20;
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom + 9);
}

/**
 * Draw a route path on the map.
 * @param coordinates [lng, lat] 배열
 * @param levels      각 좌표의 층 번호 (coordinates와 1:1 대응)
 * @param clips       워크스루 클립 배열 — 각 segment(i, i+1)의 영상 유무 판정에 사용
 * @param is3D        3D 모드 여부
 */
export function showRoute(
  coordinates: GeoJSON.Position[],
  levels: number[] | null,
  clips: ApiRouteClip[] | null,
  is3D: boolean,
): void {
  storedCoordinates = coordinates;
  storedLevels = levels;
  storedHasVideo = buildHasVideoMask(coordinates.length, clips);
  // Precompute outdoor flags once (point-in-polygon is too costly to redo on
  // every 30fps rebuild during walkthrough playback).
  storedOutdoorMask = coordinates.map(c => !BackendService.isPointIndoors([c[0], c[1]]));
  storedIs3D = is3D;
  rebuildLayers();
}

/** 클립의 coordStartIdx ~ coordEndIdx 범위로 segment 단위 영상 커버리지 마스크 생성 */
function buildHasVideoMask(coordCount: number, clips: ApiRouteClip[] | null): boolean[] {
  const segCount = Math.max(0, coordCount - 1);
  const mask = new Array<boolean>(segCount).fill(false);
  if (!clips) return mask;
  for (const clip of clips) {
    const lo = Math.max(0, Math.min(clip.coordStartIdx, clip.coordEndIdx));
    const hi = Math.min(segCount, Math.max(clip.coordStartIdx, clip.coordEndIdx));
    for (let i = lo; i < hi; i++) mask[i] = true;
  }
  return mask;
}

/** 2D↔3D 전환 시 호출 */
export function setIs3D(is3D: boolean): void {
  storedIs3D = is3D;
  if (storedCoordinates) rebuildLayers();
}

/** 층 변경 시 경로 opacity 업데이트 */
export function onLevelChange(): void {
  if (!storedCoordinates) return;
  rebuildLayers();
}

/** 현재 경로가 표시 중인지 */
export function hasRoute(): boolean {
  return storedCoordinates !== null;
}

/** Enable/disable route-line click-to-seek (on while a walkthrough is active). */
export function setRouteSeekEnabled(enabled: boolean): void {
  routeSeekEnabled = enabled;
}

/** Is route-line click-to-seek currently armed? */
export function isRouteSeekEnabled(): boolean {
  return routeSeekEnabled;
}

/** A hit-test result: the [lng, lat] on the route line + the floor it belongs to. */
export interface RoutePick {
  position: GeoJSON.Position;
  level: number;
}

/**
 * Hit-test the route line at screen pixel (x, y) via deck.gl picking and return
 * the point on the line + its floor level, or null if the tap missed it.
 *
 * Uses deck picking (not maplibre's ground unproject) so the returned point sits
 * on the actual rendered geometry — correct in 3D where the line is elevated and
 * a ground unproject would be off by the camera-tilt parallax. Works the same in
 * 2D. Restricted to the route PathLayers; the indicator marker, search POIs, etc.
 * are left non-pickable so only the line responds.
 *
 * The `level` matters when corridors on different floors stack at the same
 * lng/lat: the caller constrains the time lookup to the clicked floor so a 4F tap
 * can't snap to the 1F line directly beneath it.
 */
export function pickRouteCoordinate(x: number, y: number): RoutePick | null {
  if (!routeSeekEnabled || !overlay || !storedCoordinates) return null;

  const now = performance.now();
  if (lastPick && lastPick.x === x && lastPick.y === y && now - lastPick.ts < 100) {
    return lastPick.result;
  }

  let result: RoutePick | null = null;
  if (routePathLayerIds.length > 0) {
    // pickObject is forwarded by MapboxOverlay at runtime (deck.gl 9.2), but the
    // resolved .d.ts in this project predates it — cast to the call shape we use.
    const picker = overlay as unknown as {
      pickObject(p: {
        x: number; y: number; radius?: number; layerIds?: string[]; unproject3D?: boolean;
      }): { coordinate?: number[]; object?: { level?: number } } | null;
    };
    // unproject3D: read the picking DEPTH buffer so `coordinate` is the actual 3D
    // point on the line. Without it deck unprojects against z=0 (the ground), so
    // a tap on an ELEVATED upper-floor line (e.g. 4F) returns the ground point
    // under the cursor — off by the camera-tilt parallax, snapping to the wrong
    // spot. With it the returned lng/lat sits on the floor the user clicked.
    const info = picker.pickObject({
      x, y, radius: ROUTE_PICK_RADIUS_PX, layerIds: routePathLayerIds, unproject3D: true,
    });
    if (info?.coordinate) {
      // info.object is the picked Segment → its level is the clicked floor.
      const level = info.object?.level ?? storedLevels?.[storedLevels.length - 1] ?? 1;
      result = { position: [info.coordinate[0], info.coordinate[1]], level };
    }
  }

  // Flat-mode fallback: deck.gl picking can miss in interleaved mode. In 2D the
  // map's ground unproject IS the line position (no elevation parallax), so
  // project the clicked lng/lat onto the polyline and accept it when the foot
  // point lands within tap tolerance on screen. (3D keeps relying on deck
  // picking — a ground unproject there is off by the camera-tilt parallax.)
  if (!result && !storedIs3D && mapRef) {
    const ll = mapRef.unproject([x, y]);
    const seg = nearestSegment([ll.lng, ll.lat]);
    if (seg) {
      const a = storedCoordinates[seg.i], b = storedCoordinates[seg.i + 1];
      const foot: GeoJSON.Position = [a[0] + seg.t * (b[0] - a[0]), a[1] + seg.t * (b[1] - a[1])];
      const sp = mapRef.project(foot as [number, number]);
      if (Math.hypot(sp.x - x, sp.y - y) <= ROUTE_PICK_RADIUS_PX + 6) {
        result = { position: foot, level: storedLevels?.[seg.i] ?? 1 };
      }
    }
  }

  lastPick = { x, y, ts: now, result };
  return result;
}

/** 좌표별 층 정보를 기반으로 3D 높이 적용 */
function buildPath3D(
  coords: GeoJSON.Position[],
  levels: number[] | null,
  is3D: boolean,
  outdoorMask: boolean[] | null,
): number[][] {
  if (!is3D || !levels) {
    return coords.map(c => [c[0], c[1]]);
  }

  return coords.map((c, i) => {
    // Outdoor vertices have no floor slab beneath — keep them on the ground
    // so the route doesn't float at indoor floor-slab height.
    if (outdoorMask?.[i]) return [c[0], c[1], GROUND_LIFT];
    const level = levels[i] ?? levels[levels.length - 1] ?? 1;
    const altitude = getLevelBase(level) + ROOM_THICKNESS + 0.5;
    return [c[0], c[1], altitude];
  });
}

/** 층별 경로 색상 보간 */
function colorForLevel(level: number, minLevel: number): [number, number, number] {
  const step = level - minLevel;
  const t = Math.min(step / R.colorSteps, 1);
  return [
    Math.round(R.colorFrom[0] + (R.colorTo[0] - R.colorFrom[0]) * t),
    Math.round(R.colorFrom[1] + (R.colorTo[1] - R.colorFrom[1]) * t),
    Math.round(R.colorFrom[2] + (R.colorTo[2] - R.colorFrom[2]) * t),
  ];
}

/** 좌표 배열을 같은 (층, 영상유무) 끼리 연속 세그먼트로 분할 (인접 세그먼트는 끝점 공유) */
interface Segment {
  path: number[][];
  level: number;
  hasVideo: boolean;
}

function splitByLevelAndVideo(
  path3d: number[][],
  levels: number[] | null,
  hasVideo: boolean[] | null,
): Segment[] {
  if (path3d.length < 2) return [];

  const segCount = path3d.length - 1;
  const segLevel = (i: number) => levels?.[i] ?? 1;
  const segHasVideo = (i: number) => hasVideo?.[i] ?? true;

  const segments: Segment[] = [];
  let curLevel = segLevel(0);
  let curHas = segHasVideo(0);
  let curPath: number[][] = [path3d[0]];

  for (let i = 0; i < segCount; i++) {
    const segL = segLevel(i);
    const segV = segHasVideo(i);
    if (segL !== curLevel || segV !== curHas) {
      // close current segment at vertex i (shared with next)
      curPath.push(path3d[i]);
      if (curPath.length >= 2) segments.push({ path: curPath, level: curLevel, hasVideo: curHas });
      curLevel = segL;
      curHas = segV;
      curPath = [path3d[i]];
    }
    curPath.push(path3d[i + 1]);
  }

  if (curPath.length >= 2) {
    segments.push({ path: curPath, level: curLevel, hasVideo: curHas });
  }
  return segments;
}

/** Highlight POIs on the map (e.g., search results) */
export function showPois(positions: GeoJSON.Position[]): void {
  if (!overlay) return;

  const pois: PoiData[] = positions.map(pos => ({
    position: pos,
    color: [255, 111, 3] as [number, number, number],
    radius: 6,
  }));

  const currentLayers = overlay.props?.layers || [];
  const routeLayers = currentLayers.filter((l: any) => l.id?.startsWith('route-'));

  overlay.setProps({
    layers: [
      ...routeLayers,
      new ScatterplotLayer({
        id: 'search-pois',
        data: pois,
        getPosition: (d: PoiData) => d.position,
        getFillColor: (d: PoiData) => d.color,
        getRadius: (d: PoiData) => d.radius,
        radiusMinPixels: 5,
        radiusMaxPixels: 12,
      }),
    ],
  });
}

// ===== Walkthrough Position Indicator =====

/** Per-vertex 3D altitude of the route line, matching buildPath3D exactly. */
function vertexAltitude(i: number): number {
  if (storedOutdoorMask?.[i]) return GROUND_LIFT;
  const level = storedLevels?.[i] ?? storedLevels?.[storedLevels.length - 1] ?? 1;
  return getLevelBase(level) + ROOM_THICKNESS + 0.5;
}

/** Project `position` onto the nearest route segment; returns its index + param t. */
function nearestSegment(position: GeoJSON.Position): { i: number; t: number } | null {
  const coords = storedCoordinates;
  if (!coords || coords.length < 2) return null;
  let bestI = 0, bestT = 0, bestD = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][0], ay = coords[i][1];
    const dx = coords[i + 1][0] - ax, dy = coords[i + 1][1] - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let t = ((position[0] - ax) * dx + (position[1] - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    const d = (position[0] - px) ** 2 + (position[1] - py) ** 2;
    if (d < bestD) { bestD = d; bestI = i; bestT = t; }
  }
  return { i: bestI, t: bestT };
}

/**
 * Altitude of the rendered route line at an arbitrary position on it. Linearly
 * interpolates the nearest segment's two vertex altitudes — exactly what the
 * PathLayer does — so the marker sits ON the line in 3D even across floor
 * transitions / outdoor ramps.
 */
function altitudeAtPosition(position: GeoJSON.Position): number {
  const seg = nearestSegment(position);
  if (!seg) return GROUND_LIFT;
  const zA = vertexAltitude(seg.i);
  const zB = vertexAltitude(seg.i + 1);
  return zA + seg.t * (zB - zA);
}

/**
 * Compass bearing (deg, 0 = N, CW) of the route's forward travel direction at
 * `position` — the segment from coords[i] → coords[i+1] (route is start→dest, so
 * increasing index is the direction of travel). Used to face the marker forward,
 * assuming the walkthrough video is filmed along the route.
 */
export function getRouteBearingAt(position: GeoJSON.Position): number {
  const coords = storedCoordinates;
  const seg = nearestSegment(position);
  if (!coords || !seg) return 0;
  const a = coords[seg.i], b = coords[seg.i + 1];
  const lat = position[1];
  const east = (b[0] - a[0]) * Math.cos((lat * Math.PI) / 180);
  const north = b[1] - a[1];
  const deg = (Math.atan2(east, north) * 180) / Math.PI; // atan2(E,N): 0=N, 90=E
  return (deg + 360) % 360;
}

/** Show the walkthrough position marker at `position`, facing `heading` (compass deg). */
export function showPositionIndicator(
  position: GeoJSON.Position,
  level: number,
  heading: number,
): void {
  positionIndicator = { position, level, heading };
  rebuildLayers();
}

/**
 * Update only the facing direction (called as the user pans the 360° view). The
 * 2D facing wedge is a DOM marker (geoMap) updated cheaply, so only the 3D fan
 * needs a deck.gl rebuild — skip it otherwise.
 */
export function setIndicatorHeading(heading: number): void {
  if (!positionIndicator) return;
  positionIndicator.heading = heading;
  if (storedIs3D) rebuildLayers();
}

/** Remove the walkthrough position indicator */
export function clearPositionIndicator(): void {
  positionIndicator = null;
  rebuildLayers();
}

/** A pie-slice (sector) ring centered on `position`, opening toward `heading`. */
function sectorPolygon(
  lng: number,
  lat: number,
  headingDeg: number,
  radiusM: number,
  halfAngleDeg: number,
  z: number,
): number[][] {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180) || M_PER_DEG_LAT;
  const ring: number[][] = [[lng, lat, z]];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const aDeg = headingDeg - halfAngleDeg + (2 * halfAngleDeg) * (i / steps);
    const a = (aDeg * Math.PI) / 180;
    const east = Math.sin(a) * radiusM;   // compass: 0=N, 90=E → east uses sin
    const north = Math.cos(a) * radiusM;  //                      north uses cos
    ring.push([lng + east / mPerDegLng, lat + north / M_PER_DEG_LAT, z]);
  }
  ring.push([lng, lat, z]); // close back to apex
  return ring;
}

// Puck body mesh — a LOW cylinder (a disc), built once. three's CylinderGeometry
// is Y-up and centered; rotate it Z-up (deck.gl convention) and lift it so the
// base sits on the floor (z=0), then it rides the route altitude via getPosition.
// Pixel size is applied per-rebuild via SimpleMeshLayer.sizeScale, so the meter
// dimensions here only set the height:radius ratio (a flat disc).
interface MeshData {
  attributes: {
    positions: { value: Float32Array; size: number };
    normals: { value: Float32Array; size: number };
  };
  indices: Uint16Array | Uint32Array;
}
let puckMesh: MeshData | null = null;
function getPuckMesh(): MeshData {
  if (puckMesh) return puckMesh;
  const geo = new CylinderGeometry(PUCK_RADIUS_M, PUCK_RADIUS_M, PUCK_HEIGHT_M, PUCK_CYLINDER_SEGMENTS);
  geo.rotateX(Math.PI / 2);               // Y-up → Z-up
  geo.translate(0, 0, PUCK_HEIGHT_M / 2); // base → z=0
  const idx = geo.index!.array;
  puckMesh = {
    attributes: {
      positions: { value: geo.attributes.position.array as Float32Array, size: 3 },
      normals: { value: geo.attributes.normal.array as Float32Array, size: 3 },
    },
    indices: idx instanceof Uint32Array ? idx : Uint16Array.from(idx as ArrayLike<number>),
  };
  return puckMesh;
}

/** deck.gl layers for the walkthrough position marker (2D dot / 3D puck + ring + fan). */
function buildIndicatorLayers(): any[] {
  if (!positionIndicator) return [];
  const { position, heading } = positionIndicator;
  const lng = position[0], lat = position[1];

  if (!storedIs3D) {
    // 2D: flat dot. The facing fan is a DOM marker (geoMap.applyWedge).
    // NOTE the id is DISJOINT from the 3D ids below — see the 3D block.
    return [
      new ScatterplotLayer<PoiData>({
        id: 'walkthrough-dot-2d',
        data: [{ position: [lng, lat], color: INDICATOR_COLOR, radius: 6 }],
        getPosition: (d) => d.position as [number, number],
        getFillColor: INDICATOR_COLOR,
        getRadius: 6,
        radiusMinPixels: 8,
        radiusMaxPixels: 16,
      }),
    ];
  }

  // 3D "location puck": a low orange disc riding the route altitude, a white
  // casing ring on the floor (separates it from the same-altitude route line &
  // grounds it so it doesn't read as a floating dot), and the flat translucent
  // facing fan. Drawn AFTER the route in rebuildLayers → higher deck layer-index
  // → deck's default polygonOffset pulls them toward the camera, so the blue
  // route can never z-fight / draw over them (no world-space lift needed).
  //
  // CRITICAL (mode-toggle bug fix): the 3D ids are DISJOINT from the 2D id.
  // deck.gl matches layers by id only — no class check — and on a match it
  // *transfers the old layer's GPU model* to the new one. Reusing one id across
  // ScatterplotLayer (2D) and SimpleMeshLayer (3D) therefore froze the shape on
  // 2D↔3D toggle (first mode rendered wins). Disjoint ids → each mode mounts
  // fresh.
  const floorZ = altitudeAtPosition(position);
  const mpp = metersPerPixel(lat);
  const fan = sectorPolygon(
    lng, lat, heading, FAN_REACH_PX * mpp, SECTOR_HALF_ANGLE_DEG, floorZ + FAN_LIFT_M,
  );
  return [
    new SolidPolygonLayer<{ polygon: number[][] }>({
      id: 'walkthrough-facing-3d',
      data: [{ polygon: fan }],
      getPolygon: (d) => d.polygon,
      getFillColor: FAN_COLOR,
      extruded: false,
    }),
    new ScatterplotLayer<{ position: number[] }>({
      id: 'walkthrough-ring-3d',
      data: [{ position: [lng, lat, floorZ] }],
      getPosition: (d) => d.position as [number, number, number],
      radiusUnits: 'pixels',
      getRadius: TARGET_PUCK_RADIUS_PX + RING_GAP_PX,
      stroked: true,
      filled: false,
      lineWidthUnits: 'pixels',
      getLineWidth: RING_WIDTH_PX,
      lineWidthMinPixels: RING_WIDTH_PX,
      getLineColor: RING_COLOR,
      billboard: false, // lie flat on the floor (foreshortens with tilt → grounded)
    }),
    new SimpleMeshLayer<{ position: number[] }>({
      id: 'walkthrough-puck-3d',
      data: [{ position: [lng, lat, floorZ] }],
      mesh: getPuckMesh(),
      getPosition: (d) => d.position as [number, number, number],
      getColor: PUCK_COLOR,
      getOrientation: [0, 0, 0],
      // Pixel-lock: render the PUCK_RADIUS_M mesh to TARGET_PUCK_RADIUS_PX on
      // screen regardless of zoom (height scales with it → stays a low disc), so
      // it matches the 2D dot instead of ballooning. mpp uses the same 2^(z+9)
      // convention as deck's native pixel sizing → puck lines up with the ring.
      sizeScale: (TARGET_PUCK_RADIUS_PX * mpp) / PUCK_RADIUS_M,
      // Bright phong (high ambient) so the orange reads vivid, not muddy-brown.
      material: { ambient: 0.85, diffuse: 0.4, shininess: 30, specularColor: [60, 60, 60] },
    }),
  ];
}

/** Rebuild all overlay layers (route + position indicator) */
function rebuildLayers(): void {
  if (!overlay) return;

  const layers: any[] = [];
  routePathLayerIds = [];

  // Route layers
  if (storedCoordinates) {
    const path3d = buildPath3D(storedCoordinates, storedLevels, storedIs3D, storedOutdoorMask);
    const segments = splitByLevelAndVideo(path3d, storedLevels, storedHasVideo);
    const minLevel = storedLevels ? Math.min(...storedLevels) : 1;
    const curLevel = getCurrentLevel();
    routePathLayerIds = segments.map((_, i) => `route-path-${i}`);

    segments.forEach((seg, i) => {
      const baseColor = colorForLevel(seg.level, minLevel);
      const baseOpacity = seg.level === curLevel ? R.activeOpacity : R.inactiveOpacity;
      const opacity = seg.hasVideo ? baseOpacity : Math.round(baseOpacity * NO_VIDEO_OPACITY_FACTOR);
      layers.push(
        new PathLayer<Segment>({
          id: `route-path-${i}`,
          data: [seg],
          getPath: (d) => d.path,
          getColor: [...baseColor, opacity] as [number, number, number, number],
          getWidth: R.lineWidth,
          widthMinPixels: R.lineWidthMinPx,
          widthMaxPixels: R.lineWidthMaxPx,
          capRounded: true,
          jointRounded: true,
          pickable: true, // tap-to-seek: pickRouteCoordinate hit-tests these
        }),
      );
    });

    // Endpoint POIs are rendered as DOM teardrop pins by routePinMarkers,
    // which already carries the 출발/도착 affordance — drawing a separate
    // dot here would duplicate the marker at ground level.
  }

  // Position indicator (2D dot, or 3D cylinder + facing fan)
  layers.push(...buildIndicatorLayers());

  overlay.setProps({ layers });
}

/** Clear all deck.gl layers */
export function clearRoute(): void {
  if (!overlay) return;
  storedCoordinates = null;
  storedLevels = null;
  storedHasVideo = null;
  storedOutdoorMask = null;
  // NOTE: storedIs3D is the camera-mode state, not route state. Don't reset
  // it here — the user may clear the route while still in 3D.
  positionIndicator = null;
  routePathLayerIds = [];
  overlay.setProps({ layers: [] });
}

/** Clear only search POIs, keep route */
export function clearPois(): void {
  if (!overlay) return;
  const currentLayers = overlay.props?.layers || [];
  const routeLayers = currentLayers.filter((l: any) => l.id?.startsWith('route-'));
  overlay.setProps({ layers: routeLayers });
}
