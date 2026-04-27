// ===== Graph Service — Pathfinding & Route Building =====

import { NavGraph, NavNode, NavEdge, NavGraphExport } from '../editor/graphEditorTypes';
import { getDistanceBetweenCoordinatesInM } from '../utils/coordinateHelpers';
import { detectBuilding } from '../utils/buildingDetection';
import * as BackendService from './backendService';

const GRAPH_JSON_URL = '/geojson/graph.json';

let graph: NavGraph | null = null;

// Adjacency list cache for Dijkstra
let adjacency: Map<string, { nodeId: string; weight: number }[]> = new Map();

// ===== Loading =====

/** Replace graph data (used by API provider that fetches graph from backend) */
export function setGraph(newGraph: NavGraph): void {
  graph = newGraph;
  buildAdjacency();
}

export async function loadGraph(): Promise<void> {
  try {
    const res = await fetch(GRAPH_JSON_URL);
    if (!res.ok) throw new Error(`graph.json: ${res.status}`);
    const data = await res.json() as NavGraphExport;
    graph = importGraph(data);
    buildAdjacency();
  } catch (e) {
    console.warn('[GraphService] graph.json 로딩 실패:', e);
  }
}

function resolveEdgeBuilding(a: NavNode | undefined, b: NavNode | undefined): string {
  const ab = a?.building;
  const bb = b?.building;
  if (ab && bb) return ab === bb ? ab : 'outside';
  return ab ?? bb ?? 'outside';
}

function importGraph(data: NavGraphExport): NavGraph {
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
      ...(raw.verticalId !== undefined ? { verticalId: raw.verticalId } : {}),
    };
  }
  const edges: NavEdge[] = data.edges.map(e => ({
    id: `edge-${e.from}-${e.to}`,
    from: e.from,
    to: e.to,
    weight: e.weight,
    building: resolveEdgeBuilding(nodes[e.from], nodes[e.to]),
    videoFwd: e.videoFwd, videoFwdStart: e.videoFwdStart, videoFwdEnd: e.videoFwdEnd,
    videoFwdExit: e.videoFwdExit, videoFwdExitStart: e.videoFwdExitStart, videoFwdExitEnd: e.videoFwdExitEnd,
    videoRev: e.videoRev, videoRevStart: e.videoRevStart, videoRevEnd: e.videoRevEnd,
    videoRevExit: e.videoRevExit, videoRevExitStart: e.videoRevExitStart, videoRevExitEnd: e.videoRevExitEnd,
  }));
  return { nodes, edges };
}

function buildAdjacency(): void {
  adjacency = new Map();
  if (!graph) return;

  for (const node of Object.values(graph.nodes)) {
    adjacency.set(node.id, []);
  }

  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push({ nodeId: edge.to, weight: edge.weight });
    adjacency.get(edge.to)?.push({ nodeId: edge.from, weight: edge.weight });
  }
}

export function isLoaded(): boolean {
  return graph !== null;
}

export function getGraph(): NavGraph | null {
  return graph;
}

// ===== Node Queries =====

export function getNodeCoordinates(nodeId: string): [number, number] | null {
  return graph?.nodes[nodeId]?.coordinates ?? null;
}

export function getNodeLevel(nodeId: string): number | null {
  return graph?.nodes[nodeId]?.level ?? null;
}

/** Find the nearest graph node to a given coordinate on a specific level */
export function findNearestNode(coords: [number, number], level: number): string | null {
  if (!graph) return null;

  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const node of Object.values(graph.nodes)) {
    if (node.level !== level) continue;
    const dist = getDistanceBetweenCoordinatesInM(coords, node.coordinates);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = node.id;
    }
  }

  return bestId;
}

// ===== Dijkstra =====

interface DijkstraResult {
  path: string[];       // node IDs in order
  totalWeight: number;  // total distance in meters
}

function dijkstra(startId: string, endId: string): DijkstraResult | null {
  if (!graph || !adjacency.has(startId) || !adjacency.has(endId)) return null;

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();

  // Simple array-based priority queue (graph is small, ~30 nodes)
  const queue: { nodeId: string; dist: number }[] = [];

  for (const id of Object.keys(graph.nodes)) {
    dist.set(id, Infinity);
    prev.set(id, null);
  }

  dist.set(startId, 0);
  queue.push({ nodeId: startId, dist: 0 });

  while (queue.length > 0) {
    // Extract min
    queue.sort((a, b) => a.dist - b.dist);
    const current = queue.shift()!;

    if (visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);

    if (current.nodeId === endId) break;

    const neighbors = adjacency.get(current.nodeId) ?? [];
    for (const { nodeId: neighborId, weight } of neighbors) {
      if (visited.has(neighborId)) continue;

      const newDist = current.dist + weight;
      if (newDist < (dist.get(neighborId) ?? Infinity)) {
        dist.set(neighborId, newDist);
        prev.set(neighborId, current.nodeId);
        queue.push({ nodeId: neighborId, dist: newDist });
      }
    }
  }

  // Reconstruct path
  if (!visited.has(endId)) return null;

  const path: string[] = [];
  let cur: string | null = endId;
  while (cur !== null) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }

  return { path, totalWeight: dist.get(endId) ?? 0 };
}

