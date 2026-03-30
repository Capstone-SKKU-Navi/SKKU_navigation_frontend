// ===== Navigation Graph Editor — Type Definitions =====

export type NavNodeType = 'corridor' | 'stairs' | 'elevator' | 'entrance' | 'room';

export interface NavNode {
  id: string;
  coordinates: [number, number]; // [lng, lat]
  level: number;
  building: string;              // "21" | "22" | "23" | "ENG1"
  type: NavNodeType;
  label: string;
  verticalId?: number;           // stair 1-4, elevator 1-2 — which physical unit
}

export interface NavEdge {
  id: string;
  from: string;
  to: string;
  weight: number; // meters
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

export type EditorMode = 'select' | 'add-node' | 'add-edge' | 'label-room';

export type RoomType = 'classroom' | 'lab' | 'restroom' | 'office' | 'stairs' | 'elevator' | '';

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
  onRoomUpdate(featureIdx: number, props: { ref?: string; room_type?: string }): void;
  onRoomExport(): void;
  onUndo(): void;
  onRedo(): void;
  onImport(): void;
  onExport(): void;
  onClearAll(): void;
  onAutoApplyChange(preset: RoomAutoApplyPreset): void;
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
