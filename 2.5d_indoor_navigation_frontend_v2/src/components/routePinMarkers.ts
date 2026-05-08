import maplibregl from 'maplibre-gl';
import { WebMercatorViewport } from '@deck.gl/core';
import * as BackendService from '../services/backendService';
import * as RouteActions from '../services/routeActions';
import * as GeoMap from './geoMap';
import { getLevelBase, ROOM_THICKNESS } from './indoorLayer';
import { MapConfig } from '../config/mapConfig';
import type { RouteEndpoint } from '../services/routeActions';

/**
 * RoutePinMarkers — draggable start/end pins on the MapLibre map.
 *
 * Two MapLibre native markers (start = blue, end = red) reflect the current
 * `RouteEndpoint` state from `routeActions`. Dragging a marker repositions
 * the underlying coord-endpoint and auto-triggers re-routing once both
 * slots are filled. Picking a room (autocomplete or popup) resolves the
 * room ref to its centroid and positions the marker there.
 */

type Slot = 'start' | 'end';

let map: maplibregl.Map | null = null;
let startMarker: maplibregl.Marker | null = null;
let endMarker: maplibregl.Marker | null = null;
let startMarkerLevel: number | null = null;
let endMarkerLevel: number | null = null;

function rgbCss(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function makePinElement(slot: Slot): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = `route-pin-marker route-pin-marker-${slot}`;
  const color = slot === 'start' ? rgbCss(MapConfig.route.startColor) : rgbCss(MapConfig.route.endColor);
  wrap.style.setProperty('--pin-color', color);
  const bubble = document.createElement('div');
  bubble.className = 'route-pin-bubble';
  bubble.textContent = slot === 'start' ? '출발' : '도착';
  const stem = document.createElement('div');
  stem.className = 'route-pin-stem';
  wrap.appendChild(bubble);
  wrap.appendChild(stem);
  return wrap;
}

export function init(mapInstance: maplibregl.Map): void {
  map = mapInstance;
  document.addEventListener('routeEndpointChanged', syncFromState);
  document.addEventListener('levelChanged', () => {
    updateOpacity();
    updateAltitudeOffsets();
  });
  // Marker DOM is anchored at [lng, lat] (ground); to make the pin track
  // its floor's altitude in 3D we project [lng, lat, alt] vs [lng, lat, 0]
  // each frame and feed the delta back through `marker.setOffset`.
  mapInstance.on('move', updateAltitudeOffsets);
  syncFromState();
}

function resolveToCoord(ep: RouteEndpoint): { lng: number; lat: number; level: number | null } | null {
  if (ep.kind === 'coord') {
    return { lng: ep.lng, lat: ep.lat, level: ep.level };
  }
  const centroid = BackendService.getRoomCentroid(ep.ref);
  if (!centroid) return null;
  const level = BackendService.getRoomLevel(ep.ref);
  return { lng: centroid[0], lat: centroid[1], level };
}

function syncFromState(): void {
  if (!map) return;
  const { start, end } = RouteActions.getEndpoints();
  syncSlot('start', start);
  syncSlot('end', end);
  updateOpacity();
}

function getMarker(slot: Slot): maplibregl.Marker | null {
  return slot === 'start' ? startMarker : endMarker;
}

function setMarker(slot: Slot, m: maplibregl.Marker | null, level: number | null): void {
  if (slot === 'start') { startMarker = m; startMarkerLevel = level; }
  else { endMarker = m; endMarkerLevel = level; }
}

