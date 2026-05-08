import 'maplibre-gl/dist/maplibre-gl.css';
import '../scss/main.scss';

import * as BackendService from './services/backendService';
import * as GeoMap from './components/geoMap';
import * as IndoorLayer from './components/indoorLayer';
import * as RouteOverlay from './components/routeOverlay';
import * as RoutePinMarkers from './components/routePinMarkers';
import { initRouting, searchRooms as apiSearchRooms, setUseApi, isApiMode } from './services/apiClient';
import { getApiBase } from './config/apiConfig';
import { ROOM_TYPE_LABELS, RoomListItem } from './models/types';
import * as VideoSettings from './editor/videoSettings';
import * as WalkthroughOverlay from './components/walkthroughOverlay';
import { isMobileDevice } from './utils/deviceDetection';
import * as RouteActions from './services/routeActions';
import * as GraphService from './services/graphService';
import { setupApiModeBadge } from './components/apiModeBadge';
import { escapeHtml } from './utils/escapeHtml';
import { formatLevel } from './utils/formatLevel';

// ===== Route 3D sync =====
function syncRoute3D(): void {
  // Always forward the 3D state — endpoint-preview markers (shown before a
  // route is searched) also need it so they sit at the correct altitude.
  RouteOverlay.setIs3D(!GeoMap.isFlatMode());
}

// ===== Entry Point =====
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Backend data must complete first: graph import (inside initRouting)
    // calls detectBuilding() which depends on building outlines being loaded.
    // Running them in parallel races and stamps every node "outside".
    await BackendService.fetchBackendData();
    await Promise.all([
      initRouting(),
      VideoSettings.loadVideoSettings(),
    ]);
    GeoMap.initMap();

    if (!IS_PROD_BUILD) {
      setupReloadDataShortcut();
    }

    document.addEventListener('mapLoaded', async () => {
      const mobile = isMobileDevice();
      document.body.dataset.device = mobile ? 'mobile' : 'pc';

      // Shared setups (both PC and mobile)
      setupBuildingInfo();
      setupCenterButton();
      setup3DToggle();
      if (!IS_PROD_BUILD && !mobile) {
        // API mode toggle is dev-only and PC-only. Mobile devices can't reach
        // localhost:8080 anyway, so the badge is hidden and API mode is forced
        // unconditionally below.
        setupFpsCounter();
        setupApiModeBadge();
      }
      setupPinChipDrop();
      const map = GeoMap.getMap();
      if (map) RoutePinMarkers.init(map);

      if (mobile) {
        // Mobile chrome — dynamic import keeps mobile code out of the PC bundle
        const mobileModule = await import(/* webpackChunkName: "mobile" */ './mobile');
        mobileModule.setupMobileChrome();
        // PC chrome is hidden by CSS only *after* data-device is set, which
        // resizes the map container. Without an explicit resize the map's
        // internal projection stays stale, so pan/zoom doesn't match where
        // overlays (route, markers, indoor layers) are drawn.
        requestAnimationFrame(() => GeoMap.getMap()?.resize());
        // Mobile clients can't reach `localhost:8080` directly; force API mode
        // so routing and geojson load from the deployed backend instead of
        // the local-only fallback. Best-effort — failure leaves the local
        // snapshot in place so the UI is still navigable.
        forceApiModeForMobile().catch(err => {
          console.warn('[Mobile] forceApiMode failed:', err);
        });
      } else {
        // PC chrome
        setupFloorWheel();
        setupRoomSearch();
        setupRouteUI();
        setupRoomClickPopup();
        setupLayerToggle();

        // Editor is PC-only — dynamic import keeps editor code out of the mobile bundle.
        // The IS_PROD_BUILD guard makes terser eliminate this branch entirely in
        // `npm run build:prod`, so the editor chunk is never emitted into dist/.
        if (!IS_PROD_BUILD) {
          const editorModule = await import(/* webpackChunkName: "editor" */ './editor/graphEditor');
          editorModule.setupGraphEditor();
        }

        // Sync floor wheel when walkthrough changes level (PC floor wheel uses updateFloorWheelActive)
        document.addEventListener('walkthroughLevelChange', ((e: CustomEvent) => {
          updateFloorWheelActive(e.detail.level);
        }) as EventListener);
      }

      // Update route opacity when level changes (shared)
      document.addEventListener('levelChanged', () => {
        RouteOverlay.onLevelChange();
      });

      hideLoading();
    });
  } catch (err: any) {
    showError(err?.message ?? '데이터를 불러올 수 없습니다.');
  }
});

