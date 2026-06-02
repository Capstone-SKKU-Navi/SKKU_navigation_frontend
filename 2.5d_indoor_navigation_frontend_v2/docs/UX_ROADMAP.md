# UX 개선 로드맵 — 상용 서비스 벤치마킹

> 생성: 2026-05-30. YouTube · KakaoMap/Naver Map · Street View/Look Around/로드뷰 · 모바일 지도 앱 ·
> 실내 길찾기 앱(Google indoor / Mappedin)의 UX를 조사하고, 현재 프론트엔드와 비교해 도출한 개선 항목.
> 각 항목은 실제 코드(`src/`)를 grep으로 검증한 뒤 정리함. `[x]` = 이번 라운드 구현 완료.

## 배포 형상

- **단일 반응형 배포** 확정. 하나의 빌드(`npm run build:prod`)가 런타임 기기 감지(`isMobileDevice` / `?device=mobile`)로
  PC·모바일 UI를 분기. 별도 폴더/URL 분리 안 함 — 코드 중복·분기 비용 제거.
- `build:prod`는 editor/디버그 UI/소스맵/console.log/editor 청크를 제거. 추가로 editor 전용 데이터
  (`geojson/editor/**`, `geojson/room_codes.json`, 약 1.8 MiB)도 prod 복사에서 제외(수정 완료).

---

## Tier 1 — 배포 전 필수 (must-fix)

| # | 항목 | 영역 | 공수 | 상태 |
|---|------|------|------|------|
| 1 | `viewport-fit=cover` 추가 — 노치 기기에서 `env(safe-area-inset-*)`가 실제 적용되도록 (현재 0으로 무력화) | mobile | S | [x] |
| 2 | 경로 ETA/거리 모바일 노출 — 계산은 되나(`routeActions.ts:316`) `#appHeader` 가 모바일에서 `display:none` 이라 안 보임 | mobile | M | [x] |
| 3 | 모바일 줌 +/- · 나침반 FAB — `NavigationControl`이 모바일에서 숨겨져 핀치가 유일한 줌 수단 | mobile | M | [x] |
| 4 | 모바일 워크스루 닫기/접기(경로 유지) — 시트 drag-to-hidden이 `clearRoute()`로 경로까지 삭제 | mobile | S | [x] |
| 5 | 360° 콜드 로드 중 버퍼링 스피너 — 20s 타임아웃 동안 정지화면이 일시정지와 구분 안 됨 | walkthrough | M | [x] |
| 6 | 구(sphere) 핀치 줌 FOV — 현재 wheel 전용이라 터치에서 줌 불가 | mobile | M | [x] |

## Tier 2 — 고가치 (high-value)

| # | 항목 | 영역 | 공수 | 상태 |
|---|------|------|------|------|
| 1 | 경로 계산 시 카메라 자동 fit (route bbox) — 현재 `fitBounds` 미사용, 경로가 화면 밖일 수 있음 | routing | S | [x] |
| 2 | 출발↔도착 swap 버튼 — 현재 둘 다 다시 입력해야 역방향 가능 | routing | S | [x] |
| 3 | 층 전환(계단/엘리베이터) 마커 — 멀티층 경로에서 층이 바뀌는 지점 표시 없음 | routing | M | [x] |
| 4 | 워크스루 키보드 단축키(±5/±10s, 속도, 재생, Shift+? 치트시트) — 현재 Space만 | walkthrough | M | [x] |
| 5 | 모바일 더블탭 좌/우 영역 ±10s 시크 + 방향 OSD — 현재 6px 트랙만이 시크 수단 | mobile | M | [x] |
| 6 | 맵 점에 sphere 바라보는 방향(부채꼴 wedge) 표시 — "어느 방향을 보는가" 단서 없음 | walkthrough | M | [x] |
| 7 | 공유/딥링크 URL(방·경로 인코딩) — 현재 상태가 URL에 안 남음 | both | M | [x] |
| 8 | 검색 결과 포커스 — 비매칭 방 디밍 + 라벨 강제 표시 + 마커 | search | M | [x] |
| 9 | 모바일 recenter 패딩 가림 보정 + follow 상태 아이콘 | mobile | M | [x] |

## Tier 3 — 추후 (nice-to-have)

워크스루: 위치 readout / 정면복귀 버튼 / 팬 관성 / 컨트롤 자동 숨김+scrim / 맵클릭→sphere 점프 /
스크럽 위치 미리보기 / 도착 카드+리플레이 / follow 복귀 버튼 / 설정 기어 팝오버 / 세그먼트 크로스페이드 /
sphere 내 클릭 핫스팟(L).
검색: 최근 검색 / 카테고리 칩(화장실·엘리베이터·출구).
경로: 접근성 경로(계단 회피) 옵션(L, 백엔드 파라미터 필요).
지도: 스케일바 / you-are-here·geolocation(L) / 모바일 층·건물 컨텍스트 뱃지 / PC 플로어휠 높이 제한.
모바일: 확인 토스트+Undo+햅틱 / 하드웨어 back 으로 radial·시트 닫기 / 방 상세를 멀티스냅 시트로 통일(L).
PC: 라이트/다크 메타태그 불일치 정리.

---

## 출처별 핵심 인사이트

- **YouTube**: 더블탭 ±10s 시크 + 방향 OSD, 단축키(J/K/L·화살표·<>·f), 버퍼링 스피너(일시정지와 구분),
  스크럽 미리보기, 컨트롤 자동 숨김.
- **KakaoMap/Naver**: 줌 +/- 버튼 + 나침반(회전 시만 표시), 현재위치 + heading cone, 길찾기 요약(거리·ETA),
  출발↔도착 swap, 장소 상세 bottom sheet, 공유/딥링크, 카테고리 칩.
- **Street View/Look Around/로드뷰**: 진행방향 화살표/리본, inset 미니맵 + 시야 부채꼴, 부드러운 크로스페이드,
  나침반/정면 복귀, 맵점↔파노 위치 연동(양방향).
- **모바일 지도 chrome**: 멀티스냅 bottom sheet(peek/half/full), FAB 클러스터, safe-area inset, 엄지 도달 영역,
  하드웨어 back 처리.
- **실내 길찾기(Mappedin 등)**: 층 전환 아이콘(계단/엘리베이터) + "3F→5F" 콜아웃, 목적지 강조+라벨,
  도보 거리/시간, 비활성 층 디밍, 카테고리/편의시설 검색.
