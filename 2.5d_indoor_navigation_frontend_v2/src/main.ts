import 'maplibre-gl/dist/maplibre-gl.css';
import '../scss/main.scss';

import * as BackendService from './services/backendService';
import * as GeoMap from './components/geoMap';
import * as RouteOverlay from './components/routeOverlay';
import { fetchRoute } from './services/apiClient';
import { ROOM_TYPE_LABELS, RoomListItem } from './models/types';
import { setupGraphEditor } from './editor/graphEditor';

// ===== App State =====
let startRoom: string | null = null;
let endRoom: string | null = null;

// ===== Entry Point =====
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await BackendService.fetchBackendData();
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
      setupGraphEditor();
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
    overlay.innerHTML = `<p style="color:#ef5350;">${msg}</p>`;
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

  input.addEventListener('input', () => {
    const query = input.value.trim();
    currentResults = BackendService.searchRooms(query);
    highlightIdx = -1;

    if (currentResults.length === 0) {
      dropdown.classList.remove('visible');
      return;
    }

    dropdown.innerHTML = currentResults.map((r, i) => {
      const typeLabel = ROOM_TYPE_LABELS[r.roomType] ?? r.roomType;
      const levelStr = r.level.join(',');
      return `<div class="autocomplete-item" data-index="${i}">
        <span class="room-ref">${r.ref}</span>
        <span class="room-meta">${levelStr}F ${typeLabel}${r.name ? ` · ${r.name}` : ''}</span>
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
    }
  });

  findBtn?.addEventListener('click', async () => {
    const from = startInput?.value.trim();
    const to = endInput?.value.trim();
    if (!from || !to) return;

    try {
      const route = await fetchRoute(from, to);
      showRouteOnMap(route.path);
      showRouteInfo(route.estimatedTime, route.totalDistance);
    } catch (err: any) {
      console.error('경로 검색 실패:', err);
    }
  });

  clearBtn?.addEventListener('click', () => {
    RouteOverlay.clearRoute();
    const routeInfo = document.getElementById('routeInfo');
    const buildingInfo = document.getElementById('buildingInfo');
    if (routeInfo) routeInfo.style.display = 'none';
    if (buildingInfo) buildingInfo.style.display = 'flex';
  });
}

function showRouteOnMap(pathNodeIds: string[]): void {
  // For now, use mock coordinates along building corridors
  // TODO: resolve node IDs to actual coordinates via graph.json
  const geoJson = BackendService.getGeoJson();
  const coords: GeoJSON.Position[] = [];

  for (const nodeId of pathNodeIds) {
    const feature = geoJson.features.find(f =>
      f.id === `node/${nodeId}` || f.properties.ref === nodeId
    );
    if (feature && feature.geometry.type === 'Point') {
      coords.push((feature.geometry as GeoJSON.Point).coordinates);
    }
  }

  if (coords.length >= 2) {
    RouteOverlay.showRoute(coords);
  }
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

  document.addEventListener('roomClicked', ((e: CustomEvent) => {
    const { ref, screenX, screenY } = e.detail;
    if (!ref) return;
    selectedRef = ref;
    popup.style.display = 'block';
    popup.style.left = `${screenX}px`;
    popup.style.top = `${screenY}px`;
  }) as EventListener);

  document.getElementById('popupSetStart')?.addEventListener('click', () => {
    if (selectedRef) {
      startRoom = selectedRef;
      const input = document.getElementById('startRoomInput') as HTMLInputElement;
      if (input) input.value = selectedRef;
      // Show route inputs
      const routeInputs = document.getElementById('routeInputs');
      if (routeInputs) routeInputs.style.display = 'flex';
    }
    popup.style.display = 'none';
  });

  document.getElementById('popupSetEnd')?.addEventListener('click', () => {
    if (selectedRef) {
      endRoom = selectedRef;
      const input = document.getElementById('endRoomInput') as HTMLInputElement;
      if (input) input.value = selectedRef;
      const routeInputs = document.getElementById('routeInputs');
      if (routeInputs) routeInputs.style.display = 'flex';
    }
    popup.style.display = 'none';
  });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('#roomPopup') && !target.closest('.maplibregl-canvas')) {
      popup.style.display = 'none';
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
