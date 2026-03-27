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

  // ── pitch 제한 ────────────────────────────────────
  /** 3D 모드 최대 pitch */
  maxPitch3D: 85,
} as const;
