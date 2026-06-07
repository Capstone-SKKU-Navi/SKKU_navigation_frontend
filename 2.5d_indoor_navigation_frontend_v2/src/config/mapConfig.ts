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

  // ── 패닝(드래그) 제한 ──────────────────────────────
  /**
   * 빌딩 union bbox 바깥으로 패닝 허용 여유(도 단위). 0이면 건물 가장자리에 보이지
   * 않는 벽이 생겨 답답함 → 여유를 둠. 좌우(lng)·상하(lat) 따로 조절.
   *   lng: 좌우(동서) 여유. 위도37° 기준 1도 ≈ 88km → 0.003 ≈ 약 264m.
   *   lat: 상하(남북) 여유. 1도 ≈ 111km → 0.003 ≈ 약 333m.
   * 좌우만 더 넓히려면 lng만 키워. null이면 패닝 제한 해제(maxBounds 미적용).
   */
  panBoundsPadding: { lng: 0.01, lat: 0.005 } as { lng: number; lat: number } | null,

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
    /** 360° 영상 없는 구간(회색 구간)을 건너뛰는 속도 배율. 클수록 빨리 넘어감. */
    gapSkipRate: 8,
    /** 비디오 화면 탭 영역 분할 (0~1, 화면 너비 기준). */
    tapZones: {
      /** 단일 탭으로 이전 구간 이동: 왼쪽 가장자리 끝 (이 값 미만). */
      skipPrevMaxFraction: 0.15,
      /** 단일 탭으로 다음 구간 이동: 오른쪽 가장자리 시작 (이 값 초과). */
      skipNextMinFraction: 0.85,
      /** 더블 탭 ±10초 방향 분기점 (이 값 미만=뒤로, 이상=앞으로). */
      seekSplitFraction: 0.5,
    },
    /** 더블 탭 인식 시간 창 (ms). 이 안에 두 번째 탭이 오면 탐색으로 승격. */
    doubleTapMs: 300,
  },
} as const;
