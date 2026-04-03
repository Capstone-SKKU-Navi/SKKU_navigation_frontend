# Route Algorithm — 경로 계산 구현 가이드

`POST /api/route` 응답을 생성하기 위해 백엔드가 구현해야 하는 알고리즘.
프론트엔드의 레퍼런스 구현: `localRoute.ts`, `graphService.ts`

---

## 입력 데이터

### 1. 그래프 (DB)

노드와 엣지로 구성된 건물 내 경로 그래프.

**노드 (Node):**

```json
{
  "id": "node-mnd1qc8f-nt7s",
  "coordinates": [126.97608, 37.29361],   // [경도, 위도] WGS84
  "level": 1,                              // 층 번호
  "type": "corridor",                      // corridor | stairs | elevator | entrance | room
  "label": "",                             // room 타입만 방 번호 (예: "21301")
  "verticalId": 3                          // stairs/elevator만 — 같은 계단/엘리베이터 그룹 ID
}
```

**엣지 (Edge):**

```json
{
  "from": "node-abc",                // 출발 노드 ID
  "to": "node-def",                  // 도착 노드 ID
  "weight": 73,                      // 거리 (미터)
  "videoFwd": "eng1_c_F4_12_cw.mp4", // 정방향(from→to) 영상 파일명
  "videoFwdStart": 0,                // 정방향 영상 시작 (초)
  "videoFwdEnd": 49.21,              // 정방향 영상 끝 (초)
  "videoRev": "eng1_c_F4_12_ccw.mp4",// 역방향(to→from) 영상 파일명
  "videoRevStart": 0,                // 역방향 영상 시작 (초)
  "videoRevEnd": 49.91               // 역방향 영상 끝 (초)
}
```

- 영상이 없는 엣지는 `videoFwd`, `videoRev` 등이 없거나 null
- 양방향 그래프: `from→to`와 `to→from` 모두 탐색 가능
- 시간 단위: **초 (seconds)**

### 2. video_settings.json

영상별 초기 시점 방향 (yaw). 360° 영상에서 어느 방향을 보고 시작하는지.

```json
{
  "eng1_corridor_21_1F_cw.mp4": { "yaw": 189.87 },
  "eng1_s_3_1eu.mp4": { "entryYaw": 45, "exitYaw": 315 }
}
```

- 복도 영상: `yaw` 필드
- 계단/엘리베이터 영상: `entryYaw` 또는 `exitYaw` 또는 `yaw`
- 없으면 기본값 `0`

### 3. GeoJSON (방 폴리곤)

방의 형태와 위치 정보. centroid(중심점) 계산과 문 위치 근사에 사용.

```json
{
  "type": "Feature",
  "properties": { "ref": "21301", "name": "일반물리학실험실", "room_type": "lab" },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[126.976, 37.294], [126.977, 37.294], [126.977, 37.295], [126.976, 37.295], [126.976, 37.294]]]
  }
}
```

---

## 전체 알고리즘 흐름

```
입력: from = {lng, lat, level}, to = {lng, lat, level}

1. 입력 좌표 → 가장 가까운 복도 엣지에 수선의 발 (perpendicular foot)
2. 수선의 발 → 다익스트라 최단경로
3. 좌표 체인 조립 (경로 폴리라인)
4. 엣지별 영상 클립 생성
5. 응답 조립

출력: { found, route: {coordinates, levels, ...}, walkthrough: {clips, ...} }
```

---

## Step 1: 수선의 발 (Perpendicular Foot Projection)

입력 좌표에서 같은 층의 가장 가까운 복도 엣지 위에 수직 투영점을 구한다.

### 알고리즘

