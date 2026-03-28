import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type maplibregl from 'maplibre-gl';
import { getLevelBase, ROOM_THICKNESS, getCurrentLevel } from './indoorLayer';
import { MapConfig } from '../config/mapConfig';

/**
 * RouteOverlay — deck.gl overlay for dynamic route visualization
 *
 * 3D 모드에서는 각 좌표의 층(level) 정보를 기반으로 정확한 높이를 적용.
 * 2D↔3D 전환 시 자동 재렌더링.
 */

let overlay: MapboxOverlay | null = null;

// 저장된 경로 데이터 (2D↔3D 전환 시 재렌더링용)
let storedCoordinates: GeoJSON.Position[] | null = null;
let storedLevels: number[] | null = null;
let storedIs3D = false;

// Walkthrough position indicator
let positionIndicatorData: PoiData | null = null;

// Endpoint preview (before route search)
let previewEndpoints: PoiData[] = [];

const R = MapConfig.route;

interface RouteData {
  path: number[][];
}

interface PoiData {
  position: number[];
  color: [number, number, number];
  radius: number;
  level?: number;
}

export function initOverlay(map: maplibregl.Map): void {
  overlay = new MapboxOverlay({
    interleaved: true,
    layers: [],
  });
  map.addControl(overlay as unknown as maplibregl.IControl);
}

/**
 * Draw a route path on the map.
 * @param coordinates [lng, lat] 배열
 * @param levels      각 좌표의 층 번호 (coordinates와 1:1 대응)
 * @param is3D        3D 모드 여부
 */
export function showRoute(
  coordinates: GeoJSON.Position[],
  levels: number[] | null,
  is3D: boolean,
): void {
  storedCoordinates = coordinates;
  storedLevels = levels;
  storedIs3D = is3D;
  renderRoute();
}

/** 2D↔3D 전환 시 호출 */
export function setIs3D(is3D: boolean): void {
  if (!storedCoordinates) return;
  storedIs3D = is3D;
  renderRoute();
}

/** 층 변경 시 경로/endpoint opacity 업데이트 */
export function onLevelChange(): void {
  if (!storedCoordinates && previewEndpoints.length === 0) return;
  rebuildLayers();
}

/** 현재 경로가 표시 중인지 */
export function hasRoute(): boolean {
  return storedCoordinates !== null;
}

/** 좌표별 층 정보를 기반으로 3D 높이 적용 */
function buildPath3D(
  coords: GeoJSON.Position[],
  levels: number[] | null,
  is3D: boolean,
): number[][] {
  if (!is3D || !levels) {
    return coords.map(c => [c[0], c[1]]);
  }

  return coords.map((c, i) => {
    const level = levels[i] ?? levels[levels.length - 1] ?? 1;
    const altitude = getLevelBase(level) + ROOM_THICKNESS + 0.5;
    return [c[0], c[1], altitude];
  });
}

/** 층별 경로 색상 보간 */
function colorForLevel(level: number, minLevel: number): [number, number, number] {
  const step = level - minLevel;
  const t = Math.min(step / R.colorSteps, 1);
  return [
    Math.round(R.colorFrom[0] + (R.colorTo[0] - R.colorFrom[0]) * t),
    Math.round(R.colorFrom[1] + (R.colorTo[1] - R.colorFrom[1]) * t),
    Math.round(R.colorFrom[2] + (R.colorTo[2] - R.colorFrom[2]) * t),
  ];
}

/** 좌표 배열을 같은 층끼리 연속 세그먼트로 분할 (인접 세그먼트는 끝점 공유) */
interface Segment {
  path: number[][];
  level: number;
}

function splitByLevel(
  path3d: number[][],
  levels: number[] | null,
): Segment[] {
  if (!levels || levels.length === 0) {
    return [{ path: path3d, level: levels?.[0] ?? 1 }];
  }

  const segments: Segment[] = [];
  let curLevel = levels[0];
  let curPath: number[][] = [path3d[0]];

  for (let i = 1; i < path3d.length; i++) {
    if (levels[i] !== curLevel) {
      curPath.push(path3d[i]);
      segments.push({ path: curPath, level: curLevel });
      curLevel = levels[i];
      curPath = [path3d[i]];
    } else {
      curPath.push(path3d[i]);
    }
  }

  if (curPath.length >= 2) {
    segments.push({ path: curPath, level: curLevel });
  }

  return segments;
}

function renderRoute(): void {
  if (!overlay || !storedCoordinates) return;
  rebuildLayers();
}

/** Highlight POIs on the map (e.g., search results) */
export function showPois(positions: GeoJSON.Position[]): void {
  if (!overlay) return;

  const pois: PoiData[] = positions.map(pos => ({
    position: pos,
    color: [255, 111, 3] as [number, number, number],
    radius: 6,
  }));

  const currentLayers = overlay.props.layers || [];
  const routeLayers = currentLayers.filter((l: any) => l.id?.startsWith('route-'));

  overlay.setProps({
    layers: [
      ...routeLayers,
      new ScatterplotLayer({
        id: 'search-pois',
        data: pois,
        getPosition: (d: PoiData) => d.position,
        getFillColor: (d: PoiData) => d.color,
        getRadius: (d: PoiData) => d.radius,
        radiusMinPixels: 5,
        radiusMaxPixels: 12,
      }),
    ],
  });
}

// ===== Endpoint Preview (before route search) =====