function syncSlot(slot: Slot, ep: RouteEndpoint | null): void {
  if (!map) return;
  let marker = getMarker(slot);

  if (!ep) {
    if (marker) marker.remove();
    setMarker(slot, null, null);
    return;
  }

  const resolved = resolveToCoord(ep);
  if (!resolved) {
    // Couldn't resolve — likely the user typed an unknown ref. Hide for now.
    if (marker) marker.remove();
    setMarker(slot, null, null);
    return;
  }

  if (!marker) {
    marker = new maplibregl.Marker({
      element: makePinElement(slot),
      draggable: true,
      anchor: 'bottom',
    });
    marker.on('dragend', () => onDragEnd(slot));
    marker.on('drag', () => updateAltitudeOffsetForSlot(slot));
    // Set position before addTo — otherwise the marker briefly renders at
    // (0, 0) for one frame between attachment and the first setLngLat.
    marker.setLngLat([resolved.lng, resolved.lat]);
    marker.setOffset(computeOffset(resolved.lng, resolved.lat, resolved.level));
    marker.addTo(map);
  } else {
    // Avoid writing back the same position during the dragend → setStartCoord
    // → routeEndpointChanged → syncFromState reentrancy: if the marker is
    // already within ~1µ° of the resolved coord (~0.1m), skip the write.
    const cur = marker.getLngLat();
    const dx = Math.abs(cur.lng - resolved.lng);
    const dy = Math.abs(cur.lat - resolved.lat);
    if (dx > 1e-6 || dy > 1e-6) {
      marker.setLngLat([resolved.lng, resolved.lat]);
    }
  }
  setMarker(slot, marker, resolved.level);
  updateAltitudeOffsetForSlot(slot);
}

function onDragEnd(slot: Slot): void {
  const marker = getMarker(slot);
  if (!marker) return;
  const { lng, lat } = marker.getLngLat();
  const level = GeoMap.getCurrentLevel();
  if (slot === 'start') RouteActions.setStartCoord(lng, lat, level);
  else RouteActions.setEndCoord(lng, lat, level);
  maybeAutoRoute();
}

/** Drop a pin from a chip-drag at the given lng/lat. Used by the map drop handler. */
export function dropPin(slot: Slot, lng: number, lat: number): void {
  const level = GeoMap.getCurrentLevel();
  if (slot === 'start') RouteActions.setStartCoord(lng, lat, level);
  else RouteActions.setEndCoord(lng, lat, level);
  maybeAutoRoute();
}

function maybeAutoRoute(): void {
  const { start, end } = RouteActions.getEndpoints();
  if (start && end) {
    RouteActions.triggerFindRoute().catch(err => {
      if (err?.name !== 'AbortError') console.error('[Pins] auto-route failed:', err);
    });
  }
}

function updateOpacity(): void {
  const curLevel = GeoMap.getCurrentLevel();
  applyOpacity(startMarker, startMarkerLevel, curLevel);
  applyOpacity(endMarker, endMarkerLevel, curLevel);
}

function applyOpacity(marker: maplibregl.Marker | null, markerLevel: number | null, curLevel: number): void {
  if (!marker) return;
  const el = marker.getElement();
  el.style.opacity = (markerLevel != null && markerLevel !== curLevel) ? '0.45' : '1';
}

/**
 * Project the marker's [lng, lat, altitude] through a deck.gl viewport that
 * mirrors MapLibre's camera, then return the screen-space delta from the
 * ground projection. In 2D mode (or with no level) the delta is zero.
 *
 * deck.gl ships with `MapboxOverlay` interleaved into this map, so a
 * `WebMercatorViewport` constructed from the same camera state projects
 * identically — adding the delta on top of MapLibre's ground projection is
 * equivalent to projecting the elevated point natively.
 */
function computeOffset(lng: number, lat: number, level: number | null): [number, number] {
  if (!map) return [0, 0];
  if (GeoMap.isFlatMode() || level == null) return [0, 0];
  const center = map.getCenter();
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return [0, 0];
  const viewport = new WebMercatorViewport({
    longitude: center.lng,
    latitude: center.lat,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
    width,
    height,
  });
  const altitude = getLevelBase(level) + ROOM_THICKNESS + 0.5;
  const ground = viewport.project([lng, lat, 0]);
  const top = viewport.project([lng, lat, altitude]);
  return [top[0] - ground[0], top[1] - ground[1]];
}

function updateAltitudeOffsetForSlot(slot: Slot): void {
  const marker = getMarker(slot);
  if (!marker) return;
  const level = slot === 'start' ? startMarkerLevel : endMarkerLevel;
  const { lng, lat } = marker.getLngLat();
  marker.setOffset(computeOffset(lng, lat, level));
}

function updateAltitudeOffsets(): void {
  updateAltitudeOffsetForSlot('start');
  updateAltitudeOffsetForSlot('end');
}
