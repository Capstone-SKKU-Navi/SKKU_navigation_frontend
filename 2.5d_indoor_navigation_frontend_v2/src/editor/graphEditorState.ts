// ===== Navigation Graph Editor — State Management =====

import { NavNode, NavEdge, NavGraph, EditorState, EditorMode, Command, NavGraphExport } from './graphEditorTypes';
import { getDistanceBetweenCoordinatesInM } from '../utils/coordinateHelpers';
import { DEFAULT_FLOOR_HEIGHT } from '../components/indoorLayer';
import * as BackendService from '../services/backendService';
import * as GraphService from '../services/graphService';

const GRAPH_JSON_URL = '/geojson/graph.json';
const SAVE_API_URL = '/api/save-graph';

// ===== State Factory =====

export function createState(): EditorState {
  return {
    graph: { nodes: {}, edges: [] },
    mode: 'select',
    selectedNodeId: null,
    selectedEdgeId: null,
    selectedEdgeIds: [],
    edgeStartNodeId: null,
    currentLevel: 1,
    undoStack: [],
    redoStack: [],
  };
}

export async function loadGraphFromFile(): Promise<NavGraph | null> {
  try {
    const res = await fetch(GRAPH_JSON_URL);
    if (!res.ok) return null;
    const data = await res.json() as NavGraphExport;
    if (data.nodes && data.edges) return importGraph(data);
  } catch { /* file not found or parse error */ }
  return null;
}

// ===== ID Generation =====

function genNodeId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `node-${ts}-${rand}`;
}

function genEdgeId(from: string, to: string): string {
  return `edge-${from}-${to}`;
}

// ===== Mutations (with undo/redo) =====

export function addNode(state: EditorState, partial: Omit<NavNode, 'id'>): NavNode {
  const node: NavNode = { id: genNodeId(), ...partial };
  const cmd = new AddNodeCmd(node);
  executeCmd(state, cmd);
  return node;
}

export function deleteNode(state: EditorState, nodeId: string): void {
  const node = state.graph.nodes[nodeId];
  if (!node) return;
  const connectedEdges = state.graph.edges.filter(e => e.from === nodeId || e.to === nodeId);
  const cmd = new DeleteNodeCmd(node, connectedEdges);
  executeCmd(state, cmd);
}

export function updateNode(state: EditorState, nodeId: string, props: Partial<NavNode>): void {
  const node = state.graph.nodes[nodeId];
  if (!node) return;
  const before: Partial<NavNode> = {};
  for (const key of Object.keys(props) as (keyof NavNode)[]) {
    (before as any)[key] = node[key];
  }
  const cmd = new UpdateNodeCmd(nodeId, before, props);
  executeCmd(state, cmd);
}

export function addEdge(state: EditorState, from: string, to: string, weightOverride?: number): NavEdge | null {
  const nodeA = state.graph.nodes[from];
  const nodeB = state.graph.nodes[to];
  if (!nodeA || !nodeB) return null;

  // Prevent duplicate edges
  const exists = state.graph.edges.some(
    e => (e.from === from && e.to === to) || (e.from === to && e.to === from)
  );
  if (exists) return null;

  const weight = weightOverride ?? calcEdgeWeight(nodeA, nodeB);
  const edge: NavEdge = { id: genEdgeId(from, to), from, to, weight };
  const cmd = new AddEdgeCmd(edge);
  executeCmd(state, cmd);
  return edge;
}

export function deleteEdge(state: EditorState, edgeId: string): void {
  const edge = state.graph.edges.find(e => e.id === edgeId);
  if (!edge) return;
  const cmd = new DeleteEdgeCmd(edge);
  executeCmd(state, cmd);
}

