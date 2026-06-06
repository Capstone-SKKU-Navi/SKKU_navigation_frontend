/**
 * Shared route-related actions used by both PC chrome (main.ts) and
 * mobile chrome (src/mobile/*).
 *
 * Endpoint state model:
 *   Each slot (start/end) is either a `room` endpoint (room ref string,
 *   stored in the hidden #startRoomInput / #endRoomInput) or a `coord`
 *   endpoint (raw {lng, lat, level} from a dropped/dragged map pin,
 *   stored in module-scoped overrides).
 *
 *   When a `coord` override is set, the hidden input is cleared and the
 *   coord takes precedence in `getEndpoints()`. When the user picks a
 *   room (autocomplete or popup), the override is cleared and the input
 *   ref becomes the active endpoint. Either kind is converted to
 *   `{lng, lat, level}` inside `triggerFindRoute()` before calling the API.
 */

import * as BackendService from './backendService';
import * as RouteOverlay from '../components/routeOverlay';
import * as WalkthroughOverlay from '../components/walkthroughOverlay';
import * as GeoMap from '../components/geoMap';
import { fetchRoute } from './apiClient';
import type { RouteCoordinate, ApiRouteResult } from './apiClient';
import type { RoomListItem } from '../models/types';
import { buildWalkthroughPlaylist } from './walkthroughPlanner';
import { getFlag } from '../config/featureFlags';
import { writeSelectedRoom, writeRoute, clearUrlState } from './urlState';

/** A point on the route where the floor changes (stairs/elevator). */
export interface FloorTransition {
  lng: number;
  lat: number;
  fromLevel: number;
  toLevel: number;
}

export type RouteEndpoint =
  | { kind: 'room'; ref: string }
  | { kind: 'coord'; lng: number; lat: number; level: number };

// Module-scoped cache shared across callers (hoisted from main.ts).
export const roomCentroidCache = new Map<string, { centroid: [number, number]; level: number }>();

// Coord overrides — when set, take precedence over the hidden input's ref.
type CoordSlot = { lng: number; lat: number; level: number };
let startCoordOverride: CoordSlot | null = null;
let endCoordOverride: CoordSlot | null = null;

export function cacheRoomCentroid(room: RoomListItem): void {
  if (room.centroid) {
    roomCentroidCache.set(room.ref, { centroid: room.centroid, level: room.level[0] });
  }
}

/** Fly to a room and switch to its floor. */
export function selectRoom(room: RoomListItem): void {
  cacheRoomCentroid(room);
  if (room.level.length > 0) {
    GeoMap.handleLevelChange(room.level[0]);
  }
  GeoMap.flyToRoom(room.ref);
  // Pin 3D focus to the searched building so panning the camera away
  // doesn't make it disappear in 3D.
  GeoMap.setIndoorFocusPin([room.building]);
  // Deep-link the selection so it's bookmarkable / shareable.
  if (room.level.length > 0) writeSelectedRoom(room.ref, room.level[0]);
}

/** Swap the start and end endpoints (room refs and coord overrides together). */
export function swapEndpoints(): void {
  const startInput = getStartInput();
  const endInput = getEndInput();
  const sVal = startInput?.value ?? '';
  const eVal = endInput?.value ?? '';
  if (startInput) startInput.value = eVal;
  if (endInput) endInput.value = sVal;
  const tmp = startCoordOverride;
  startCoordOverride = endCoordOverride;
  endCoordOverride = tmp;
  document.dispatchEvent(new Event('routeEndpointChanged'));
  updateFocusPinFromEndpoints();
  maybeAutoFindRoute();
}

/** Where does the route change floor? Drives the stairs/elevator markers. */
function computeFloorTransitions(r: ApiRouteResult): FloorTransition[] {
  const out: FloorTransition[] = [];
  const { coordinates, levels } = r;
  if (!levels || levels.length !== coordinates.length) return out;
  for (let i = 0; i < levels.length - 1; i++) {
    if (levels[i] !== levels[i + 1]) {
      const c = coordinates[i + 1];
      out.push({ lng: c[0], lat: c[1], fromLevel: levels[i], toLevel: levels[i + 1] });
    }
  }
  return out;
}