// Mirrors the API-direction half of apiModeBadge.onToggleClick: switch the
// router to API mode, refresh BackendService from /api/geojson/all, and
// rebuild the map sources. Idempotent.
async function forceApiModeForMobile(): Promise<void> {
  if (isApiMode()) return;
  setUseApi(true);
  await initRouting();
  await BackendService.fetchBackendDataFromApi(getApiBase());
  const map = GeoMap.getMap();
  if (map) IndoorLayer.refreshAll(map);
}

// ===== Loading =====
function hideLoading(): void {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function showError(msg: string): void {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.innerHTML = `<p style="color:#ef5350;">${escapeHtml(msg)}</p>`;
  }
}

// ===== Building Info =====
function setupBuildingInfo(): void {
  const buildingEl = document.getElementById('selectedBuilding');
  const descEl = document.getElementById('description');
  if (buildingEl) buildingEl.textContent = BackendService.getBuildingDescription();
  if (descEl) descEl.textContent = formatLevel(GeoMap.getCurrentLevel());
}

// ===== 2D/3D Toggle =====
function setup3DToggle(): void {
  const btn = document.getElementById('switch3DBtn');
  const icon = document.getElementById('switch3DIcon');
  if (!btn) return;

  btn.addEventListener('click', () => {
    GeoMap.toggle3D();
    const is3D = !GeoMap.isFlatMode();
    if (icon) icon.textContent = is3D ? 'map' : '3d_rotation';
    btn.classList.toggle('active', is3D);
    syncRoute3D();
  });
}

// ===== Center Button =====
function setupCenterButton(): void {
  document.getElementById('centerBtn')?.addEventListener('click', () => {
    GeoMap.centerMapToBuilding();
  });
}

// ===== Floor Wheel =====
function setupFloorWheel(): void {
  const container = document.getElementById('floorWheelInner');
  if (!container) return;

  const levels = BackendService.getAllLevels();
  const currentLevel = GeoMap.getCurrentLevel();

  levels.forEach(level => {
    const btn = document.createElement('button');
    btn.className = 'floor-wheel-item';
    btn.textContent = formatLevel(level);
    btn.dataset.level = level.toString();

    btn.addEventListener('click', () => {
      GeoMap.handleLevelChange(level);
      updateFloorWheelActive(level);
    });

    container.appendChild(btn);
  });

  updateFloorWheelActive(currentLevel);

  // Mouse wheel
  const wheel = document.getElementById('floorWheel');
  if (wheel) {
    wheel.addEventListener('wheel', (e) => {
      e.preventDefault();
      const currentIdx = levels.indexOf(GeoMap.getCurrentLevel());
      const newIdx = e.deltaY > 0
        ? Math.min(currentIdx + 1, levels.length - 1)
        : Math.max(currentIdx - 1, 0);
      if (newIdx !== currentIdx) {
        const newLevel = levels[newIdx];
        GeoMap.handleLevelChange(newLevel);
        updateFloorWheelActive(newLevel);
      }
    }, { passive: false });

    // Drag (pointer) to advance floors. Items are ~46px tall in the PC wheel
    // (40px + 6px gap), so each ~46px of vertical travel = one floor step.
    setupFloorWheelDrag(wheel, levels);
  }
}

