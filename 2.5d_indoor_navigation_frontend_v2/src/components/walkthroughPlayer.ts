// ===== Walkthrough Player — Three.js 360° Segment-Based Playback Engine =====
// LRU pool (N=4 desktop / N=2 mobile): persistent VideoTexture per slot.
// Cross-segment swap = material.map reassignment (no dispose/recreate → no flicker).
// Cold loads go onto a standby slot first, then swap when ready (active keeps last frame).

import * as THREE from 'three';
import type { WalkthroughPlaylist } from './walkthroughTypes';
import { getVideoUrl } from '../services/backendService';
import { MapConfig } from '../config/mapConfig';

export interface WalkthroughPlayerCallbacks {
  onProgress(globalTime: number): void;
  onClipChange(clipIndex: number): void;
  onEnd(): void;
  /** Fired when a cold segment load starts/finishes, so the UI can show a spinner. */
  onLoadingChange?(isLoading: boolean): void;
  /** Fired when the look direction (yaw, degrees) changes, for a map facing wedge. */
  onHeadingChange?(headingDeg: number): void;
}

export interface WalkthroughPlayerInstance {
  play(): void;
  pause(): void;
  togglePlayPause(): void;
  isPlaying(): boolean;
  seekToGlobalTime(time: number): void;
  /** Seek relative to the current position by `deltaSeconds` (clamped). */
  seekBy(deltaSeconds: number): void;
  getCurrentGlobalTime(): number;
  /** Current look direction (yaw) in degrees, normalized to [0, 360). */
  getHeading(): number;
  /**
   * How far the user has panned away from the clip's forward (= travel)
   * direction, in degrees, normalized to (-180, 180]. 0 = looking straight
   * ahead. The map marker faces routeBearing + this offset.
   */
  getLookOffset(): number;
  /** Snap the look direction back to the current clip's forward yaw. */
  recenterView(): void;
  getCurrentClipIndex(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  resize(width: number, height: number): void;
  /** Hint that segment `segIdx` may be visited soon — load it into a free pool slot. */
  preloadSegment(segIdx: number): void;
  destroy(): void;
}

interface PoolSlot {
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  segIdx: number;        // -1 = empty
  ready: boolean;        // loadeddata + seeked complete
  loading: boolean;
  lastUsedTs: number;    // for LRU
  loadToken: number;     // monotonic guard against stale callbacks
  loadPromise: Promise<SlotLoadResult> | null; // in-flight load, awaitable by a swap
}

const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const POOL_SIZE = IS_MOBILE ? 2 : 4;
const VIDEO_LOAD_TIMEOUT_MS = 20_000;
// Start loading the next segment this many seconds before the current one ends,
// so it is `ready` for an instant swap instead of a blocking cold load.
const PREFETCH_LEAD_S = 6;
// Retry a transient cold-load failure (timeout/error) before surfacing it.
const COLD_LOAD_RETRIES = 2;
// Speed multiplier for traversing a missing-video (gap) segment. Configurable.
const GAP_SKIP_RATE = Math.max(1, MapConfig.walkthrough.gapSkipRate ?? 8);

type SlotLoadResult = 'ready' | 'error' | 'stale' | 'timeout';

export function createWalkthroughPlayer(
  container: HTMLElement,
  playlist: WalkthroughPlaylist,
  callbacks: WalkthroughPlayerCallbacks,
): WalkthroughPlayerInstance {
  const { clips, segments } = playlist;

  // ===== State =====
  let playing = false;
  let currentClipIdx = 0;
  let currentSegmentIdx = 0;
  let destroyed = false;
  let loadingSegment = false;
  // Wraps loadingSegment writes so the overlay can show a buffering spinner.
  function setLoadingSegment(v: boolean): void {
    if (loadingSegment === v) return;
    loadingSegment = v;
    callbacks.onLoadingChange?.(v);
  }
  let pendingSeek: number | null = null;
  let animId = 0;
  let playbackRate = 1;
  // Segments whose video file is permanently unavailable (404 / decode error).
  // Never re-requested; played as a timed "gap" so one missing clip can't freeze playback.
  const failedSegments = new Set<number>();

  // Gap mode: traversing a missing-video segment. No video plays; progress (and
  // the map position) advance across the segment's span in real time, with a
  // "no footage" overlay, then playback resumes at the next available segment.
  let gapMode = false;
  let gapBaseReal = 0;
  let gapBaseGlobal = 0;
  let lastGapGlobal = 0;

  // Seek-based fast-forward for rates > 2x.
  // Native playbackRate causes decoder stalls at high speeds (H.264 inter-frame deps).
  const SEEK_THRESHOLD = 2;
  let seekMode = false;
  let seekBaseReal = 0;
  let seekBaseVideo = 0;

  // ===== Error overlay =====
  const errorOverlay = document.createElement('div');
  errorOverlay.className = 'walkthrough-error-overlay';
  errorOverlay.style.cssText = `
    position:absolute;inset:0;display:none;align-items:center;justify-content:center;
    flex-direction:column;gap:8px;background:rgba(0,0,0,0.75);color:rgba(255,255,255,0.8);
    font-size:13px;text-align:center;padding:16px;z-index:1;pointer-events:none;
  `;
  container.style.position = 'relative';
  container.appendChild(errorOverlay);

  function showError(msg: string): void {
    errorOverlay.style.display = 'flex';
    errorOverlay.innerHTML = `<span class="material-icons" style="font-size:36px;opacity:0.5">videocam_off</span><span>${msg}</span>`;
  }
  function hideError(): void {
    errorOverlay.style.display = 'none';
  }

  // ===== Three.js scene =====
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    75, container.clientWidth / Math.max(1, container.clientHeight), 1, 1100,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const geometry = new THREE.SphereGeometry(500, 60, 40);
  geometry.scale(-1, 1, 1);

  // ===== Pool of video elements + persistent VideoTextures =====
  const pool: PoolSlot[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const v = createVideoElement();
    const t = new THREE.VideoTexture(v);
    t.colorSpace = THREE.SRGBColorSpace;
    v.addEventListener('error', onVideoErrorPool);
    v.addEventListener('ended', onVideoEndedPool);
    v.addEventListener('loadeddata', onVideoLoadedPool);
    pool.push({ video: v, texture: t, segIdx: -1, ready: false, loading: false, lastUsedTs: 0, loadToken: 0, loadPromise: null });
  }
  let activeSlot: PoolSlot = pool[0];

  const material = new THREE.MeshBasicMaterial({ map: activeSlot.texture });
  const sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);

