/**
 * Walkthrough sheet — hosts the existing `walkthroughOverlay` DOM inside
 * the mobile bottom sheet.
 *
 * Strategy: listen for `walkthroughShown` (dispatched by
 * walkthroughOverlay.showWalkthroughOverlay), intercept the created
 * overlay element, and reparent it into the bottom sheet's content slot.
 * The overlay's own drag/resize/close chrome is hidden via CSS on mobile.
 *
 * Also syncs `map.setPadding({ bottom })` so camera-follow centers the
 * map on the area above the sheet, not the geometric viewport center
 * (half of which is hidden by the sheet).
 */

import { getSheet, type SheetState } from './bottomSheet';
import * as GeoMap from '../components/geoMap';
import * as RouteActions from '../services/routeActions';

const PEEK_VISIBLE_PX = 88;

export function initWalkthroughSheet(): void {
  const sheet = getSheet();

  document.addEventListener('walkthroughShown', ((e: CustomEvent) => {
    const overlay = e.detail?.overlayEl as HTMLElement | undefined;
    if (!overlay) return;

    overlay.classList.add('in-mobile-sheet');
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.right = '0';
    overlay.style.bottom = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';

    sheet.content.innerHTML = '';
    sheet.content.appendChild(overlay);

    // Start at `half` so the user sees the video immediately
    sheet.setState('half');
    applyMapPadding(sheet.getState());
  }) as EventListener);

  document.addEventListener('walkthroughHidden', () => {
    sheet.content.innerHTML = '';
    sheet.setState('hidden');
    applyMapPadding('hidden');
  });

  // Sheet state changes: update map padding so camera-follow and flyTo
  // operations treat the visible-above-sheet area as the centering target.
  // If the user drags the sheet down to `hidden`, that's a deliberate
  // cancel — clear the entire route, not just the walkthrough.
  sheet.onStateChange((state: SheetState) => {
    applyMapPadding(state);
    if (state === 'hidden') {
      RouteActions.clearRoute();
    }
  });

  // Route cleared from another surface (clear button, popup swipe) → sync sheet
  document.addEventListener('routeCleared', () => {
    sheet.setState('hidden');
  });
}

/**
 * Compute how many pixels at the viewport bottom are occluded by the sheet
 * and tell MapLibre to treat that area as outside the visible viewport for
 * centering/follow operations.
 */
function applyMapPadding(state: SheetState): void {
  const map = GeoMap.getMap();
  if (!map) return;

  const h = window.innerHeight;
  let bottom = 0;
  switch (state) {
    case 'full': bottom = h; break;
    case 'half': bottom = Math.round(h * 0.5); break;
    case 'peek': bottom = PEEK_VISIBLE_PX; break;
    case 'hidden':
    default: bottom = 0;
  }

  // Prevent padding from consuming the entire viewport (that would break
  // projection). Cap at 80% of viewport height.
  bottom = Math.min(bottom, Math.round(h * 0.8));

  map.setPadding({ top: 0, right: 0, bottom, left: 0 });
}
