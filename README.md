# SKKU 2.5D Indoor Navigation

캡스톤 디자인 프로젝트 — 성균관대 자연과학캠퍼스 제1공학관 2.5D 실내 내비게이션 + 360° Walkthrough

## 프로젝트 구조

```
├── 2.5d_indoor_navigation_frontend/   # 메인 프론트엔드 앱 (TypeScript + Maptalks + Three.js)
├── Geojson/                           # QGIS 원본 데이터 (방, 벽, 외곽선)
├── geojson_convert/                   # QGIS → 앱용 GeoJSON 변환 파이프라인
├── cad/                               # CAD 참조 도구 (DXF/SVG 변환, QGIS 가이드)
├── buildings/                         # 건물 구조 데이터
├── reference/                         # UI/디자인 레퍼런스 이미지
├── SKKU_building_structure diagram/   # 건물 도면 원본 (JPG)
├── SKKU_building_structure diagram_resize/  # 건물 도면 리사이즈
├── DESIGN.md                          # 디자인 시스템 (색상, 레이아웃, 인터랙션)
├── generate_geojson.py                # 도면 좌표 → GeoJSON 생성
├── extract_rooms.py                   # OpenCV 기반 방 폴리곤 자동 추출
├── generate_building.py               # 건물 모델 생성
└── verify_building.py                 # 데이터 검증
```

## 빠른 시작

```bash
cd 2.5d_indoor_navigation_frontend
npm install
npm run build-start    # webpack 빌드 + 서버 시작 (localhost:3000)
```

개발 시에는 `npm run watch`로 자동 빌드, 별도 터미널에서 `npm start`로 서버 실행.

## 아키텍처

| 레이어 | 기술 | 설명 |
|--------|------|------|
| 지도 렌더링 | Maptalks + maptalks.three | 2.5D 뷰, 층별 전환 |
| 3D 렌더링 | Three.js | 방 바닥(room_type별 그룹), 벽(BufferGeometry merge), 계단 |
| 360° 비디오 | Three.js SphereGeometry + VideoTexture | Apple Look Around 패턴 (상하 분할) |
| 백엔드 | Java Spring Boot (별도 레포) | A* 길찾기 |
| API | `GET /api/route?from={nodeId}&to={nodeId}` | 경로 + 간선 + 클립 목록 |

## 완료된 작업

- [x] Maptalks 기반 2.5D 지도 렌더링 (5층까지)
- [x] Three.js 방/벽/계단 3D 시각화
- [x] MeshStandardMaterial + 라이팅 (metalness: 0.1, roughness: 0.85)
- [x] 벽 BufferGeometry merge (draw calls 최적화)
- [x] room_type별 색상 시스템 (DESIGN.md 참조)
- [x] 검색 자동완성 ("21517 (5F, 교실)" 형태)
- [x] 도면 에디터 (그리기 도구, GeoJSON 내보내기, 이미지 오버레이)
- [x] 층별 전환 (휠 UI + 키보드)
- [x] 2D/3D 토글
- [x] QGIS 데이터 파이프라인 (1층 완료)

## 남은 작업

- [ ] **2~5층 GeoJSON 데이터 제작** (QGIS 파이프라인 + `geojson_convert/convert.py`)
- [ ] **백엔드 연동** — Spring Boot A* 길찾기 API 연결
- [ ] **경로 시각화** — 백엔드 응답을 지도 위 dashed polyline으로 표시
- [ ] **360° 비디오 촬영 및 클립 연결** — 경로 간선에 비디오 매핑
- [ ] **에디터 자동 저장** — LocalStorage/IndexedDB 자동 저장 (브라우저 크래시 복구)
- [ ] **그래프 데이터 완성** — 전 층 노드/간선 생성 (에디터의 graphTools 활용)
- [ ] **다국어** — 한국어 번역 파일 추가 (현재 영어/독일어만 있음)
- [ ] 360° 비디오 플레이어 (통합 시크바, 클립 전환, 마우스 회전)
- [ ] 비디오 상하 분할 뷰 + 전체화면 전환
- [ ] Maptalks 기반 2.5D 지도 렌더링 polishing
- [ ] Three.js 방/벽/계단 3D 시각화 polishing

## 핵심 파일 가이드

### 프론트엔드 (`2.5d_indoor_navigation_frontend/src/`)

| 파일 | 역할 |
|------|------|
| `main.ts` | 앱 엔트리포인트, 초기화 흐름 |
| `components/geoMap.ts` | 지도 컨트롤러 (Maptalks 인스턴스 관리) |
| `components/indoorLayer.ts` | 방 렌더링 (가장 큰 컴포넌트, 26KB) |
| `components/ui/searchForm.ts` | 검색 + 자동완성 |
| `components/ui/videoPlayer.ts` | 360° 비디오 플레이어 |
| `components/editor/` | 도면 에디터 (그리기, 내보내기, 그래프) |
| `services/backendService.ts` | 데이터 로딩 + API 통신 |
| `services/routeService.ts` | 경로 탐색 로직 |
| `services/colorService.ts` | room_type 색상 매핑 |

### 데이터 파이프라인

| 파일 | 역할 |
|------|------|
| `Geojson/eng1_rooms_L1.geojson` | QGIS에서 디지타이징한 1층 방 폴리곤 |
| `geojson_convert/convert.py` | QGIS 출력 → 앱 호환 GeoJSON 변환 |
| `cad/QGIS_GUIDE.md` | QGIS 작업 가이드 (새 층 추가 시 참조) |

### 디자인

| 파일 | 역할 |
|------|------|
| `DESIGN.md` | 색상 팔레트, 레이아웃, 인터랙션 명세 |
| `reference/` | UI 레퍼런스 이미지 (ArcGIS Indoors, MazeMap 스타일) |

## 주요 설계 결정

- **벽만 merge, 방은 그룹화**: 벽은 BufferGeometry merge로 1개 draw call, 방 바닥은 room_type별 ~10개 그룹
- **MeshStandardMaterial**: metalness 0.1, roughness 0.85 (AmbientLight 0.6 + DirectionalLight 0.8)
- **비디오 패턴**: Apple Look Around — 상단 50% 비디오 + 하단 50% 지도, 전체화면 전환 지원
- **VideoTexture**: 클립 전환 시 반드시 `.dispose()` 호출 (메모리 누수 방지)
- **색상**: `DESIGN.md`의 ROOM_COLORS 룩업 테이블 기준

## 테스트

```bash
cd 2.5d_indoor_navigation_frontend
npm test              # Jest 테스트 실행
npm run test:coverage # 커버리지 포함
```

