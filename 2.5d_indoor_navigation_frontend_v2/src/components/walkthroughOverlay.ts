// ===== Walkthrough Overlay — UI Orchestrator =====

import type { WalkthroughPlaylist } from './walkthroughTypes';
import { DEFAULT_WALKTHROUGH_CONFIG } from './walkthroughTypes';
import { createWalkthroughPlayer, type WalkthroughPlayerInstance } from './walkthroughPlayer';
import { getPositionAtTime, progressToGlobalTime } from '../services/walkthroughPlanner';
import * as RouteOverlay from './routeOverlay';
import * as GeoMap from './geoMap';
import { MapConfig } from '../config/mapConfig';

// ===== Typed overlay refs (instead of DOM expando) =====
interface OverlayRefs {
  progressFill: HTMLElement;
  progressThumb: HTMLElement;
  timeLabel: HTMLElement;
  playBtn: HTMLButtonElement;
  expandBtn: HTMLButtonElement;
  canvasContainer: HTMLElement;
}

let overlayEl: HTMLElement | null = null;
let overlayRefs: OverlayRefs | null = null;
let player: WalkthroughPlayerInstance | null = null;
let activePlaylist: WalkthroughPlaylist | null = null;
let isFullscreen = false;
let cameraFollow = DEFAULT_WALKTHROUGH_CONFIG.cameraFollow;

// Document-level listeners (stored for cleanup)
let docSeekMove: ((e: PointerEvent) => void) | null = null;
let docSeekUp: (() => void) | null = null;
let docResizeMove: ((e: PointerEvent) => void) | null = null;
let docResizeUp: (() => void) | null = null;
let docKeydown: ((e: KeyboardEvent) => void) | null = null;
let followCheckbox: HTMLInputElement | null = null;

// ===== Public API =====

export function showWalkthroughOverlay(playlist: WalkthroughPlaylist): void {
  hideWalkthroughOverlay();

  activePlaylist = playlist;
  isFullscreen = false;
  cameraFollow = DEFAULT_WALKTHROUGH_CONFIG.cameraFollow;


  buildDOM(playlist);
  setupMapInteractionListener();
}

export function hideWalkthroughOverlay(): void {
  if (player) {
    player.destroy();
    player = null;
  }
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  overlayRefs = null;
  activePlaylist = null;
  RouteOverlay.clearPositionIndicator();
  removeMapInteractionListener();
  removeDocumentListeners();

  // Restore map from minimap mode
  const mainContent = document.getElementById('mainContent');
  mainContent?.classList.remove('walkthrough-minimap-container');
  isFullscreen = false;
  // Let map resize back to full
  requestAnimationFrame(() => GeoMap.getMap()?.resize());
}

export function isWalkthroughActive(): boolean {
  return overlayEl !== null;
}

// ===== DOM Construction =====

