// ===== Local Route Provider — Simulates backend API using local graph.json =====
//
// Produces the same ApiRouteResult shape that the backend POST /api/route returns.
// Used for offline development / when backend is not running.

import * as GraphService from '../graphService';
import * as BackendService from '../backendService';
import type { FullRouteResult, EdgeProjection } from '../graphService';
import type { NavEdge, NavNode } from '../../editor/graphEditorTypes';
import type { RoomListItem } from '../../models/types';
import type { ApiRouteResult, ApiRouteClip, RouteCoordinate } from '../api/apiRoute';
import { getDistanceBetweenCoordinatesInM } from '../../utils/coordinateHelpers';
import { computeStairVideos, computeElevatorVideos, STAIR_CLIP_DURATION, ELEVATOR_CLIP_DURATION } from '../../utils/verticalVideoFilename';
import * as VideoSettings from '../../editor/videoSettings';

export async function init(): Promise<void> {
  await GraphService.loadGraph();
}

/**
 * Find route between two coordinates locally.
 * Simulates the backend POST /api/route response.
 */
export function findRoute(from: RouteCoordinate, to: RouteCoordinate): ApiRouteResult | null {
  // 1. Find nearest room for each coordinate
  const fromRef = findNearestRoomRef(from);
  const toRef = findNearestRoomRef(to);
  if (!fromRef || !toRef) {
    console.warn('[LocalRoute] Room not found for coordinates:', from, to);
    return null;
  }

  // 2. Run graph-based pathfinding
  const fullResult = GraphService.buildFullRoute(fromRef, toRef);
  if (!fullResult) return null;

  // 3. Convert FullRouteResult → ApiRouteResult (same shape as backend response)
  return convertToApiResult(fullResult);
}

export function searchRooms(query: string): RoomListItem[] {
  return BackendService.searchRooms(query);
}

// ===== Helpers =====

/** Find the nearest room ref to a coordinate by distance */
function findNearestRoomRef(coord: RouteCoordinate): string | null {
  const rooms = BackendService.getRoomList();
  let bestRef: string | null = null;
  let bestDist = Infinity;

  for (const room of rooms) {
    // Filter by level
    if (!room.level.includes(coord.level)) continue;

    const centroid = BackendService.getRoomCentroid(room.ref);
    if (!centroid) continue;

    const dist = getDistanceBetweenCoordinatesInM([coord.lng, coord.lat], centroid);
    if (dist < bestDist) {
      bestDist = dist;
      bestRef = room.ref;
    }
  }

  return bestRef;
}

/**
 * Convert FullRouteResult (graph-internal) → ApiRouteResult (API-shaped).
 * Builds the clips array using the same logic the backend would use.
 */
function convertToApiResult(route: FullRouteResult): ApiRouteResult {
  const { coordinates, levels, fromProjection, toProjection } = route;

  // Build cumulative distance
  const cumulativeDist = buildCumulativeDist(coordinates);

  // Find video zone indices
  const videoStartCoordIdx = findCoordIndex(coordinates, fromProjection?.point);
  const videoEndCoordIdx = findCoordIndex(coordinates, toProjection?.point, true);

  // Build clips from edgePath
  const clips = buildClips(route, cumulativeDist, videoStartCoordIdx, videoEndCoordIdx);

  return {
    coordinates,
    levels,
    totalDistance: route.totalDistance,
    estimatedTime: route.estimatedTime,
    startLevel: route.startLevel,
    endLevel: route.endLevel,
    clips,
    videoStartCoordIdx,
    videoEndCoordIdx,
  };
}

// ===== Clip building (replicates backend logic) =====

