# SKKU 2.5D Indoor Navigation — Frontend

캡스톤 디자인 프로젝트 — 성균관대 자연과학캠퍼스 제1공학관 2.5D 실내 내비게이션 + 360° Walkthrough

## 기술 스택

| 역할 | 기술 |
|------|------|
| 언어 | TypeScript 5.8 |
| 번들러 | Webpack 5 |
| 지도 렌더링 | MapLibre GL v4 |
| 3D 시각화 | deck.gl v9 + Three.js r183 |
| 스타일 | SCSS |
| 백엔드 | Java Spring Boot (별도 레포) |
| Dev Server | localhost:8082 |

---

## 주요 기능

### 지도 & 3D 렌더링
- **2.5D 다층 실내 지도** — MapLibre GL 기반, 5개 층 동시 시각화 (활성 층 불투명, 비활성 층 반투명)
- **2D ↔ 3D 모드 전환** — 원클릭 토글, 600ms 애니메이션
- **room_type별 색상 코딩** — 교실(파랑)·실험실(초록)·화장실(보라)·사무실(주황)·계단(갈색)
- **벽 BufferGeometry merge** — draw call ~10으로 최적화
- **층 휠 셀렉터** — 좌측 사이드바 드래그/스크롤

### 경로 탐색
- **좌표 기반 경로 탐색** — 백엔드 API (`POST /api/route`) 또는 로컬 graph.json 자동 전환
- **다층 경로 시각화** — 층별 색상 그라데이션, 2초 draw 애니메이션
- **문 위치 근사** — 복도 엣지 수직투영으로 자연스러운 진입/퇴장 경로

### 360° Walkthrough
- **Three.js 360° 비디오 재생** — SphereGeometry + VideoTexture
- **Apple Look Around 패턴** — 상하 50% 분할, 전체화면 전환
- **더블 버퍼 클립 전환** — 끊김 없는 세그먼트 재생
- **고배속 재생** — 0.5x ~ 10x (seek 모드)
- **카메라 위치 지도 동기화** — 진행바 + 클립 탐색
- **계단/엘리베이터 영상 자동 계산** — 비디오 네이밍 v2

### 검색 & UI
- **방 번호 자동완성** — "21517 (5F, 교실)" 형태로 층+유형 표시
- **방 클릭 팝업** — 출발/도착 즉시 설정
- **레이어 토글** — 방, 복도, 3D, 라벨 개별 on/off

### 그래프 에디터 (개발 도구)
- 노드/간선 실시간 편집 + Undo/Redo (Command 패턴)
- 비디오 할당 (yaw, 시간범위, 방향) + 360° 프리뷰
- 방 코드 자동 조회 (room_codes.json) + 자동 저장
- 단축키: Z/Y(undo/redo), L(label), V(video), E(edge)

---

## 프로젝트 구조

```
SKKU-2.5D-Navigation_frontend/
├── 2.5d_indoor_navigation_frontend_v2/   # 메인 프론트엔드 앱
│   ├── src/
│   │   ├── components/                   # 지도, 3D 레이어, Walkthrough 플레이어
│   │   ├── config/                       # 지도 설정
│   │   ├── editor/                       # 그래프 에디터, 비디오 관리
│   │   ├── models/                       # 타입 정의
│   │   ├── services/                     # API, 경로 탐색, Walkthrough
│   │   ├── utils/                        # 좌표 변환, 건물 탐지
│   │   └── main.ts                       # 엔트리포인트
│   ├── public/geojson/                   # 정적 데이터 (GeoJSON, graph.json — 로컬 모드용)
│   ├── scss/                             # 스타일시트
│   ├── videos/                           # 360° 영상 (git 미포함)
│   ├── webpack.config.js
│   └── package.json
├── Geojson/                              # QGIS 원본 데이터
├── geojson_convert/                      # QGIS → 앱용 GeoJSON 변환 파이프라인
├── docs/                                 # 설계 문서
└── CLAUDE.md
```

---

## 빠른 시작

```bash
cd 2.5d_indoor_navigation_frontend_v2
npm install
npm run dev    # webpack dev server (localhost:8082, 자동 오픈)
```