function buildDOM(playlist: WalkthroughPlaylist): void {
  overlayEl = document.createElement('div');
  overlayEl.className = 'walkthrough-overlay';
  overlayEl.style.width = `${DEFAULT_WALKTHROUGH_CONFIG.overlayWidth}px`;
  overlayEl.style.height = `${DEFAULT_WALKTHROUGH_CONFIG.overlayHeight}px`;

  // Header
  const header = document.createElement('div');
  header.className = 'walkthrough-header';

  const title = document.createElement('span');
  title.className = 'walkthrough-title';
  title.textContent = 'Walkthrough';

  const headerBtns = document.createElement('div');
  headerBtns.className = 'walkthrough-header-btns';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'walkthrough-btn walkthrough-expand-btn';
  expandBtn.innerHTML = '<span class="material-icons">fullscreen</span>';
  expandBtn.title = 'Toggle fullscreen';
  expandBtn.addEventListener('click', toggleFullscreen);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'walkthrough-btn walkthrough-close-btn';
  closeBtn.innerHTML = '<span class="material-icons">close</span>';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', hideWalkthroughOverlay);

  headerBtns.append(expandBtn, closeBtn);
  header.append(title, headerBtns);

  // Canvas container (for Three.js)
  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'walkthrough-canvas';

  // Controls bar
  const controls = document.createElement('div');
  controls.className = 'walkthrough-controls';

  // Play/pause
  const playBtn = document.createElement('button');
  playBtn.className = 'walkthrough-btn walkthrough-play-btn';
  playBtn.innerHTML = '<span class="material-icons">play_arrow</span>';
  playBtn.addEventListener('click', () => {
    player?.togglePlayPause();
    const icon = playBtn.querySelector('.material-icons')!;
    icon.textContent = player?.isPlaying() ? 'pause' : 'play_arrow';
  });

  // Progress bar
  const progressContainer = document.createElement('div');
  progressContainer.className = 'walkthrough-progress';

  const progressTrack = document.createElement('div');
  progressTrack.className = 'walkthrough-progress-track';

  const progressFill = document.createElement('div');
  progressFill.className = 'walkthrough-progress-fill';

  const progressThumb = document.createElement('div');
  progressThumb.className = 'walkthrough-progress-thumb';

  // Clip boundary markers
  for (const boundary of playlist.segmentBoundaries) {
    const marker = document.createElement('div');
    marker.className = 'walkthrough-progress-marker';
    marker.style.left = `${boundary * 100}%`;
    progressTrack.appendChild(marker);
  }

  progressTrack.append(progressFill, progressThumb);
  progressContainer.appendChild(progressTrack);

  // Seek on click
  progressTrack.addEventListener('click', (e) => {
    const rect = progressTrack.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = progressToGlobalTime(playlist, pct);
    player?.seekToGlobalTime(t);
    updateProgressUI(t);
  });

  // Seek drag (document-level listeners stored for cleanup)
  let seekDragging = false;
  progressThumb.addEventListener('pointerdown', (e) => {
    seekDragging = true;
    progressThumb.setPointerCapture(e.pointerId);
  });

  docSeekMove = (e: PointerEvent) => {
    if (!seekDragging) return;
    const rect = progressTrack.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = progressToGlobalTime(playlist, pct);
    player?.seekToGlobalTime(t);
    updateProgressUI(t);
  };
  docSeekUp = () => { seekDragging = false; };
  document.addEventListener('pointermove', docSeekMove as EventListener);
  document.addEventListener('pointerup', docSeekUp);

  // Time label
  const timeLabel = document.createElement('span');
  timeLabel.className = 'walkthrough-time';
  timeLabel.textContent = `0:00 / ${fmtTime(playlist.totalDuration)}`;

  // Speed selector
  const speedSelect = document.createElement('select');
  speedSelect.className = 'walkthrough-speed-select';
  speedSelect.title = 'Playback speed';
  for (const rate of MapConfig.walkthrough.playbackRates) {
    const opt = document.createElement('option');
    opt.value = String(rate);
    opt.textContent = `${rate}x`;
    if (rate === 1) opt.selected = true;
    speedSelect.appendChild(opt);
  }
  speedSelect.addEventListener('change', () => {
    player?.setPlaybackRate(Number(speedSelect.value));
  });

  // Camera follow toggle
  const followLabel = document.createElement('label');
  followLabel.className = 'walkthrough-follow-label';
  followCheckbox = document.createElement('input');
  followCheckbox.type = 'checkbox';
  followCheckbox.checked = cameraFollow;
  followCheckbox.addEventListener('change', () => {
    cameraFollow = followCheckbox!.checked;
  });
  followLabel.append(followCheckbox, ' Follow');

  controls.append(playBtn, progressContainer, timeLabel, speedSelect, followLabel);

  // Spacebar play/pause
  docKeydown = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      player?.togglePlayPause();
      const icon = playBtn.querySelector('.material-icons')!;
      icon.textContent = player?.isPlaying() ? 'pause' : 'play_arrow';
    }
  };
  document.addEventListener('keydown', docKeydown);

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'walkthrough-resize-handle';
  setupResize(resizeHandle);

  overlayEl.append(header, canvasContainer, controls, resizeHandle);
  document.body.appendChild(overlayEl);

  // Setup drag (move overlay by title bar)
  setupDrag(header);

  // Store typed refs
  overlayRefs = { progressFill, progressThumb, timeLabel, playBtn, expandBtn, canvasContainer };

  // Create the Three.js player
  player = createWalkthroughPlayer(canvasContainer, playlist, {
    onProgress(globalTime) {
      updateProgressUI(globalTime);
      syncMapPosition(globalTime);
    },
    onClipChange(_clipIdx) {},
    onEnd() {
      const icon = playBtn.querySelector('.material-icons');
      if (icon) icon.textContent = 'play_arrow';
    },
  });
}

