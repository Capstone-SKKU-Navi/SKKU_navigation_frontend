# SKKU 2.5D Indoor Navigation

캡스톤 디자인 프로젝트 — 성균관대 자연과학캠퍼스 제1공학관 2.5D 실내 내비게이션 + 360° Walkthrough

## 프로젝트 구조

```
├── 2.5d_indoor_navigation_frontend_v2/   # 메인 프론트엔드 앱 (TypeScript + MapLibre GL + deck.gl)
├── Geojson/                              # QGIS 원본 데이터 (방, 벽, 외곽선, 충돌체)
├── geojson_convert/                      # QGIS → 앱용 GeoJSON 변환 파이프라인
├── cad/                                  # CAD 참조 도구 (DXF/SVG 변환, QGIS 가이드)
├── buildings/                            # 건물 구조 데이터 (eng1.json)
├── reference/                            # UI/디자인 레퍼런스 이미지
├── SKKU_building_structure diagram/      # 건물 도면 원본 (JPG)
├── SKKU_building_structure diagram_resize/ # 건물 도면 리사이즈
├── sample_video/                         # 360° 샘플 영상
├── docs/                                 # 설계 문서 (DESIGN.md, BUILDING_CODES.md 등)
└── CLAUDE.md                             # Claude Code 프로젝트 지침
```

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

### Get Started: 360° 영상 세팅

그래프 에디터에서 엣지에 영상을 할당하거나, Walkthrough 재생을 하려면 360° 영상 파일이 필요하다.

1. 공유 드라이브에서 `eng1_mp4/` 폴더를 받는다 (48개 mp4, 약 1.2GB)
2. `2.5d_indoor_navigation_frontend_v2/videos/` 에 넣는다

```
2.5d_indoor_navigation_frontend_v2/
└── videos/
    ├── eng1_corridor_21_1F_cw.mp4
    ├── eng1_corridor_21_1F_ccw.mp4
    ├── eng1_stair_1_up.mp4
    ├── eng1_elev_1_1F.mp4
    └── ... (48개)
```

`videos/` 폴더는 `.gitignore`에 등록되어 있어 커밋되지 않는다.
영상 네이밍 규칙과 엣지 매핑 방법은 `docs/360-video-guide.md` 참조.

## 아키텍처

| 레이어 | 기술 | 설명 |
|--------|------|------|
| 지도 렌더링 | MapLibre GL v4 | 2.5D 뷰, 층별 전환 |
| 3D 렌더링 | deck.gl v9 | 방 바닥(room_type별 그룹), 벽(BufferGeometry merge), 계단 |
| 경로 오버레이 | deck.gl PathLayer | Dijkstra/A* 결과를 경로 라인으로 표시 (층별 색상 그라데이션) |
| 360° 비디오 | Three.js SphereGeometry + VideoTexture | Apple Look Around 패턴 (상하 분할) |
| 백엔드 | Java Spring Boot (별도 레포) | A* 길찾기 |
| API | `GET /api/route?from={nodeId}&to={nodeId}` | 경로 + 간선 + 클립 목록 |

## 완료된 작업

