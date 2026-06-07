// ===== Walkthrough Planner — API Route Result → Video Clip Playlist =====
//
// Simplified version: backend provides pre-computed clips (video file, time range,
// yaw, coordinate indices). This module only adds global timing, contiguous
// detection, segment grouping, and position interpolation.

import type { ApiRouteResult, ApiRouteClip } from './api/apiRoute';
import { getDistanceBetweenCoordinatesInM } from '../utils/coordinateHelpers';
import { isVideoAvailable } from './backendService';
import type { WalkthroughClip, WalkthroughPlaylist, VideoSegment } from '../components/walkthroughTypes';

const TIME_EPSILON = 0.05; // seconds — clips within this gap are "contiguous"

/**
 * Build a walkthrough playlist from an API route result.
 * Returns null if no video clips are available.
 */
export function buildWalkthroughPlaylist(
  route: ApiRouteResult,
): WalkthroughPlaylist | null {
  const { coordinates, levels, clips: apiClips, videoStartCoordIdx, videoEndCoordIdx } = route;

  if (!apiClips || apiClips.length === 0) return null;

  // 1. Cumulative distance array
  const cumulativeDist = buildCumulativeDist(coordinates);

  // 2. Assign global times and detect contiguous clips
  const clips: WalkthroughClip[] = [];
  let globalTime = 0;

  for (let i = 0; i < apiClips.length; i++) {
    const raw = apiClips[i];
    const prev = i > 0 ? apiClips[i - 1] : null;
    const contiguous = prev != null
      && prev.videoFile === raw.videoFile
      && Math.abs(prev.videoEnd - raw.videoStart) < TIME_EPSILON;

    clips.push({
      index: raw.index,
      videoFile: raw.videoFile,
      videoStart: raw.videoStart,
      videoEnd: raw.videoEnd,
      duration: raw.duration,
      yaw: raw.yaw,
      level: raw.level,
      isExitClip: raw.isExitClip,
      edgeId: '',  // not exposed by backend — unused by player
      coordStartIdx: raw.coordStartIdx,
      coordEndIdx: raw.coordEndIdx,
      routeDistStart: raw.routeDistStart,
      routeDistEnd: raw.routeDistEnd,
      globalStart: globalTime,
      globalEnd: globalTime + raw.duration,
      contiguous,
      hasVideo: isVideoAvailable(raw.videoFile),
    });
    globalTime += raw.duration;
  }

  const totalDuration = globalTime;

  // 3. Build video segments (group contiguous clips on the same file)
  const segments = buildSegments(clips);

  // 4. Segment boundaries for progress bar
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

/**
 * Inverse of getPositionAtTime: given a clicked [lng, lat] on (or near) the route,
 * return the walkthrough global time at that spot — so tapping the route line can
 * seek the player there, exactly like clicking the scrubber.
 *
 * Projects the point onto the route polyline to get a route distance, finds the
 * clip covering that distance, then maps the within-clip fraction to global time
 * (mirrors getPositionAtTime, which goes routeDist = start + frac*(end-start)).
 */
export function getTimeAtPosition(
  playlist: WalkthroughPlaylist,
  position: GeoJSON.Position,
  level?: number,
): number | null {
  const { clips, coordinates, cumulativeDist } = playlist;
  if (clips.length === 0 || coordinates.length < 2) return null;

  const routeDist = projectToRouteDist(coordinates, cumulativeDist, position, playlist.levels, level);

  // First clip whose coverage reaches routeDist (clips are ordered along the
  // route). Falls through to the last clip when the point is past all coverage.
  // Strict `<` mirrors getPositionAtTime's `t < c.globalEnd` so a tap exactly on
  // a clip boundary resolves to the same clip in both directions.
  let clip = clips[clips.length - 1];
  for (const c of clips) {
    if (routeDist < c.routeDistEnd) { clip = c; break; }
  }

  const span = clip.routeDistEnd - clip.routeDistStart;
  const frac = span > 0 ? (routeDist - clip.routeDistStart) / span : 0;
  const clamped = Math.max(0, Math.min(1, frac));
  return clip.globalStart + clamped * clip.duration;
}

/**
 * Perpendicular-project `position` onto the route polyline; return the cumulative
 * route distance (meters) of the foot point. Works in a locally-flat metric frame
 * (longitude scaled by cos(lat)) so the nearest segment + fraction aren't skewed
 * by longitude compression.
 */
function projectToRouteDist(
  coordinates: GeoJSON.Position[],
  cumulativeDist: number[],
  position: GeoJSON.Position,
  levels?: number[],
  targetLevel?: number,
): number {
  const kx = Math.cos((position[1] * Math.PI) / 180) || 1; // lng→x scale at this lat
  // Two candidates: the overall nearest segment, and the nearest among segments
  // on `targetLevel`. Prefer the level-matched one — when corridors stack
  // vertically (e.g. 4F directly above 1F) the bare-nearest could grab the wrong
  // floor's line; the picked floor disambiguates. Falls back to overall nearest
  // when no level is given or the route has no segment on that floor.
  let bestD = Infinity, bestRouteDist = 0;
  let bestLvlD = Infinity, bestLvlRouteDist = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const ax = coordinates[i][0], ay = coordinates[i][1];
    const dx = (coordinates[i + 1][0] - ax) * kx, dy = coordinates[i + 1][1] - ay;
    const px = (position[0] - ax) * kx, py = position[1] - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let t = (px * dx + py * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = (px - t * dx) ** 2 + (py - t * dy) ** 2;
    const routeDist = cumulativeDist[i] + t * (cumulativeDist[i + 1] - cumulativeDist[i]);
    if (d < bestD) { bestD = d; bestRouteDist = routeDist; }
    if (targetLevel != null && levels &&
        (levels[i] === targetLevel || levels[i + 1] === targetLevel) && d < bestLvlD) {
      bestLvlD = d; bestLvlRouteDist = routeDist;
    }
  }
  return bestLvlD < Infinity ? bestLvlRouteDist : bestRouteDist;
}

// ===== Internal helpers =====

function buildCumulativeDist(coordinates: GeoJSON.Position[]): number[] {
  const dist = [0];
  for (let i = 1; i < coordinates.length; i++) {
    dist.push(dist[i - 1] + getDistanceBetweenCoordinatesInM(coordinates[i - 1], coordinates[i]));
  }
  return dist;
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
        hasVideo: first.hasVideo, // contiguous clips share one file → same availability
      });
      segStart = i;
    }
  }
  return segments;
}
