/**
 * Mobile room popup — bottom-anchored card shown when a room is tapped.
 *
 * - Tap blank = close (popup only).
 * - Swipe down 80+px = close AND clear the active route entirely.
 */

import { MOBILE_IDS } from './mobileChrome';
import { onSwipe } from './gestures';
import * as RouteActions from '../services/routeActions';
import { ROOM_TYPE_LABELS } from '../models/types';

interface RoomClickDetail {
  ref: string;
  name: string;
  roomType: string;
  level: number;
  screenX: number;
  screenY: number;
}

let currentRef: string | null = null;
let justOpened = false;

export function initRoomPopup(): void {
  const popup = document.getElementById(MOBILE_IDS.popup);
  if (!popup) return;

  document.addEventListener('roomClicked', ((e: CustomEvent<RoomClickDetail>) => {
    const d = e.detail;
    if (!d.ref) return;
    currentRef = d.ref;
    render(popup, d);
    show(popup);
    justOpened = true;
    requestAnimationFrame(() => { justOpened = false; });
  }) as EventListener);

  // Tap outside the popup (and outside a room) closes it.
  document.addEventListener('click', (e) => {
    if (justOpened) return;
    const t = e.target as HTMLElement;
    if (!t.closest(`#${MOBILE_IDS.popup}`)) {
      hide(popup);
    }
  });

  // Swipe-down inside the popup = close + clear route
  onSwipe(popup, (ev) => {
    if (ev.direction !== 'down' || ev.distance < 80) return;
    hide(popup);
    RouteActions.clearRoute();
  }, { axis: 'y', threshold: 80, velocityPxMs: 0.2 });

  // Route state changes from elsewhere (e.g. chip row, radial) don't need to
  // auto-close the popup, but clearing should hide it.
  document.addEventListener('routeCleared', () => hide(popup));
}

function render(popup: HTMLElement, d: RoomClickDetail): void {
  const typeLabel = ROOM_TYPE_LABELS[d.roomType] ?? d.roomType ?? '';
  popup.innerHTML = `
    <div class="m-popup-head">
      <span class="m-popup-ref">${escapeHtml(d.ref)}</span>
      <span class="m-popup-type">${escapeHtml(typeLabel)} · ${d.level}F</span>
    </div>
    ${d.name ? `<div class="m-popup-name">${escapeHtml(d.name)}</div>` : ''}
    <div class="m-popup-actions">
      <button class="start" data-act="start">🚩 출발로</button>
      <button class="end" data-act="end">🏁 도착으로</button>
    </div>
  `;

  popup.querySelector('[data-act="start"]')?.addEventListener('click', () => {
    if (currentRef) RouteActions.setStart(currentRef);
    hide(popup);
  });
  popup.querySelector('[data-act="end"]')?.addEventListener('click', () => {
    if (currentRef) RouteActions.setEnd(currentRef);
    hide(popup);
  });
}

function show(popup: HTMLElement): void {
  popup.setAttribute('data-visible', 'true');
  popup.setAttribute('aria-hidden', 'false');
}

function hide(popup: HTMLElement): void {
  popup.setAttribute('data-visible', 'false');
  popup.setAttribute('aria-hidden', 'true');
  currentRef = null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
