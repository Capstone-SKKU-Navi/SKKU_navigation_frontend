import maplibregl from 'maplibre-gl';
import * as BackendService from '../services/backendService';
import * as IndoorLayer from './indoorLayer';
import * as RouteOverlay from './routeOverlay';
import * as FloatingLabels from './floatingLabels';
import { MapConfig } from '../config/mapConfig';
import { ROOM_TYPE_LABELS } from '../models/types';
import { polygonCenter } from '../utils/polygonCenter';
import { formatLevel } from '../utils/formatLevel';

/**
 * GeoMap — MapLibre GL JS based map component
 *
 * Replaces Maptalks + Three.js dual-canvas architecture with a single
 * WebGL2 context. All static geometry uses MapLibre fill-extrusion,
 * dynamic overlays use deck.gl via MapboxOverlay (interleaved mode).
 */

let map: maplibregl.Map | null = null;
let flatMode = true; // start in 2D
let suppressClickUntil = 0; // timestamp — room clicks before this are dropped

export function getMap(): maplibregl.Map | null {
  return map;
}

export function isFlatMode(): boolean {
  return flatMode;
}

/**
 * Drop the next synthetic room click (used by mobile long-press to avoid
 * a phantom `roomClicked` dispatching when the finger is released after
 * the radial menu has already opened).
 */
export function suppressNextClick(): void {
  suppressClickUntil = performance.now() + 500;
}

export function initMap(): void {
  const constants = BackendService.getBuildingConstants();
  const center = BackendService.getMapCenter();

  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        'carto-tiles': {
          type: 'raster',
          tiles: [
            'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
          ],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        },
      },
      layers: [
        {
          id: 'carto-tiles',
          type: 'raster',
          source: 'carto-tiles',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    },
    center: center,
    zoom: constants.standardZoom,
    bearing: constants.standardBearing,
    pitch: 0, // start in 2D
    minZoom: constants.minZoom,
    maxZoom: constants.maxZoom,
    antialias: true,
    preserveDrawingBuffer: true,
    dragRotate: true,
    touchPitch: true,
    doubleClickZoom: false, // prevent iOS Safari 300ms double-tap zoom stealing a second room tap
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

  // Clamp panning to the building's union bbox (+ padding) so the user can't
  // drift off to the rest of the city. minZoom/maxZoom above already cap zoom.
  applyPanBounds(map);

  // Middle-click (wheel button) drag to pan
  setupMiddleClickPan(map);

  // Relax MapLibre's two-finger pitch detection — see fn doc.
  relaxTouchPitch(map);

  initRoomInfoPopup();

  map.on('load', () => {
    try {
      IndoorLayer.addIndoorLayers(map!);
      FloatingLabels.init(map!);
      RouteOverlay.initOverlay(map!);
      setupRoomClick();
      // Prime camera-driven focus and listen for camera changes. The focus
      // rule only affects 3D rendering, but we keep the focused set updated
      // even in 2D so toggling to 3D snaps immediately to the right building.
      IndoorLayer.updateCameraFocus(map!);
      map!.on('moveend', () => IndoorLayer.updateCameraFocus(map!));
    } catch (e) {
      console.error('Map init error:', e);
    }
    // 2D 모드: pitch만 잠그고 Z축(bearing) 회전은 허용
    map!.setMaxPitch(0);
    // Always emit loaded event so UI doesn't get stuck
    document.dispatchEvent(new CustomEvent('mapLoaded'));
  });
}

/**
 * Restrict panning to the loaded buildings' union bbox plus padding.
 * MapLibre's maxBounds keeps the whole *viewport* inside the box, so at low
 * zoom it also effectively tightens the min zoom — set MapConfig.panBoundsPaddingDeg
 * to null to disable entirely (e.g. for debugging the wider basemap).
 */
function applyPanBounds(m: maplibregl.Map): void {
  const pad = MapConfig.panBoundsPadding;
  if (pad == null) return;
  const b = BackendService.getMapMaxBounds();
  if (!b) return;
  const [w, s, e, n] = b;
  m.setMaxBounds([
    [w - pad.lng, s - pad.lat],
    [e + pad.lng, n + pad.lat],
  ]);
}

