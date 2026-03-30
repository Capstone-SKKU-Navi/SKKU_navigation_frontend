// ===== Video Settings Panel — bulk yaw assignment per video =====
// Organized as a collapsible tree: Building > Type > Floor

import { getAllVideos, VideoEntry } from './videoCatalog';
import { getAllVerticalVideos, ENG1_VERTICAL_CONFIG, VerticalVideoEntry } from '../utils/verticalVideoFilename';
import * as VideoSettings from './videoSettings';
import { VideoYawEntry } from './videoSettings';
import { openVideoPreview } from './videoPreview';

let overlayEl: HTMLElement | null = null;

export function openVideoSettingsPanel(): void {
  if (overlayEl) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'ge-video-preview-backdrop';

  const panel = document.createElement('div');
  panel.className = 'ge-video-settings-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'ge-video-preview-header';
  header.innerHTML = '<span>Video Settings</span>';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ge-header-btn';
  closeBtn.innerHTML = '<span class="material-icons" style="font-size:18px">close</span>';
  closeBtn.addEventListener('click', close);
  header.appendChild(closeBtn);

  // Body — collapsible tree
  const body = document.createElement('div');
  body.className = 'ge-video-settings-body';

  buildSettingsTree(body);

  panel.appendChild(header);
  panel.appendChild(body);

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  backdrop.addEventListener('click', close);
  overlayEl = panel;
  (panel as any)._backdrop = backdrop;
}

// ===== Build collapsible tree: Building > Type > Floor =====

function buildSettingsTree(body: HTMLElement): void {
  const corridorVideos = getAllVideos(); // corridor only
  const verticalVideos = getAllVerticalVideos(ENG1_VERTICAL_CONFIG);

  // Group corridors by floor
  const corridorByFloor: Record<number, VideoEntry[]> = {};
  for (const v of corridorVideos) {
    const f = v.floor ?? 0;
    if (!corridorByFloor[f]) corridorByFloor[f] = [];
    corridorByFloor[f].push(v);
  }

  // Group vertical by type > id > floor
  const stairEntries: Record<number, Record<number, VerticalVideoEntry[]>> = {};
  const elevEntries: Record<number, Record<number, VerticalVideoEntry[]>> = {};
  for (const v of verticalVideos) {
    const target = v.type === 'stair' ? stairEntries : elevEntries;
    if (!target[v.id]) target[v.id] = {};
    if (!target[v.id][v.floor]) target[v.id][v.floor] = [];
    target[v.id][v.floor].push(v);
  }

  // Building folder (eng1)
  const buildingFolder = createTreeFolder('eng1', true);
  body.appendChild(buildingFolder.el);

  // --- Corridor folder ---
  const corridorFolder = createTreeFolder('Corridor', false);
  buildingFolder.children.appendChild(corridorFolder.el);

  for (const floor of Object.keys(corridorByFloor).map(Number).sort()) {
    const floorFolder = createTreeFolder(`F${floor}`, false);
    corridorFolder.children.appendChild(floorFolder.el);

    for (const v of corridorByFloor[floor]) {
      floorFolder.children.appendChild(buildCorridorRow(v));
    }
  }

  // --- Stairs folder ---
  const stairsFolder = createTreeFolder('Stairs', false);
  buildingFolder.children.appendChild(stairsFolder.el);

  for (const stairId of Object.keys(stairEntries).map(Number).sort()) {
    const stairFolder = createTreeFolder(`계단 ${stairId}`, false);
    stairsFolder.children.appendChild(stairFolder.el);

    for (const floor of Object.keys(stairEntries[stairId]).map(Number).sort()) {
      const floorFolder = createTreeFolder(`F${floor}`, false);
      stairFolder.children.appendChild(floorFolder.el);

      for (const v of stairEntries[stairId][floor]) {
        floorFolder.children.appendChild(buildVerticalRow(v));
      }
    }
  }

  // --- Elevator folder ---
  const elevFolder = createTreeFolder('Elevator', false);
  buildingFolder.children.appendChild(elevFolder.el);

  for (const elevId of Object.keys(elevEntries).map(Number).sort()) {
    const eFolder = createTreeFolder(`엘리베이터 ${elevId}`, false);
    elevFolder.children.appendChild(eFolder.el);

    for (const floor of Object.keys(elevEntries[elevId]).map(Number).sort()) {
      const floorFolder = createTreeFolder(`F${floor}`, false);
      eFolder.children.appendChild(floorFolder.el);

      for (const v of elevEntries[elevId][floor]) {
        floorFolder.children.appendChild(buildVerticalRow(v));
      }
    }
  }
}

// ===== Tree folder helper =====

function createTreeFolder(label: string, startOpen: boolean): { el: HTMLElement; children: HTMLElement } {
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

// ===== Row builders =====

function buildCorridorRow(v: VideoEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ge-vs-row';

  const label = document.createElement('span');
  label.className = 'ge-vs-label';
  label.textContent = v.label;
  label.title = v.filename;

  const entry = VideoSettings.getEntry(v.filename);
  const yawSpan = document.createElement('span');
  yawSpan.className = 'ge-vs-yaw';
  yawSpan.textContent = fmtYaw(entry?.yaw);

  const btn = createPreviewBtn(v.filename, 'yaw', yawSpan);

  row.appendChild(label);
  row.appendChild(yawSpan);
  row.appendChild(btn);
  return row;
}

function buildVerticalRow(v: VerticalVideoEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ge-vs-row';

  const label = document.createElement('span');
  label.className = 'ge-vs-label';
  label.textContent = v.label;
  label.title = v.filename;

  const field = v.action === 'enter' ? 'entryYaw' as const : 'exitYaw' as const;
  const entry = VideoSettings.getEntry(v.filename);
  const yawSpan = document.createElement('span');
  yawSpan.className = 'ge-vs-yaw';
  yawSpan.textContent = fmtYaw(entry?.[field]);

  const btn = createPreviewBtn(v.filename, field, yawSpan);

  row.appendChild(label);
  row.appendChild(yawSpan);
  row.appendChild(btn);
  return row;
}

// ===== Helpers =====

function createPreviewBtn(
  filename: string,
  field: keyof VideoYawEntry,
  yawSpan: HTMLSpanElement,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'ge-small-btn';
  btn.innerHTML = '<span class="material-icons" style="font-size:16px">360</span>';
  btn.title = 'Set Direction';

  btn.addEventListener('click', () => {
    const videoUrl = `/videos/${filename}`;
    const current = VideoSettings.getEntry(filename);
    const currentYaw = current?.[field];
    openVideoPreview({
      videoUrl,
      initialYaw: currentYaw,
      onConfirm: (newYaw: number) => {
        VideoSettings.setField(filename, field, newYaw);
        yawSpan.textContent = fmtYaw(newYaw);
      },
      onCancel: () => {},
    });
  });

  return btn;
}

function fmtYaw(yaw: number | undefined): string {
  return yaw !== undefined ? `${yaw.toFixed(1)}°` : '-';
}

function close(): void {
  if (!overlayEl) return;
  const backdrop = (overlayEl as any)._backdrop as HTMLElement;
  backdrop?.remove();
  overlayEl.remove();
  overlayEl = null;
}
