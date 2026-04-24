# 모바일 UI

휴대폰으로 접속 시 자동으로 활성화되는 터치 친화 UI. PC 페이지 동작은 그대로 보존되며, 모바일 코드는 `src/mobile/` 하위에 격리되어 PC 번들에 포함되지 않는다 (반대도 성립).

---

## 접근 방법

| 방식 | 동작 |
|------|------|
| 자동 감지 | `matchMedia('(max-width: 768px) and (pointer: coarse)')` 매치 시 모바일 |
| `?device=mobile` | 강제 모바일 (데스크톱 브라우저에서 디자인 확인용) |
| `?device=pc` | 강제 PC (모바일 기기에서 PC UI 확인용) |

판정 로직: [src/utils/deviceDetection.ts](../2.5d_indoor_navigation_frontend_v2/src/utils/deviceDetection.ts)

---

## 아키텍처

### 단일 번들, 런타임 분기
- 진입은 [src/main.ts](../2.5d_indoor_navigation_frontend_v2/src/main.ts) 하나. `mapLoaded` 이후 `isMobileDevice()` 결과에 따라 PC/모바일 체인을 선택.
- PC 체인: `setupFloorWheel / setupRoomSearch / setupRouteUI / setupRoomClickPopup / setupLayerToggle` + `setupGraphEditor` (dynamic import).
- 모바일 체인: `await import('./mobile').setupMobileChrome()` (dynamic import).
- `document.body.dataset.device` 속성으로 CSS도 분기.

### 번들 분리
webpack code-splitting으로 세 청크가 생성된다.

| 청크 | 용도 | PC 로드 | 모바일 로드 |
|------|------|---------|--------------|
| `bundle.js` | 공통 (엔진, 서비스) | O | O |
| `mobile.bundle.js` | 모바일 크롬 전용 | X | O |
| `editor.bundle.js` | 그래프 에디터 (PC 전용) | O | X |

### 공유 / 격리 원칙
- **공유**: `BackendService`, `apiClient`, `walkthroughPlanner`, `walkthroughPlayer`, `GeoMap`, `IndoorLayer`, `RouteOverlay`, `FloatingLabels`. 변경은 추가(exported helper)만, 기존 시그니처는 건드리지 않음.
- **공통 헬퍼** (PC + 모바일): [src/services/routeActions.ts](../2.5d_indoor_navigation_frontend_v2/src/services/routeActions.ts) — `setStart/setEnd/clearRoute/triggerFindRoute/selectRoom`. 이전에 `main.ts` 안에 인라인으로 있던 경로 처리를 추출.
- **모바일 전용**: `src/mobile/**` — PC 코드에서 직접 import 금지. 모바일에서만 `dynamic import`로 로드.
- **PC DOM 보존**: `public/index.html` 구조는 건드리지 않고, `body[data-device="mobile"]`일 때 CSS `display:none`으로 PC 크롬을 숨긴다. `#startRoomInput` / `#endRoomInput` 등 히든 인풋은 계속 존재하여 두 모드의 경로 머신이 공유한다.

---

## UI 구성

| 요소 | 위치 | 설명 |
|------|------|------|
| 검색 필 | 상단 | 탭하면 풀스크린 검색 모달 오픈 |
| 층 휠 | 좌측 중앙 | 세로 스와이프로 층 전환, 탭으로 직접 이동 |
| 액션 스택 | 우측 (검색 필 아래) | 건물 센터 / 2D·3D 토글 / 경로 지우기 (경로 활성 시) |
| 칩 로우 | 하단 | 방 선택 시 출발/도착 버튼, 둘 다 설정되면 "경로 찾기" 칩으로 변신 |
| 방 팝업 | 하단 카드 | 방 탭 → 표시. 출발/도착 버튼, 스와이프 다운하면 경로 해제 |
| 롱프레스 라디얼 | 포인터 위치 | 방 450ms 롱프레스 → 출발/도착/정보/닫기 원형 메뉴 |
| 바텀시트 | 하단 | 워크스루 영상. 피크(88px) ↔ 하프(50%) ↔ 풀(100dvh) |
| 검색 모달 | 풀스크린 | 검색 필 탭 시 오픈. 자동완성 실시간 |

---

## 터치 제스처 매핑

PC → 모바일 매핑:

| PC | 모바일 |
|----|--------|
| 좌클릭 방 | 탭 (방 팝업) |
| 우클릭 방 | 롱프레스 (라디얼 메뉴) |
| 휠 클릭 + 드래그 | 1손가락 팬 (MapLibre 기본) |
| 휠 스크롤 (층) | 층 휠 세로 스와이프 |
| 드래그 회전 | 2손가락 회전 (MapLibre 기본) |
| Esc (경로 해제) | 팝업 스와이프 다운 / 우측 × 버튼 / 시트 하이든까지 드래그 |

---

## 파일 구조

```
src/
├── utils/deviceDetection.ts     ← 디바이스 판정 (공유, 매우 작음)
├── services/routeActions.ts     ← 경로 헬퍼 (PC + 모바일 공유)
└── mobile/                      ← 100% 모바일 전용
    ├── index.ts                 ← setupMobileChrome() 엔트리
    ├── mobileChrome.ts          ← DOM 구성
    ├── gestures.ts              ← 롱프레스 / 스와이프 / 시트 드래그 / 휠 스와이프
    ├── searchModal.ts           ← 풀스크린 검색 모달
    ├── actionChipRow.ts         ← 하단 출발/도착 칩
    ├── radialMenu.ts            ← 롱프레스 라디얼
    ├── mobileFloorWheel.ts      ← 좌측 세로 휠
    ├── mobileActions.ts         ← 우측 액션 스택 (센터/3D/경로지우기)
    ├── bottomSheet.ts           ← 3상태 시트 프리미티브
    ├── walkthroughSheet.ts      ← 워크스루를 시트로 재부모화 + 카메라 패딩
    └── roomPopupMobile.ts       ← 하단 방 카드 (스와이프-다운-해제)
scss/
├── _mobileChrome.scss           ← `body[data-device="mobile"]` 게이트
└── _mobileBottomSheet.scss      ← 시트 + 워크스루 인시트 스타일
```

