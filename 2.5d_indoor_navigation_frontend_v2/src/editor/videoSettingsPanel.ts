// ===== Video Settings Panel — bulk yaw assignment per video =====
// Organized as a collapsible tree: Building > Type > Floor
//
// The tree is built from the actual files present under videos/ (any depth)
// as reported by GET /api/videos-list, so newly dropped buildings/files
// appear automatically. Filename conventions ({floor} is a bare number for
// above-ground floors and "B1"/"B2"… for basements — e.g. slib_c_FB1_3_cw.mp4):
//   Corridor : {building}_c_F{floor}_{id}_{cw|ccw}.mp4
//   Stair    : {building}_s_{id}_{floor}{e|o}{u|d}.mp4
//   Elevator : {building}_e_{id}_{floor}{e|o}.mp4

import * as VideoSettings from './videoSettings';
import { VideoYawEntry } from './videoSettings';
import { openVideoPreview } from './videoPreview';
import { formatLevel, parseFloorToken } from '../utils/formatLevel';

let overlayEl: HTMLElement | null = null;

interface ParsedFile {
  filename: string;
  building: string;
  kind: 'corridor' | 'stair' | 'elevator' | 'other';
  floor?: number;
  id?: number;
  direction?: 'cw' | 'ccw';
  action?: 'enter' | 'exit';
  vDirection?: 'up' | 'down';
  label: string;
}

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
  body.textContent = 'Loading…';

  panel.appendChild(header);
  panel.appendChild(body);

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);

  backdrop.addEventListener('click', close);
  overlayEl = panel;
  (panel as any)._backdrop = backdrop;

  void buildSettingsTree(body);
}

// ===== Build collapsible tree from actual files =====

async function buildSettingsTree(body: HTMLElement): Promise<void> {
  let files: string[] = [];
  try {
    const res = await fetch('/api/videos-list');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    files = (await res.json()).files ?? [];
  } catch (err) {
    body.textContent = `Failed to load video list: ${err}`;
    return;
  }

  body.textContent = '';

  if (files.length === 0) {
    body.textContent = 'No videos found under videos/.';
    return;
  }

  const parsed = files.map(parseVideoFilename);

  // Group by building
  const byBuilding: Record<string, ParsedFile[]> = {};
  for (const p of parsed) {
    (byBuilding[p.building] ??= []).push(p);
  }

  const buildings = Object.keys(byBuilding).sort();
  for (const building of buildings) {
    const buildingFolder = createTreeFolder(building, buildings.length === 1);
    body.appendChild(buildingFolder.el);
    buildBuildingSubtree(buildingFolder.children, byBuilding[building]);
  }
}

function buildBuildingSubtree(parent: HTMLElement, items: ParsedFile[]): void {
  const corridors: ParsedFile[] = [];
  const stairs: ParsedFile[] = [];
  const elevators: ParsedFile[] = [];
  const others: ParsedFile[] = [];
  for (const p of items) {
    if (p.kind === 'corridor') corridors.push(p);
    else if (p.kind === 'stair') stairs.push(p);
    else if (p.kind === 'elevator') elevators.push(p);
    else others.push(p);
  }

  if (corridors.length) {
    const folder = createTreeFolder('Corridor', false);
    parent.appendChild(folder.el);
    const byFloor = groupBy(corridors, (p) => p.floor ?? 0);
    for (const floor of sortedNumKeys(byFloor)) {
      const ff = createTreeFolder(formatLevel(floor), false);
      folder.children.appendChild(ff.el);
      for (const v of byFloor[floor].sort(byFilename)) {
        ff.children.appendChild(buildRow(v, 'yaw'));
      }
    }
  }

  if (stairs.length) {
    const folder = createTreeFolder('Stairs', false);
    parent.appendChild(folder.el);
    const byId = groupBy(stairs, (p) => p.id ?? 0);
    for (const id of sortedNumKeys(byId)) {
      const idFolder = createTreeFolder(`계단 ${id}`, false);
      folder.children.appendChild(idFolder.el);
      const byFloor = groupBy(byId[id], (p) => p.floor ?? 0);
      for (const floor of sortedNumKeys(byFloor)) {
        const ff = createTreeFolder(formatLevel(floor), false);
        idFolder.children.appendChild(ff.el);
        for (const v of byFloor[floor].sort(byFilename)) {
          ff.children.appendChild(buildRow(v, v.action === 'enter' ? 'entryYaw' : 'exitYaw'));
        }
      }
    }
  }

  if (elevators.length) {
    const folder = createTreeFolder('Elevator', false);
    parent.appendChild(folder.el);
    const byId = groupBy(elevators, (p) => p.id ?? 0);
    for (const id of sortedNumKeys(byId)) {
      const idFolder = createTreeFolder(`엘리베이터 ${id}`, false);
      folder.children.appendChild(idFolder.el);
      const byFloor = groupBy(byId[id], (p) => p.floor ?? 0);
      for (const floor of sortedNumKeys(byFloor)) {
        const ff = createTreeFolder(formatLevel(floor), false);
        idFolder.children.appendChild(ff.el);
        for (const v of byFloor[floor].sort(byFilename)) {
          ff.children.appendChild(buildRow(v, v.action === 'enter' ? 'entryYaw' : 'exitYaw'));
        }
      }
    }
  }

  if (others.length) {
    const folder = createTreeFolder('Other', false);
    parent.appendChild(folder.el);
    for (const v of others.sort(byFilename)) {
      folder.children.appendChild(buildRow(v, 'yaw'));
    }
  }
}

