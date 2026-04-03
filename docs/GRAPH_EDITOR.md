# 그래프 에디터 사용법

헤더의 **hub** 아이콘으로 활성화. 노드/간선을 편집하여 내비게이션 그래프를 구축한다.

## 단축키

| 단축키 | 동작 |
|--------|------|
| `Q` | 선택 모드 |
| `W` | 노드 추가 모드 (타입 사전 선택 가능) |
| `E` | 엣지 추가 모드 (연속 연결, 우클릭/Esc로 취소) |
| `R` | 방 라벨 편집 모드 (숫자키로 ref 직접 입력, A/B/C도 가능) |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Delete` / `Backspace` | 선택된 노드/엣지 삭제 |
| `Backspace` (라벨 모드) | 방 라벨 ref 마지막 글자 삭제 |
| `Esc` | 선택 해제 / 엣지 연결 취소 / 라벨 모드 해제 |

## 노드 타입

| 타입 | 용도 | 특이사항 |
|------|------|----------|
| `corridor` | 복도 교차점, 꺾이는 지점 | 경로 탐색의 기본 단위 |
| `stairs` | 계단 출입구 (층별 하나씩) | `verticalId` 필수 — 같은 계단 = 같은 번호 |
| `elevator` | 엘리베이터 출입구 (층별 하나씩) | `verticalId` 필수 |
| `entrance` | 건물 출입구 | |
| `room` | 방 문 위치 (복도 쪽 벽 근처) | `label`에 방 번호 자동 할당 |

## 주요 동작

### 자동 저장
- 노드/간선 변경 → `public/geojson/graph.json` 자동 저장
- 방 라벨(ref, name, room_type) 변경 → `public/geojson/eng1/eng1_room_L{n}.geojson` 자동 저장
- 비디오 yaw 조정 → `public/geojson/video_settings.json` 자동 저장
- dev server의 PUT API를 통해 파일에 직접 쓰기

### 방 코드 자동 조회
- `room_codes.json`에서 방 번호로 이름과 유형을 자동 조회
- 라벨 모드에서 숫자 입력 시 실시간으로 매칭되는 방 정보 표시
- room 타입 노드 배치 시 가장 가까운 방의 ref 자동 할당

### 3D 모드
- 모든 노드·간선을 층 높이에 맞춰 표시
- 비활성 층은 반투명 처리
- 2D/3D 모드 전환 시 에디터 오버레이도 동기화

### 계단/엘리베이터
- `verticalId` 필드로 물리적 계단/엘리베이터 번호를 지정 (예: 계단1=1, 엘리베이터2=2)
- 같은 `verticalId`의 서로 다른 층 노드를 엣지로 연결
- 영상 파일명은 `verticalId` + 층 정보로 자동 계산됨 (`verticalVideoFilename.ts`)
- 예: 계단3, 3F→1F → `eng1_s_3_3ed.mp4` (진입) + `eng1_s_3_1od.mp4` (출구)

### 영상 할당
- 엣지 선택 → 패널에서 영상 트리 목록으로 할당
- 영상 선택 시 `start=0`, `end=영상길이`로 자동 설정
- 반대 방향(cw↔ccw)도 자동 할당
- 시간 범위 수동 조정 가능
- 360° 프리뷰로 yaw 확인/조정

### 다중 엣지 선택 & Assign
- `Shift+클릭`으로 여러 엣지 선택
- 체인 자동 감지 + 방향 표시
- **Assign & Split**: 한 영상을 N개 엣지에 분할점으로 나눠 할당

### Room Auto Apply
- 라벨 모드에서 room_type과 ref prefix를 사전 설정
- 방 클릭 시 자동으로 해당 타입과 접두어 적용

## 엣지 체인 정렬 (Edge Chain Ordering)

Multi-edge selection에서 E1, E2, E3 순서를 결정하는 로직.

1. 선택된 edge들의 **endpoint** (1개의 edge에만 연결된 노드) 2개를 찾는다.
2. 두 endpoint 노드 ID를 **알파벳순** 정렬 → 먼저 오는 노드를 start로 사용.
3. Start 노드에서 chain walk: start에 연결된 edge = **E1**, 그 다음 연결된 edge = **E2**, ...

### 적용 위치

| File | Function | 역할 |
|------|----------|------|
| `graphEditorPanel.ts` | `getOrderedChain()` | E1/E2/E3 순서 + UI 표시 |
| `graphEditor.ts` | `orderEdgeChain()` | Assign & Split 시 실제 시간 구간 할당 |

두 함수가 동일한 정렬(알파벳순)을 사용하므로 패널 표시와 실제 할당이 항상 일치한다.

### Example

3개 edge 선택 시 (어떤 순서로 클릭하든):

```
endpoints = [mn8ztph0, mn8ztn1z]  (알파벳순)
startNode = mn8ztph0

Chain walk:
  E1: mn8ztph0 → mn8ztota
  E2: mn8ztota → mn8ztns2
  E3: mn8ztns2 → mn8ztn1z
```

## 저장 파일 구조

에디터에서 저장하는 파일의 상세 구조는 [DATA_FORMAT.md](DATA_FORMAT.md) 참조.

| 파일 | 저장 내용 |
|------|-----------|
| `graph.json` | 노드(좌표, 층, 타입, verticalId) + 엣지(weight, 영상 파일/시간) |
| `eng1_room_L{n}.geojson` | 방 properties (ref, name, room_type) |
| `video_settings.json` | 영상별 yaw 값 |

## 경로 탐색 연동

- 에디터에서 수정한 `graph.json`은 **페이지 새로고침 후** 경로 탐색에 반영됨
- 로컬 모드(`useApi=false`): `graph.json`을 직접 로드하여 Dijkstra 실행
- API 모드(`useApi=true`): `graph.json`을 백엔드 DB로 가져간 후 `POST /api/route`로 탐색
- 백엔드 DB 가져가기 방법은 [DATA_FORMAT.md](DATA_FORMAT.md)의 "백엔드 가져가기 요약" 참조
