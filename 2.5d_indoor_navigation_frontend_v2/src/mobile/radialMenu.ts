/**
 * Long-press radial menu.
 *
 * Attaches to `#map` (capture phase, so we see pointer events before
 * MapLibre). On long-press, hit-tests the pointer against room layers via
 * `IndoorLayer.queryRoomAt`. If a room is under the finger, shows 4 choices
 * arranged on an arc around the pointer and suppresses the phantom
 * `roomClicked` that would otherwise fire on release.
 */

import { MOBILE_IDS } from './mobileChrome';
import { onLongPress } from './gestures';
import * as GeoMap from '../components/geoMap';
import * as IndoorLayer from '../components/indoorLayer';
import * as RouteActions from '../services/routeActions';

interface Choice {
  id: 'start' | 'end' | 'info' | 'close';
  label: string;
  icon: string;
  className: string;
}

const CHOICES: Choice[] = [
  { id: 'start', label: '출발',    icon: 'flag',         className: 'start' },
  { id: 'end',   label: '도착',    icon: 'sports_score', className: 'end'   },
  { id: 'info',  label: '정보',    icon: 'info',         className: 'info'  },
  { id: 'close', label: '닫기',    icon: 'close',        className: 'close' },
];

// Layout: 4 choices evenly spaced on a 96px-radius arc centered on pointer.
const RADIUS = 90;
const INSET = 80;        // keep menu this far from viewport edges
const DISMISS_MS = 4000;

let activeRef: string | null = null;
let dismissTimer: number | null = null;

export function initRadialMenu(): void {
  const mapEl = document.getElementById('map');
  const radial = document.getElementById(MOBILE_IDS.radial);
  if (!mapEl || !radial) return;

  onLongPress(mapEl, (e) => {
    const map = GeoMap.getMap();
    if (!map) return;

    // Convert to map-canvas-relative coords
    const rect = mapEl.getBoundingClientRect();
    const mapX = e.x - rect.left;
    const mapY = e.y - rect.top;

    const hit = IndoorLayer.queryRoomAt(map, { x: mapX, y: mapY });
    if (!hit) return;

    // Suppress the click that fires on finger release
    GeoMap.suppressNextClick();
    vibrate();

    activeRef = hit.ref;
    renderRadial(radial, e.x, e.y);
  }, { ms: 450, slop: 12, capture: true });

  // Close radial on outside pointerdown
  document.addEventListener('pointerdown', (e) => {
    if (radial.getAttribute('data-visible') !== 'true') return;
    const t = e.target as HTMLElement;
    if (!t.closest(`#${MOBILE_IDS.radial}`)) {
      hideRadial(radial);
    }
  }, { capture: true });
}

function renderRadial(radial: HTMLElement, clientX: number, clientY: number): void {
  const cx = clamp(clientX, INSET, window.innerWidth - INSET);
  const cy = clamp(clientY, INSET, window.innerHeight - INSET);

  radial.style.left = `${cx}px`;
  radial.style.top = `${cy}px`;

  const html: string[] = [`<div class="m-radial-center"></div>`];
  const n = CHOICES.length;
  // Arrange choices at 4 compass directions relative to center
  // indices 0..3 → top, right, bottom, left (adjusted so start is at the top)
  const angles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

  CHOICES.forEach((c, i) => {
    const angle = angles[i % n];
    const dx = Math.cos(angle) * RADIUS;
    const dy = Math.sin(angle) * RADIUS;
    html.push(
      `<button class="m-radial-item ${c.className}" data-choice="${c.id}"
               style="transform: translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))">
         <span class="material-icons">${c.icon}</span>
         <span>${c.label}</span>
       </button>`
    );
  });

  radial.innerHTML = html.join('');
  radial.setAttribute('data-visible', 'true');
  radial.setAttribute('aria-hidden', 'false');

  radial.querySelectorAll<HTMLButtonElement>('.m-radial-item').forEach(btn => {
    // preventDefault on pointerdown stops the synthetic click from
    // double-triggering on release
    btn.addEventListener('pointerdown', (ev) => ev.preventDefault());
    btn.addEventListener('click', () => {
      const choice = btn.dataset.choice as Choice['id'];
      handleChoice(choice);
      hideRadial(radial);
    });
  });

  if (dismissTimer !== null) clearTimeout(dismissTimer);
  dismissTimer = window.setTimeout(() => hideRadial(radial), DISMISS_MS);
}

function handleChoice(choice: Choice['id']): void {
  if (!activeRef) return;
  switch (choice) {
    case 'start':
      RouteActions.setStart(activeRef);
      break;
    case 'end':
      RouteActions.setEnd(activeRef);
      break;
    case 'info':
      // Re-dispatch the room click so the info popup renders
      GeoMap.flyToRoom(activeRef);
      break;
    case 'close':
      break;
  }
}

function hideRadial(radial: HTMLElement): void {
  radial.setAttribute('data-visible', 'false');
  radial.setAttribute('aria-hidden', 'true');
  activeRef = null;
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function vibrate(): void {
  const nav = navigator as Navigator & { vibrate?: (ms: number) => void };
  nav.vibrate?.(20);
}
