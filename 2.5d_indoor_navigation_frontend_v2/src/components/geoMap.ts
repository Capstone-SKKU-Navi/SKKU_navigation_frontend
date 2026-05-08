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
    dragRotate: true,
    touchPitch: true,
    doubleClickZoom: false, // prevent iOS Safari 300ms double-tap zoom stealing a second room tap
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

  // Middle-click (wheel button) drag to pan
  setupMiddleClickPan(map);

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

    // Show room info popup
    showRoomInfoPopup(ref, feature, center);
  }
}

/** Clear room highlight */
export function clearHighlight(): void {
  if (!map) return;
  IndoorLayer.highlightRoom(map, null);
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
