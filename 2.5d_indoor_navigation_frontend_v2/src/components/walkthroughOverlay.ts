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
let canvasResizeObserver: ResizeObserver | null = null;

// ===== Public API =====

export function showWalkthroughOverlay(playlist: WalkthroughPlaylist): void {
  hideWalkthroughOverlay();

  activePlaylist = playlist;
  isFullscreen = false;
  cameraFollow = DEFAULT_WALKTHROUGH_CONFIG.cameraFollow;


  buildDOM(playlist);
  setupMapInteractionListener();

  // Notify chrome (e.g. mobile sheet) that the overlay is mounted.
  // `overlayEl` is guaranteed set here by buildDOM.
  document.dispatchEvent(new CustomEvent('walkthroughShown', {
    detail: { overlayEl, playlist },
  }));
}

export function hideWalkthroughOverlay(): void {
  const wasActive = overlayEl !== null;
  if (canvasResizeObserver) {
    canvasResizeObserver.disconnect();
    canvasResizeObserver = null;
  }
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
  GeoMap.clearWalkthroughCursor();
  removeMapInteractionListener();
  removeDocumentListeners();

  // Restore map from minimap mode
  const mainContent = document.getElementById('mainContent');
  mainContent?.classList.remove('walkthrough-minimap-container');
  isFullscreen = false;

  if (wasActive) {
    // Only when we actually tore down an overlay — guards against the
    // re-entrant call that arrives via the walkthroughHidden → sheet
    // setState('hidden') → onStateChange path queueing a spurious resize.
    requestAnimationFrame(() => GeoMap.getMap()?.resize());
    document.dispatchEvent(new Event('walkthroughHidden'));
  }
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

  const helpBtn = document.createElement('button');
  helpBtn.className = 'walkthrough-btn walkthrough-help-btn';
  helpBtn.innerHTML = '<span class="material-icons">keyboard</span>';
  helpBtn.title = '단축키 (Shift+?)';
  helpBtn.addEventListener('click', () => cheatSheet.classList.toggle('walkthrough-cheatsheet--show'));

  const closeBtn = document.createElement('button');
  closeBtn.className = 'walkthrough-btn walkthrough-close-btn';
  closeBtn.innerHTML = '<span class="material-icons">close</span>';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', hideWalkthroughOverlay);

  headerBtns.append(helpBtn, expandBtn, closeBtn);
  header.append(title, headerBtns);

  // Canvas container (for Three.js)
  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'walkthrough-canvas';

  // Tap-feedback indicator: a circular icon that briefly pops up in the
  // center of the canvas whenever the user toggles play/pause via tap.
  const tapIndicator = document.createElement('div');
  tapIndicator.className = 'walkthrough-tap-indicator';
  tapIndicator.innerHTML = '<span class="material-icons"></span>';
  canvasContainer.appendChild(tapIndicator);

  // Buffering spinner — shown during cold 360° segment loads so a load is
  // never mistaken for a frozen/paused player.
  const spinner = document.createElement('div');
  spinner.className = 'walkthrough-spinner';
  spinner.innerHTML = '<div class="walkthrough-spinner-ring"></div>';
  canvasContainer.appendChild(spinner);

  // Directional seek OSD (double-tap ±10s feedback).
  const seekOsd = document.createElement('div');
  seekOsd.className = 'walkthrough-seek-osd';
  seekOsd.innerHTML = '<span class="material-icons"></span><span class="walkthrough-seek-osd-text"></span>';
  canvasContainer.appendChild(seekOsd);

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

  // Missing-video segments: gray blocks so the user sees there is no footage
  // for those stretches (the player skips them during playback).
  for (const seg of playlist.segments) {
    if (seg.hasVideo) continue;
    const gap = document.createElement('div');
    gap.className = 'walkthrough-progress-gap';
    gap.style.left = `${(seg.globalStart / playlist.totalDuration) * 100}%`;
    gap.style.width = `${((seg.globalEnd - seg.globalStart) / playlist.totalDuration) * 100}%`;
    gap.title = '이 구간은 360° 영상이 없습니다';
    progressTrack.appendChild(gap);
  }

  // Clip boundary markers
  for (const boundary of playlist.segmentBoundaries) {
    const marker = document.createElement('div');
    marker.className = 'walkthrough-progress-marker';
    marker.style.left = `${boundary * 100}%`;
    progressTrack.appendChild(marker);
  }

  progressTrack.append(progressFill, progressThumb);
  progressContainer.appendChild(progressTrack);

  // Seek: pointerdown anywhere on the track seeks immediately and starts a
  // drag-to-scrub gesture. Using the whole track (not just the 12px thumb)
  // gives finger-sized hit area on mobile.
  let seekDragging = false;
  // Predictive preload: if the cursor lingers over a segment during a drag,
  // ask the player to warm that segment's pool slot. By the time the user
  // releases there, the swap is instant.
  let scrubHoverSeg = -1;
  let scrubHoverTimer = 0;

  const seekToClientX = (clientX: number) => {
    const rect = progressTrack.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = progressToGlobalTime(playlist, pct);
    player?.seekToGlobalTime(t);
    updateProgressUI(t);

    if (seekDragging) {
      const hoveredSeg = playlist.segments.findIndex(
        (s) => t >= s.globalStart && t < s.globalEnd,
      );
      if (hoveredSeg !== scrubHoverSeg) {
        scrubHoverSeg = hoveredSeg;
        if (scrubHoverTimer) { clearTimeout(scrubHoverTimer); scrubHoverTimer = 0; }
        if (hoveredSeg >= 0) {
          scrubHoverTimer = window.setTimeout(() => {
            player?.preloadSegment(hoveredSeg);
            scrubHoverTimer = 0;
          }, 100);
        }
      }
    }
  };

  progressTrack.addEventListener('pointerdown', (e) => {
    seekDragging = true;
    try { progressTrack.setPointerCapture(e.pointerId); } catch { /* noop */ }
    seekToClientX(e.clientX);
    e.preventDefault();
  });

  docSeekMove = (e: PointerEvent) => {
    if (!seekDragging) return;
    seekToClientX(e.clientX);
  };
  docSeekUp = () => {
    seekDragging = false;
    scrubHoverSeg = -1;
    if (scrubHoverTimer) { clearTimeout(scrubHoverTimer); scrubHoverTimer = 0; }
  };
  document.addEventListener('pointermove', docSeekMove as EventListener);
  document.addEventListener('pointerup', docSeekUp);
  document.addEventListener('pointercancel', docSeekUp);

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

  // Re-face-forward button: snap the look direction back down the corridor.
  const recenterBtn = document.createElement('button');
  recenterBtn.className = 'walkthrough-btn walkthrough-recenter-btn';
  recenterBtn.innerHTML = '<span class="material-icons">explore</span>';
  recenterBtn.title = '정면 보기 (C)';
  recenterBtn.addEventListener('click', () => player?.recenterView());

  controls.append(playBtn, progressContainer, timeLabel, speedSelect, recenterBtn, followLabel);

  // Keep the play/pause glyph in sync with the engine state.
  const syncPlayIcon = (): void => {
    const icon = playBtn.querySelector('.material-icons');
    if (icon) icon.textContent = player?.isPlaying() ? 'pause' : 'play_arrow';
  };

  // Step through the discrete speed presets (keyboard < > / + -).
  const rates = MapConfig.walkthrough.playbackRates;
  const stepSpeed = (dir: 1 | -1): void => {
    const cur = player?.getPlaybackRate() ?? 1;
    let idx = rates.indexOf(cur);
    if (idx === -1) idx = rates.indexOf(1);
    const next = Math.max(0, Math.min(rates.length - 1, idx + dir));
    const rate = rates[next];
    player?.setPlaybackRate(rate);
    speedSelect.value = String(rate);
  };

  // Keyboard shortcuts (YouTube / Street View familiar map). Skipped while a
  // text input is focused. Shift+? toggles the cheat-sheet.
  docKeydown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        e.preventDefault();
        player?.togglePlayPause();
        syncPlayIcon();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        player?.seekBy(-5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        player?.seekBy(5);
        break;
      case 'j':
      case 'J':
        e.preventDefault();
        player?.seekBy(-10);
        break;
      case 'l':
      case 'L':
        e.preventDefault();
        player?.seekBy(10);
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        player?.recenterView();
        break;
      case '>':
      case '.':
        e.preventDefault();
        stepSpeed(1);
        break;
      case '<':
      case ',':
        e.preventDefault();
        stepSpeed(-1);
        break;
      case '?':
        e.preventDefault();
        cheatSheet.classList.toggle('walkthrough-cheatsheet--show');
        break;
      case 'Escape':
        if (cheatSheet.classList.contains('walkthrough-cheatsheet--show')) {
          cheatSheet.classList.remove('walkthrough-cheatsheet--show');
        }
        break;
    }
  };
  document.addEventListener('keydown', docKeydown);

  // Keyboard cheat-sheet (Shift+? to toggle).
  const cheatSheet = document.createElement('div');
  cheatSheet.className = 'walkthrough-cheatsheet';
  cheatSheet.innerHTML = `
    <div class="walkthrough-cheatsheet-card">
      <div class="walkthrough-cheatsheet-title">단축키</div>
      <ul>
        <li><kbd>Space</kbd> / <kbd>K</kbd> 재생·일시정지</li>
        <li><kbd>←</kbd> <kbd>→</kbd> 5초 이동</li>
        <li><kbd>J</kbd> <kbd>L</kbd> 10초 이동</li>
        <li><kbd>&lt;</kbd> <kbd>&gt;</kbd> 배속 단계 조절</li>
        <li><kbd>C</kbd> 정면 보기</li>
        <li><kbd>Shift</kbd>+<kbd>?</kbd> 단축키 보기</li>
      </ul>
      <div class="walkthrough-cheatsheet-hint">아무 키나 누르면 닫힙니다 · 모바일은 좌/우 더블탭으로 10초 이동</div>
    </div>`;
  cheatSheet.addEventListener('click', () => cheatSheet.classList.remove('walkthrough-cheatsheet--show'));

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'walkthrough-resize-handle';
  setupResize(resizeHandle);

  overlayEl.append(header, canvasContainer, controls, resizeHandle, cheatSheet);
  document.body.appendChild(overlayEl);

  // Setup drag (move overlay by title bar)
  setupDrag(header);

  // Tap zones on the video canvas:
  //   center single-tap → play/pause
  //   left/right double-tap → seek ∓10s (directional OSD)
  // Coexists with pan-to-look (>8px = drag) and pinch (2+ pointers = ignore).
  let tapStartX = 0, tapStartY = 0, tapStartT = 0, tapTracking = false;
  let activeCanvasPointers = 0;
  let lastTapT = 0;
  let lastTapZone: 'left' | 'center' | 'right' | '' = '';
  const DOUBLE_TAP_MS = 300;

  const zoneFor = (clientX: number): 'left' | 'center' | 'right' => {
    const rect = canvasContainer.getBoundingClientRect();
    const rel = (clientX - rect.left) / Math.max(1, rect.width);
    if (rel < 0.33) return 'left';
    if (rel > 0.67) return 'right';
    return 'center';
  };
  const endCanvasPointer = (): void => {
    activeCanvasPointers = Math.max(0, activeCanvasPointers - 1);
  };

  canvasContainer.addEventListener('pointerdown', (e) => {
    activeCanvasPointers++;
    if (activeCanvasPointers > 1) { tapTracking = false; return; } // pinch — not a tap
    tapStartX = e.clientX;
    tapStartY = e.clientY;
    tapStartT = performance.now();
    tapTracking = true;
  });
  canvasContainer.addEventListener('pointermove', (e) => {
    if (!tapTracking) return;
    if (Math.hypot(e.clientX - tapStartX, e.clientY - tapStartY) > 8) {
      tapTracking = false;
    }
  });
  canvasContainer.addEventListener('pointerup', (e) => {
    const wasTap = tapTracking;
    endCanvasPointer();
    if (!wasTap) return;
    tapTracking = false;
    if (performance.now() - tapStartT > 300) return;

    const zone = zoneFor(e.clientX);
    const now = performance.now();
    const isDouble = (now - lastTapT < DOUBLE_TAP_MS) && zone === lastTapZone && zone !== 'center';
    const icon = playBtn.querySelector('.material-icons');

    if (isDouble) {
      // Revert the play/pause toggle the first tap triggered, then seek — a
      // double-tap seeks without changing play state (YouTube convention).
      player?.togglePlayPause();
      const delta = zone === 'left' ? -10 : 10;
      player?.seekBy(delta);
      flashSeekOsd(seekOsd, zone, delta);
      if (icon) icon.textContent = player?.isPlaying() ? 'pause' : 'play_arrow';
      lastTapT = 0;
      lastTapZone = '';
      return;
    }

    player?.togglePlayPause();
    const isNowPlaying = !!player?.isPlaying();
    if (icon) icon.textContent = isNowPlaying ? 'pause' : 'play_arrow';
    // Show what just happened: play_arrow if playback started, pause if it
    // stopped — matches the YouTube/Apple convention.
    flashTapIndicator(tapIndicator, isNowPlaying ? 'play_arrow' : 'pause');
    lastTapT = now;
    lastTapZone = zone;
  });
  canvasContainer.addEventListener('pointercancel', () => { tapTracking = false; endCanvasPointer(); });

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
    onLoadingChange(isLoading) {
      spinner.classList.toggle('walkthrough-spinner--show', isLoading);
    },
    onHeadingChange() {
      // User panned the 360° view — re-point the marker to route + look offset.
      refreshMarkerFacing();
    },
  });

  // Keep the Three.js renderer in sync with the canvas container size.
  // Needed when the overlay is reparented into a different DOM slot
  // (e.g. the mobile bottom sheet) or when the sheet state changes.
  if (typeof ResizeObserver !== 'undefined') {
    canvasResizeObserver = new ResizeObserver(() => {
      if (!player) return;
      const w = canvasContainer.clientWidth;
      const h = canvasContainer.clientHeight;
      if (w > 0 && h > 0) player.resize(w, h);
    });
    canvasResizeObserver.observe(canvasContainer);
  }
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

