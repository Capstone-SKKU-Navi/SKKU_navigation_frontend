// ===== Edge Video Start-Frame Preview — Floating, Draggable, Toggleable Window =====
//
// Singleton non-modal window showing the start frames of an edge's FWD and REV
// videos as side-by-side thumbnails. Lazy-created on first show; hidden via
// display:none rather than destroyed so position persists across toggles.

import { NavEdge, NavNode } from './graphEditorTypes';

let windowEl: HTMLDivElement | null = null;
let fwdVideo: HTMLVideoElement | null = null;
let revVideo: HTMLVideoElement | null = null;

function setPreview(videoEl: HTMLVideoElement, filename: string | undefined, startTime: number): void {
  if (!filename) {
    videoEl.removeAttribute('src');
    videoEl.load();
    videoEl.style.visibility = 'hidden';
    return;
  }
  const newSrc = `/videos/${filename}`;
  if (videoEl.src.endsWith(newSrc)) {
    videoEl.currentTime = startTime;
  } else {
    videoEl.src = newSrc;
    videoEl.addEventListener('loadedmetadata', () => {
      videoEl.currentTime = startTime;
    }, { once: true });
  }
  videoEl.style.visibility = 'visible';
}

function attachDrag(header: HTMLElement, container: HTMLElement): void {
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let isDragging = false;

  header.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.ge-edge-preview-close')) return;
    isDragging = true;
    const rect = container.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    header.setPointerCapture(e.pointerId);
  });

  header.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDragging) return;
    container.style.left = (e.clientX - dragOffsetX) + 'px';
    container.style.top = (e.clientY - dragOffsetY) + 'px';
    container.style.right = 'auto';
    container.style.transform = 'none';
  });

  header.addEventListener('pointerup', (e: PointerEvent) => {
    isDragging = false;
    header.releasePointerCapture(e.pointerId);
  });
}

function ensureWindow(): void {
  if (windowEl) return;

  const el = document.createElement('div');
  el.className = 'ge-edge-preview-window';
  el.id = 'geEdgePreviewWindow';
  el.style.display = 'none';
  el.innerHTML = `
    <div class="ge-edge-preview-window-header">
      <span class="ge-edge-preview-window-title">Edge Preview</span>
      <button class="ge-edge-preview-close" title="닫기">
        <span class="material-icons" style="font-size:16px">close</span>
      </button>
    </div>
    <div class="ge-edge-preview-window-body">
      <div class="ge-edge-preview-cell">
        <div class="ge-edge-preview-label">FWD</div>
        <video class="ge-edge-preview-video" preload="metadata" muted playsinline></video>
      </div>
      <div class="ge-edge-preview-cell">
        <div class="ge-edge-preview-label">REV</div>
        <video class="ge-edge-preview-video" preload="metadata" muted playsinline></video>
      </div>
    </div>
  `;

  document.body.appendChild(el);

  windowEl = el;
  const videos = el.querySelectorAll<HTMLVideoElement>('.ge-edge-preview-video');
  fwdVideo = videos[0];
  revVideo = videos[1];

  const header = el.querySelector<HTMLElement>('.ge-edge-preview-window-header')!;
  attachDrag(header, el);

  el.querySelector<HTMLButtonElement>('.ge-edge-preview-close')!
    .addEventListener('click', hideEdgePreview);
}

function isVerticalEdge(fromNode: NavNode, toNode: NavNode): boolean {
  return (fromNode.type === 'stairs' && toNode.type === 'stairs')
      || (fromNode.type === 'elevator' && toNode.type === 'elevator');
}

function applyEdge(edge: NavEdge, fromNode: NavNode, toNode: NavNode): void {
  if (!fwdVideo || !revVideo) return;
  if (isVerticalEdge(fromNode, toNode)) {
    setPreview(fwdVideo, undefined, 0);
    setPreview(revVideo, undefined, 0);
    return;
  }
  setPreview(fwdVideo, edge.videoFwd, edge.videoFwdStart ?? 0);
  setPreview(revVideo, edge.videoRev, edge.videoRevStart ?? 0);
}

export function refreshEdgePreview(edge: NavEdge, fromNode: NavNode, toNode: NavNode): void {
  if (!windowEl || windowEl.style.display === 'none') return;
  applyEdge(edge, fromNode, toNode);
}

export function showEdgePreview(edge: NavEdge, fromNode: NavNode, toNode: NavNode): void {
  ensureWindow();
  windowEl!.style.display = 'flex';
  applyEdge(edge, fromNode, toNode);
}

export function hideEdgePreview(): void {
  if (windowEl) windowEl.style.display = 'none';
}

export function toggleEdgePreview(edge: NavEdge, fromNode: NavNode, toNode: NavNode): void {
  if (windowEl && windowEl.style.display !== 'none') hideEdgePreview();
  else showEdgePreview(edge, fromNode, toNode);
}

export function isEdgePreviewVisible(): boolean {
  return !!windowEl && windowEl.style.display !== 'none';
}