export function updateEdge(state: EditorState, edgeId: string, props: Partial<NavEdge>): void {
  const edge = state.graph.edges.find(e => e.id === edgeId);
  if (!edge) return;
  // Strip identity fields to prevent corruption
  const { id: _id, from: _from, to: _to, ...safeProps } = props;
  const before: Partial<NavEdge> = {};
  for (const key of Object.keys(safeProps) as (keyof NavEdge)[]) {
    (before as any)[key] = edge[key];
  }
  const cmd = new UpdateEdgeCmd(edgeId, before, safeProps);
  executeCmd(state, cmd);
}

// ===== Undo / Redo =====

function executeCmd(state: EditorState, cmd: Command): void {
  cmd.execute(state.graph);
  state.undoStack.push(cmd);
  state.redoStack = [];
  saveToFile(state.graph);
}

export function undo(state: EditorState): boolean {
  const cmd = state.undoStack.pop();
  if (!cmd) return false;
  cmd.undo(state.graph);
  state.redoStack.push(cmd);
  saveToFile(state.graph);
  return true;
}

export function redo(state: EditorState): boolean {
  const cmd = state.redoStack.pop();
  if (!cmd) return false;
  cmd.execute(state.graph);
  state.undoStack.push(cmd);
  saveToFile(state.graph);
  return true;
}

export function clearAll(state: EditorState): void {
  // Save everything for undo
  const oldNodes = { ...state.graph.nodes };
  const oldEdges = [...state.graph.edges];
  const cmd: Command = {
    execute(graph) { graph.nodes = {}; graph.edges = []; },
    undo(graph) { graph.nodes = oldNodes; graph.edges = oldEdges; },
  };
  executeCmd(state, cmd);
  state.selectedNodeId = null;
  state.edgeStartNodeId = null;
}

// ===== Persistence (file-based) =====

function saveToFile(graph: NavGraph): void {
  const data = exportGraph(graph);
  fetch(SAVE_API_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(res => {
    if (!res.ok) console.warn('[GraphEditor] graph save failed:', res.status);
    else GraphService.loadGraph(); // Refresh pathfinding graph so walkthrough uses latest data
  }).catch(err => console.warn('[GraphEditor] graph save error:', err));
}

// ===== Import / Export =====

export function exportGraph(graph: NavGraph): NavGraphExport {
  const nodes: NavGraphExport['nodes'] = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    nodes[id] = {
      coordinates: node.coordinates,
      level: node.level,
      type: node.type,
      label: node.label,
    };
  }
  return {
    nodes,
    edges: graph.edges.map(e => {
      const entry: NavGraphExport['edges'][number] = { from: e.from, to: e.to, weight: e.weight };
      if (e.videoFwd) entry.videoFwd = e.videoFwd;
      if (e.videoFwdStart !== undefined) entry.videoFwdStart = e.videoFwdStart;
      if (e.videoFwdEnd !== undefined) entry.videoFwdEnd = e.videoFwdEnd;
      if (e.videoFwdExit) entry.videoFwdExit = e.videoFwdExit;
      if (e.videoFwdExitStart !== undefined) entry.videoFwdExitStart = e.videoFwdExitStart;
      if (e.videoFwdExitEnd !== undefined) entry.videoFwdExitEnd = e.videoFwdExitEnd;
      if (e.videoRev) entry.videoRev = e.videoRev;
      if (e.videoRevStart !== undefined) entry.videoRevStart = e.videoRevStart;
      if (e.videoRevEnd !== undefined) entry.videoRevEnd = e.videoRevEnd;
      if (e.videoRevExit) entry.videoRevExit = e.videoRevExit;
      if (e.videoRevExitStart !== undefined) entry.videoRevExitStart = e.videoRevExitStart;
      if (e.videoRevExitEnd !== undefined) entry.videoRevExitEnd = e.videoRevExitEnd;
      return entry;
    }),
  };
}

