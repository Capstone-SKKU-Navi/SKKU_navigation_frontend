// ===== Navigation Graph Editor — Main Orchestration =====

import maplibregl from 'maplibre-gl';
import { EditorMode, NavGraphExport, RoomAutoApplyPreset, RoomType } from './graphEditorTypes';
import * as State from './graphEditorState';
import * as EditorMap from './graphEditorMap';
import * as Panel from './graphEditorPanel';
import * as GeoMap from '../components/geoMap';
import * as IndoorLayer from '../components/indoorLayer';
import * as BackendService from '../services/backendService';
import * as IndoorLayerModule from '../components/indoorLayer';

let state = State.createState();
let active = false;
let map: maplibregl.Map | null = null;

// Track level changes and 3D mode
let lastKnownLevel = 1;
let lastKnownFlatMode = true;
let levelCheckInterval: number | null = null;

// ===== Public API =====

export function setupGraphEditor(): void {
  const btn = document.createElement('button');
  btn.id = 'graphEditorToggle';
  btn.className = 'header-icon-btn';
  btn.title = 'Graph Editor (Dev)';
  btn.innerHTML = '<span class="material-icons">hub</span>';

  const headerRight = document.querySelector('.header-right');
  if (headerRight) {
    headerRight.prepend(btn);
  }

  btn.addEventListener('click', () => toggleEditor());
}

// ===== Toggle =====

function toggleEditor(): void {
  if (active) {
    deactivateEditor();
  } else {
    activateEditor();
  }
}

async function activateEditor(): Promise<void> {
  map = GeoMap.getMap();
  if (!map) return;

  active = true;
  state = State.createState();
  state.currentLevel = IndoorLayer.getCurrentLevel();
  lastKnownLevel = state.currentLevel;

  // Load graph from file
  const saved = await State.loadGraphFromFile();
  if (saved) state.graph = saved;

  lastKnownFlatMode = GeoMap.isFlatMode();

  // Add editor layers to map
  EditorMap.initEditorLayers(map);

  // Init floating 3D overlays (nodes + edges)
  EditorMap.initFloatingNodes(map, handleNodeClick);
  EditorMap.initFloatingEdges(map);

  // Create panel
  Panel.createPanel({
    onModeChange: handleModeChange,
    onNodeUpdate: handleNodeUpdate,
    onNodeDelete: handleNodeDelete,
    onRoomUpdate: handleRoomUpdate,
    onRoomExport: handleRoomExport,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onImport: handleImport,
    onExport: handleExport,
    onClearAll: handleClearAll,
    onAutoApplyChange: handleAutoApplyChange,
    onClose: deactivateEditor,
  });

  // Set up map click handlers
  EditorMap.setClickHandlers(map, {
    onMapClick: handleMapClick,
    onNodeClick: handleNodeClick,
    onEdgeClick: handleEdgeClick,
  });

  // Keyboard shortcuts & right-click cancel
  document.addEventListener('keydown', handleKeyDown);
  map.getCanvas().addEventListener('contextmenu', handleRightClick);

  // Prevent room popup while editing
  document.body.classList.add('editor-active');

  // Toggle button active state
  const btn = document.getElementById('graphEditorToggle');
  if (btn) btn.classList.add('active');

  // Poll for level changes
  levelCheckInterval = window.setInterval(checkLevelChange, 200);

  refreshMap();
}

function deactivateEditor(): void {
  if (!map) return;

  active = false;

  removeRoomClickListener();
  EditorMap.removeClickHandlers(map);
  EditorMap.destroyFloatingNodes();
  EditorMap.destroyFloatingEdges();
  EditorMap.destroyEditorLayers(map);
  Panel.destroyPanel();

  document.removeEventListener('keydown', handleKeyDown);
  map.getCanvas().removeEventListener('contextmenu', handleRightClick);
  document.body.classList.remove('editor-active');

  const btn = document.getElementById('graphEditorToggle');
  if (btn) btn.classList.remove('active');

  if (levelCheckInterval !== null) {
    clearInterval(levelCheckInterval);
    levelCheckInterval = null;
  }

  selectedRoomIdx = null;
  autoApplyPreset = { enabled: false, roomType: '' as RoomType, refPrefix: '' };
  map = null;
}

