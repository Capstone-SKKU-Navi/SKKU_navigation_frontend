// ===== Navigation Graph Editor — Floating Panel UI =====

import { NavNode, NavEdge, EditorMode, PanelCallbacks, ALL_NODE_TYPES, NODE_TYPE_LABELS, NavNodeType, ROOM_TYPES, RoomAutoApplyPreset, RoomType } from './graphEditorTypes';
import { suggestVideosForEdge, getAllVideos, getOppositeVideo, type VideoEntry } from './videoCatalog';
import { openVideoSettingsPanel } from './videoSettingsPanel';
import { computeStairVideos, computeElevatorVideos } from '../utils/verticalVideoFilename';

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
        <div class="ge-prop-row" id="geNodeVerticalIdRow" style="display:none">
          <label>Vertical ID</label>
          <input type="number" id="geNodeVerticalId" class="ge-input" min="1" max="10" style="width:60px" placeholder="계단/엘리베이터 번호" />
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
        <!-- FWD: corridor tree picker (hidden for vertical edges) -->
        <div id="geEdgeFwdCorridorSection">
          <div id="geEdgeFwdTreeContainer" class="ge-video-tree"></div>
          <div class="ge-prop-row ge-edge-time-row" id="geEdgeFwdTimeRow" style="display:none">
            <span id="geEdgeFwdTime" class="ge-edge-time">-</span>
            <button class="ge-small-btn" id="geSetTimeFwd" title="Set Time Range">
              <span class="material-icons" style="font-size:16px">timer</span>
            </button>
          </div>
        </div>
        <!-- FWD: auto-computed vertical videos (hidden for corridor edges) -->
        <div id="geEdgeFwdAutoSection" style="display:none">
          <div class="ge-auto-video-label">진입</div>
          <div class="ge-auto-video" id="geEdgeFwdAutoEntry">-</div>
          <div class="ge-auto-video-label">나옴</div>
          <div class="ge-auto-video" id="geEdgeFwdAutoExit">-</div>
        </div>

        <div class="ge-props-title" style="margin-top:6px">
          <span id="geEdgeRevLabel">← To → From</span>
        </div>
        <!-- REV: corridor tree picker -->
        <div id="geEdgeRevCorridorSection">
          <div id="geEdgeRevTreeContainer" class="ge-video-tree"></div>
          <div class="ge-prop-row ge-edge-time-row" id="geEdgeRevTimeRow" style="display:none">
            <span id="geEdgeRevTime" class="ge-edge-time">-</span>
            <button class="ge-small-btn" id="geSetTimeRev" title="Set Time Range">
              <span class="material-icons" style="font-size:16px">timer</span>
            </button>
          </div>
        </div>
        <!-- REV: auto-computed vertical videos -->
        <div id="geEdgeRevAutoSection" style="display:none">
          <div class="ge-auto-video-label">진입</div>
          <div class="ge-auto-video" id="geEdgeRevAutoEntry">-</div>
          <div class="ge-auto-video-label">나옴</div>
          <div class="ge-auto-video" id="geEdgeRevAutoExit">-</div>
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

  // Show verticalId field only for stairs/elevator nodes
  const verticalIdRow = document.getElementById('geNodeVerticalIdRow');
  const verticalIdInput = document.getElementById('geNodeVerticalId') as HTMLInputElement;
  const isVerticalNode = node.type === 'stairs' || node.type === 'elevator';
  if (verticalIdRow) verticalIdRow.style.display = isVerticalNode ? 'flex' : 'none';
  if (verticalIdInput) verticalIdInput.value = node.verticalId !== undefined ? String(node.verticalId) : '';
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

  // Vertical = both nodes are stairs or both are elevator
  const isVerticalStairs = fromNode.type === 'stairs' && toNode.type === 'stairs';
  const isVerticalElev = fromNode.type === 'elevator' && toNode.type === 'elevator';
  const isVertical = isVerticalStairs || isVerticalElev;

  // Direction labels
  setText('geEdgeFwdLabel', `FWD  ${fromLabel} → ${toLabel}`);
  setText('geEdgeRevLabel', `REV  ${toLabel} → ${fromLabel}`);

  for (const dir of ['Fwd', 'Rev'] as const) {
    const corridorSection = document.getElementById(`geEdge${dir}CorridorSection`);
    const autoSection = document.getElementById(`geEdge${dir}AutoSection`);

    if (isVertical) {
      // === Vertical edge: show auto-computed videos ===
      if (corridorSection) corridorSection.style.display = 'none';
      if (autoSection) autoSection.style.display = 'block';

      // Determine from/to for this direction
      const fNode = dir === 'Fwd' ? fromNode : toNode;
      const tNode = dir === 'Fwd' ? toNode : fromNode;
      const vId = fNode.verticalId ?? tNode.verticalId;

      if (vId !== undefined) {
        const result = isVerticalStairs
          ? computeStairVideos(fNode.building, vId, fNode.level, tNode.level)
          : computeElevatorVideos(fNode.building, vId, fNode.level, tNode.level);
        setText(`geEdge${dir}AutoEntry`, result.entryVideo);
        setText(`geEdge${dir}AutoExit`, result.exitVideo);
      } else {
        setText(`geEdge${dir}AutoEntry`, '(verticalId 미설정)');
        setText(`geEdge${dir}AutoExit`, '(verticalId 미설정)');
      }
    } else {
      // === Corridor edge: show tree picker ===
      if (corridorSection) corridorSection.style.display = 'block';
      if (autoSection) autoSection.style.display = 'none';

      const treeContainer = document.getElementById(`geEdge${dir}TreeContainer`);
      if (treeContainer) {
        const videos = suggestVideosForEdge(fromNode, toNode);
        const videoKey = dir === 'Fwd' ? 'videoFwd' : 'videoRev';
        const currentValue = edge[videoKey] || '';
        buildVideoTree(treeContainer, videos, currentValue, (filename) => {
          const edgeId = propsEl.dataset.edgeId;
          if (!edgeId) return;
          const startKey = dir === 'Fwd' ? 'videoFwdStart' : 'videoRevStart';
          const endKey = dir === 'Fwd' ? 'videoFwdEnd' : 'videoRevEnd';
          const props: Record<string, any> = { [videoKey]: filename || undefined };

          if (!filename) {
            // Cleared: remove time range
            props[startKey] = undefined;
            props[endKey] = undefined;
            callbacks?.onEdgeUpdate(edgeId, props);
            const timeRow = document.getElementById(`geEdge${dir}TimeRow`);
            if (timeRow) timeRow.style.display = 'none';
            return;
          }

          // Auto-assign opposite direction
          const opposite = getOppositeVideo(filename);
          if (opposite) {
            const otherKey = dir === 'Fwd' ? 'videoRev' : 'videoFwd';
            props[otherKey] = opposite;
            const otherDir = dir === 'Fwd' ? 'Rev' : 'Fwd';
            const otherTree = document.getElementById(`geEdge${otherDir}TreeContainer`);
            if (otherTree) selectTreeItem(otherTree, opposite);
          }

          // Auto-set start=0, end=duration by loading video metadata
          props[startKey] = 0;
          getVideoDuration(filename).then(duration => {
            props[endKey] = duration;
            callbacks?.onEdgeUpdate(edgeId, props);
            // Update time display
            const timeRow = document.getElementById(`geEdge${dir}TimeRow`);
            if (timeRow) timeRow.style.display = 'flex';
            setText(`geEdge${dir}Time`, `${fmtSec(0)} ~ ${fmtSec(duration)}`);

            // Also auto-set opposite direction time range
            if (opposite) {
              const otherStartKey = dir === 'Fwd' ? 'videoRevStart' : 'videoFwdStart';
              const otherEndKey = dir === 'Fwd' ? 'videoRevEnd' : 'videoFwdEnd';
              const otherDir = dir === 'Fwd' ? 'Rev' : 'Fwd';
              getVideoDuration(opposite).then(otherDur => {
                callbacks?.onEdgeUpdate(edgeId, { [otherStartKey]: 0, [otherEndKey]: otherDur });
                const otherTimeRow = document.getElementById(`geEdge${otherDir}TimeRow`);
                if (otherTimeRow) otherTimeRow.style.display = 'flex';
                setText(`geEdge${otherDir}Time`, `${fmtSec(0)} ~ ${fmtSec(otherDur)}`);
              });
            }
          });
        });
      }

      // Time row
      const videoKey = dir === 'Fwd' ? 'videoFwd' : 'videoRev';
      const hasVideo = !!edge[videoKey];
      const timeRow = document.getElementById(`geEdge${dir}TimeRow`);
      if (timeRow) timeRow.style.display = hasVideo ? 'flex' : 'none';

      const startKey = dir === 'Fwd' ? 'videoFwdStart' : 'videoRevStart';
      const endKey = dir === 'Fwd' ? 'videoFwdEnd' : 'videoRevEnd';
      const s = edge[startKey];
      const e2 = edge[endKey];
      setText(`geEdge${dir}Time`, (s !== undefined && e2 !== undefined) ? `${fmtSec(s)} ~ ${fmtSec(e2)}` : '-');
    }
  }
}