  function findSlotByVideo(v: HTMLVideoElement): PoolSlot | null {
    for (const s of pool) if (s.video === v) return s;
    return null;
  }

  function onVideoErrorPool(this: HTMLVideoElement): void {
    if (destroyed) return;
    const slot = findSlotByVideo(this);
    if (!slot) return;
    // A load in progress owns its own error handling (records 'error' →
    // failedSegments → gap). Mutating here would invalidate its token first and
    // downgrade the result to 'stale', silently skipping gap mode.
    if (slot.loading) return;
    if (slot !== activeSlot) {
      // Standby slot failed outside a load — invalidate it, no UI impact.
      slot.segIdx = -1;
      slot.ready = false;
      slot.loadToken++;
      return;
    }
    showError('Video not found');
    if (currentSegmentIdx < segments.length - 1) {
      advanceToNextSegment();
    } else {
      playing = false;
      callbacks.onEnd();
    }
  }

  function onVideoEndedPool(this: HTMLVideoElement): void {
    if (destroyed || !playing || loadingSegment) return;
    if (this !== activeSlot.video) return;  // ignore standby `ended`
    advanceToNextSegment();
  }

  function onVideoLoadedPool(this: HTMLVideoElement): void {
    if (this === activeSlot.video) hideError();
  }

  // ===== Camera control =====
  let lon = 0;
  let lat = 0;
  let lastHeading = -999;     // last value pushed to onHeadingChange
  let isDown = false;
  let prevX = 0;
  let prevY = 0;
  // Pinch-to-zoom FOV (touch): two-pointer distance ↔ camera.fov.
  const activePointers = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartFov = 0;

  const FOV_MIN = 30;
  const FOV_MAX = 100;

