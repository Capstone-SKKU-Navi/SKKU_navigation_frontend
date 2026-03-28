import maplibregl from 'maplibre-gl';
import * as BackendService from '../services/backendService';
import * as IndoorLayer from './indoorLayer';
import * as RouteOverlay from './routeOverlay';
import * as FloatingLabels from './floatingLabels';
import { MapConfig } from '../config/mapConfig';

/**
 * GeoMap — MapLibre GL JS based map component
 *
 * Replaces Maptalks + Three.js dual-canvas architecture with a single
 * WebGL2 context. All static geometry uses MapLibre fill-extrusion,
 * dynamic overlays use deck.gl via MapboxOverlay (interleaved mode).
 */

let map: maplibregl.Map | null = null;
let flatMode = true; // start in 2D

export function getMap(): maplibregl.Map | null {
  return map;
}

export function isFlatMode(): boolean {
  return flatMode;
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
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

  // Middle-click (wheel button) drag to pan
  setupMiddleClickPan(map);

  map.on('load', () => {
    try {
      IndoorLayer.addIndoorLayers(map!);
      FloatingLabels.init(map!);
      RouteOverlay.initOverlay(map!);
      setupRoomClick();
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
}

function setupRoomClick(): void {
  if (!map) return;

  // Make room layers clickable
  const levels = BackendService.getAllLevels();

  for (const level of levels) {
    const layerId = `floor-${level}-rooms-3d`;
    if (!map.getLayer(layerId)) continue; // layer might not exist yet

    map.on('click', layerId, (e) => {
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

    // Change cursor on hover
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
  const typeLabel = roomType ? getRoomTypeLabel(roomType) : '';

  content.innerHTML = `
    <div class="room-info-title">${ref}${name ? ` (${name})` : ''}</div>
    ${typeLabel ? `<div class="room-info-type">${typeLabel}</div>` : ''}
    <div class="room-info-level">${IndoorLayer.getCurrentLevel()}F</div>
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

function getRoomTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    classroom: '교실',
    lab: '실험실',
    restroom: '화장실',
    office: '사무실',
    stairs: '계단',
    elevator: '엘리베이터',
  };
  return labels[type] ?? type;
}

function polygonCenter(coords: number[][]): number[] {
  let sumLng = 0, sumLat = 0;
  const len = coords.length - 1;
  for (let i = 0; i < len; i++) {
    sumLng += coords[i][0];
    sumLat += coords[i][1];
  }
  return [sumLng / len, sumLat / len];
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