// ===== Collapsible Video Tree =====

function buildVideoTree(
  container: HTMLElement,
  videos: VideoEntry[],
  currentValue: string,
  onSelect: (filename: string) => void,
): void {
  container.innerHTML = '';

  // Group: building > floor
  const tree: Record<string, Record<string, VideoEntry[]>> = {};
  for (const v of videos) {
    const building = v.filename.split('_')[0] || 'unknown';
    const floor = v.floor !== undefined ? `F${v.floor}` : 'N/A';
    if (!tree[building]) tree[building] = {};
    if (!tree[building][floor]) tree[building][floor] = [];
    tree[building][floor].push(v);
  }

  for (const [building, floors] of Object.entries(tree)) {
    const buildingFolder = createFolder(building, true);
    container.appendChild(buildingFolder.el);

    const sortedFloors = Object.keys(floors).sort();
    for (const floor of sortedFloors) {
      const floorFolder = createFolder(floor, false);
      buildingFolder.children.appendChild(floorFolder.el);

      for (const v of floors[floor]) {
        const item = document.createElement('div');
        item.className = 'ge-tree-item' + (v.filename === currentValue ? ' selected' : '');
        item.dataset.value = v.filename;
        item.textContent = v.label || v.filename.replace('.mp4', '');
        item.title = v.filename;
        item.addEventListener('click', () => {
          container.querySelectorAll('.ge-tree-item.selected').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          onSelect(v.filename);
        });
        floorFolder.children.appendChild(item);
      }
    }
  }

  // "None" option at top
  const noneItem = document.createElement('div');
  noneItem.className = 'ge-tree-item' + (!currentValue ? ' selected' : '');
  noneItem.textContent = '(없음)';
  noneItem.addEventListener('click', () => {
    container.querySelectorAll('.ge-tree-item.selected').forEach(el => el.classList.remove('selected'));
    noneItem.classList.add('selected');
    onSelect('');
  });
  container.insertBefore(noneItem, container.firstChild);
}