/** Resolve which building owns an endpoint (room ref or raw coord). */
function buildingForEndpoint(ep: RouteEndpoint): string | null {
  if (ep.kind === 'coord') {
    return BackendService.getBuildingForCoordinates([ep.lng, ep.lat]);
  }
  const found = BackendService.getRoomList().find(r => r.ref === ep.ref);
  return found?.building ?? null;
}

/** Recompute the 3D focus pin from whichever endpoints are currently set. */
function updateFocusPinFromEndpoints(): void {
  const { start, end } = getEndpoints();
  const buildings = new Set<string>();
  if (start) {
    const b = buildingForEndpoint(start);
    if (b) buildings.add(b);
  }
  if (end) {
    const b = buildingForEndpoint(end);
    if (b) buildings.add(b);
  }
  if (buildings.size > 0) GeoMap.setIndoorFocusPin(buildings);
  else GeoMap.clearIndoorFocusPin();
}

function getStartInput(): HTMLInputElement | null {
  return document.getElementById('startRoomInput') as HTMLInputElement | null;
}
function getEndInput(): HTMLInputElement | null {
  return document.getElementById('endRoomInput') as HTMLInputElement | null;
}

function resolveSlot(coord: CoordSlot | null, input: HTMLInputElement | null): RouteEndpoint | null {
  if (coord) return { kind: 'coord', lng: coord.lng, lat: coord.lat, level: coord.level };
  const ref = input?.value.trim() ?? '';
  return ref ? { kind: 'room', ref } : null;
}

/** Set the start endpoint to a room ref and notify listeners. */
export function setStart(ref: string): void {
  startCoordOverride = null;
  const input = getStartInput();
  if (input) input.value = ref;
  revealRouteInputs();
  document.dispatchEvent(new Event('routeEndpointChanged'));
  updateFocusPinFromEndpoints();
  maybeAutoFindRoute();
}

/** Set the end endpoint to a room ref and notify listeners. */
export function setEnd(ref: string): void {
  endCoordOverride = null;
  const input = getEndInput();
  if (input) input.value = ref;
  revealRouteInputs();
  document.dispatchEvent(new Event('routeEndpointChanged'));
  updateFocusPinFromEndpoints();
  maybeAutoFindRoute();
}

/**
 * If the coord falls outside every building outline AND outside every room
 * polygon, the user is pointing at outdoor space (lawn, road, plaza) —
 * there is no notion of "3F outside", so force level 1 regardless of the
 * current floor. Outline alone isn't enough because some rooms can extend
 * past the outline.
 */
function normalizeOutdoorLevel(lng: number, lat: number, level: number): number {
  return BackendService.isPointIndoors([lng, lat]) ? level : 1;
}

/** Set the start endpoint to raw map coordinates (drag-drop / pin reposition). */
export function setStartCoord(lng: number, lat: number, level: number): void {
  startCoordOverride = { lng, lat, level: normalizeOutdoorLevel(lng, lat, level) };
  const input = getStartInput();
  if (input) input.value = '';
  revealRouteInputs();
  document.dispatchEvent(new Event('routeEndpointChanged'));
  updateFocusPinFromEndpoints();
  maybeAutoFindRoute();
}

/** Set the end endpoint to raw map coordinates (drag-drop / pin reposition). */
export function setEndCoord(lng: number, lat: number, level: number): void {
  endCoordOverride = { lng, lat, level: normalizeOutdoorLevel(lng, lat, level) };
  const input = getEndInput();
  if (input) input.value = '';
  revealRouteInputs();
  document.dispatchEvent(new Event('routeEndpointChanged'));
  updateFocusPinFromEndpoints();
  maybeAutoFindRoute();
}

/**
 * If both endpoints are set and the auto-find flag is on, fire findRoute.
 * Centralized so every set* path (room ref, coord drop, autocomplete pick,
 * popup action) gets the same behavior without each caller wiring its own.
 */
function maybeAutoFindRoute(): void {
  if (!getFlag('autoFindRouteOnEndpointSet')) return;
  const { start, end } = getEndpoints();
  if (!start || !end) return;
  triggerFindRoute().catch(err => console.error('경로 자동 검색 실패:', err));
}

/**
 * Called when the user types into a route input. Clears the coord override
 * on that slot so the typed ref takes over as a room endpoint.
 */
export function notifyInputChanged(slot: 'start' | 'end'): void {
  if (slot === 'start' && startCoordOverride) {
    startCoordOverride = null;
  } else if (slot === 'end' && endCoordOverride) {
    endCoordOverride = null;
  }
}

