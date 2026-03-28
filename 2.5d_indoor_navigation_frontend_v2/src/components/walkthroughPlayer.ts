// ===== Walkthrough Player — Three.js 360° Segment-Based Playback Engine =====
// Double-buffered: activeVideo plays, standbyVideo preloads the next segment.
// Segment transition = instant texture swap. No gap.

import * as THREE from 'three';
import type { WalkthroughPlaylist } from './walkthroughTypes';

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
  destroy(): void;
}

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
  // Instead: pause video, advance currentTime in steps, let decoder handle one frame at a time.
  const SEEK_THRESHOLD = 2;
  let seekMode = false;
  let seekBaseReal = 0;    // performance.now() when seek mode started
  let seekBaseVideo = 0;   // video time when seek mode started

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

  // ===== Double-buffered video elements =====
  const videoA = createVideoElement();
  const videoB = createVideoElement();
  let activeVideo = videoA;
  let standbyVideo = videoB;
  let standbyReady = false;
  let standbySegIdx = -1;

  function onVideoError(this: HTMLVideoElement): void {
    if (destroyed || this !== activeVideo) return;
    showError('Video not found');
    if (currentSegmentIdx < segments.length - 1) {
      advanceToNextSegment();
    } else {
      playing = false;
      callbacks.onEnd();
    }
  }

  function onVideoEnded(this: HTMLVideoElement): void {
    if (destroyed || !playing || loadingSegment || this !== activeVideo) return;
    console.log(`[Walkthrough] video ended naturally at ${this.currentTime.toFixed(2)}, duration=${this.duration.toFixed(2)}`);
    advanceToNextSegment();
  }

  function onVideoLoaded(this: HTMLVideoElement): void {
    if (this === activeVideo) hideError();
  }

  videoA.addEventListener('error', onVideoError);
  videoB.addEventListener('error', onVideoError);
  videoA.addEventListener('ended', onVideoEnded);
  videoB.addEventListener('ended', onVideoEnded);
  videoA.addEventListener('loadeddata', onVideoLoaded);
  videoB.addEventListener('loadeddata', onVideoLoaded);

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

  let texture = new THREE.VideoTexture(activeVideo);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);

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

  // ===== Preload next segment onto standby =====

  function preloadNextSegment(segIdx: number): void {
    if (segIdx >= segments.length) return;
    standbyReady = false;
    standbySegIdx = segIdx;
    const seg = segments[segIdx];
    const vid = standbyVideo; // capture reference — survives swaps
    vid.src = `/videos/${seg.videoFile}`;
    vid.load();
    vid.addEventListener('loadeddata', function onLoad() {
      vid.removeEventListener('loadeddata', onLoad);
      vid.currentTime = seg.videoStart;
      vid.addEventListener('seeked', function onSeek() {
        vid.removeEventListener('seeked', onSeek);
        standbyReady = true;
        console.log(`[Walkthrough] standby ready: segment ${segIdx} (${seg.videoFile} @${seg.videoStart.toFixed(2)})`);
      });
    });
  }

  // ===== Instant swap: standby → active =====

  function swapToStandby(segIdx: number): void {
    activeVideo.pause();

    // Swap references
    const tmp = activeVideo;
    activeVideo = standbyVideo;
    standbyVideo = tmp;

    // Update Three.js texture
    texture.dispose();
    texture = new THREE.VideoTexture(activeVideo);
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
    material.needsUpdate = true;

    // Update state
    currentSegmentIdx = segIdx;
    currentClipIdx = segments[segIdx].clipStartIdx;
    lon = clips[currentClipIdx].yaw;

    console.log(`[Walkthrough] instant swap → segment ${segIdx}, yaw=${lon.toFixed(1)}`);

    if (seekMode) {
      // In seek mode: keep paused, reset seek base to new segment start
      seekBaseReal = performance.now();
      seekBaseVideo = activeVideo.currentTime;
    } else {
      activeVideo.playbackRate = playbackRate;
      if (playing) {
        activeVideo.play().catch(e => console.warn('[Walkthrough] play:', e));
      }
    }

    // Preload the NEXT segment on the now-standby element
    preloadNextSegment(segIdx + 1);
  }

  // ===== Advance to next segment =====

  function advanceToNextSegment(): void {
    const nextSegIdx = currentSegmentIdx + 1;
    if (nextSegIdx >= segments.length) {
      playing = false;
      activeVideo.pause();
      callbacks.onEnd();
      return;
    }

    if (standbyReady && standbySegIdx === nextSegIdx) {
      swapToStandby(nextSegIdx);
    } else {
      console.log(`[Walkthrough] fallback load for segment ${nextSegIdx}`);
      currentClipIdx = segments[nextSegIdx].clipStartIdx;
      lon = clips[currentClipIdx].yaw;
      loadSegment(nextSegIdx, segments[nextSegIdx].videoStart);
    }
  }

  // ===== Sequential load (fallback + initial + seek) =====

  function waitForEvent(el: HTMLMediaElement, event: string, timeout = 2000): Promise<void> {
    return new Promise(resolve => {
      if (destroyed) { resolve(); return; }
      const timer = setTimeout(resolve, timeout);
      el.addEventListener(event, function handler() {
        el.removeEventListener(event, handler);
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  async function loadSegment(segIdx: number, seekTime: number): Promise<void> {
    if (destroyed) return;
    loadingSegment = true;

    const seg = segments[segIdx];
    const currentSrc = activeVideo.src;
    const targetSrc = new URL(`/videos/${seg.videoFile}`, location.href).href;
    const needsSrcChange = currentSrc !== targetSrc;

    if (needsSrcChange) {
      activeVideo.src = `/videos/${seg.videoFile}`;
      activeVideo.load();
      await waitForEvent(activeVideo, 'loadeddata');
      if (destroyed) return;

      texture.dispose();
      texture = new THREE.VideoTexture(activeVideo);
      texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.needsUpdate = true;
    }

    activeVideo.currentTime = seekTime;
    await waitForEvent(activeVideo, 'seeked');
    if (destroyed) return;

    currentSegmentIdx = segIdx;
    loadingSegment = false;

    console.log(`[Walkthrough] segment ${segIdx} loaded (fallback), seeked to ${seekTime.toFixed(2)}`);

    if (seekMode) {
      seekBaseReal = performance.now();
      seekBaseVideo = seekTime;
    } else {
      activeVideo.playbackRate = playbackRate;
      if (playing) {
        activeVideo.play().catch(e => console.warn('[Walkthrough] play:', e));
      }
    }

    preloadNextSegment(segIdx + 1);

    if (pendingSeek !== null) {
      const t = pendingSeek;
      pendingSeek = null;
      seekToGlobalTime(t);
    }
  }

  // ===== Helpers =====

  function findSegmentForClip(clipIdx: number): number {
    for (let i = 0; i < segments.length; i++) {
      if (clipIdx >= segments[i].clipStartIdx && clipIdx <= segments[i].clipEndIdx) {
        return i;
      }
    }
    return 0;
  }

  // ===== Init =====
  if (clips.length > 0 && segments.length > 0) {
    console.log('[Walkthrough] segments:', segments.map((s, i) =>
      `[${i}] ${s.videoFile} ${s.videoStart.toFixed(2)}→${s.videoEnd.toFixed(2)}`));
    lon = clips[0].yaw;
    loadSegment(0, clips[0].videoStart);
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

    if (seekMode) {
      // Seek-based fast-forward: advance currentTime based on real elapsed time
      const elapsed = (performance.now() - seekBaseReal) / 1000;
      const targetTime = seekBaseVideo + elapsed * playbackRate;

      if (targetTime >= seg.videoEnd - 0.05) {
        advanceToNextSegment();
        return;
      }

      // Only seek if decoder finished the previous seek
      if (!activeVideo.seeking) {
        activeVideo.currentTime = targetTime;
      }

      // Update clip index based on target time (smooth, not dependent on decoder)
      while (currentClipIdx < seg.clipEndIdx && targetTime >= clips[currentClipIdx].videoEnd) {
        currentClipIdx++;
        lon = clips[currentClipIdx].yaw;
      }

      // Use calculated target time for progress (no jitter from decoder lag)
      const clip = clips[currentClipIdx];
      const globalTime = clip.globalStart + (Math.min(targetTime, clip.videoEnd) - clip.videoStart);
      callbacks.onProgress(globalTime);
      return;
    }

    // Normal playback (rate <= 2x)
    const t = activeVideo.currentTime;

    while (currentClipIdx < seg.clipEndIdx && t >= clips[currentClipIdx].videoEnd) {
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

    // Stall detection (normal mode only)
    if (activeVideo.paused && !activeVideo.seeking) {
      advanceToNextSegment();
    }
  }
  animate();

  // ===== Core functions =====

  function getCurrentGlobalTime(): number {
    if (clips.length === 0) return 0;
    const clip = clips[currentClipIdx];
    const localTime = activeVideo.currentTime;
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
      loadSegment(targetSegIdx, localTime);
    } else {
      activeVideo.currentTime = localTime;
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
        seekBaseVideo = activeVideo.currentTime;
      } else if (!loadingSegment) {
        activeVideo.play().catch(e => console.warn('[Walkthrough] play:', e));
      }
    },

    pause(): void {
      playing = false;
      if (!seekMode) activeVideo.pause();
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
          seekBaseVideo = activeVideo.currentTime;
          activeVideo.pause();
        }
      } else {
        if (seekMode) {
          seekMode = false;
          activeVideo.playbackRate = rate;
          if (playing) activeVideo.play().catch(e => console.warn('[Walkthrough] play:', e));
        } else {
          activeVideo.playbackRate = rate;
        }
      }
      standbyVideo.playbackRate = Math.min(rate, SEEK_THRESHOLD);
    },
    getPlaybackRate(): number { return playbackRate; },

    resize(width: number, height: number): void {
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },

    destroy(): void {
      destroyed = true;
      cancelAnimationFrame(animId);

      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('wheel', onWheel);

      videoA.pause(); videoA.src = '';
      videoB.pause(); videoB.src = '';

      texture.dispose();
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
