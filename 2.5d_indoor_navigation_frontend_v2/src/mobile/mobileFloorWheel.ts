/**
 * Mobile floor wheel — wheel-style picker.
 *
 * Viewport shows the active floor centered with one floor visible above and
 * below. The inner stack is translated so the active item lands in the middle
 * slot. Drag the wheel up/down to advance floors; releasing snaps to the
 * nearest item. Tapping a visible neighbour also jumps a floor.
 *
 * Direction: dragging DOWN brings whatever was above into the center (a
 * higher floor), like spinning a physical wheel. `levels` arrives in
 * descending order (top of wheel = highest floor) so "higher floor" means
 * "smaller index" in the array.
 */

import { MOBILE_IDS } from './mobileChrome';
import * as BackendService from '../services/backendService';
import * as GeoMap from '../components/geoMap';
import { formatLevel } from '../utils/formatLevel';

const ITEM_HEIGHT = 44;
// Index of the visible "center" slot inside the 3-row viewport.
const CENTER_SLOT = 1;

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
    btn.textContent = formatLevel(level);
    btn.dataset.level = String(level);
    btn.addEventListener('click', () => {
      // Skip the click if a drag was in progress — onUp resets dragging
      // before the synthetic click would fire.
      if (wheel.classList.contains('was-dragging')) return;
      GeoMap.handleLevelChange(level);
      updateActive(wheel, inner, level, levels);
    });
    inner.appendChild(btn);
  }

  attachDragToChange(wheel, inner, levels);

  // Initial active state
  updateActive(wheel, inner, GeoMap.getCurrentLevel(), levels);

  // Sync with external level changes (walkthrough, map calls). The drag
  // handler commits the level live as the wheel rotates, so while a drag
  // is active we skip the snap-to-active transform — onMove is already
  // managing the inner offset to follow the finger.
  document.addEventListener('levelChanged', () => {
    if (wheel.classList.contains('dragging')) return;
    updateActive(wheel, inner, GeoMap.getCurrentLevel(), levels);
  });
  document.addEventListener('walkthroughLevelChange', ((e: CustomEvent) => {
    if (wheel.classList.contains('dragging')) return;
    const level = e.detail?.level;
    if (typeof level === 'number') updateActive(wheel, inner, level, levels);
  }) as EventListener);
}

/** Snap the inner stack so item[activeIdx] sits in the center slot, and
 *  re-apply active/adjacent/far classes around it. */
function updateActive(wheel: HTMLElement, inner: HTMLElement, activeLevel: number, levels: number[]): void {
  const activeIdx = levels.indexOf(activeLevel);
  if (activeIdx < 0) return;
  inner.style.transform = `translateY(${(CENTER_SLOT - activeIdx) * ITEM_HEIGHT}px)`;
  applyClasses(wheel, activeIdx);
}

/** Hierarchy-only update — used during drag so the class on the visually-
 *  centered item tracks the finger without committing the level change. */
function applyClasses(wheel: HTMLElement, centerIdx: number): void {
  wheel.querySelectorAll<HTMLButtonElement>('.m-floor-item').forEach((btn, i) => {
    btn.classList.remove('active', 'adjacent', 'far');
    const dist = Math.abs(i - centerIdx);
    if (dist === 0) btn.classList.add('active');
    else if (dist === 1) btn.classList.add('adjacent');
    else btn.classList.add('far');
  });
}

/** Pointer-driven drag: while held, follow the finger and update the active
 *  highlight under the center slot. On release, snap to whichever floor was
 *  last under the finger — what you saw is what you land on. Suppresses the
 *  synthetic click that would otherwise fire after a drag-release. */
function attachDragToChange(wheel: HTMLElement, inner: HTMLElement, levels: number[]): void {
  let activeId: number | null = null;
  let startY = 0;
  let startIdx = 0;
  let startOffset = 0;
  // The floor index currently shown as active under the finger. Captured each
  // onMove so onUp can use it directly without recomputing from dy — that
  // guarantees the released floor matches what the user saw mid-drag.
  let lastVisualIdx = 0;
  let moved = false;

  const onDown = (e: PointerEvent) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    startY = e.clientY;
    moved = false;
    startIdx = Math.max(0, levels.indexOf(GeoMap.getCurrentLevel()));
    startOffset = (CENTER_SLOT - startIdx) * ITEM_HEIGHT;
    lastVisualIdx = startIdx;
    try { wheel.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 4 && !moved) {
      moved = true;
      wheel.classList.add('dragging');
    }
    if (!moved) return;

    // Drag DOWN (dy > 0) → wheel rotates so a higher floor (smaller idx)
    // moves into the center. Inner follows the finger 1:1.
    inner.style.transform = `translateY(${startOffset + dy}px)`;

    const visualIdx = clamp(startIdx - Math.round(dy / ITEM_HEIGHT), 0, levels.length - 1);
    lastVisualIdx = visualIdx;
    applyClasses(wheel, visualIdx);
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    if (!moved) return;

    wheel.classList.remove('dragging');
    wheel.classList.add('was-dragging');
    setTimeout(() => wheel.classList.remove('was-dragging'), 150);

    // Land on the floor that was last shown as active under the finger.
    // Always re-snap the inner transform so any sub-pixel drag offset
    // animates cleanly into place via the CSS transition that re-enables
    // when .dragging is removed.
    const targetLevel = levels[lastVisualIdx];
    updateActive(wheel, inner, targetLevel, levels);
    if (targetLevel !== GeoMap.getCurrentLevel()) {
      GeoMap.handleLevelChange(targetLevel);
    }
  };

  wheel.addEventListener('pointerdown', onDown);
  wheel.addEventListener('pointermove', onMove);
  wheel.addEventListener('pointerup', onUp);
  wheel.addEventListener('pointercancel', onUp);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