// ===== Level Change Detection =====

function checkLevelChange(): void {
  const currentLevel = IndoorLayer.getCurrentLevel();
  const currentFlatMode = GeoMap.isFlatMode();

  if (currentLevel !== lastKnownLevel || currentFlatMode !== lastKnownFlatMode) {
    lastKnownLevel = currentLevel;
    lastKnownFlatMode = currentFlatMode;
    state.currentLevel = currentLevel;
    refreshMap();
  }
}

// ===== Mode Handling =====

// ===== Room click listener =====
let roomClickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
let selectedRoomIdx: number | null = null;
let autoApplyPreset: RoomAutoApplyPreset = { enabled: false, roomType: '' as RoomType, refPrefix: '' };

function setupRoomClickListener(): void {
  if (!map) return;
  removeRoomClickListener();

  roomClickHandler = (e: maplibregl.MapMouseEvent) => {
    if (state.mode !== 'label-room' || !map) return;

    const level = state.currentLevel;
    const layerId = `floor-${level}-rooms-3d`;
    if (!map.getLayer(layerId)) return;

    const features = map.queryRenderedFeatures(e.point, { layers: [layerId] });

    if (features.length > 0 && features[0].properties) {
      const props = features[0].properties;
      const clickedIdx = props._idx;

      if (selectedRoomIdx !== null && selectedRoomIdx === clickedIdx) {
        // 같은 방 재클릭 → 라벨을 클릭 위치로 이동
        moveRoomLabel(selectedRoomIdx, [e.lngLat.lng, e.lngLat.lat]);
      } else {
        // 다른 방 클릭 → 선택
        selectedRoomIdx = clickedIdx;

        if (autoApplyPreset.enabled) {
          // 프리셋 자동 적용
          const applyProps: { ref?: string; room_type?: string } = {};
          if (autoApplyPreset.refPrefix) applyProps.ref = autoApplyPreset.refPrefix;
          if (autoApplyPreset.roomType) applyProps.room_type = autoApplyPreset.roomType;
          if (Object.keys(applyProps).length > 0) {
            handleRoomUpdate(clickedIdx, applyProps);
          }
          // 업데이트된 값으로 패널 표시
          const rooms = BackendService.getRoomFeaturesForLevel(state.currentLevel);
          const updated = rooms.find(f => f.properties._idx === clickedIdx);
          if (updated) {
            Panel.showRoomProperties({
              _idx: updated.properties._idx,
              _area_m2: updated.properties._area_m2,
              ref: updated.properties.ref,
              room_type: updated.properties.room_type,
            });
          }
        } else {
          Panel.showRoomProperties({
            _idx: props._idx,
            _area_m2: props._area_m2,
            ref: props.ref,
            room_type: props.room_type,
          });
        }
      }
    } else if (selectedRoomIdx !== null) {
      // 빈 공간 클릭 → 라벨 이동
      moveRoomLabel(selectedRoomIdx, [e.lngLat.lng, e.lngLat.lat]);
    }
  };

  map.on('click', roomClickHandler);
}

function moveRoomLabel(featureIdx: number, pos: [number, number]): void {
  if (!map) return;

  const rooms = BackendService.getRoomFeaturesForLevel(state.currentLevel);
  const feature = rooms.find(f => f.properties._idx === featureIdx);
  if (!feature) return;

  feature.properties._label_pos = pos;
  IndoorLayerModule.refreshRoomLabels(map, state.currentLevel);
}

function removeRoomClickListener(): void {
  if (map && roomClickHandler) {
    map.off('click', roomClickHandler);
    roomClickHandler = null;
  }
}