/** Toggle between 2D and 3D mode */
export function toggle3D(): void {
  if (!map) return;
  const constants = BackendService.getBuildingConstants();
  flatMode = !flatMode;

  if (flatMode) {
    // Switch to 2D: pitch 0, Z축 회전만 허용
    map.easeTo({
      pitch: 0,
      zoom: constants.standardZoom,
      duration: MapConfig.toggleDuration,
    });
    map.setMaxPitch(0);
    IndoorLayer.setExtrusionHeight(map, false);
  } else {
    // Switch to 3D: tilted view with extrusions
    map.easeTo({
      pitch: constants.standardPitch3DMode,
      bearing: constants.standardBearing3DMode,
      zoom: constants.standardZoom3DMode,
      duration: MapConfig.toggleDuration,
    });
    map.setMaxPitch(MapConfig.maxPitch3D);
    IndoorLayer.setExtrusionHeight(map, true);
  }
  // Wedge is 2D-only (DOM marker can't elevate to the route in 3D); the 3D
  // facing fan + cylinder are drawn by the deck.gl overlay instead.
  applyWedge();
  // Notify listeners (route overlay) so altitudes AND the position marker
  // re-render immediately — including while walkthrough playback is paused,
  // when no onProgress tick would otherwise reposition the marker.
  document.dispatchEvent(new Event('mode3DChanged'));
}

/** Center the map on the building */
export function centerMapToBuilding(): void {
  if (!map) return;
  const constants = BackendService.getBuildingConstants();
  const center = BackendService.getMapCenter();

  if (flatMode) {
    map.easeTo({ center, zoom: constants.standardZoom, pitch: 0, duration: MapConfig.centerDuration });
  } else {
    map.easeTo({ center, zoom: constants.standardZoom3DMode, bearing: constants.standardBearing3DMode, pitch: constants.standardPitch3DMode, duration: MapConfig.centerDuration });
  }
}

/** Switch floor level */
export function handleLevelChange(level: number): void {
  if (!map) return;
  IndoorLayer.setVisibleLevel(map, level);
  document.dispatchEvent(new Event('levelChanged'));
}

/** Get current level */
export function getCurrentLevel(): number {
  return IndoorLayer.getCurrentLevel();
}

/** Fly to a specific room */
export function flyToRoom(ref: string): void {
  if (!map) return;

  const level = IndoorLayer.getRoomLevel(ref);
  if (level !== null) {
    IndoorLayer.setVisibleLevel(map, level);
  }

  // Find the room feature to get its center
  const rooms = BackendService.getRoomList();
  const room = rooms.find(r => r.ref === ref);
  if (!room) return;

  // Find feature in GeoJSON to get coordinates
  const geoJson = BackendService.getGeoJson();
  const feature = geoJson.features.find(f =>
    f.properties.ref === ref && f.geometry.type === 'Polygon'
  );

  if (feature) {
    const coords = (feature.geometry as GeoJSON.Polygon).coordinates[0];
    const center = polygonCenter(coords);

    map.easeTo({
      center: center as [number, number],
      zoom: MapConfig.flyToRoomZoom,
      duration: MapConfig.flyToRoomDuration,
    });

    IndoorLayer.highlightRoom(map, ref);
    // Drop a marker at the result so it's also legible when zoomed out.
    RouteOverlay.showPois([center]);

    // Show room info popup
    showRoomInfoPopup(ref, feature, center);
  }
}

/** Clear room highlight */
export function clearHighlight(): void {
  if (!map) return;
  IndoorLayer.highlightRoom(map, null);
  RouteOverlay.clearPois();
  hideRoomInfoPopup();
  // Releasing the highlight also releases the focus pin — matches the
  // spec for popup close / ESC / empty-space click.
  IndoorLayer.clearPinnedFocus(map);
}

/** Pin the 3D focus to a specific set of buildings (route active / search). */
export function setIndoorFocusPin(buildings: Iterable<string>): void {
  if (!map) return;
  IndoorLayer.setPinnedFocus(map, buildings);
}