```
function projectOntoNearestEdge(point, level):
    bestEdge = null
    bestDist = ∞

    for each edge in graph.edges:
        nodeA = nodes[edge.from]
        nodeB = nodes[edge.to]

        // 같은 층 필터링
        if nodeA.level ≠ level AND nodeB.level ≠ level: skip
        // room 노드가 포함된 엣지 제외
        if nodeA.type == "room" OR nodeB.type == "room": skip

        A = nodeA.coordinates  // [lng, lat]
        B = nodeB.coordinates

        // 점 P를 선분 AB에 투영
        dx = B[0] - A[0]
        dy = B[1] - A[1]
        lenSq = dx² + dy²
        if lenSq == 0: skip

        t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / lenSq
        t = clamp(t, 0, 1)    // 선분 밖이면 끝점으로

        projX = A[0] + t * dx
        projY = A[1] + t * dy

        dist = sqrt((P[0] - projX)² + (P[1] - projY)²)

        if dist < bestDist:
            bestDist = dist
            bestEdge = {
                point: [projX, projY],
                nodeA: edge.from,
                nodeB: edge.to,
                distToA: haversine(proj, A),  // 미터 단위
                distToB: haversine(proj, B)   // 미터 단위
            }

    return bestEdge
```

### 설명

```
          P (입력 좌표, 방 중심)
          |
          | ← 수선
          |
    A ----F------------ B    (복도 엣지)
          ^
          수선의 발 (F = projection point)

distToA = A에서 F까지 거리 (미터)
distToB = F에서 B까지 거리 (미터)
```

- 투영 파라미터 `t`는 0~1 사이로 클램프 → 선분 밖이면 가장 가까운 끝점
- 거리 비교는 유클리드 (경위도 소규모에서 충분)
- `distToA`, `distToB`는 haversine 또는 미터 단위 거리 함수 사용

---

## Step 2: 다익스트라 최단경로

수선의 발이 내린 엣지의 양 끝점을 기준으로 다익스트라를 실행한다.

### 4가지 조합 탐색

출발/도착 각각 엣지의 양 끝점(A, B)이 있으므로 4가지 조합을 탐색하고 최단을 선택:

```
fromProj = 출발 수선의 발 → edge(fromA, fromB)
toProj   = 도착 수선의 발 → edge(toA, toB)

candidates = [
    dijkstra(fromA, toA) + fromProj.distToA + toProj.distToA,
    dijkstra(fromA, toB) + fromProj.distToA + toProj.distToB,
    dijkstra(fromB, toA) + fromProj.distToB + toProj.distToA,
    dijkstra(fromB, toB) + fromProj.distToB + toProj.distToB,
]

bestPath = min(candidates)
```

### 같은 엣지 체크

출발과 도착이 같은 엣지 위에 있으면 (`sameEdge = true`) 다익스트라 불필요:

```
sameEdge = (fromProj.nodeA == toProj.nodeA AND fromProj.nodeB == toProj.nodeB)
        OR (fromProj.nodeA == toProj.nodeB AND fromProj.nodeB == toProj.nodeA)
```

### 백트래킹 방지

다익스트라 결과 경로에서 수선의 발 엣지 위를 되돌아가는 경우를 제거:

```
path = dijkstra result  // [node1, node2, node3, ...]

// 출발: path 첫 두 노드가 모두 fromProj 엣지의 끝점이면 → 첫 노드 제거
if path[0] ∈ {fromProj.nodeA, fromProj.nodeB}
   AND path[1] ∈ {fromProj.nodeA, fromProj.nodeB}:
    path = path[1:]

// 도착: 마지막 두 노드가 모두 toProj 엣지의 끝점이면 → 마지막 노드 제거
if path[-1] ∈ {toProj.nodeA, toProj.nodeB}
   AND path[-2] ∈ {toProj.nodeA, toProj.nodeB}:
    path = path[:-1]
```

---

## Step 3: 좌표 체인 조립

경로를 좌표 배열로 조립한다. 지도에 경로선을 그리는 데 사용.

### 구조

```
coordinates = [
    입력좌표(from),           // centroid 또는 클릭 좌표
    수선의 발(from),          // fromProj.point
    그래프 노드 좌표들...,     // trimmedPath의 각 노드 coordinates
    수선의 발(to),            // toProj.point
    입력좌표(to)              // centroid 또는 클릭 좌표
]

levels = [
    fromLevel,
    fromLevel,
    각 노드의 level...,
    toLevel,
    toLevel
]
```

