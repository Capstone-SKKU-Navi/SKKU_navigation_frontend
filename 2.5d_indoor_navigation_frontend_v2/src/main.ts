import 'maplibre-gl/dist/maplibre-gl.css';
import '../scss/main.scss';

import * as BackendService from './services/backendService';
import * as GeoMap from './components/geoMap';
import * as IndoorLayer from './components/indoorLayer';
import * as RouteOverlay from './components/routeOverlay';
import { fetchRoute, initRouting, searchRooms as apiSearchRooms } from './services/apiClient';
import type { RouteCoordinate } from './services/apiClient';
import { ROOM_TYPE_LABELS, RoomListItem } from './models/types';
import { setupGraphEditor } from './editor/graphEditor';
import * as VideoSettings from './editor/videoSettings';
import { buildWalkthroughPlaylist } from './services/walkthroughPlanner';
import * as WalkthroughOverlay from './components/walkthroughOverlay';

// ===== Helpers =====
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Route 3D sync =====
function syncRoute3D(): void {
  if (!RouteOverlay.hasRoute()) return;
  RouteOverlay.setIs3D(!GeoMap.isFlatMode());
}

// ===== Entry Point =====
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await Promise.all([
      BackendService.fetchBackendData(),
      initRouting(),
      VideoSettings.loadVideoSettings(),
    ]);
    GeoMap.initMap();

    document.addEventListener('mapLoaded', () => {
      setupBuildingInfo();
      setupCenterButton();
      setup3DToggle();
      setupFloorWheel();
      setupRoomSearch();
      setupRouteUI();
      setupRoomClickPopup();
      setupFpsCounter();
      setupLayerToggle();
      setupGraphEditor();

      // Sync floor wheel when walkthrough changes level
      document.addEventListener('walkthroughLevelChange', ((e: CustomEvent) => {
        updateFloorWheelActive(e.detail.level);
      }) as EventListener);

      // Update route opacity when level changes
      document.addEventListener('levelChanged', () => {
        RouteOverlay.onLevelChange();
      });

      hideLoading();
    });
  } catch (err: any) {
    showError(err?.message ?? '데이터를 불러올 수 없습니다.');
  }
});

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
  if (descEl) descEl.textContent = `${GeoMap.getCurrentLevel()}F`;
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
    btn.textContent = `${level}F`;
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
  }
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
  if (descEl) descEl.textContent = `${activeLevel}F`;
}

// ===== Room Search =====
function setupRoomSearch(): void {
  const input = document.getElementById('roomSearchInput') as HTMLInputElement;
  const dropdown = document.getElementById('searchAutocomplete');
  if (!input || !dropdown) return;

  let highlightIdx = -1;
  let currentResults: RoomListItem[] = [];

  input.addEventListener('input', async () => {
    const query = input.value.trim();
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

    // Click handlers
    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt((item as HTMLElement).dataset.index ?? '0');
        selectRoom(currentResults[idx]);
        dropdown.classList.remove('visible');
      });
    });
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
      selectRoom(currentResults[highlightIdx]);
      dropdown.classList.remove('visible');
    } else if (e.key === 'Escape') {
      dropdown.classList.remove('visible');
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#searchWrapper')) {
      dropdown.classList.remove('visible');
    }
  });
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