- [x] MapLibre GL + deck.gl 기반 2.5D 지도 렌더링 (5층)
- [x] deck.gl 3D 방/벽/계단 시각화 (MeshStandardMaterial, 라이팅)
- [x] 벽 BufferGeometry merge (draw calls 최적화)
- [x] room_type별 색상 시스템 (`docs/DESIGN.md` 참조)
- [x] 검색 자동완성 ("21517 (5F, 교실)" 형태)
- [x] 그래프 에디터 (노드/간선 추가·삭제, undo/redo)
- [x] 그래프 에디터 3D 모드 — 노드·간선을 층 높이에 맞춰 3D 렌더링 (SVG/HTML 오버레이)
- [x] 그래프 에디터 파일 저장 — `graph.json` 자동 저장 (localStorage → dev server PUT API)
- [x] 방 라벨 편집 — 클릭/숫자키로 ref·type 편집, 자동 저장 (`eng1_room_L{n}.geojson`)
- [x] 엣지 연속 연결 — 엣지 생성 후 자동 체인, 중복 방지, 우클릭 취소
- [x] 노드 타입 사전 선택 — add-node 모드에서 배치 전 타입 지정
- [x] 층별 전환 UI (휠 + 키보드)
- [x] 2D/3D 토글
- [x] QGIS 데이터 파이프라인 (1~2층 완료)
- [x] 플로팅 룸 라벨
- [x] **프론트엔드 경로 탐색** — Dijkstra 기반 최단경로 (graph.json 활용, 백엔드 API 교체 대비)
- [x] **방↔복도 이동 궤적** — room 노드(문 위치 마커) + corridor edge 수직 투영으로 자연스러운 경로
- [x] **경로 시각화** — deck.gl PathLayer, 층별 색상 그라데이션 (파란→보라), 출발/도착 마커
- [x] **경로 3D 렌더링** — 3D 모드에서 각 좌표가 해당 층 높이에 정확히 표시, 2D↔3D 전환 시 자동 재렌더링
- [x] **출발/도착 자동완성** — 방 검색 UI와 동일한 자동완성 드롭다운
- [x] **room 노드 자동 ref** — 그래프 에디터에서 room 타입 노드 배치 시 가장 가까운 방의 ref 자동 할당
- [x] **360° 비디오 카탈로그** — 48개 영상 (복도 30 + 계단 8 + 엘리베이터 10) 메타데이터 + 스마트 추천
- [x] **엣지-비디오 매핑** — 엣지별 양방향(FWD/REV) 비디오 할당, 복도 cw↔ccw 자동 역방향 할당
- [x] **비디오 시작 방향 설정** — Video Settings 패널에서 전체 영상의 초기 yaw 각도 일괄 설정 (Three.js 360° 프리뷰)
- [x] **계단/엘리베이터 입출 영상** — 수직 이동 엣지에 들어갈 때/나올 때 2개 클립 (같은 영상 또는 다른 영상)
- [x] **비디오 시간 범위** — 엣지별 startTime/endTime 설정 (360° 프리뷰 + 드래그 마커)
- [x] **다중 엣지 선택** — Shift+클릭으로 여러 엣지 선택, 체인 자동 감지 + 방향 표시
- [x] **다중 엣지 분할 할당** — Assign & Split: 한 영상을 N개 엣지에 분할점으로 나눠 할당
- [x] **360° 프리뷰 오버레이** — 드래그 회전, 휠 줌, 재생/일시정지(스페이스바), 시크바, 마커 드래그
- [x] **360° Walkthrough 플레이어** — 경로 기반 360° 영상 재생, 세그먼트 전환 (더블 버퍼링), Three.js VideoTexture
- [x] **Walkthrough 위치 표시** — 재생 위치를 지도 위 주황색 원으로 실시간 표시, 카메라 추적 + 자동 층 전환
- [x] **고배속 재생** — 0.5x/1x/2x/5x/10x 배속 지원, >2x는 seek 기반 스테핑 (H.264 디코더 병목 우회)
- [x] **그래프 에디터 실시간 동기화** — 에디터 저장 시 경로 탐색 그래프 자동 리로드 (새로고침 불필요)
- [x] **다중 엣지 체인 정렬 개선** — 좌표 기반 정렬 → 알파벳순 노드 ID 정렬로 단순화, REV 방향 분할 할당 수정

## 남은 작업

- [ ] **3~5층 GeoJSON 데이터 제작** (QGIS → `geojson_convert/convert.py`)
- [ ] **그래프 데이터 완성** — 전 층 노드/간선 생성 (그래프 에디터 활용)
- [ ] **엣지-비디오 매핑 완성** — 전체 엣지에 비디오/시간 할당 (그래프 에디터 활용)

## 핵심 파일 가이드

### 프론트엔드 (`2.5d_indoor_navigation_frontend_v2/src/`)

