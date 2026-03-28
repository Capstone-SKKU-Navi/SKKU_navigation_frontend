// ===== Walkthrough Planner — Route → Video Clip Playlist =====

import type { NavEdge } from '../editor/graphEditorTypes';
import type { FullRouteResult, EdgeProjection } from './graphService';
import { getNodeCoordinates } from './graphService';
import { getDistanceBetweenCoordinatesInM } from '../utils/coordinateHelpers';
import * as VideoSettings from '../editor/videoSettings';
import type { WalkthroughClip, WalkthroughPlaylist, VideoSegment } from '../components/walkthroughTypes';

const TIME_EPSILON = 0.05; // seconds — clips within this gap are "contiguous"

/**
 * Build a walkthrough playlist from a full route result.
 * Returns null if no video clips can be assembled.
 */
export function buildWalkthroughPlaylist(
  route: FullRouteResult,
): WalkthroughPlaylist | null {
  const { coordinates, levels, edgePath, fromProjection, toProjection, sameEdge } = route;

  // 1. Cumulative distance array
  const cumulativeDist = buildCumulativeDist(coordinates);

  // 2. Identify video zone coordinate indices
  //    Route structure: [centroid, door, perpFoot, ...graphNodes..., perpFoot, door, centroid]
  //    After dedup, perpFoot is around index 2. We find it by matching fromProjection.point.
  const videoStartCoordIdx = findCoordIndex(coordinates, fromProjection?.point);
  const videoEndCoordIdx = findCoordIndex(coordinates, toProjection?.point, true);

  // 3. Build raw clips from edge path
  const rawClips: Omit<WalkthroughClip, 'index' | 'globalStart' | 'globalEnd' | 'contiguous'>[] = [];

  if (sameEdge && fromProjection && toProjection) {
    // Same-edge case: single partial clip
    const clip = buildSameEdgeClip(route, videoStartCoordIdx, videoEndCoordIdx, cumulativeDist);
    if (clip) rawClips.push(clip);
  } else {
    // Build coordinate lookup robust against dedup
    const nodeToCoord = buildNodeToCoordMap(edgePath, coordinates, videoStartCoordIdx, videoEndCoordIdx);

    // Multi-edge case
    for (let i = 0; i < edgePath.length; i++) {
      const { edge, forward } = edgePath[i];
      const isFirst = i === 0;
      const isLast = i === edgePath.length - 1;

      // Determine coordinate indices for this edge (robust against coordinate dedup)
      const edgeCoordStart = getEdgeCoordStart(i, edgePath, nodeToCoord, videoStartCoordIdx);
      const edgeCoordEnd = getEdgeCoordEnd(i, edgePath, nodeToCoord, videoEndCoordIdx);

      // Get video info for this direction
      const videoFile = forward ? edge.videoFwd : edge.videoRev;
      const videoStart = forward ? edge.videoFwdStart : edge.videoRevStart;
      const videoEnd = forward ? edge.videoFwdEnd : edge.videoRevEnd;
      const exitFile = forward ? edge.videoFwdExit : edge.videoRevExit;
      const exitStart = forward ? edge.videoFwdExitStart : edge.videoRevExitStart;
      const exitEnd = forward ? edge.videoFwdExitEnd : edge.videoRevExitEnd;

      if (!videoFile || videoStart == null || videoEnd == null) continue;

      let clipStart = videoStart;
      let clipEnd = videoEnd;

      // Handle partial first edge (from perpendicular foot)
      if (isFirst && fromProjection) {
        clipStart = computePartialTime(fromProjection, edge, forward, videoStart, videoEnd);
      }

      // Handle partial last edge (to perpendicular foot)
      if (isLast && toProjection) {
        clipEnd = computePartialTime(toProjection, edge, forward, videoStart, videoEnd);
      }

      // Ensure clipStart <= clipEnd (partial edges can invert)
      if (clipStart > clipEnd) [clipStart, clipEnd] = [clipEnd, clipStart];

      // Determine level from the start coordinate of this edge
      const level = route.levels[edgeCoordStart] ?? route.startLevel;

      // Get yaw from video settings
      const settings = VideoSettings.getEntry(videoFile);
      const yaw = settings?.yaw ?? settings?.entryYaw ?? 0;

      const clipDuration = Math.max(0, clipEnd - clipStart);
      if (clipDuration <= 0) continue; // skip zero-length clips

      rawClips.push({
        videoFile,
        videoStart: clipStart,
        videoEnd: clipEnd,
        duration: clipDuration,
        yaw,
        level,
        isExitClip: false,
        edgeId: edge.id,
        coordStartIdx: edgeCoordStart,
        coordEndIdx: edgeCoordEnd,
        routeDistStart: cumulativeDist[edgeCoordStart],
        routeDistEnd: cumulativeDist[edgeCoordEnd],
      });

      // Handle stairs/elevator exit clip
      if (exitFile && exitStart != null && exitEnd != null) {
        const exitSettings = VideoSettings.getEntry(exitFile);
        const exitYaw = exitSettings?.exitYaw ?? exitSettings?.yaw ?? yaw;
        // Exit clip is on the arrival floor (destination side of the edge)
        const exitLevel = route.levels[edgeCoordEnd] ?? level;
        rawClips.push({
          videoFile: exitFile,
          videoStart: exitStart,
          videoEnd: exitEnd,
          duration: exitEnd - exitStart,
          yaw: exitYaw,
          level: exitLevel,
          isExitClip: true,
          edgeId: edge.id,
          coordStartIdx: edgeCoordEnd,
          coordEndIdx: edgeCoordEnd,
          routeDistStart: cumulativeDist[edgeCoordEnd],
          routeDistEnd: cumulativeDist[edgeCoordEnd],
        });
      }
    }
  }

  if (rawClips.length === 0) return null;

  // 4. Assign global times and detect contiguous clips
  const clips: WalkthroughClip[] = [];
  let globalTime = 0;

  for (let i = 0; i < rawClips.length; i++) {
    const raw = rawClips[i];
    const prev = i > 0 ? rawClips[i - 1] : null;
    const contiguous = prev != null
      && prev.videoFile === raw.videoFile
      && Math.abs(prev.videoEnd - raw.videoStart) < TIME_EPSILON;

    clips.push({
      ...raw,
      index: i,
      globalStart: globalTime,
      globalEnd: globalTime + raw.duration,
      contiguous,
    });
    globalTime += raw.duration;
  }

  const totalDuration = globalTime;

  // 5. Build video segments (group contiguous clips on the same file)
  const segments = buildSegments(clips);

  // 6. Segment boundaries for progress bar
  const segmentBoundaries: number[] = [];
  for (const clip of clips) {
    if (clip.index > 0) {
      segmentBoundaries.push(clip.globalStart / totalDuration);
    }
  }

  return {
    clips,
    segments,
    totalDuration,
    coordinates,
    levels,
    cumulativeDist,
    videoStartCoordIdx,
    videoEndCoordIdx,
    segmentBoundaries,
  };
}