/** Show start/end markers before route is searched */
export function showEndpointPreview(
  startPos: GeoJSON.Position | null,
  endPos: GeoJSON.Position | null,
  startLevel?: number | null,
  endLevel?: number | null,
): void {
  previewEndpoints = [];
  if (startPos) {
    previewEndpoints.push({
      position: [startPos[0], startPos[1]],
      color: [...R.startColor] as [number, number, number],
      radius: R.endpointRadius,
      level: startLevel ?? undefined,
    });
  }
  if (endPos) {
    previewEndpoints.push({
      position: [endPos[0], endPos[1]],
      color: [...R.endColor] as [number, number, number],
      radius: R.endpointRadius,
      level: endLevel ?? undefined,
    });
  }
  rebuildLayers();
}

export function clearEndpointPreview(): void {
  previewEndpoints = [];
  rebuildLayers();
}

// ===== Walkthrough Position Indicator =====

/** Show an orange circle at the given position to indicate walkthrough progress */
export function showPositionIndicator(
  position: GeoJSON.Position,
  level: number,
  is3D: boolean,
): void {
  const pos3d = is3D
    ? [position[0], position[1], getLevelBase(level) + ROOM_THICKNESS + 0.5]
    : [position[0], position[1]];

  positionIndicatorData = {
    position: pos3d,
    color: [255, 152, 0],   // orange
    radius: 6,
  };
  rebuildLayers();
}

/** Remove the walkthrough position indicator */
export function clearPositionIndicator(): void {
  positionIndicatorData = null;
  rebuildLayers();
}

/** Rebuild all overlay layers (route + position indicator) */
function rebuildLayers(): void {
  if (!overlay) return;

  const layers: any[] = [];

  // Route layers
  if (storedCoordinates) {
    const path3d = buildPath3D(storedCoordinates, storedLevels, storedIs3D);
    const segments = splitByLevel(path3d, storedLevels);
    const minLevel = storedLevels ? Math.min(...storedLevels) : 1;
    const curLevel = getCurrentLevel();

    segments.forEach((seg, i) => {
      const baseColor = colorForLevel(seg.level, minLevel);
      const opacity = seg.level === curLevel ? R.activeOpacity : R.inactiveOpacity;
      layers.push(
        new PathLayer<Segment>({
          id: `route-path-${i}`,
          data: [seg],
          getPath: (d) => d.path,
          getColor: [...baseColor, opacity] as [number, number, number, number],
          getWidth: R.lineWidth,
          widthMinPixels: R.lineWidthMinPx,
          widthMaxPixels: R.lineWidthMaxPx,
          capRounded: true,
          jointRounded: true,
        }),
      );
    });

    // Start/end POIs
    if (path3d.length >= 2) {
      const startLevel = storedLevels?.[0] ?? curLevel;
      const endLevel = storedLevels?.[storedLevels.length - 1] ?? curLevel;
      layers.push(
        new ScatterplotLayer<PoiData>({
          id: 'route-endpoints',
          data: [
            { position: path3d[0], color: [...R.startColor] as [number, number, number], radius: R.endpointRadius },
            { position: path3d[path3d.length - 1], color: [...R.endColor] as [number, number, number], radius: R.endpointRadius },
          ],
          getPosition: (d) => d.position as [number, number, number],
          getFillColor: (d, { index }) => {
            const lvl = index === 0 ? startLevel : endLevel;
            const c = d.color;
            return lvl === curLevel
              ? [c[0], c[1], c[2], R.activeOpacity]
              : [c[0], c[1], c[2], R.inactiveOpacity];
          },
          getRadius: (d) => d.radius,
          radiusMinPixels: R.endpointMinPx,
          radiusMaxPixels: R.endpointMaxPx,
        }),
      );
    }
  }

  // Endpoint preview (before route search)
  if (previewEndpoints.length > 0 && !storedCoordinates) {
    const curLevel = getCurrentLevel();
    // Pre-compute colors with alpha so deck.gl picks up changes on re-render
    const previewData = previewEndpoints.map(d => {
      const alpha = (d.level != null && d.level !== curLevel)
        ? R.inactiveOpacity : R.activeOpacity;
      return { ...d, fillColor: [d.color[0], d.color[1], d.color[2], alpha] as [number, number, number, number] };
    });
    layers.push(
      new ScatterplotLayer({
        id: 'endpoint-preview',
        data: previewData,
        getPosition: (d: any) => d.position,
        getFillColor: (d: any) => d.fillColor,
        getRadius: (d: any) => d.radius,
        radiusMinPixels: R.endpointMinPx,
        radiusMaxPixels: R.endpointMaxPx,
      }),
    );
  }

  // Position indicator
  if (positionIndicatorData) {
    layers.push(
      new ScatterplotLayer<PoiData>({
        id: 'walkthrough-position',
        data: [positionIndicatorData],
        getPosition: (d) => d.position as [number, number, number],
        getFillColor: [255, 152, 0],
        getRadius: 6,
        radiusMinPixels: 8,
        radiusMaxPixels: 16,
      }),
    );
  }

  overlay.setProps({ layers });
}

/** Clear all deck.gl layers */
export function clearRoute(): void {
  if (!overlay) return;
  storedCoordinates = null;
  storedLevels = null;
  storedIs3D = false;
  positionIndicatorData = null;
  previewEndpoints = [];
  overlay.setProps({ layers: [] });
}

/** Clear only search POIs, keep route */
export function clearPois(): void {
  if (!overlay) return;
  const currentLayers = overlay.props.layers || [];
  const routeLayers = currentLayers.filter((l: any) => l.id?.startsWith('route-'));
  overlay.setProps({ layers: routeLayers });
}
