/**
 * Generic 3-state bottom sheet primitive.
 *
 * States:
 *   - hidden: fully off-screen.
 *   - peek:   ~88px visible strip at bottom (just the handle + summary).
 *   - half:   50vh visible.
 *   - full:   edge-to-edge (y=0).
 *
 * Drag semantics: pull the handle up/down. On release, snap to the nearest
 * state unless the flick velocity exceeds `FLICK_VELOCITY`, in which case
 * snap in the flick direction.
 *
 * Uses `translate3d` on `#mSheet` so we don't thrash layout. Scrollable
 * inner content is decoupled from the drag because the drag handler only
 * binds to the handle element.
 */

import { MOBILE_IDS } from './mobileChrome';
import { onDragSheet } from './gestures';

export type SheetState = 'hidden' | 'peek' | 'half' | 'full';

const PEEK_VISIBLE_PX = 88;
const FLICK_VELOCITY = 0.5; // px/ms
const SCREEN_ORDER: SheetState[] = ['full', 'half', 'peek', 'hidden'];

interface SheetController {
  readonly el: HTMLElement;
  readonly content: HTMLElement;
  getState(): SheetState;
  setState(state: SheetState): void;
  onStateChange(cb: (state: SheetState) => void): void;
}

let instance: SheetController | null = null;

export function getSheet(): SheetController {
  if (instance) return instance;
  instance = createSheet();
  return instance;
}

function createSheet(): SheetController {
  const el = document.getElementById(MOBILE_IDS.sheet);
  const handle = document.getElementById(MOBILE_IDS.sheetHandle);
  const content = document.getElementById(MOBILE_IDS.sheetContent);
  if (!el || !handle || !content) {
    throw new Error('Mobile sheet DOM not found — buildMobileChrome() must run first.');
  }

  let state: SheetState = 'hidden';
  const listeners: Array<(s: SheetState) => void> = [];

  const snapPoints = (): Record<Exclude<SheetState, 'hidden'>, number> => {
    const h = window.innerHeight;
    return {
      full: 0,
      half: Math.round(h * 0.5),
      peek: Math.max(0, h - PEEK_VISIBLE_PX),
    };
  };

  const applyY = (y: number): void => {
    el.style.setProperty('--sheet-y', `${y}px`);
  };

  const goTo = (next: SheetState): void => {
    state = next;
    el.setAttribute('data-state', next);
    if (next === 'hidden') {
      applyY(window.innerHeight);
    } else {
      applyY(snapPoints()[next]);
    }
    for (const cb of listeners) cb(next);
  };

  // Initial render
  goTo('hidden');

  // Drag handler on the handle only
  let dragStartY = 0;
  onDragSheet(handle, {
    onStart: () => {
      if (state === 'hidden') return;
      el.classList.add('dragging');
      dragStartY = snapPoints()[state];
    },
    onMove: (dy) => {
      if (state === 'hidden') return;
      const next = clamp(dragStartY + dy, 0, snapPoints().peek);
      applyY(next);
    },
    onEnd: (dy, velocity) => {
      if (state === 'hidden') return;
      el.classList.remove('dragging');
      const snaps = snapPoints();
      const current = clamp(dragStartY + dy, 0, snaps.peek);

      let target: SheetState;
      if (Math.abs(velocity) > FLICK_VELOCITY) {
        // Flick direction wins.
        const order = SCREEN_ORDER.filter(s => s !== 'hidden') as Array<'full' | 'half' | 'peek'>;
        const curIdx = order.indexOf(state as any);
        if (velocity < 0) { // flick up → expand
          target = order[Math.max(0, curIdx - 1)];
        } else { // flick down → collapse
          target = order[Math.min(order.length - 1, curIdx + 1)];
        }
      } else {
        // Snap to nearest of {full, half, peek}.
        const diffs: Array<{ s: Exclude<SheetState, 'hidden'>; d: number }> = [
          { s: 'full', d: Math.abs(current - snaps.full) },
          { s: 'half', d: Math.abs(current - snaps.half) },
          { s: 'peek', d: Math.abs(current - snaps.peek) },
        ];
        diffs.sort((a, b) => a.d - b.d);
        target = diffs[0].s;
      }

      goTo(target);
    },
  });

  // Re-snap on resize (rotation, keyboard show/hide)
  const onResize = () => {
    if (state === 'hidden') return;
    applyY(snapPoints()[state]);
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  return {
    el,
    content,
    getState: () => state,
    setState: (s) => goTo(s),
    onStateChange: (cb) => { listeners.push(cb); },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