### 근접 좌표 중복 제거

연속된 좌표가 ~1m 이내이면 제거:

```
MIN_GAP = 0.000009   // 약 1미터 (경위도 기준)

deduped = [coordinates[0]]
for i = 1 to len(coordinates):
    dx = coordinates[i][0] - deduped.last[0]
    dy = coordinates[i][1] - deduped.last[1]
    if dx² + dy² > MIN_GAP²:
        deduped.push(coordinates[i])
```

---

## Step 4: 영상 클립 생성

경로의 각 엣지에 대해 영상 클립 정보를 생성한다.

### 4-1. 엣지 목록 구성 (edgePath)

```
edgePath = []

if sameEdge:
    // 하나의 엣지만
    edge = findEdge(fromProj.nodeA, fromProj.nodeB)
    edgePath = [{edge, forward=true}]
else:
    // 시작 엣지
    startEdge = findEdge(fromProj.nodeA, fromProj.nodeB)
    forward = (startEdge.to == trimmedPath[0])
    edgePath.push({startEdge, forward})

    // 중간 엣지들
    for i = 0 to len(trimmedPath) - 2:
        edge = findEdge(trimmedPath[i], trimmedPath[i+1])
        forward = (edge.from == trimmedPath[i])
        edgePath.push({edge, forward})

    // 끝 엣지 (시작과 다른 경우만)
    endEdge = findEdge(toProj.nodeA, toProj.nodeB)
    if endEdge ≠ startEdge:
        forward = (endEdge.from == trimmedPath.last)
        edgePath.push({endEdge, forward})
```

### 4-2. 복도 엣지 → 클립

```
for each {edge, forward} in edgePath:
    if forward:
        videoFile = edge.videoFwd
        videoStart = edge.videoFwdStart
        videoEnd = edge.videoFwdEnd
    else:
        videoFile = edge.videoRev
        videoStart = edge.videoRevStart
        videoEnd = edge.videoRevEnd

    if videoFile is null: skip

    // 첫 엣지: 수선의 발 위치부터 시작 (부분 재생)
    if isFirstEdge:
        videoStart = computePartialTime(fromProj, edge, forward, videoStart, videoEnd)

    // 마지막 엣지: 수선의 발 위치에서 끝 (부분 재생)
    if isLastEdge:
        videoEnd = computePartialTime(toProj, edge, forward, videoStart_original, videoEnd_original)

    yaw = videoSettings[videoFile].yaw ?? 0

    clip = {
        index, videoFile, videoStart, videoEnd,
        duration: videoEnd - videoStart,
        yaw, level, isExitClip: false,
        coordStartIdx, coordEndIdx,
        routeDistStart, routeDistEnd
    }
```

### 4-3. 부분 시간 계산 (computePartialTime)

수선의 발이 엣지 중간에 있을 때, 영상의 시작/끝 시간을 비례로 계산:

```
function computePartialTime(projection, edge, forward, fullStart, fullEnd):
    totalDist = projection.distToA + projection.distToB
    if totalDist == 0: return fullStart

    if forward:   // from → to 방향으로 이동
        t = projection.distToA / totalDist
    else:         // to → from 방향으로 이동
        t = projection.distToB / totalDist

    return fullStart + t * (fullEnd - fullStart)
```

**예시:**

```
엣지: A --------F---------------- B
      0%       30%               100%

distToA = 30m, distToB = 70m → t = 0.3

영상 시간: fullStart=0초, fullEnd=50초
→ partialTime = 0 + 0.3 × 50 = 15초
→ 영상 15초부터 재생 시작
```

### 4-4. 같은 엣지 (sameEdge) 클립

출발과 도착이 같은 엣지 위에 있을 때:

```
totalDist = fromProj.distToA + fromProj.distToB
startT = fromProj.distToA / totalDist    // 출발 위치 비율
endT = toProj.distToA / totalDist        // 도착 위치 비율

forward = (startT < endT)   // 방향 결정

if forward:
    videoFile = edge.videoFwd
else:
    videoFile = edge.videoRev

// 시간 범위 계산
clipStart = fullStart + startT × (fullEnd - fullStart)
clipEnd = fullStart + endT × (fullEnd - fullStart)
// forward가 아니면 (1 - startT), (1 - endT)로 변환
```