/** Cache centroids from search results so API mode doesn't depend on local GeoJSON */
const roomCentroidCache = new Map<string, { centroid: [number, number]; level: number }>();

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

  // Update endpoint preview markers when inputs change
  function updateEndpointPreview(): void {
    // Clear existing route and walkthrough when endpoints change
    if (RouteOverlay.hasRoute()) {
      RouteOverlay.clearRoute();
      WalkthroughOverlay.hideWalkthroughOverlay();
      const routeInfo = document.getElementById('routeInfo');
      const buildingInfo = document.getElementById('buildingInfo');
      if (routeInfo) routeInfo.style.display = 'none';
      if (buildingInfo) buildingInfo.style.display = 'flex';
    }
    const startRef = startInput?.value.trim();
    const endRef = endInput?.value.trim();
    const startPos = startRef ? BackendService.getRoomCentroid(startRef) : null;
    const endPos = endRef ? BackendService.getRoomCentroid(endRef) : null;
    const startLevel = startRef ? BackendService.getRoomLevel(startRef) : null;
    const endLevel = endRef ? BackendService.getRoomLevel(endRef) : null;
    RouteOverlay.showEndpointPreview(startPos, endPos, startLevel, endLevel);
  }

  // Listen for popup-triggered endpoint changes
  document.addEventListener('routeEndpointChanged', updateEndpointPreview);

  // Autocomplete for start/end inputs
  if (startInput) setupRouteAutocomplete(startInput, 'startAutocomplete', updateEndpointPreview);
  if (endInput) setupRouteAutocomplete(endInput, 'endAutocomplete', updateEndpointPreview);

  // Update preview as user types a valid ref
  startInput?.addEventListener('input', updateEndpointPreview);
  endInput?.addEventListener('input', updateEndpointPreview);

  findBtn?.addEventListener('click', async () => {
    const fromRef = startInput?.value.trim();
    const toRef = endInput?.value.trim();
    if (!fromRef || !toRef) return;

    // Convert room refs to coordinates — use search result cache first, fallback to GeoJSON
    const fromCached = roomCentroidCache.get(fromRef);
    const toCached = roomCentroidCache.get(toRef);
    const fromCentroid = fromCached?.centroid ?? BackendService.getRoomCentroid(fromRef);
    const toCentroid = toCached?.centroid ?? BackendService.getRoomCentroid(toRef);
    const fromLevel = fromCached?.level ?? BackendService.getRoomLevel(fromRef);
    const toLevel = toCached?.level ?? BackendService.getRoomLevel(toRef);

    if (!fromCentroid || !toCentroid || fromLevel === null || toLevel === null) {
      console.warn('[Route] Room not found:', fromRef, toRef);
      return;
    }

    const from: RouteCoordinate = { lng: fromCentroid[0], lat: fromCentroid[1], level: fromLevel };
    const to: RouteCoordinate = { lng: toCentroid[0], lat: toCentroid[1], level: toLevel };

    try {
      const routeResult = await fetchRoute(from, to);
      if (!routeResult) {
        console.warn('[Route] No route found:', fromRef, '→', toRef);
        return;
      }

      RouteOverlay.clearEndpointPreview();
      if (routeResult.coordinates.length >= 2) {
        RouteOverlay.showRoute(
          routeResult.coordinates,
          routeResult.levels,
          !GeoMap.isFlatMode(),
        );
      }

      showRouteInfo(routeResult.estimatedTime, routeResult.totalDistance);

      // Build walkthrough video overlay
      const playlist = buildWalkthroughPlaylist(routeResult);
      console.log('[Walkthrough] playlist:', playlist ? `${playlist.clips.length} clips, ${playlist.totalDuration.toFixed(1)}s` : 'null');
      if (playlist && playlist.clips.length > 0) {
        WalkthroughOverlay.showWalkthroughOverlay(playlist);
      }
    } catch (err: any) {
      console.error('경로 검색 실패:', err);
    }
  });

  clearBtn?.addEventListener('click', () => {
    RouteOverlay.clearRoute();
    WalkthroughOverlay.hideWalkthroughOverlay();
    const routeInfo = document.getElementById('routeInfo');
    const buildingInfo = document.getElementById('buildingInfo');
    if (routeInfo) routeInfo.style.display = 'none';
    if (buildingInfo) buildingInfo.style.display = 'flex';
    // Restore route toggle button and hide inputs
    if (routeInputs) routeInputs.style.display = 'none';
    if (toggleBtn) { toggleBtn.style.display = ''; toggleBtn.classList.remove('active'); }
  });
}

