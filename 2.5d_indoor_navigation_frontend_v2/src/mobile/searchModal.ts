/**
 * Full-screen search modal.
 *
 * - Tap the search pill → slide up modal with autocomplete.
 * - Tap a result → close modal, fly to room, switch level.
 * - Hardware back (Android) / back button / swipe-down on header = close.
 *
 * Reuses `apiSearchRooms` so results are identical to PC.
 */

import { MOBILE_IDS } from './mobileChrome';
import { searchRooms as apiSearchRooms } from '../services/apiClient';
import { ROOM_TYPE_LABELS, RoomListItem } from '../models/types';
import * as RouteActions from '../services/routeActions';
import { escapeHtml } from '../utils/escapeHtml';

const HISTORY_STATE_TAG = '__mSearchModal';

let lastQuery = '';
let currentResults: RoomListItem[] = [];

export function initSearchModal(): void {
  const pill = document.getElementById(MOBILE_IDS.searchPill);
  const modal = document.getElementById(MOBILE_IDS.searchModal);
  if (!pill || !modal) return;

  const input = modal.querySelector<HTMLInputElement>('.m-search-input');
  const list = modal.querySelector<HTMLUListElement>('.m-search-results');
  const backBtn = modal.querySelector<HTMLButtonElement>('.m-search-back');
  const clearBtn = modal.querySelector<HTMLButtonElement>('.m-search-clear');
  if (!input || !list || !backBtn || !clearBtn) return;

  pill.addEventListener('click', () => openModal(modal, input));
  backBtn.addEventListener('click', () => closeModal(modal));
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    renderResults(list, []);
    input.focus();
  });

  // Debounce the search call — Korean IME composition fires `input` per
  // jamo, which would otherwise spam the backend with one request per keystroke.
  // The trailing stale-response guard below still handles late results.
  let searchTimer: number | null = null;
  input.addEventListener('input', () => {
    const query = input.value.trim();
    clearBtn.hidden = !query;
    lastQuery = query;
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    if (!query) { renderResults(list, []); return; }
    searchTimer = window.setTimeout(async () => {
      searchTimer = null;
      const results = await apiSearchRooms(query);
      if (input.value.trim() !== lastQuery) return; // stale
      currentResults = results;
      renderResults(list, results);
    }, 180);
  });

  // Tap on result
  list.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('li[data-index]');
    if (!item) return;
    const idx = parseInt(item.dataset.index ?? '0', 10);
    const room = currentResults[idx];
    if (!room) return;
    RouteActions.selectRoom(room);
    closeModal(modal);
  });

  // Hardware back = close modal
  window.addEventListener('popstate', (e) => {
    if (modal.getAttribute('data-open') === 'true') {
      // State popped while modal open; just hide (don't push again)
      hideModal(modal);
    }
  });
}

function openModal(modal: HTMLElement, input: HTMLInputElement): void {
  modal.setAttribute('data-open', 'true');
  modal.setAttribute('aria-hidden', 'false');
  try {
    history.pushState({ [HISTORY_STATE_TAG]: true }, '');
  } catch { /* history may not be available in some webviews */ }
  syncToViewport(modal);
  // Focus after the slide-up transition begins so iOS keyboard animates in cleanly
  setTimeout(() => input.focus(), 60);
}

/**
 * iOS Safari's virtual keyboard doesn't resize `100vh`/`100dvh` on older
 * versions; pin the modal to the visible viewport via visualViewport API
 * so the input stays above the keyboard.
 */
function syncToViewport(modal: HTMLElement): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    modal.style.height = `${vv.height}px`;
    modal.style.top = `${vv.offsetTop}px`;
  };
  apply();
  const handler = () => {
    if (modal.getAttribute('data-open') !== 'true') {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
      modal.style.height = '';
      modal.style.top = '';
      return;
    }
    apply();
  };
  vv.addEventListener('resize', handler);
  vv.addEventListener('scroll', handler);
}

function closeModal(modal: HTMLElement): void {
  if (modal.getAttribute('data-open') !== 'true') return;
  // Pop the history entry we pushed
  if (history.state?.[HISTORY_STATE_TAG]) {
    history.back();
    return; // popstate handler will call hideModal
  }
  hideModal(modal);
}

function hideModal(modal: HTMLElement): void {
  modal.setAttribute('data-open', 'false');
  modal.setAttribute('aria-hidden', 'true');
  const input = modal.querySelector<HTMLInputElement>('.m-search-input');
  input?.blur();
}

function renderResults(list: HTMLElement, results: RoomListItem[]): void {
  if (results.length === 0) {
    if (lastQuery) {
      list.innerHTML = `<div class="m-search-empty">해당 방을 찾을 수 없습니다.</div>`;
    } else {
      list.innerHTML = '';
    }
    return;
  }
  list.innerHTML = results.map((r, i) => {
    const typeLabel = ROOM_TYPE_LABELS[r.roomType] ?? r.roomType;
    const levelStr = r.level.join(',');
    return `<li data-index="${i}">
      <span class="m-search-ref">${escapeHtml(r.ref)}</span>
      <span class="m-search-meta">${levelStr}F · ${escapeHtml(typeLabel)}${r.name ? ` · ${escapeHtml(r.name)}` : ''}</span>
    </li>`;
  }).join('');
}

