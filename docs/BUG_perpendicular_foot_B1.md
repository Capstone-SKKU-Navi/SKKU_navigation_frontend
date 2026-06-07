# 버그: 수선의 발이 안 내려가고 노드로 직결됨 (지하층에서 발생)

작성일: 2026-06-07
상태: **원인 규명 완료 / 미수정**
영향 범위: 프론트엔드 LOCAL 라우트 provider (`services/local/localRoute.ts` → `services/graphService.ts`). 백엔드 경로(`RouteBuilderService.java`)는 영향 없음 (아래 "프론트/백엔드 분기" 참조).

---

## 1. 증상

지하1층(B1)에서 출발/도착 핀을 복도 edge 옆에 놓으면:

- 경로가 edge 위에 **수선의 발(perpendicular foot)을 내리지 않고**, 핀에서 가장 가까운 **그래프 노드(`mp1g4gvi`)로 직선으로 이어진다.**
- 화면의 경로선뿐 아니라 **워크스루 영상 구간도 건너뛴다** (핀→복도 진입 구간 영상이 잘못 잡힘).

재현 화면: 출발(`출발`)이 좌측 세로 복도 edge `mp1g4gvi↔mp1g7arj` 중간 옆(서쪽 ~1.3m)에 있는데, 경로가 중간 지점으로 내려가지 않고 위쪽 노드 `mp1g4gvi`까지 대각선으로 올라감.

---

## 2. 근본 원인

두 군데가 맞물려서 발생한다.

### (A) `resolveEdgeBuilding` 가 edge를 'outside'로 오분류

