/**
 * Mobile floating action cluster — compass, zoom +/-, recenter, 3D toggle,
 * share, clear route. Plus the route-summary pill (distance + ETA + swap).
 *
 * The clear-route button only appears while a route is active. The compass
 * button only appears while the map is rotated (tap → reset to north).
 */

import { MOBILE_IDS } from './mobileChrome';
import * as GeoMap from '../components/geoMap';
import * as BackendService from '../services/backendService';
import * as RouteActions from '../services/routeActions';
import { shareCurrentView } from '../services/urlState';

const OFF_CENTER_DEG = 0.0006; // ~60m — beyond this the recenter FAB lights up

export function initMobileActions(): void {
  const center = document.getElementById(MOBILE_IDS.actCenter);
  const toggle3D = document.getElementById(MOBILE_IDS.act3D);
  const zoomIn = document.getElementById(MOBILE_IDS.actZoomIn);
  const zoomOut = document.getElementById(MOBILE_IDS.actZoomOut);
  const compass = document.getElementById(MOBILE_IDS.actCompass);
  const share = document.getElementById(MOBILE_IDS.actShare);
  const clear = document.getElementById(MOBILE_IDS.actClear);
  const summary = document.getElementById(MOBILE_IDS.routeSummary);

  center?.addEventListener('click', () => {
    GeoMap.centerMapToBuilding();
  });

  toggle3D?.addEventListener('click', () => {
    GeoMap.toggle3D();
    const is3D = !GeoMap.isFlatMode();
    toggle3D.classList.toggle('active', is3D);
    const icon = toggle3D.querySelector('.material-icons');
    if (icon) icon.textContent = is3D ? 'map' : '3d_rotation';
  });

  zoomIn?.addEventListener('click', () => GeoMap.getMap()?.zoomIn());
  zoomOut?.addEventListener('click', () => GeoMap.getMap()?.zoomOut());
  compass?.addEventListener('click', () => GeoMap.getMap()?.resetNorth());

  share?.addEventListener('click', async () => {
    const result = await shareCurrentView();
    if (result === 'copied') toast('링크가 복사되었습니다');
    else if (result === 'failed') toast('공유에 실패했습니다');
  });

  clear?.addEventListener('click', () => {
    RouteActions.clearRoute();
  });

  // ===== Compass + recenter state, driven by camera moves =====
  const map = GeoMap.getMap();
  const buildingCenter = BackendService.getMapCenter();
  const compassIcon = compass?.querySelector<HTMLElement>('.material-icons');
  const centerIcon = center?.querySelector<HTMLElement>('.material-icons');

  const updateCameraState = (): void => {
    if (!map) return;
    const bearing = map.getBearing();
    const pitch = map.getPitch();
    // Compass: visible only when rotated/tilted; needle points to north.
    const rotated = Math.abs(bearing) > 1 || pitch > 1;
    compass?.setAttribute('data-visible', rotated ? 'true' : 'false');
    if (compassIcon) compassIcon.style.transform = `rotate(${-bearing}deg)`;
    // Recenter: light up when the map has drifted from the building.
    const c = map.getCenter();
    const drifted = Math.abs(c.lng - buildingCenter[0]) > OFF_CENTER_DEG
      || Math.abs(c.lat - buildingCenter[1]) > OFF_CENTER_DEG;
    center?.classList.toggle('m-act--active', drifted);
    if (centerIcon) centerIcon.textContent = drifted ? 'gps_fixed' : 'center_focus_weak';
  };
  map?.on('move', updateCameraState);
  map?.on('rotate', updateCameraState);
  map?.on('pitch', updateCameraState);
  updateCameraState();

  // ===== Route summary pill (distance + ETA + swap) =====
  const summaryText = summary?.querySelector<HTMLElement>('.m-route-summary-text');
  summary?.querySelector('.m-route-summary-swap')?.addEventListener('click', () => {
    RouteActions.swapEndpoints();
  });

  document.addEventListener('routeFound', (e) => {
    clear?.setAttribute('data-visible', 'true');
    const d = (e as CustomEvent<{ estimatedTime?: string; totalDistance?: number }>).detail;
    if (summary && summaryText && d) {
      summaryText.textContent = `${d.estimatedTime ?? ''} · ${Math.round(d.totalDistance ?? 0)}m`;
      summary.setAttribute('data-visible', 'true');
    }
  });
  document.addEventListener('routeCleared', () => {
    clear?.setAttribute('data-visible', 'false');
    summary?.setAttribute('data-visible', 'false');
  });
  // If endpoints were cleared (e.g. both inputs blank), hide route UI too.
  document.addEventListener('routeEndpointChanged', () => {
    const { start, end } = RouteActions.getEndpoints();
    if (!start && !end) {
      clear?.setAttribute('data-visible', 'false');
      summary?.setAttribute('data-visible', 'false');
    }
  });
}

/** Fire a generic mobile toast (consumed by mobileToast). */
function toast(message: string): void {
  document.dispatchEvent(new CustomEvent('mToast', { detail: { message } }));
}
