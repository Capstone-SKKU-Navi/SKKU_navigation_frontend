// ===== API Route Provider — Coordinate-based routing via backend =====
//
// The backend handles all pathfinding (Dijkstra, perpendicular foot projection,
// video clip assembly). Frontend only receives coordinates + video clips.
// No graph data (nodes/edges) is needed on the frontend.

import type { RoomListItem } from '../../models/types';
import * as BackendService from '../backendService';

const API_BASE = 'http://localhost:8080/api';

// ===== Types: coordinates sent to backend =====

export interface RouteCoordinate {
  lng: number;
  lat: number;
  level: number;
}

// ===== Types: backend response =====

export interface ApiRouteClip {
  index: number;
  videoFile: string;
  videoStart: number;   // seconds
  videoEnd: number;     // seconds
  duration: number;
  yaw: number;          // degrees
  level: number;
  isExitClip: boolean;
  coordStartIdx: number;
  coordEndIdx: number;
  routeDistStart: number;
  routeDistEnd: number;
}

export interface ApiRouteResult {
  coordinates: GeoJSON.Position[];
  levels: number[];
  totalDistance: number;
  estimatedTime: string;
  startLevel: number;
  endLevel: number;
  clips: ApiRouteClip[];
  videoStartCoordIdx: number;
  videoEndCoordIdx: number;
}

interface ApiRouteResponse {
  found: boolean;
  route?: {
    coordinates: [number, number][];
    levels: number[];
    totalDistance: number;
    estimatedTime: string;
    startLevel: number;
    endLevel: number;
  };
  walkthrough?: {
    clips: ApiRouteClip[];
    videoStartCoordIdx: number;
    videoEndCoordIdx: number;
  };
  error?: string;
}

interface ApiRoomSearchResult {
  building: string;
  ref: string;
  name: string;
  level: number;
  roomType: string;
  centroid: [number, number];
}

// ===== Init =====

export async function init(): Promise<void> {
  // No graph to fetch — backend handles everything.
  // GeoJSON loading is handled by backendService.ts separately.
  console.log('[ApiRoute] Ready (no graph fetch needed)');
}

// ===== Route Finding (coordinate-based) =====

export async function findRoute(from: RouteCoordinate, to: RouteCoordinate): Promise<ApiRouteResult | null> {
  console.log('[ApiRoute] POST /api/route', from, '→', to);
  const res = await fetch(`${API_BASE}/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  if (!res.ok) throw new Error(`API route failed: ${res.status}`);
  const data: ApiRouteResponse = await res.json();
  if (!data.found || !data.route || !data.walkthrough) return null;

  return {
    coordinates: data.route.coordinates,
    levels: data.route.levels,
    totalDistance: data.route.totalDistance,
    estimatedTime: data.route.estimatedTime,
    startLevel: data.route.startLevel,
    endLevel: data.route.endLevel,
    clips: data.walkthrough.clips,
    videoStartCoordIdx: data.walkthrough.videoStartCoordIdx,
    videoEndCoordIdx: data.walkthrough.videoEndCoordIdx,
  };
}

// ===== Room Search =====

export async function searchRooms(query: string): Promise<RoomListItem[]> {
  if (!query.trim()) return [];
  console.log('[ApiRoute] Searching rooms:', query);
  const res = await fetch(`${API_BASE}/rooms/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const rooms: ApiRoomSearchResult[] = await res.json();
  return rooms.map((r): RoomListItem => ({
    building: r.building ?? '',
    ref: r.ref,
    name: r.name ?? '',
    level: [r.level],
    roomType: r.roomType ?? '',
    featureId: '',
    centroid: r.centroid,
  }));
}