function setupRouteAutocomplete(input: HTMLInputElement, dropdownId: string, onSelect?: () => void): void {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;

  let highlightIdx = -1;
  let currentResults: RoomListItem[] = [];

  input.addEventListener('input', async () => {
    const query = input.value.trim();
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
        const room = currentResults[idx];
        input.value = room.ref;
        if (room.centroid) roomCentroidCache.set(room.ref, { centroid: room.centroid, level: room.level[0] });
        dropdown.classList.remove('visible');
        onSelect?.();
      });
    });
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
      const room = currentResults[highlightIdx];
      input.value = room.ref;
      if (room.centroid) roomCentroidCache.set(room.ref, { centroid: room.centroid, level: room.level[0] });
      dropdown.classList.remove('visible');
      onSelect?.();
    } else if (e.key === 'Escape') {
      dropdown.classList.remove('visible');
    }
  });

  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.route-input-wrapper')) {
      dropdown.classList.remove('visible');
    }
  });
}

function showRouteInfo(time: string, distance: number): void {
  const routeInfo = document.getElementById('routeInfo');
  const routeText = document.getElementById('routeInfoText');
  const buildingInfo = document.getElementById('buildingInfo');

  if (routeInfo && routeText) {
    routeText.textContent = `예상 ${time} · ${distance}m`;
    routeInfo.style.display = 'flex';
  }
  if (buildingInfo) buildingInfo.style.display = 'none';
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
    if (selectedRef) {
      const input = document.getElementById('startRoomInput') as HTMLInputElement;
      if (input) input.value = selectedRef;
      const routeInputs = document.getElementById('routeInputs');
      if (routeInputs) routeInputs.style.display = 'flex';
      const toggleBtn = document.getElementById('routeToggleBtn');
      if (toggleBtn) toggleBtn.style.display = 'none';
      document.dispatchEvent(new Event('routeEndpointChanged'));
    }
    popup.style.display = 'none';
  });

  document.getElementById('popupSetEnd')?.addEventListener('click', () => {
    if (selectedRef) {
      const input = document.getElementById('endRoomInput') as HTMLInputElement;
      if (input) input.value = selectedRef;
      const routeInputs = document.getElementById('routeInputs');
      if (routeInputs) routeInputs.style.display = 'flex';
      const toggleBtn = document.getElementById('routeToggleBtn');
      if (toggleBtn) toggleBtn.style.display = 'none';
      document.dispatchEvent(new Event('routeEndpointChanged'));
    }
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

  function clearRouteEndpoints(): void {
    const startInput = document.getElementById('startRoomInput') as HTMLInputElement;
    const endInput = document.getElementById('endRoomInput') as HTMLInputElement;
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    RouteOverlay.clearEndpointPreview();
    RouteOverlay.clearRoute();
    WalkthroughOverlay.hideWalkthroughOverlay();
    const routeInfo = document.getElementById('routeInfo');
    const buildingInfo = document.getElementById('buildingInfo');
    if (routeInfo) routeInfo.style.display = 'none';
    if (buildingInfo) buildingInfo.style.display = 'flex';
    const routeInputs = document.getElementById('routeInputs');
    if (routeInputs) routeInputs.style.display = 'none';
    const toggleBtn = document.getElementById('routeToggleBtn');
    if (toggleBtn) { toggleBtn.style.display = ''; toggleBtn.classList.remove('active'); }
  }

  document.addEventListener('contextmenu', () => {
    popup.style.display = 'none';
  });

  // Right-click on a room that is set as start/end → clear that endpoint
  document.addEventListener('roomRightClicked', ((e: CustomEvent) => {
    const ref = e.detail.ref;
    const startInput = document.getElementById('startRoomInput') as HTMLInputElement;
    const endInput = document.getElementById('endRoomInput') as HTMLInputElement;
    if (startInput && startInput.value.trim() === ref) startInput.value = '';
    if (endInput && endInput.value.trim() === ref) endInput.value = '';
    document.dispatchEvent(new Event('routeEndpointChanged'));
  }) as EventListener);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (popup.style.display !== 'none') {
        popup.style.display = 'none';
        return;
      }
      clearRouteEndpoints();
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
