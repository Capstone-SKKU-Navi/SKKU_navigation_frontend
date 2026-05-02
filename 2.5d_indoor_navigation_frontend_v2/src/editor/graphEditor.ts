// ===== Navigation Graph Editor — Main Orchestration =====

import maplibregl from 'maplibre-gl';
import { EditorMode, NavEdge, EditorSaveFile, RoomAutoApplyPreset, RoomEditEntry, RoomType } from './graphEditorTypes';
import * as State from './graphEditorState';
import * as EditorMap from './graphEditorMap';
import * as Panel from './graphEditorPanel';
import * as GeoMap from '../components/geoMap';
import * as IndoorLayer from '../components/indoorLayer';
import * as BackendService from '../services/backendService';
import * as IndoorLayerModule from '../components/indoorLayer';
import * as VideoSettings from './videoSettings';
import { openVideoPreview } from './videoPreview';
import { getOppositeVideo, loadVideoCatalog } from './videoCatalog';
import * as RoomCodeLookup from './roomCodeLookup';

let state = State.createState();
let active = false;
let map: maplibregl.Map | null = null;

// ===== Save bundle state (room edits + free-text note) =====
//
// Map key = `${building}|${level}|${fingerprint}`. Every entry in this map
// represents a configured room (at least one of ref/name/room_type set).
// Cleared when rooms become unconfigured. Hydrated from save.json at activate
// and rebuilt as the user edits.

const roomEdits = new Map<string, RoomEditEntry>();
// (building, level) pairs touched this session. Includes "all rooms cleared"
// cases where roomEdits no longer has any entries for the file but the
// published geojson must still be rewritten with empty labels. Cleared on
// editor close.
const touchedRoomFiles = new Set<string>();
let saveNote = '';

function roomEditKey(building: string, level: number, fingerprint: string): string {
  return `${building}|${level}|${fingerprint}`;
}

function touchedRoomFileKey(building: string, level: number): string {
  return `${building}|${level}`;
}

function fingerprintFromProps(props: any): string | null {
  const c = props?._centroid;
  const a = props?._area_m2;
  if (!Array.isArray(c) || c.length < 2 || a === undefined || a === null) return null;
  // Match the precision the Python convert.py emits: lat/lng → toFixed(6)
  // (~10cm), area → toFixed(1). Without this, "131" vs "131.0" produce
  // different fingerprints across machines depending on JSON round-tripping.
  return `${Number(c[0]).toFixed(6)}_${Number(c[1]).toFixed(6)}_${Number(a).toFixed(1)}`;
}

function findFeatureByFingerprint(building: string, level: number, fingerprint: string): GeoJSON.Feature | null {
  const features = BackendService.getLevelDataForBuilding(building, level)?.rooms?.features ?? [];
  let match: GeoJSON.Feature | null = null;
  let collisionCount = 0;
  for (const f of features) {
    if (fingerprintFromProps(f.properties) === fingerprint) {
      if (match) {
        collisionCount++;
      } else {
        match = f;
      }
    }
  }
  if (collisionCount > 0) {
    console.warn(
      `[GraphEditor] fingerprint collision in ${building}/L${level} for "${fingerprint}" — ` +
      `${collisionCount + 1} features share centroid+area; first match wins. ` +
      `Room labels for these polygons may be applied to the wrong one.`
    );
  }
  return match;
}

function recordRoomEdit(building: string, level: number, feature: GeoJSON.Feature, props: any): void {
  const fingerprint = fingerprintFromProps(props);
  if (!fingerprint) return;
  touchedRoomFiles.add(touchedRoomFileKey(building, level));
  const key = roomEditKey(building, level, fingerprint);
  const ref = props.ref ?? '';
  const name = props.name ?? '';
  const roomType = props.room_type ?? '';
  if (!ref && !name && !roomType) {
    roomEdits.delete(key);
    return;
  }
  roomEdits.set(key, {
    building,
    level,
    fingerprint,
    ref,
    name,
    room_type: roomType,
    updatedAt: Date.now(),
  });
}

function collectRoomEdits(): RoomEditEntry[] {
  return Array.from(roomEdits.values());
}

function snapshotRoomEdits(): Map<string, RoomEditEntry> {
  const snap = new Map<string, RoomEditEntry>();
  for (const [k, v] of roomEdits) snap.set(k, { ...v });
  return snap;
}

function restoreRoomEditsFromSnapshot(snap: unknown): void {
  if (!(snap instanceof Map)) return;
  const target = snap as Map<string, RoomEditEntry>;
  // Diff: keys that disappear (current has, target doesn't) → blank the
  // matching feature. Keys present in target → re-apply if value differs.
  // Only touch features that actually change, so the runtime label layer
  // doesn't blank-then-repaint every room on the map.
  const touchedLevels = new Set<number>();
  for (const [k, current] of roomEdits) {
    if (target.has(k)) continue;
    const feature = findFeatureByFingerprint(current.building, current.level, current.fingerprint);
    if (feature) {
      const props = feature.properties as any;
      props.ref = '';
      props.name = '';
      props.room_type = '';
      touchedLevels.add(current.level);
    }
  }
  for (const [k, want] of target) {
    const cur = roomEdits.get(k);
    if (cur && cur.ref === want.ref && cur.name === want.name && cur.room_type === want.room_type) continue;
    const feature = findFeatureByFingerprint(want.building, want.level, want.fingerprint);
    if (feature) {
      const props = feature.properties as any;
      props.ref = want.ref;
      props.name = want.name;
      props.room_type = want.room_type;
      touchedLevels.add(want.level);
    }
  }
  roomEdits.clear();
  for (const [k, v] of target) roomEdits.set(k, { ...v });
  if (map) {
    for (const lvl of touchedLevels) IndoorLayerModule.refreshRoomLabels(map, lvl);
  }
}

