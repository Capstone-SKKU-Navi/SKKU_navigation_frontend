// ===== Walkthrough Player — Three.js 360° Segment-Based Playback Engine =====
// LRU pool (N=4 desktop / N=2 mobile): persistent VideoTexture per slot.
// Cross-segment swap = material.map reassignment (no dispose/recreate → no flicker).
// Cold loads go onto a standby slot first, then swap when ready (active keeps last frame).

import * as THREE from 'three';
import type { WalkthroughPlaylist } from './walkthroughTypes';
import { getVideoUrl } from '../services/backendService';

export interface WalkthroughPlayerCallbacks {
  onProgress(globalTime: number): void;
  onClipChange(clipIndex: number): void;
  onEnd(): void;
}

export interface WalkthroughPlayerInstance {
  play(): void;
  pause(): void;
  togglePlayPause(): void;
  isPlaying(): boolean;
  seekToGlobalTime(time: number): void;
  getCurrentGlobalTime(): number;
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
  lastUsedTs: number;    // for LRU
  loadToken: number;     // monotonic guard against stale callbacks
}

const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const POOL_SIZE = IS_MOBILE ? 2 : 4;

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
  let pendingSeek: number | null = null;
  let animId = 0;
  let playbackRate = 1;

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
    pool.push({ video: v, texture: t, segIdx: -1, ready: false, lastUsedTs: 0, loadToken: 0 });
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
    if (slot !== activeSlot) {
      // Standby load failed — invalidate the slot, no UI impact.
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
  let isDown = false;
  let prevX = 0;
  let prevY = 0;

  function onPointerDown(e: PointerEvent): void {
    isDown = true;
    prevX = e.clientX;
    prevY = e.clientY;
    container.setPointerCapture(e.pointerId);
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
    container.releasePointerCapture(e.pointerId);
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    camera.fov = Math.max(30, Math.min(100, camera.fov + e.deltaY * 0.05));
    camera.updateProjectionMatrix();
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

  function pickEvictionVictim(protectSegIdx: number[]): PoolSlot {
    // 1) Empty slot first.
    for (const s of pool) if (s.segIdx === -1) return s;
    // 2) LRU among non-protected, non-active.
    let victim: PoolSlot | null = null;
    for (const s of pool) {
      if (s === activeSlot) continue;
      if (protectSegIdx.includes(s.segIdx)) continue;
      if (!victim || s.lastUsedTs < victim.lastUsedTs) victim = s;
    }
    if (victim) return victim;
    // 3) Force-evict the LRU non-active (all others were protected).
    for (const s of pool) {
      if (s === activeSlot) continue;
      if (!victim || s.lastUsedTs < victim.lastUsedTs) victim = s;
    }
    return victim!;
  }

  function loadIntoSlot(slot: PoolSlot, segIdx: number, seekTime: number): Promise<boolean> {
    const myToken = ++slot.loadToken;
    slot.segIdx = segIdx;
    slot.ready = false;
    const seg = segments[segIdx];
    slot.video.src = getVideoUrl(seg.videoFile);
    slot.video.load();
    return new Promise(resolve => {
      const onLoaded = (): void => {
        slot.video.removeEventListener('loadeddata', onLoaded);
        slot.video.removeEventListener('error', onErr);
        if (slot.loadToken !== myToken || destroyed) { resolve(false); return; }
        slot.video.currentTime = seekTime;
        const onSeek = (): void => {
          slot.video.removeEventListener('seeked', onSeek);
          slot.video.removeEventListener('error', onErr2);
          if (slot.loadToken !== myToken || destroyed) { resolve(false); return; }
          slot.ready = true;
          slot.lastUsedTs = performance.now();
          slot.texture.needsUpdate = true;
          resolve(true);
        };
        const onErr2 = (): void => {
          slot.video.removeEventListener('seeked', onSeek);
          slot.video.removeEventListener('error', onErr2);
          resolve(false);
        };
        slot.video.addEventListener('seeked', onSeek);
        slot.video.addEventListener('error', onErr2);
      };
      const onErr = (): void => {
        slot.video.removeEventListener('loadeddata', onLoaded);
        slot.video.removeEventListener('error', onErr);
        resolve(false);
      };
      slot.video.addEventListener('loadeddata', onLoaded);
      slot.video.addEventListener('error', onErr);
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

    const cached = findSlotForSeg(segIdx);
    if (cached) {
      if (Math.abs(cached.video.currentTime - seekTime) > 0.05) {
        cached.video.currentTime = seekTime;
        // No await for `seeked`: texture.needsUpdate on next render is sufficient,
        // and the active video stays visible in the meantime.
      }
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
    // Active video keeps showing its last frame the whole time → no black flash.
    loadingSegment = true;
    let target: PoolSlot;
    if (activeSlot.segIdx === -1) {
      // Initial load: use the active slot (no swap, just plays in-place).
      target = activeSlot;
    } else {
      const protect = [segIdx - 1, segIdx, segIdx + 1, currentSegmentIdx];
      target = pickEvictionVictim(protect);
    }
    const ok = await loadIntoSlot(target, segIdx, seekTime);
    loadingSegment = false;
    if (destroyed) return;
    if (!ok) {
      showError('Video load timeout');
      drainPendingSeek();
      return;
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

  let httpCacheWarmed = false;
  function warmHttpCacheAll(): void {
    if (httpCacheWarmed) return;
    httpCacheWarmed = true;
    const seen = new Set<string>();
    for (const seg of segments) {
      if (seen.has(seg.videoFile)) continue;
      seen.add(seg.videoFile);
      // Body discarded — browser stores response in HTTP cache (Cache-Control: immutable).
      fetch(getVideoUrl(seg.videoFile), { method: 'GET' }).catch(() => {});
    }
  }

  function schedulePrefetchNeighbors(segIdx: number): void {
    warmHttpCacheAll();
    for (const adj of [segIdx + 1, segIdx - 1]) {
      if (adj < 0 || adj >= segments.length) continue;
      if (findSlotForSeg(adj)) continue;
      // Don't kick off a neighbor load while we're in the middle of one — the
      // pool is small and we'd churn slots. Wait until the cold path finishes.
      if (loadingSegment) continue;
      const protect = [segIdx, segIdx + 1, segIdx - 1];
      const victim = pickEvictionVictim(protect);
      if (victim === activeSlot) continue;  // never preload onto the displayed slot
      void loadIntoSlot(victim, adj, segments[adj].videoStart);
    }
  }

  // ===== Init =====
  if (clips.length > 0 && segments.length > 0) {
    console.log('[Walkthrough] segments:', segments.map((s, i) =>
      `[${i}] ${s.videoFile} ${s.videoStart.toFixed(2)}→${s.videoEnd.toFixed(2)}`));
    lon = clips[0].yaw;
    warmHttpCacheAll();
    void gotoSegment(0, clips[0].videoStart);
  }

  // ===== Render loop =====
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
    renderer.render(scene, camera);

    if (!playing || loadingSegment || segments.length === 0) return;

    const seg = segments[currentSegmentIdx];
    const activeVideo = activeSlot.video;

    if (seekMode) {
      // Seek-based fast-forward: advance currentTime based on real elapsed time.
      const elapsed = (performance.now() - seekBaseReal) / 1000;
      const targetTime = seekBaseVideo + elapsed * playbackRate;

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
      if (seekMode) {
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

    getCurrentClipIndex(): number {
      return currentClipIdx;
    },

    setPlaybackRate(rate: number): void {
      playbackRate = rate;
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
      if (findSlotForSeg(segIdx)) return;
      if (loadingSegment) return;
      const protect = [currentSegmentIdx, currentSegmentIdx - 1, currentSegmentIdx + 1, segIdx];
      const victim = pickEvictionVictim(protect);
      if (victim === activeSlot) return;
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