export function importGraph(data: NavGraphExport): NavGraph {
  const nodes: Record<string, NavNode> = {};
  for (const [id, raw] of Object.entries(data.nodes)) {
    const level = Array.isArray(raw.level) ? raw.level[0] : raw.level;
    nodes[id] = {
      id,
      coordinates: raw.coordinates,
      level,
      building: detectBuilding(raw.coordinates, level),
      type: raw.type as NavNode['type'],
      label: raw.label ?? '',
    };
  }
  const edges: NavEdge[] = data.edges.map(e => ({
    id: genEdgeId(e.from, e.to),
    from: e.from,
    to: e.to,
    weight: e.weight,
    ...(e.videoFwd ? { videoFwd: e.videoFwd } : {}),
    ...(e.videoFwdStart !== undefined ? { videoFwdStart: e.videoFwdStart } : {}),
    ...(e.videoFwdEnd !== undefined ? { videoFwdEnd: e.videoFwdEnd } : {}),
    ...(e.videoFwdExit ? { videoFwdExit: e.videoFwdExit } : {}),
    ...(e.videoFwdExitStart !== undefined ? { videoFwdExitStart: e.videoFwdExitStart } : {}),
    ...(e.videoFwdExitEnd !== undefined ? { videoFwdExitEnd: e.videoFwdExitEnd } : {}),
    ...(e.videoRev ? { videoRev: e.videoRev } : {}),
    ...(e.videoRevStart !== undefined ? { videoRevStart: e.videoRevStart } : {}),
    ...(e.videoRevEnd !== undefined ? { videoRevEnd: e.videoRevEnd } : {}),
    ...(e.videoRevExit ? { videoRevExit: e.videoRevExit } : {}),
    ...(e.videoRevExitStart !== undefined ? { videoRevExitStart: e.videoRevExitStart } : {}),
    ...(e.videoRevExitEnd !== undefined ? { videoRevExitEnd: e.videoRevExitEnd } : {}),
  }));
  return { nodes, edges };
}

// ===== Building Detection =====

export function detectBuilding(coords: [number, number], level: number): string {
  const [lng, lat] = coords;

  // Try room polygon containment
  try {
    const levelGeoJson = BackendService.getLevelGeoJson(level);
    for (const f of levelGeoJson.features) {
      if (f.properties.indoor !== 'room' || !f.properties.ref) continue;
      if (f.geometry.type !== 'Polygon') continue;

      const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
      if (pointInPolygon(lng, lat, ring)) {
        const ref = f.properties.ref as string;
        if (ref.startsWith('21')) return '21';
        if (ref.startsWith('22')) return '22';
        if (ref.startsWith('23')) return '23';
      }
    }
  } catch { /* data not loaded yet */ }

  // Fallback: geographic heuristic
  if (lat < 37.29418 && lng < 126.97693) return '21';
  if (lng >= 126.97693) return '22';
  if (lat >= 37.29418) return '23';
  return 'ENG1';
}

function pointInPolygon(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ===== Edge Weight Calculation =====

function calcEdgeWeight(a: NavNode, b: NavNode): number {
  const horizontalDist = getDistanceBetweenCoordinatesInM(a.coordinates, b.coordinates);
  const verticalDist = Math.abs(a.level - b.level) * DEFAULT_FLOOR_HEIGHT;
  return Math.round(horizontalDist + verticalDist);
}

// ===== Room Detection =====

/** 좌표가 속한 방의 ref를 반환. 방 안이 아니면 가장 가까운 방의 ref. */
export function detectRoomRef(coords: [number, number], level: number): string {
  const [lng, lat] = coords;
  const levelData = BackendService.getLevelData(level);
  const rooms = levelData.rooms.features;

  // 1차: point-in-polygon으로 방 안에 있는지 확인
  for (const f of rooms) {
    if (!f.properties.ref) continue;
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;

    const ring = f.geometry.type === 'Polygon'
      ? (f.geometry as GeoJSON.Polygon).coordinates[0]
      : (f.geometry as GeoJSON.MultiPolygon).coordinates[0][0];

    if (pointInPolygon(lng, lat, ring)) {
      return f.properties.ref;
    }
  }

  // 2차: 가장 가까운 방의 centroid 기준
  let bestRef = '';
  let bestDist = Infinity;
  for (const f of rooms) {
    if (!f.properties.ref) continue;
    const c = f.properties._centroid as [number, number] | undefined;
    if (!c) continue;
    const dx = lng - c[0];
    const dy = lat - c[1];
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestRef = f.properties.ref;
    }
  }
  return bestRef;
}

