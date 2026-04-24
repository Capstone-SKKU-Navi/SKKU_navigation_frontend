/**
 * Mobile floor wheel — left-anchored vertical pill with swipe-to-scroll.
 *
 * Drag gesture advances by snapped item steps. Tap jumps to any level.
 * Syncs itself when the map level changes (levelChanged / walkthroughLevelChange).
 */

import { MOBILE_IDS } from './mobileChrome';
import { onVerticalWheelSwipe } from './gestures';
import * as BackendService from '../services/backendService';
import * as GeoMap from '../components/geoMap';

const ITEM_HEIGHT = 44;

export function initFloorWheel(): void {
  const wheel = document.getElementById(MOBILE_IDS.floorWheel);
  if (!wheel) return;

  const inner = wheel.querySelector('.m-floor-wheel-inner') as HTMLElement | null;
  if (!inner) return;

  // Backend returns levels descending e.g. [5,4,3,2,1]. Render as-is so
  // top of the wheel = highest floor, matching the PC wheel.
  const levels = BackendService.getAllLevels();
  if (levels.length === 0) return;

  for (const level of levels) {
    const btn = document.createElement('button');
    btn.className = 'm-floor-item';
    btn.textContent = `${level}F`;
    btn.dataset.level = String(level);
    btn.addEventListener('click', () => {
      GeoMap.handleLevelChange(level);
      updateActive(wheel, level);
    });
    inner.appendChild(btn);
  }

  // Vertical swipe on the wheel
  onVerticalWheelSwipe(wheel, (e) => {
    const current = GeoMap.getCurrentLevel();
    const idx = levels.indexOf(current);
    // `delta` positive = swipe up = higher floor. `levels` is descending, so
    // higher floor has a *lower* index.
    const nextIdx = clamp(idx - e.delta, 0, levels.length - 1);
    const nextLevel = levels[nextIdx];
    if (nextLevel !== current) {
      GeoMap.handleLevelChange(nextLevel);
      updateActive(wheel, nextLevel);
    }
  }, { itemHeight: ITEM_HEIGHT });

  // Initial active state
  updateActive(wheel, GeoMap.getCurrentLevel());

  // Sync with external level changes (walkthrough, map calls)
  document.addEventListener('levelChanged', () => {
    updateActive(wheel, GeoMap.getCurrentLevel());
  });
  document.addEventListener('walkthroughLevelChange', ((e: CustomEvent) => {
    const level = e.detail?.level;
    if (typeof level === 'number') updateActive(wheel, level);
  }) as EventListener);
}

function updateActive(wheel: HTMLElement, activeLevel: number): void {
  const levels = BackendService.getAllLevels();
  const activeIdx = levels.indexOf(activeLevel);
  wheel.querySelectorAll<HTMLButtonElement>('.m-floor-item').forEach((btn, i) => {
    btn.classList.remove('active', 'adjacent', 'far');
    const dist = Math.abs(i - activeIdx);
    if (dist === 0) btn.classList.add('active');
    else if (dist === 1) btn.classList.add('adjacent');
    else btn.classList.add('far');
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