let lastSyncTs = 0;
let lastSyncPos: GeoJSON.Position | null = null;

/**
 * Compass facing for the map marker: the route's forward travel bearing at the
 * current spot, plus however far the user has panned the 360° view away from
 * "straight ahead". So it starts pointing along the route and then tracks the
 * camera as the user looks around.
 */
function markerFacing(): number {
  if (!lastSyncPos) return 0;
  const routeBearing = RouteOverlay.getRouteBearingAt(lastSyncPos);
  const offset = player?.getLookOffset() ?? 0;
  return ((routeBearing + offset) % 360 + 360) % 360;
}

/** Re-point the marker only (look-around pan) without moving it. */
function refreshMarkerFacing(): void {
  if (!lastSyncPos) return;
  const heading = markerFacing();
  GeoMap.setWalkthroughHeading(heading);     // 2D DOM wedge (cheap)
  RouteOverlay.setIndicatorHeading(heading); // 3D deck.gl fan (rebuilds only in 3D)
}

function syncMapPosition(globalTime: number): void {
  if (!activePlaylist) return;

  const now = performance.now();
  if (now - lastSyncTs < 33) return; // 30fps — visually identical for a map dot
  lastSyncTs = now;

  const result = getPositionAtTime(activePlaylist, globalTime);
  if (!result) return;

  lastSyncPos = result.position;

  const heading = markerFacing();
  RouteOverlay.showPositionIndicator(result.position, result.level, heading);
  // Facing fan: anchor at the marker, point along route + look offset.
  // (DOM wedge in 2D; the deck.gl fan in 3D is drawn by showPositionIndicator.)
  GeoMap.setWalkthroughCursor(result.position as [number, number], heading);

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
  if (docSeekUp) {
    document.removeEventListener('pointerup', docSeekUp);
    document.removeEventListener('pointercancel', docSeekUp);
    docSeekUp = null;
  }
  if (docResizeMove) { document.removeEventListener('pointermove', docResizeMove as EventListener); docResizeMove = null; }
  if (docResizeUp) { document.removeEventListener('pointerup', docResizeUp); docResizeUp = null; }
  if (docKeydown) { document.removeEventListener('keydown', docKeydown); docKeydown = null; }
}

