# GeoJSON 속성 입력 파이프라인

## 전체 흐름

```
Geojson/                                    ← QGIS 원본 (속성 없음)
    ↓  python geojson_convert/convert.py eng1 1
public/geojson/eng1/                        ← 앱이 직접 읽는 폴더
    manifest.json
    eng1_outline.geojson
    eng1_room_L1.geojson                    ← ref, room_type 비어있음
    eng1_collider_L1.geojson
    eng1_wall_L1.geojson
    ↓  Sonnet 또는 앱 에디터에서 속성 채우기
    eng1_room_L1.geojson                    ← ref, room_type 완성
    → 앱 새로고침하면 바로 반영
```

## Step 1: 변환

```bash
python geojson_convert/convert.py <building_code> <level> [level ...]
# 예시:
python geojson_convert/convert.py eng1 1
python geojson_convert/convert.py eng2 1 2 3 4 5
```

- 슬리버 자동 제거, MultiPolygon→Polygon 변환
- **병합 없이** 개별 파일로 `public/geojson/{code}/`에 출력
- `manifest.json` 자동 생성 (건물 이름, 층 목록)

### 출력 파일 구조

```
public/geojson/{code}/
  manifest.json              ← 건물 메타데이터
  {code}_outline.geojson     ← 외곽선 (1 피처)
  {code}_room_L{n}.geojson   ← n층 방 (ref, room_type 비어있음)
  {code}_collider_L{n}.geojson ← n층 복도
  {code}_wall_L{n}.geojson   ← n층 벽
```

## Step 2: 속성 입력

### 방법 A: 앱 에디터 (권장)

1. 앱에서 Graph Editor 열기 (헤더 hub 아이콘)
2. **label** 모드 (4번째 버튼 또는 키보드 `4`)
3. 방 클릭 → ref(방 번호), type(유형) 입력
4. 같은 방 재클릭 → 라벨 위치 이동
5. **GeoJSON 내보내기** → 현재 층의 room 파일 다운로드
6. 다운로드된 파일을 `public/geojson/{code}/`에 덮어쓰기

---

## 건물 코드

전체 목록: `BUILDING_CODES.md`