// ===== Query Helpers =====

export function getNodeCount(state: EditorState): number {
  return Object.keys(state.graph.nodes).length;
}

export function getEdgeCount(state: EditorState): number {
  return state.graph.edges.length;
}

export function getNodesOnLevel(state: EditorState, level: number): NavNode[] {
  return Object.values(state.graph.nodes).filter(n => n.level === level);
}

export function getEdgesOnLevel(state: EditorState, level: number): { edge: NavEdge; fromNode: NavNode; toNode: NavNode }[] {
  const results: { edge: NavEdge; fromNode: NavNode; toNode: NavNode }[] = [];
  for (const edge of state.graph.edges) {
    const fromNode = state.graph.nodes[edge.from];
    const toNode = state.graph.nodes[edge.to];
    if (!fromNode || !toNode) continue;
    if (fromNode.level === level || toNode.level === level) {
      results.push({ edge, fromNode, toNode });
    }
  }
  return results;
}

export function getAllEdgesWithNodes(state: EditorState): { edge: NavEdge; fromNode: NavNode; toNode: NavNode }[] {
  const results: { edge: NavEdge; fromNode: NavNode; toNode: NavNode }[] = [];
  for (const edge of state.graph.edges) {
    const fromNode = state.graph.nodes[edge.from];
    const toNode = state.graph.nodes[edge.to];
    if (!fromNode || !toNode) continue;
    results.push({ edge, fromNode, toNode });
  }
  return results;
}

// ===== Command Classes =====

class AddNodeCmd implements Command {
  constructor(private node: NavNode) {}
  execute(graph: NavGraph) { graph.nodes[this.node.id] = { ...this.node }; }
  undo(graph: NavGraph) { delete graph.nodes[this.node.id]; }
}

class DeleteNodeCmd implements Command {
  constructor(private node: NavNode, private connectedEdges: NavEdge[]) {}
  execute(graph: NavGraph) {
    delete graph.nodes[this.node.id];
    graph.edges = graph.edges.filter(e => e.from !== this.node.id && e.to !== this.node.id);
  }
  undo(graph: NavGraph) {
    graph.nodes[this.node.id] = { ...this.node };
    graph.edges.push(...this.connectedEdges.map(e => ({ ...e })));
  }
}

class UpdateNodeCmd implements Command {
  constructor(private nodeId: string, private before: Partial<NavNode>, private after: Partial<NavNode>) {}
  execute(graph: NavGraph) { Object.assign(graph.nodes[this.nodeId], this.after); }
  undo(graph: NavGraph) { Object.assign(graph.nodes[this.nodeId], this.before); }
}

class AddEdgeCmd implements Command {
  constructor(private edge: NavEdge) {}
  execute(graph: NavGraph) { graph.edges.push({ ...this.edge }); }
  undo(graph: NavGraph) { graph.edges = graph.edges.filter(e => e.id !== this.edge.id); }
}

class DeleteEdgeCmd implements Command {
  constructor(private edge: NavEdge) {}
  execute(graph: NavGraph) { graph.edges = graph.edges.filter(e => e.id !== this.edge.id); }
  undo(graph: NavGraph) { graph.edges.push({ ...this.edge }); }
}

class UpdateEdgeCmd implements Command {
  constructor(private edgeId: string, private before: Partial<NavEdge>, private after: Partial<NavEdge>) {}
  execute(graph: NavGraph) {
    const edge = graph.edges.find(e => e.id === this.edgeId);
    if (edge) Object.assign(edge, this.after);
  }
  undo(graph: NavGraph) {
    const edge = graph.edges.find(e => e.id === this.edgeId);
    if (edge) Object.assign(edge, this.before);
  }
}
