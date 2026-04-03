# Data Format — 프론트엔드 데이터 파일 구조

프론트엔드 그래프 에디터에서 작업한 데이터를 백엔드 DB로 가져갈 때 참고하는 문서.
모든 파일은 `public/geojson/` 폴더에 저장된다.

---

## 디렉토리 구조

```
public/geojson/
├── buildings.json              # 건물 코드 목록
├── graph.json                  # 경로 그래프 (노드 + 엣지 + 영상 매핑)
├── video_settings.json         # 영상별 yaw (시점 방향)
├── room_codes.json             # 방 번호 → 이름/유형 매핑 (학교 DB 기반)
└── eng1/                       # 건물별 폴더
    ├── manifest.json           # 건물 메타데이터
    ├── eng1_outline.geojson    # 건물 외곽선
    ├── eng1_room_L1.geojson    # 1층 방 폴리곤
    ├── eng1_room_L2.geojson    # 2층 방 폴리곤
    ├── eng1_wall_L1.geojson    # 1층 벽 폴리곤
    ├── eng1_wall_L2.geojson    # 2층 벽 폴리곤
    ├── eng1_collider_L1.geojson # 1층 복도 폴리곤
    └── ...                      # L3~L5 동일 패턴
```

---

## 1. buildings.json

사용 가능한 건물 코드 목록.

```json
["eng1"]
```

건물이 추가되면 배열에 코드를 추가하고 해당 폴더를 생성한다.

---

## 2. manifest.json (건물별)

경로: `{building}/manifest.json`

```json
{
  "building": "eng1",
  "name": "제1공학관",
  "loc_ref": "ENG1",
  "levels": [1, 2, 3, 4, 5]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `building` | `string` | 건물 코드 (폴더명과 일치) |
| `name` | `string` | 건물 한글 이름 |
| `loc_ref` | `string` | 건물 약어 코드 |
| `levels` | `number[]` | 사용 가능한 층 번호 배열 |

---

## 3. graph.json (핵심 — 경로 그래프)

그래프 에디터에서 노드/엣지를 찍고 저장하면 이 파일에 기록된다.
백엔드 DB의 노드/엣지 테이블로 가져가야 하는 데이터.

### 전체 구조

```json
{
  "nodes": {
    "node-mnd1qc8f-nt7s": { ... },
    "node-mnd1qe8k-fm0c": { ... }
  },
  "edges": [
    { "from": "...", "to": "...", ... },
    { "from": "...", "to": "...", ... }
  ]
}
```

### 노드 (Node)

키가 노드 ID인 오브젝트.

```json
{
  "node-mnd1qc8f-nt7s": {
    "coordinates": [126.97608234284479, 37.29361664601508],
    "level": 1,
    "type": "corridor",
    "label": ""
  }
}
```

| 필드 | 타입 | 설명 | 필수 |
|------|------|------|------|
| `coordinates` | `[number, number]` | `[경도, 위도]` WGS84 | O |
| `level` | `number` | 층 번호 | O |
| `type` | `string` | 노드 유형 (아래 표 참조) | O |
| `label` | `string` | 방 번호. `room` 타입만 사용 (예: `"21301"`). 나머지는 `""` | O |
| `verticalId` | `number` | 계단/엘리베이터 그룹 ID. 같은 계단통이면 같은 번호 | 조건부 |

**노드 타입:**

| type | 설명 | label | verticalId |
|------|------|-------|------------|
| `corridor` | 복도 교차점/꺾이는 지점 | `""` | - |
| `stairs` | 계단 출입구 (층별 하나씩) | `""` | 필수 (같은 계단 = 같은 ID) |
| `elevator` | 엘리베이터 출입구 (층별 하나씩) | `""` | 필수 |
| `entrance` | 건물 출입구 | `""` | - |
| `room` | 방 문 위치 (복도 쪽 벽 근처) | 방 번호 | - |

**verticalId 규칙:**
- 같은 계단/엘리베이터의 각 층 노드는 동일한 `verticalId`를 가진다
- 예: 계단3의 1층, 2층, 3층 노드 → 모두 `verticalId: 3`
- 층간 이동 시 연속된 `verticalId`가 같은 엣지를 그룹핑하여 진입/출구 영상을 계산한다

### 엣지 (Edge)

배열 형태. 각 엣지는 두 노드를 연결하고, 선택적으로 영상 정보를 포함.

**영상이 있는 엣지 (복도):**

```json
{
  "from": "node-mnd1scbv-fzry",
  "to": "node-mnd1sbmf-yt5i",
  "weight": 73,
  "videoFwd": "eng1_c_F4_12_cw.mp4",
  "videoFwdStart": 0,
  "videoFwdEnd": 49.215867,
  "videoRev": "eng1_c_F4_12_ccw.mp4",
  "videoRevStart": 0,
  "videoRevEnd": 49.916567
}
```

**영상이 없는 엣지 (계단 연결, 짧은 구간):**

```json
{
  "from": "node-mnd1sbmf-yt5i",
  "to": "node-mnd1s9jw-0rnz",
  "weight": 8
}
```

| 필드 | 타입 | 설명 | 필수 |
|------|------|------|------|
| `from` | `string` | 출발 노드 ID | O |
| `to` | `string` | 도착 노드 ID | O |
| `weight` | `number` | 거리 (미터) | O |
| `videoFwd` | `string` | 정방향(`from`→`to`) 영상 파일명 | - |
| `videoFwdStart` | `number` | 정방향 영상 시작 시간 (**초**) | - |
| `videoFwdEnd` | `number` | 정방향 영상 끝 시간 (**초**) | - |
| `videoRev` | `string` | 역방향(`to`→`from`) 영상 파일명 | - |
| `videoRevStart` | `number` | 역방향 영상 시작 시간 (**초**) | - |
| `videoRevEnd` | `number` | 역방향 영상 끝 시간 (**초**) | - |

**참고:**
- 영상이 없는 엣지는 `videoFwd` 등 필드가 아예 존재하지 않음
- 양방향 그래프: 하나의 엣지로 `from→to`, `to→from` 양쪽 탐색 가능
- 시간 단위: **초 (seconds)**, 밀리초 아님
- `videoFwd`/`videoRev`는 같은 복도를 양방향으로 찍은 별도 영상 파일

### DB 매핑 예시

```
graph.json nodes  →  DB Node 테이블
─────────────────────────────────
key (node ID)     →  id (PK)
coordinates[0]    →  longitude
coordinates[1]    →  latitude
level             →  level
type              →  type
label             →  label (nullable)
verticalId        →  vertical_id (nullable)