function refreshAllVisibleRoomLabels(): void {
  if (!map) return;
  const seen = new Set<number>();
  for (const entry of roomEdits.values()) {
    if (!seen.has(entry.level)) {
      IndoorLayerModule.refreshRoomLabels(map, entry.level);
      seen.add(entry.level);
    }
  }
  // Also refresh the current level in case rooms there were cleared.
  if (!seen.has(state.currentLevel)) {
    IndoorLayerModule.refreshRoomLabels(map, state.currentLevel);
  }
}

function hydrateRoomsFromSave(savedRooms: RoomEditEntry[]): void {
  // The save file is the source of truth: any feature on disk with a label
  // not mentioned in the save must be blanked in memory (so the next publish
  // overwrites stale on-disk labels). Mark such files as touched.
  roomEdits.clear();
  const wantedKeys = new Set<string>();
  for (const entry of savedRooms) {
    wantedKeys.add(roomEditKey(entry.building, entry.level, entry.fingerprint));
  }
  for (const code of BackendService.getBuildingCodes()) {
    for (const level of BackendService.getBuildingLevels(code)) {
      const features = BackendService.getLevelDataForBuilding(code, level)?.rooms?.features ?? [];
      let levelChanged = false;
      for (const f of features) {
        const props = f.properties as any;
        const fp = fingerprintFromProps(props);
        if (!fp) continue;
        const wantedKey = roomEditKey(code, level, fp);
        if (wantedKeys.has(wantedKey)) continue;
        if (props.ref || props.name || props.room_type) {
          props.ref = '';
          props.name = '';
          props.room_type = '';
          levelChanged = true;
        }
      }
      if (levelChanged) touchedRoomFiles.add(touchedRoomFileKey(code, level));
    }
  }
  for (const entry of savedRooms) {
    const feature = findFeatureByFingerprint(entry.building, entry.level, entry.fingerprint);
    if (!feature) {
      console.warn(`[GraphEditor] save.json references room (${entry.building}/L${entry.level} ref="${entry.ref}") with no matching fingerprint in the loaded geojson — skipped`);
      continue;
    }
    const props = feature.properties as any;
    props.ref = entry.ref;
    props.name = entry.name;
    props.room_type = entry.room_type;
    roomEdits.set(roomEditKey(entry.building, entry.level, entry.fingerprint), { ...entry });
  }
}

/**
 * Hydrate roomEdits from the legacy per-building geojson files when no save
 * file existed (first run on an existing checkout). Mirrors what
 * scripts/init-editor-save.js does, but in the browser.
 */
function hydrateRoomsFromGeojson(): void {
  roomEdits.clear();
  for (const code of BackendService.getBuildingCodes()) {
    for (const level of BackendService.getBuildingLevels(code)) {
      const features = BackendService.getLevelDataForBuilding(code, level)?.rooms?.features ?? [];
      for (const f of features) {
        const props = f.properties as any;
        const ref = props.ref ?? '';
        const name = props.name ?? '';
        const roomType = props.room_type ?? '';
        if (!ref && !name && !roomType) continue;
        const fingerprint = fingerprintFromProps(props);
        if (!fingerprint) continue;
        roomEdits.set(roomEditKey(code, level, fingerprint), {
          building: code, level, fingerprint, ref, name, room_type: roomType,
          updatedAt: 0,
        });
      }
    }
  }
}

// ===== Save-file: validate / merge =====

