# 핵심 파일 가이드

## 프론트엔드 (`2.5d_indoor_navigation_frontend_v2/src/`)

| 파일 | 역할 |
|------|------|
| `main.ts` | 앱 엔트리포인트, 초기화 흐름, 경로 검색 UI |
| `components/geoMap.ts` | MapLibre GL 지도 컨트롤러 |
| `components/indoorLayer.ts` | 방/벽/계단 3D 렌더링 (핵심, 12KB) |
| `components/floatingLabels.ts` | 룸 라벨 포지셔닝 |
| `components/routeOverlay.ts` | 경로 렌더링 (층별 세그먼트 분할, 3D 높이 적용) |
| `components/walkthroughOverlay.ts` | Walkthrough UI 오케스트레이터 (오버레이, 프로그레스 바, 배속, 카메라 추적) |
| `components/walkthroughPlayer.ts` | 360° 세그먼트 재생 엔진 (더블 버퍼링, seek 기반 고배속) |
| `components/walkthroughTypes.ts` | Walkthrough 타입 정의 (Clip, Segment, Playlist) |
| `editor/graphEditor.ts` | 그래프 에디터 메인 컨트롤러 (키보드, 자동저장) |
| `editor/graphEditorMap.ts` | 에디터 지도 렌더링 (2D 레이어 + 3D SVG/HTML 오버레이) |
| `editor/graphEditorPanel.ts` | 에디터 UI 패널 (노드·방 속성, 모드 전환) |
| `editor/graphEditorState.ts` | 에디터 상태 관리 (undo/redo, graph.json 파일 저장) |
| `editor/graphEditorTypes.ts` | 에디터 타입 정의 (NavNode, NavEdge, Command 등) |
| `editor/videoCatalog.ts` | 복도 비디오 카탈로그 (30개, 스마트 추천). 계단/엘리베이터는 자동 계산 |
| `editor/videoSettings.ts` | 비디오별 초기 yaw 각도 관리 (`video_settings.json`) |
| `editor/videoSettingsPanel.ts` | Video Settings 패널 (건물>타입>층 접는 트리 UI) |
| `editor/videoPreview.ts` | 360° 프리뷰 오버레이 (Three.js, yaw/time-range/split 모드) |
| `utils/verticalVideoFilename.ts` | 계단/엘리베이터 영상 파일명 자동 계산 (verticalId + 층 정보 기반) |
| `utils/buildingDetection.ts` | 좌표 기반 건물 코드 탐지 (polygon containment + 지리 heuristic) |
| `utils/coordinateHelpers.ts` | 좌표 거리 계산 (haversine) |

## 서비스 레이어 (`src/services/`)

| 파일 | 역할 |
|------|------|
| `apiClient.ts` | 라우팅 매니저 — local/api 전환, 동일한 `ApiRouteResult` 출력 |
| `api/apiRoute.ts` | 백엔드 API 호출 (`POST /api/route`, 좌표 기반) |
| `local/localRoute.ts` | 로컬 graph.json → Dijkstra + 클립 빌더 → `ApiRouteResult` 변환 |
| `graphService.ts` | 그래프 로딩/탐색 엔진 (Dijkstra, 수선의 발, 문 위치 근사). 그래프 에디터 + 로컬 모드용 |
| `backendService.ts` | 다중 건물 GeoJSON 로딩, 방 centroid/폴리곤 조회, 비디오 URL 관리 |
| `walkthroughPlanner.ts` | API 클립 → 재생 플레이리스트 조립 (글로벌 타이밍, 세그먼트 그룹핑, 위치 보간) |

## 모델/설정 (`src/models/`, `src/config/`)

| 파일 | 역할 |
|------|------|
| `models/types.ts` | 핵심 TypeScript 인터페이스 (RoomListItem, LevelData, BuildingManifest 등) |
| `config/mapConfig.ts` | 지도 인터랙션 + 경로 표시 상수 (한 곳에서 조정) |

## 데이터 파일 (`public/geojson/`)

| 파일 | 역할 |
|------|------|
| `buildings.json` | 건물 코드 목록 |
| `graph.json` | 경로 그래프 (노드 + 엣지 + 영상 매핑) — 로컬 모드 + 그래프 에디터용 |
| `video_settings.json` | 영상별 yaw (시점 방향) |
| `room_codes.json` | 방 번호 → 이름/유형 매핑 (학교 DB 기반) |
| `{building}/manifest.json` | 건물 메타데이터 (이름, 층 목록) |
| `{building}/*_room_L*.geojson` | 층별 방 폴리곤 (ref, centroid, room_type) |
| `{building}/*_wall_L*.geojson` | 층별 벽 폴리곤 |
| `{building}/*_collider_L*.geojson` | 층별 복도 폴리곤 |
| `{building}/*_outline.geojson` | 건물 외곽선 |

> 데이터 파일 상세 구조: [DATA_FORMAT.md](DATA_FORMAT.md)

## 데이터 파이프라인

| 파일 | 역할 |
|------|------|
| `Geojson/eng1_rooms_L*.geojson` | QGIS CAD 원본 방 폴리곤 (층별, MultiPolygon) |
| `Geojson/eng1_corridors_L*.geojson` | QGIS CAD 원본 복도 폴리곤 (층별) |
| `Geojson/eng1_outline.geojson` | 건물 외곽선 |
| `geojson_convert/convert.py` | QGIS 출력 → 앱 호환 GeoJSON 변환 (양쪽 네이밍 자동 감지) |
| `cad/QGIS_GUIDE.md` | QGIS 작업 가이드 (새 층 추가 시 참조) |

## 문서

| 파일 | 역할 |
|------|------|
| `docs/BACKEND_API.md` | 백엔드 API 명세 (요청/응답 형식) |
| `docs/swagger.yaml` | OpenAPI 3.0 (Swagger) API 명세 |
| `docs/ROUTE_ALGORITHM.md` | 경로 계산 알고리즘 구현 가이드 |
| `docs/DATA_FORMAT.md` | 데이터 파일 구조 (graph.json, GeoJSON → DB 매핑) |
| `docs/DESIGN.md` | 색상 팔레트, 레이아웃, 인터랙션 명세 |
| `docs/GRAPH_EDITOR.md` | 그래프 에디터 사용법 (단축키, 영상 할당) |
| `docs/VIDEO_NAMING.md` | 360° 비디오 네이밍 컨벤션 v2 |
| `docs/360-video-guide.md` | 360° 영상 Walkthrough 아키텍처 |
| `docs/BUILDING_CODES.md` | 방 번호체계 및 건물 구조 코드 |
| `docs/MULTI_BUILDING.md` | 다중 건물 추가 방법 |
