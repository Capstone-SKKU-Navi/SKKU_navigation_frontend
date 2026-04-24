/**
 * apiModeBadge — draggable LOCAL ↔ API toggle pill.
 *
 * Top-right by default (top:64 right:12, below the existing top bar). The
 * whole row is draggable except the toggle button; position persists in
 * localStorage. On toggle to API mode, fires GET /api/graph for a
 * "27 nodes loaded" detail line. Listens for `apiRouteCall` CustomEvents
 * dispatched by services/api/apiRoute.ts and renders the last 3 calls
 * inline.
 */

import * as ApiClient from '../services/apiClient';
import * as BackendService from '../services/backendService';
import * as GeoMap from './geoMap';
import * as IndoorLayer from './indoorLayer';

const STYLE_ID = 'api-mode-badge-style';
const ROOT_ID = 'apiModeBadge';
const POS_KEY = 'apiModeBadge.pos';
const API_BASE = 'http://localhost:8080/api';

type ApiCallDetail = {
  url: string;
  method: string;
  status: number | null;
  durationMs: number;
  pathLength: number;
  edgeCount: number;
  error?: string;
};

let rootEl: HTMLDivElement | null = null;
let dotEl: HTMLSpanElement | null = null;
let stateEl: HTMLSpanElement | null = null;
let detailEl: HTMLSpanElement | null = null;
let logEl: HTMLDivElement | null = null;
let toggleBtn: HTMLButtonElement | null = null;
let dragHandleEl: HTMLDivElement | null = null;

let nodeCacheCount = 0;
let lastError: string | null = null;
const callHistory: ApiCallDetail[] = [];
const MAX_HISTORY = 3;