| 파일 | 역할 |
|------|------|
| `main.ts` | 앱 엔트리포인트, 초기화 흐름 |
| `components/geoMap.ts` | MapLibre GL 지도 컨트롤러 |
| `components/indoorLayer.ts` | 방/벽/계단 3D 렌더링 (핵심, 12KB) |
| `components/floatingLabels.ts` | 룸 라벨 포지셔닝 |
| `components/routeOverlay.ts` | 경로 렌더링 (층별 세그먼트 분할, 3D 높이 적용) |
| `editor/graphEditor.ts` | 그래프 에디터 메인 컨트롤러 (키보드, 자동저장) |
| `editor/graphEditorMap.ts` | 에디터 지도 렌더링 (2D 레이어 + 3D SVG/HTML 오버레이) |
| `editor/graphEditorPanel.ts` | 에디터 UI 패널 (노드·방 속성, 모드 전환) |
| `editor/graphEditorState.ts` | 에디터 상태 관리 (undo/redo, graph.json 파일 저장) |
| `editor/graphEditorTypes.ts` | 에디터 타입 정의 (NavNode, NavEdge, Command 등) |
| `editor/videoCatalog.ts` | 360° 비디오 카탈로그 (48개 영상 메타데이터, 스마트 추천) |
| `editor/videoSettings.ts` | 비디오별 초기 yaw 각도 관리 (`video_settings.json`) |
| `editor/videoSettingsPanel.ts` | Video Settings 패널 (영상별 방향 일괄 설정) |
| `editor/videoPreview.ts` | 360° 프리뷰 오버레이 (Three.js, yaw/time-range/split 모드) |
| `components/walkthroughOverlay.ts` | Walkthrough UI 오케스트레이터 (오버레이, 프로그레스 바, 배속, 카메라 추적) |
| `components/walkthroughPlayer.ts` | 360° 세그먼트 재생 엔진 (더블 버퍼링, seek 기반 고배속) |
| `components/walkthroughTypes.ts` | Walkthrough 타입 정의 (Clip, Segment, Playlist) |
| `services/walkthroughPlanner.ts` | 경로 → 비디오 클립 플레이리스트 변환 (위치 보간, 부분 엣지 처리) |
| `services/backendService.ts` | GeoJSON 로딩 + 방 정보 조회 (centroid, polygon, level) |
| `services/graphService.ts` | 경로 탐색 엔진 (Dijkstra, 문 위치 근사, corridor edge 투영) |
| `services/apiClient.ts` | 경로 API 클라이언트 (로컬 Dijkstra ↔ 백엔드 A* 전환) |
| `config/mapConfig.ts` | 지도 인터랙션 + 경로 표시 상수 (한 곳에서 조정) |
| `models/types.ts` | 핵심 TypeScript 인터페이스 |

### 데이터 파이프라인

| 파일 | 역할 |
|------|------|
| `Geojson/eng1_room_L*.geojson` | QGIS 디지타이징한 방 폴리곤 (층별) |
| `Geojson/eng1_wall_L*.geojson` | 벽 폴리곤 (층별) |
| `Geojson/eng1_collider_L*.geojson` | 충돌체 geometry (층별) |
| `Geojson/eng1_outline.geojson` | 건물 외곽선 |
| `geojson_convert/convert.py` | QGIS 출력 → 앱 호환 GeoJSON 변환 |
| `cad/QGIS_GUIDE.md` | QGIS 작업 가이드 (새 층 추가 시 참조) |

### 디자인

| 파일 | 역할 |
|------|------|
| `docs/DESIGN.md` | 색상 팔레트, 레이아웃, 인터랙션 명세 |
| `docs/BUILDING_CODES.md` | 방 번호체계 및 건물 구조 코드 |
| `reference/` | UI 레퍼런스 이미지 |

## 그래프 에디터 사용법

헤더의 **hub** 아이콘으로 활성화. 노드/간선을 편집하여 내비게이션 그래프를 구축한다.

| 단축키 | 동작 |
|--------|------|
| `Q` | 선택 모드 |
| `W` | 노드 추가 모드 (타입 사전 선택 가능) |
| `E` | 엣지 추가 모드 (연속 연결, 우클릭/Esc로 취소) |
| `R` | 방 라벨 편집 모드 (숫자키로 ref 직접 입력) |
| `Ctrl+Z/Y` | Undo / Redo |
| `Delete` | 선택된 노드 삭제 |
| `Backspace` | 방 라벨 ref 마지막 글자 삭제 |
| `Esc` | 선택 해제 / 엣지 연결 취소 |

- **자동 저장**: 노드/간선 → `public/geojson/graph.json`, 방 라벨 → `public/geojson/eng1/eng1_room_L{n}.geojson` (dev server PUT API)
- **3D 모드**: 모든 노드·간선을 층 높이에 맞춰 표시, 비활성 층은 반투명 처리

## 주요 설계 결정

- **벽만 merge, 방은 그룹화**: 벽은 BufferGeometry merge로 ~1개 draw call, 방 바닥은 room_type별 ~10개 그룹
- **MeshStandardMaterial**: metalness 0.1, roughness 0.85 (AmbientLight 0.6 + DirectionalLight 0.8)
- **VideoTexture**: 클립 전환 시 반드시 `.dispose()` 호출 (메모리 누수 방지)
- **색상**: `docs/DESIGN.md`의 ROOM_COLORS 룩업 테이블 기준
- **MapLibre → deck.gl**: v1 Maptalks에서 MapLibre GL + deck.gl로 렌더링 스택 변경 (v2)