[graphService.ts:34-37](../2.5d_indoor_navigation_frontend_v2/src/services/graphService.ts#L34-L37)

```ts
function resolveEdgeBuilding(a, b) {
  if (!a || !b) return 'outside';
  return a.building === b.building ? a.building : 'outside';
}
```

graph import 시 edge.building을 **양 끝 노드 building이 다르면 무조건 'outside'** 로 계산한다.

해당 edge `mp1g4gvi↔mp1g7arj`:
- `mp1g4gvi` building = `slib` (실내 복도)
- `mp1g7arj` building = `outside` (B1 복도가 실외 보행로와 만나는 경계 노드)
- → 다름 → **edge.building = `'outside'`** (실제로는 실내 복도 edge인데도)

edge의 영상은 `slib_c_FB1_3_ccw.mp4` (실내 복도 영상). 즉 진짜 실외 edge가 아니다.

### (B) preferIndoor 1차 투영이 'outside' edge를 제외

[graphService.ts:210-256](../2.5d_indoor_navigation_frontend_v2/src/services/graphService.ts#L210-L256), 특히 222번 라인:

```ts
if (indoorOnly && edge.building === 'outside') continue;
```

방/실내 출발점은 `preferIndoor=true` ([routeActions.ts:294-307](../2.5d_indoor_navigation_frontend_v2/src/services/routeActions.ts#L294-L307)) → 1차 패스 `indoorOnly=true`.
이 패스에서 (A) 때문에 'outside'로 찍힌 `mp1g4gvi↔mp1g7arj`가 **제외**된다.

남은 실내(slib) edge 중 가장 가까운 건 위쪽 가로 edge `mp1g4aa7↔mp1g4gvi`. 출발점이 그 edge보다 서쪽/아래에 있어 **t가 1로 클램프 → 투영점 = 노드 `mp1g4gvi`** 가 된다.

1차 패스가 null이 아닌 결과를 돌려주므로 [graphService.ts:203-207](../2.5d_indoor_navigation_frontend_v2/src/services/graphService.ts#L203-L207)의 full-pass 폴백은 **실행되지 않는다.** → 잘못된 노드 투영 확정.

### 증거 (실제 graph.json + import 로직 재현 시뮬)

```
edge mp1g4gvi<->mp1g7arj building = outside        ← (A) 오분류

preferIndoor 1차 (indoorOnly=TRUE):
  edge: mp1g4aa7<->mp1g4gvi, t: 1,     foot 23.9m   ← 앱 실제 동작(노드로 클램프)
full pass (indoorOnly=FALSE):
  edge: mp1g4gvi<->mp1g7arj, t: 0.557, foot  1.3m   ← 사용자가 기대하는 정답(중간)
```

---

## 3. 왜 "지하1층(B1)"에서 생기나

B1은 실내 복도가 **실외 보행로와 같은 높이에서 직접 연결**된다. 그래서 그 경계 노드들이 `building='outside'`로 태깅돼 있고(`mp1g7arj`, `mp1g7cby` 등), 실내 복도 ↔ 경계 노드를 잇는 edge가 (A)에 의해 'outside'로 오분류된다.

지상층(1F 이상)은 복도가 실외 보행로에 직접 닿지 않아 양 끝이 같은 building → 오분류가 안 일어남. 그래서 **B1 한정으로 보이는 것**. (라우팅 알고리즘 자체의 층 버그는 아님.)

---

## 4. 왜 영상도 같이 건너뛰나

진입 edge가 바뀌면서 클립 조립([localRoute.ts:74-226](../2.5d_indoor_navigation_frontend_v2/src/services/local/localRoute.ts#L74-L226))이 어긋난다:

1. 수선의 발(핀→복도 진입점) 구간이 사라져 partial-time 클립([localRoute.ts:194-199](../2.5d_indoor_navigation_frontend_v2/src/services/local/localRoute.ts#L194-L199))이 잘못 계산됨.
2. 사용자가 실제로 서 있는 복도(`slib_c_FB1_3`, edge `mp1g4gvi↔mp1g7arj`)가 진입 edge에서 빠지고, 엉뚱한 `mp1g4aa7↔mp1g4gvi`로 진입 처리됨 → 해당 구간 영상이 안 잡힘.
3. 'outside'로 찍힌 구간은 렌더 단계에서 no-video로 흐리게 그려짐([routeOverlay.ts:159-178](../2.5d_indoor_navigation_frontend_v2/src/components/routeOverlay.ts#L159-L178), `NO_VIDEO_OPACITY_FACTOR`).

---

## 5. 프론트/백엔드 분기 (중요)

백엔드는 같은 상황을 **올바르게** 처리한다. 실외 판정을 building이 아니라 **영상 파일명**으로 한다:

[RouteBuilderService.java:606-620](../../SKKU-2.5D-Navigation/src/main/java/com/skku/nav/service/RouteBuilderService.java#L606-L620)

```java
private static boolean isOutsideEdge(NavEdge e) {
    return isOutsideVideo(e.getVideoFwd()) || isOutsideVideo(e.getVideoRev());
}
private static boolean isOutsideVideo(String v) {
    return v != null && v.startsWith("outside_");
}
```

해당 edge 영상은 `slib_c_FB1_3_*` → `outside_` 아님 → 백엔드는 제외 안 함 → 정상.

즉 **프론트 LOCAL 모드 전용 버그**. building 기반 분류(프론트) vs 영상명 기반 분류(백엔드)의 불일치가 원인.

---

## 6. 수정 방향 (참고 — 미적용)

택1 또는 조합:

1. **프론트 실외 판정을 백엔드와 일치**시키기 — `edge.building === 'outside'` 대신 영상명 `outside_` prefix로 판정. (분기 제거, 가장 견고)
2. `resolveEdgeBuilding`을 고쳐, 한쪽만 'outside'인 경우 'outside'로 만들지 말고 **실내 쪽 building을 채택**(또는 실내 영상 있으면 실내로 취급).
3. preferIndoor 1차가 **노드로 클램프(t=0/1)된 결과면 신뢰하지 말고** full-pass도 돌려 더 가까운 mid-edge 투영과 비교. (증상 완화책, 근본 해결 아님)

권장: **1번** (백/프론트 실외 판정 단일화). [skku-nav-contract-vs-impl] 메모의 "contract/impl 분기" 사례와 동일 계열.

---

## 7. 관련 파일

- [graphService.ts](../2.5d_indoor_navigation_frontend_v2/src/services/graphService.ts) — `resolveEdgeBuilding`(34), `projectOntoNearestEdgeImpl`(210), `buildFullRouteImpl`(302)
- [localRoute.ts](../2.5d_indoor_navigation_frontend_v2/src/services/local/localRoute.ts) — 클립 조립
- [routeActions.ts](../2.5d_indoor_navigation_frontend_v2/src/services/routeActions.ts) — `resolveCoordinate`/preferIndoor 결정
- [routeOverlay.ts](../2.5d_indoor_navigation_frontend_v2/src/components/routeOverlay.ts) — 경로/영상유무 렌더
- [RouteBuilderService.java](../../SKKU-2.5D-Navigation/src/main/java/com/skku/nav/service/RouteBuilderService.java) — 백엔드 정상 구현 (실외 판정 = 영상명)
</content>
</invoke>