// ===== Corridor Edge Projection =====

export interface EdgeProjection {
  point: [number, number];   // 수선의 발 (corridor edge 위의 투영점)
  nodeA: string;             // edge endpoint A
  nodeB: string;             // edge endpoint B
  distToA: number;           // projection → A 거리 (m)
  distToB: number;           // projection → B 거리 (m)
}

/**
 * 좌표에서 가장 가까운 corridor edge 위에 수직 투영 (수선의 발).
 * door에서 복도로 수직 진입하는 자연스러운 경로를 만듦.
 */
export function projectOntoNearestEdge(coords: [number, number], level: number): EdgeProjection | null {
  if (!graph) return null;

  let best: EdgeProjection | null = null;
  let bestDist = Infinity;
  const [px, py] = coords;

  for (const edge of graph.edges) {
    const nodeA = graph.nodes[edge.from];
    const nodeB = graph.nodes[edge.to];
    if (!nodeA || !nodeB) continue;
    if (nodeA.level !== level && nodeB.level !== level) continue;
    if (nodeA.type === 'room' || nodeB.type === 'room') continue;

    const [ax, ay] = nodeA.coordinates;
    const [bx, by] = nodeB.coordinates;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;

    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = ax + t * dx;
    const projY = ay + t * dy;
    const dist = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);

    if (dist < bestDist) {
      bestDist = dist;
      const projPoint: [number, number] = [projX, projY];
      best = {
        point: projPoint,
        nodeA: edge.from,
        nodeB: edge.to,
        distToA: getDistanceBetweenCoordinatesInM(projPoint, nodeA.coordinates),
        distToB: getDistanceBetweenCoordinatesInM(projPoint, nodeB.coordinates),
      };
    }
  }

  return best;
}

// ===== Full Route Building =====

export interface FullRouteResult {
  coordinates: GeoJSON.Position[];
  levels: number[];               // 각 좌표가 속한 층 (coordinates와 1:1 대응)
  pathNodeIds: string[];
  totalDistance: number;
  estimatedTime: string;
  startLevel: number;
  endLevel: number;
  /** Projection data for perpendicular foot at route start */
  fromProjection: EdgeProjection | null;
  /** Projection data for perpendicular foot at route end */
  toProjection: EdgeProjection | null;
  /** Ordered edges traversed, with direction flag and node refs */
  edgePath: { edge: NavEdge; forward: boolean; fromNode: NavNode; toNode: NavNode }[];
  /** Whether start and end project onto the same edge */
  sameEdge: boolean;
  /** Trimmed node IDs after backtracking removal */
  trimmedPathNodeIds: string[];
}

/**
 * 방 ref → 방 ref 전체 경로 좌표 생성
 *
 * 경로 구조:
 *   [centroid] → [복도 진입점 (수선의 발)] → [corridor nodes...] → [복도 진입점] → [centroid]
 *
 * Dijkstra는 edge의 양쪽 endpoint 4가지 조합 중 최단거리를 선택.
 */