function validateRoomImport(rooms: RoomEditEntry[]) {
  const mismatches: Array<{ building: string; level: number; ref: string; fingerprint: string }> = [];
  for (const entry of rooms) {
    const levels = BackendService.getBuildingLevels(entry.building);
    if (!levels || levels.length === 0 || !levels.includes(entry.level)) {
      // Recipient is missing this (building, level) — silently allowed.
      console.warn(`[GraphEditor] import: ${entry.building}/L${entry.level} not loaded on this checkout — skipping room ref="${entry.ref}"`);
      continue;
    }
    const feature = findFeatureByFingerprint(entry.building, entry.level, entry.fingerprint);
    if (!feature) {
      mismatches.push({
        building: entry.building,
        level: entry.level,
        ref: entry.ref,
        fingerprint: entry.fingerprint,
      });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function applyRoomMerge(incoming: RoomEditEntry[]): void {
  for (const entry of incoming) {
    const feature = findFeatureByFingerprint(entry.building, entry.level, entry.fingerprint);
    if (!feature) continue;   // (building, level) not loaded — skip silently
    const key = roomEditKey(entry.building, entry.level, entry.fingerprint);
    const local = roomEdits.get(key);
    const localTime = local?.updatedAt ?? -1;
    const incTime = entry.updatedAt ?? -1;
    if (incTime > localTime) {
      roomEdits.set(key, { ...entry });
      const props = feature.properties as any;
      props.ref = entry.ref;
      props.name = entry.name;
      props.room_type = entry.room_type;
    }
  }
  refreshAllVisibleRoomLabels();
}

function collectPublishRoomFiles(): State.PublishRoomFile[] {
  // Publish every (building, level) that was touched this session (including
  // a full clear, where roomEdits has nothing left). Plus any file that
  // currently has configured labels — covers the legacy-fallback case where
  // hydrateRoomsFromGeojson populated roomEdits without touching anything.
  const out: State.PublishRoomFile[] = [];
  const seen = new Set<string>();

  const addFile = (code: string, level: number) => {
    const fileKey = touchedRoomFileKey(code, level);
    if (seen.has(fileKey)) return;
    const features = BackendService.getLevelDataForBuilding(code, level)?.rooms?.features ?? [];
    if (features.length === 0) return;
    seen.add(fileKey);
    out.push({ building: code, level, features });
  };

  for (const fileKey of touchedRoomFiles) {
    const [code, levelStr] = fileKey.split('|');
    const level = parseInt(levelStr, 10);
    if (!code || Number.isNaN(level)) continue;
    addFile(code, level);
  }
  for (const entry of roomEdits.values()) {
    addFile(entry.building, entry.level);
  }
  return out;
}

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

  // Hydrate the corridor catalog from the actual files under videos/ so the
  // edge picker shows every building present, not just the eng1 fallback.
  void loadVideoCatalog();
}

// ===== Toggle =====

function toggleEditor(): void {
  if (active) {
    void deactivateEditor();
  } else {
    void activateEditor();
  }
}

async function activateEditor(): Promise<void> {
  map = GeoMap.getMap();
  if (!map) return;

  active = true;
  state = State.createState();
  state.currentLevel = IndoorLayer.getCurrentLevel();
  lastKnownLevel = state.currentLevel;

  // Wire save bundle providers BEFORE any mutation can fire
  State.setActiveState(state);
  State.setSaveBundleProviders({ rooms: collectRoomEdits, note: () => saveNote });
  VideoSettings.setOnMutated(() => State.autosaveBundle());

  // Load video catalog AND the editor save bundle
  await VideoSettings.loadVideoSettings();           // baseline from /geojson/video_settings.json
  const loaded = await State.loadEditorSave();
  state.graph = loaded.graph;
  saveNote = loaded.note;

  if (loaded.source === 'save-file') {
    VideoSettings.hydrateFromSave(loaded.videoSettings ?? undefined);
    hydrateRoomsFromSave(loaded.rooms);
  } else {
    // Legacy fallback: room labels still live in the per-building geojson
    // files at this point — pull them into roomEdits so subsequent
    // autosaves persist them through the new pipeline.
    hydrateRoomsFromGeojson();
  }

  RoomCodeLookup.loadRoomCodes(); // non-blocking

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
    onEdgeUpdate: handleEdgeUpdate,
    onEdgeDelete: handleEdgeDelete,
    onSetTime: handleSetTime,
    onBatchVideoAssign: handleBatchVideoAssign,
    onSplitAssign: handleSplitAssign,
    onRoomUpdate: handleRoomUpdate,
    onRoomExport: handleRoomExport,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onExportSave: handleExportSave,
    onImportSave: handleImportSave,
    onPublish: handlePublish,
    onClearAll: handleClearAll,
    onClearBuildingGraph: handleClearBuildingGraph,
    onClearBuildingRooms: handleClearBuildingRooms,
    onAutoApplyChange: handleAutoApplyChange,
    onNoteChange: handleNoteChange,
    onClose: () => { void deactivateEditor(); },
  });

  Panel.setSaveNoteValue(saveNote);

  // First save fires immediately so the save file is created on a fresh
  // checkout (legacy-fallback path) and the metadata.savedAt reflects this
  // session start.
  State.autosaveBundle();

  // Set up map click handlers
  EditorMap.setClickHandlers(map, {
    onMapClick: handleMapClick,
    onNodeClick: handleNodeClick,
    onEdgeClick: handleEdgeClick,
  });

  // Drag-to-move (2D mode + select mode only)
  EditorMap.setDragHandler(map, {
    isEnabled: () => state.mode === 'select' && GeoMap.isFlatMode(),
    onStart: handleDragStart,
    onMove: handleDragMove,
    onCommit: handleDragCommit,
    onCancel: handleDragCancel,
  });

  // Keyboard shortcuts & right-click cancel
  document.addEventListener('keydown', handleKeyDown);
  map.getCanvas().addEventListener('contextmenu', handleRightClick);

  // Disable boxZoom so shift+click works for multi-edge selection
  map.boxZoom.disable();

  // Prevent room popup while editing
  document.body.classList.add('editor-active');

  // Toggle button active state
  const btn = document.getElementById('graphEditorToggle');
  if (btn) btn.classList.add('active');

  // Poll for level changes
  levelCheckInterval = window.setInterval(checkLevelChange, 200);

  refreshMap();
}