function buildClips(
  route: FullRouteResult,
  cumulativeDist: number[],
  videoStartCoordIdx: number,
  videoEndCoordIdx: number,
): ApiRouteClip[] {
  const { coordinates, edgePath, fromProjection, toProjection, sameEdge } = route;
  const clips: ApiRouteClip[] = [];

  if (sameEdge && fromProjection && toProjection) {
    const clip = buildSameEdgeClip(route, videoStartCoordIdx, videoEndCoordIdx, cumulativeDist);
    if (clip) clips.push(clip);
    return clips;
  }

  const nodeToCoord = buildNodeToCoordMap(edgePath, coordinates, videoStartCoordIdx, videoEndCoordIdx);

  for (let i = 0; i < edgePath.length; i++) {
    const { edge, forward, fromNode, toNode } = edgePath[i];
    const isFirst = i === 0;
    const isLast = i === edgePath.length - 1;

    const edgeCoordStart = isFirst ? videoStartCoordIdx : getEdgeCoordStart(i, edgePath, nodeToCoord, videoStartCoordIdx);
    const edgeCoordEnd = isLast ? videoEndCoordIdx : getEdgeCoordEnd(i, edgePath, nodeToCoord, videoEndCoordIdx);

    // Vertical edges (stairs/elevator)
    const isVerticalStairs = fromNode.type === 'stairs' && toNode.type === 'stairs';
    const isVerticalElev = fromNode.type === 'elevator' && toNode.type === 'elevator';

    if (isVerticalStairs || isVerticalElev) {
      const vertType = isVerticalStairs ? 'stairs' : 'elevator';
      const fNode0 = forward ? fromNode : toNode;
      const tNode0 = forward ? toNode : fromNode;
      const vId = fNode0.verticalId ?? tNode0.verticalId;
      if (vId === undefined) continue;
      const building = fNode0.building || tNode0.building;

      // Group consecutive vertical edges of same type/id
      let groupEnd = i;
      for (let j = i + 1; j < edgePath.length; j++) {
        const ej = edgePath[j];
        const sameStairs = ej.fromNode.type === 'stairs' && ej.toNode.type === 'stairs' && vertType === 'stairs';
        const sameElev = ej.fromNode.type === 'elevator' && ej.toNode.type === 'elevator' && vertType === 'elevator';
        if (!sameStairs && !sameElev) break;
        if ((ej.fromNode.verticalId ?? ej.toNode.verticalId) !== vId) break;
        groupEnd = j;
      }

      // Entry clip
      const firstResult = isVerticalStairs
        ? computeStairVideos(building, vId, fNode0.level, tNode0.level)
        : computeElevatorVideos(building, vId, fNode0.level, tNode0.level);
      const clipDur = isVerticalStairs ? STAIR_CLIP_DURATION : ELEVATOR_CLIP_DURATION;
      const entrySettings = VideoSettings.getEntry(firstResult.entryVideo);
      const entryYaw = entrySettings?.yaw ?? entrySettings?.entryYaw ?? 0;

      clips.push({
        index: clips.length,
        videoFile: firstResult.entryVideo,
        videoStart: 0,
        videoEnd: clipDur,
        duration: clipDur,
        yaw: entryYaw,
        level: route.levels[edgeCoordStart] ?? route.startLevel,
        isExitClip: false,
        coordStartIdx: edgeCoordStart,
        coordEndIdx: edgeCoordEnd,
        routeDistStart: cumulativeDist[edgeCoordStart],
        routeDistEnd: cumulativeDist[edgeCoordEnd],
      });

      // Exit clip
      const lastEntry = edgePath[groupEnd];
      const lastFwd = lastEntry.forward;
      const lastFNode = lastFwd ? lastEntry.fromNode : lastEntry.toNode;
      const lastTNode = lastFwd ? lastEntry.toNode : lastEntry.fromNode;
      const lastCoordEnd = groupEnd === edgePath.length - 1
        ? videoEndCoordIdx
        : getEdgeCoordEnd(groupEnd, edgePath, nodeToCoord, videoEndCoordIdx);

      const lastResult = isVerticalStairs
        ? computeStairVideos(building, vId, lastFNode.level, lastTNode.level)
        : computeElevatorVideos(building, vId, lastFNode.level, lastTNode.level);
      const exitSettings = VideoSettings.getEntry(lastResult.exitVideo);
      const exitYaw = exitSettings?.yaw ?? exitSettings?.exitYaw ?? 0;

      clips.push({
        index: clips.length,
        videoFile: lastResult.exitVideo,
        videoStart: 0,
        videoEnd: clipDur,
        duration: clipDur,
        yaw: exitYaw,
        level: route.levels[lastCoordEnd] ?? route.startLevel,
        isExitClip: true,
        coordStartIdx: lastCoordEnd,
        coordEndIdx: lastCoordEnd,
        routeDistStart: cumulativeDist[lastCoordEnd],
        routeDistEnd: cumulativeDist[lastCoordEnd],
      });

      i = groupEnd; // skip grouped edges
    } else {
      // Corridor edge
      const videoFile = forward ? edge.videoFwd : edge.videoRev;
      const videoStart = forward ? edge.videoFwdStart : edge.videoRevStart;
      const videoEnd = forward ? edge.videoFwdEnd : edge.videoRevEnd;

      if (!videoFile || videoStart == null || videoEnd == null) continue;

      let clipStart = videoStart;
      let clipEnd = videoEnd;

      if (isFirst && fromProjection) {
        clipStart = computePartialTime(fromProjection, edge, forward, videoStart, videoEnd);
      }
      if (isLast && toProjection) {
        clipEnd = computePartialTime(toProjection, edge, forward, videoStart, videoEnd);
      }
      if (clipStart > clipEnd) [clipStart, clipEnd] = [clipEnd, clipStart];

      const clipDuration = Math.max(0, clipEnd - clipStart);
      if (clipDuration <= 0) continue;

      const settings = VideoSettings.getEntry(videoFile);
      const yaw = settings?.yaw ?? settings?.entryYaw ?? 0;

      clips.push({
        index: clips.length,
        videoFile,
        videoStart: clipStart,
        videoEnd: clipEnd,
        duration: clipDuration,
        yaw,
        level: route.levels[edgeCoordStart] ?? route.startLevel,
        isExitClip: false,
        coordStartIdx: edgeCoordStart,
        coordEndIdx: edgeCoordEnd,
        routeDistStart: cumulativeDist[edgeCoordStart],
        routeDistEnd: cumulativeDist[edgeCoordEnd],
      });
    }
  }

  return clips;
}

