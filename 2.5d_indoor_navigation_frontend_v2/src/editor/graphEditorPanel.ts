// ===== Navigation Graph Editor — Floating Panel UI =====

import { NavNode, NavEdge, EditorMode, PanelCallbacks, ALL_NODE_TYPES, NODE_TYPE_LABELS, NavNodeType, ROOM_TYPES, RoomAutoApplyPreset, RoomType } from './graphEditorTypes';
import { suggestVideosForEdge, getAllVideos, getOppositeVideo } from './videoCatalog';
import { openVideoSettingsPanel } from './videoSettingsPanel';

let panelEl: HTMLElement | null = null;
let callbacks: PanelCallbacks | null = null;
let collapsed = false;

export function createPanel(cb: PanelCallbacks): HTMLElement {
  callbacks = cb;

  const panel = document.createElement('div');
  panel.id = 'graphEditorPanel';
  panel.className = 'ge-panel';
  panel.innerHTML = `
    <div class="ge-panel-header">
      <span class="ge-panel-title">Graph Editor</span>
      <div class="ge-panel-header-btns">
        <button class="ge-header-btn" id="gePanelCollapse" title="최소화">
          <span class="material-icons" style="font-size:18px">remove</span>
        </button>
        <button class="ge-header-btn" id="gePanelClose" title="닫기">
          <span class="material-icons" style="font-size:18px">close</span>
        </button>
      </div>
    </div>
    <div class="ge-panel-body" id="gePanelBody">
      <div class="ge-section">
        <div class="ge-mode-buttons">
          <button class="ge-mode-btn active" data-mode="select" title="선택 (Q)">
            <span class="material-icons">near_me</span>
          </button>
          <button class="ge-mode-btn" data-mode="add-node" title="노드 추가 (W)">
            <span class="material-icons">add_location</span>
          </button>
          <button class="ge-mode-btn" data-mode="add-edge" title="엣지 추가 (E)">
            <span class="material-icons">timeline</span>
          </button>
          <button class="ge-mode-btn" data-mode="label-room" title="방 라벨 편집 (R)">
            <span class="material-icons">label</span>
          </button>
        </div>
      </div>

      <div class="ge-section" id="geAddNodeOpts" style="display:none">
        <div class="ge-props-title"><span>노드 타입</span></div>
        <div class="ge-prop-row">
          <select id="geAddNodeType" class="ge-select">
            ${ALL_NODE_TYPES.map(t => `<option value="${t}">${NODE_TYPE_LABELS[t]}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="ge-section ge-info-bar">
        <span id="geInfoLevel">1F</span>
        <span class="ge-sep">·</span>
        <span id="geInfoNodes">0 nodes</span>
        <span class="ge-sep">·</span>
        <span id="geInfoEdges">0 edges</span>
      </div>

      <div class="ge-section ge-node-props" id="geNodeProps" style="display:none">
        <div class="ge-props-title">
          <span>Selected Node</span>
          <button class="ge-small-btn ge-delete-btn" id="geNodeDelete" title="노드 삭제">
            <span class="material-icons" style="font-size:16px">delete</span>
          </button>
        </div>
        <div class="ge-prop-row">
          <label>ID</label>
          <span id="geNodeId" class="ge-prop-value"></span>
        </div>
        <div class="ge-prop-row">
          <label>Coord</label>
          <span id="geNodeCoord" class="ge-prop-value"></span>
        </div>
        <div class="ge-prop-row">
          <label>Level</label>
          <input type="number" id="geNodeLevel" class="ge-input" min="1" max="10" style="width:60px" />
        </div>
        <div class="ge-prop-row">
          <label>Building</label>
          <span id="geNodeBuilding" class="ge-prop-value"></span>
        </div>
        <div class="ge-prop-row">
          <label>Type</label>
          <select id="geNodeType" class="ge-select">
            ${ALL_NODE_TYPES.map(t => `<option value="${t}">${NODE_TYPE_LABELS[t]}</option>`).join('')}
          </select>
        </div>
        <div class="ge-prop-row">
          <label>Label</label>
          <input type="text" id="geNodeLabel" class="ge-input" placeholder="(optional)" />
        </div>
      </div>

      <div class="ge-section ge-edge-props" id="geEdgeProps" style="display:none">
        <div class="ge-props-title">
          <span>Selected Edge</span>
          <button class="ge-small-btn ge-delete-btn" id="geEdgeDelete" title="엣지 삭제">
            <span class="material-icons" style="font-size:16px">delete</span>
          </button>
        </div>
        <div class="ge-prop-row">
          <label>Weight</label>
          <span id="geEdgeWeight" class="ge-prop-value"></span>
        </div>

        <div class="ge-props-title" style="margin-top:6px">
          <span id="geEdgeFwdLabel">→ From → To</span>
        </div>
        <div class="ge-vertical-clip-label" id="geEdgeFwdEntryLabel" style="display:none">들어갈 때</div>
        <div class="ge-prop-row">
          <select id="geEdgeVideoFwd" class="ge-select">
            <option value="">(없음)</option>
          </select>
        </div>
        <div class="ge-prop-row ge-edge-time-row" id="geEdgeFwdTimeRow" style="display:none">
          <span id="geEdgeFwdTime" class="ge-edge-time">-</span>
          <button class="ge-small-btn" id="geSetTimeFwd" title="Set Time Range">
            <span class="material-icons" style="font-size:16px">timer</span>
          </button>
        </div>
        <div id="geEdgeFwdExitSection" style="display:none">
          <div class="ge-vertical-clip-label">나올 때</div>
          <div class="ge-prop-row">
            <select id="geEdgeVideoFwdExit" class="ge-select">
              <option value="">(없음)</option>
            </select>
          </div>
          <div class="ge-prop-row ge-edge-time-row" id="geEdgeFwdExitTimeRow" style="display:none">
            <span id="geEdgeFwdExitTime" class="ge-edge-time">-</span>
            <button class="ge-small-btn" id="geSetTimeFwdExit" title="Set Time Range">
              <span class="material-icons" style="font-size:16px">timer</span>
            </button>
          </div>
        </div>

        <div class="ge-props-title" style="margin-top:6px">
          <span id="geEdgeRevLabel">← To → From</span>
        </div>
        <div class="ge-vertical-clip-label" id="geEdgeRevEntryLabel" style="display:none">들어갈 때</div>
        <div class="ge-prop-row">
          <select id="geEdgeVideoRev" class="ge-select">
            <option value="">(없음)</option>
          </select>
        </div>
        <div class="ge-prop-row ge-edge-time-row" id="geEdgeRevTimeRow" style="display:none">
          <span id="geEdgeRevTime" class="ge-edge-time">-</span>
          <button class="ge-small-btn" id="geSetTimeRev" title="Set Time Range">
            <span class="material-icons" style="font-size:16px">timer</span>
          </button>
        </div>
        <div id="geEdgeRevExitSection" style="display:none">
          <div class="ge-vertical-clip-label">나올 때</div>
          <div class="ge-prop-row">
            <select id="geEdgeVideoRevExit" class="ge-select">
              <option value="">(없음)</option>
            </select>
          </div>
          <div class="ge-prop-row ge-edge-time-row" id="geEdgeRevExitTimeRow" style="display:none">
            <span id="geEdgeRevExitTime" class="ge-edge-time">-</span>
            <button class="ge-small-btn" id="geSetTimeRevExit" title="Set Time Range">
              <span class="material-icons" style="font-size:16px">timer</span>
            </button>
          </div>
        </div>
      </div>

      <div class="ge-section ge-edge-props" id="geMultiEdgeProps" style="display:none">
        <div class="ge-props-title">
          <span id="geMultiEdgeCount">0 edges selected</span>
        </div>

        <div class="ge-props-title" style="margin-top:6px">
          <span id="geMultiEdgeFwdLabel">→</span>
        </div>
        <div class="ge-prop-row">
          <select id="geMultiEdgeVideoFwd" class="ge-select">
            <option value="">(없음)</option>
          </select>
        </div>
        <div class="ge-multi-time-info" id="geMultiEdgeFwdTimeInfo" style="display:none"></div>
        <div class="ge-prop-row ge-edge-time-row" id="geMultiEdgeFwdSplitRow" style="display:none">
          <button class="ge-action-btn" id="geSplitAssignFwd">
            <span class="material-icons" style="font-size:16px">content_cut</span> Assign & Split
          </button>
        </div>

        <div class="ge-props-title" style="margin-top:6px">
          <span id="geMultiEdgeRevLabel">←</span>
        </div>
        <div class="ge-prop-row">
          <select id="geMultiEdgeVideoRev" class="ge-select">
            <option value="">(없음)</option>
          </select>
        </div>
        <div class="ge-multi-time-info" id="geMultiEdgeRevTimeInfo" style="display:none"></div>
        <div class="ge-prop-row ge-edge-time-row" id="geMultiEdgeRevSplitRow" style="display:none">
          <button class="ge-action-btn" id="geSplitAssignRev">
            <span class="material-icons" style="font-size:16px">content_cut</span> Assign & Split
          </button>
        </div>
      </div>

      <div class="ge-section ge-edge-info" id="geEdgeInfo" style="display:none">
        <div class="ge-props-title">
          <span>Edge Mode</span>
        </div>
        <p class="ge-hint" id="geEdgeHint">노드를 클릭하여 엣지 시작점을 선택하세요</p>
      </div>

      <div class="ge-section ge-room-props" id="geRoomProps" style="display:none">
        <div class="ge-props-title">
          <span>Room Label</span>
        </div>
        <div class="ge-prop-row">
          <label>idx</label>
          <span id="geRoomIdx" class="ge-prop-value"></span>
        </div>
        <div class="ge-prop-row">
          <label>Area</label>
          <span id="geRoomArea" class="ge-prop-value"></span>
        </div>
        <div class="ge-prop-row">
          <label>Ref</label>
          <input type="text" id="geRoomRef" class="ge-input" placeholder="방 번호" />
        </div>
        <div class="ge-prop-row">
          <label>Type</label>
          <select id="geRoomType" class="ge-select">
            <option value="">(미정)</option>
            ${ROOM_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
          </select>
        </div>
        <div class="ge-action-row" style="margin-top:8px">
          <button class="ge-action-btn" id="geRoomExport">
            <span class="material-icons" style="font-size:16px">file_download</span> GeoJSON 내보내기
          </button>
        </div>
        <div class="ge-auto-apply-section" id="geAutoApplySection">
          <div class="ge-props-title" style="margin-top:8px">
            <span>자동 적용 프리셋</span>
            <label class="ge-toggle-switch">
              <input type="checkbox" id="geAutoApplyToggle" />
              <span class="ge-toggle-slider"></span>
            </label>
          </div>
          <div class="ge-auto-apply-fields" id="geAutoApplyFields" style="display:none">
            <div class="ge-prop-row">
              <label>유형</label>
              <select id="geAutoApplyType" class="ge-select">
                <option value="">(미정)</option>
                ${ROOM_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
              </select>
            </div>
            <div class="ge-prop-row">
              <label>Ref 접두</label>
              <input type="text" id="geAutoApplyPrefix" class="ge-input" placeholder="예: 231" />
            </div>
          </div>
        </div>
        <p class="ge-hint">방을 클릭해서 ref / type을 편집하세요. 숫자키로 ref 직접 입력.</p>
      </div>

      <div class="ge-section ge-actions">
        <div class="ge-action-row">
          <button class="ge-action-btn" id="geUndo" title="Ctrl+Z">
            <span class="material-icons" style="font-size:16px">undo</span> Undo
          </button>
          <button class="ge-action-btn" id="geRedo" title="Ctrl+Y">
            <span class="material-icons" style="font-size:16px">redo</span> Redo
          </button>
        </div>
        <div class="ge-action-row">
          <button class="ge-action-btn" id="geImport">
            <span class="material-icons" style="font-size:16px">file_upload</span> Import
          </button>
          <button class="ge-action-btn" id="geExport">
            <span class="material-icons" style="font-size:16px">file_download</span> Export
          </button>
        </div>
        <button class="ge-action-btn" id="geVideoSettings">
            <span class="material-icons" style="font-size:16px">360</span> Video Settings
          </button>
        <button class="ge-action-btn ge-danger-btn" id="geClearAll">Clear All</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  panelEl = panel;

  wireEvents();
  return panel;
}

export function destroyPanel(): void {
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
  callbacks = null;
}

export function updateInfo(nodeCount: number, edgeCount: number, level: number): void {
  setText('geInfoLevel', `${level}F`);
  setText('geInfoNodes', `${nodeCount} nodes`);
  setText('geInfoEdges', `${edgeCount} edges`);
}

export function showNodeProperties(node: NavNode | null): void {
  const propsEl = document.getElementById('geNodeProps');
  if (!propsEl) return;

  if (!node) {
    propsEl.style.display = 'none';
    return;
  }

  propsEl.style.display = 'block';
  setText('geNodeId', node.id.slice(0, 16));
  setText('geNodeCoord', `${node.coordinates[0].toFixed(6)}, ${node.coordinates[1].toFixed(6)}`);
  setText('geNodeBuilding', node.building);

  const levelInput = document.getElementById('geNodeLevel') as HTMLInputElement;
  if (levelInput) levelInput.value = String(node.level);

  const typeSelect = document.getElementById('geNodeType') as HTMLSelectElement;
  if (typeSelect) typeSelect.value = node.type;

  const labelInput = document.getElementById('geNodeLabel') as HTMLInputElement;
  if (labelInput) labelInput.value = node.label;
}

export function hideNodeProperties(): void {
  const propsEl = document.getElementById('geNodeProps');
  if (propsEl) propsEl.style.display = 'none';
}

export function setActiveMode(mode: EditorMode): void {
  document.querySelectorAll('.ge-mode-btn').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
  });

  const addNodeOpts = document.getElementById('geAddNodeOpts');
  if (addNodeOpts) addNodeOpts.style.display = mode === 'add-node' ? 'block' : 'none';

  const edgeProps = document.getElementById('geEdgeProps');
  if (edgeProps) edgeProps.style.display = 'none';

  const multiEdgeProps = document.getElementById('geMultiEdgeProps');
  if (multiEdgeProps) multiEdgeProps.style.display = 'none';

  const edgeInfo = document.getElementById('geEdgeInfo');
  if (edgeInfo) edgeInfo.style.display = mode === 'add-edge' ? 'block' : 'none';

  const roomProps = document.getElementById('geRoomProps');
  if (roomProps) roomProps.style.display = mode === 'label-room' ? 'block' : 'none';
}