// ===== Styles =====

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
#${ROOT_ID} {
  position: fixed; top: 64px; right: 12px; z-index: 9999;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px; line-height: 1.4;
  background: rgba(20, 22, 28, 0.92); color: #e6e8ec;
  border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
  padding: 6px 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.35);
  max-width: 380px; min-width: 220px;
  user-select: none;
}
#${ROOT_ID} .row { display: flex; align-items: center; gap: 8px; }
#${ROOT_ID} .handle {
  display: flex; align-items: center; gap: 8px; flex: 1 1 auto;
  cursor: grab; touch-action: none;
}
#${ROOT_ID}.dragging .handle { cursor: grabbing; }
#${ROOT_ID} .dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #888; box-shadow: 0 0 6px rgba(0,0,0,0.4);
  flex: 0 0 auto;
}
#${ROOT_ID}.api .dot   { background: #4caf50; box-shadow: 0 0 8px #4caf50aa; }
#${ROOT_ID}.local .dot { background: #9e9e9e; }
#${ROOT_ID}.error .dot { background: #ef5350; box-shadow: 0 0 8px #ef5350aa; }
#${ROOT_ID} .state { font-weight: 600; letter-spacing: 0.02em; }
#${ROOT_ID}.api .state   { color: #81c784; }
#${ROOT_ID}.local .state { color: #bdbdbd; }
#${ROOT_ID}.error .state { color: #ef9a9a; }
#${ROOT_ID} .detail { color: #9aa0a6; flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#${ROOT_ID} button.toggle {
  background: rgba(255,255,255,0.06); color: #e6e8ec;
  border: 1px solid rgba(255,255,255,0.16); border-radius: 4px;
  padding: 4px 10px; cursor: pointer; font: inherit; font-size: 11px;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  min-width: 56px; min-height: 28px;  /* tap target on mobile */
}
#${ROOT_ID} button.toggle:hover { background: rgba(255,255,255,0.12); }
#${ROOT_ID} button.toggle:disabled { opacity: 0.5; cursor: wait; }
#${ROOT_ID} .log {
  margin-top: 6px; padding-top: 6px;
  border-top: 1px dashed rgba(255,255,255,0.12);
  color: #9aa0a6; font-size: 11px;
  display: none;
}
#${ROOT_ID} .log.has-entries { display: block; }
#${ROOT_ID} .log .entry { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#${ROOT_ID} .log .ok    { color: #aed581; }
#${ROOT_ID} .log .fail  { color: #ef9a9a; }
`;
  const styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
}

// ===== Construction =====

function ensureRoot(): void {
  if (rootEl) return;
  injectStyle();

  rootEl = document.createElement('div');
  rootEl.id = ROOT_ID;

  const row = document.createElement('div');
  row.className = 'row';

  dragHandleEl = document.createElement('div');
  dragHandleEl.className = 'handle';
  dragHandleEl.title = 'Drag to move';

  dotEl = document.createElement('span');
  dotEl.className = 'dot';
  dragHandleEl.appendChild(dotEl);

  stateEl = document.createElement('span');
  stateEl.className = 'state';
  dragHandleEl.appendChild(stateEl);

  detailEl = document.createElement('span');
  detailEl.className = 'detail';
  dragHandleEl.appendChild(detailEl);

  row.appendChild(dragHandleEl);

  toggleBtn = document.createElement('button');
  toggleBtn.className = 'toggle';
  toggleBtn.type = 'button';
  toggleBtn.textContent = 'toggle';
  toggleBtn.addEventListener('click', onToggleClick);
  // Mobile: some chromes swallow the synthetic click after touchstart.preventDefault elsewhere.
  // Forward touchend on the button to onToggleClick directly (idempotent because click also fires).
  let touchHandled = false;
  toggleBtn.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    touchHandled = false;
  }, { passive: true });
  toggleBtn.addEventListener('touchend', (e) => {
    e.stopPropagation();
    if (touchHandled) return;
    touchHandled = true;
    e.preventDefault();
    onToggleClick();
  });
  row.appendChild(toggleBtn);

  rootEl.appendChild(row);

  logEl = document.createElement('div');
  logEl.className = 'log';
  rootEl.appendChild(logEl);

  document.body.appendChild(rootEl);

  restorePosition();
  attachDragHandlers();
}

// ===== Position persistence =====

function restorePosition(): void {
  if (!rootEl) return;
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return;
    const pos = JSON.parse(raw) as { left?: number; top?: number };
    if (typeof pos.left === 'number' && typeof pos.top === 'number') {
      const { width, height } = rootEl.getBoundingClientRect();
      const left = clamp(pos.left, 0, Math.max(0, window.innerWidth - width));
      const top = clamp(pos.top, 0, Math.max(0, window.innerHeight - height));
      rootEl.style.left = `${left}px`;
      rootEl.style.top = `${top}px`;
      rootEl.style.right = 'auto';
    }
  } catch { /* ignore */ }
}

function savePosition(): void {
  if (!rootEl) return;
  const r = rootEl.getBoundingClientRect();
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) }));
  } catch { /* ignore */ }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ===== Drag handlers =====

function attachDragHandlers(): void {
  if (!dragHandleEl || !rootEl) return;

  let dragging = false;
  let startX = 0, startY = 0;
  let originLeft = 0, originTop = 0;

  function startDrag(clientX: number, clientY: number): void {
    const r = rootEl!.getBoundingClientRect();
    originLeft = r.left;
    originTop = r.top;
    startX = clientX;
    startY = clientY;
    dragging = true;
    rootEl!.classList.add('dragging');
    rootEl!.style.right = 'auto';
    rootEl!.style.left = `${originLeft}px`;
    rootEl!.style.top = `${originTop}px`;
  }

  function moveDrag(clientX: number, clientY: number): void {
    if (!dragging || !rootEl) return;
    const dx = clientX - startX;
    const dy = clientY - startY;
    const r = rootEl.getBoundingClientRect();
    const left = clamp(originLeft + dx, 0, window.innerWidth - r.width);
    const top = clamp(originTop + dy, 0, window.innerHeight - r.height);
    rootEl.style.left = `${left}px`;
    rootEl.style.top = `${top}px`;
  }

  function endDrag(): void {
    if (!dragging) return;
    dragging = false;
    rootEl?.classList.remove('dragging');
    savePosition();
  }

  // Mouse
  dragHandleEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
  window.addEventListener('mouseup', endDrag);

  // Touch (mobile)
  dragHandleEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    e.preventDefault();   // prevent map from panning under us
    const t = e.touches[0];
    startDrag(t.clientX, t.clientY);
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    if (e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    moveDrag(t.clientX, t.clientY);
  }, { passive: false });
  window.addEventListener('touchend', endDrag);
  window.addEventListener('touchcancel', endDrag);
}

// ===== Toggle =====

let geojsonFeatureCount = 0;

async function onToggleClick(): Promise<void> {
  if (!toggleBtn) return;
  const next = !ApiClient.isApiMode();
  toggleBtn.disabled = true;
  const prevText = toggleBtn.textContent;
  toggleBtn.textContent = '…';
  lastError = null;
  nodeCacheCount = 0;
  geojsonFeatureCount = 0;

  try {
    ApiClient.setUseApi(next);
    await ApiClient.initRouting();

    if (next) {
      // 1. /api/graph → "N nodes loaded"
      try {
        const t0 = performance.now();
        const res = await fetch(`${API_BASE}/graph`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const graph = await res.json() as { nodes?: unknown[]; edges?: unknown[] };
        nodeCacheCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
        console.log(`[ApiModeBadge] /api/graph → ${nodeCacheCount} nodes in ${Math.round(performance.now() - t0)}ms`);
      } catch (err: any) {
        throw new Error(`graph: ${err?.message ?? err}`);
      }

      // 2. /api/geojson/all → replace BackendService state, refresh map sources
      try {
        const t0 = performance.now();
        await BackendService.fetchBackendDataFromApi(API_BASE);
        const map = GeoMap.getMap();
        if (map) IndoorLayer.refreshAll(map);
        const ms = Math.round(performance.now() - t0);
        // Count features in current state for display
        let total = 0;
        for (const code of BackendService.getBuildingCodes()) {
          for (const level of BackendService.getBuildingLevels(code)) {
            const d = BackendService.getLevelDataForBuilding(code, level);
            total += d.rooms.features.length + d.colliders.features.length + d.walls.features.length;
          }
        }
        geojsonFeatureCount = total;
        console.log(`[ApiModeBadge] /api/geojson/all → ${total} features in ${ms}ms`);
      } catch (err: any) {
        throw new Error(`geojson: ${err?.message ?? err}`);
      }
    } else {
      // Toggle back to LOCAL: restore the snapshot taken before the first API fetch
      const restored = BackendService.restoreLocalData();
      if (restored) {
        const map = GeoMap.getMap();
        if (map) IndoorLayer.refreshAll(map);
        console.log('[ApiModeBadge] restored local GeoJSON snapshot');
      }
    }
  } catch (err: any) {
    lastError = err?.message ?? 'init failed';
    ApiClient.setUseApi(false);
    await ApiClient.initRouting().catch(() => undefined);
    // Try to restore the local GeoJSON snapshot too — best-effort
    if (BackendService.restoreLocalData()) {
      const map = GeoMap.getMap();
      if (map) IndoorLayer.refreshAll(map);
    }
  } finally {
    toggleBtn.disabled = false;
    toggleBtn.textContent = prevText ?? 'toggle';
    render();
  }
}

// ===== Render =====

function render(): void {
  if (!rootEl || !stateEl || !detailEl) return;
  rootEl.classList.remove('api', 'local', 'error');
  if (lastError) {
    rootEl.classList.add('error');
    stateEl.textContent = 'API · ERROR';
    detailEl.textContent = `· ${lastError}`;
  } else if (ApiClient.isApiMode()) {
    rootEl.classList.add('api');
    stateEl.textContent = 'API';
    const detail = ['localhost:8080'];
    if (nodeCacheCount > 0) detail.push(`${nodeCacheCount} nodes`);
    if (geojsonFeatureCount > 0) detail.push(`${geojsonFeatureCount} features`);
    detailEl.textContent = '· ' + detail.join(' · ');
  } else {
    rootEl.classList.add('local');
    stateEl.textContent = 'LOCAL';
    detailEl.textContent = '· graph.json';
  }
  renderLog();
}

function renderLog(): void {
  if (!logEl) return;
  if (callHistory.length === 0) {
    logEl.classList.remove('has-entries');
    logEl.innerHTML = '';
    return;
  }
  logEl.classList.add('has-entries');
  logEl.innerHTML = callHistory.map(c => {
    const ok = c.status !== null && c.status >= 200 && c.status < 300 && !c.error;
    const cls = ok ? 'ok' : 'fail';
    const status = c.status ?? 'ERR';
    const summary = ok
      ? `${status} in ${c.durationMs}ms · ${c.pathLength} coords · ${c.edgeCount} clips`
      : `${status} ${c.error ?? ''}`.trim();
    return `<div class="entry ${cls}">${escapeHtml(c.method)} ${escapeHtml(shortPath(c.url))} · ${escapeHtml(summary)}</div>`;
  }).join('');
}

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Event listener =====

function onApiRouteCall(e: Event): void {
  const detail = (e as CustomEvent<ApiCallDetail>).detail;
  if (!detail) return;
  callHistory.unshift(detail);
  if (callHistory.length > MAX_HISTORY) callHistory.length = MAX_HISTORY;
  if (detail.error || (detail.status !== null && detail.status >= 400)) {
    lastError = detail.error ?? `status ${detail.status}`;
  } else if (detail.status !== null && detail.status >= 200 && detail.status < 300) {
    lastError = null;
  }
  render();
}

// ===== Public API =====

/** Mount the badge into document.body. Idempotent. */
export function setupApiModeBadge(): void {
  ensureRoot();
  document.addEventListener('apiRouteCall', onApiRouteCall as EventListener);
  render();
}