---

## 테스트 방법

### 1. Chrome DevTools (빠른 반복용)
1. `F12` → Toggle Device Toolbar (`Ctrl+Shift+M`) → iPhone 13 Pro 등 선택
2. **필수**: DevTools `⋮` → More tools → **Rendering** → **Emulate CSS media feature: `pointer: coarse`** 활성화
3. 혹은 `?device=mobile` 쿼리 파라미터로 우회
4. 2손가락 제스처: `Shift` + 마우스 드래그 = 핀치 / 회전 시뮬레이션

### 2. LAN 실기기 (가장 정확함)
```bash
cd 2.5d_indoor_navigation_frontend_v2
npm run dev
```
터미널에 출력되는 LAN URL(`http://192.168.x.x:8082`)을 같은 Wi-Fi에 연결된 폰 브라우저에서 연다. iOS Safari 및 Android Chrome 모두 동작.

`webpack.config.js`의 `devServer.host: '0.0.0.0'`, `allowedHosts: 'all'`로 이미 설정되어 있다.

### 3. 수동 회귀 체크리스트
- 방 탭 → 방 팝업 등장, 출발/도착 탭 → 칩 로우에 반영
- 방 롱프레스 → 라디얼 → 출발 선택 → 또 다른 방 탭 → 도착 → "경로 찾기" 칩 → 경로 + 워크스루 시트 (half)
- 시트 드래그: 피크 ↔ 하프 ↔ 풀 전이, 빠른 아래 플릭으로 하이든 = 경로 완전 해제
- 워크스루 재생 중 지도 드래그 → follow 토글 자동 해제
- 팝업 아래 80px+ 스와이프 → 경로 해제
- 우측 × 버튼 → 경로/워크스루/입력값 모두 초기화
- 2D/3D 토글 버튼 (우측 스택) 동작
- 검색 필 탭 → 풀스크린 모달 → 자동완성 → 선택 → flyTo + 층 자동 전환
- `?device=pc`로 PC 모드 회귀 (헤더 / PC 층휠 / 에디터 모두 정상)

---

## 설계상 주의점

### MapLibre 리사이즈
`data-device="mobile"`이 설정되면 CSS가 PC 헤더(56px)를 숨긴다. 맵이 초기화된 후에 이 레이아웃 변화가 일어나므로, [main.ts](../2.5d_indoor_navigation_frontend_v2/src/main.ts)에서 모바일 크롬 세팅 직후 `GeoMap.getMap()?.resize()`를 RAF로 호출한다. 누락하면 마커/경로 좌표와 지도 표시가 어긋남.

### 바텀시트 카메라 패딩
워크스루 follow 모드에서는 `map.setPadding({ bottom })`을 시트 상태에 맞춰 갱신한다 ([walkthroughSheet.ts](../2.5d_indoor_navigation_frontend_v2/src/mobile/walkthroughSheet.ts)). 지도 "중심" 기준이 시트가 가리지 않은 상단 영역으로 이동해 사용자가 보는 영상 위치 점과 지도 중심이 일치한다.

### 워크스루 영상 해상도
`.walkthrough-overlay.in-mobile-sheet`에 `max-height: calc(100dvh - var(--sheet-y) - 32px)`를 걸어 오버레이(= Three.js 컨테이너)를 보이는 영역만큼만 크게 만든다. 또 [walkthroughOverlay.ts](../2.5d_indoor_navigation_frontend_v2/src/components/walkthroughOverlay.ts)에 `ResizeObserver`를 달아 컨테이너 크기 변화 시 `player.resize(w, h)` 호출. 이 두 장치 없이는 내부 렌더러가 기본 480×320으로 그대로 그려져 휴대폰 해상도와 어긋남.

### Follow 해제 이중 경로
워크스루 도중 지도 드래그로 follow를 끄기 위해 두 리스너를 건다 ([walkthroughOverlay.ts](../2.5d_indoor_navigation_frontend_v2/src/components/walkthroughOverlay.ts#L442)):
1. `map.on('dragstart' / 'rotatestart')` — 일반 경로
2. 맵 캔버스의 `pointerdown` + 8px 이동 임계치 — `easeTo`가 계속 돌면서 MapLibre 드래그 감지가 간섭될 때의 백업

### iOS Safari 100vh
주소창 접힘으로 `100vh`가 실제 가시영역보다 커지는 이슈. 시트/검색 모달은 `100dvh`를 우선 사용, `@supports not (height: 100dvh) { 100vh }`로 폴백. 검색 모달은 `window.visualViewport.resize` 리스너로 키보드 대응.

### 비디오 오토플레이
iOS는 `muted + playsinline`이 없으면 자동 재생 실패. [walkthroughPlayer.ts](../2.5d_indoor_navigation_frontend_v2/src/components/walkthroughPlayer.ts)가 두 속성을 항상 설정한다.

---

## 향후 작업

- 햅틱 피드백 확대 (현재는 롱프레스에만 적용)
- 검색 자동완성 최근 기록
- 방 정보 카드(상세 설명 + 사진)를 두 번째 시트로 띄우기
- Playwright 시나리오를 CI에 추가 (지금은 세션 MCP 툴로만 수동 확인)
