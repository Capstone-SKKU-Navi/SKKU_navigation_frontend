import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type maplibregl from 'maplibre-gl';
import { getLevelBase, ROOM_THICKNESS, getCurrentLevel } from './indoorLayer';
import { MapConfig } from '../config/mapConfig';
import type { ApiRouteClip } from '../services/api/apiRoute';

/**
 * RouteOverlay — deck.gl overlay for dynamic route visualization
 *
 * 3D 모드에서는 각 좌표의 층(level) 정보를 기반으로 정확한 높이를 적용.
 * 2D↔3D 전환 시 자동 재렌더링.
 *
 * 영상이 없는 구간(드롭 핀에서 가장 가까운 복도까지의 꼬리, 영상 미등록 edge)은
 * 흐리게 그려 사용자에게 360° 워크스루가 불가한 영역을 시각적으로 알린다.
 */

let overlay: MapboxOverlay | null = null;

// 저장된 경로 데이터 (2D↔3D 전환 시 재렌더링용)
let storedCoordinates: GeoJSON.Position[] | null = null;
let storedLevels: number[] | null = null;
let storedHasVideo: boolean[] | null = null; // length = coords.length - 1
let storedIs3D = false;

// Walkthrough position indicator
let positionIndicatorData: PoiData | null = null;

const R = MapConfig.route;
const NO_VIDEO_OPACITY_FACTOR = 0.35;

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
 * @param clips       워크스루 클립 배열 — 각 segment(i, i+1)의 영상 유무 판정에 사용
 * @param is3D        3D 모드 여부
 */
export function showRoute(
  coordinates: GeoJSON.Position[],
  levels: number[] | null,
  clips: ApiRouteClip[] | null,
  is3D: boolean,
): void {
  storedCoordinates = coordinates;
  storedLevels = levels;
  storedHasVideo = buildHasVideoMask(coordinates.length, clips);
  storedIs3D = is3D;
  rebuildLayers();
}

/** 클립의 coordStartIdx ~ coordEndIdx 범위로 segment 단위 영상 커버리지 마스크 생성 */
function buildHasVideoMask(coordCount: number, clips: ApiRouteClip[] | null): boolean[] {
  const segCount = Math.max(0, coordCount - 1);
  const mask = new Array<boolean>(segCount).fill(false);
  if (!clips) return mask;
  for (const clip of clips) {
    const lo = Math.max(0, Math.min(clip.coordStartIdx, clip.coordEndIdx));
    const hi = Math.min(segCount, Math.max(clip.coordStartIdx, clip.coordEndIdx));
    for (let i = lo; i < hi; i++) mask[i] = true;
  }
  return mask;
}

/** 2D↔3D 전환 시 호출 */
export function setIs3D(is3D: boolean): void {
  storedIs3D = is3D;
  if (storedCoordinates) rebuildLayers();
}

/** 층 변경 시 경로 opacity 업데이트 */
export function onLevelChange(): void {
  if (!storedCoordinates) return;
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

/** 좌표 배열을 같은 (층, 영상유무) 끼리 연속 세그먼트로 분할 (인접 세그먼트는 끝점 공유) */
interface Segment {
  path: number[][];
  level: number;
  hasVideo: boolean;
}

function splitByLevelAndVideo(
  path3d: number[][],
  levels: number[] | null,
  hasVideo: boolean[] | null,
): Segment[] {
  if (path3d.length < 2) return [];

  const segCount = path3d.length - 1;
  const segLevel = (i: number) => levels?.[i] ?? 1;
  const segHasVideo = (i: number) => hasVideo?.[i] ?? true;

  const segments: Segment[] = [];
  let curLevel = segLevel(0);
  let curHas = segHasVideo(0);
  let curPath: number[][] = [path3d[0]];

  for (let i = 0; i < segCount; i++) {
    const segL = segLevel(i);
    const segV = segHasVideo(i);
    if (segL !== curLevel || segV !== curHas) {
      // close current segment at vertex i (shared with next)
      curPath.push(path3d[i]);
      if (curPath.length >= 2) segments.push({ path: curPath, level: curLevel, hasVideo: curHas });
      curLevel = segL;
      curHas = segV;
      curPath = [path3d[i]];
    }
    curPath.push(path3d[i + 1]);
  }

  if (curPath.length >= 2) {
    segments.push({ path: curPath, level: curLevel, hasVideo: curHas });
  }
  return segments;
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
    const segments = splitByLevelAndVideo(path3d, storedLevels, storedHasVideo);
    const minLevel = storedLevels ? Math.min(...storedLevels) : 1;
    const curLevel = getCurrentLevel();

    segments.forEach((seg, i) => {
      const baseColor = colorForLevel(seg.level, minLevel);
      const baseOpacity = seg.level === curLevel ? R.activeOpacity : R.inactiveOpacity;
      const opacity = seg.hasVideo ? baseOpacity : Math.round(baseOpacity * NO_VIDEO_OPACITY_FACTOR);
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
  storedHasVideo = null;
  // NOTE: storedIs3D is the camera-mode state, not route state. Don't reset
  // it here — the user may clear the route while still in 3D.
  positionIndicatorData = null;
  overlay.setProps({ layers: [] });
}

/** Clear only search POIs, keep route */
export function clearPois(): void {
  if (!overlay) return;
  const currentLayers = overlay.props.layers || [];
  const routeLayers = currentLayers.filter((l: any) => l.id?.startsWith('route-'));
  overlay.setProps({ layers: routeLayers });
}