graph.json edges  →  DB Edge 테이블
─────────────────────────────────
from              →  from_node_id (FK)
to                →  to_node_id (FK)
weight            →  weight
videoFwd          →  video_fwd (nullable)
videoFwdStart     →  video_fwd_start (nullable)
videoFwdEnd       →  video_fwd_end (nullable)
videoRev          →  video_rev (nullable)
videoRevStart     →  video_rev_start (nullable)
videoRevEnd       →  video_rev_end (nullable)
```

---

## 4. video_settings.json

영상별 360° 초기 시점 방향 (yaw). 그래프 에디터의 비디오 설정 패널에서 조정.

```json
{
  "eng1_corridor_21_1F_cw.mp4": {
    "yaw": 189.87
  },
  "eng1_corridor_21_2F_ccw.mp4": {
    "yaw": 145.33
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| key | `string` | 영상 파일명 |
| `yaw` | `number` | 초기 시점 방향 (도, 0~360). 360° 영상에서 어느 방향을 정면으로 보여줄지 |

- 일부 영상은 `entryYaw`, `exitYaw` 필드가 있을 수 있음 (계단/엘리베이터용)
- 없는 영상은 기본값 `0`도

### DB 매핑

별도 테이블 또는 영상 테이블의 컬럼으로 저장:

```
video_settings.json  →  DB
────────────────────────────
key (filename)       →  video_filename
yaw                  →  yaw
```

---

## 5. room_codes.json

학교 DB에서 추출한 방 번호 → 이름/유형 매핑. 그래프 에디터에서 방 코드 자동 조회에 사용.

```json
{
  "21301": {
    "name": "일반물리학실험실",
    "name_en": "General Physics Lab",
    "room_type": "lab"
  },
  "21517": {
    "name": "",
    "name_en": "",
    "room_type": "classroom"
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| key | `string` | 방 번호 (ref) |
| `name` | `string` | 방 한글 이름 (없으면 `""`) |
| `name_en` | `string` | 방 영문 이름 |
| `room_type` | `string` | 방 유형: `classroom`, `lab`, `office`, `restroom`, `stairs`, `elevator`, `facility`, `storage`, `store`, `club`, `lounge`, `dining`, `dormitory`, `reserved` |

---

## 6. GeoJSON 파일 (건물별/층별)

QGIS에서 제작하여 변환 파이프라인(`geojson_convert/`)으로 생성.
프론트엔드에서 Three.js 3D 모델 렌더링에 사용.

### 6-1. 방 (room) — `{building}_room_L{level}.geojson`

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "indoor": "room",
        "level": [1],
        "ref": "23111",
        "name": "",
        "room_type": "",
        "_idx": 2,
        "_centroid": [126.9766083, 37.2943092],
        "_area_m2": 142.5,
        "_label_pos": [126.9765996, 37.2943075]
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[126.976, 37.294], [126.977, 37.294], ...]]
      }
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `indoor` | `string` | 항상 `"room"` |
| `level` | `number[]` | 층 번호 배열 (보통 1개) |
| `ref` | `string` | 방 번호 (빈 문자열이면 미지정) |
| `name` | `string` | 방 이름 |
| `room_type` | `string` | 방 유형 (room_codes.json의 값, 빈 문자열이면 미지정) |
| `_idx` | `number` | 순번 (변환 시 자동 생성) |
| `_centroid` | `[number, number]` | 방 중심 좌표 `[경도, 위도]` (변환 시 자동 계산) |
| `_area_m2` | `number` | 방 면적 (제곱미터) |
| `_label_pos` | `[number, number]` | 라벨 표시 위치 (선택) |
| geometry | `Polygon` 또는 `MultiPolygon` | 방 외곽 폴리곤 |

**백엔드에서 필요한 필드:**
- `ref` — 방 번호 (`/api/rooms/search` 응답에 사용)
- `_centroid` — 방 중심 좌표 (검색 결과의 `centroid` 필드로 반환)
- `level` — 층 번호
- `room_type` — 방 유형
- `geometry.coordinates` — 수선의 발 계산 시 방 폴리곤 참조 가능

### 6-2. 복도 (collider) — `{building}_collider_L{level}.geojson`

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "indoor": "corridor",
        "level": "1"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[126.976, 37.293], ...]]
      }
    }
  ]
}
```

- 복도 영역 폴리곤. 프론트엔드에서 3D 바닥 렌더링에 사용
- 백엔드에서는 직접 사용하지 않음

### 6-3. 벽 (wall) — `{building}_wall_L{level}.geojson`

```json
{
  "type": "FeatureCollection",
  "features": []
}
```

- 벽 폴리곤. 프론트엔드에서 3D 벽 렌더링에 사용
- 현재 일부 층은 빈 배열 (QGIS 작업 미완료)
- 백엔드에서는 사용하지 않음

### 6-4. 건물 외곽선 (outline) — `{building}_outline.geojson`

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "building": "university",
        "name": "제1공학관",
        "loc_ref": "ENG1"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[126.976, 37.293], ...]]
      }
    }
  ]
}
```

- 건물 전체 외곽 폴리곤. 2.5D 지도에서 건물 표시에 사용
- 백엔드에서는 사용하지 않음

---

## 백엔드 가져가기 요약

| 파일 | 용도 | DB 테이블 |
|------|------|-----------|
| `graph.json` → nodes | 경로 그래프 노드 | Node |
| `graph.json` → edges | 경로 그래프 엣지 + 영상 매핑 | Edge |
| `video_settings.json` | 영상 yaw 값 | VideoSettings 또는 Edge 컬럼 |
| `room_codes.json` | 방 이름/유형 | Room 또는 별도 테이블 |
| `*_room_L*.geojson` | 방 폴리곤 + centroid | Room 테이블 (centroid, geometry) |
| `buildings.json` + `manifest.json` | 건물 메타데이터 | Building |

**가져가기 절차:**
1. 프론트엔드 그래프 에디터에서 노드/엣지 편집 → `graph.json` 자동 저장
2. 비디오 설정 패널에서 yaw 조정 → `video_settings.json` 자동 저장
3. 쉘 스크립트로 `graph.json` + `video_settings.json` → DB INSERT/UPDATE
4. `room_codes.json`은 학교 DB에서 별도 관리
5. GeoJSON 파일은 QGIS → 변환 파이프라인으로 생성, 정적 파일로 서빙