// ===== Position Interpolation =====

/**
 * Given a global playback time, return the interpolated position along the route.
 */
export function getPositionAtTime(
  playlist: WalkthroughPlaylist,
  globalTime: number,
): { position: GeoJSON.Position; level: number } | null {
  const { clips, coordinates, levels, cumulativeDist } = playlist;
  if (clips.length === 0) return null;

  // Clamp time
  const t = Math.max(0, Math.min(playlist.totalDuration, globalTime));

  // Find the active clip
  let clip = clips[clips.length - 1];
  for (const c of clips) {
    if (t < c.globalEnd) { clip = c; break; }
  }

  // Fraction within the clip
  const clipFrac = clip.duration > 0 ? (t - clip.globalStart) / clip.duration : 0;

  // Map to route distance
  const routeDist = clip.routeDistStart + clipFrac * (clip.routeDistEnd - clip.routeDistStart);

  // Interpolate position along route polyline
  return interpolateAlongRoute(coordinates, levels, cumulativeDist, routeDist);
}

/**
 * Given a normalized progress (0..1), return the global time.
 */
export function progressToGlobalTime(playlist: WalkthroughPlaylist, progress: number): number {
  return Math.max(0, Math.min(1, progress)) * playlist.totalDuration;
}

// ===== Internal helpers =====

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
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Build a mapping from graph node IDs to their nearest coordinate index
 * within the video zone. This is robust against coordinate deduplication
 * which can remove nodes that are too close together.
 */
function buildNodeToCoordMap(
  edgePath: { edge: NavEdge; forward: boolean }[],
  coordinates: GeoJSON.Position[],
  videoStartCoordIdx: number,
  videoEndCoordIdx: number,
): Map<string, number> {
  const map = new Map<string, number>();

  // Collect all unique node IDs referenced by edges
  const nodeIds = new Set<string>();
  for (const { edge } of edgePath) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }

  const loIdx = Math.min(videoStartCoordIdx, videoEndCoordIdx);
  const hiIdx = Math.max(videoStartCoordIdx, videoEndCoordIdx);

  for (const nodeId of nodeIds) {
    const nodeCoords = getNodeCoordinates(nodeId);
    if (!nodeCoords) continue;

    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = loIdx; i <= hiIdx; i++) {
      const dx = coordinates[i][0] - nodeCoords[0];
      const dy = coordinates[i][1] - nodeCoords[1];
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      map.set(nodeId, bestIdx);
    }
  }

  return map;
}

function getEdgeCoordStart(
  edgeIdx: number,
  edgePath: { edge: NavEdge; forward: boolean }[],
  nodeToCoord: Map<string, number>,
  videoStartCoordIdx: number,
): number {
  if (edgeIdx === 0) return videoStartCoordIdx;
  // Start of edge i = destination node of edge i-1
  const prevEntry = edgePath[edgeIdx - 1];
  const prevDest = prevEntry.forward ? prevEntry.edge.to : prevEntry.edge.from;
  const idx = nodeToCoord.get(prevDest);
  if (idx === undefined) console.warn('[WalkthroughPlanner] coord miss for node', prevDest);
  return idx ?? videoStartCoordIdx;
}