export function buildFullRoute(fromRef: string, toRef: string): FullRouteResult | null {
  if (!graph) return null;

  const fromCentroid = BackendService.getRoomCentroid(fromRef);
  const toCentroid = BackendService.getRoomCentroid(toRef);
  const fromLevel = BackendService.getRoomLevel(fromRef);
  const toLevel = BackendService.getRoomLevel(toRef);

  if (!fromCentroid || !toCentroid || fromLevel === null || toLevel === null) {
    console.warn('[GraphService] 방 정보를 찾을 수 없습니다:', fromRef, toRef);
    return null;
  }

  const fromProj = projectOntoNearestEdge(fromCentroid, fromLevel);
  const toProj = projectOntoNearestEdge(toCentroid, toLevel);

  if (!fromProj || !toProj) {
    console.warn('[GraphService] 복도 edge를 찾을 수 없습니다');
    return null;
  }

  const sameEdge =
    (fromProj.nodeA === toProj.nodeA && fromProj.nodeB === toProj.nodeB) ||
    (fromProj.nodeA === toProj.nodeB && fromProj.nodeB === toProj.nodeA);

  let pathNodeIds: string[] = [];
  let trimmedPath: string[] = [];
  const raw: GeoJSON.Position[] = [];
  const rawLevels: number[] = [];

  const pushCoord = (coord: GeoJSON.Position, level: number) => {
    raw.push(coord);
    rawLevels.push(level);
  };

  pushCoord(fromCentroid, fromLevel);
  pushCoord(fromProj.point, fromLevel);

  if (sameEdge) {
    // 같은 corridor edge 위 → Dijkstra 불필요, 직접 연결
  } else {
    // Dijkstra: 양쪽 edge endpoint 4가지 조합 중 최단 선택
    const fromEndpoints = [
      { id: fromProj.nodeA, dist: fromProj.distToA },
      { id: fromProj.nodeB, dist: fromProj.distToB },
    ];
    const toEndpoints = [
      { id: toProj.nodeA, dist: toProj.distToA },
      { id: toProj.nodeB, dist: toProj.distToB },
    ];

    let bestResult: DijkstraResult | null = null;
    let bestTotal = Infinity;

    for (const fep of fromEndpoints) {
      for (const tep of toEndpoints) {
        const result = dijkstra(fep.id, tep.id);
        if (!result) continue;
        const total = fep.dist + result.totalWeight + tep.dist;
        if (total < bestTotal) {
          bestTotal = total;
          bestResult = result;
        }
      }
    }

    if (!bestResult) {
      console.warn('[GraphService] 경로를 찾을 수 없습니다');
      return null;
    }

    // 백트래킹 방지
    const path = bestResult.path;
    let pathStart = 0;
    let pathEnd = path.length;

    if (path.length >= 2) {
      const fromEdgeIds = new Set([fromProj.nodeA, fromProj.nodeB]);
      if (fromEdgeIds.has(path[0]) && fromEdgeIds.has(path[1])) {
        pathStart = 1;
      }
    }

    if (path.length >= 2) {
      const toEdgeIds = new Set([toProj.nodeA, toProj.nodeB]);
      if (toEdgeIds.has(path[path.length - 1]) && toEdgeIds.has(path[path.length - 2])) {
        pathEnd = path.length - 1;
      }
    }

    pathNodeIds = bestResult.path;
    trimmedPath = path.slice(pathStart, pathEnd);
    for (let i = pathStart; i < pathEnd; i++) {
      const node = graph!.nodes[path[i]];
      if (node) pushCoord(node.coordinates, node.level);
    }
  }

  pushCoord(toProj.point, toLevel);
  pushCoord(toCentroid, toLevel);

  // 연속 중복 좌표 제거 (~1m 이내 근접점)
  const coordinates: GeoJSON.Position[] = [raw[0]];
  const levels: number[] = [rawLevels[0]];
  const MIN_GAP = 0.000009;
  for (let i = 1; i < raw.length; i++) {
    const prev = coordinates[coordinates.length - 1];
    const cur = raw[i];
    const dx = cur[0] - prev[0], dy = cur[1] - prev[1];
    if (dx * dx + dy * dy > MIN_GAP * MIN_GAP) {
      coordinates.push(cur);
      levels.push(rawLevels[i]);
    }
  }

  // 6. 총 거리
  let totalDistance = 0;
  for (let i = 1; i < coordinates.length; i++) {
    totalDistance += getDistanceBetweenCoordinatesInM(coordinates[i - 1], coordinates[i]);
  }
  totalDistance = Math.round(totalDistance);

  const minutes = Math.max(1, Math.round(totalDistance / 72));
  const estimatedTime = `${minutes}분`;

  // Build edgePath: all edges traversed in order
  // Structure: [fromProj edge] → [inter-node edges...] → [toProj edge]
  const edgePath: FullRouteResult['edgePath'] = [];

  function findEdge(nA: string, nB: string): NavEdge | undefined {
    return graph!.edges.find(
      e => (e.from === nA && e.to === nB) || (e.from === nB && e.to === nA),
    );
  }

  if (sameEdge || trimmedPath.length === 0) {
    // Same edge or trimmed to empty (both ends on adjacent edges) — single edge
    const e = findEdge(fromProj.nodeA, fromProj.nodeB);
    if (e) edgePath.push({ edge: e, forward: true, fromNode: graph!.nodes[e.from], toNode: graph!.nodes[e.to] }); // direction resolved in planner
  } else {
    // trimmedPath.length > 0 guaranteed here
    // Start edge: from perpFoot → first trimmed node
    const firstNode = trimmedPath[0];
    const startEdge = findEdge(fromProj.nodeA, fromProj.nodeB);
    if (startEdge) {
      // forward = the first trimmed node is edge.to
      edgePath.push({ edge: startEdge, forward: startEdge.to === firstNode, fromNode: graph!.nodes[startEdge.from], toNode: graph!.nodes[startEdge.to] });
    }

    // Inter-node edges
    for (let i = 0; i < trimmedPath.length - 1; i++) {
      const nA = trimmedPath[i];
      const nB = trimmedPath[i + 1];
      const e = findEdge(nA, nB);
      if (e) edgePath.push({ edge: e, forward: e.from === nA, fromNode: graph!.nodes[e.from], toNode: graph!.nodes[e.to] });
    }

    // End edge: last trimmed node → perpFoot (only if different from start edge)
    const lastNode = trimmedPath[trimmedPath.length - 1];
    const endEdge = findEdge(toProj.nodeA, toProj.nodeB);
    if (endEdge && endEdge.id !== startEdge?.id) {
      edgePath.push({ edge: endEdge, forward: endEdge.from === lastNode, fromNode: graph!.nodes[endEdge.from], toNode: graph!.nodes[endEdge.to] });
    }
  }

  return {
    coordinates,
    levels,
    pathNodeIds,
    totalDistance,
    estimatedTime,
    startLevel: fromLevel,
    endLevel: toLevel,
    fromProjection: fromProj,
    toProjection: toProj,
    edgePath,
    sameEdge,
    trimmedPathNodeIds: trimmedPath,
  };
}

