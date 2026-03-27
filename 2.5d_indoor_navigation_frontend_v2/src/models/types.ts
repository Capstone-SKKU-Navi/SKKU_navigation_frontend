export interface BuildingInterface {
  boundingBox: [number, number, number, number]; // [W, S, E, N]
  feature: GeoJSON.Feature;
}

export interface BuildingConstants {
  standardZoom: number;
  maxZoom: number;
  minZoom: number;
  standardBearing: number;
  standardBearing3DMode: number;
  standardPitch3DMode: number;
  standardZoom3DMode: number;
}

export interface RouteEdge {
  from: string;
  to: string;
  video: string;
  duration: number;
}

export interface RouteResponse {
  path: string[];
  edges: RouteEdge[];
  totalDistance: number;
  estimatedTime: string;
}

export interface RoomListItem {
  ref: string;
  name: string;
  level: number[];
  roomType: string;
  featureId: string;
}

/** Per-level categorized GeoJSON data */
export interface LevelData {
  rooms: GeoJSON.FeatureCollection;
  colliders: GeoJSON.FeatureCollection;
  walls: GeoJSON.FeatureCollection;
}

/** Building manifest from manifest.json */
export interface BuildingManifest {
  building: string;
  name: string;
  loc_ref: string;
  levels: number[];
}

export const ROOM_COLORS: Record<string, string> = {
  classroom: '#8FB8D0',
  lab: '#81C784',
  restroom: '#CE93D8',
  office: '#FFB74D',
  stairs: '#A1887F',
  elevator: '#B0BEC5',
  corridor: '#F5F5F0',
};

export const ROOM_TYPE_LABELS: Record<string, string> = {
  classroom: '교실',
  lab: '실험실',
  restroom: '화장실',
  office: '사무실',
  stairs: '계단',
  elevator: '엘리베이터',
};