// ===== Filename parser =====

// A floor token is a bare number ("1".."5") or a basement marker ("B1", "B2"…).
const FLOOR_TOK = String.raw`B?-?\d+`;

function parseVideoFilename(filename: string): ParsedFile {
  const corridor = filename.match(new RegExp(String.raw`^(.+?)_c_F(${FLOOR_TOK})_(\d+)_(cw|ccw)\.mp4$`, 'i'));
  if (corridor) {
    const [, building, floorTok, id, dir] = corridor;
    const floor = parseFloorToken(floorTok);
    if (floor !== null) {
      const cw = dir.toLowerCase() === 'cw';
      return {
        filename,
        building,
        kind: 'corridor',
        floor,
        id: +id,
        direction: cw ? 'cw' : 'ccw',
        label: `${formatLevel(floor)} seg${id} ${cw ? '시계방향' : '반시계방향'}`,
      };
    }
  }
  const stair = filename.match(new RegExp(String.raw`^(.+?)_s_(\d+)_(${FLOOR_TOK})([eo])([ud])\.mp4$`, 'i'));
  if (stair) {
    const [, building, id, floorTok, ae, ud] = stair;
    const floor = parseFloorToken(floorTok);
    if (floor !== null) {
      const action = ae.toLowerCase() === 'e' ? 'enter' : 'exit';
      const vDirection = ud.toLowerCase() === 'u' ? 'up' : 'down';
      const arrow = vDirection === 'up' ? '↑' : '↓';
      const verb = action === 'enter' ? '진입' : '나옴';
      return {
        filename,
        building,
        kind: 'stair',
        id: +id,
        floor,
        action,
        vDirection,
        label: `계단${id} ${formatLevel(floor)} ${verb}${arrow}`,
      };
    }
  }
  const elev = filename.match(new RegExp(String.raw`^(.+?)_e_(\d+)_(${FLOOR_TOK})([eo])\.mp4$`, 'i'));
  if (elev) {
    const [, building, id, floorTok, ae] = elev;
    const floor = parseFloorToken(floorTok);
    if (floor !== null) {
      const action = ae.toLowerCase() === 'e' ? 'enter' : 'exit';
      const verb = action === 'enter' ? '진입' : '나옴';
      return {
        filename,
        building,
        kind: 'elevator',
        id: +id,
        floor,
        action,
        label: `엘리베이터${id} ${formatLevel(floor)} ${verb}`,
      };
    }
  }
  const prefix = filename.match(/^([^_.]+)/);
  return {
    filename,
    building: prefix?.[1] ?? 'other',
    kind: 'other',
    label: filename,
  };
}

// ===== Grouping helpers =====

function groupBy<T, K extends string | number>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}

function sortedNumKeys<T>(rec: Record<number, T>): number[] {
  return Object.keys(rec).map(Number).sort((a, b) => a - b);
}

function byFilename(a: ParsedFile, b: ParsedFile): number {
  return a.filename.localeCompare(b.filename);
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

// ===== Row builder =====

function buildRow(v: ParsedFile, field: keyof VideoYawEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ge-vs-row';

  const label = document.createElement('span');
  label.className = 'ge-vs-label';
  label.textContent = v.label;
  label.title = v.filename;

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
