// ===== Navigation Graph Editor — Floating Panel UI =====

import { NavNode, EditorMode, PanelCallbacks, ALL_NODE_TYPES, NODE_TYPE_LABELS, NavNodeType, ROOM_TYPES, RoomAutoApplyPreset, RoomType } from './graphEditorTypes';

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