function handleModeChange(mode: EditorMode): void {
  state.mode = mode;
  state.edgeStartNodeId = null;

  Panel.setActiveMode(mode);
  Panel.setEdgeHint('노드를 클릭하여 엣지 시작점을 선택하세요');

  if (mode !== 'select') {
    state.selectedNodeId = null;
    Panel.hideNodeProperties();
  }

  // Update cursor
  if (map) {
    map.getCanvas().style.cursor = mode === 'add-node' ? 'crosshair' : '';
  }

  // Room click listener
  if (mode === 'label-room') {
    setupRoomClickListener();
  } else {
    removeRoomClickListener();
  }

  refreshMap();
}

// ===== Map Click Handlers =====

function handleMapClick(lngLat: [number, number]): void {
  if (state.mode === 'add-node') {
    const building = State.detectBuilding(lngLat, state.currentLevel);
    const node = State.addNode(state, {
      coordinates: lngLat,
      level: state.currentLevel,
      building,
      type: Panel.getAddNodeType(),
      label: '',
    });

    // Auto-select the new node
    state.selectedNodeId = node.id;
    Panel.showNodeProperties(node);
    Panel.setNodeIdData(node.id);
    refreshMap();
  } else if (state.mode === 'select') {
    // Clicked on empty space — deselect
    state.selectedNodeId = null;
    Panel.hideNodeProperties();
    refreshMap();
  }
}

function handleNodeClick(nodeId: string): void {
  const node = state.graph.nodes[nodeId];
  if (!node) return;

  if (state.mode === 'select') {
    state.selectedNodeId = nodeId;
    Panel.showNodeProperties(node);
    Panel.setNodeIdData(nodeId);
    refreshMap();

  } else if (state.mode === 'add-edge') {
    if (!state.edgeStartNodeId) {
      // First node of the edge
      state.edgeStartNodeId = nodeId;
      Panel.setEdgeHint(`시작: ${node.label || node.id.slice(0, 12)} (${node.level}F) → 두 번째 노드를 클릭하세요`);
      refreshMap();
    } else if (state.edgeStartNodeId !== nodeId) {
      // Second node — create edge
      const edge = State.addEdge(state, state.edgeStartNodeId, nodeId);
      if (edge) {
        // Chain: keep second node as new start
        state.edgeStartNodeId = nodeId;
        const crossFloor = state.graph.nodes[edge.from].level !== node.level;
        Panel.setEdgeHint(
          `엣지 생성됨 (${edge.weight}m${crossFloor ? ', cross-floor' : ''}) — 시작: ${node.label || node.id.slice(0, 12)} (${node.level}F)`
        );
      } else {
        // Duplicate edge — cancel like Esc
        state.edgeStartNodeId = null;
        Panel.setEdgeHint('노드를 클릭하여 엣지 시작점을 선택하세요');
      }
      refreshMap();
    }

  } else if (state.mode === 'add-node') {
    // In add-node mode, clicking existing node selects it
    state.selectedNodeId = nodeId;
    Panel.showNodeProperties(node);
    Panel.setNodeIdData(nodeId);
    refreshMap();
  }
}

function handleEdgeClick(edgeId: string): void {
  if (state.mode === 'select') {
    // Select edge — for now just show confirmation to delete
    if (confirm(`엣지 "${edgeId}"를 삭제하시겠습니까?`)) {
      State.deleteEdge(state, edgeId);
      refreshMap();
    }
  }
}

// ===== Panel Callbacks =====

function handleNodeUpdate(nodeId: string, props: Partial<any>): void {
  State.updateNode(state, nodeId, props);
  const node = state.graph.nodes[nodeId];
  if (node) Panel.showNodeProperties(node);
  refreshMap();
}

function handleNodeDelete(nodeId: string): void {
  State.deleteNode(state, nodeId);
  state.selectedNodeId = null;
  Panel.hideNodeProperties();
  refreshMap();
}

function handleUndo(): void {
  if (State.undo(state)) {
    state.selectedNodeId = null;
    Panel.hideNodeProperties();
    refreshMap();
  }
}

