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
import { MOBILE_IDS } from './mobileChrome';
import * as GeoMap from '../components/geoMap';
import * as WalkthroughOverlay from '../components/walkthroughOverlay';

const PEEK_VISIBLE_PX = 88;

export function initWalkthroughSheet(): void {
  const sheet = getSheet();

  // Dedicated close button: dismiss the 360° walkthrough but KEEP the route on
  // the map. Removing the route is a separate, explicit action (clear FAB).
  document.getElementById(MOBILE_IDS.sheetClose)?.addEventListener('click', () => {
    WalkthroughOverlay.hideWalkthroughOverlay();
  });

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
  // Dragging the sheet down to `hidden` dismisses the walkthrough but KEEPS
  // the route — accidental drags no longer wipe the user's start/end.
  sheet.onStateChange((state: SheetState) => {
    applyMapPadding(state);
    if (state === 'hidden') {
      WalkthroughOverlay.hideWalkthroughOverlay();
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

  // Single source of truth for camera padding (centerMapToBuilding / flyTo /
  // fitRouteBounds all read it), so the focal point stays above the sheet.
  GeoMap.setBottomInset(bottom);
}
