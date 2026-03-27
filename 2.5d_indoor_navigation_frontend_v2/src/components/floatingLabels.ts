import maplibregl from 'maplibre-gl';
import * as BackendService from '../services/backendService';

/**
 * FloatingLabels — HTML div overlay for 3D-positioned room labels
 *
 * MapLibre symbol layers don't support per-feature elevation.
 * This module renders room labels as HTML divs, positioned each frame
 * using MercatorCoordinate + pixelMatrix3D projection.
 *
 * Only active in 3D mode. In 2D mode, the native symbol layer is used.
 */

interface LabelEntry {
  el: HTMLDivElement;
  lngLat: [number, number];
  altitude: number;
  ref: string;
}

let map: maplibregl.Map | null = null;
let container: HTMLDivElement | null = null;
let labels: LabelEntry[] = [];
let active = false;

/** Initialize the floating label system */
export function init(mapInstance: maplibregl.Map): void {
  map = mapInstance;

  // Create overlay container inside map's container
  container = document.createElement('div');
  container.className = 'floating-labels-container';
  map.getContainer().appendChild(container);

  // Update label positions on every render frame
  map.on('render', updatePositions);
}

/** Show floating labels for a specific level at a given altitude */
export function updateLabels(level: number, is3D: boolean, altitude: number): void {
  if (!container) return;

  // Clear existing labels
  clearLabels();

  if (!is3D) {
    active = false;
    return;
  }

  active = true;

  // Get room features for this level
  const roomFeatures = BackendService.getRoomFeaturesForLevel(level);

  for (const f of roomFeatures) {
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
    if (!f.properties.ref) continue;

    const coords = f.geometry.type === 'Polygon'
      ? (f.geometry as GeoJSON.Polygon).coordinates[0]
      : (f.geometry as GeoJSON.MultiPolygon).coordinates[0][0];

    const center = polygonCentroid(coords);

    const el = document.createElement('div');
    el.className = 'floating-label';
    el.textContent = f.properties.ref;
    container!.appendChild(el);

    labels.push({
      el,
      lngLat: center,
      altitude,
      ref: f.properties.ref,
    });
  }

  // Immediately position
  updatePositions();
}

/** Remove all floating labels */
export function clearLabels(): void {
  for (const label of labels) {
    label.el.remove();
  }
  labels = [];
}

/** Destroy the entire system */
export function destroy(): void {
  clearLabels();
  if (map) {
    map.off('render', updatePositions);
  }
  if (container) {
    container.remove();
    container = null;
  }
  map = null;
}

// ===== Core: project 3D positions to screen and update DOM =====

function updatePositions(): void {
  if (!map || !active || labels.length === 0) return;

  const transform = (map as any).transform;
  const zoom = map.getZoom();
  const fontSize = interpolateFontSize(zoom);
  const canvas = map.getCanvas();
  const viewW = canvas.clientWidth;
  const viewH = canvas.clientHeight;

  for (const label of labels) {
    // Use MapLibre's internal coordinatePoint with altitude-aware MercatorCoordinate
    const pos = project3D(transform, label.lngLat, label.altitude);

    if (pos && pos.x >= -100 && pos.x <= viewW + 100 && pos.y >= -100 && pos.y <= viewH + 100) {
      label.el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%)`;
      label.el.style.fontSize = `${fontSize}px`;
      label.el.style.display = '';
    } else {
      label.el.style.display = 'none';
    }
  }
}

/** Project a lngLat + altitude to screen coordinates.
 * Uses MapLibre's coordinatePoint with pixelMatrix3D — the same path
 * as locationPoint + terrain, so elevation stays in sync with fill-extrusion. */
function project3D(transform: any, lngLat: [number, number], altitudeMeters: number): { x: number, y: number } | null {
  try {
    const mc = maplibregl.MercatorCoordinate.fromLngLat(lngLat, 0);
    const p = transform.coordinatePoint(mc, altitudeMeters, transform.pixelMatrix3D);
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}

function interpolateFontSize(zoom: number): number {
  // Match the symbol layer's text-size stops: 19.5→9, 20→12, 20.5→14, 21→16
  if (zoom <= 19.5) return 9;
  if (zoom >= 21) return 16;
  if (zoom <= 20) return 9 + (zoom - 19.5) / 0.5 * 3;      // 9→12
  if (zoom <= 20.5) return 12 + (zoom - 20) / 0.5 * 2;     // 12→14
  return 14 + (zoom - 20.5) / 0.5 * 2;                      // 14→16
}

function polygonCentroid(coords: number[][]): [number, number] {
  let sumLng = 0, sumLat = 0;
  const len = coords.length - 1; // exclude closing coordinate
  for (let i = 0; i < len; i++) {
    sumLng += coords[i][0];
    sumLat += coords[i][1];
  }
  return [sumLng / len, sumLat / len];
}