function setupFloorWheelDrag(wheel: HTMLElement, levels: number[]): void {
  const STEP = 46;
  let activeId: number | null = null;
  let startY = 0;
  let startIdx = 0;
  let moved = false;
  let lastTargetIdx = -1;

  wheel.addEventListener('pointerdown', (e) => {
    // Don't hijack clicks on the floor item buttons unless the user actually drags.
    if (activeId !== null) return;
    activeId = e.pointerId;
    startY = e.clientY;
    startIdx = levels.indexOf(GeoMap.getCurrentLevel());
    lastTargetIdx = startIdx;
    moved = false;
  });

  wheel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dy) > 6) {
      moved = true;
      try { wheel.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }
    if (!moved) return;
    // Drag DOWN → rotate wheel forward → higher floor (smaller idx in the
    // descending levels array). Subtract the step.
    const targetIdx = Math.max(0, Math.min(levels.length - 1, startIdx - Math.round(dy / STEP)));
    if (targetIdx !== lastTargetIdx) {
      lastTargetIdx = targetIdx;
      const newLevel = levels[targetIdx];
      if (newLevel !== GeoMap.getCurrentLevel()) {
        GeoMap.handleLevelChange(newLevel);
        updateFloorWheelActive(newLevel);
      }
    }
  });

  const release = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    if (moved) {
      // Suppress the synthetic click that would otherwise fire on the
      // floor item under the pointer when the drag ends.
      const stop = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      wheel.addEventListener('click', stop, { capture: true, once: true });
    }
  };
  wheel.addEventListener('pointerup', release);
  wheel.addEventListener('pointercancel', release);
}

function updateFloorWheelActive(activeLevel: number): void {
  const levels = BackendService.getAllLevels();
  const activeIdx = levels.indexOf(activeLevel);

  document.querySelectorAll('.floor-wheel-item').forEach((btn, i) => {
    btn.classList.remove('active', 'adjacent', 'far');
    const dist = Math.abs(i - activeIdx);
    if (dist === 0) btn.classList.add('active');
    else if (dist === 1) btn.classList.add('adjacent');
    else btn.classList.add('far');
  });

  const descEl = document.getElementById('description');
  if (descEl) descEl.textContent = formatLevel(activeLevel);
}

// ===== Generic autocomplete wiring =====
//
// Drives the input → debounced search → dropdown → keyboard nav loop for
// both the top-bar search and the route start/end inputs. Caller supplies
// the outside-click container selector and the per-pick handler.
function setupAutocomplete(
  input: HTMLInputElement,
  dropdown: HTMLElement,
  outsideSelector: string,
  onPick: (room: RoomListItem) => void,
): void {
  let highlightIdx = -1;
  let currentResults: RoomListItem[] = [];
  let searchTimer: number | null = null;

  const runSearch = async (query: string) => {
    const results = await apiSearchRooms(query);
    if (input.value.trim() !== query) return; // stale response — input changed during fetch
    currentResults = results;
    highlightIdx = -1;

    if (currentResults.length === 0) {
      dropdown.classList.remove('visible');
      return;
    }

    dropdown.innerHTML = currentResults.map((r, i) => {
      const typeLabel = ROOM_TYPE_LABELS[r.roomType] ?? r.roomType;
      const levelStr = r.level.join(',');
      return `<div class="autocomplete-item" data-index="${i}">
        <span class="room-ref">${escapeHtml(r.ref)}</span>
        <span class="room-meta">${levelStr}F ${escapeHtml(typeLabel)}${r.name ? ` · ${escapeHtml(r.name)}` : ''}</span>
      </div>`;
    }).join('');

    dropdown.classList.add('visible');

    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt((item as HTMLElement).dataset.index ?? '0');
        onPick(currentResults[idx]);
        dropdown.classList.remove('visible');
      });
    });
  };

  input.addEventListener('input', () => {
    const query = input.value.trim();
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    // Debounce keystroke-driven calls (Korean IME composition fires per jamo).
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      runSearch(query);
    }, 180);
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightIdx = Math.min(highlightIdx + 1, items.length - 1);
      updateHighlight(items, highlightIdx);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightIdx = Math.max(highlightIdx - 1, 0);
      updateHighlight(items, highlightIdx);
    } else if (e.key === 'Enter' && highlightIdx >= 0) {
      e.preventDefault();
      onPick(currentResults[highlightIdx]);
      dropdown.classList.remove('visible');
    } else if (e.key === 'Escape') {
      dropdown.classList.remove('visible');
    }
  });

  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest(outsideSelector)) {
      dropdown.classList.remove('visible');
    }
  });
}

