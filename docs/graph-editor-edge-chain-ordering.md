# Graph Editor — Edge Chain Ordering

Multi-edge selection에서 E1, E2, E3 순서를 결정하는 로직 문서.

## How it works

Graph editor에서 여러 edge를 shift+click으로 선택하면 E1, E2, E3로 번호가 매겨진다.

1. 선택된 edge들의 **endpoint** (1개의 edge에만 연결된 노드) 2개를 찾는다.
2. 두 endpoint 노드 ID를 **알파벳순** 정렬 → 먼저 오는 노드를 start로 사용.
3. Start 노드에서 chain walk: start에 연결된 edge = **E1**, 그 다음 연결된 edge = **E2**, ...

### 적용 위치

| File | Function | 역할 |
|------|----------|------|
| `graphEditorPanel.ts` | `getOrderedChain()` | E1/E2/E3 순서 + UI 표시 |
| `graphEditor.ts` | `orderEdgeChain()` | Assign & Split 시 실제 시간 구간 할당 |

두 함수가 동일한 정렬(알파벳순)을 사용하므로 패널 표시와 실제 할당이 항상 일치한다.

## Example

3개 edge 선택 시 (어떤 순서로 클릭하든):

```
endpoints = [mn8ztph0, mn8ztn1z]  (알파벳순)
startNode = mn8ztph0

Chain walk:
  E1: mn8ztph0 → mn8ztota
  E2: mn8ztota → mn8ztns2
  E3: mn8ztns2 → mn8ztn1z
```
