// ===== Graph Service — Pathfinding & Route Building =====

import { NavGraph, NavNode, NavEdge, NavGraphExport } from '../editor/graphEditorTypes';
import { getDistanceBetweenCoordinatesInM } from '../utils/coordinateHelpers';
import * as BackendService from './backendService';

const GRAPH_JSON_URL = '/geojson/graph.json';

let graph: NavGraph | null = null;

// Adjacency list cache for Dijkstra
let adjacency: Map<string, { nodeId: string; weight: number }[]> = new Map();

// ===== Loading =====

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

function importGraph(data: NavGraphExport): NavGraph {
  const nodes: Record<string, NavNode> = {};
  for (const [id, raw] of Object.entries(data.nodes)) {
    const level = Array.isArray(raw.level) ? raw.level[0] : raw.level;
    nodes[id] = {
      id,
      coordinates: raw.coordinates,
      level,
      building: '',
      type: raw.type as NavNode['type'],
      label: raw.label ?? '',
    };
  }
  const edges: NavEdge[] = data.edges.map(e => ({
    id: `edge-${e.from}-${e.to}`,
    from: e.from,
    to: e.to,
    weight: e.weight,
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

/** Find a room node by its label (ref). Returns node ID or null. */
export function findRoomNode(ref: string, level: number): string | null {
  if (!graph) return null;
  for (const node of Object.values(graph.nodes)) {
    if (node.type === 'room' && node.label === ref && node.level === level) {
      return node.id;
    }
  }
  return null;
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

/** Find the nearest corridor/stairs node (room 타입 제외) */
function findNearestCorridorNode(coords: [number, number], level: number): string | null {
  if (!graph) return null;

  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const node of Object.values(graph.nodes)) {
    if (node.level !== level) continue;
    if (node.type === 'room') continue; // room 노드 제외
    const dist = getDistanceBetweenCoordinatesInM(coords, node.coordinates);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = node.id;
    }
  }

  return bestId;
}

// ===== Door Point (문 위치 근사) =====

/**
 * 방 폴리곤에서 복도 노드에 가장 가까운 변(segment)의 중점을 반환.
 *
 * 비교 기준: 복도 노드 → 선분까지 최소 거리 (point-to-segment distance).
 * 중점 거리가 아닌 선분 거리를 쓰는 이유:
 *   복도 노드가 방 중심에서 벗어나 있으면, 중점 비교 시 옆벽이
 *   복도 방향 벽보다 가깝게 잡혀 문이 건물 밖으로 향할 수 있음.
 *   선분 거리는 물리적으로 복도를 향하는 벽을 정확히 찾아냄.
 */
function findDoorPoint(polygon: number[][], corridorNodeCoords: [number, number]): [number, number] {
  let bestMidpoint: [number, number] = [polygon[0][0], polygon[0][1]];
  let bestDist = Infinity;

  const [px, py] = corridorNodeCoords;
  const n = polygon.length - 1;

  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[i + 1];

    // 복도 노드에서 이 선분까지 최소 거리 (point-to-segment)
    const dist = pointToSegmentDist(px, py, a[0], a[1], b[0], b[1]);

    if (dist < bestDist) {
      bestDist = dist;
      bestMidpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
  }

  return bestMidpoint;
}

/** Point (px,py) → segment (ax,ay)-(bx,by) 최소 거리 (유클리드, 경위도 소규모에서 충분) */
function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // 선분이 점으로 축퇴
    const ex = px - ax, ey = py - ay;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // t = 점 P를 선분 AB에 투영한 파라미터 (0~1로 클램프)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  const ex = px - closestX;
  const ey = py - closestY;
  return Math.sqrt(ex * ex + ey * ey);
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
function projectOntoNearestEdge(coords: [number, number], level: number): EdgeProjection | null {
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
  /** Ordered edges traversed, with direction flag */
  edgePath: { edge: NavEdge; forward: boolean }[];
  /** Whether start and end project onto the same edge */
  sameEdge: boolean;
  /** Trimmed node IDs after backtracking removal */
  trimmedPathNodeIds: string[];
}

/**
 * 방 ref → 방 ref 전체 경로 좌표 생성
 *
 * 경로 구조:
 *   [centroid] → [door] → [복도 진입점 (수선의 발)] → [corridor nodes...] → [복도 진입점] → [door] → [centroid]
 *
 * 수선의 발 덕분에 door에서 복도로 수직 진입 후 복도를 따라 이동하는 자연스러운 궤적.
 * Dijkstra는 edge의 양쪽 endpoint 4가지 조합 중 최단거리를 선택.
 */
export function buildFullRoute(fromRef: string, toRef: string): FullRouteResult | null {
  if (!graph) return null;

  // 1. 출발/도착 방 정보
  const fromCentroid = BackendService.getRoomCentroid(fromRef);
  const toCentroid = BackendService.getRoomCentroid(toRef);
  const fromLevel = BackendService.getRoomLevel(fromRef);
  const toLevel = BackendService.getRoomLevel(toRef);

  if (!fromCentroid || !toCentroid || fromLevel === null || toLevel === null) {
    console.warn('[GraphService] 방 정보를 찾을 수 없습니다:', fromRef, toRef);
    return null;
  }

  // 2. 문 위치: room 노드 좌표 또는 door 근사
  const fromRoomNodeId = findRoomNode(fromRef, fromLevel);
  const toRoomNodeId = findRoomNode(toRef, toLevel);

  let fromDoor: [number, number];
  if (fromRoomNodeId) {
    fromDoor = getNodeCoordinates(fromRoomNodeId)!;
  } else {
    const poly = BackendService.getRoomPolygon(fromRef);
    const nearest = findNearestCorridorNode(fromCentroid, fromLevel);
    fromDoor = poly && nearest ? findDoorPoint(poly, getNodeCoordinates(nearest)!) : fromCentroid;
  }

  let toDoor: [number, number];
  if (toRoomNodeId) {
    toDoor = getNodeCoordinates(toRoomNodeId)!;
  } else {
    const poly = BackendService.getRoomPolygon(toRef);
    const nearest = findNearestCorridorNode(toCentroid, toLevel);
    toDoor = poly && nearest ? findDoorPoint(poly, getNodeCoordinates(nearest)!) : toCentroid;
  }

  // 3. 복도 edge에 수직 투영 (수선의 발)
  const fromProj = projectOntoNearestEdge(fromDoor, fromLevel);
  const toProj = projectOntoNearestEdge(toDoor, toLevel);

  if (!fromProj || !toProj) {
    console.warn('[GraphService] 복도 edge를 찾을 수 없습니다');
    return null;
  }

  // 4. 같은 edge 위인지 확인
  const sameEdge =
    (fromProj.nodeA === toProj.nodeA && fromProj.nodeB === toProj.nodeB) ||
    (fromProj.nodeA === toProj.nodeB && fromProj.nodeB === toProj.nodeA);

  // 5. 좌표 + 층 정보 조립
  let pathNodeIds: string[] = [];
  let trimmedPath: string[] = [];
  const raw: GeoJSON.Position[] = [];
  const rawLevels: number[] = [];

  const pushCoord = (coord: GeoJSON.Position, level: number) => {
    raw.push(coord);
    rawLevels.push(level);
  };

  pushCoord(fromCentroid, fromLevel);
  pushCoord(fromDoor, fromLevel);
  pushCoord(fromProj.point, fromLevel);  // 복도 수직 진입점

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

  pushCoord(toProj.point, toLevel);    // 복도 수직 이탈점
  pushCoord(toDoor, toLevel);
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
  const edgePath: { edge: NavEdge; forward: boolean }[] = [];

  function findEdge(nA: string, nB: string): NavEdge | undefined {
    return graph!.edges.find(
      e => (e.from === nA && e.to === nB) || (e.from === nB && e.to === nA),
    );
  }

  if (sameEdge) {
    // Same edge: single edge from projection endpoints
    const e = findEdge(fromProj.nodeA, fromProj.nodeB);
    if (e) edgePath.push({ edge: e, forward: true }); // direction resolved in planner
  } else if (trimmedPath.length > 0) {
    // Start edge: from perpFoot → first trimmed node
    const firstNode = trimmedPath[0];
    const startEdge = findEdge(fromProj.nodeA, fromProj.nodeB);
    if (startEdge) {
      // forward = the first trimmed node is edge.to
      edgePath.push({ edge: startEdge, forward: startEdge.to === firstNode });
    }

    // Inter-node edges
    for (let i = 0; i < trimmedPath.length - 1; i++) {
      const nA = trimmedPath[i];
      const nB = trimmedPath[i + 1];
      const e = findEdge(nA, nB);
      if (e) edgePath.push({ edge: e, forward: e.from === nA });
    }

    // End edge: last trimmed node → perpFoot (only if different from start edge)
    const lastNode = trimmedPath[trimmedPath.length - 1];
    const endEdge = findEdge(toProj.nodeA, toProj.nodeB);
    if (endEdge && endEdge !== startEdge) {
      edgePath.push({ edge: endEdge, forward: endEdge.from === lastNode });
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