// ===== Room Search (top-bar) =====
function setupRoomSearch(): void {
  const input = document.getElementById('roomSearchInput') as HTMLInputElement;
  const dropdown = document.getElementById('searchAutocomplete');
  if (!input || !dropdown) return;
  setupAutocomplete(input, dropdown, '#searchWrapper', selectRoom);
}

function updateHighlight(items: NodeListOf<Element>, idx: number): void {
  items.forEach((item, i) => {
    item.classList.toggle('highlighted', i === idx);
  });
}

function selectRoom(room: RoomListItem): void {
  const input = document.getElementById('roomSearchInput') as HTMLInputElement;
  if (input) input.value = room.ref;

  // Fly to room and switch level
  if (room.level.length > 0) {
    GeoMap.handleLevelChange(room.level[0]);
    updateFloorWheelActive(room.level[0]);
  }
  GeoMap.flyToRoom(room.ref);
}

// ===== Route UI =====

function setupRouteUI(): void {
  const toggleBtn = document.getElementById('routeToggleBtn');
  const routeInputs = document.getElementById('routeInputs');
  const findBtn = document.getElementById('findRouteBtn');
  const clearBtn = document.getElementById('routeClearBtn');
  const startInput = document.getElementById('startRoomInput') as HTMLInputElement;
  const endInput = document.getElementById('endRoomInput') as HTMLInputElement;

  toggleBtn?.addEventListener('click', () => {
    if (routeInputs) {
      const visible = routeInputs.style.display !== 'none';
      routeInputs.style.display = visible ? 'none' : 'flex';
      toggleBtn.classList.toggle('active', !visible);
      toggleBtn.style.display = visible ? '' : 'none';
    }
  });

  // Clear existing route and walkthrough when endpoints change
  function maybeClearStaleRoute(): void {
    if (RouteOverlay.hasRoute()) {
      RouteOverlay.clearRoute();
      WalkthroughOverlay.hideWalkthroughOverlay();
      const routeInfo = document.getElementById('routeInfo');
      const buildingInfo = document.getElementById('buildingInfo');
      if (routeInfo) routeInfo.style.display = 'none';
      if (buildingInfo) buildingInfo.style.display = 'flex';
    }
  }

  // Listen for popup-triggered endpoint changes — pin markers handle their own
  // visual state via `routeEndpointChanged`, so we only invalidate stale routes.
  document.addEventListener('routeEndpointChanged', maybeClearStaleRoute);

  // Autocomplete for start/end inputs
  if (startInput) setupRouteAutocomplete(startInput, 'startAutocomplete');
  if (endInput) setupRouteAutocomplete(endInput, 'endAutocomplete');

  // User typing into the input → clear any coord override on that slot,
  // and notify listeners so the pin markers re-resolve from the new ref.
  startInput?.addEventListener('input', () => {
    RouteActions.notifyInputChanged('start');
    document.dispatchEvent(new Event('routeEndpointChanged'));
  });
  endInput?.addEventListener('input', () => {
    RouteActions.notifyInputChanged('end');
    document.dispatchEvent(new Event('routeEndpointChanged'));
  });

  findBtn?.addEventListener('click', () => {
    RouteActions.triggerFindRoute();
  });

  clearBtn?.addEventListener('click', () => {
    RouteActions.clearRoute();
  });
}

