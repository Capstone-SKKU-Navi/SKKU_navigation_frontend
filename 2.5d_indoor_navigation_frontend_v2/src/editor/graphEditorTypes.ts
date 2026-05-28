// ===== Navigation Graph Editor — Type Definitions =====

export type NavNodeType = 'corridor' | 'stairs' | 'elevator' | 'entrance' | 'room';

export interface NavNode {
  id: string;
  coordinates: [number, number]; // [lng, lat]
  level: number;
  building: string;              // building code (e.g. "eng1", "slib") or "outside"
  type: NavNodeType;
  label: string;
  verticalId?: number;           // stair 1-4, elevator 1-2 — which physical unit
}

export interface NavEdge {
  id: string;
  from: string;
  to: string;
  weight: number; // meters
  building: string;     // building code or "outside" — same on both ends, else "outside"
  videoFwd?: string;    // 360° video for from→to direction (or entry clip for stairs/elev)
  videoFwdStart?: number;
  videoFwdEnd?: number;
  videoFwdExit?: string;    // exit clip video (stairs/elevator only)
  videoFwdExitStart?: number;
  videoFwdExitEnd?: number;
  videoRev?: string;
  videoRevStart?: number;
  videoRevEnd?: number;
  videoRevExit?: string;
  videoRevExitStart?: number;
  videoRevExitEnd?: number;
}

export interface NavGraph {
  nodes: Record<string, NavNode>;
  edges: NavEdge[];
}

export type EditorMode = 'select' | 'add-node' | 'add-edge' | 'label-room' | 'delete';

/** How `Import save` integrates the incoming graph. Video and room edits always merge per-key. */
export type ImportMode = 'replace' | 'append';

export type RoomType =
  | 'classroom' | 'lab' | 'restroom' | 'office' | 'stairs' | 'elevator'
  | 'dormitory' | 'dining' | 'lounge' | 'facility' | 'storage' | 'store' | 'club' | 'reserved'
  | '';

export interface RoomAutoApplyPreset {
  enabled: boolean;
  roomType: RoomType;
  refPrefix: string;
}

export const ROOM_TYPES: { value: RoomType; label: string }[] = [
  { value: 'classroom', label: '교실' },
  { value: 'lab', label: '실험실' },
  { value: 'restroom', label: '화장실' },
  { value: 'office', label: '사무실' },
  { value: 'stairs', label: '계단' },
  { value: 'elevator', label: '엘리베이터' },
  { value: 'dormitory', label: '기숙사' },
  { value: 'dining', label: '식당' },
  { value: 'lounge', label: '휴게/편의' },
  { value: 'facility', label: '기계/설비' },
  { value: 'storage', label: '창고' },
  { value: 'store', label: '매장/서비스' },
  { value: 'club', label: '동아리' },
  { value: 'reserved', label: '예비' },
];

export interface EditorState {
  graph: NavGraph;
  mode: EditorMode;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  selectedEdgeIds: string[];
  edgeStartNodeId: string | null;
  currentLevel: number;
  undoStack: Command[];
  redoStack: Command[];
}

// ===== Command pattern for undo/redo =====

export interface Command {
  execute(graph: NavGraph): void;
  undo(graph: NavGraph): void;
}

// ===== Export format (graph.json compatible) =====

export interface NavGraphExport {
  nodes: Record<string, {
    coordinates: [number, number];
    level: number | number[];
    type: string;
    label: string;
    verticalId?: number;
    building?: string;            // persisted so backend handoff doesn't depend on outline-load timing
  }>;
  edges: Array<{
    from: string;
    to: string;
    weight: number;
    videoFwd?: string;
    videoFwdStart?: number;
    videoFwdEnd?: number;
    videoFwdExit?: string;
    videoFwdExitStart?: number;
    videoFwdExitEnd?: number;
    videoRev?: string;
    videoRevStart?: number;
    videoRevEnd?: number;
    videoRevExit?: string;
    videoRevExitStart?: number;
    videoRevExitEnd?: number;
  }>;
}

// ===== Editor save file (working file shared with collaborators) =====
//
// Single bundle that captures the whole editor state. Autosaved to
// `public/geojson/editor/save.json` on every mutation; round-tripped between
// collaborators via the panel's Export Save / Import Save buttons.
//
// Graph is replaced wholesale on import. Video settings and room labels merge
// per-key by `updatedAt` recency — see graphEditorState.importSaveFile.

export const EDITOR_SAVE_VERSION = 1;

export interface VideoSettingsExport {
  [filename: string]: {
    yaw?: number;
    entryYaw?: number;
    exitYaw?: number;
    updatedAt: number;          // epoch ms; bumped on every yaw edit
  };
}

export interface RoomEditEntry {
  building: string;
  level: number;
  fingerprint: string;          // `${centroid[0].toFixed(6)}_${centroid[1].toFixed(6)}_${_area_m2}` from the source geojson
  ref: string;
  name: string;
  room_type: string;
  updatedAt: number;            // epoch ms
}

export interface EditorSaveFile {
  version: number;
  metadata: {
    savedAt: string;            // ISO 8601
    note?: string;
  };
  graph: NavGraphExport;
  videoSettings: VideoSettingsExport;
  rooms: RoomEditEntry[];
}

// ===== Callback interfaces =====

export interface EditorMapCallbacks {
  onMapClick(lngLat: [number, number]): void;
  onNodeClick(nodeId: string): void;
  onEdgeClick(edgeId: string, shiftKey: boolean): void;
}

export interface PanelCallbacks {
  onModeChange(mode: EditorMode): void;
  onNodeUpdate(nodeId: string, props: Partial<NavNode>): void;
  onNodeDelete(nodeId: string): void;
  onEdgeUpdate(edgeId: string, props: Partial<NavEdge>): void;
  onEdgeDelete(edgeId: string): void;
  onSetTime(edgeId: string, direction: 'fwd' | 'rev' | 'fwdExit' | 'revExit'): void;
  onBatchVideoAssign(edgeIds: string[], direction: 'fwd' | 'rev', video: string | undefined): void;
  onSplitAssign(edgeIds: string[], direction: 'fwd' | 'rev', video: string): void;
  onRoomUpdate(building: string, featureIdx: number, props: { ref?: string; name?: string; room_type?: string }): void;
  onRoomExport(): void;
  onUndo(): void;
  onRedo(): void;
  onExportSave(): void;
  onImportSave(file: File, mode: ImportMode): void;
  onPublish(): void;
  onClearAll(): void;
  onClearBuildingGraph(building: string): void;
  onClearBuildingRooms(building: string): void;
  onAutoApplyChange(preset: RoomAutoApplyPreset): void;
  onNoteChange(note: string): void;
  onToggleEdgeWeights(visible: boolean): void;
  onClose(): void;
}

// ===== Node type colors =====

export const NODE_COLORS: Record<NavNodeType, string> = {
  corridor: '#78909C',
  stairs: '#A1887F',
  elevator: '#B0BEC5',
  entrance: '#66BB6A',
  room: '#42A5F5',
};

export const NODE_TYPE_LABELS: Record<NavNodeType, string> = {
  corridor: '복도',
  stairs: '계단',
  elevator: '엘리베이터',
  entrance: '출입구',
  room: '방',
};

export const ALL_NODE_TYPES: NavNodeType[] = [
  'corridor', 'stairs', 'elevator', 'entrance', 'room',
];