function createFolder(label: string, startOpen: boolean): { el: HTMLElement; children: HTMLElement } {
  const el = document.createElement('div');
  const header = document.createElement('div');
  header.className = 'ge-tree-folder-header' + (startOpen ? ' open' : '');
  header.innerHTML = `<span class="material-icons">chevron_right</span>${label}`;
  const children = document.createElement('div');
  children.className = 'ge-tree-folder-children';
  children.style.display = startOpen ? 'block' : 'none';
  header.addEventListener('click', () => {
    const isOpen = children.style.display !== 'none';
    children.style.display = isOpen ? 'none' : 'block';
    header.classList.toggle('open', !isOpen);
  });
  el.appendChild(header);
  el.appendChild(children);
  return { el, children };
}

function selectTreeItem(container: HTMLElement, filename: string): void {
  container.querySelectorAll('.ge-tree-item.selected').forEach(el => el.classList.remove('selected'));
  const item = container.querySelector(`.ge-tree-item[data-value="${filename}"]`);
  if (item) item.classList.add('selected');
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`;
}

/** Load video metadata to get duration (seconds). */
function getVideoDuration(filename: string): Promise<number> {
  return new Promise(resolve => {
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.src = `/videos/${filename}`;
    vid.addEventListener('loadedmetadata', () => {
      const dur = vid.duration;
      vid.src = ''; // release
      resolve(isFinite(dur) ? dur : 0);
    });
    vid.addEventListener('error', () => resolve(0));
  });
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

  // Populate both direction rows (corridor videos only — vertical edges are auto-computed)
  const allVideos = getAllVideos();

  for (const dir of ['Fwd', 'Rev'] as const) {
    const dirKey = dir.toLowerCase() as 'fwd' | 'rev';
    const selectEl = document.getElementById(`geMultiEdgeVideo${dir}`) as HTMLSelectElement;
    if (!selectEl) continue;

    // Populate dropdown with corridor videos
    selectEl.innerHTML = '<option value="">(없음)</option>';
    for (const v of allVideos) {
      const opt = document.createElement('option');
      opt.value = v.filename;
      opt.textContent = v.label;
      selectEl.appendChild(opt);
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
    const fullId = (document.getElementById('geNodeProps') as HTMLElement)?.dataset.nodeId;
    if (fullId) {
      const newType = (e.target as HTMLSelectElement).value as NavNodeType;
      callbacks?.onNodeUpdate(fullId, { type: newType });
      // Show/hide verticalId row based on type
      const verticalIdRow = document.getElementById('geNodeVerticalIdRow');
      if (verticalIdRow) verticalIdRow.style.display = (newType === 'stairs' || newType === 'elevator') ? 'flex' : 'none';
    }
  });

  // Node verticalId change
  document.getElementById('geNodeVerticalId')?.addEventListener('change', (e) => {
    const fullId = (document.getElementById('geNodeProps') as HTMLElement)?.dataset.nodeId;
    if (fullId) {
      const val = parseInt((e.target as HTMLInputElement).value);
      callbacks?.onNodeUpdate(fullId, { verticalId: isNaN(val) ? undefined : val });
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

  // Video selection is now handled by the tree picker in showEdgeProperties()

  // Set time — forward / reverse (corridor edges only)
  document.getElementById('geSetTimeFwd')?.addEventListener('click', () => {
    const edgeId = document.getElementById('geEdgeProps')?.dataset.edgeId;
    if (edgeId) callbacks?.onSetTime(edgeId, 'fwd');
  });
  document.getElementById('geSetTimeRev')?.addEventListener('click', () => {
    const edgeId = document.getElementById('geEdgeProps')?.dataset.edgeId;
    if (edgeId) callbacks?.onSetTime(edgeId, 'rev');
  });

  // Exit time handlers removed — vertical clips are auto-computed and play in full

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
