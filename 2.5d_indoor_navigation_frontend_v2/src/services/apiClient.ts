// ===== API Client — Frontend routing interface =====
//
// In API mode (default when backend is available):
//   Uses POST /api/route with coordinates. No graph data on frontend.
//
// In local mode (fallback for offline dev / graph editor):
//   Uses local graph.json + Dijkstra. Still available via LocalRoute import
//   but not used by the navigation UI.

import * as ApiRoute from './api/apiRoute';
import * as LocalRoute from './local/localRoute';
import type { ApiRouteResult, RouteCoordinate } from './api/apiRoute';
import type { RoomListItem } from '../models/types';

let useApi = false;

export function setUseApi(api: boolean): void {
  useApi = api;
}

export function isApiMode(): boolean {
  return useApi;
}

/** Initialize routing */
export async function initRouting(): Promise<void> {
  if (useApi) {
    await ApiRoute.init();
  } else {
    // Local fallback — loads graph.json for graph editor / offline dev
    await LocalRoute.init();
  }
}

/** Find route between two coordinates */
export async function fetchRoute(from: RouteCoordinate, to: RouteCoordinate): Promise<ApiRouteResult | null> {
  if (useApi) {
    return ApiRoute.findRoute(from, to);
  }
  // Local fallback: same logic as backend, runs locally with graph.json
  return LocalRoute.findRoute(from, to);
}

/** Search rooms by query string */
export async function searchRooms(query: string): Promise<RoomListItem[]> {
  if (useApi) {
    return ApiRoute.searchRooms(query);
  }
  return LocalRoute.searchRooms(query);
}

// Re-export types for convenience
export type { ApiRouteResult, RouteCoordinate } from './api/apiRoute';
