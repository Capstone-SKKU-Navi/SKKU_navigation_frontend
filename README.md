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

## 아키텍처

| 레이어 | 기술 | 설명 |
|--------|------|------|
| 지도 렌더링 | MapLibre GL v4 | 2.5D 뷰, 층별 전환 |
| 3D 렌더링 | deck.gl v9 | 방 바닥(room_type별 그룹), 벽(BufferGeometry merge), 계단 |
| 경로 오버레이 | deck.gl PathLayer | A* 결과를 dashed polyline으로 표시 |
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

## 남은 작업

- [ ] **3~5층 GeoJSON 데이터 제작** (QGIS → `geojson_convert/convert.py`)
- [ ] **백엔드 연동** — Spring Boot A* 길찾기 API 연결
- [ ] **경로 시각화** — 경로 응답을 지도 위 dashed polyline으로 렌더링
- [ ] **3~5층 GeoJSON 데이터 제작** (QGIS → `geojson_convert/convert.py`)
- [ ] **그래프 데이터 완성** — 전 층 노드/간선 생성 (그래프 에디터 활용)
- [ ] **360° 비디오 촬영 및 클립 연결** — 경로 간선에 비디오 매핑
- [ ] **360° 비디오 플레이어** — 통합 시크바, 클립 전환, 마우스 회전
- [ ] **비디오 상하 분할 뷰** — 상단 50% 비디오 + 하단 50% 지도, 전체화면 전환
- [ ] **다국어** — 한국어 번역 파일 추가 (현재 영어/독일어만 있음)

## 핵심 파일 가이드

### 프론트엔드 (`2.5d_indoor_navigation_frontend_v2/src/`)

| 파일 | 역할 |
|------|------|
| `main.ts` | 앱 엔트리포인트, 초기화 흐름 |
| `components/geoMap.ts` | MapLibre GL 지도 컨트롤러 |
| `components/indoorLayer.ts` | 방/벽/계단 3D 렌더링 (핵심, 12KB) |
| `components/floatingLabels.ts` | 룸 라벨 포지셔닝 |
| `components/routeOverlay.ts` | 경로 polyline 렌더링 |
| `editor/graphEditor.ts` | 그래프 에디터 메인 컨트롤러 (키보드, 자동저장) |
| `editor/graphEditorMap.ts` | 에디터 지도 렌더링 (2D 레이어 + 3D SVG/HTML 오버레이) |
| `editor/graphEditorPanel.ts` | 에디터 UI 패널 (노드·방 속성, 모드 전환) |
| `editor/graphEditorState.ts` | 에디터 상태 관리 (undo/redo, graph.json 파일 저장) |
| `editor/graphEditorTypes.ts` | 에디터 타입 정의 (NavNode, NavEdge, Command 등) |
| `services/backendService.ts` | GeoJSON 로딩 + API 통신 |
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
- **비디오 패턴**: Apple Look Around — 상단 50% 비디오 + 하단 50% 지도, 전체화면 전환 지원
- **VideoTexture**: 클립 전환 시 반드시 `.dispose()` 호출 (메모리 누수 방지)
- **색상**: `docs/DESIGN.md`의 ROOM_COLORS 룩업 테이블 기준
- **MapLibre → deck.gl**: v1 Maptalks에서 MapLibre GL + deck.gl로 렌더링 스택 변경 (v2)