async function deactivateEditor(): Promise<void> {
  if (!map) return;

  // Publish on the way out. If it fails (typically because the dev server is
  // down or unreachable), close the editor anyway — the working save lives in
  // editor/save.json regardless of publish, and blocking close means the user
  // can't escape a broken backend. We surface the failure so they know to
  // re-open and Publish once the server is back.
  try {
    await State.publishCombined(state, collectPublishRoomFiles());
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error('[GraphEditor] publish failed on close:', msg);
    alert(
      `Publish failed — your edits are still saved in editor/save.json.\n\n` +
      `Re-open the editor when the server is back and click Publish to write the runtime files.\n\n${msg}`
    );
  }

  active = false;

  removeRoomClickListener();
  EditorMap.removeClickHandlers(map);
  EditorMap.removeDragHandler(map);
  EditorMap.destroyFloatingNodes();
  EditorMap.destroyFloatingEdges();
  EditorMap.destroyEditorLayers(map);
  Panel.destroyPanel();

  document.removeEventListener('keydown', handleKeyDown);
  map.getCanvas().removeEventListener('contextmenu', handleRightClick);
  map.boxZoom.enable();
  document.body.classList.remove('editor-active');

  const btn = document.getElementById('graphEditorToggle');
  if (btn) btn.classList.remove('active');

  if (levelCheckInterval !== null) {
    clearInterval(levelCheckInterval);
    levelCheckInterval = null;
  }

  // Detach save providers so non-editor code paths don't accidentally
  // trigger autosave writes.
  State.setActiveState(null);
  State.setSaveBundleProviders({ rooms: () => [], note: () => '' });
  VideoSettings.setOnMutated(null);

  selectedRoom = null;
  state.selectedEdgeId = null; state.selectedEdgeIds = [];
  autoApplyPreset = { enabled: false, roomType: '' as RoomType, refPrefix: '' };
  roomEdits.clear();
  touchedRoomFiles.clear();
  saveNote = '';
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
// `_idx` is only unique within a building's geojson file, so we track building
// alongside it. Without this, find(_idx === x) hits whichever building came
// first in load order (e.g. iac before slib), silently misrouting edits.
let selectedRoom: { building: string; idx: number } | null = null;
let autoApplyPreset: RoomAutoApplyPreset = { enabled: false, roomType: '' as RoomType, refPrefix: '' };

function buildingFromLayerId(layerId: string): string {
  // Layer id is `${building}-floor-${level}-rooms-3d`. Building codes may
  // contain hyphens, so split on the literal `-floor-` token rather than `-`.
  return layerId.split('-floor-')[0];
}

function setupRoomClickListener(): void {
  if (!map) return;
  removeRoomClickListener();

  roomClickHandler = (e: maplibregl.MapMouseEvent) => {
    if (state.mode !== 'label-room' || !map) return;

    const level = state.currentLevel;
    // Query room layers across all buildings for this level
    const roomLayerIds = BackendService.getBuildingCodes()
      .map(b => `${b}-floor-${level}-rooms-3d`)
      .filter(id => map!.getLayer(id));
    if (roomLayerIds.length === 0) return;

    const features = map.queryRenderedFeatures(e.point, { layers: roomLayerIds });

    if (features.length > 0 && features[0].properties) {
      const f = features[0];
      const props = f.properties;
      const clickedIdx = props._idx;
      const clickedBuilding = buildingFromLayerId(f.layer?.id ?? '');
      if (!clickedBuilding) return;

      if (selectedRoom !== null
        && selectedRoom.building === clickedBuilding
        && selectedRoom.idx === clickedIdx) {
        // 같은 방 재클릭 → 라벨을 클릭 위치로 이동
        moveRoomLabel(selectedRoom.building, selectedRoom.idx, [e.lngLat.lng, e.lngLat.lat]);
      } else {
        // 다른 방 클릭 → 선택
        selectedRoom = { building: clickedBuilding, idx: clickedIdx };

        if (autoApplyPreset.enabled) {
          // 프리셋 자동 적용
          const applyProps: { ref?: string; room_type?: string } = {};
          if (autoApplyPreset.refPrefix) applyProps.ref = autoApplyPreset.refPrefix;
          if (autoApplyPreset.roomType) applyProps.room_type = autoApplyPreset.roomType;
          if (Object.keys(applyProps).length > 0) {
            handleRoomUpdate(clickedBuilding, clickedIdx, applyProps);
          }
          // 업데이트된 값으로 패널 표시
          const rooms = BackendService.getLevelDataForBuilding(clickedBuilding, state.currentLevel).rooms.features;
          const updated = rooms.find(f => f.properties._idx === clickedIdx);
          if (updated) {
            Panel.showRoomProperties({
              _idx: updated.properties._idx,
              _area_m2: updated.properties._area_m2,
              ref: updated.properties.ref,
              name: updated.properties.name,
              room_type: updated.properties.room_type,
              building: clickedBuilding,
            });
          }
        } else {
          Panel.showRoomProperties({
            _idx: props._idx,
            _area_m2: props._area_m2,
            ref: props.ref,
            name: props.name,
            room_type: props.room_type,
            building: clickedBuilding,
          });
        }
      }
    } else if (selectedRoom !== null) {
      // 빈 공간 클릭 → 라벨 이동
      moveRoomLabel(selectedRoom.building, selectedRoom.idx, [e.lngLat.lng, e.lngLat.lat]);
    }
  };

  map.on('click', roomClickHandler);
}

function moveRoomLabel(building: string, featureIdx: number, pos: [number, number]): void {
  if (!map) return;

  const rooms = BackendService.getLevelDataForBuilding(building, state.currentLevel).rooms.features;
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
    const nodeType = Panel.getAddNodeType();

    // room 타입 노드 → 가장 가까운 방의 ref를 자동 label로 설정
    const label = nodeType === 'room'
      ? State.detectRoomRef(lngLat, state.currentLevel)
      : '';

    const node = State.addNode(state, {
      coordinates: lngLat,
      level: state.currentLevel,
      building,
      type: nodeType,
      label,
    });

    // Auto-select the new node
    state.selectedNodeId = node.id;
    Panel.showNodeProperties(node);
    Panel.setNodeIdData(node.id);
    refreshMap();
  } else if (state.mode === 'select') {
    // Clicked on empty space — deselect
    state.selectedNodeId = null;
    state.selectedEdgeId = null; state.selectedEdgeIds = [];
    Panel.hideNodeProperties();
    Panel.hideEdgeProperties();
    refreshMap();
  }
}