// ===== Map interaction detection =====

let mapMoveHandler: ((e: any) => void) | null = null;
let canvasPointerDown: ((e: PointerEvent) => void) | null = null;
let canvasPointerMove: ((e: PointerEvent) => void) | null = null;
let canvasPointerUp: ((e: PointerEvent) => void) | null = null;

function disableFollow(): void {
  if (cameraFollow) {
    cameraFollow = false;
    if (followCheckbox) followCheckbox.checked = false;
  }
}

function setupMapInteractionListener(): void {
  const map = GeoMap.getMap();
  if (!map) return;

  // MapLibre's dragstart/rotatestart are the happy path.
  mapMoveHandler = () => disableFollow();
  map.on('dragstart', mapMoveHandler);
  map.on('rotatestart', mapMoveHandler);

  // Backup: watch the canvas directly for any real pointer drag past a
  // small threshold. This catches edge cases where MapLibre's internal
  // drag detection is busy handling a programmatic `easeTo` (which fires
  // continuously during camera-follow) and user intent gets swallowed.
  const canvas = map.getCanvas();
  let startX = 0, startY = 0, tracking = false;
  canvasPointerDown = (e: PointerEvent) => {
    tracking = true;
    startX = e.clientX;
    startY = e.clientY;
  };
  canvasPointerMove = (e: PointerEvent) => {
    if (!tracking) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) {
      disableFollow();
      tracking = false;
    }
  };
  canvasPointerUp = () => { tracking = false; };
  canvas.addEventListener('pointerdown', canvasPointerDown);
  canvas.addEventListener('pointermove', canvasPointerMove);
  canvas.addEventListener('pointerup', canvasPointerUp);
  canvas.addEventListener('pointercancel', canvasPointerUp);
}

