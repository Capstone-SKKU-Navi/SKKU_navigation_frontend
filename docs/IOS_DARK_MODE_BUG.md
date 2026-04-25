# iOS Safari × MapLibre × 다크모드: 알려진 문제와 시도한 해결책

> 작성일: 2026-04-25
> 상태: **미해결** — 표준 다크모드 구현은 적용했으나, iOS Safari에서 시스템 다크모드 활성화 시 맵이 검게 보이는 현상은 재현/수정하지 못함.

## 문제 상황

### 재현 환경
- 기기: iPhone (iOS Safari)
- 페이지: `http://172.30.1.54:8082/` (개발 서버, 로컬 IP, HTTP)
- 라이브러리: `maplibre-gl@^4.7.0`, raster basemap (CARTO Voyager via HTTPS)

### 증상
- iOS 시스템 다크모드 **OFF** → 맵 정상 표시.
- iOS 시스템 다크모드 **ON** → 맵 영역 전체가 검게 보임. UI 크롬(검색 필, 층 휠, 버튼 등)은 다크 테마로 정상 표시됨.
- 라이트 ↔ 다크 전환을 페이지 켠 채로 해도, 다크 상태로 처음 진입해도 동일.
- JS 콘솔 에러 없음 (eruda로 확인).
- 타일 fetch 성공 (네트워크 에러 없음).

### 데스크톱 WebKit에서는 재현 불가
Playwright의 WebKit 엔진 + 모바일 뷰포트 + dark-mode 토큰 강제 주입으로는 **맵이 정상 표시됨**. 즉 CSS 다크 테마 자체는 MapLibre 렌더링을 깨지 않으며, iOS Safari 전용 동작에서 발생하는 이슈로 추정됨.

---

## 시도했지만 실패한 해결책

| # | 시도한 것 | 결과 |
|---|---|---|
| 1 | `<meta name="color-scheme" content="light">` (dark 제외) | 변화 없음 |
| 2 | `<html>` 에 `color-scheme: light` CSS 선언 | 변화 없음 |
| 3 | `#mainContent`, `#map`에 `color-scheme: light` 선언 | 변화 없음 (`color-scheme`은 root → 자식으로만 전파, 역방향 영향 없음) |
| 4 | `#mainContent`, `#map`, `.maplibregl-canvas-container`, `.maplibregl-canvas`에 `background: #f5f3ee` 강제 | 변화 없음 (캔버스 픽셀은 GL이 그리므로 CSS bg가 위에 오지 않음) |
| 5 | MapLibre style에 `background` layer 추가 (`background-color: #f5f3ee`) | 변화 없음 |
| 6 | `HTMLCanvasElement.prototype.getContext` 몽키패치로 `alpha: false` 강제 (MapLibre v4는 `canvasContextAttributes` 옵션이 없음 — v5부터 지원) | 변화 없음 |
| 7 | `forced-color-adjust: none` + `filter: none !important` 맵 서브트리에 적용 | 변화 없음 |
| 8 | `<meta name="color-scheme" content="only light">` (엄격 opt-out) + `html { color-scheme: only light }` | 변화 없음 |
| 9 | `@media (prefers-color-scheme: dark)`를 제거하고 JS에서 `<html class="app-dark">` 클래스 토글로 다크 테마를 적용 (CSS가 다크모드를 "선언"하지 않도록) | 변화 없음 |