프로덕션 빌드:

```bash
npm run build  # dist/ 폴더에 번들 생성
```

### 360° 영상 세팅

1. [공유 드라이브](https://drive.google.com/file/d/10toUrH2QPkQCoq1o22d0djIxiuP59Muh/view?usp=sharing)에서 `eng1_mp4/` 폴더를 받는다 (114개 mp4)
2. `2.5d_indoor_navigation_frontend_v2/videos/` 에 넣는다

영상 네이밍 규칙은 `docs/VIDEO_NAMING.md`, 상세 가이드는 `docs/360-video-guide.md` 참조.

---

## 백엔드 연동

프론트엔드는 **UI 렌더링 + 영상 재생**만 담당하며, 길찾기/그래프 처리는 백엔드에서 수행한다.
프론트엔드에 그래프 데이터(노드/엣지)는 전달되지 않는다.

```
프론트엔드 (localhost:8082)          백엔드 (localhost:8080)
─────────────────────               ─────────────────────
3D 지도 렌더링                       GeoJSON 서빙
좌표 기반 경로 요청        ←  API →  Dijkstra + 수선의발 + 클립 계산
360° 비디오 재생                      영상 파일 스트리밍
```

### 핵심 API

| Method | URL | 설명 |
|--------|-----|------|
| `POST` | `/api/route` | 좌표→좌표 경로 탐색 (경로 좌표 + 영상 클립 반환) |
| `GET` | `/api/geojson/...` | 건물/층별 GeoJSON 데이터 (3D 모델링용) |
| `GET` | `/api/videos/{filename}` | 360° 영상 스트리밍 (HTTP Range 지원) |
| `GET` | `/api/rooms/search?q=` | 방 번호/이름 검색 (centroid 좌표 포함) |

> 전체 API 문서: [docs/BACKEND_API.md](docs/BACKEND_API.md)

### 서비스 구조

```
src/services/
├── apiClient.ts          # 매니저 — local/api 전환, 동일한 ApiRouteResult 출력
├── local/
│   └── localRoute.ts     # 로컬 graph.json → ApiRouteResult 변환 (오프라인 개발용)
├── api/
│   └── apiRoute.ts       # POST /api/route 호출 (좌표 기반)
├── graphService.ts       # 그래프 로딩/탐색 (그래프 에디터 + 로컬 모드용)
├── backendService.ts     # GeoJSON 로딩, 비디오 URL 관리
└── walkthroughPlanner.ts # API 클립 → 재생 플레이리스트 조립
```

### 연동 전환

`apiClient.ts`의 `useApi` 플래그로 전환:
- `false` (기본) — 로컬 `graph.json`에서 Dijkstra + 클립 계산 → `ApiRouteResult` 형태로 반환
- `true` — 백엔드 `POST /api/route` 사용 (프로덕션)

두 모드 모두 동일한 `ApiRouteResult`를 출력하므로, `walkthroughPlanner.ts` 이후 코드는 모드에 무관하게 동작한다.

### 연동 현황

| 기능 | 로컬 모드 | API 모드 | 비고 |
|------|-----------|----------|------|
| 경로 탐색 | ✅ 자체 Dijkstra | ✅ POST /api/route | 좌표 기반, 동일한 ApiRouteResult 출력 |
| 영상 클립 계산 | ✅ 로컬 clip builder | ✅ 백엔드에서 계산 | yaw, 시간, 계단/엘리베이터 포함 |
| 방 검색 | ✅ GeoJSON 기반 | ✅ /api/rooms/search | API: centroid 좌표 포함 |
| GeoJSON 서빙 | ✅ 로컬 /geojson/ | ✅ /api/geojson/... | `setGeojsonBase()`로 전환 |
| 영상 서빙 | ✅ 로컬 /videos/ | ✅ /api/videos/ | `setVideoBase()`로 전환 |

### 알려진 제한사항

1. **API 주소 하드코딩** — `apiRoute.ts`에 `localhost:8080` 직접 기재. 환경변수 전환 미구현
2. **모드 전환** — `apiClient.ts`에서 코드로 `useApi` 변경 필요 (UI 토글 미구현)

> CORS: 백엔드가 `localhost:8082`, `localhost:3000` 허용.

---

## 아키텍처

| 레이어 | 기술 | 설명 |
|--------|------|------|
| 지도 렌더링 | MapLibre GL v4 | 2.5D 뷰, 층별 전환 |
| 3D 렌더링 | deck.gl v9 | 방 바닥(room_type별 그룹), 벽(BufferGeometry merge), 계단 |
| 경로 오버레이 | deck.gl PathLayer | 최단경로를 경로 라인으로 표시 (층별 색상 그라데이션) |
| 360° 비디오 | Three.js SphereGeometry + VideoTexture | Apple Look Around 패턴 (상하 분할) |
| 백엔드 | Java Spring Boot (별도 레포) | Dijkstra 길찾기 + 데이터 API |

---

## 문서

| 문서 | 설명 |
|------|------|
| [docs/DESIGN.md](docs/DESIGN.md) | 색상 팔레트, 레이아웃, 인터랙션 명세 |
| [docs/FILE_GUIDE.md](docs/FILE_GUIDE.md) | 핵심 파일 역할 가이드 |
| [docs/GRAPH_EDITOR.md](docs/GRAPH_EDITOR.md) | 그래프 에디터 사용법 (단축키, 영상 할당) |
| [docs/MULTI_BUILDING.md](docs/MULTI_BUILDING.md) | 다중 건물 추가 방법 |
| [docs/BUILDING_CODES.md](docs/BUILDING_CODES.md) | 건물 약어 코드 |
| [docs/360-video-guide.md](docs/360-video-guide.md) | 360° 영상 네이밍, 매핑, Walkthrough 아키텍처 |
| [docs/h264-high-speed-playback.md](docs/h264-high-speed-playback.md) | H.264 고배속 재생 기법 |
| [docs/BACKEND_API.md](docs/BACKEND_API.md) | 백엔드 API 상세 명세 (요청/응답 예시) |
| [docs/swagger.yaml](docs/swagger.yaml) | OpenAPI 3.0 (Swagger) API 명세 |
| [docs/ROUTE_ALGORITHM.md](docs/ROUTE_ALGORITHM.md) | 경로 계산 알고리즘 구현 가이드 (수선의 발, 클립 생성) |
| [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md) | 데이터 파일 구조 (graph.json, GeoJSON, video_settings) |
| [docs/rendering_tech_stack_change.md](docs/rendering_tech_stack_change.md) | v1→v2 렌더링 스택 변경 배경 |
| [docs/VIDEO_NAMING.md](docs/VIDEO_NAMING.md) | 360° 영상 네이밍 규칙 |

---

## 최근 변경

| 날짜 | 내용 |
|------|------|
| 04-03 | **API v2**: 좌표 기반 경로 API (`POST /api/route`), 프론트에서 그래프 제거, 로컬/API 동일 출력 |
| 04-03 | 그래프 에디터 방 코드 자동 조회 |
| 03-31 | room_type 지원, 백엔드 API 서비스 분리 (local/api) |
| 03-30 | 계단/엘리베이터 영상 자동 계산, 다중 건물 로딩 준비 |
| 03-28 | 360° Walkthrough 플레이어, Dijkstra 경로 탐색, 비디오 엣지 매핑 |

---

## 향후 작업

- [ ] **백엔드 API 연동 테스트** — Spring Boot 서버 연결 + 영상 스트리밍 확인
- [ ] **API 주소 환경변수** — `localhost:8080` 하드코딩 → 빌드/런타임 설정으로 전환
- [ ] **다중 건물 지원** — 2번째 건물 데이터 추가 + 건물 전환 UI
- [ ] **그래프 데이터 완성** — 3~5층 노드/간선, 엣지-비디오 매핑
- [ ] **모바일 반응형 최적화** — 터치 제스처, 레이아웃 조정
- [ ] **사용자 테스트** + 피드백 반영

자세한 내용은 [docs/TODOS.md](docs/TODOS.md) 참조.