export function getAddNodeType(): NavNodeType {
  const sel = document.getElementById('geAddNodeType') as HTMLSelectElement;
  return (sel?.value as NavNodeType) || 'corridor';
}

export function showRoomProperties(props: { _idx?: number; _area_m2?: number; ref?: string; room_type?: string }): void {
  setText('geRoomIdx', String(props._idx ?? '?'));
  setText('geRoomArea', `${props._area_m2 ?? 0} m²`);

  const refInput = document.getElementById('geRoomRef') as HTMLInputElement;
  if (refInput) refInput.value = props.ref ?? '';

  const typeSelect = document.getElementById('geRoomType') as HTMLSelectElement;
  if (typeSelect) typeSelect.value = props.room_type ?? '';

  // Store idx for updates
  const roomPropsEl = document.getElementById('geRoomProps');
  if (roomPropsEl) roomPropsEl.dataset.featureIdx = String(props._idx ?? '');
}

export function updateRoomRefInput(ref: string): void {
  const refInput = document.getElementById('geRoomRef') as HTMLInputElement;
  if (refInput) refInput.value = ref;
}

export function showEdgeProperties(edge: NavEdge, fromNode: NavNode, toNode: NavNode): void {
  const propsEl = document.getElementById('geEdgeProps');
  if (!propsEl) return;

  propsEl.style.display = 'block';
  propsEl.dataset.edgeId = edge.id;

  const fromLabel = fromNode.label || fromNode.id.slice(5, 13);
  const toLabel = toNode.label || toNode.id.slice(5, 13);
  setText('geEdgeWeight', edge.weight + 'm');

  // Detect vertical edge (stairs/elevator)
  const isVertical = fromNode.type === 'stairs' || fromNode.type === 'elevator'
    || toNode.type === 'stairs' || toNode.type === 'elevator'
    || fromNode.level !== toNode.level;

  // Direction labels
  setText('geEdgeFwdLabel', `FWD  ${fromLabel} → ${toLabel}`);
  setText('geEdgeRevLabel', `REV  ${toLabel} → ${fromLabel}`);

  // Populate video dropdowns
  const suggested = suggestVideosForEdge(fromNode, toNode);

  function populateVideoSelect(selectEl: HTMLSelectElement): void {
    selectEl.innerHTML = '<option value="">(없음)</option>';
    const groups: Record<string, typeof suggested> = { corridor: [], stair: [], elevator: [] };
    for (const v of suggested) groups[v.type].push(v);
    const tLabels: Record<string, string> = { corridor: '복도', stair: '계단', elevator: '엘리베이터' };
    for (const type of ['corridor', 'stair', 'elevator'] as const) {
      if (groups[type].length === 0) continue;
      const optgroup = document.createElement('optgroup');
      optgroup.label = tLabels[type];
      for (const v of groups[type]) {
        const opt = document.createElement('option');
        opt.value = v.filename;
        opt.textContent = v.label;
        optgroup.appendChild(opt);
      }
      selectEl.appendChild(optgroup);
    }
  }

  for (const dir of ['Fwd', 'Rev'] as const) {
    // Entry/main video
    const selectEl = document.getElementById(`geEdgeVideo${dir}`) as HTMLSelectElement;
    if (selectEl) {
      populateVideoSelect(selectEl);
      const videoKey = dir === 'Fwd' ? 'videoFwd' : 'videoRev';
      selectEl.value = edge[videoKey] || '';

      const hasVideo = !!edge[videoKey];
      const timeRow = document.getElementById(`geEdge${dir}TimeRow`);
      if (timeRow) timeRow.style.display = hasVideo ? 'flex' : 'none';

      const startKey = dir === 'Fwd' ? 'videoFwdStart' : 'videoRevStart';
      const endKey = dir === 'Fwd' ? 'videoFwdEnd' : 'videoRevEnd';
      const s = edge[startKey];
      const e2 = edge[endKey];
      setText(`geEdge${dir}Time`, (s !== undefined && e2 !== undefined) ? `${fmtSec(s)} ~ ${fmtSec(e2)}` : '-');
    }

    // Show/hide "들어갈 때" label and exit section
    const entryLabel = document.getElementById(`geEdge${dir}EntryLabel`);
    if (entryLabel) entryLabel.style.display = isVertical ? 'block' : 'none';

    const exitSection = document.getElementById(`geEdge${dir}ExitSection`);
    if (exitSection) exitSection.style.display = isVertical ? 'block' : 'none';

    // Exit video (vertical edges only)
    if (isVertical) {
      const exitSelect = document.getElementById(`geEdgeVideo${dir}Exit`) as HTMLSelectElement;
      if (exitSelect) {
        populateVideoSelect(exitSelect);
        const exitVideoKey = dir === 'Fwd' ? 'videoFwdExit' : 'videoRevExit';
        exitSelect.value = edge[exitVideoKey] || '';

        const hasExitVideo = !!edge[exitVideoKey];
        const exitTimeRow = document.getElementById(`geEdge${dir}ExitTimeRow`);
        if (exitTimeRow) exitTimeRow.style.display = hasExitVideo ? 'flex' : 'none';

        const exitStartKey = dir === 'Fwd' ? 'videoFwdExitStart' : 'videoRevExitStart';
        const exitEndKey = dir === 'Fwd' ? 'videoFwdExitEnd' : 'videoRevExitEnd';
        const es = edge[exitStartKey];
        const ee = edge[exitEndKey];
        setText(`geEdge${dir}ExitTime`, (es !== undefined && ee !== undefined) ? `${fmtSec(es)} ~ ${fmtSec(ee)}` : '-');
      }
    }
  }
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`;
}

interface ChainEntry { edge: NavEdge; aligned: boolean; }

function getOrderedChain(edges: NavEdge[]): ChainEntry[] | null {
  if (edges.length <= 1) return edges.map(e => ({ edge: e, aligned: true }));

  // Build adjacency: node → edges touching it
  const nodeToEdges = new Map<string, NavEdge[]>();
  for (const e of edges) {
    for (const nid of [e.from, e.to]) {
      if (!nodeToEdges.has(nid)) nodeToEdges.set(nid, []);
      nodeToEdges.get(nid)!.push(e);
    }
  }

  // Endpoint nodes = touched by only 1 selected edge (chain ends)
  const endpoints = [...nodeToEdges.entries()]
    .filter(([, list]) => list.length === 1)
    .map(([n]) => n);
  if (endpoints.length !== 2) return null;

  // Deterministic start: alphabetically first node ID
  endpoints.sort();

  // Walk chain from start, assigning E1, E2, E3...
  const result: ChainEntry[] = [];
  const used = new Set<string>();
  let current = endpoints[0];

  while (result.length < edges.length) {
    const next = (nodeToEdges.get(current) || []).find(e => !used.has(e.id));
    if (!next) return null;
    used.add(next.id);
    const aligned = next.from === current;
    result.push({ edge: next, aligned });
    current = aligned ? next.to : next.from;
  }

  return result;
}

export function hideEdgeProperties(): void {
  const propsEl = document.getElementById('geEdgeProps');
  if (propsEl) propsEl.style.display = 'none';
  const multiEl = document.getElementById('geMultiEdgeProps');
  if (multiEl) multiEl.style.display = 'none';
}

export function showMultiEdgeProperties(edges: NavEdge[], nodes: Record<string, NavNode>): void {
  // Hide single-edge panel
  const singleEl = document.getElementById('geEdgeProps');
  if (singleEl) singleEl.style.display = 'none';

  const multiEl = document.getElementById('geMultiEdgeProps');
  if (!multiEl) return;
  multiEl.style.display = 'block';

  setText('geMultiEdgeCount', `${edges.length} edges selected`);

  // Store edge IDs
  multiEl.dataset.edgeIds = edges.map(e => e.id).join(',');

  // Build ordered chain (E1, E2, E3...)
  const chain = getOrderedChain(edges);

  // Derive start/end labels from the chain
  if (chain && chain.length > 0) {
    const first = chain[0];
    const last = chain[chain.length - 1];
    const startId = first.aligned ? first.edge.from : first.edge.to;
    const endId = last.aligned ? last.edge.to : last.edge.from;
    const startLabel = nodes[startId]?.label || startId.slice(5, 13);
    const endLabel = nodes[endId]?.label || endId.slice(5, 13);
    setText('geMultiEdgeFwdLabel', `FWD  ${startLabel} → ${endLabel}`);
    setText('geMultiEdgeRevLabel', `REV  ${endLabel} → ${startLabel}`);
  }
  const orderedEdges = chain ? chain.map(c => c.edge) : edges;

  function resolveKeys(chainIdx: number, dir: 'fwd' | 'rev') {
    const aligned = chain ? chain[chainIdx].aligned : true;
    const effectiveFwd = (dir === 'fwd') === aligned;
    return {
      videoKey: effectiveFwd ? 'videoFwd' as const : 'videoRev' as const,
      startKey: effectiveFwd ? 'videoFwdStart' as const : 'videoRevStart' as const,
      endKey: effectiveFwd ? 'videoFwdEnd' as const : 'videoRevEnd' as const,
    };
  }

  // Populate both direction rows
  const allVideos = getAllVideos();
  const groups: Record<string, typeof allVideos> = { corridor: [], stair: [], elevator: [] };
  for (const v of allVideos) groups[v.type].push(v);
  const typeLabels: Record<string, string> = { corridor: '복도', stair: '계단', elevator: '엘리베이터' };

  for (const dir of ['Fwd', 'Rev'] as const) {
    const dirKey = dir.toLowerCase() as 'fwd' | 'rev';
    const selectEl = document.getElementById(`geMultiEdgeVideo${dir}`) as HTMLSelectElement;
    if (!selectEl) continue;

    // Populate dropdown
    selectEl.innerHTML = '<option value="">(없음)</option>';
    for (const type of ['corridor', 'stair', 'elevator'] as const) {
      if (groups[type].length === 0) continue;
      const optgroup = document.createElement('optgroup');
      optgroup.label = typeLabels[type];
      for (const v of groups[type]) {
        const opt = document.createElement('option');
        opt.value = v.filename;
        opt.textContent = v.label;
        optgroup.appendChild(opt);
      }
      selectEl.appendChild(optgroup);
    }

    // Auto-select video if all edges share the same one
    const videos = orderedEdges.map((e, i) => e[resolveKeys(i, dirKey).videoKey]).filter(Boolean);
    const uniqueVideos = [...new Set(videos)];
    if (uniqueVideos.length === 1) selectEl.value = uniqueVideos[0]!;

    // Show/hide split row and time info
    const hasVideo = !!selectEl.value;
    const splitRow = document.getElementById(`geMultiEdge${dir}SplitRow`);
    if (splitRow) splitRow.style.display = hasVideo ? 'flex' : 'none';

    const infoEl = document.getElementById(`geMultiEdge${dir}TimeInfo`);
    if (infoEl) {
      const hasAnyTimes = orderedEdges.some((e, i) => e[resolveKeys(i, dirKey).startKey] !== undefined);
      if (hasAnyTimes && uniqueVideos.length === 1) {
        const lines: string[] = [];
        for (let i = 0; i < orderedEdges.length; i++) {
          // For REV, reverse the display: E1 = chain end (REV start)
          const chainIdx = dirKey === 'rev' ? orderedEdges.length - 1 - i : i;
          const keys = resolveKeys(chainIdx, dirKey);
          const s = orderedEdges[chainIdx][keys.startKey];
          const e2 = orderedEdges[chainIdx][keys.endKey];
          const timeStr = (s !== undefined && e2 !== undefined) ? `${fmtSec(s)}~${fmtSec(e2)}` : '?';
          lines.push(`E${i + 1}: ${timeStr}`);
        }
        infoEl.textContent = lines.join('  ');
        infoEl.style.display = 'block';
      } else {
        infoEl.style.display = 'none';
      }
    }
  }
}

export function setEdgeHint(text: string): void {
  setText('geEdgeHint', text);
}

// ===== Internal =====

function wireEvents(): void {
  // Collapse
  document.getElementById('gePanelCollapse')?.addEventListener('click', () => {
    collapsed = !collapsed;
    const body = document.getElementById('gePanelBody');
    if (body) body.style.display = collapsed ? 'none' : 'block';
    const icon = document.querySelector('#gePanelCollapse .material-icons') as HTMLElement;
    if (icon) icon.textContent = collapsed ? 'expand_less' : 'remove';
  });

  // Close
  document.getElementById('gePanelClose')?.addEventListener('click', () => {
    callbacks?.onClose();
  });

  // Mode buttons
  document.querySelectorAll('.ge-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as EditorMode;
      callbacks?.onModeChange(mode);
    });
  });

  // Node level change
  document.getElementById('geNodeLevel')?.addEventListener('change', (e) => {
    const fullId = (document.getElementById('geNodeProps') as HTMLElement)?.dataset.nodeId;
    if (fullId) {
      const level = parseInt((e.target as HTMLInputElement).value);
      if (!isNaN(level) && level >= 1) {
        callbacks?.onNodeUpdate(fullId, { level });
      }
    }
  });

  // Node type change
  document.getElementById('geNodeType')?.addEventListener('change', (e) => {
    const nodeIdText = document.getElementById('geNodeId')?.textContent;
    if (!nodeIdText) return;
    // We need the full node id — stored in data attribute
    const fullId = (document.getElementById('geNodeProps') as HTMLElement)?.dataset.nodeId;
    if (fullId) {
      callbacks?.onNodeUpdate(fullId, { type: (e.target as HTMLSelectElement).value as NavNodeType });
    }
  });

  // Node label change
  document.getElementById('geNodeLabel')?.addEventListener('change', (e) => {
    const fullId = (document.getElementById('geNodeProps') as HTMLElement)?.dataset.nodeId;
    if (fullId) {
      callbacks?.onNodeUpdate(fullId, { label: (e.target as HTMLInputElement).value });
    }
  });

  // Node delete
  document.getElementById('geNodeDelete')?.addEventListener('click', () => {
    const fullId = (document.getElementById('geNodeProps') as HTMLElement)?.dataset.nodeId;
    if (fullId) callbacks?.onNodeDelete(fullId);
  });

  // Undo / Redo
  document.getElementById('geUndo')?.addEventListener('click', () => callbacks?.onUndo());
  document.getElementById('geRedo')?.addEventListener('click', () => callbacks?.onRedo());

  // Import
  document.getElementById('geImport')?.addEventListener('click', () => callbacks?.onImport());

  // Export
  document.getElementById('geExport')?.addEventListener('click', () => callbacks?.onExport());

  // Video settings
  document.getElementById('geVideoSettings')?.addEventListener('click', () => {
    openVideoSettingsPanel();
  });

  // Clear all
  document.getElementById('geClearAll')?.addEventListener('click', () => {
    if (confirm('모든 노드와 엣지를 삭제하시겠습니까?')) {
      callbacks?.onClearAll();
    }
  });

  // Room ref change
  document.getElementById('geRoomRef')?.addEventListener('change', (e) => {
    const idx = parseInt(document.getElementById('geRoomProps')?.dataset.featureIdx ?? '');
    if (!isNaN(idx)) {
      callbacks?.onRoomUpdate(idx, { ref: (e.target as HTMLInputElement).value });
    }
  });

  // Room type change
  document.getElementById('geRoomType')?.addEventListener('change', (e) => {
    const idx = parseInt(document.getElementById('geRoomProps')?.dataset.featureIdx ?? '');
    if (!isNaN(idx)) {
      callbacks?.onRoomUpdate(idx, { room_type: (e.target as HTMLSelectElement).value });
    }
  });

  // Room export
  document.getElementById('geRoomExport')?.addEventListener('click', () => {
    callbacks?.onRoomExport();
  });

  // Edge video change — forward (auto-assigns reverse)
  document.getElementById('geEdgeVideoFwd')?.addEventListener('change', (e) => {
    const edgeId = document.getElementById('geEdgeProps')?.dataset.edgeId;
    if (edgeId) {
      const videoFwd = (e.target as HTMLSelectElement).value || undefined;
      const props: Record<string, any> = { videoFwd };
      const timeRow = document.getElementById('geEdgeFwdTimeRow');
      if (timeRow) timeRow.style.display = videoFwd ? 'flex' : 'none';

      // Auto-assign reverse
      if (videoFwd) {
        const opposite = getOppositeVideo(videoFwd);
        if (opposite) {
          props.videoRev = opposite;
          const revSelect = document.getElementById('geEdgeVideoRev') as HTMLSelectElement;
          if (revSelect) revSelect.value = opposite;
          const revTimeRow = document.getElementById('geEdgeRevTimeRow');
          if (revTimeRow) revTimeRow.style.display = 'flex';
        }
      }
      callbacks?.onEdgeUpdate(edgeId, props);
    }
  });

  // Edge video change — reverse (auto-assigns forward)
  document.getElementById('geEdgeVideoRev')?.addEventListener('change', (e) => {
    const edgeId = document.getElementById('geEdgeProps')?.dataset.edgeId;
    if (edgeId) {
      const videoRev = (e.target as HTMLSelectElement).value || undefined;
      const props: Record<string, any> = { videoRev };
      const timeRow = document.getElementById('geEdgeRevTimeRow');
      if (timeRow) timeRow.style.display = videoRev ? 'flex' : 'none';

      // Auto-assign forward
      if (videoRev) {
        const opposite = getOppositeVideo(videoRev);
        if (opposite) {
          props.videoFwd = opposite;
          const fwdSelect = document.getElementById('geEdgeVideoFwd') as HTMLSelectElement;
          if (fwdSelect) fwdSelect.value = opposite;
          const fwdTimeRow = document.getElementById('geEdgeFwdTimeRow');
          if (fwdTimeRow) fwdTimeRow.style.display = 'flex';
        }
      }
      callbacks?.onEdgeUpdate(edgeId, props);
    }
  });

  // Set time — forward / reverse (entry)
  document.getElementById('geSetTimeFwd')?.addEventListener('click', () => {
    const edgeId = document.getElementById('geEdgeProps')?.dataset.edgeId;
    if (edgeId) callbacks?.onSetTime(edgeId, 'fwd');
  });
  document.getElementById('geSetTimeRev')?.addEventListener('click', () => {
    const edgeId = document.getElementById('geEdgeProps')?.dataset.edgeId;
    if (edgeId) callbacks?.onSetTime(edgeId, 'rev');
  });

  // Exit video change — forward (auto-assigns reverse exit for stairs)
  document.getElementById('geEdgeVideoFwdExit')?.addEventListener('change', (e) => {
    const edgeId = document.getElementById('geEdgeProps')?.dataset.edgeId;
    if (edgeId) {
      const v = (e.target as HTMLSelectElement).value || undefined;
      const props: Record<string, any> = { videoFwdExit: v };
      const row = document.getElementById('geEdgeFwdExitTimeRow');
      if (row) row.style.display = v ? 'flex' : 'none';

      if (v) {
        const opposite = getOppositeVideo(v);
        if (opposite) {
          props.videoRevExit = opposite;
          const revSelect = document.getElementById('geEdgeVideoRevExit') as HTMLSelectElement;
          if (revSelect) revSelect.value = opposite;
          const revRow = document.getElementById('geEdgeRevExitTimeRow');
          if (revRow) revRow.style.display = 'flex';
        }
      }
      callbacks?.onEdgeUpdate(edgeId, props);
    }
  });
  document.getElementById('geEdgeVideoRevExit')?.addEventListener('change', (e) => {
    const edgeId = document.getElementById('geEdgeProps')?.dataset.edgeId;
    if (edgeId) {
      const v = (e.target as HTMLSelectElement).value || undefined;
      const props: Record<string, any> = { videoRevExit: v };
      const row = document.getElementById('geEdgeRevExitTimeRow');
      if (row) row.style.display = v ? 'flex' : 'none';

      if (v) {
        const opposite = getOppositeVideo(v);
        if (opposite) {
          props.videoFwdExit = opposite;
          const fwdSelect = document.getElementById('geEdgeVideoFwdExit') as HTMLSelectElement;
          if (fwdSelect) fwdSelect.value = opposite;
          const fwdRow = document.getElementById('geEdgeFwdExitTimeRow');
          if (fwdRow) fwdRow.style.display = 'flex';
        }
      }
      callbacks?.onEdgeUpdate(edgeId, props);
    }
  });

  // Set time — exit clips
  document.getElementById('geSetTimeFwdExit')?.addEventListener('click', () => {
    const edgeId = document.getElementById('geEdgeProps')?.dataset.edgeId;
    if (edgeId) callbacks?.onSetTime(edgeId, 'fwdExit');
  });
  document.getElementById('geSetTimeRevExit')?.addEventListener('click', () => {
    const edgeId = document.getElementById('geEdgeProps')?.dataset.edgeId;
    if (edgeId) callbacks?.onSetTime(edgeId, 'revExit');
  });

  // Edge delete
  document.getElementById('geEdgeDelete')?.addEventListener('click', () => {
    const edgeId = document.getElementById('geEdgeProps')?.dataset.edgeId;
    if (edgeId) callbacks?.onEdgeDelete(edgeId);
  });

  // Multi-edge video change + split assign — per direction
  for (const dir of ['Fwd', 'Rev'] as const) {
    const dirKey = dir.toLowerCase() as 'fwd' | 'rev';

    // Video dropdown change → immediate assign
    document.getElementById(`geMultiEdgeVideo${dir}`)?.addEventListener('change', (e) => {
      const video = (e.target as HTMLSelectElement).value || undefined;
      const splitRow = document.getElementById(`geMultiEdge${dir}SplitRow`);
      if (splitRow) splitRow.style.display = video ? 'flex' : 'none';

      const multiEl = document.getElementById('geMultiEdgeProps');
      const edgeIdsStr = multiEl?.dataset.edgeIds;
      if (!edgeIdsStr) return;
      callbacks?.onBatchVideoAssign(edgeIdsStr.split(','), dirKey, video);
    });

    // Split assign button
    document.getElementById(`geSplitAssign${dir}`)?.addEventListener('click', () => {
      const multiEl = document.getElementById('geMultiEdgeProps');
      const edgeIdsStr = multiEl?.dataset.edgeIds;
      if (!edgeIdsStr) return;
      const video = (document.getElementById(`geMultiEdgeVideo${dir}`) as HTMLSelectElement)?.value;
      if (video) callbacks?.onSplitAssign(edgeIdsStr.split(','), dirKey, video);
    });
  }

  // Auto-apply toggle
  document.getElementById('geAutoApplyToggle')?.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    const fields = document.getElementById('geAutoApplyFields');
    if (fields) fields.style.display = enabled ? 'block' : 'none';
    emitAutoApplyChange();
  });

  // Auto-apply type change
  document.getElementById('geAutoApplyType')?.addEventListener('change', () => {
    emitAutoApplyChange();
  });

  // Auto-apply prefix change
  document.getElementById('geAutoApplyPrefix')?.addEventListener('input', () => {
    emitAutoApplyChange();
  });
}

function emitAutoApplyChange(): void {
  const toggle = document.getElementById('geAutoApplyToggle') as HTMLInputElement;
  const typeSelect = document.getElementById('geAutoApplyType') as HTMLSelectElement;
  const prefixInput = document.getElementById('geAutoApplyPrefix') as HTMLInputElement;
  if (!toggle || !typeSelect || !prefixInput) return;

  callbacks?.onAutoApplyChange({
    enabled: toggle.checked,
    roomType: (typeSelect.value || '') as RoomType,
    refPrefix: prefixInput.value,
  });
}

// Store full node id when showing properties
export function setNodeIdData(nodeId: string): void {
  const propsEl = document.getElementById('geNodeProps');
  if (propsEl) propsEl.dataset.nodeId = nodeId;
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