/** Release the 3D focus pin (camera-driven focus takes over). */
export function clearIndoorFocusPin(): void {
  if (!map) return;
  IndoorLayer.clearPinnedFocus(map);
}

/** Tell the indoor layer which floors the active route covers, so upper-floor
 *  route segments aren't hidden behind filtered-out floors in 3D. */
export function setIndoorRouteLevels(levels: Iterable<number>): void {
  if (!map) return;
  IndoorLayer.setRouteLevels(map, levels);
}

/** Clear the route-levels override (paired with route clear). */
export function clearIndoorRouteLevels(): void {
  if (!map) return;
  IndoorLayer.clearRouteLevels(map);
}

// ===== Viewport padding (bottom sheets / popups occlude the map) =====
// Persistent camera padding so every easeTo/fitBounds keeps the focal point
// in the *visible* part of the map, above whatever chrome covers the bottom.
const viewportPadding = { top: 0, right: 0, bottom: 0, left: 0 };

/** Set the bottom inset (px) occluded by mobile chrome; applied to all camera moves. */
export function setBottomInset(px: number): void {
  viewportPadding.bottom = Math.max(0, Math.round(px));
  map?.setPadding(viewportPadding);
}

// ===== Fit camera to a route's bounding box =====
/** Frame the whole route so a find never finishes off-screen. Preserves 3D tilt. */
export function fitRouteBounds(coordinates: GeoJSON.Position[]): void {
  if (!map || !coordinates || coordinates.length < 2) return;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const c of coordinates) {
    if (c[0] < minLng) minLng = c[0];
    if (c[0] > maxLng) maxLng = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  }
  if (!isFinite(minLng)) return;

  const PAD = 64;
  // Cap bottom padding so top+bottom can't exceed the viewport height — past
  // that, cameraForBounds returns null and the fit silently no-ops (e.g. a
  // tall bottom-sheet inset on a short landscape viewport).
  const canvasH = map.getCanvas().clientHeight || window.innerHeight;
  const maxBottom = Math.max(0, canvasH - PAD - 40);
  const padding = {
    top: PAD + viewportPadding.top,
    right: PAD + viewportPadding.right,
    bottom: Math.min(PAD + viewportPadding.bottom, maxBottom),
    left: PAD + viewportPadding.left,
  };
  // cameraForBounds + easeTo (instead of fitBounds) so the current pitch is
  // preserved — fitBounds would flatten a 3D view.
  const cam = map.cameraForBounds([[minLng, minLat], [maxLng, maxLat]], {
    padding,
    bearing: map.getBearing(),
    maxZoom: MapConfig.routeFitMaxZoom,
  });
  if (!cam) return;
  map.easeTo({ ...cam, pitch: map.getPitch(), duration: MapConfig.flyToRoomDuration });
}

// ===== Floor-change (stairs/elevator) route markers =====
interface FloorTransitionPoint { lng: number; lat: number; fromLevel: number; toLevel: number; }
let transitionMarkers: maplibregl.Marker[] = [];