### 4-5. 수직 엣지 (계단/엘리베이터) → 클립

계단이나 엘리베이터로 층을 이동하는 경우, 연속된 수직 엣지를 그룹핑하고 진입/출구 영상 2개를 생성한다.

**그룹핑 규칙:**
- 연속된 엣지의 양쪽 노드가 모두 같은 `type`(stairs 또는 elevator)이고 같은 `verticalId`면 하나의 그룹

**영상 파일명 계산 (계단):**

```
패턴: {building}_s_{stairId}_{floor}{e|o}{u|d}.mp4

e = enter (진입), o = out (출구)
u = up (올라감), d = down (내려감)

예: 계단3, 3층→1층 (내려감)
  진입: eng1_s_3_3ed.mp4   (3층에서 진입, 아래로)
  출구: eng1_s_3_1od.mp4   (1층에서 나옴, 아래로)
```

**영상 파일명 계산 (엘리베이터):**

```
패턴: {building}_e_{elevId}_{floor}{e|o}.mp4

예: 엘리베이터1, 1층→5층
  진입: eng1_e_1_1e.mp4    (1층에서 진입)
  출구: eng1_e_1_5o.mp4    (5층에서 나옴)
```

**클립 생성:**

```
for each vertical group:
    firstEdge → 진입 영상 (isExitClip: false)
    lastEdge  → 출구 영상 (isExitClip: true)

    duration: 계단 = 4초, 엘리베이터 = 3초
    videoStart: 0, videoEnd: duration
    yaw: videoSettings에서 조회
```

---

## Step 5: 응답 조립

### 누적 거리 계산

```
cumulativeDist = [0]
for i = 1 to len(coordinates):
    cumulativeDist[i] = cumulativeDist[i-1] + haversine(coordinates[i-1], coordinates[i])
```

각 클립의 `routeDistStart`와 `routeDistEnd`는 `cumulativeDist[coordStartIdx]`와 `cumulativeDist[coordEndIdx]`에서 가져온다.

### videoStartCoordIdx / videoEndCoordIdx

- `videoStartCoordIdx`: 출발 수선의 발 좌표와 가장 가까운 coordinates 인덱스
- `videoEndCoordIdx`: 도착 수선의 발 좌표와 가장 가까운 coordinates 인덱스 (뒤에서부터 탐색)

### 총 거리 / 예상 시간

```
totalDistance = round(cumulativeDist.last)   // 미터
minutes = max(1, round(totalDistance / 72))  // 72m/분 = 보행 속도
estimatedTime = "{minutes}분"
```

---

## 레퍼런스 구현 파일

| 파일 | 설명 |
|------|------|
| `src/services/graphService.ts` | 수선의 발, 다익스트라, 좌표 체인 조립 |
| `src/services/local/localRoute.ts` | 클립 생성 (복도, 같은 엣지, 수직 엣지) |
| `src/utils/verticalVideoFilename.ts` | 계단/엘리베이터 영상 파일명 계산 |
| `public/geojson/graph.json` | 그래프 데이터 샘플 |
| `public/geojson/video_settings.json` | 영상별 yaw 값 |

---

## 주의사항

1. **좌표 순서**: 항상 `[경도(lng), 위도(lat)]` — GeoJSON 표준
2. **시간 단위**: 모든 영상 시간은 **초(seconds)** — 밀리초 아님
3. **거리 단위**: **미터(m)**
4. **중복 제거 임계값**: `0.000009` (경위도 차이, 약 1미터)
5. **room 타입 엣지 제외**: 수선의 발을 구할 때 room 노드가 포함된 엣지는 무시
6. **양방향 그래프**: 모든 엣지는 양방향으로 탐색 가능 (`from→to`, `to→from`)
7. **영상 없는 엣지**: `videoFwd`/`videoRev`가 null이면 해당 클립은 건너뜀
