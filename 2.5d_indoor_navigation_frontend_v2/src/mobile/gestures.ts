/**
 * Hand-rolled pointer-event gesture utilities for the mobile chrome.
 *
 * All helpers use Pointer Events + setPointerCapture — no mouse/touch split.
 * Most attach in the capture phase so we see events before MapLibre's own
 * handlers on the canvas chain.
 */

export interface LongPressEvent {
  x: number;
  y: number;
  target: EventTarget | null;
}

export interface SwipeEvent {
  direction: 'up' | 'down' | 'left' | 'right';
  distance: number;
  velocity: number; // px/ms
}

export interface TapEvent {
  x: number;
  y: number;
  target: EventTarget | null;
}

export interface DragSheetHandlers {
  onStart?: (startY: number) => void;
  onMove?: (dy: number) => void;
  onEnd?: (dy: number, velocity: number) => void;
}

export interface WheelSwipeEvent {
  delta: number; // integer item steps; negative = up
  velocity: number;
}

type Disposer = () => void;

// =========================================================================
// Long press
// =========================================================================

export function onLongPress(
  el: HTMLElement,
  cb: (e: LongPressEvent) => void,
  opts: { ms?: number; slop?: number; capture?: boolean } = {},
): Disposer {
  const ms = opts.ms ?? 450;
  const slop = opts.slop ?? 10;
  const capture = opts.capture ?? true;

  let timer: number | null = null;
  let startX = 0;
  let startY = 0;
  let activeId: number | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    activeId = null;
  };

  const onDown = (e: PointerEvent) => {
    if (activeId !== null) return; // ignore multi-touch
    activeId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    timer = window.setTimeout(() => {
      timer = null;
      cb({ x: startX, y: startY, target: e.target });
    }, ms);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== activeId || timer === null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > slop) clear();
  };

  const onEnd = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    clear();
  };

  el.addEventListener('pointerdown', onDown, { capture });
  el.addEventListener('pointermove', onMove, { capture });
  el.addEventListener('pointerup', onEnd, { capture });
  el.addEventListener('pointercancel', onEnd, { capture });
  el.addEventListener('pointerleave', onEnd, { capture });

  return () => {
    clear();
    el.removeEventListener('pointerdown', onDown, { capture } as any);
    el.removeEventListener('pointermove', onMove, { capture } as any);
    el.removeEventListener('pointerup', onEnd, { capture } as any);
    el.removeEventListener('pointercancel', onEnd, { capture } as any);
    el.removeEventListener('pointerleave', onEnd, { capture } as any);
  };
}

// =========================================================================
// Swipe
// =========================================================================

export function onSwipe(
  el: HTMLElement,
  cb: (e: SwipeEvent) => void,
  opts: { axis?: 'x' | 'y' | 'any'; threshold?: number; velocityPxMs?: number } = {},
): Disposer {
  const axis = opts.axis ?? 'any';
  const threshold = opts.threshold ?? 40;
  const minVel = opts.velocityPxMs ?? 0.3;

  let startX = 0;
  let startY = 0;
  let startT = 0;
  let activeId: number | null = null;

  const onDown = (e: PointerEvent) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
    try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dt = Math.max(1, performance.now() - startT);
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const dist = Math.hypot(dx, dy);
    const velocity = dist / dt;

    if (dist < threshold || velocity < minVel) return;

    let direction: SwipeEvent['direction'];
    if (axis === 'x' || (axis === 'any' && absX > absY)) {
      direction = dx > 0 ? 'right' : 'left';
    } else if (axis === 'y' || (axis === 'any' && absY >= absX)) {
      direction = dy > 0 ? 'down' : 'up';
    } else {
      return;
    }

    // Axis-locked modes only fire for matching axis
    if (axis === 'x' && (direction === 'up' || direction === 'down')) return;
    if (axis === 'y' && (direction === 'left' || direction === 'right')) return;

    cb({ direction, distance: dist, velocity });
  };

  const onCancel = () => { activeId = null; };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
}

// =========================================================================
// Tap (distinguishes from long-press and drag)
// =========================================================================

export function onTap(
  el: HTMLElement,
  cb: (e: TapEvent) => void,
  opts: { slop?: number; maxMs?: number } = {},
): Disposer {
  const slop = opts.slop ?? 8;
  const maxMs = opts.maxMs ?? 250;

  let startX = 0;
  let startY = 0;
  let startT = 0;
  let activeId: number | null = null;

  const onDown = (e: PointerEvent) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const dt = performance.now() - startT;
    if (Math.hypot(dx, dy) <= slop && dt <= maxMs) {
      cb({ x: e.clientX, y: e.clientY, target: e.target });
    }
  };

  const onCancel = () => { activeId = null; };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
}

// =========================================================================
// Drag-sheet (raw dy + velocity stream for bottom sheet)
// =========================================================================

export function onDragSheet(el: HTMLElement, handlers: DragSheetHandlers): Disposer {
  let activeId: number | null = null;
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;

  const onDown = (e: PointerEvent) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    startY = e.clientY;
    lastY = e.clientY;
    lastT = performance.now();
    velocity = 0;
    try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
    handlers.onStart?.(startY);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    e.preventDefault();
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    velocity = (e.clientY - lastY) / dt; // px/ms, positive = down
    lastY = e.clientY;
    lastT = now;
    handlers.onMove?.(e.clientY - startY);
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    handlers.onEnd?.(e.clientY - startY, velocity);
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
  };
}

// =========================================================================
// Vertical wheel swipe — snaps to integer item steps (floor wheel)
// =========================================================================

export function onVerticalWheelSwipe(
  el: HTMLElement,
  cb: (e: WheelSwipeEvent) => void,
  opts: { itemHeight: number },
): Disposer {
  const itemH = opts.itemHeight;

  let activeId: number | null = null;
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let fired = false;

  const onDown = (e: PointerEvent) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    startY = e.clientY;
    lastY = e.clientY;
    lastT = performance.now();
    velocity = 0;
    fired = false;
    try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    velocity = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = now;
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    if (fired) return;
    const dy = e.clientY - startY;
    // Up-swipe (dy < 0) → step to higher item index (higher floor), delta positive.
    // Down-swipe (dy > 0) → step to lower item index, delta negative.
    let steps = Math.round(-dy / itemH);
    // Flick: if velocity is strong, add one extra step in the flick direction.
    if (Math.abs(velocity) > 0.4) {
      steps += velocity < 0 ? 1 : -1;
    }
    if (steps !== 0) {
      fired = true;
      cb({ delta: steps, velocity });
    }
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
  };
}