/** Drop a tappable marker wherever the route changes floor. */
export function showFloorTransitions(transitions: FloorTransitionPoint[]): void {
  clearFloorTransitions();
  if (!map) return;
  for (const t of transitions) {
    const up = t.toLevel > t.fromLevel;
    const el = document.createElement('button');
    el.className = 'floor-transition-marker';
    el.type = 'button';
    el.title = `${formatLevel(t.fromLevel)} → ${formatLevel(t.toLevel)} 층 이동`;
    el.innerHTML =
      `<span class="material-icons">${up ? 'arrow_upward' : 'arrow_downward'}</span>` +
      `<span class="ft-label">${formatLevel(t.toLevel)}</span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      handleLevelChange(t.toLevel);
      // Keep the PC floor wheel's active styling in sync.
      document.dispatchEvent(new CustomEvent('walkthroughLevelChange', { detail: { level: t.toLevel } }));
    });
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([t.lng, t.lat])
      .addTo(map);
    transitionMarkers.push(marker);
  }
}

/** Remove all floor-change markers (paired with route clear). */
export function clearFloorTransitions(): void {
  for (const m of transitionMarkers) m.remove();
  transitionMarkers = [];
}

// ===== Walkthrough facing wedge =====
// A rotating cone whose apex pins to the walkthrough position dot, showing which
// way the 360° view is looking — the key orientation cue in a featureless indoor
// sphere. DOM markers can't sit at altitude, so it would detach from the
// elevated route in 3D; shown only in flat (2D) mode.
let wedgeMarker: maplibregl.Marker | null = null;
let wedgeAdded = false;
let wedgeLngLat: [number, number] | null = null;
let wedgeHeading = 0;

function ensureWedge(): void {
  if (wedgeMarker || !map) return;
  const el = document.createElement('div');
  el.className = 'walkthrough-wedge';
  // The element IS the down-pointing triangle; anchor 'bottom' pins its apex
  // (bottom-center) to the lnglat and rotates around that apex. rotationAlignment
  // 'map' tracks the compass heading as the map is rotated.
  wedgeMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', rotationAlignment: 'map', pitchAlignment: 'map' });
}

function applyWedge(): void {
  if (!map) return;
  if (!wedgeLngLat || !flatMode) {
    wedgeMarker?.remove();
    wedgeAdded = false;
    return;
  }
  ensureWedge();
  if (!wedgeMarker) return;
  wedgeMarker.setLngLat(wedgeLngLat).setRotation(wedgeHeading);
  if (!wedgeAdded) { wedgeMarker.addTo(map); wedgeAdded = true; }
}

/** Position the facing wedge and point it along `headingDeg` (compass degrees). */
export function setWalkthroughCursor(lngLat: [number, number], headingDeg: number): void {
  wedgeLngLat = lngLat;
  wedgeHeading = headingDeg;
  applyWedge();
}

/** Update only the wedge rotation (called as the user looks around). */
export function setWalkthroughHeading(headingDeg: number): void {
  wedgeHeading = headingDeg;
  if (wedgeMarker && wedgeAdded) wedgeMarker.setRotation(headingDeg);
}

/** Remove the facing wedge (paired with walkthrough close). */
export function clearWalkthroughCursor(): void {
  wedgeMarker?.remove();
  wedgeMarker = null;
  wedgeAdded = false;
  wedgeLngLat = null;
}

function setupRoomClick(): void {
  if (!map) return;

  // Click handlers attach only to the merged `-rooms-active` layer per
  // building. The active layer's `_level == currentLevel` filter eliminates
  // cross-floor hit-testing naturally — no per-level guard needed. The
  // `-below` layers stay click-inert.
  for (const building of BackendService.getBuildingCodes()) {
    const layerId = `${building}-rooms-active`;
    if (!map.getLayer(layerId)) continue;

    map.on('click', layerId, (e) => {
      if (performance.now() < suppressClickUntil) return; // mobile long-press ate this click
      // During a walkthrough the blue route line sits on top and owns the tap
      // (seek-to-here); don't also pop the room behind it.
      if (RouteOverlay.isRouteSeekEnabled() && RouteOverlay.pickRouteCoordinate(e.point.x, e.point.y)) return;
      if (!e.features || e.features.length === 0) return;
      const feature = e.features[0];
      const ref = feature.properties?.ref;
      if (!ref) return;

      document.dispatchEvent(new CustomEvent('roomClicked', {
        detail: {
          ref,
          name: feature.properties?.name ?? '',
          roomType: feature.properties?.room_type ?? '',
          level: IndoorLayer.getCurrentLevel(),
          screenX: e.point.x,
          screenY: e.point.y + 56, // offset by header height
        },
      }));
    });

    map.on('contextmenu', layerId, (e) => {
      if (!e.features || e.features.length === 0) return;
      const ref = e.features[0].properties?.ref;
      if (!ref) return;
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('roomRightClicked', { detail: { ref } }));
    });

    map.on('mouseenter', layerId, () => {
      if (map) map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', layerId, () => {
      if (map) map.getCanvas().style.cursor = '';
    });
  }
}

function showRoomInfoPopup(ref: string, feature: GeoJSON.Feature, center: number[]): void {
  const popup = document.getElementById('roomInfoPopup');
  const content = document.getElementById('roomInfoContent');
  if (!popup || !content || !map) return;

  const roomType = feature.properties?.room_type ?? '';
  const name = feature.properties?.name ?? '';
  const typeLabel = roomType ? (ROOM_TYPE_LABELS[roomType] ?? roomType) : '';

  content.innerHTML = `
    <div class="room-info-title">${ref}${name ? ` (${name})` : ''}</div>
    ${typeLabel ? `<div class="room-info-type">${typeLabel}</div>` : ''}
    <div class="room-info-level">${formatLevel(IndoorLayer.getCurrentLevel())}</div>
  `;

  // Convert lngLat to screen position
  const point = map.project(center as [number, number]);
  popup.style.left = `${point.x}px`;
  popup.style.top = `${point.y + 56 - 10}px`; // above the point
  popup.style.display = 'block';
}

function hideRoomInfoPopup(): void {
  const popup = document.getElementById('roomInfoPopup');
  if (popup) popup.style.display = 'none';
}

function initRoomInfoPopup(): void {
  const popup = document.getElementById('roomInfoPopup');
  const closeBtn = document.getElementById('roomInfoClose');
  if (!popup) return;

  // Close button
  closeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideRoomInfoPopup();
  });

  // Drag logic
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  popup.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).id === 'roomInfoClose') return;
    dragging = true;
    offsetX = e.clientX - popup.getBoundingClientRect().left;
    offsetY = e.clientY - popup.getBoundingClientRect().top;
    popup.classList.add('dragging');
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    popup.style.left = `${e.clientX - offsetX}px`;
    popup.style.top = `${e.clientY - offsetY}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    popup.classList.remove('dragging');
  });
}

