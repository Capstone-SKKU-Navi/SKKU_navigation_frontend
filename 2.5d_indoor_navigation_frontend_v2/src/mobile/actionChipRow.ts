/**
 * Bottom action chip row.
 *
 * Secondary entry point for setting start/end endpoints on mobile.
 * The primary paths are the popup buttons and the radial menu; the chip
 * row morphs into a "find route" chip once both endpoints are set.
 *
 * Visibility rules:
 * - Shows when a room is tapped (alongside the popup) so the user can
 *   assign the room without opening the popup first.
 * - Morphs to "경로 찾기" when both endpoints are set.
 * - Hides on `routeFound` and `routeCleared`.
 */

import { MOBILE_IDS } from './mobileChrome';
import { escapeHtml } from '../utils/escapeHtml';
import * as RouteActions from '../services/routeActions';

let currentRef: string | null = null;

export function initActionChipRow(): void {
  const row = document.getElementById(MOBILE_IDS.chipRow);
  if (!row) return;

  document.addEventListener('roomClicked', ((e: CustomEvent) => {
    currentRef = e.detail?.ref ?? null;
    refresh(row);
  }) as EventListener);

  document.addEventListener('routeEndpointChanged', () => refresh(row));

  document.addEventListener('routeFound', () => {
    currentRef = null;
    hide(row);
  });
  document.addEventListener('routeCleared', () => {
    currentRef = null;
    hide(row);
  });
}

function refresh(row: HTMLElement): void {
  const { startRef, endRef } = RouteActions.getEndpoints();
  const both = !!startRef && !!endRef;

  if (both) {
    row.innerHTML = `<button class="m-chip find" data-act="find">🔍 경로 찾기 (${escapeHtml(startRef)} → ${escapeHtml(endRef)})</button>`;
    row.querySelector('[data-act="find"]')?.addEventListener('click', () => {
      RouteActions.triggerFindRoute();
    });
    show(row);
    return;
  }

  if (!currentRef) {
    hide(row);
    return;
  }

  row.innerHTML = `
    <button class="m-chip start" data-act="start">🚩 출발로 (${escapeHtml(currentRef)})</button>
    <button class="m-chip end" data-act="end">🏁 도착로 (${escapeHtml(currentRef)})</button>
  `;
  row.querySelector('[data-act="start"]')?.addEventListener('click', () => {
    if (currentRef) RouteActions.setStart(currentRef);
  });
  row.querySelector('[data-act="end"]')?.addEventListener('click', () => {
    if (currentRef) RouteActions.setEnd(currentRef);
  });
  show(row);
}

function show(row: HTMLElement): void {
  row.setAttribute('data-visible', 'true');
  row.setAttribute('aria-hidden', 'false');
}

function hide(row: HTMLElement): void {
  row.setAttribute('data-visible', 'false');
  row.setAttribute('aria-hidden', 'true');
}

