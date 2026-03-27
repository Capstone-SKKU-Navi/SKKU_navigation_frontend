# TODOS

## 도면 에디터 자동 저장 (LocalStorage/IndexedDB)
- **What:** 에디터 작업 상태를 LocalStorage 또는 IndexedDB에 자동 저장하여 브라우저 크래시 시 복구 가능하게 하기
- **Why:** 수시간 수작업 후 브라우저 크래시 시 모든 데이터 손실 방지
- **Pros:** 자동 복구 가능, 작업 재개 시 이전 상태 자동 로딩
- **Cons:** LocalStorage 5MB 제한 (대용량 GeoJSON 시 IndexedDB 필요), 구현 복잡도 증가
- **Context:** 도면 에디터는 파일 다운로드로만 저장. 장시간 작업이 예상되므로 자동 저장이 필요. GeoJSON 크기가 5MB를 초과할 가능성 낮지만, 이미지 오버레이 설정까지 포함하면 IndexedDB가 안전.
- **Depends on:** 도면 에디터 기본 기능 완성
- **Added:** 2026-03-26 by /plan-eng-review