  function onPointerDown(e: PointerEvent): void {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { container.setPointerCapture(e.pointerId); } catch { /* noop */ }
    if (activePointers.size >= 2) {
      // Enter pinch: suspend single-finger look.
      const pts = [...activePointers.values()];
      pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartFov = camera.fov;
      isDown = false;
    } else {
      isDown = true;
      prevX = e.clientX;
      prevY = e.clientY;
    }
  }
  function onPointerMove(e: PointerEvent): void {
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (activePointers.size >= 2) {
      const pts = [...activePointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchStartDist > 0) {
        // Fingers apart → zoom in → smaller FOV.
        const fov = pinchStartFov * (pinchStartDist / Math.max(1, dist));
        camera.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, fov));
        camera.updateProjectionMatrix();
      }
      return;
    }
    if (!isDown) return;
    lon += (prevX - e.clientX) * 0.2;
    lat += (e.clientY - prevY) * 0.2;
    lat = Math.max(-85, Math.min(85, lat));
    prevX = e.clientX;
    prevY = e.clientY;
  }
  function onPointerUp(e: PointerEvent): void {
    activePointers.delete(e.pointerId);
    try { container.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (activePointers.size < 2) pinchStartDist = 0;
    if (activePointers.size === 1) {
      // Resume single-finger look from the remaining pointer.
      const [p] = [...activePointers.values()];
      isDown = true;
      prevX = p.x;
      prevY = p.y;
    } else if (activePointers.size === 0) {
      isDown = false;
    }
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    camera.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, camera.fov + e.deltaY * 0.05));
    camera.updateProjectionMatrix();
  }

  /** Snap the look direction back to the current clip's forward yaw. */
  function recenterHeading(): void {
    if (clips.length === 0) return;
    lon = clips[currentClipIdx]?.yaw ?? lon;
    lat = 0;
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('wheel', onWheel, { passive: false });

  // ===== Pool helpers =====

  function findSlotForSeg(segIdx: number): PoolSlot | null {
    for (const s of pool) if (s.segIdx === segIdx && s.ready) return s;
    return null;
  }

  // Pick a slot to load into without ever evicting a protected segment (the
  // ones we're about to need). Returns null if none is safe — callers decide:
  // prefetch skips, the cold path forces an eviction.
  function pickEvictionVictim(protectSegIdx: number[]): PoolSlot | null {
    // 1) Empty, non-loading slot.
    for (const s of pool) if (s.segIdx === -1 && !s.loading) return s;
    // 2) LRU among non-active, non-loading, non-protected.
    let victim: PoolSlot | null = null;
    for (const s of pool) {
      if (s === activeSlot || s.loading) continue;
      if (protectSegIdx.includes(s.segIdx)) continue;
      if (!victim || s.lastUsedTs < victim.lastUsedTs) victim = s;
    }
    if (victim) return victim;
    // 3) LRU among non-active, non-protected — may evict a loading slot, but
    // never one whose segment is protected (e.g. the imminent next segment).
    for (const s of pool) {
      if (s === activeSlot) continue;
      if (protectSegIdx.includes(s.segIdx)) continue;
      if (!victim || s.lastUsedTs < victim.lastUsedTs) victim = s;
    }
    return victim; // null → all non-active slots are protected
  }

  // Last-resort eviction for the cold path, which must have a slot to load into.
  function forceEvictNonActive(): PoolSlot {
    let victim: PoolSlot | null = null;
    for (const s of pool) {
      if (s === activeSlot) continue;
      if (!victim || s.lastUsedTs < victim.lastUsedTs) victim = s;
    }
    return victim!; // POOL_SIZE >= 2 → always a non-active slot exists
  }

  function loadIntoSlot(slot: PoolSlot, segIdx: number, seekTime: number): Promise<SlotLoadResult> {
    const myToken = ++slot.loadToken;
    slot.segIdx = segIdx;
    slot.ready = false;
    slot.loading = true;
    const seg = segments[segIdx];
    slot.video.src = getVideoUrl(seg.videoFile);
    slot.video.load();
    const promise = new Promise<SlotLoadResult>(resolve => {
      let settled = false;
      let timeoutId = 0;
      const cleanup = (): void => {
        slot.video.removeEventListener('loadedmetadata', onLoaded);
        slot.video.removeEventListener('loadeddata', onLoaded);
        slot.video.removeEventListener('canplay', onLoaded);
        slot.video.removeEventListener('error', onErr);
        slot.video.removeEventListener('seeked', onSeek);
        slot.video.removeEventListener('error', onErr2);
        window.clearTimeout(timeoutId);
      };
      const finish = (result: SlotLoadResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (slot.loadToken === myToken) {
          slot.loading = false;
          slot.loadPromise = null;
        }
        // A hard load error (e.g. 404) won't fix itself — remember it so we
        // never re-request the file and skip the segment on advance.
        if (result === 'error') failedSegments.add(segIdx);
        resolve(result);
      };
      const isStale = (): boolean => slot.loadToken !== myToken || destroyed;
      const seekWhenMetadataReady = (): void => {
        if (isStale()) { finish('stale'); return; }
        const duration = Number.isFinite(slot.video.duration) ? slot.video.duration : seg.videoEnd;
        const safeSeekTime = Math.max(0, Math.min(seekTime, Math.max(0, duration - 0.05)));
        if (slot.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            Math.abs(slot.video.currentTime - safeSeekTime) < 0.05) {
          slot.ready = true;
          slot.lastUsedTs = performance.now();
          slot.texture.needsUpdate = true;
          finish('ready');
          return;
        }
        slot.video.currentTime = safeSeekTime;
      };
      const onSeek = (): void => {
        if (isStale()) { finish('stale'); return; }
        slot.ready = true;
        slot.lastUsedTs = performance.now();
        slot.texture.needsUpdate = true;
        finish('ready');
      };
      const onErr2 = (): void => finish(isStale() ? 'stale' : 'error');
      const onLoaded = (): void => {
        seekWhenMetadataReady();
      };
      const onErr = (): void => finish(isStale() ? 'stale' : 'error');
      timeoutId = window.setTimeout(() => finish(isStale() ? 'stale' : 'timeout'), VIDEO_LOAD_TIMEOUT_MS);
      slot.video.addEventListener('loadedmetadata', onLoaded);
      slot.video.addEventListener('loadeddata', onLoaded);
      slot.video.addEventListener('canplay', onLoaded);
      slot.video.addEventListener('seeked', onSeek);
      slot.video.addEventListener('error', onErr2);
      slot.video.addEventListener('error', onErr);
      if (slot.video.readyState >= HTMLMediaElement.HAVE_METADATA) seekWhenMetadataReady();
    });
    if (slot.loading) slot.loadPromise = promise; // still in flight after sync check
    return promise;
  }

  // Cold load with retry — retries only transient timeouts (a 404/decode error
  // won't fix itself). Returns the final result.
  async function loadWithRetry(target: PoolSlot, segIdx: number, seekTime: number): Promise<SlotLoadResult> {
    let result: SlotLoadResult = 'timeout';
    for (let attempt = 0; attempt <= COLD_LOAD_RETRIES; attempt++) {
      result = await loadIntoSlot(target, segIdx, seekTime);
      if (destroyed) return result;
      if (result !== 'timeout') break;     // ready / error / stale → stop
      if (pendingSeek !== null) break;     // superseded by a newer request
    }
    return result;
  }

  // Resolve once the slot's video has decoded the frame at its current position,
  // so swapping material.map shows that frame and not a stale one. Bounded so a
  // missed 'seeked' never hangs the swap.
  function awaitSlotFrame(slot: PoolSlot): Promise<void> {
    const v = slot.video;
    if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !v.seeking) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        v.removeEventListener('seeked', finish);
        v.removeEventListener('canplay', finish);
        window.clearTimeout(t);
        resolve();
      };
      const t = window.setTimeout(finish, 300);
      v.addEventListener('seeked', finish);
      v.addEventListener('canplay', finish);
    });
  }

  function swapToSlot(slot: PoolSlot): void {
    if (slot !== activeSlot) {
      activeSlot.video.pause();
      activeSlot = slot;
      material.map = slot.texture;
      slot.texture.needsUpdate = true;
    }
    activeSlot.lastUsedTs = performance.now();

    if (seekMode) {
      seekBaseReal = performance.now();
      seekBaseVideo = activeSlot.video.currentTime;
    } else {
      activeSlot.video.playbackRate = playbackRate;
      if (playing) activeSlot.video.play().catch(e => console.warn('[Walkthrough] play:', e));
    }
  }

  // Maps (segIdx, video time) → global time. Used to remember a user's
  // intended seek target while a load is in flight.
  function computeGlobalTime(segIdx: number, videoTime: number): number {
    const seg = segments[segIdx];
    for (let i = seg.clipStartIdx; i <= seg.clipEndIdx; i++) {
      const clip = clips[i];
      if (videoTime >= clip.videoStart && videoTime <= clip.videoEnd) {
        return clip.globalStart + (videoTime - clip.videoStart);
      }
    }
    return clips[seg.clipStartIdx].globalStart;
  }

  function drainPendingSeek(): void {
    if (pendingSeek === null) return;
    const t = pendingSeek;
    pendingSeek = null;
    seekToGlobalTime(t);
  }

  // ===== Core: go to a segment (cached → instant swap; cold → load-then-swap) =====

  // `targetClipIdx` lets seekToGlobalTime preserve the target clip when the
  // user seeks into the middle of a segment, so yaw doesn't briefly reset.
  async function gotoSegment(segIdx: number, seekTime: number, targetClipIdx?: number): Promise<void> {
    if (loadingSegment) {
      pendingSeek = computeGlobalTime(segIdx, seekTime);
      return;
    }

    const clipIdx = targetClipIdx ?? segments[segIdx].clipStartIdx;

    // Missing-video segment: don't fetch (would 404) — play it as a timed gap.
    if (!segmentPlayable(segIdx)) {
      enterGap(segIdx, seekTime, clipIdx);
      return;
    }

    const cached = findSlotForSeg(segIdx);
    if (cached) {
      if (Math.abs(cached.video.currentTime - seekTime) > 0.05) {
        // Reseek and wait for the frame before swapping, so the swap doesn't
        // flash the slot's previous (stale) frame. Active stays visible meanwhile.
        setLoadingSegment(true);
        cached.video.currentTime = seekTime;
        await awaitSlotFrame(cached);
        setLoadingSegment(false);
        if (destroyed) return;
      }
      gapMode = false;
      hideError();
      currentSegmentIdx = segIdx;
      currentClipIdx = clipIdx;
      lon = clips[currentClipIdx].yaw;
      swapToSlot(cached);
      console.log(`[Walkthrough] instant swap → segment ${segIdx}`);
      schedulePrefetchNeighbors(segIdx);
      drainPendingSeek();
      return;
    }

    // Cold load: bring the new segment up on a non-active slot, then swap.
    setLoadingSegment(true);

    // If a prefetch is already loading this exact segment, ride it instead of
    // starting a duplicate load (avoids slot churn and a second seek).
    const inFlight = pool.find(
      s => s !== activeSlot && s.segIdx === segIdx && s.loading && s.loadPromise,
    );

    let target: PoolSlot;
    if (activeSlot.segIdx === -1) {
      // Initial load: use the active slot (no swap, just plays in-place).
      target = activeSlot;
    } else {
      // Freeze the current edge's last frame while the next loads. Otherwise the
      // active video keeps rolling past the edge boundary (especially for
      // same-file segments), flashing unrelated footage before the swap.
      activeSlot.video.pause();
      target = inFlight
        ?? pickEvictionVictim([segIdx - 1, segIdx, segIdx + 1, currentSegmentIdx])
        ?? forceEvictNonActive();
    }

    let loadResult: SlotLoadResult;
    if (target === inFlight) {
      loadResult = await inFlight.loadPromise!;
      if (destroyed) return;
      // In-flight load failed transiently → fall back to a fresh load+retry.
      if (loadResult === 'timeout' && pendingSeek === null) {
        loadResult = await loadWithRetry(target, segIdx, seekTime);
      }
    } else {
      loadResult = await loadWithRetry(target, segIdx, seekTime);
    }
    setLoadingSegment(false);
    if (destroyed) return;
    if (loadResult !== 'ready') {
      if (loadResult === 'error') {
        // File missing/undecodable — recorded in failedSegments by loadIntoSlot.
        // Don't freeze: traverse it as a gap (skips to the next real segment).
        enterGap(segIdx, seekTime, clipIdx);
        return;
      }
      if (loadResult === 'timeout') {
        showError('Video load timeout');
        // Stop, don't auto-skip: a paused active with playing=true would trip the
        // render loop's stall detector and skip the segment. User can resume/seek.
        playing = false;
        activeSlot.video.pause();
      }
      drainPendingSeek();
      return;
    }

    gapMode = false;
    hideError();
    // A ridden prefetch is seeked to the segment's videoStart; correct it if the
    // caller asked for a different position (e.g. a mid-segment seek), waiting
    // for the frame so the swap doesn't flash a stale one.
    if (Math.abs(target.video.currentTime - seekTime) > 0.05) {
      target.video.currentTime = seekTime;
      await awaitSlotFrame(target);
      if (destroyed) return;
    }
    currentSegmentIdx = segIdx;
    currentClipIdx = clipIdx;
    lon = clips[currentClipIdx].yaw;
    swapToSlot(target);
    console.log(`[Walkthrough] cold load → segment ${segIdx}`);
    schedulePrefetchNeighbors(segIdx);
    drainPendingSeek();
  }

  // ===== Auto-advance =====

  function advanceToNextSegment(): void {
    if (loadingSegment) return;
    const nextSegIdx = currentSegmentIdx + 1;
    if (nextSegIdx >= segments.length) {
      playing = false;
      activeSlot.video.pause();
      callbacks.onEnd();
      return;
    }
    void gotoSegment(nextSegIdx, segments[nextSegIdx].videoStart);
  }

  // ===== Prefetch + neighbor warming =====

  // False if this segment has no video file (grayed out) — never fetch/load it.
  function segmentPlayable(segIdx: number): boolean {
    if (segIdx < 0 || segIdx >= segments.length) return false;
    return segments[segIdx].hasVideo !== false && !failedSegments.has(segIdx);
  }

  // True if `segIdx` is already loaded-ready or actively loading into some slot.
  function isSegmentAvailable(segIdx: number): boolean {
    for (const s of pool) {
      if (s.segIdx === segIdx && (s.ready || s.loading)) return true;
    }
    return false;
  }

  // Just-in-time lookahead: make sure `segIdx` is loading into a non-active slot.
  // Called from the render loop as we approach the segment boundary so the next
  // file is ready for an instant swap (no blocking cold load at the boundary).
  function ensureSegmentLoading(segIdx: number): void {
    if (!segmentPlayable(segIdx)) return;  // missing-video segment → never fetch
    if (loadingSegment) return;            // a cold load owns the pool right now
    if (isSegmentAvailable(segIdx)) return; // already ready or in flight
    const protect = [currentSegmentIdx, currentSegmentIdx - 1, currentSegmentIdx + 1, segIdx];
    const victim = pickEvictionVictim(protect);
    if (!victim || victim === activeSlot) return; // no safe slot → skip prefetch
    void loadIntoSlot(victim, segIdx, segments[segIdx].videoStart);
  }

  function schedulePrefetchNeighbors(segIdx: number): void {
    for (const adj of [segIdx + 1, segIdx - 1]) {
      if (!segmentPlayable(adj)) continue;
      if (isSegmentAvailable(adj)) continue;
      // Don't kick off a neighbor load while we're in the middle of one — the
      // pool is small and we'd churn slots. Wait until the cold path finishes.
      if (loadingSegment) continue;
      const protect = [segIdx, segIdx + 1, segIdx - 1];
      const victim = pickEvictionVictim(protect);
      if (!victim || victim === activeSlot) continue; // no safe slot → skip
      void loadIntoSlot(victim, adj, segments[adj].videoStart);
    }
  }

  // Enter a missing-video segment: freeze the last real frame, show the
  // "no footage" notice, and let the render loop advance progress across the
  // segment's span in real time. `seekTime` is a video-time within the segment.
  function enterGap(segIdx: number, seekTime: number, clipIdx: number): void {
    const seg = segments[segIdx];
    currentSegmentIdx = segIdx;
    currentClipIdx = Math.max(seg.clipStartIdx, Math.min(seg.clipEndIdx, clipIdx));
    lon = clips[currentClipIdx].yaw;
    activeSlot.video.pause();
    gapMode = true;
    lastGapGlobal = computeGlobalTime(segIdx, seekTime);
    gapBaseGlobal = lastGapGlobal;
    gapBaseReal = performance.now();
    showError('이 구간은 360° 영상이 없습니다');
    callbacks.onClipChange(currentClipIdx);
    callbacks.onProgress(lastGapGlobal);
    schedulePrefetchNeighbors(segIdx); // warm the next available segment
    console.log(`[Walkthrough] gap → segment ${segIdx} (${seg.videoFile} missing)`);
    drainPendingSeek();
  }

  // ===== Init =====
  if (clips.length > 0 && segments.length > 0) {
    console.log('[Walkthrough] segments:', segments.map((s, i) =>
      `[${i}] ${s.videoFile} ${s.videoStart.toFixed(2)}→${s.videoEnd.toFixed(2)}`));
    lon = clips[0].yaw;
    void gotoSegment(0, clips[0].videoStart);
  }

  // ===== Render loop =====
  function animate(): void {
    if (destroyed) return;
    animId = requestAnimationFrame(animate);

    // Push heading changes to the map facing-wedge (throttled by a 0.5° gate).
    const h = ((lon % 360) + 360) % 360;
    if (Math.abs(h - lastHeading) > 0.5) {
      lastHeading = h;
      callbacks.onHeadingChange?.(h);
    }

    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);
    camera.lookAt(
      500 * Math.sin(phi) * Math.cos(theta),
      500 * Math.cos(phi),
      500 * Math.sin(phi) * Math.sin(theta),
    );
    renderer.render(scene, camera);

    if (!playing || loadingSegment || segments.length === 0) return;

    const seg = segments[currentSegmentIdx];
    const activeVideo = activeSlot.video;

    if (gapMode) {
      // No video here — advance progress across the gap span in real time so
      // the map keeps moving, then resume at the next available segment.
      ensureSegmentLoading(currentSegmentIdx + 1);
      const elapsed = (performance.now() - gapBaseReal) / 1000;
      // Skip fast: at least GAP_SKIP_RATE, but honor a higher user speed.
      const gapRate = Math.max(playbackRate, GAP_SKIP_RATE);
      const globalTime = Math.min(seg.globalEnd, gapBaseGlobal + elapsed * gapRate);
      while (
        currentClipIdx < seg.clipEndIdx &&
        currentClipIdx + 1 < clips.length &&
        globalTime >= clips[currentClipIdx].globalEnd
      ) {
        currentClipIdx++;
        lon = clips[currentClipIdx].yaw;
        callbacks.onClipChange(currentClipIdx);
      }
      lastGapGlobal = globalTime;
      callbacks.onProgress(globalTime);
      if (globalTime >= seg.globalEnd - 0.001) {
        advanceToNextSegment();
      }
      return;
    }

    if (seekMode) {
      // Seek-based fast-forward: advance currentTime based on real elapsed time.
      const elapsed = (performance.now() - seekBaseReal) / 1000;
      const targetTime = seekBaseVideo + elapsed * playbackRate;

      // Lookahead scaled by rate: at high speed the boundary arrives sooner.
      if (seg.videoEnd - targetTime < PREFETCH_LEAD_S * playbackRate) {
        ensureSegmentLoading(currentSegmentIdx + 1);
      }

      if (targetTime >= seg.videoEnd - 0.05) {
        advanceToNextSegment();
        return;
      }

      if (!activeVideo.seeking) {
        activeVideo.currentTime = targetTime;
      }

      while (
        currentClipIdx < seg.clipEndIdx &&
        currentClipIdx + 1 < clips.length &&
        targetTime >= clips[currentClipIdx].videoEnd
      ) {
        currentClipIdx++;
        lon = clips[currentClipIdx].yaw;
      }

      const clip = clips[currentClipIdx];
      const globalTime = clip.globalStart + (Math.min(targetTime, clip.videoEnd) - clip.videoStart);
      callbacks.onProgress(globalTime);
      return;
    }

    // Normal playback (rate <= 2x)
    const t = activeVideo.currentTime;

    while (
      currentClipIdx < seg.clipEndIdx &&
      currentClipIdx + 1 < clips.length &&
      t >= clips[currentClipIdx].videoEnd
    ) {
      currentClipIdx++;
      lon = clips[currentClipIdx].yaw;
    }

    callbacks.onProgress(getCurrentGlobalTime());

    // Start loading the next segment before we reach the boundary so the swap
    // is instant. Without this, the boundary triggers a blocking cold load.
    if (seg.videoEnd - t < PREFETCH_LEAD_S) {
      ensureSegmentLoading(currentSegmentIdx + 1);
    }

    const boundaryTolerance = 0.016 * playbackRate;
    const atBoundary = t >= seg.videoEnd - boundaryTolerance;
    const atFileEnd = isFinite(activeVideo.duration) && t >= activeVideo.duration - boundaryTolerance;
    if (atBoundary || atFileEnd) {
      advanceToNextSegment();
      return;
    }

    // Stall detection
    if (activeVideo.paused && !activeVideo.seeking) {
      advanceToNextSegment();
    }
  }
  animate();

  // ===== Helpers =====

  function findSegmentForClip(clipIdx: number): number {
    for (let i = 0; i < segments.length; i++) {
      if (clipIdx >= segments[i].clipStartIdx && clipIdx <= segments[i].clipEndIdx) {
        return i;
      }
    }
    return 0;
  }

  function getCurrentGlobalTime(): number {
    if (clips.length === 0) return 0;
    if (gapMode) return lastGapGlobal; // no video — gap clock is the source of truth
    const clip = clips[currentClipIdx];
    const localTime = activeSlot.video.currentTime;
    const clamped = Math.max(clip.videoStart, Math.min(clip.videoEnd, localTime));
    return clip.globalStart + (clamped - clip.videoStart);
  }

  function seekToGlobalTime(time: number): void {
    const t = Math.max(0, Math.min(playlist.totalDuration, time));

    if (loadingSegment) {
      pendingSeek = t;
      return;
    }

    let targetIdx = clips.length - 1;
    for (let i = 0; i < clips.length; i++) {
      if (t < clips[i].globalEnd) { targetIdx = i; break; }
    }

    const targetClip = clips[targetIdx];
    const localTime = targetClip.videoStart + (t - targetClip.globalStart);
    const targetSegIdx = findSegmentForClip(targetIdx);

    currentClipIdx = targetIdx;
    lon = targetClip.yaw;
    callbacks.onClipChange(targetIdx);

    if (seekMode) {
      seekBaseReal = performance.now();
      seekBaseVideo = localTime;
    }

    if (targetSegIdx !== currentSegmentIdx) {
      void gotoSegment(targetSegIdx, localTime, targetIdx);
    } else if (gapMode) {
      // Re-anchor the gap clock to the new position (no video to seek).
      lastGapGlobal = t;
      gapBaseGlobal = t;
      gapBaseReal = performance.now();
    } else {
      activeSlot.video.currentTime = localTime;
    }

    callbacks.onProgress(t);
  }

  // ===== Public API =====

  return {
    play(): void {
      if (destroyed || clips.length === 0) return;
      playing = true;
      if (gapMode) {
        // Resume the gap clock from where it paused (no video to play).
        gapBaseGlobal = lastGapGlobal;
        gapBaseReal = performance.now();
      } else if (seekMode) {
        seekBaseReal = performance.now();
        seekBaseVideo = activeSlot.video.currentTime;
      } else if (!loadingSegment) {
        activeSlot.video.play().catch(e => console.warn('[Walkthrough] play:', e));
      }
    },

    pause(): void {
      playing = false;
      if (!seekMode) activeSlot.video.pause();
    },

    togglePlayPause(): void {
      if (playing) this.pause();
      else this.play();
    },

    isPlaying(): boolean {
      return playing;
    },

    seekToGlobalTime,
    getCurrentGlobalTime,

    seekBy(deltaSeconds: number): void {
      seekToGlobalTime(getCurrentGlobalTime() + deltaSeconds);
    },

    getHeading(): number {
      return ((lon % 360) + 360) % 360;
    },

    getLookOffset(): number {
      const fwd = clips[currentClipIdx]?.yaw ?? 0;
      let d = (lon - fwd) % 360;
      if (d > 180) d -= 360;
      if (d <= -180) d += 360;
      return d;
    },

    recenterView(): void {
      recenterHeading();
    },

    getCurrentClipIndex(): number {
      return currentClipIdx;
    },

    setPlaybackRate(rate: number): void {
      playbackRate = rate;
      if (gapMode) {
        // Re-anchor the gap clock so the new speed applies from the current point.
        gapBaseGlobal = lastGapGlobal;
        gapBaseReal = performance.now();
        // Keep seekMode consistent so the next real segment resumes in the right
        // mode (no video to touch here, just the flag).
        seekMode = rate > SEEK_THRESHOLD;
        const gapStandby = Math.min(rate, SEEK_THRESHOLD);
        for (const s of pool) s.video.playbackRate = gapStandby;
        return;
      }
      if (rate > SEEK_THRESHOLD) {
        if (!seekMode) {
          seekMode = true;
          seekBaseReal = performance.now();
          seekBaseVideo = activeSlot.video.currentTime;
          activeSlot.video.pause();
        }
      } else {
        if (seekMode) {
          seekMode = false;
          activeSlot.video.playbackRate = rate;
          if (playing) activeSlot.video.play().catch(e => console.warn('[Walkthrough] play:', e));
        } else {
          activeSlot.video.playbackRate = rate;
        }
      }
      // Standby slots play at clamped rate so seekMode swaps don't have to fight playback.
      const standbyRate = Math.min(rate, SEEK_THRESHOLD);
      for (const s of pool) {
        if (s !== activeSlot) s.video.playbackRate = standbyRate;
      }
    },
    getPlaybackRate(): number { return playbackRate; },

    resize(width: number, height: number): void {
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },

    preloadSegment(segIdx: number): void {
      if (segIdx < 0 || segIdx >= segments.length) return;
      if (!segmentPlayable(segIdx)) return;  // missing-video segment → don't fetch
      if (findSlotForSeg(segIdx)) return;
      if (loadingSegment) return;
      const protect = [currentSegmentIdx, currentSegmentIdx - 1, currentSegmentIdx + 1, segIdx];
      const victim = pickEvictionVictim(protect);
      if (!victim || victim === activeSlot) return;
      console.log(`[Walkthrough] preload segment ${segIdx}`);
      void loadIntoSlot(victim, segIdx, segments[segIdx].videoStart);
    },

    destroy(): void {
      destroyed = true;
      cancelAnimationFrame(animId);

      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('wheel', onWheel);

      for (const s of pool) {
        s.video.removeEventListener('error', onVideoErrorPool);
        s.video.removeEventListener('ended', onVideoEndedPool);
        s.video.removeEventListener('loadeddata', onVideoLoadedPool);
        s.video.pause();
        s.video.src = '';
        s.texture.dispose();
      }
      pool.length = 0;

      material.dispose();
      geometry.dispose();
      renderer.dispose();

      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      if (errorOverlay.parentElement) {
        errorOverlay.parentElement.removeChild(errorOverlay);
      }
    },
  };
}

function createVideoElement(): HTMLVideoElement {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  return video;
}