// ===== Drag-source chips → drop on map =====
//
// PC: HTML5 drag-and-drop. Chips set a custom MIME payload (PIN_DRAG_MIME);
// the map only accepts drops carrying that MIME, so text selections dragged
// from inputs don't trigger a phantom pin drop.
//
// Mobile: HTML5 drag events don't fire on touch, so we implement a manual
// touch-drag with a floating clone that follows the finger and a final
// drop test against the map element's bounding rect.
const PIN_DRAG_MIME = 'application/x-route-pin';

function dropPinAtClientPoint(slot: 'start' | 'end', clientX: number, clientY: number): void {
  const mapEl = document.getElementById('map');
  const map = GeoMap.getMap();
  if (!mapEl || !map) return;
  const rect = mapEl.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
  const { lng, lat } = map.unproject([clientX - rect.left, clientY - rect.top]);
  RoutePinMarkers.dropPin(slot, lng, lat);
}

function setupPinChipDrop(): void {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;
  const chips = document.querySelectorAll<HTMLElement>('.route-pin-chip');
  chips.forEach(chip => {
    const slot: 'start' | 'end' = chip.dataset.pin === 'end' ? 'end' : 'start';

    // PC: native HTML5 drag
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(PIN_DRAG_MIME, slot);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      mapEl.classList.add('route-pin-drop-active');
    });
    chip.addEventListener('dragend', () => {
      mapEl.classList.remove('route-pin-drop-active');
    });

    // Mobile: manual touch-drag with a floating ghost clone
    setupChipTouchDrag(chip, slot, mapEl);
  });

  mapEl.addEventListener('dragover', (e) => {
    if (!isPinDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  mapEl.addEventListener('drop', (e) => {
    if (!isPinDrag(e)) return;
    e.preventDefault();
    mapEl.classList.remove('route-pin-drop-active');
    const payload = e.dataTransfer?.getData(PIN_DRAG_MIME) ?? '';
    const slot: 'start' | 'end' = payload === 'end' ? 'end' : 'start';
    dropPinAtClientPoint(slot, e.clientX, e.clientY);
  });
}

function setupChipTouchDrag(chip: HTMLElement, slot: 'start' | 'end', mapEl: HTMLElement): void {
  let ghost: HTMLElement | null = null;
  let activeId: number | null = null;

  const moveGhost = (x: number, y: number) => {
    if (!ghost) return;
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
  };

  chip.addEventListener('touchstart', (e) => {
    if (activeId !== null) return;
    const touch = e.changedTouches[0];
    activeId = touch.identifier;
    e.preventDefault();
    ghost = chip.cloneNode(true) as HTMLElement;
    ghost.classList.add('route-pin-chip-ghost');
    document.body.appendChild(ghost);
    moveGhost(touch.clientX, touch.clientY);
    mapEl.classList.add('route-pin-drop-active');
  }, { passive: false });

  chip.addEventListener('touchmove', (e) => {
    if (activeId === null) return;
    const touch = Array.from(e.changedTouches).find(t => t.identifier === activeId);
    if (!touch) return;
    e.preventDefault();
    moveGhost(touch.clientX, touch.clientY);
  }, { passive: false });

  const finish = (e: TouchEvent) => {
    if (activeId === null) return;
    const touch = Array.from(e.changedTouches).find(t => t.identifier === activeId);
    if (!touch) return;
    activeId = null;
    mapEl.classList.remove('route-pin-drop-active');
    if (ghost) { ghost.remove(); ghost = null; }
    dropPinAtClientPoint(slot, touch.clientX, touch.clientY);
  };

  chip.addEventListener('touchend', finish);
  chip.addEventListener('touchcancel', finish);
}

function isPinDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes(PIN_DRAG_MIME);
}

function setupRouteAutocomplete(input: HTMLInputElement, dropdownId: string): void {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  const slot: 'start' | 'end' = input.id === 'startRoomInput' ? 'start' : 'end';
  setupAutocomplete(input, dropdown, '.route-input-wrapper', (room) => {
    RouteActions.cacheRoomCentroid(room);
    if (slot === 'start') RouteActions.setStart(room.ref);
    else RouteActions.setEnd(room.ref);
  });
}

// ===== Room Click Popup =====
function setupRoomClickPopup(): void {
  const popup = document.getElementById('roomPopup');
  if (!popup) return;

  let selectedRef: string | null = null;
  let justOpened = false;

  document.addEventListener('roomClicked', ((e: CustomEvent) => {
    const { ref, screenX, screenY } = e.detail;
    if (!ref) return;
    selectedRef = ref;
    popup.style.display = 'block';
    popup.style.left = `${screenX}px`;
    popup.style.top = `${screenY}px`;
    justOpened = true;
    requestAnimationFrame(() => { justOpened = false; });
  }) as EventListener);

  document.getElementById('popupSetStart')?.addEventListener('click', () => {
    if (selectedRef) RouteActions.setStart(selectedRef);
    popup.style.display = 'none';
  });

  document.getElementById('popupSetEnd')?.addEventListener('click', () => {
    if (selectedRef) RouteActions.setEnd(selectedRef);
    popup.style.display = 'none';
  });

  // Close popup: click outside or right-click anywhere or Esc
  document.addEventListener('click', (e) => {
    if (justOpened) return;
    const target = e.target as HTMLElement;
    if (!target.closest('#roomPopup')) {
      popup.style.display = 'none';
    }
  });

  document.addEventListener('contextmenu', () => {
    popup.style.display = 'none';
  });

  // Right-click on a room that is set as start/end → clear that endpoint
  document.addEventListener('roomRightClicked', ((e: CustomEvent) => {
    RouteActions.clearEndpointByRef(e.detail.ref);
  }) as EventListener);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (popup.style.display !== 'none') {
        popup.style.display = 'none';
        return;
      }
      RouteActions.clearRoute();
    }
  });
}