function getEdgeCoordEnd(
  edgeIdx: number,
  edgePath: { edge: NavEdge; forward: boolean }[],
  nodeToCoord: Map<string, number>,
  videoEndCoordIdx: number,
): number {
  if (edgeIdx === edgePath.length - 1) return videoEndCoordIdx;
  // End of edge i = destination node of edge i
  const curEntry = edgePath[edgeIdx];
  const dest = curEntry.forward ? curEntry.edge.to : curEntry.edge.from;
  const idx = nodeToCoord.get(dest);
  if (idx === undefined) console.warn('[WalkthroughPlanner] coord miss for node', dest);
  return idx ?? videoEndCoordIdx;
}

/**
 * Compute the video time at a perpendicular foot projection point.
 * The foot divides the edge at ratio t = distToA / (distToA + distToB).
 */
function computePartialTime(
  projection: EdgeProjection,
  edge: NavEdge,
  forward: boolean,
  fullStart: number,
  fullEnd: number,
): number {
  const totalDist = projection.distToA + projection.distToB;
  if (totalDist === 0) return fullStart;

  if (forward) {
    // Walking from→to. Projection is distToA from node 'from' (nodeA).
    // Video time progresses from fullStart (at from) to fullEnd (at to).
    const t = projection.distToA / totalDist;
    return fullStart + t * (fullEnd - fullStart);
  } else {
    // Walking to→from (reverse). Video plays from→to perspective reversed.
    // distToB = distance from projection to edge.to
    const t = projection.distToB / totalDist;
    return fullStart + t * (fullEnd - fullStart);
  }
}

function interpolateAlongRoute(
  coordinates: GeoJSON.Position[],
  levels: number[],
  cumulativeDist: number[],
  targetDist: number,
): { position: GeoJSON.Position; level: number } {
  const total = cumulativeDist[cumulativeDist.length - 1];
  const d = Math.max(0, Math.min(total, targetDist));

  for (let i = 0; i < cumulativeDist.length - 1; i++) {
    if (d <= cumulativeDist[i + 1]) {
      const segLen = cumulativeDist[i + 1] - cumulativeDist[i];
      const t = segLen > 0 ? (d - cumulativeDist[i]) / segLen : 0;
      const lng = coordinates[i][0] + t * (coordinates[i + 1][0] - coordinates[i][0]);
      const lat = coordinates[i][1] + t * (coordinates[i + 1][1] - coordinates[i][1]);
      return { position: [lng, lat], level: levels[i] };
    }
  }

  return {
    position: coordinates[coordinates.length - 1],
    level: levels[levels.length - 1],
  };
}

function buildSameEdgeClip(
  route: FullRouteResult,
  videoStartCoordIdx: number,
  videoEndCoordIdx: number,
  cumulativeDist: number[],
): Omit<WalkthroughClip, 'index' | 'globalStart' | 'globalEnd' | 'contiguous'> | null {
  const { fromProjection, toProjection, edgePath } = route;
  if (!fromProjection || !toProjection || edgePath.length === 0) return null;

  // Find the edge from the graph (sameEdge means both projections are on it)
  // Use the first matching edge between the projection's nodes
  const edge = edgePath.length > 0 ? edgePath[0].edge : null;
  if (!edge) return null;

  // Determine direction: walk from startFoot toward endFoot
  // Both are on the same edge, so we check which direction covers startFoot→endFoot
  const totalDist = fromProjection.distToA + fromProjection.distToB;
  if (totalDist === 0) return null;

  const startT = fromProjection.distToA / totalDist;
  const endT = toProjection.distToA / totalDist;

  // If startT < endT, we walk from→to (forward), else reverse
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
    videoFile,
    videoStart: actualStart,
    videoEnd: actualEnd,
    duration: actualEnd - actualStart,
    yaw,
    level: route.startLevel,
    isExitClip: false,
    edgeId: edge.id,
    coordStartIdx: videoStartCoordIdx,
    coordEndIdx: videoEndCoordIdx,
    routeDistStart: cumulativeDist[videoStartCoordIdx],
    routeDistEnd: cumulativeDist[videoEndCoordIdx],
  };
}

function buildSegments(clips: WalkthroughClip[]): VideoSegment[] {
  if (clips.length === 0) return [];
  const segments: VideoSegment[] = [];
  let segStart = 0;

  for (let i = 1; i <= clips.length; i++) {
    if (i === clips.length || !clips[i].contiguous) {
      const first = clips[segStart];
      const last = clips[i - 1];
      segments.push({
        index: segments.length,
        videoFile: first.videoFile,
        videoStart: first.videoStart,
        videoEnd: last.videoEnd,
        clipStartIdx: segStart,
        clipEndIdx: i - 1,
        globalStart: first.globalStart,
        globalEnd: last.globalEnd,
      });
      segStart = i;
    }
  }
  return segments;
}