// ===== Progress UI =====

function updateProgressUI(globalTime: number): void {
  if (!overlayRefs || !activePlaylist) return;
  const pct = activePlaylist.totalDuration > 0
    ? (globalTime / activePlaylist.totalDuration) * 100
    : 0;

  overlayRefs.progressFill.style.width = `${pct}%`;
  overlayRefs.progressThumb.style.left = `${pct}%`;
  overlayRefs.timeLabel.textContent = `${fmtTime(globalTime)} / ${fmtTime(activePlaylist.totalDuration)}`;
}

// ===== Map Sync =====

function syncMapPosition(globalTime: number): void {
  if (!activePlaylist) return;

  const result = getPositionAtTime(activePlaylist, globalTime);
  if (!result) return;

  const is3D = !GeoMap.isFlatMode();
  RouteOverlay.showPositionIndicator(result.position, result.level, is3D);

  // Camera follow
  if (cameraFollow) {
    GeoMap.getMap()?.easeTo({
      center: result.position as [number, number],
      duration: 300,
    });

    // Auto-switch floor
    if (result.level !== GeoMap.getCurrentLevel()) {
      GeoMap.handleLevelChange(result.level);
      document.dispatchEvent(new CustomEvent('walkthroughLevelChange', { detail: { level: result.level } }));
    }
  }
}

// ===== Fullscreen Toggle =====

// Saved position before fullscreen (to restore on exit)
let savedOverlayStyle: { left: string; top: string; right: string; bottom: string; width: string; height: string } | null = null;

function toggleFullscreen(): void {
  if (!overlayEl || !overlayRefs) return;
  isFullscreen = !isFullscreen;

  if (isFullscreen) {
    // Save current inline position/size before clearing
    savedOverlayStyle = {
      left: overlayEl.style.left,
      top: overlayEl.style.top,
      right: overlayEl.style.right,
      bottom: overlayEl.style.bottom,
      width: overlayEl.style.width,
      height: overlayEl.style.height,
    };
    // Clear inline position so the CSS class can take effect
    overlayEl.style.left = '';
    overlayEl.style.top = '';
    overlayEl.style.right = '';
    overlayEl.style.bottom = '';
    overlayEl.style.width = '';
    overlayEl.style.height = '';
  } else if (savedOverlayStyle) {
    // Restore saved position
    overlayEl.style.left = savedOverlayStyle.left;
    overlayEl.style.top = savedOverlayStyle.top;
    overlayEl.style.right = savedOverlayStyle.right;
    overlayEl.style.bottom = savedOverlayStyle.bottom;
    overlayEl.style.width = savedOverlayStyle.width;
    overlayEl.style.height = savedOverlayStyle.height;
    savedOverlayStyle = null;
  }

  overlayEl.classList.toggle('walkthrough-overlay--fullscreen', isFullscreen);

  const icon = overlayRefs.expandBtn.querySelector('.material-icons');
  if (icon) icon.textContent = isFullscreen ? 'fullscreen_exit' : 'fullscreen';

  // Toggle minimap class on map container
  const mapEl = document.getElementById('map');
  mapEl?.classList.toggle('walkthrough-minimap', isFullscreen);
  const mainContent = document.getElementById('mainContent');
  mainContent?.classList.toggle('walkthrough-minimap-container', isFullscreen);

  // Resize Three.js renderer + map
  requestAnimationFrame(() => {
    if (!overlayRefs || !player) return;
    player.resize(overlayRefs.canvasContainer.clientWidth, overlayRefs.canvasContainer.clientHeight);
    // Tell MapLibre to resize into the new container dimensions
    GeoMap.getMap()?.resize();
  });
}