function handleRedo(): void {
  if (State.redo(state)) {
    state.selectedNodeId = null;
    Panel.hideNodeProperties();
    refreshMap();
  }
}

function handleImport(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as NavGraphExport;
        state.graph = State.importGraph(data);
        state.selectedNodeId = null;
        state.edgeStartNodeId = null;
        state.undoStack = [];
        state.redoStack = [];
        Panel.hideNodeProperties();
        refreshMap();
      } catch (err) {
        alert('JSON 파싱 실패: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

function handleExport(): void {
  const data = State.exportGraph(state.graph);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'graph.json';
  a.click();
  URL.revokeObjectURL(url);
}

function handleClearAll(): void {
  State.clearAll(state);
  Panel.hideNodeProperties();
  refreshMap();
}

// ===== Room Label Editing =====

function saveRoomData(level: number): void {
  const rooms = BackendService.getRoomFeaturesForLevel(level);
  const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: rooms };
  fetch(`/api/save-rooms/${level}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fc),
  }).then(res => {
    if (!res.ok) console.warn('[GraphEditor] room save failed:', res.status);
  }).catch(err => console.warn('[GraphEditor] room save error:', err));
}

function handleRoomUpdate(featureIdx: number, props: { ref?: string; room_type?: string }): void {
  if (!map) return;

  const rooms = BackendService.getRoomFeaturesForLevel(state.currentLevel);
  const feature = rooms.find(f => f.properties._idx === featureIdx);
  if (!feature) return;

  if (props.ref !== undefined) feature.properties.ref = props.ref;
  if (props.room_type !== undefined) feature.properties.room_type = props.room_type;

  IndoorLayerModule.refreshRoomLabels(map, state.currentLevel);
  saveRoomData(state.currentLevel);
}

function appendToRoomRef(featureIdx: number, digit: string): void {
  if (!map) return;
  const rooms = BackendService.getRoomFeaturesForLevel(state.currentLevel);
  const feature = rooms.find(f => f.properties._idx === featureIdx);
  if (!feature) return;

  const currentRef = feature.properties.ref ?? '';
  const newRef = currentRef + digit;
  feature.properties.ref = newRef;
  Panel.updateRoomRefInput(newRef);
  IndoorLayerModule.refreshRoomLabels(map, state.currentLevel);
  saveRoomData(state.currentLevel);
}

function backspaceRoomRef(featureIdx: number): void {
  if (!map) return;
  const rooms = BackendService.getRoomFeaturesForLevel(state.currentLevel);
  const feature = rooms.find(f => f.properties._idx === featureIdx);
  if (!feature) return;

  const currentRef = feature.properties.ref ?? '';
  if (currentRef.length === 0) return;
  const newRef = currentRef.slice(0, -1);
  feature.properties.ref = newRef;
  Panel.updateRoomRefInput(newRef);
  IndoorLayerModule.refreshRoomLabels(map, state.currentLevel);
  saveRoomData(state.currentLevel);
}

function handleAutoApplyChange(preset: RoomAutoApplyPreset): void {
  autoApplyPreset = preset;
}

function handleRoomExport(): void {
  // 현재 층의 room 파일만 내보내기
  const level = state.currentLevel;
  const rooms = BackendService.getRoomFeaturesForLevel(level);
  const output: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: rooms };

  const json = JSON.stringify(output, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `eng1_room_L${level}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== Right-click Cancel =====

function handleRightClick(e: MouseEvent): void {
  if (!active) return;
  if (state.edgeStartNodeId) {
    e.preventDefault();
    state.edgeStartNodeId = null;
    Panel.setEdgeHint('노드를 클릭하여 엣지 시작점을 선택하세요');
    refreshMap();
  }
}

// ===== Keyboard Shortcuts =====

function handleKeyDown(e: KeyboardEvent): void {
  if (!active) return;

  // Don't capture when typing in inputs
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'Escape') {
    if (state.mode === 'label-room' && selectedRoomIdx !== null) {
      selectedRoomIdx = null;
      const roomPropsEl = document.getElementById('geRoomProps');
      if (roomPropsEl) roomPropsEl.dataset.featureIdx = '';
    } else if (state.edgeStartNodeId) {
      state.edgeStartNodeId = null;
      Panel.setEdgeHint('노드를 클릭하여 엣지 시작점을 선택하세요');
      refreshMap();
    } else if (state.selectedNodeId) {
      state.selectedNodeId = null;
      Panel.hideNodeProperties();
      refreshMap();
    }
  } else if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    handleUndo();
  } else if (e.ctrlKey && e.key === 'y') {
    e.preventDefault();
    handleRedo();
  } else if (state.mode === 'label-room' && selectedRoomIdx !== null && e.key >= '0' && e.key <= '9') {
    // label-room 모드에서 숫자키 → ref에 숫자 추가
    appendToRoomRef(selectedRoomIdx, e.key);
    e.preventDefault();
  } else if (state.mode === 'label-room' && selectedRoomIdx !== null && (e.key === 'a' || e.key === 'b' || e.key === 'c' || e.key === 'A' || e.key === 'B' || e.key === 'C')) {
    // label-room 모드에서 a/b/c → ref에 대문자 추가
    appendToRoomRef(selectedRoomIdx, e.key.toUpperCase());
    e.preventDefault();
  } else if (state.mode === 'label-room' && selectedRoomIdx !== null && e.key === 'Backspace') {
    // label-room 모드에서 Backspace → ref 마지막 글자 삭제
    backspaceRoomRef(selectedRoomIdx);
    e.preventDefault();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedNodeId) {
      handleNodeDelete(state.selectedNodeId);
    }
  } else if (e.key === 'q' || e.key === 'Q') {
    handleModeChange('select');
  } else if (e.key === 'w' || e.key === 'W') {
    handleModeChange('add-node');
  } else if (e.key === 'e' || e.key === 'E') {
    handleModeChange('add-edge');
  } else if (e.key === 'r' || e.key === 'R') {
    handleModeChange('label-room');
  }
}

