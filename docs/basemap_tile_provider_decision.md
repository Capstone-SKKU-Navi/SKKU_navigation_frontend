# Basemap Tile Provider Decision

**결론: OpenStreetMap 기반 CARTO Voyager 타일을 계속 사용한다.**

현재 [geoMap.ts](2.5d_indoor_navigation_frontend_v2/src/components/geoMap.ts)에서 MapLibre GL JS + CARTO Voyager 조합으로 베이스맵을 제공하고 있다. Google Maps 등 다른 제공자로 전환을 검토했으나, 각각 명확한 제한사항이 있어 현 구성을 유지하기로 결정했다.

---

## 검토한 대안과 제한사항

### Google Maps

**직접 타일 URL 사용 (불가)**

`https://mt0.google.com/vt/...` 형태의 타일 URL을 MapLibre GL JS에 직접 주입하는 방식은 Google 이용약관 위반이다. 캡스톤 프로젝트 수준에서는 문제가 없어 보일 수 있지만, 이후 배포·공개 시 법적 리스크가 있다.

**공식 Google Maps Tiles API (실용성 부족)**

Google이 공식 제공하는 Map Tiles API를 MapLibre GL JS에 연결하는 방법은 존재한다. 하지만:
- Google Cloud 프로젝트 생성 및 결제 수단 등록 필요 (유료)
- 타일 요청마다 session token을 별도 POST 요청으로 발급받아 관리해야 함 (구현 복잡도 상승)
- **한국 지도 정확도 문제**: 한국은 지도 데이터의 국내 서버 보관 의무 관련 법규로 인해 Google이 고정밀 지도를 해외 서버에 저장할 수 없다. 결과적으로 SKKU 캠퍼스 주변 건물 윤곽 정확도가 Naver/Kakao에 비해 낮다.

비용과 구현 복잡도를 감수하더라도 한국에서의 지도 품질이 기대에 미치지 못한다.

### Naver Maps / Kakao Maps

한국 지도 서비스인 만큼 SKKU 캠퍼스 주변 건물 정확도가 가장 높다. 그러나 전환하려면 다음이 필요하다:

- MapLibre GL JS SDK를 완전히 제거하고 각 회사 전용 JS SDK로 교체
- `geoMap.ts` 전체 재작성 (지도 초기화, 레이어 관리, 카메라 제어 등)
- `indoorLayer.ts`, `routeOverlay.ts`, `floatingLabels.ts` 등 MapLibre API에 의존하는 모든 컴포넌트 수정

아키텍처 전환 비용이 남은 개발 일정 대비 지나치게 크다.

### Mapbox

MapLibre GL JS가 Mapbox GL JS의 오픈소스 포크이므로 API 호환성이 높아 전환 비용은 낮다. 그러나:
- 월 50,000 map load 초과 시 유료
- 한국 건물 정확도가 현 CARTO 대비 특별히 나을 것이 없음

---

## OpenStreetMap(CARTO)을 유지하는 이유

| 항목 | CARTO Voyager (현재) |
|---|---|
| 라이선스 | 무료, 제한 없음 |
| API 키 | 불필요 |
| MapLibre GL JS 호환 | 완벽 (raster tile URL 그대로 사용) |
| 한국 지도 데이터 | OSM 기여자 데이터 기반, 캠퍼스 윤곽 충분 |
| 추가 구현 공수 | 없음 |

이 프로젝트에서 베이스맵 타일은 실내 지도 데이터(GeoJSON)의 배경으로만 기능한다. 건물의 실내 윤곽은 타일이 아닌 자체 GeoJSON 데이터에서 렌더링되므로, 베이스맵 타일의 건물 정확도는 실제 기능에 큰 영향을 주지 않는다.
