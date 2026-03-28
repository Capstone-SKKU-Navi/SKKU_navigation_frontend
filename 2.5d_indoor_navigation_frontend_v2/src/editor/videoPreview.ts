// ===== 360° Video Preview — Set viewing direction or time range =====

import * as THREE from 'three';

export interface VideoPreviewOptions {
  videoUrl: string;
  initialYaw?: number;
  mode?: 'yaw' | 'time-range' | 'split';
  // time-range mode
  initialStart?: number;
  initialEnd?: number;
  onConfirmTimeRange?: (start: number, end: number) => void;
  // split mode
  splitCount?: number;         // number of edges
  initialSplits?: number[];    // [start, split1, ..., end]
  onConfirmSplits?: (splits: number[]) => void;
  // common
  onConfirm: (yaw: number) => void;
  onCancel: () => void;
}

let activePreview: { cleanup: () => void } | null = null;

export function openVideoPreview(options: VideoPreviewOptions): void {
  if (activePreview) activePreview.cleanup();

  const {
    videoUrl, initialYaw = 0, mode = 'yaw',
    initialStart, initialEnd,
    splitCount = 2, initialSplits,
    onConfirm, onConfirmTimeRange, onConfirmSplits, onCancel,
  } = options;

  const isTimeRange = mode === 'time-range';
  const isSplitMode = mode === 'split';

  // ===== DOM Structure =====
  const backdrop = document.createElement('div');
  backdrop.className = 'ge-video-preview-backdrop';

  const overlay = document.createElement('div');
  overlay.className = 'ge-video-preview-overlay';

  const header = document.createElement('div');
  header.className = 'ge-video-preview-header';
  header.textContent = isSplitMode ? `Split Video (${splitCount} edges)` : isTimeRange ? 'Set Time Range' : '360° Direction Preview';

  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'ge-video-preview-canvas';

  const yawIndicator = document.createElement('div');
  yawIndicator.className = 'ge-yaw-indicator';
  yawIndicator.textContent = `${initialYaw.toFixed(1)}°`;
  if (isTimeRange || isSplitMode) yawIndicator.style.display = 'none';

  // ===== Seekbar =====
  const seekbar = document.createElement('div');
  seekbar.className = 'ge-seekbar';

  const seekTrack = document.createElement('div');
  seekTrack.className = 'ge-seekbar-track';
  const seekProgress = document.createElement('div');
  seekProgress.className = 'ge-seekbar-progress';
  const seekThumb = document.createElement('div');
  seekThumb.className = 'ge-seekbar-thumb';
  seekTrack.appendChild(seekProgress);
  seekTrack.appendChild(seekThumb);

  // Time-range markers
  let rangeEl: HTMLDivElement | null = null;
  let startMarker: HTMLDivElement | null = null;
  let endMarker: HTMLDivElement | null = null;
  let rangeStart = initialStart ?? 0;
  let rangeEnd = initialEnd ?? 0;

  // Split mode markers
  let splitMarkers: HTMLDivElement[] = [];
  let splitTimes: number[] = initialSplits ? [...initialSplits] : [];
  const neededSplits = splitCount - 1; // internal split points needed

  if (isTimeRange) {
    rangeEl = document.createElement('div');
    rangeEl.className = 'ge-seekbar-range';
    seekTrack.appendChild(rangeEl);

    startMarker = document.createElement('div');
    startMarker.className = 'ge-seekbar-marker ge-seekbar-marker-start';
    startMarker.title = 'Start';
    seekTrack.appendChild(startMarker);

    endMarker = document.createElement('div');
    endMarker.className = 'ge-seekbar-marker ge-seekbar-marker-end';
    endMarker.title = 'End';
    seekTrack.appendChild(endMarker);
  }

  if (isSplitMode) {
    rangeEl = document.createElement('div');
    rangeEl.className = 'ge-seekbar-range';
    seekTrack.appendChild(rangeEl);

    // Create markers for existing split times
    // splitTimes = [start, split1, split2, ..., end]
    for (let i = 0; i < splitTimes.length; i++) {
      const m = document.createElement('div');
      m.className = 'ge-seekbar-marker';
      if (i === 0) m.classList.add('ge-seekbar-marker-start');
      else if (i === splitTimes.length - 1) m.classList.add('ge-seekbar-marker-end');
      else m.classList.add('ge-seekbar-marker-split');
      seekTrack.appendChild(m);
      splitMarkers.push(m);
    }
  }

  const playBtn = document.createElement('button');
  playBtn.className = 'ge-play-btn';
  playBtn.innerHTML = '<span class="material-icons" style="font-size:18px">pause</span>';

  const timeLabel = document.createElement('span');
  timeLabel.className = 'ge-time-label';
  timeLabel.textContent = '0:00 / 0:00';

  seekbar.appendChild(playBtn);
  seekbar.appendChild(seekTrack);
  seekbar.appendChild(timeLabel);

  // ===== Time-range buttons =====
  let timeRangeBar: HTMLDivElement | null = null;
  let rangeLabel: HTMLSpanElement | null = null;

  if (isTimeRange) {
    timeRangeBar = document.createElement('div');
    timeRangeBar.className = 'ge-time-range-bar';

    const setStartBtn = document.createElement('button');
    setStartBtn.className = 'ge-preview-btn';
    setStartBtn.innerHTML = '<span class="material-icons" style="font-size:14px">first_page</span> Set Start';
    setStartBtn.addEventListener('click', () => {
      rangeStart = video.currentTime;
      if (rangeEnd < rangeStart) rangeEnd = rangeStart;
      updateRangeMarkers();
    });

    const setEndBtn = document.createElement('button');
    setEndBtn.className = 'ge-preview-btn';
    setEndBtn.innerHTML = '<span class="material-icons" style="font-size:14px">last_page</span> Set End';
    setEndBtn.addEventListener('click', () => {
      rangeEnd = video.currentTime;
      if (rangeStart > rangeEnd) rangeStart = rangeEnd;
      updateRangeMarkers();
    });

    rangeLabel = document.createElement('span');
    rangeLabel.className = 'ge-range-label';
    rangeLabel.textContent = formatRange(rangeStart, rangeEnd);

    timeRangeBar.appendChild(setStartBtn);
    timeRangeBar.appendChild(rangeLabel);
    timeRangeBar.appendChild(setEndBtn);
  }

  // Split mode controls
  let splitLabel: HTMLSpanElement | null = null;

  if (isSplitMode) {
    timeRangeBar = document.createElement('div');
    timeRangeBar.className = 'ge-time-range-bar';

    const addSplitBtn = document.createElement('button');
    addSplitBtn.className = 'ge-preview-btn';
    addSplitBtn.innerHTML = '<span class="material-icons" style="font-size:14px">content_cut</span> Add Split';
    addSplitBtn.addEventListener('click', () => {
      // Only allow adding internal splits (start/end are fixed)
      const internalCount = Math.max(0, splitTimes.length - 2);
      if (internalCount >= neededSplits) return;
      const t = video.currentTime;
      // Don't add duplicates near existing splits
      if (splitTimes.some(s => Math.abs(s - t) < 0.1)) return;
      splitTimes.push(t);
      splitTimes.sort((a, b) => a - b);
      rebuildSplitMarkers();
    });

    const clearSplitsBtn = document.createElement('button');
    clearSplitsBtn.className = 'ge-preview-btn';
    clearSplitsBtn.innerHTML = '<span class="material-icons" style="font-size:14px">clear_all</span> Clear';
    clearSplitsBtn.addEventListener('click', () => {
      // Keep start and end boundaries, only remove internal splits
      const start = splitTimes.length > 0 ? splitTimes[0] : 0;
      const end = splitTimes.length > 1 ? splitTimes[splitTimes.length - 1] : (video.duration || 0);
      splitTimes = [start, end];
      rebuildSplitMarkers();
    });

    splitLabel = document.createElement('span');
    splitLabel.className = 'ge-range-label';
    updateSplitLabel();

    timeRangeBar.appendChild(addSplitBtn);
    timeRangeBar.appendChild(splitLabel);
    timeRangeBar.appendChild(clearSplitsBtn);
  }

  // ===== Bottom bar =====
  const bar = document.createElement('div');
  bar.className = 'ge-video-preview-bar';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ge-preview-btn';
  cancelBtn.textContent = 'Cancel';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'ge-preview-btn ge-preview-confirm';
  confirmBtn.textContent = isSplitMode ? 'Confirm Splits' : isTimeRange ? 'Confirm Time' : 'Confirm Direction';

  bar.appendChild(cancelBtn);
  bar.appendChild(confirmBtn);

  canvasContainer.appendChild(yawIndicator);
  overlay.appendChild(header);
  overlay.appendChild(canvasContainer);
  overlay.appendChild(seekbar);
  if (timeRangeBar) overlay.appendChild(timeRangeBar);
  overlay.appendChild(bar);

  document.body.appendChild(backdrop);
  document.body.appendChild(overlay);

  // ===== Video Element =====
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.src = videoUrl;
  video.play().catch(() => {});

  // ===== Three.js Scene =====
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 640 / 364, 1, 1100);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(640, 364);
  canvasContainer.appendChild(renderer.domElement);

  const geometry = new THREE.SphereGeometry(500, 60, 40);
  geometry.scale(-1, 1, 1);

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshBasicMaterial({ map: texture });
  const sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);

  // ===== Camera Control =====
  let lon = initialYaw;
  let lat = 0;
  let isDown = false;
  let prevX = 0;
  let prevY = 0;

  function onPointerDown(e: PointerEvent): void {
    isDown = true;
    prevX = e.clientX;
    prevY = e.clientY;
    canvasContainer.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!isDown) return;
    lon += (prevX - e.clientX) * 0.2;
    lat += (e.clientY - prevY) * 0.2;
    lat = Math.max(-85, Math.min(85, lat));
    prevX = e.clientX;
    prevY = e.clientY;
  }

  function onPointerUp(e: PointerEvent): void {
    isDown = false;
    canvasContainer.releasePointerCapture(e.pointerId);
  }

  function onPointerCancel(e: PointerEvent): void {
    isDown = false;
    canvasContainer.releasePointerCapture(e.pointerId);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    camera.fov = Math.max(30, Math.min(100, camera.fov + e.deltaY * 0.05));
    camera.updateProjectionMatrix();
  }

  canvasContainer.addEventListener('pointerdown', onPointerDown);
  canvasContainer.addEventListener('pointermove', onPointerMove);
  canvasContainer.addEventListener('pointerup', onPointerUp);
  canvasContainer.addEventListener('pointercancel', onPointerCancel);
  canvasContainer.addEventListener('wheel', onWheel, { passive: false });

  // ===== Render Loop =====
  let animId = 0;
  let destroyed = false;

  function animate(): void {
    if (destroyed) return;
    animId = requestAnimationFrame(animate);

    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);
    camera.lookAt(
      500 * Math.sin(phi) * Math.cos(theta),
      500 * Math.cos(phi),
      500 * Math.sin(phi) * Math.sin(theta),
    );

    if (!isTimeRange && !isSplitMode) {
      const displayYaw = ((lon % 360) + 360) % 360;
      yawIndicator.textContent = `${displayYaw.toFixed(1)}°`;
    }

    renderer.render(scene, camera);
  }
  animate();

  // ===== Seekbar logic =====
  let isPlaying = true;

  function fmtTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function updateSeekbar(): void {
    if (!video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    seekProgress.style.width = `${pct}%`;
    seekThumb.style.left = `${pct}%`;
    timeLabel.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
  }

  // ===== Draggable markers helper =====
  function makeMarkerDraggable(marker: HTMLDivElement, onDrag: (pct: number) => void): void {
    let dragging = false;

    marker.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); // prevent seekbar from seeking
      dragging = true;
      marker.setPointerCapture(e.pointerId);
    });

    marker.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = seekTrack.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onDrag(pct);
    });

    marker.addEventListener('pointerup', (e) => {
      dragging = false;
      marker.releasePointerCapture(e.pointerId);
    });
  }

  function updateRangeMarkers(): void {
    if (!video.duration || !startMarker || !endMarker || !rangeEl || !rangeLabel) return;
    const sPct = (rangeStart / video.duration) * 100;
    const ePct = (rangeEnd / video.duration) * 100;
    startMarker.style.left = `${sPct}%`;
    endMarker.style.left = `${ePct}%`;
    rangeEl.style.left = `${sPct}%`;
    rangeEl.style.width = `${ePct - sPct}%`;
    rangeLabel.textContent = formatRange(rangeStart, rangeEnd);
  }

  function rebuildSplitMarkers(): void {
    // Remove old markers
    for (const m of splitMarkers) m.remove();
    splitMarkers = [];

    if (!video.duration) return;

    for (let i = 0; i < splitTimes.length; i++) {
      const m = document.createElement('div');
      m.className = 'ge-seekbar-marker';
      if (i === 0) m.classList.add('ge-seekbar-marker-start');
      else if (i === splitTimes.length - 1) m.classList.add('ge-seekbar-marker-end');
      else m.classList.add('ge-seekbar-marker-split');
      const pct = (splitTimes[i] / video.duration) * 100;
      m.style.left = `${pct}%`;
      seekTrack.appendChild(m);
      splitMarkers.push(m);

      // Make each marker draggable
      const idx = i;
      makeMarkerDraggable(m, (pct2) => {
        const t = pct2 * video.duration;
        // Clamp between neighbors
        const minT = idx > 0 ? splitTimes[idx - 1] + 0.1 : 0;
        const maxT = idx < splitTimes.length - 1 ? splitTimes[idx + 1] - 0.1 : video.duration;
        splitTimes[idx] = Math.max(minT, Math.min(maxT, t));
        // Update visual
        m.style.left = `${(splitTimes[idx] / video.duration) * 100}%`;
        if (rangeEl && splitTimes.length >= 2) {
          const sPct = (splitTimes[0] / video.duration) * 100;
          const ePct = (splitTimes[splitTimes.length - 1] / video.duration) * 100;
          rangeEl.style.left = `${sPct}%`;
          rangeEl.style.width = `${ePct - sPct}%`;
        }
        updateSplitLabel();
      });
    }

    // Update range highlight
    if (rangeEl && splitTimes.length >= 2) {
      const sPct = (splitTimes[0] / video.duration) * 100;
      const ePct = (splitTimes[splitTimes.length - 1] / video.duration) * 100;
      rangeEl.style.left = `${sPct}%`;
      rangeEl.style.width = `${ePct - sPct}%`;
    }

    updateSplitLabel();

    // Enable/disable confirm button
    const internalSplits = splitTimes.length - 2; // minus start and end
    confirmBtn.disabled = splitTimes.length < 2 || internalSplits !== neededSplits;
  }

  function updateSplitLabel(): void {
    if (!splitLabel) return;
    const internalSplits = Math.max(0, splitTimes.length - 2);
    splitLabel.textContent = `${internalSplits} / ${neededSplits} splits`;
  }

  video.addEventListener('timeupdate', updateSeekbar);
  // Set initial marker positions once duration is known
  if (isTimeRange) {
    video.addEventListener('loadedmetadata', () => {
      if (rangeEnd === 0 && initialEnd === undefined) rangeEnd = video.duration;
      updateRangeMarkers();
    });

    // Make start/end markers draggable
    if (startMarker) {
      makeMarkerDraggable(startMarker, (pct) => {
        rangeStart = pct * video.duration;
        if (rangeStart > rangeEnd) rangeStart = rangeEnd;
        updateRangeMarkers();
      });
    }
    if (endMarker) {
      makeMarkerDraggable(endMarker, (pct) => {
        rangeEnd = pct * video.duration;
        if (rangeEnd < rangeStart) rangeEnd = rangeStart;
        updateRangeMarkers();
      });
    }
  }
  if (isSplitMode) {
    video.addEventListener('loadedmetadata', () => {
      if (splitTimes.length === 0) {
        // Default: start at 0, end at duration, no internal splits
        splitTimes = [0, video.duration];
      }
      rebuildSplitMarkers();
    });
    // Disable confirm until splits are correct
    confirmBtn.disabled = true;
  }

  playBtn.addEventListener('click', togglePlay);

  // Click/drag on seek track
  let isSeeking = false;

  function seekTo(e: PointerEvent): void {
    const rect = seekTrack.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (video.duration) video.currentTime = pct * video.duration;
    updateSeekbar();
  }

  seekTrack.addEventListener('pointerdown', (e) => {
    isSeeking = true;
    seekTrack.setPointerCapture(e.pointerId);
    seekTo(e);
  });
  seekTrack.addEventListener('pointermove', (e) => {
    if (isSeeking) seekTo(e);
  });
  seekTrack.addEventListener('pointerup', (e) => {
    isSeeking = false;
    seekTrack.releasePointerCapture(e.pointerId);
  });

  // ===== Resize canvas to fit container =====
  function resizeCanvas(): void {
    const w = canvasContainer.clientWidth;
    const h = canvasContainer.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  }

  const ro = new ResizeObserver(resizeCanvas);
  ro.observe(canvasContainer);
  requestAnimationFrame(resizeCanvas);

  // ===== Draggable header =====
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let isDragging = false;

  function onHeaderDown(e: PointerEvent): void {
    isDragging = true;
    const rect = overlay.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    header.setPointerCapture(e.pointerId);
  }

  function onHeaderMove(e: PointerEvent): void {
    if (!isDragging) return;
    overlay.style.left = (e.clientX - dragOffsetX) + 'px';
    overlay.style.top = (e.clientY - dragOffsetY) + 'px';
    overlay.style.transform = 'none';
  }

  function onHeaderUp(e: PointerEvent): void {
    isDragging = false;
    header.releasePointerCapture(e.pointerId);
  }

  header.addEventListener('pointerdown', onHeaderDown);
  header.addEventListener('pointermove', onHeaderMove);
  header.addEventListener('pointerup', onHeaderUp);

  // ===== Cleanup =====
  function cleanup(): void {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(animId);
    ro.disconnect();
    document.removeEventListener('keydown', onKeyDown);

    canvasContainer.removeEventListener('pointerdown', onPointerDown);
    canvasContainer.removeEventListener('pointermove', onPointerMove);
    canvasContainer.removeEventListener('pointerup', onPointerUp);
    canvasContainer.removeEventListener('pointercancel', onPointerCancel);
    canvasContainer.removeEventListener('wheel', onWheel);

    header.removeEventListener('pointerdown', onHeaderDown);
    header.removeEventListener('pointermove', onHeaderMove);
    header.removeEventListener('pointerup', onHeaderUp);

    video.pause();
    video.src = '';
    video.load();

    texture.dispose();
    geometry.dispose();
    material.dispose();
    renderer.dispose();

    backdrop.remove();
    overlay.remove();
    activePreview = null;
  }

  // ===== Button handlers =====
  cancelBtn.addEventListener('click', () => { cleanup(); onCancel(); });

  confirmBtn.addEventListener('click', () => {
    if (isSplitMode && onConfirmSplits) {
      cleanup();
      onConfirmSplits(splitTimes);
    } else if (isTimeRange && onConfirmTimeRange) {
      cleanup();
      onConfirmTimeRange(rangeStart, rangeEnd);
    } else {
      const finalYaw = ((lon % 360) + 360) % 360;
      cleanup();
      onConfirm(finalYaw);
    }
  });

  backdrop.addEventListener('click', () => { cleanup(); onCancel(); });

  function togglePlay(): void {
    if (isPlaying) {
      video.pause();
      playBtn.innerHTML = '<span class="material-icons" style="font-size:18px">play_arrow</span>';
    } else {
      video.play().catch(() => {});
      playBtn.innerHTML = '<span class="material-icons" style="font-size:18px">pause</span>';
    }
    isPlaying = !isPlaying;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') { cleanup(); onCancel(); }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  }
  document.addEventListener('keydown', onKeyDown);

  activePreview = { cleanup };
}

function formatRange(start: number, end: number): string {
  return `${fmtSec(start)} ~ ${fmtSec(end)}`;
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`;
}