function handleNodeClick(nodeId: string): void {
  const node = state.graph.nodes[nodeId];
  if (!node) return;

  if (state.mode === 'select') {
    state.selectedNodeId = nodeId;
    state.selectedEdgeId = null; state.selectedEdgeIds = [];
    Panel.hideEdgeProperties();
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

// ===== Node Drag-to-Move =====
//
// Live-mutates `node.coordinates` during the drag for visual feedback (no
// undo entry per frame). On commit we revert the mutation, then delegate to
// State.moveNode which produces a single proper Command capturing the full
// before→after delta (coords + building + every touched edge's weight/building).

let dragOriginalCoords: [number, number] | null = null;

function handleDragStart(nodeId: string): void {
  const node = state.graph.nodes[nodeId];
  if (!node) return;
  dragOriginalCoords = [node.coordinates[0], node.coordinates[1]];

  // Select the node so the panel reflects what's being dragged.
  state.selectedNodeId = nodeId;
  state.selectedEdgeId = null;
  state.selectedEdgeIds = [];
  Panel.hideEdgeProperties();
  Panel.showNodeProperties(node);
  Panel.setNodeIdData(nodeId);
  refreshMap();
}

function handleDragMove(nodeId: string, coords: [number, number]): void {
  const node = state.graph.nodes[nodeId];
  if (!node) return;
  node.coordinates = coords;
  refreshMap();
}

function handleDragCommit(nodeId: string, coords: [number, number]): void {
  const node = state.graph.nodes[nodeId];
  if (!node || !dragOriginalCoords) { dragOriginalCoords = null; return; }
  // Restore so moveNode sees the real before-state and pushes one undo entry.
  node.coordinates = dragOriginalCoords;
  dragOriginalCoords = null;
  State.moveNode(state, nodeId, coords);
  const updated = state.graph.nodes[nodeId];
  if (updated) Panel.showNodeProperties(updated);
  refreshMap();
}

function handleDragCancel(nodeId: string): void {
  const node = state.graph.nodes[nodeId];
  if (node && dragOriginalCoords) node.coordinates = dragOriginalCoords;
  dragOriginalCoords = null;
  refreshMap();
}

function handleEdgeClick(edgeId: string, shiftKey: boolean = false): void {
  if (state.mode === 'select') {
    const edge = state.graph.edges.find(e => e.id === edgeId);
    if (!edge) return;

    const fromNode = state.graph.nodes[edge.from];
    const toNode = state.graph.nodes[edge.to];
    if (!fromNode || !toNode) return;

    // Deselect any selected node
    state.selectedNodeId = null;
    Panel.hideNodeProperties();

    if (shiftKey) {
      // Multi-select: toggle edge in selectedEdgeIds
      const idx = state.selectedEdgeIds.indexOf(edgeId);
      if (idx >= 0) {
        state.selectedEdgeIds.splice(idx, 1);
      } else {
        state.selectedEdgeIds.push(edgeId);
      }
      // Also keep selectedEdgeId in sync
      state.selectedEdgeId = state.selectedEdgeIds.length > 0
        ? state.selectedEdgeIds[state.selectedEdgeIds.length - 1]
        : null;
    } else {
      // Single select
      state.selectedEdgeId = edgeId;
      state.selectedEdgeIds = [edgeId];
    }

    // Show appropriate panel
    Panel.hideEdgeProperties();
    if (state.selectedEdgeIds.length > 1) {
      const edges = state.selectedEdgeIds
        .map(id => state.graph.edges.find(e => e.id === id))
        .filter((e): e is NavEdge => !!e);
      Panel.showMultiEdgeProperties(edges, state.graph.nodes);
    } else if (state.selectedEdgeIds.length === 1) {
      Panel.showEdgeProperties(edge, fromNode, toNode);
    }

    refreshMap();
  }
}

// ===== Edge Callbacks =====

function handleEdgeUpdate(edgeId: string, props: Partial<NavEdge>): void {
  State.updateEdge(state, edgeId, props);
  // Re-show updated properties
  const edge = state.graph.edges.find(e => e.id === edgeId);
  if (edge) {
    const fromNode = state.graph.nodes[edge.from];
    const toNode = state.graph.nodes[edge.to];
    if (fromNode && toNode) Panel.showEdgeProperties(edge, fromNode, toNode);
  }
}

function handleEdgeDelete(edgeId: string): void {
  State.deleteEdge(state, edgeId);
  state.selectedEdgeId = null; state.selectedEdgeIds = [];
  Panel.hideEdgeProperties();
  refreshMap();
}

function handleSetTime(edgeId: string, direction: 'fwd' | 'rev' | 'fwdExit' | 'revExit'): void {
  const edge = state.graph.edges.find(e => e.id === edgeId);
  if (!edge) return;

  // Resolve video/start/end keys based on direction
  const keyMap: Record<string, { video: keyof NavEdge; start: keyof NavEdge; end: keyof NavEdge }> = {
    fwd: { video: 'videoFwd', start: 'videoFwdStart', end: 'videoFwdEnd' },
    rev: { video: 'videoRev', start: 'videoRevStart', end: 'videoRevEnd' },
    fwdExit: { video: 'videoFwdExit', start: 'videoFwdExitStart', end: 'videoFwdExitEnd' },
    revExit: { video: 'videoRevExit', start: 'videoRevExitStart', end: 'videoRevExitEnd' },
  };
  const keys = keyMap[direction];

  const videoFile = edge[keys.video] as string | undefined;
  if (!videoFile) return;

  const vsEntry = VideoSettings.getEntry(videoFile);
  const yaw = vsEntry?.yaw ?? vsEntry?.entryYaw ?? 0;

  openVideoPreview({
    videoUrl: `/videos/${videoFile}`,
    initialYaw: yaw,
    mode: 'time-range',
    initialStart: edge[keys.start] as number | undefined,
    initialEnd: edge[keys.end] as number | undefined,
    onConfirm: () => {},
    onConfirmTimeRange: (start, end) => {
      handleEdgeUpdate(edgeId, { [keys.start]: start, [keys.end]: end });
    },
    onCancel: () => {},
  });
}

/**
 * For each edge in the chain, determine the correct video key based on:
 * - `direction`: the user's chosen chain direction (fwd/rev)
 * - `aligned`: whether the edge's from→to matches the chain walk direction
 *
 * If direction=fwd and aligned=true → edge walks from→to → use videoFwd
 * If direction=fwd and aligned=false → edge walks to→from → use videoRev
 * If direction=rev → flip everything
 */
function resolveEdgeVideoKeys(direction: 'fwd' | 'rev', aligned: boolean) {
  const effectiveFwd = (direction === 'fwd') === aligned;
  return {
    videoKey: effectiveFwd ? 'videoFwd' as const : 'videoRev' as const,
    startKey: effectiveFwd ? 'videoFwdStart' as const : 'videoRevStart' as const,
    endKey: effectiveFwd ? 'videoFwdEnd' as const : 'videoRevEnd' as const,
  };
}

function handleBatchVideoAssign(edgeIds: string[], direction: 'fwd' | 'rev', video: string | undefined): void {
  const chain = orderEdgeChain(edgeIds, state.graph);
  if (!chain) return;

  const opposite = video ? getOppositeVideo(video) : undefined;
  const reverseDir: 'fwd' | 'rev' = direction === 'fwd' ? 'rev' : 'fwd';

  for (const { edge, aligned } of chain) {
    const keys = resolveEdgeVideoKeys(direction, aligned);
    const props: Record<string, any> = { [keys.videoKey]: video };

    // Auto-assign reverse direction (corridors + stairs only)
    if (opposite) {
      const revKeys = resolveEdgeVideoKeys(reverseDir, aligned);
      props[revKeys.videoKey] = opposite;
    }

    State.updateEdge(state, edge.id, props);
  }
}

function handleSplitAssign(edgeIds: string[], direction: 'fwd' | 'rev', videoFile: string): void {
  const chain = orderEdgeChain(edgeIds, state.graph);
  if (!chain) {
    alert('선택된 엣지들이 연결된 경로를 형성하지 않습니다.');
    return;
  }

  const entry = VideoSettings.getEntry(videoFile);
  const yaw = entry?.yaw ?? 0;

  // Collect existing splits — gather all boundary times, sort for display
  const allHaveTimes = chain.every(({ edge, aligned }) => {
    const keys = resolveEdgeVideoKeys(direction, aligned);
    return edge[keys.videoKey] === videoFile
      && edge[keys.startKey] !== undefined
      && edge[keys.endKey] !== undefined;
  });

  const existingSplits: number[] = [];
  if (allHaveTimes) {
    const allTimes: number[] = [];
    for (const { edge, aligned } of chain) {
      const keys = resolveEdgeVideoKeys(direction, aligned);
      allTimes.push(edge[keys.startKey]!, edge[keys.endKey]!);
    }
    // Deduplicate and sort for correct UI display
    const sorted = [...new Set(allTimes.map(t => Math.round(t * 1000) / 1000))]
      .sort((a, b) => a - b);
    if (sorted.length === chain.length + 1) {
      existingSplits.push(...sorted);
    }
  }

  openVideoPreview({
    videoUrl: `/videos/${videoFile}`,
    initialYaw: yaw,
    mode: 'split',
    splitCount: chain.length,
    initialSplits: existingSplits.length === chain.length + 1 ? existingSplits : undefined,
    onConfirm: () => {},
    onConfirmSplits: (splits) => {
      // For REV, reverse the mapping: first video segment → chain end (REV start)
      for (let i = 0; i < chain.length; i++) {
        const chainIdx = direction === 'rev' ? chain.length - 1 - i : i;
        const keys = resolveEdgeVideoKeys(direction, chain[chainIdx].aligned);
        State.updateEdge(state, chain[chainIdx].edge.id, {
          [keys.videoKey]: videoFile,
          [keys.startKey]: splits[i],
          [keys.endKey]: splits[i + 1],
        });
      }
      if (state.selectedEdgeIds.length > 1) {
        const edges = state.selectedEdgeIds
          .map(id => state.graph.edges.find(e => e.id === id))
          .filter((e): e is NavEdge => !!e);
        Panel.showMultiEdgeProperties(edges, state.graph.nodes);
      }
      refreshMap();
    },
    onCancel: () => {},
  });
}

// ===== Edge Chain Ordering =====

interface ChainEdge {
  edge: NavEdge;
  aligned: boolean; // true if chain direction matches edge's from→to
}

function orderEdgeChain(edgeIds: string[], graph: { nodes: Record<string, any>; edges: NavEdge[] }): ChainEdge[] | null {
  const edges = edgeIds.map(id => graph.edges.find(e => e.id === id)).filter((e): e is NavEdge => !!e);
  if (edges.length !== edgeIds.length) return null;
  if (edges.length === 1) return [{ edge: edges[0], aligned: true }];

  // Build adjacency: node → edges that touch it
  const nodeToEdges = new Map<string, NavEdge[]>();
  for (const e of edges) {
    for (const nid of [e.from, e.to]) {
      if (!nodeToEdges.has(nid)) nodeToEdges.set(nid, []);
      nodeToEdges.get(nid)!.push(e);
    }
  }

  // Find endpoint nodes (touched by only 1 selected edge)
  const endpointNodes: string[] = [];
  for (const [nid, edgeList] of nodeToEdges) {
    if (edgeList.length === 1) endpointNodes.push(nid);
  }

  if (endpointNodes.length !== 2) return null; // not a simple chain

  // Deterministic start: alphabetically first node ID
  endpointNodes.sort();
  const startNode = endpointNodes[0];

  // Walk the chain from startNode, tracking direction per edge
  const result: ChainEdge[] = [];
  const used = new Set<string>();
  let currentNode = startNode;

  while (result.length < edges.length) {
    const nextEdge = (nodeToEdges.get(currentNode) || []).find(e => !used.has(e.id));
    if (!nextEdge) return null;
    used.add(nextEdge.id);
    const aligned = nextEdge.from === currentNode;
    result.push({ edge: nextEdge, aligned });
    currentNode = aligned ? nextEdge.to : nextEdge.from;
  }

  return result;
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
    state.selectedEdgeId = null; state.selectedEdgeIds = [];
    Panel.hideNodeProperties();
    Panel.hideEdgeProperties();
    refreshMap();
  }
}

function handleRedo(): void {
  if (State.redo(state)) {
    state.selectedNodeId = null;
    state.selectedEdgeId = null; state.selectedEdgeIds = [];
    Panel.hideNodeProperties();
    Panel.hideEdgeProperties();
    refreshMap();
  }
}

function handleExportSave(): void {
  const bundle = State.exportSaveData(state);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nav_save_${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function handleImportSave(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed: EditorSaveFile;
    try {
      parsed = JSON.parse(reader.result as string) as EditorSaveFile;
    } catch (err) {
      alert('Save file parsing failed: ' + (err as Error).message);
      return;
    }
    const summary = describeSaveFile(parsed);
    const ok = window.confirm(
      `Import "${file.name}"?\n\n${summary}\n\n` +
      `Graph (nodes + edges) will be REPLACED — your current graph is discarded.\n` +
      `Video settings and room labels will be MERGED per item (newer entries win; unconfigured rooms in the import are skipped).\n\n` +
      `Press OK to continue, Cancel to abort.`
    );
    if (!ok) return;

    let result: State.ImportSaveResult;
    try {
      result = State.importSaveFile(state, parsed, {
        snapshotRooms: snapshotRoomEdits,
        restoreRooms: restoreRoomEditsFromSnapshot,
        validateRooms: validateRoomImport,
        applyRoomMerge,
      });
    } catch (err) {
      alert('Import failed: ' + (err as Error).message);
      return;
    }

    if (!result.ok) {
      const lines = (result.mismatches ?? []).map(m =>
        `  • ${m.building} L${m.level} ref="${m.ref}" (fingerprint ${m.fingerprint})`
      );
      alert(
        `Import REJECTED — your room geojson differs from the sender's.\n\n` +
        `${lines.length} room${lines.length === 1 ? '' : 's'} in the save file have no matching polygon in your loaded geojson:\n\n` +
        `${lines.join('\n')}\n\n` +
        `Update your geojson source files to match the sender's version, then retry.`
      );
      return;
    }

    state.selectedNodeId = null;
    state.selectedEdgeId = null; state.selectedEdgeIds = [];
    state.edgeStartNodeId = null;
    Panel.hideNodeProperties();
    Panel.hideEdgeProperties();
    refreshAllVisibleRoomLabels();
    refreshMap();
  };
  reader.readAsText(file);
}

function describeSaveFile(data: EditorSaveFile): string {
  const nodeCount = data?.graph?.nodes ? Object.keys(data.graph.nodes).length : 0;
  const edgeCount = data?.graph?.edges?.length ?? 0;
  const videoCount = data?.videoSettings ? Object.keys(data.videoSettings).length : 0;
  const roomCount = data?.rooms?.length ?? 0;
  const note = data?.metadata?.note?.trim();
  return [
    `Saved at: ${data?.metadata?.savedAt ?? 'unknown'}`,
    note ? `Note: ${note}` : null,
    `Graph: ${nodeCount} nodes, ${edgeCount} edges`,
    `Video settings: ${videoCount} files`,
    `Configured rooms: ${roomCount}`,
  ].filter(Boolean).join('\n');
}

function handleNoteChange(note: string): void {
  saveNote = note;
  State.autosaveBundle();
}

async function handlePublish(): Promise<void> {
  try {
    await State.publishCombined(state, collectPublishRoomFiles());
    console.log('[GraphEditor] published runtime files');
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error('[GraphEditor] publish failed:', msg);
    alert(`Publish failed:\n\n${msg}`);
  }
}

function handleClearAll(): void {
  State.clearAll(state);
  state.selectedEdgeId = null; state.selectedEdgeIds = [];
  Panel.hideNodeProperties();
  Panel.hideEdgeProperties();
  refreshMap();
}

function handleClearBuildingGraph(building: string): void {
  if (!BackendService.getBuildingCodes().includes(building)) return;
  const { nodeCount, edgeCount } = State.clearBuildingNodesEdges(state, building);
  Panel.hideNodeProperties();
  Panel.hideEdgeProperties();
  refreshMap();
  console.log(`[GraphEditor] cleared ${building}: ${nodeCount} nodes, ${edgeCount} edges`);
}

function handleClearBuildingRooms(building: string): void {
  if (!map) return;
  if (!BackendService.getBuildingCodes().includes(building)) return;

  const levels = BackendService.getBuildingLevels(building);
  let totalCleared = 0;
  for (const level of levels) {
    const features = BackendService.getLevelDataForBuilding(building, level).rooms.features;
    let levelCleared = 0;
    for (const f of features) {
      const props = f.properties as any;
      if (props.ref || props.name || props.room_type) {
        props.ref = '';
        props.name = '';
        props.room_type = '';
        // Drop the matching roomEdits entry too — recordRoomEdit on a fully
        // cleared feature does this automatically.
        recordRoomEdit(building, level, f, props);
        levelCleared++;
      }
    }
    if (levelCleared > 0) {
      totalCleared += levelCleared;
      IndoorLayerModule.refreshRoomLabels(map, level);
    }
  }
  if (totalCleared > 0) State.autosaveBundle();

  // Reset any in-progress room selection if it belonged to this building
  if (selectedRoom?.building === building) {
    selectedRoom = null;
    const roomPropsEl = document.getElementById('geRoomProps');
    if (roomPropsEl) {
      roomPropsEl.dataset.featureIdx = '';
      roomPropsEl.dataset.featureBuilding = '';
    }
  }
  console.log(`[GraphEditor] cleared room data for ${building}: ${totalCleared} rooms`);
}

// ===== Room Label Editing =====
//
// Mutations update the in-memory feature (so labels redraw immediately) AND
// the in-editor roomEdits map keyed by (building, level, fingerprint) — that
// map is the source of truth carried into `editor/save.json`. The matching
// per-building geojson file is only rewritten at publish time.

function persistRoomEdit(building: string, feature: GeoJSON.Feature, level: number): void {
  recordRoomEdit(building, level, feature, feature.properties);
  if (map) IndoorLayerModule.refreshRoomLabels(map, level);
  State.autosaveBundle();
}

function handleRoomUpdate(building: string, featureIdx: number, props: { ref?: string; name?: string; room_type?: string }): void {
  if (!map) return;

  const rooms = BackendService.getLevelDataForBuilding(building, state.currentLevel).rooms.features;
  const feature = rooms.find(f => f.properties._idx === featureIdx);
  if (!feature) return;

  if (props.ref !== undefined) feature.properties.ref = props.ref;
  if (props.name !== undefined) feature.properties.name = props.name;
  if (props.room_type !== undefined) feature.properties.room_type = props.room_type;

  persistRoomEdit(building, feature, state.currentLevel);
}

function appendToRoomRef(building: string, featureIdx: number, digit: string): void {
  if (!map) return;
  const rooms = BackendService.getLevelDataForBuilding(building, state.currentLevel).rooms.features;
  const feature = rooms.find(f => f.properties._idx === featureIdx);
  if (!feature) return;

  const currentRef = feature.properties.ref ?? '';
  const newRef = currentRef + digit;
  feature.properties.ref = newRef;
  Panel.updateRoomRefInput(newRef);
  persistRoomEdit(building, feature, state.currentLevel);
  tryAutoLookup(building, featureIdx, newRef);
}

function backspaceRoomRef(building: string, featureIdx: number): void {
  if (!map) return;
  const rooms = BackendService.getLevelDataForBuilding(building, state.currentLevel).rooms.features;
  const feature = rooms.find(f => f.properties._idx === featureIdx);
  if (!feature) return;

  const currentRef = feature.properties.ref ?? '';
  if (currentRef.length === 0) return;
  const newRef = currentRef.slice(0, -1);
  feature.properties.ref = newRef;
  Panel.updateRoomRefInput(newRef);
  persistRoomEdit(building, feature, state.currentLevel);
  tryAutoLookup(building, featureIdx, newRef);
}

function tryAutoLookup(building: string, featureIdx: number, ref: string): void {
  const autoLookupToggle = document.getElementById('geRoomAutoLookup') as HTMLInputElement;
  if (!autoLookupToggle?.checked) return;

  if (!map) return;
  const entry = RoomCodeLookup.lookup(ref);

  const rooms = BackendService.getLevelDataForBuilding(building, state.currentLevel).rooms.features;
  const feature = rooms.find(f => f.properties._idx === featureIdx);
  if (!feature) return;

  feature.properties.name = entry ? entry.name : '';
  feature.properties.room_type = entry ? entry.room_type : '';

  Panel.updateRoomNameInput(entry ? entry.name : '');
  Panel.updateRoomTypeSelect(entry ? entry.room_type : '');

  persistRoomEdit(building, feature, state.currentLevel);
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
  a.download = `all_room_L${level}.geojson`;
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
    if (state.mode === 'label-room' && selectedRoom !== null) {
      selectedRoom = null;
      const roomPropsEl = document.getElementById('geRoomProps');
      if (roomPropsEl) {
        roomPropsEl.dataset.featureIdx = '';
        roomPropsEl.dataset.featureBuilding = '';
      }
    } else if (state.edgeStartNodeId) {
      state.edgeStartNodeId = null;
      Panel.setEdgeHint('노드를 클릭하여 엣지 시작점을 선택하세요');
      refreshMap();
    } else if (state.selectedEdgeId) {
      state.selectedEdgeId = null; state.selectedEdgeIds = [];
      Panel.hideEdgeProperties();
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
  } else if (state.mode === 'label-room' && selectedRoom !== null && e.key >= '0' && e.key <= '9') {
    // label-room 모드에서 숫자키 → ref에 숫자 추가
    appendToRoomRef(selectedRoom.building, selectedRoom.idx, e.key);
    e.preventDefault();
  } else if (state.mode === 'label-room' && selectedRoom !== null && (e.key === 'a' || e.key === 'b' || e.key === 'c' || e.key === 'A' || e.key === 'B' || e.key === 'C')) {
    // label-room 모드에서 a/b/c → ref에 대문자 추가
    appendToRoomRef(selectedRoom.building, selectedRoom.idx, e.key.toUpperCase());
    e.preventDefault();
  } else if (state.mode === 'label-room' && selectedRoom !== null && e.key === 'Backspace') {
    // label-room 모드에서 Backspace → ref 마지막 글자 삭제
    backspaceRoomRef(selectedRoom.building, selectedRoom.idx);
    e.preventDefault();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedNodeId) {
      handleNodeDelete(state.selectedNodeId);
    } else if (state.selectedEdgeId) {
      handleEdgeDelete(state.selectedEdgeId);
    }
  } else if (e.key === 'q' || e.key === 'Q') {
    handleModeChange('select');
  } else if (e.key === 'w' || e.key === 'W') {
    handleModeChange('add-node');
  } else if (e.key === 'e' || e.key === 'E') {
    handleModeChange('add-edge');
  } else if (e.key === 'r' || e.key === 'R') {
    handleModeChange('label-room');
  } else if (e.key === 't' || e.key === 'T') {
    handleModeChange('delete');
  }
}

// ===== Refresh Map Display =====

/**
 * Directional endpoints for visualizing edge direction (from=red, to=blue).
 * - Single selected edge: the edge's from/to nodes.
 * - Multi-edge chain: the chain's start (red) and end (blue).
 */
function getEdgeDirectionalEndpoints(): { fromId: string | null; toId: string | null } {
  if (state.selectedEdgeIds.length === 0) return { fromId: null, toId: null };

  if (state.selectedEdgeIds.length === 1) {
    const edge = state.graph.edges.find(e => e.id === state.selectedEdgeIds[0]);
    if (!edge) return { fromId: null, toId: null };
    return { fromId: edge.from, toId: edge.to };
  }

  const chain = orderEdgeChain(state.selectedEdgeIds, state.graph);
  if (!chain || chain.length === 0) return { fromId: null, toId: null };
  const first = chain[0];
  const last = chain[chain.length - 1];
  const fromId = first.aligned ? first.edge.from : first.edge.to;
  const toId = last.aligned ? last.edge.to : last.edge.from;
  return { fromId, toId };
}

function refreshMap(): void {
  if (!map) return;

  const level = state.currentLevel;
  const is3D = !GeoMap.isFlatMode();
  const { fromId: edgeFromId, toId: edgeToId } = getEdgeDirectionalEndpoints();

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
      edgeFromId,
      edgeToId,
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
    EditorMap.updateEdgeLayer(map, [], level, state.selectedEdgeIds);
  } else {
    // 2D mode: show only current level via circle/line layers
    EditorMap.clearFloatingNodes();
    EditorMap.clearFloatingEdges();
    EditorMap.set2DNodeLayersVisible(map, true);
    EditorMap.set2DEdgeLayersVisible(map, true);
    const visibleNodes = State.getNodesOnLevel(state, level);
    EditorMap.updateNodeLayer(map, visibleNodes, state.selectedNodeId, state.edgeStartNodeId, edgeFromId, edgeToId);
    const visibleEdges = State.getEdgesOnLevel(state, level);
    EditorMap.updateEdgeLayer(map, visibleEdges, level, state.selectedEdgeIds);
  }

  Panel.updateInfo(State.getNodeCount(state), State.getEdgeCount(state), level);
}