// ===== Layer Toggle =====
function setupLayerToggle(): void {
  const btn = document.getElementById('layerToggleBtn');
  const panel = document.getElementById('layerPanel');
  if (!btn || !panel) return;

  btn.addEventListener('click', () => {
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    btn.classList.toggle('active', !visible);
  });

  // Close panel on outside click
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('#layerPanel') && !target.closest('#layerToggleBtn')) {
      panel.style.display = 'none';
      btn.classList.remove('active');
    }
  });

  const groups = [
    { id: 'layerRooms', group: 'rooms' as const },
    { id: 'layerCorridors', group: 'corridors' as const },
    { id: 'layerWalls', group: 'walls' as const },
    { id: 'layerLabels', group: 'labels' as const },
  ];

  for (const { id, group } of groups) {
    const checkbox = document.getElementById(id) as HTMLInputElement;
    if (!checkbox) continue;
    checkbox.addEventListener('change', () => {
      const map = GeoMap.getMap();
      if (map) IndoorLayer.setLayerGroupVisibility(map, group, checkbox.checked);
    });
  }

}

// ===== Reload Data Shortcut (Ctrl+Alt+R) =====
// Re-fetches geojson + graph from disk so newly-added refs appear without a full page refresh.
function setupReloadDataShortcut(): void {
  let reloading = false;
  document.addEventListener('keydown', async (e) => {
    if (!(e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R'))) return;
    e.preventDefault();
    if (reloading) return;
    reloading = true;
    try {
      const t0 = performance.now();
      await BackendService.fetchBackendData();
      await GraphService.loadGraph();
      const map = GeoMap.getMap();
      if (map) IndoorLayer.refreshAll(map);
      console.log(`[Reload] backend + graph reloaded in ${Math.round(performance.now() - t0)}ms`);
    } catch (err) {
      console.warn('[Reload] failed:', err);
    } finally {
      reloading = false;
    }
  });
}

// ===== FPS Counter =====
function setupFpsCounter(): void {
  const el = document.createElement('div');
  el.className = 'fps-counter';
  document.body.appendChild(el);

  let frames = 0;
  let last = performance.now();

  function tick() {
    frames++;
    const now = performance.now();
    if (now - last >= 1000) {
      el.textContent = `${frames} fps`;
      frames = 0;
      last = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