### 참고로 검토한 외부 자료
- [WebKit Bug #238135 — REGRESSION (Safari 15.4): WebGL canvas suddenly turns black](https://bugs.webkit.org/show_bug.cgi?id=238135) — 2022년 ANGLE 업그레이드로 해결됨. 본 이슈와는 다른 버그.
- [mapbox/mapbox-gl-js #13581 — iOS Beta 18.7.2, cannot get webgl2 context](https://github.com/mapbox/mapbox-gl-js/issues/13581) — HTTP origin + WebGL2 context loss. 본 이슈는 light 모드에서는 정상이므로 context loss는 아님.
- [google/model-viewer #5100 — WebGL broken in iOS/Safari 18.7.2 RC](https://github.com/google/model-viewer/issues/5100) — 위와 동일 카테고리.
- [WebKit Dark Mode Support](https://webkit.org/blog/8840/dark-mode-support-in-webkit/)
- [MDN `color-scheme`](https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme)

---

## 현재 코드 상태 (정리 후)

표준 다크모드 지원만 남기고 나머지 추측성 코드는 모두 제거함.

### 적용된 것
- `<meta name="color-scheme" content="light dark">` — 페이지가 두 모드를 처리함을 선언.
- `<meta name="theme-color">` × 2 (`prefers-color-scheme` 변형) — Android Chrome / iOS Safari 15+ 주소창 색.
- `_mobileChrome.scss`의 `@media (prefers-color-scheme: dark)` 블록 — 모바일 크롬용 토큰 (`--m-bg`, `--m-surface`, `--m-text` 등) 다크 변형.

### 제거된 것
- `<meta name="apple-mobile-web-app-capable">`, `apple-mobile-web-app-status-bar-style` (PWA 전용, 본 이슈와 무관).
- `<html>` / `body`의 `color-scheme: light` 또는 `only light` 선언.
- `#mainContent`, `#map`, `.maplibregl-canvas*`의 `forced-color-adjust`, `filter: none`, 명시적 light 배경.
- MapLibre style의 `background` 레이어.
- `main.ts`의 `HTMLCanvasElement.prototype.getContext` 몽키패치.
- JS-set `html.app-dark` 클래스 기반 테마 토글.

---

## 다음에 이 문제를 다시 보는 사람을 위한 가설

증상의 키 포인트:
1. iOS Safari 전용 (데스크톱 WebKit 재현 안 됨).
2. 시스템 다크모드 ON에서만 발생.
3. 라이트 모드는 완전 정상.
4. JS 에러 없음, 타일 fetch 성공.

가능한 원인 후보 (확신도 낮음, 실기 검증 필요):
1. **iOS Safari 사용자 설정** (가장 의심 가는 쪽이지만 미확인):
   - Settings → Safari → Advanced → Experimental Features → "Auto Dark Mode for Websites"
   - Settings → Accessibility → Display & Text Size → Smart Invert / Classic Invert
   - Settings → Accessibility → Display & Text Size → Increase Contrast
   - 위 옵션 중 하나가 켜져 있어 페이지에 시스템 레벨 필터가 적용되고 있을 가능성. 이 경우 페이지 측에서 100% 차단할 표준 방법이 없음.
2. **HTTP + LAN IP 조합의 iOS 17+ WebGL 정책**:
   - 일부 보고: 비보안 origin에서 WebGL2 context가 dark mode일 때만 deprioritize되는 케이스. 단, 본 이슈에서는 라이트 모드는 정상이므로 적합도 낮음.
   - HTTPS로 dev server를 띄우고(예: `mkcert`, `ngrok http`, `cloudflared tunnel`) 동일 증상 재현되는지 확인하면 분리 가능.
3. **iOS Safari 특정 버전의 WebGL × prefers-color-scheme 매칭 시 컴포지팅 버그**:
   - 페이지 CSS가 `prefers-color-scheme: dark`에 매치되는 규칙을 갖고 있고, 시스템이 다크일 때 캔버스가 시스템 dark 백킹과 합성되며 검게 됨. 단, 본 페이지에서 해당 미디어쿼리를 JS-class 방식으로 분리한 시도(#9)도 실패했으므로 이 가설도 확정 불가.

### 다음 단계로 제안하는 검증 절차
1. 사용자 폰의 iOS 버전을 확인.
2. 위 1번의 iOS 시스템 설정 3개를 한 번씩 OFF로 두고 페이지를 다시 열어보기. 어떤 항목을 OFF로 했을 때 맵이 보이는지 확인되면 원인 확정.
3. dev server를 HTTPS로 띄워 같은 문제가 재현되는지 확인. HTTPS에서 정상이면 #2번 가설(비보안 origin) 확정.
4. PC Safari (macOS) 다크모드에서 동일한 페이지를 열어 재현 시도. 재현되면 iOS 모바일 한정이 아닌 Safari 전체 이슈로 범위 확대.
5. 위 2~4 결과로 원인이 좁혀지면 그에 맞는 해결책을 시도.

---

## 교훈

- "한 모드에서만 깨지는" 증상은 컴포지팅/필터/시스템-레벨 색상 처리를 의심해야 함. WebGL context 초기화나 fetch 같은 기능적 레이어를 의심하는 건 이 패턴에 잘 안 맞음.
- 데스크톱 WebKit (Playwright)은 iOS Safari의 *완전한* 대체가 아님. 시스템 접근성 필터와 실험적 기능은 iOS 실기에서만 재현됨.
- `color-scheme`, `forced-color-adjust`, `alpha: false` 같은 워크어라운드는 종종 "fix folklore"로 인용되지만, 실제로 사용자 환경에 맞게 검증되지 않은 경우가 많음. 본 이슈에서도 9개 시도 전부 실효 없음.
