// ===== Navigation Graph Editor — State Management =====

import { NavNode, NavEdge, NavGraph, EditorState, EditorMode, Command, NavGraphExport } from './graphEditorTypes';
import { getDistanceBetweenCoordinatesInM } from '../utils/coordinateHelpers';
import { DEFAULT_FLOOR_HEIGHT } from '../components/indoorLayer';
import { detectBuilding, pointInPolygon } from '../utils/buildingDetection';
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

/**
 * Move a node to new coordinates. Re-derives the node's `building`, recomputes
 * `weight` and `building` for every edge touching the node, and bundles
 * everything into a single undoable command.
 */
export function moveNode(state: EditorState, nodeId: string, newCoords: [number, number]): void {
  const node = state.graph.nodes[nodeId];
  if (!node) return;
  const oldCoords = node.coordinates;
  if (oldCoords[0] === newCoords[0] && oldCoords[1] === newCoords[1]) return;

  const oldNodeBuilding = node.building;
  const newNodeBuilding = detectBuilding(newCoords, node.level);

  const edgeChanges: Array<{
    id: string;
    oldWeight: number; newWeight: number;
    oldBuilding: string; newBuilding: string;
  }> = [];
  for (const edge of state.graph.edges) {
    if (edge.from !== nodeId && edge.to !== nodeId) continue;
    const otherId = edge.from === nodeId ? edge.to : edge.from;
    const other = state.graph.nodes[otherId];
    if (!other) continue;
    const horizontal = getDistanceBetweenCoordinatesInM(newCoords, other.coordinates);
    const vertical = Math.abs(node.level - other.level) * DEFAULT_FLOOR_HEIGHT;
    const newWeight = Math.round(horizontal + vertical);
    const newEdgeBuilding = newNodeBuilding === other.building ? newNodeBuilding : 'outside';
    edgeChanges.push({
      id: edge.id,
      oldWeight: edge.weight,
      newWeight,
      oldBuilding: edge.building,
      newBuilding: newEdgeBuilding,
    });
  }

  const cmd = new MoveNodeCmd(nodeId, oldCoords, newCoords, oldNodeBuilding, newNodeBuilding, edgeChanges);
  executeCmd(state, cmd);
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
  const edge: NavEdge = { id: genEdgeId(from, to), from, to, weight, building: resolveEdgeBuilding(nodeA, nodeB) };
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

/**
 * Delete every node located inside the given building (point-in-outline match)
 * and every edge touching one of those nodes. Resolves via coordinates rather
 * than `node.building` so a node tagged "outside" but spatially inside the
 * building (e.g., outline updated after node placement) still gets cleared.
 */
export function clearBuildingNodesEdges(state: EditorState, building: string): { nodeCount: number; edgeCount: number } {
  const nodeIdsToRemove = new Set<string>();
  for (const [id, node] of Object.entries(state.graph.nodes)) {
    if (BackendService.getBuildingForCoordinates(node.coordinates) === building) {
      nodeIdsToRemove.add(id);
    }
  }
  if (nodeIdsToRemove.size === 0) return { nodeCount: 0, edgeCount: 0 };

  const removedNodes: NavNode[] = [];
  for (const id of nodeIdsToRemove) removedNodes.push({ ...state.graph.nodes[id] });
  const removedEdges: NavEdge[] = state.graph.edges
    .filter(e => nodeIdsToRemove.has(e.from) || nodeIdsToRemove.has(e.to))
    .map(e => ({ ...e }));

  const cmd: Command = {
    execute(graph) {
      for (const id of nodeIdsToRemove) delete graph.nodes[id];
      graph.edges = graph.edges.filter(e => !nodeIdsToRemove.has(e.from) && !nodeIdsToRemove.has(e.to));
    },
    undo(graph) {
      for (const n of removedNodes) graph.nodes[n.id] = { ...n };
      graph.edges.push(...removedEdges.map(e => ({ ...e })));
    },
  };
  executeCmd(state, cmd);
  state.selectedNodeId = null;
  state.selectedEdgeId = null;
  state.selectedEdgeIds = [];
  state.edgeStartNodeId = null;
  return { nodeCount: removedNodes.length, edgeCount: removedEdges.length };
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
    const entry: NavGraphExport['nodes'][string] = {
      coordinates: node.coordinates,
      level: node.level,
      type: node.type,
      label: node.label,
      building: node.building,
    };
    if (node.verticalId !== undefined) entry.verticalId = node.verticalId;
    nodes[id] = entry;
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
      // Prefer persisted building. Fallback to detectBuilding for legacy graphs
      // that were exported before building was persisted.
      building: raw.building ?? detectBuilding(raw.coordinates, level),
      type: raw.type as NavNode['type'],
      label: raw.label ?? '',
      ...(raw.verticalId !== undefined ? { verticalId: raw.verticalId } : {}),
    };
  }
  const edges: NavEdge[] = data.edges.map(e => ({
    id: genEdgeId(e.from, e.to),
    from: e.from,
    to: e.to,
    weight: e.weight,
    building: resolveEdgeBuilding(nodes[e.from], nodes[e.to]),
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

// Re-export detectBuilding from shared utility (used by graphEditor.ts and others)
export { detectBuilding, pointInPolygon } from '../utils/buildingDetection';

// ===== Edge Weight Calculation =====

function calcEdgeWeight(a: NavNode, b: NavNode): number {
  const horizontalDist = getDistanceBetweenCoordinatesInM(a.coordinates, b.coordinates);
  const verticalDist = Math.abs(a.level - b.level) * DEFAULT_FLOOR_HEIGHT;
  return Math.round(horizontalDist + verticalDist);
}

/**
 * Edge building: same on both ends → that building. Mismatch (cross-building
 * link) or missing endpoints → "outside". Missing endpoints indicate a
 * dangling reference; surface it as "outside" rather than silently inheriting
 * the surviving node's code.
 */
function resolveEdgeBuilding(a: NavNode | undefined, b: NavNode | undefined): string {
  if (!a || !b) return 'outside';
  return a.building === b.building ? a.building : 'outside';
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

class MoveNodeCmd implements Command {
  constructor(
    private nodeId: string,
    private oldCoords: [number, number],
    private newCoords: [number, number],
    private oldNodeBuilding: string,
    private newNodeBuilding: string,
    private edgeChanges: Array<{ id: string; oldWeight: number; newWeight: number; oldBuilding: string; newBuilding: string }>,
  ) {}
  execute(graph: NavGraph) {
    const node = graph.nodes[this.nodeId];
    if (!node) return;
    node.coordinates = this.newCoords;
    node.building = this.newNodeBuilding;
    for (const c of this.edgeChanges) {
      const edge = graph.edges.find(e => e.id === c.id);
      if (edge) { edge.weight = c.newWeight; edge.building = c.newBuilding; }
    }
  }
  undo(graph: NavGraph) {
    const node = graph.nodes[this.nodeId];
    if (!node) return;
    node.coordinates = this.oldCoords;
    node.building = this.oldNodeBuilding;
    for (const c of this.edgeChanges) {
      const edge = graph.edges.find(e => e.id === c.id);
      if (edge) { edge.weight = c.oldWeight; edge.building = c.oldBuilding; }
    }
  }
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
