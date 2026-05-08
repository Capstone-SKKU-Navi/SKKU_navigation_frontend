/**
 * Mobile chrome entry point.
 *
 * Loaded only on mobile via dynamic `import('./mobile')` from main.ts.
 * Never referenced by PC code.
 *
 * Modules are wired in incrementally as each phase lands.
 */

import { buildMobileChrome } from './mobileChrome';
import { initRoomPopup } from './roomPopupMobile';
import { initRadialMenu } from './radialMenu';
import { initActionChipRow } from './actionChipRow';
import { initFloorWheel } from './mobileFloorWheel';
import { initSearchModal } from './searchModal';
import { initWalkthroughSheet } from './walkthroughSheet';
import { initMobileActions } from './mobileActions';
import { initMobileToast } from './mobileToast';

export function setupMobileChrome(): void {
  buildMobileChrome();

  // Phase 2: map-surface gestures
  initRoomPopup();
  initRadialMenu();
  initActionChipRow();

  // Phase 3: navigation chrome
  initFloorWheel();
  initSearchModal();
  initMobileActions();
  initMobileToast();

  // Phase 4: walkthrough bottom sheet
  initWalkthroughSheet();
}