/** Clear an endpoint if it's a room endpoint matching `ref` (right-click on assigned room). */
export function clearEndpointByRef(ref: string): void {
  let changed = false;
  if (!startCoordOverride) {
    const s = getStartInput();
    if (s && s.value.trim() === ref) { s.value = ''; changed = true; }
  }
  if (!endCoordOverride) {
    const e = getEndInput();
    if (e && e.value.trim() === ref) { e.value = ''; changed = true; }
  }
  if (changed) document.dispatchEvent(new Event('routeEndpointChanged'));
}

/** Reveal the PC route input row (no-op on mobile since PC chrome is display:none). */
function revealRouteInputs(): void {
  const routeInputs = document.getElementById('routeInputs');
  if (routeInputs) routeInputs.style.display = 'flex';
  const toggleBtn = document.getElementById('routeToggleBtn');
  if (toggleBtn) toggleBtn.style.display = 'none';
}

/** Read the current endpoints (typed union over room/coord). */
export function getEndpoints(): { start: RouteEndpoint | null; end: RouteEndpoint | null } {
  return {
    start: resolveSlot(startCoordOverride, getStartInput()),
    end: resolveSlot(endCoordOverride, getEndInput()),
  };
}

/** User-facing label for an endpoint (room ref or "지도 위치"). */
export function formatEndpointLabel(ep: RouteEndpoint | null): string {
  if (!ep) return '';
  return ep.kind === 'room' ? ep.ref : '지도 위치';
}

/** Clear both endpoints and all downstream route / walkthrough state. */
export function clearRoute(): void {
  startCoordOverride = null;
  endCoordOverride = null;
  const startInput = getStartInput();
  const endInput = getEndInput();
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  RouteOverlay.clearRoute();
  WalkthroughOverlay.hideWalkthroughOverlay();
  GeoMap.clearIndoorRouteLevels();
  GeoMap.clearFloorTransitions();
  clearUrlState();
  const routeInfo = document.getElementById('routeInfo');
  const buildingInfo = document.getElementById('buildingInfo');
  if (routeInfo) routeInfo.style.display = 'none';
  if (buildingInfo) buildingInfo.style.display = 'flex';
  const routeInputs = document.getElementById('routeInputs');
  if (routeInputs) routeInputs.style.display = 'none';
  const toggleBtn = document.getElementById('routeToggleBtn');
  if (toggleBtn) { toggleBtn.style.display = ''; toggleBtn.classList.remove('active'); }
  // Endpoints went from set → null; pin markers and other listeners need both
  // signals (routeEndpointChanged for state-derived UI, routeCleared for
  // route-specific UI like the mobile clear button).
  document.dispatchEvent(new Event('routeEndpointChanged'));
  document.dispatchEvent(new Event('routeCleared'));
  // Release the 3D focus pin — camera-driven focus takes over again.
  GeoMap.clearIndoorFocusPin();
}

function showRouteInfo(time: string, distance: number): void {
  const routeInfo = document.getElementById('routeInfo');
  const routeText = document.getElementById('routeInfoText');
  const buildingInfo = document.getElementById('buildingInfo');
  if (routeInfo && routeText) {
    routeText.textContent = `예상 ${time} · ${distance}m`;
    routeInfo.style.display = 'flex';
  }
  if (buildingInfo) buildingInfo.style.display = 'none';
}

/** Resolve a `RouteEndpoint` to backend coordinates. Room refs go through the centroid cache. */
function resolveCoordinate(ep: RouteEndpoint): RouteCoordinate | null {
  if (ep.kind === 'coord') {
    // 지도 핀: 방을 지정하지 않았어도 좌표가 건물/방 폴리곤 내부면 실내로 보고
    // 복도(실내 edge) 우선 투영. 실외 좌표만 종전대로 가장 가까운 edge 투영.
    const preferIndoor = BackendService.isPointIndoors([ep.lng, ep.lat]);
    return { lng: ep.lng, lat: ep.lat, level: ep.level, preferIndoor };
  }
  const cached = roomCentroidCache.get(ep.ref);
  const centroid = cached?.centroid ?? BackendService.getRoomCentroid(ep.ref);
  const level = cached?.level ?? BackendService.getRoomLevel(ep.ref);
  if (!centroid || level === null) return null;
  // 방 endpoint: 항상 실내 edge 우선 투영 (실외 보행로로 먼저 내려가지 않게).
  return { lng: centroid[0], lat: centroid[1], level, preferIndoor: true };
}

