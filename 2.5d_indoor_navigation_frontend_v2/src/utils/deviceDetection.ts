/**
 * Mobile device detection.
 *
 * Width < 768px AND coarse pointer — avoids misfiring on narrow desktop
 * windows or touch-capable laptops with a mouse.
 *
 * `?device=mobile` or `?device=pc` URL override is the single most useful
 * knob for demo/testing on any screen.
 */

const OVERRIDE = new URLSearchParams(location.search).get('device');
let cached: boolean | null = null;

export function isMobileDevice(): boolean {
  if (cached !== null) return cached;
  if (OVERRIDE === 'mobile') { cached = true; return true; }
  if (OVERRIDE === 'pc') { cached = false; return false; }
  cached = window.matchMedia('(max-width: 768px) and (pointer: coarse)').matches;
  return cached;
}