function removeMapInteractionListener(): void {
  const map = GeoMap.getMap();
  if (mapMoveHandler) {
    map?.off('dragstart', mapMoveHandler);
    map?.off('rotatestart', mapMoveHandler);
    mapMoveHandler = null;
  }
  const canvas = map?.getCanvas();
  if (canvas && canvasPointerDown) {
    canvas.removeEventListener('pointerdown', canvasPointerDown);
    if (canvasPointerMove) canvas.removeEventListener('pointermove', canvasPointerMove);
    if (canvasPointerUp) {
      canvas.removeEventListener('pointerup', canvasPointerUp);
      canvas.removeEventListener('pointercancel', canvasPointerUp);
    }
  }
  canvasPointerDown = null;
  canvasPointerMove = null;
  canvasPointerUp = null;
}

// ===== Helpers =====

function flashTapIndicator(el: HTMLElement, iconName: string): void {
  const span = el.querySelector('.material-icons');
  if (!span) return;
  span.textContent = iconName;
  el.classList.remove('walkthrough-tap-indicator--show');
  // Force reflow so the animation restarts on rapid repeat taps.
  void el.offsetWidth;
  el.classList.add('walkthrough-tap-indicator--show');
}

function flashSeekOsd(el: HTMLElement, zone: 'left' | 'right', delta: number): void {
  const icon = el.querySelector('.material-icons');
  const text = el.querySelector('.walkthrough-seek-osd-text');
  if (icon) icon.textContent = zone === 'left' ? 'fast_rewind' : 'fast_forward';
  if (text) text.textContent = `${Math.abs(delta)}초`;
  el.classList.remove('walkthrough-seek-osd--left', 'walkthrough-seek-osd--right', 'walkthrough-seek-osd--show');
  el.classList.add(zone === 'left' ? 'walkthrough-seek-osd--left' : 'walkthrough-seek-osd--right');
  void el.offsetWidth; // restart animation
  el.classList.add('walkthrough-seek-osd--show');
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