// Tracks the in-flight findRoute request so a newer call can cancel an older
// one — without this, two rapid clicks can resolve out of order and a stale
// path overwrites the latest one.
let routeAbortController: AbortController | null = null;

function dispatchRouteNotFound(reason: 'unresolved' | 'no-path' | 'error', message: string): void {
  document.dispatchEvent(new CustomEvent('routeNotFound', { detail: { reason, message } }));
}

/**
 * Run the full find-route flow: resolve coords from each endpoint kind, fetch,
 * render, start walkthrough. Dispatches `routeFound` on success and
 * `routeNotFound` (with `{reason, message}`) on any failure.
 */
export async function triggerFindRoute(): Promise<void> {
  const { start, end } = getEndpoints();
  if (!start || !end) return;

  const from = resolveCoordinate(start);
  const to = resolveCoordinate(end);

  if (!from || !to) {
    console.warn('[Route] Could not resolve endpoint coords:', start, end);
    dispatchRouteNotFound('unresolved', '출발지 또는 도착지를 찾을 수 없습니다');
    return;
  }

  // Cancel any prior in-flight request before starting a new one.
  routeAbortController?.abort();
  const controller = new AbortController();
  routeAbortController = controller;

  try {
    const routeResult = await fetchRoute(from, to, controller.signal);
    // If a newer request started while this one was awaiting, drop this result.
    if (controller.signal.aborted || routeAbortController !== controller) return;
    if (!routeResult) {
      console.warn('[Route] No route found:', from, '→', to);
      dispatchRouteNotFound('no-path', '경로를 찾을 수 없습니다');
      return;
    }

    if (routeResult.coordinates && routeResult.coordinates.length >= 2) {
      RouteOverlay.showRoute(
        routeResult.coordinates,
        routeResult.levels,
        routeResult.clips,
        !GeoMap.isFlatMode(),
      );
      // Make every floor the route touches opaque in 3D — otherwise upper-
      // floor segments float over filtered-out floors and disappear.
      GeoMap.setIndoorRouteLevels(routeResult.levels ?? []);
      // Mark where the route changes floor (stairs/elevator).
      GeoMap.showFloorTransitions(computeFloorTransitions(routeResult));
    }

    showRouteInfo(routeResult.estimatedTime, routeResult.totalDistance);

    // Know which route videos exist before building the playlist, so missing
    // clips can be grayed out instead of 404-ing during playback. Cached.
    await BackendService.loadAvailableVideos(routeResult.clips?.map(c => c.videoFile));
    const playlist = buildWalkthroughPlaylist(routeResult);
    console.log('[Walkthrough] playlist:', playlist ? `${playlist.clips.length} clips, ${playlist.totalDuration.toFixed(1)}s` : 'null');
    if (playlist && playlist.clips.length > 0) {
      WalkthroughOverlay.showWalkthroughOverlay(playlist);
    }

    // Frame the whole path so a route-find never finishes off-screen. Done
    // AFTER the walkthrough sheet mounts (mobile) so its bottom inset is
    // already applied and the route isn't framed behind the sheet.
    if (routeResult.coordinates && routeResult.coordinates.length >= 2) {
      GeoMap.fitRouteBounds(routeResult.coordinates);
    }

    // Carry the summary on the event so mobile chrome (PC header is hidden
    // there) can show distance/ETA without recomputing.
    document.dispatchEvent(new CustomEvent('routeFound', {
      detail: {
        estimatedTime: routeResult.estimatedTime,
        totalDistance: routeResult.totalDistance,
        levels: routeResult.levels ?? [],
      },
    }));
    // Deep-link the route (room-ref endpoints only; coord pins are skipped).
    writeRoute(
      start.kind === 'room' ? start.ref : null,
      end.kind === 'room' ? end.ref : null,
    );
  } catch (err: any) {
    if (err?.name === 'AbortError') return; // superseded by newer request
    console.error('경로 검색 실패:', err);
    dispatchRouteNotFound('error', '경로 검색 중 오류가 발생했습니다');
  } finally {
    if (routeAbortController === controller) routeAbortController = null;
  }
}