// ===== Drag (move overlay) =====

function setupDrag(header: HTMLElement): void {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  header.addEventListener('pointerdown', (e) => {
    if (isFullscreen) return;
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = overlayEl!.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    header.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  header.addEventListener('pointermove', (e) => {
    if (!dragging || !overlayEl) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    overlayEl.style.left = `${startLeft + dx}px`;
    overlayEl.style.top = `${startTop + dy}px`;
    overlayEl.style.right = 'auto';
    overlayEl.style.bottom = 'auto';
  });

  header.addEventListener('pointerup', () => { dragging = false; });
  header.addEventListener('pointercancel', () => { dragging = false; });
}

// ===== Resize (corner handle) =====

function setupResize(handle: HTMLElement): void {
  let resizing = false;
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;

  handle.addEventListener('pointerdown', (e) => {
    if (isFullscreen) return;
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = overlayEl!.clientWidth;
    startH = overlayEl!.clientHeight;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });

  docResizeMove = (e: PointerEvent) => {
    if (!resizing || !overlayEl || !overlayRefs) return;
    const w = Math.max(300, Math.min(window.innerWidth * 0.8, startW + (e.clientX - startX)));
    const h = Math.max(220, Math.min(window.innerHeight * 0.8, startH + (e.clientY - startY)));
    overlayEl.style.width = `${w}px`;
    overlayEl.style.height = `${h}px`;

    if (player) {
      player.resize(overlayRefs.canvasContainer.clientWidth, overlayRefs.canvasContainer.clientHeight);
    }
  };
  docResizeUp = () => { resizing = false; };
  document.addEventListener('pointermove', docResizeMove as EventListener);
  document.addEventListener('pointerup', docResizeUp);
}

// ===== Cleanup document listeners =====

function removeDocumentListeners(): void {
  if (docSeekMove) { document.removeEventListener('pointermove', docSeekMove as EventListener); docSeekMove = null; }
  if (docSeekUp) { document.removeEventListener('pointerup', docSeekUp); docSeekUp = null; }
  if (docResizeMove) { document.removeEventListener('pointermove', docResizeMove as EventListener); docResizeMove = null; }
  if (docResizeUp) { document.removeEventListener('pointerup', docResizeUp); docResizeUp = null; }
  if (docKeydown) { document.removeEventListener('keydown', docKeydown); docKeydown = null; }
}

// ===== Map interaction detection =====

let mapMoveHandler: ((e: any) => void) | null = null;

function setupMapInteractionListener(): void {
  const map = GeoMap.getMap();
  if (!map) return;

  // Only cancel follow on pan/rotate, not zoom
  mapMoveHandler = () => {
    if (cameraFollow) {
      cameraFollow = false;
      if (followCheckbox) followCheckbox.checked = false;
    }
  };
  map.on('dragstart', mapMoveHandler);
  map.on('rotatestart', mapMoveHandler);
}

function removeMapInteractionListener(): void {
  if (!mapMoveHandler) return;
  const map = GeoMap.getMap();
  map?.off('dragstart', mapMoveHandler);
  map?.off('rotatestart', mapMoveHandler);
  mapMoveHandler = null;
}

// ===== Helpers =====

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