function buildSameEdgeClip(
  route: FullRouteResult,
  videoStartCoordIdx: number,
  videoEndCoordIdx: number,
  cumulativeDist: number[],
): ApiRouteClip | null {
  const { fromProjection, toProjection, edgePath } = route;
  if (!fromProjection || !toProjection || edgePath.length === 0) return null;

  const edge = edgePath[0].edge;
  const totalDist = fromProjection.distToA + fromProjection.distToB;
  if (totalDist === 0) return null;

  const startT = fromProjection.distToA / totalDist;
  const endT = toProjection.distToA / totalDist;
  const forward = startT < endT;

  const videoFile = forward ? edge.videoFwd : edge.videoRev;
  const fullStart = (forward ? edge.videoFwdStart : edge.videoRevStart) ?? 0;
  const fullEnd = (forward ? edge.videoFwdEnd : edge.videoRevEnd) ?? 0;
  if (!videoFile) return null;

  const clipStart = forward
    ? fullStart + startT * (fullEnd - fullStart)
    : fullStart + (1 - startT) * (fullEnd - fullStart);
  const clipEnd = forward
    ? fullStart + endT * (fullEnd - fullStart)
    : fullStart + (1 - endT) * (fullEnd - fullStart);

  const actualStart = Math.min(clipStart, clipEnd);
  const actualEnd = Math.max(clipStart, clipEnd);

  const settings = VideoSettings.getEntry(videoFile);
  const yaw = settings?.yaw ?? settings?.entryYaw ?? 0;

  return {
    index: 0,
    videoFile,
    videoStart: actualStart,
    videoEnd: actualEnd,
    duration: actualEnd - actualStart,
    yaw,
    level: route.startLevel,
    isExitClip: false,
    coordStartIdx: videoStartCoordIdx,
    coordEndIdx: videoEndCoordIdx,
    routeDistStart: cumulativeDist[videoStartCoordIdx],
    routeDistEnd: cumulativeDist[videoEndCoordIdx],
  };
}

