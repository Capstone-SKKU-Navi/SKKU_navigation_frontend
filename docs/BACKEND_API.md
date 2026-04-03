# Backend API Specification (v2)

프론트엔드-백엔드 연동 API 명세.
2026-04-03 회의 결정사항 반영: 프론트엔드는 그래프 데이터를 갖지 않고, 좌표 기반으로 경로를 요청한다.

> 백엔드 기본 주소: `http://localhost:8080`

---

## 설계 원칙

1. **프론트엔드에 그래프 없음** — `graph.json`, 노드/엣지 정보를 프론트엔드에 전달하지 않는다.
2. **좌표 기반 API** — 방 번호가 아닌 좌표(lng, lat, level)로 경로를 요청한다. 방 검색/자동완성은 프론트엔드가 GeoJSON에서 로컬 처리한다.
3. **경로 응답에 영상 정보 포함** — 백엔드가 다익스트라, 수선의 발, 영상 시간 계산을 모두 처리하고, 프론트엔드는 영상 클립을 이어붙이기만 한다.
4. **GeoJSON은 3D 모델링용** — 건물/방/벽 GeoJSON은 프론트엔드가 Three.js로 렌더링하는 데만 사용한다.

---

## 1. GET /api/geojson/...

건물/층별 GeoJSON 파일을 서빙한다. 프론트엔드가 3D 모델 렌더링에 사용.

### 요청 예시

```
GET /api/geojson/buildings.json
GET /api/geojson/eng1/manifest.json
GET /api/geojson/eng1/eng1_room_L2.geojson
GET /api/geojson/eng1/eng1_wall_L2.geojson
GET /api/geojson/eng1/eng1_collider_L2.geojson
GET /api/geojson/eng1/eng1_outline.geojson
```

### 응답

현재 `public/geojson/` 폴더의 파일을 그대로 서빙하면 된다.
`Content-Type: application/json`

> 프론트엔드에서 `backendService.ts`의 `setGeojsonBase('http://localhost:8080/api/geojson')` 호출로 전환.

---

## 2. POST /api/route

두 좌표 사이의 최단경로를 탐색하고, 경로 좌표 + 영상 클립 정보를 반환한다.

### 요청

```
POST /api/route
Content-Type: application/json
```

