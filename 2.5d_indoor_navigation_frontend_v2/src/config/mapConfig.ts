/**
 * Map interaction magic numbers — 한 곳에서 조정
 *
 * 빌딩별 상수(bearing, pitch 등)는 buildingConstants.json에 유지됩니다.
 */

export const MapConfig = {
  // ── 애니메이션 duration (ms) ──────────────────────
  /** 2D ↔ 3D 전환 */
  toggleDuration: 600,
  /** 센터링 버튼 */
  centerDuration: 800,
  /** 방 검색 → flyTo */
  flyToRoomDuration: 600,

  // ── 줌 ────────────────────────────────────────────
  /** flyToRoom 줌 레벨 */
  flyToRoomZoom: 20.5,

  // ── 라벨 ─────────────────────────────────────────
  /** ref 라벨 최소 표시 줌 (이 미만이면 숨김, 2D/3D 공통) */
  labelMinZoom: 17,

  // ── pitch 제한 ────────────────────────────────────
  /** 3D 모드 최대 pitch */
  maxPitch3D: 85,

  // ── 경로 표시 ──────────────────────────────────────
  route: {
    /** 경로 선 두께 (meters) */
    lineWidth: 4,
    /** 최소/최대 픽셀 두께 */
    lineWidthMinPx: 3,
    lineWidthMaxPx: 8,
    /** 출발/도착 마커 반지름 (meters) */
    endpointRadius: 8,
    endpointMinPx: 6,
    endpointMaxPx: 14,
    /** 층별 색상 그라데이션: 파란색 → 보라색 */
    colorFrom: [66, 165, 245] as readonly [number, number, number],   // #42A5F5
    colorTo: [171, 71, 188] as readonly [number, number, number],     // #AB47BC
    /** 몇 층 차이에서 보라색에 도달하는지 */
    colorSteps: 2,
    /** 출발 마커 색 */
    startColor: [76, 175, 80] as readonly [number, number, number],   // green
    /** 도착 마커 색 */
    endColor: [244, 67, 54] as readonly [number, number, number],     // red
    /** 현재 층 경로/마커 불투명도 (0-255) */
    activeOpacity: 255,
    /** 다른 층 경로/마커 불투명도 (0-255) */
    inactiveOpacity: 128,
  },

  // ── Walkthrough ───────────────────────────────────
  walkthrough: {
    /** 배속 선택지 */
    playbackRates: [0.5, 1, 2, 5, 10] as readonly number[],
  },
} as const;
