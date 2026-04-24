/**
 * Shared route-related actions used by both PC chrome (main.ts) and
 * mobile chrome (src/mobile/*). Extracts what was previously inlined
 * in `setupRouteUI` and `setupRoomClickPopup`.
 *
 * The hidden `#startRoomInput` / `#endRoomInput` elements in
 * public/index.html remain the single source of truth for endpoint refs —
 * both PC and mobile write into them and listen to `routeEndpointChanged`.
 * On mobile those inputs are display:none but still present in the DOM,
 * so this module works identically in both modes.
 */

import * as BackendService from './backendService';
import * as RouteOverlay from '../components/routeOverlay';
import * as WalkthroughOverlay from '../components/walkthroughOverlay';
import * as GeoMap from '../components/geoMap';
import { fetchRoute } from './apiClient';
import type { RouteCoordinate } from './apiClient';
import type { RoomListItem } from '../models/types';
import { buildWalkthroughPlaylist } from './walkthroughPlanner';

// Module-scoped cache shared across callers (hoisted from main.ts).
export const roomCentroidCache = new Map<string, { centroid: [number, number]; level: number }>();

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
}

function getStartInput(): HTMLInputElement | null {
  return document.getElementById('startRoomInput') as HTMLInputElement | null;
}
function getEndInput(): HTMLInputElement | null {
  return document.getElementById('endRoomInput') as HTMLInputElement | null;
}

/** Set the start endpoint and notify listeners. */
export function setStart(ref: string): void {
  const input = getStartInput();
  if (input) input.value = ref;
  revealRouteInputs();
  document.dispatchEvent(new Event('routeEndpointChanged'));
}

/** Set the end endpoint and notify listeners. */
export function setEnd(ref: string): void {
  const input = getEndInput();
  if (input) input.value = ref;
  revealRouteInputs();
  document.dispatchEvent(new Event('routeEndpointChanged'));
}

/** Reveal the PC route input row (no-op on mobile since PC chrome is display:none). */
function revealRouteInputs(): void {
  const routeInputs = document.getElementById('routeInputs');
  if (routeInputs) routeInputs.style.display = 'flex';
  const toggleBtn = document.getElementById('routeToggleBtn');
  if (toggleBtn) toggleBtn.style.display = 'none';
}

/** Read the current endpoints from the hidden inputs. */
export function getEndpoints(): { startRef: string; endRef: string } {
  return {
    startRef: getStartInput()?.value.trim() ?? '',
    endRef: getEndInput()?.value.trim() ?? '',
  };
}

/** Clear both endpoints and all downstream route / walkthrough state. */
export function clearRoute(): void {
  const startInput = getStartInput();
  const endInput = getEndInput();
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  RouteOverlay.clearEndpointPreview();
  RouteOverlay.clearRoute();
  WalkthroughOverlay.hideWalkthroughOverlay();
  const routeInfo = document.getElementById('routeInfo');
  const buildingInfo = document.getElementById('buildingInfo');
  if (routeInfo) routeInfo.style.display = 'none';
  if (buildingInfo) buildingInfo.style.display = 'flex';
  const routeInputs = document.getElementById('routeInputs');
  if (routeInputs) routeInputs.style.display = 'none';
  const toggleBtn = document.getElementById('routeToggleBtn');
  if (toggleBtn) { toggleBtn.style.display = ''; toggleBtn.classList.remove('active'); }
  document.dispatchEvent(new Event('routeCleared'));
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

/**
 * Run the full find-route flow: resolve coords from refs, fetch, render,
 * start walkthrough. Dispatches `routeFound` on success.
 */
export async function triggerFindRoute(): Promise<void> {
  const { startRef, endRef } = getEndpoints();
  if (!startRef || !endRef) return;

  const fromCached = roomCentroidCache.get(startRef);
  const toCached = roomCentroidCache.get(endRef);
  const fromCentroid = fromCached?.centroid ?? BackendService.getRoomCentroid(startRef);
  const toCentroid = toCached?.centroid ?? BackendService.getRoomCentroid(endRef);
  const fromLevel = fromCached?.level ?? BackendService.getRoomLevel(startRef);
  const toLevel = toCached?.level ?? BackendService.getRoomLevel(endRef);

  if (!fromCentroid || !toCentroid || fromLevel === null || toLevel === null) {
    console.warn('[Route] Room not found:', startRef, endRef);
    return;
  }

  const from: RouteCoordinate = { lng: fromCentroid[0], lat: fromCentroid[1], level: fromLevel };
  const to: RouteCoordinate = { lng: toCentroid[0], lat: toCentroid[1], level: toLevel };

  try {
    const routeResult = await fetchRoute(from, to);
    if (!routeResult) {
      console.warn('[Route] No route found:', startRef, '→', endRef);
      return;
    }

    RouteOverlay.clearEndpointPreview();
    if (routeResult.coordinates && routeResult.coordinates.length >= 2) {
      RouteOverlay.showRoute(
        routeResult.coordinates,
        routeResult.levels,
        !GeoMap.isFlatMode(),
      );
    }

    showRouteInfo(routeResult.estimatedTime, routeResult.totalDistance);

    const playlist = buildWalkthroughPlaylist(routeResult);
    console.log('[Walkthrough] playlist:', playlist ? `${playlist.clips.length} clips, ${playlist.totalDuration.toFixed(1)}s` : 'null');
    if (playlist && playlist.clips.length > 0) {
      WalkthroughOverlay.showWalkthroughOverlay(playlist);
    }

    document.dispatchEvent(new Event('routeFound'));
  } catch (err: any) {
    console.error('경로 검색 실패:', err);
  }
}