// ===== Utility functions =====

function buildCumulativeDist(coordinates: GeoJSON.Position[]): number[] {
  const dist = [0];
  for (let i = 1; i < coordinates.length; i++) {
    dist.push(dist[i - 1] + getDistanceBetweenCoordinatesInM(coordinates[i - 1], coordinates[i]));
  }
  return dist;
}

function findCoordIndex(
  coordinates: GeoJSON.Position[],
  point: [number, number] | undefined | null,
  fromEnd = false,
): number {
  if (!point) return fromEnd ? coordinates.length - 1 : 0;
  let bestIdx = fromEnd ? coordinates.length - 1 : 0;
  let bestDist = Infinity;
  const start = fromEnd ? coordinates.length - 1 : 0;
  const end = fromEnd ? -1 : coordinates.length;
  const step = fromEnd ? -1 : 1;
  for (let i = start; i !== end; i += step) {
    const dx = coordinates[i][0] - point[0];
    const dy = coordinates[i][1] - point[1];
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

function buildNodeToCoordMap(
  edgePath: { edge: NavEdge; forward: boolean; fromNode: NavNode; toNode: NavNode }[],
  coordinates: GeoJSON.Position[],
  videoStartCoordIdx: number,
  videoEndCoordIdx: number,
): Map<string, number> {
  const map = new Map<string, number>();
  const nodeIds = new Set<string>();
  for (const { edge } of edgePath) { nodeIds.add(edge.from); nodeIds.add(edge.to); }

  const loIdx = Math.min(videoStartCoordIdx, videoEndCoordIdx);
  const hiIdx = Math.max(videoStartCoordIdx, videoEndCoordIdx);

  for (const nodeId of nodeIds) {
    const nodeCoords = GraphService.getNodeCoordinates(nodeId);
    if (!nodeCoords) continue;
    let bestIdx = -1, bestDist = Infinity;
    for (let i = loIdx; i <= hiIdx; i++) {
      const dx = coordinates[i][0] - nodeCoords[0];
      const dy = coordinates[i][1] - nodeCoords[1];
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx >= 0) map.set(nodeId, bestIdx);
  }
  return map;
}

function getEdgeCoordStart(
  edgeIdx: number,
  edgePath: { edge: NavEdge; forward: boolean }[],
  nodeToCoord: Map<string, number>,
  fallback: number,
): number {
  const prevEntry = edgePath[edgeIdx - 1];
  const prevDest = prevEntry.forward ? prevEntry.edge.to : prevEntry.edge.from;
  return nodeToCoord.get(prevDest) ?? fallback;
}

function getEdgeCoordEnd(
  edgeIdx: number,
  edgePath: { edge: NavEdge; forward: boolean }[],
  nodeToCoord: Map<string, number>,
  fallback: number,
): number {
  const curEntry = edgePath[edgeIdx];
  const dest = curEntry.forward ? curEntry.edge.to : curEntry.edge.from;
  return nodeToCoord.get(dest) ?? fallback;
}

function computePartialTime(
  projection: EdgeProjection,
  _edge: NavEdge,
  forward: boolean,
  fullStart: number,
  fullEnd: number,
): number {
  const totalDist = projection.distToA + projection.distToB;
  if (totalDist === 0) return fullStart;
  if (forward) {
    const t = projection.distToA / totalDist;
    return fullStart + t * (fullEnd - fullStart);
  } else {
    const t = projection.distToB / totalDist;
    return fullStart + t * (fullEnd - fullStart);
  }
}
