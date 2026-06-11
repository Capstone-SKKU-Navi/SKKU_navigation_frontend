/**
 * Mobile floating action cluster — compass, zoom +/-, recenter, 3D toggle,
 * feedback, clear route. Plus the route-summary pill (distance + ETA + swap).
 *
 * The clear-route button only appears while a route is active. The compass
 * button only appears while the map is rotated (tap → reset to north).
 */

import { MOBILE_IDS } from './mobileChrome';
import * as GeoMap from '../components/geoMap';
import * as BackendService from '../services/backendService';
import * as RouteActions from '../services/routeActions';
import { setupFeedbackButton } from '../components/feedbackController';

const OFF_CENTER_DEG = 0.0006; // ~60m — beyond this the recenter FAB lights up

export function initMobileActions(): void {
  const actions = document.getElementById(MOBILE_IDS.actions);
  const menu = document.getElementById(MOBILE_IDS.actMenu);
  const center = document.getElementById(MOBILE_IDS.actCenter);
  const toggle3D = document.getElementById(MOBILE_IDS.act3D);
  const zoomIn = document.getElementById(MOBILE_IDS.actZoomIn);
  const zoomOut = document.getElementById(MOBILE_IDS.actZoomOut);
  const compass = document.getElementById(MOBILE_IDS.actCompass);
  const share = document.getElementById(MOBILE_IDS.actShare);
  const clear = document.getElementById(MOBILE_IDS.actClear);
  const summary = document.getElementById(MOBILE_IDS.routeSummary);

  const setMenuOpen = (open: boolean): void => {
    actions?.setAttribute('data-open', open ? 'true' : 'false');
    menu?.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  menu?.addEventListener('click', (e) => {
    e.stopPropagation();
    setMenuOpen(actions?.getAttribute('data-open') !== 'true');
  });

  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest(`#${MOBILE_IDS.actions}`)) {
      setMenuOpen(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenuOpen(false);
  });

  center?.addEventListener('click', () => {
    GeoMap.centerMapToBuilding();
    setMenuOpen(false);
  });

  toggle3D?.addEventListener('click', () => {
    GeoMap.toggle3D();
    const is3D = !GeoMap.isFlatMode();
    toggle3D.classList.toggle('active', is3D);
    const icon = toggle3D.querySelector('.material-icons');
    if (icon) icon.textContent = is3D ? 'map' : '3d_rotation';
    setMenuOpen(false);
  });

  zoomIn?.addEventListener('click', () => GeoMap.getMap()?.zoomIn());
  zoomOut?.addEventListener('click', () => GeoMap.getMap()?.zoomOut());
  compass?.addEventListener('click', () => {
    GeoMap.getMap()?.resetNorth();
    setMenuOpen(false);
  });

  if (share) {
    setupFeedbackButton(share, toast);
    share.addEventListener('click', () => setMenuOpen(false));
  }

  clear?.addEventListener('click', () => {
    RouteActions.clearRoute();
    setMenuOpen(false);
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

  // ===== Route summary pill (distance + ETA + walkthrough) =====
  const summaryText = summary?.querySelector<HTMLElement>('.m-route-summary-text');
  summary?.querySelector('.m-route-summary-video')?.addEventListener('click', () => {
    if (!RouteActions.showCurrentWalkthrough()) toast('워크스루 영상이 없습니다');
  });
  if (summary) setupRouteSummaryDrag(summary);

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

function setupRouteSummaryDrag(summary: HTMLElement): void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let moved = false;

  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

  summary.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    pointerId = e.pointerId;
    moved = false;
    const rect = summary.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    try { summary.setPointerCapture(e.pointerId); } catch { /* noop */ }
  });

  summary.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true;
    const rect = summary.getBoundingClientRect();
    const left = clamp(startLeft + dx, 8, window.innerWidth - rect.width - 8);
    const top = clamp(startTop + dy, 8, window.innerHeight - rect.height - 8);
    summary.dataset.dragged = 'true';
    summary.style.left = `${left}px`;
    summary.style.top = `${top}px`;
  });

  const release = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (moved) {
      const stop = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      summary.addEventListener('click', stop, { capture: true, once: true });
    }
  };

  summary.addEventListener('pointerup', release);
  summary.addEventListener('pointercancel', release);
}
