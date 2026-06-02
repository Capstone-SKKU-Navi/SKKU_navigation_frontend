// ===== URL deep-link state =====
//
// Encodes the user-visible navigation state into the address bar via
// history.replaceState so any view is bookmarkable / shareable:
//   ?room=21517&floor=5        — a single selected room
//   ?from=21517&to=21620       — a route (room refs only)
// Coord-pin endpoints ("지도 위치") are intentionally NOT encoded — there is no
// stable ref to restore them from, so a route that uses a dropped pin simply
// isn't deep-linked (the rest of the UI still works).
//
// `device` and `debug` query params are owned by deviceDetection / eruda and
// are always preserved across our rewrites.

const PRESERVE = ['device', 'debug'];
const MANAGED = ['room', 'floor', 'from', 'to'];

export interface UrlState {
  room?: string;
  floor?: number;
  from?: string;
  to?: string;
}

/** Parse the current address bar into a UrlState (called once on load). */
export function readUrlState(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const state: UrlState = {};
  const room = p.get('room');
  const from = p.get('from');
  const to = p.get('to');
  const floor = p.get('floor');
  if (room) state.room = room;
  if (from) state.from = from;
  if (to) state.to = to;
  if (floor !== null && floor !== '' && Number.isFinite(Number(floor))) {
    state.floor = Number(floor);
  }
  return state;
}

function rewrite(set: Record<string, string>): void {
  const cur = new URLSearchParams(window.location.search);
  const next = new URLSearchParams();
  // Preserve device/debug first so they survive every rewrite.
  for (const key of PRESERVE) {
    const v = cur.get(key);
    if (v !== null) next.set(key, v);
  }
  for (const [k, v] of Object.entries(set)) {
    if (v) next.set(k, v);
  }
  const qs = next.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

/** Encode a single selected room (clears any route params). */
export function writeSelectedRoom(ref: string, floor: number): void {
  rewrite({ room: ref, floor: String(floor) });
}

/** Encode a route by room refs. Pass null for a slot that has no room ref
 *  (e.g. a coord pin) — that slot is omitted so the link is partial but valid. */
export function writeRoute(from: string | null, to: string | null): void {
  rewrite({ from: from ?? '', to: to ?? '' });
}

/** Drop all managed params (keeps device/debug). */
export function clearUrlState(): void {
  // Only rewrite if we actually have a managed param, to avoid clobbering the
  // history entry needlessly.
  const cur = new URLSearchParams(window.location.search);
  if (MANAGED.some((k) => cur.has(k))) rewrite({});
}

/** The shareable absolute URL for the current view. */
export function getShareUrl(): string {
  return window.location.href;
}

/**
 * Share the current view: native share sheet where available (mobile),
 * clipboard copy as fallback. Resolves to 'shared' | 'copied' | 'failed'.
 */
export async function shareCurrentView(title = 'SKKU 실내 내비게이션'): Promise<'shared' | 'copied' | 'failed'> {
  const url = getShareUrl();
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title, url });
      return 'shared';
    } catch (err: any) {
      // User-cancelled share is not a failure; report it as such so callers
      // don't show an error toast.
      if (err?.name === 'AbortError') return 'shared';
      // fall through to clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