function setupMiddleClickPan(m: maplibregl.Map): void {
  const canvas = m.getCanvas();
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return; // middle button only
    e.preventDefault();
    panning = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!panning) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    m.panBy([-dx, -dy], { animate: false });
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 1) return;
    panning = false;
    canvas.style.cursor = '';
  });

  // Prevent default middle-click scroll behavior
  canvas.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });
}

// MapLibre's TwoFingersTouchPitchHandler has two over-strict rules that make
// the pitch gesture flaky on touch:
//   1. _start sets _valid=false the moment fingers are stacked vertically.
//   2. gestureBeginsVertically requires BOTH finger vectors to be individually
//      vertical-dominant — natural hand jitter on either finger disqualifies
//      the gesture forever (since _valid is one-shot).
// Override those checks on the handler instance so the gesture commits when
// the average motion is vertical-dominant and both fingers move the same way.
// We leave the rest (handler-manager wiring, zoom/rotate handlers) alone, so
// pinch and twist gestures continue to work as before.
function relaxTouchPitch(m: maplibregl.Map): void {
  const handler = (m as any).touchPitch;
  if (!handler) return;

  handler._start = function (points: any) {
    this._lastPoints = points;
  };

  handler.gestureBeginsVertically = function (vectorA: any, vectorB: any, timeStamp: number) {
    if (this._valid !== undefined) return this._valid;

    const threshold = 2;
    const movedA = vectorA.mag() >= threshold;
    const movedB = vectorB.mag() >= threshold;
    if (!movedA && !movedB) return undefined;

    if (!movedA || !movedB) {
      if (this._firstMove === undefined) this._firstMove = timeStamp;
      if (timeStamp - this._firstMove < 100) return undefined;
      const v = movedA ? vectorA : vectorB;
      return Math.abs(v.y) > Math.abs(v.x);
    }

    const sameDirection = (vectorA.y > 0) === (vectorB.y > 0);
    if (!sameDirection) return false;

    const sumX = vectorA.x + vectorB.x;
    const sumY = vectorA.y + vectorB.y;
    return Math.abs(sumY) > Math.abs(sumX);
  };
}