```json
{
  "from": {
    "lng": 126.97652,
    "lat": 37.29412,
    "level": 3
  },
  "to": {
    "lng": 126.97710,
    "lat": 37.29380,
    "level": 1
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `from.lng` | number | 출발 경도 (WGS84) |
| `from.lat` | number | 출발 위도 |
| `from.level` | number | 출발 층 |
| `to.lng` | number | 도착 경도 |
| `to.lat` | number | 도착 위도 |
| `to.level` | number | 도착 층 |

### 응답 (경로 있음)

실제 로컬 실행 결과 예시 (23222호 3F → 23111호 1F):

```json
{
  "found": true,
  "route": {
    "coordinates": [
      [126.976978, 37.2941731],
      [126.97697317, 37.29419677],
      [126.97697454, 37.29420933],
      [126.97636762, 37.29427538],
      [126.97636429, 37.29431458],
      [126.97635587, 37.29432044],
      [126.97633198, 37.29428274],
      [126.97658637, 37.29425380],
      [126.97658759, 37.29426459],
      [126.9766083, 37.2943092]
    ],
    "levels": [3, 3, 3, 3, 3, 1, 1, 1, 1, 1],
    "totalDistance": 98,
    "estimatedTime": "1분",
    "startLevel": 3,
    "endLevel": 1
  },
  "walkthrough": {
    "clips": [
      {
        "index": 0,
        "videoFile": "eng1_c_F3_9_ccw.mp4",
        "videoStart": 12.94,
        "videoEnd": 50.78,
        "duration": 37.85,
        "yaw": 0,
        "level": 3,
        "isExitClip": false,
        "coordStartIdx": 2,
        "coordEndIdx": 3,
        "routeDistStart": 4.07,
        "routeDistEnd": 58.26
      },
      {
        "index": 1,
        "videoFile": "eng1_e_1_3e.mp4",
        "videoStart": 0,
        "videoEnd": 3,
        "duration": 3,
        "yaw": 113.2,
        "level": 3,
        "isExitClip": false,
        "coordStartIdx": 4,
        "coordEndIdx": 4,
        "routeDistStart": 62.63,
        "routeDistEnd": 62.63
      },
      {
        "index": 2,
        "videoFile": "eng1_e_1_1o.mp4",
        "videoStart": 0,
        "videoEnd": 3,
        "duration": 3,
        "yaw": 247.47,
        "level": 1,
        "isExitClip": true,
        "coordStartIdx": 5,
        "coordEndIdx": 5,
        "routeDistStart": 63.62,
        "routeDistEnd": 63.62
      },
      {
        "index": 3,
        "videoFile": "eng1_c_F1_3_ccw.mp4",
        "videoStart": 0,
        "videoEnd": 15.18,
        "duration": 15.18,
        "yaw": 184.93,
        "level": 1,
        "isExitClip": false,
        "coordStartIdx": 6,
        "coordEndIdx": 7,
        "routeDistStart": 68.31,
        "routeDistEnd": 91.04
      }
    ],
    "videoStartCoordIdx": 2,
    "videoEndCoordIdx": 7
  }
}
```

### 응답 (경로 없음)

```json
{
  "found": false,
  "error": "경로를 찾을 수 없습니다"
}
```

### 필드 설명

**route:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `coordinates` | `[number,number][]` | 경로 폴리라인 (경도,위도 배열). 지도에 경로선을 그릴 때 사용 |
| `levels` | `number[]` | coordinates와 병렬 — 각 좌표의 층 번호 |
| `totalDistance` | `number` | 총 경로 거리 (미터) |
| `estimatedTime` | `string` | 예상 도보 시간 (예: `"약 2분"`) |
| `startLevel` | `number` | 출발 층 |
| `endLevel` | `number` | 도착 층 |

**walkthrough.clips[]:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `index` | `number` | 클립 순번 (0부터) |
| `videoFile` | `string` | 영상 파일명 (예: `"eng1_c_F3_9_cw.mp4"`) |
| `videoStart` | `number` | 영상 내 시작 시간 (**초**) |
| `videoEnd` | `number` | 영상 내 종료 시간 (**초**) |
| `duration` | `number` | `videoEnd - videoStart` (초) |
| `yaw` | `number` | 360° 영상 초기 시점 방향 (도) |
| `level` | `number` | 이 클립 재생 중 층 번호 |
| `isExitClip` | `boolean` | 계단/엘리베이터 출구 영상 여부 |
| `coordStartIdx` | `number` | `route.coordinates` 배열에서 이 클립 시작 인덱스 |
| `coordEndIdx` | `number` | `route.coordinates` 배열에서 이 클립 끝 인덱스 |
| `routeDistStart` | `number` | 경로 시작점으로부터의 누적 거리 (미터) — 클립 시작 |
| `routeDistEnd` | `number` | 경로 시작점으로부터의 누적 거리 (미터) — 클립 끝 |

**walkthrough (top-level):**

| 필드 | 타입 | 설명 |
|------|------|------|
| `videoStartCoordIdx` | `number` | 영상이 시작되는 coordinates 인덱스 (수선의 발 위치) |
| `videoEndCoordIdx` | `number` | 영상이 끝나는 coordinates 인덱스 |

### 백엔드 내부 처리 흐름

프론트엔드에 노출되지 않지만, 이 API가 내부적으로 수행하는 작업:

1. 입력 좌표에서 가장 가까운 복도 엣지를 찾고 수선의 발을 내림
2. 수선의 발 좌표를 기준으로 다익스트라 최단경로 탐색
3. 좌표 체인 생성: `[클릭좌표] → [수선의발] → [그래프노드들...] → [수선의발] → [클릭좌표]`
4. 근접 좌표 중복 제거 (~1m 간격)
5. 각 엣지에 대해 영상 파일 선택 (정방향/역방향), 부분 시간 계산
6. 계단/엘리베이터 엣지: 연속 수직 엣지 그룹핑, 진입/출구 영상 파일명 계산
7. `video_settings.json`에서 yaw 값 조회
8. 누적 거리 계산

---

## 3. GET /api/videos/{filename}

영상 파일을 스트리밍한다. HTTP Range 요청 지원 필수 (영상 시킹에 필요).

### 요청

```
GET /api/videos/eng1_c_F3_9_cw.mp4
Range: bytes=0-1048575
```

### 응답

```
HTTP/1.1 206 Partial Content
Content-Type: video/mp4
Accept-Ranges: bytes
Content-Length: 1048576
Content-Range: bytes 0-1048575/52428800
```

Body: 영상 바이트 데이터

> 프론트엔드의 `<video>` 태그 src를 `/api/videos/{filename}`으로 지정하면 브라우저가 자동으로 Range 요청을 보낸다.

---

## 방 검색 (프론트엔드 처리)

방 검색/자동완성은 **백엔드 API가 아닌 프론트엔드에서 처리**한다.
프론트엔드가 앱 시작 시 GeoJSON 파일을 로드하면 방 번호(ref), 이름(name), 유형(room_type), 중심 좌표(centroid)를 이미 보유하므로 별도 API 없이 로컬에서 검색한다.

사용자가 방을 선택하면, GeoJSON에서 가져온 centroid 좌표를 `POST /api/route`의 `from` 또는 `to`에 넣어 호출한다.

---

## 삭제된 API

| 기존 API | 상태 | 이유 |
|----------|------|------|
| `GET /api/graph` | **삭제** | 프론트엔드에 그래프 데이터를 전달하지 않음 |
| `GET /api/route?from=방번호&to=방번호` | **대체** | `POST /api/route` (좌표 기반)으로 대체 |
| `GET /api/nodes/search` | **삭제** | 프론트엔드가 GeoJSON에서 로컬 검색 처리 |

---

## 프론트엔드 연동 변경사항

### 이전 흐름 (graph.json 사용)
```
앱 시작 → GET /api/graph (노드+엣지 전체) → 프론트엔드에 그래프 저장
검색 → GET /api/route?from=방번호&to=방번호 → 프론트엔드가 edgePath 재구성 → 영상 클립 계산
```

### 새 흐름 (그래프 없음)
```
앱 시작 → GET /api/geojson/... (3D 모델링용만)
검색 → 방 선택 → centroid 좌표 획득
경로 → POST /api/route { from: {좌표}, to: {좌표} } → 좌표 + 영상 클립 직접 수신
영상 → GET /api/videos/{filename} (Range 지원)
```

프론트엔드는 `route.coordinates`와 `route.levels`로 경로를 그리고,
`walkthrough.clips`로 영상 재생 순서를 구성한다. 그래프 데이터 불필요.

---

## 백엔드 필요 데이터

백엔드가 경로 계산 + 영상 클립 생성을 위해 DB에 가져가야 하는 프론트엔드 데이터:

| 파일 | 용도 | DB 테이블 |
|------|------|-----------|
| `graph.json` → nodes | 경로 그래프 노드 (좌표, 층, 타입, verticalId) | Node |
| `graph.json` → edges | 경로 그래프 엣지 (weight, 영상 파일/시간) | Edge |
| `video_settings.json` | 영상별 yaw 값 (360° 시점 방향) | VideoSettings 또는 Edge 컬럼 |
| `room_codes.json` | 방 이름/유형 | Room |
| `*_room_L*.geojson` | 방 폴리곤 + centroid | Room (centroid, geometry) |
| `buildings.json` + `manifest.json` | 건물 메타데이터 | Building |

> 파일 구조 상세: [DATA_FORMAT.md](DATA_FORMAT.md)
> 경로 계산 알고리즘: [ROUTE_ALGORITHM.md](ROUTE_ALGORITHM.md)