// ===== Refresh Map Display =====

function refreshMap(): void {
  if (!map) return;

  const level = state.currentLevel;
  const is3D = !GeoMap.isFlatMode();

  if (is3D) {
    // 3D mode: show ALL nodes as floating divs at correct floor heights
    const allNodes = Object.values(state.graph.nodes);
    EditorMap.set2DNodeLayersVisible(map, false);
    EditorMap.updateFloatingNodeLayer(
      allNodes,
      state.selectedNodeId,
      state.edgeStartNodeId,
      IndoorLayer.getLevelBase,
      IndoorLayer.ROOM_THICKNESS,
      level,
    );
    EditorMap.updateNodeLayer(map, [], null, null);

    // 3D edges: show ALL edges as floating SVG lines
    EditorMap.set2DEdgeLayersVisible(map, false);
    const allEdges = State.getAllEdgesWithNodes(state);
    EditorMap.updateFloatingEdgeLayer(
      allEdges,
      IndoorLayer.getLevelBase,
      IndoorLayer.ROOM_THICKNESS,
      level,
    );
    EditorMap.updateEdgeLayer(map, [], level);
  } else {
    // 2D mode: show only current level via circle/line layers
    EditorMap.clearFloatingNodes();
    EditorMap.clearFloatingEdges();
    EditorMap.set2DNodeLayersVisible(map, true);
    EditorMap.set2DEdgeLayersVisible(map, true);
    const visibleNodes = State.getNodesOnLevel(state, level);
    EditorMap.updateNodeLayer(map, visibleNodes, state.selectedNodeId, state.edgeStartNodeId);
    const visibleEdges = State.getEdgesOnLevel(state, level);
    EditorMap.updateEdgeLayer(map, visibleEdges, level);
  }

  Panel.updateInfo(State.getNodeCount(state), State.getEdgeCount(state), level);
}
