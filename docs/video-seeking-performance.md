# Walkthrough Video Seeking Performance

## TL;DR

Two independent things make 360° walkthrough video seeking slow / flickery:

1. **MP4 files without `+faststart`** — `moov` atom sits at the end, so every cross-file load forces the browser to fetch the file's tail before it can decode a single frame.
2. **`THREE.VideoTexture` recreated on every segment swap** — Three.js v0.183's `VideoTexture` only uploads to the GPU when `requestVideoFrameCallback` fires, which doesn't happen on a paused video; so a freshly-created texture renders black until the video plays a frame.

Fix #1 is a one-time data prep (a single PowerShell line, see [Faststart conversion](#faststart-conversion)).

Fix #2 is in [walkthroughPlayer.ts](../2.5d_indoor_navigation_frontend_v2/src/components/walkthroughPlayer.ts) — a persistent texture pool with LRU video-element slots, HTTP cache pre-warming, and predictive preload during scrub.

## Problem 1 — Slow cross-file seek

### Why it's slow

The walkthrough player loads one `.mp4` per segment. Cross-segment seek = `<video>.src = newUrl` = decoder reset. With HTTP Range, that's normally fine — the browser asks for the bytes it needs and the server serves them. But it depends on `moov` being at the front of the file.

```
faststart MP4:        ftyp │ moov │ mdat........
                              ↑
                              browser parses moov immediately,
                              seeks to the right mdat byte range.

non-faststart MP4:    ftyp │ mdat........ │ moov
                                            ↑
                                            browser must fetch this first.
                                            On a 93MB file that's an extra
                                            RTT and (in practice) several
                                            hundred KB before any frame.
```

For our dataset (verified 2026-05-08):

| File | Size | Order |
|---|---|---|
| `eng1_c_F1_1_cw.mp4` | 31 MB | `ftyp → mdat → moov` ✗ |
| `eng1_c_F1_19_cw.mp4` | 93 MB | `ftyp → mdat → moov` ✗ |
| `benz_c_F1_15_cw.mp4` | 5.6 MB | `ftyp → mdat → moov` ✗ |

5/5 sampled files were non-faststart. Likely all production clips are.

### Faststart conversion

Run **once** on every machine that hosts the videos (local `videos\` for `webpack-dev-server`, AND the backend's `/data/videos/` on the server).

PowerShell one-liner — copy the entire block as a single line into a PowerShell window:

```powershell
$root="e:\260301\SKKU-2.5D-Navigation_frontend\2.5d_indoor_navigation_frontend_v2\videos"; $tmp="$env:TEMP\fs_$(Get-Random)"; ni -ItemType Directory -Force $tmp | Out-Null; $files=@(gci $root -Recurse -Filter *.mp4); $i=0; $fail=0; $files | %{ $i++; $t=Join-Path $tmp $_.Name; Write-Host "[$i/$($files.Count)] $($_.Name)"; ffmpeg -y -loglevel error -i $_.FullName -c copy -movflags +faststart $t; if($LASTEXITCODE -eq 0 -and (Test-Path $t)){ mi -Force $t $_.FullName }else{ $fail++; Write-Host "  FAIL" -fg Red } }; ri -Recurse -Force $tmp; Write-Host "Done. $($files.Count - $fail)/$($files.Count) ok." -fg Green
```

What it does:
- Recursively finds every `.mp4` under `$root`.
- For each file, runs `ffmpeg -c copy -movflags +faststart` (no re-encode — just rewrites the box layout, ~1 sec / file).
- Writes to `%TEMP%\fs_<random>\<name>.mp4`, then atomically moves the result over the original.
- Prints `[i/N] filename` per file and a final success count.

Linux equivalent (for the backend server):

```bash
ROOT=/data/videos
TMP=$(mktemp -d)
find "$ROOT" -name '*.mp4' | while read f; do
  out="$TMP/$(basename "$f")"
  ffmpeg -y -loglevel error -i "$f" -c copy -movflags +faststart "$out" \
    && mv "$out" "$f" \
    || echo "FAIL: $f"
done
rm -rf "$TMP"
```

### Pre-conditions

- `ffmpeg` in PATH. On Windows: `scoop install ffmpeg` or the Gyan.dev build. Verify: `ffmpeg -version`.
- No app holding the files open (close VLC, Explorer preview pane, dev servers).
- Recommended: back up first. `Copy-Item -Recurse videos videos_backup` — `-c copy` is lossless but defensive.

### Verification

After conversion, sample one file:

```powershell
ffprobe -v trace -i "e:\260301\SKKU-2.5D-Navigation_frontend\2.5d_indoor_navigation_frontend_v2\videos\eng1_mp4\eng1_c_F1_1_cw.mp4" 2>&1 | Select-String "type:'(ftyp|moov|mdat)'" | Select -First 3
```

Expected order: **`ftyp → moov → mdat`**. If it still reads `mdat → moov`, conversion didn't apply (likely a permission error or the file was open).

## Problem 2 — Player flicker + slow swap

### Why it flickered

Original player did this on every segment transition:

```ts
texture.dispose();
texture = new THREE.VideoTexture(activeVideo);   // ← brand new GPU texture
material.map = texture;
material.needsUpdate = true;
activeVideo.play();
```

`THREE.VideoTexture` v0.183 sets `needsUpdate = true` only when `requestVideoFrameCallback` fires. The new texture's GPU storage is uninitialized; the callback fires only when the video presents a *new* frame; the video is paused at `videoStart` and won't present a frame until `play()` triggers the next one (16–50ms later). For those 1–3 frames in between, the sphere samples an empty texture → **black flash**.

### Architecture

The player owns a **pool of N video elements** (`POOL_SIZE = 4` desktop, `2` mobile), each paired 1:1 with a persistent `VideoTexture`. Swapping segments = reassigning `material.map` to another slot's texture. No texture is ever disposed during playback; no GPU upload races.

```
Pool slot
┌────────────────────────────────────────────┐
│  HTMLVideoElement  ⇄  THREE.VideoTexture   │  (persistent for life of player)
│  segIdx: -1 | <integer>                    │
│  ready: bool                               │
│  lastUsedTs: number                        │
│  loadToken: number  (monotonic)            │
└────────────────────────────────────────────┘
```

#### State transitions

| Event | Action |
|---|---|
| `gotoSegment(N)` and slot has segment N ready | `material.map = slot.texture` (instant) |
| `gotoSegment(N)` and no slot ready for N | LRU-evict a slot, load N onto it, then swap. **Active slot keeps showing its last frame the whole time** — no black. |
| Auto-advance (segment ended) | calls `gotoSegment(currentSegmentIdx + 1)` |
| User seek (cross-segment) | calls `gotoSegment(targetSegIdx, localTime, targetClipIdx)` |

#### Helper functions ([walkthroughPlayer.ts](../2.5d_indoor_navigation_frontend_v2/src/components/walkthroughPlayer.ts))

- `findSlotForSeg(segIdx)` — pool lookup; returns `null` if not loaded
- `pickEvictionVictim(protectSegIdx[])` — empty slot first, else LRU outside the protected set (current ± neighbors)
- `loadIntoSlot(slot, segIdx, seekTime)` — `src = url; load(); await loadeddata; currentTime = seekTime; await seeked`. Guarded by `slot.loadToken` so stale callbacks don't flip a slot that's been re-targeted.
- `swapToSlot(slot)` — pause old active, reassign `material.map`, set `texture.needsUpdate = true` defensively, resume play if needed.
- `gotoSegment(segIdx, seekTime, targetClipIdx?)` — single entry point. Cached → instant; otherwise cold-load onto a non-active slot and swap.

### Prefetching

Two cooperating mechanisms:

1. **HTTP cache warm-up** — when the player initializes, `warmHttpCacheAll()` fires `fetch()` for every distinct segment URL in parallel. Bodies are discarded; the browser stores responses in HTTP cache (`Cache-Control: public, max-age=31536000, immutable` from the backend). When a slot later sets `<video>.src = url`, the bytes come from the local cache instead of the network. Saves the ~50–200 ms RTT on first use.
2. **Adjacent slot preload** — after every successful `gotoSegment`, `schedulePrefetchNeighbors(N)` quietly loads N±1 onto a free slot. This is what makes auto-advance and small back-step seeks instant.

### Predictive preload during scrub

In [walkthroughOverlay.ts](../2.5d_indoor_navigation_frontend_v2/src/components/walkthroughOverlay.ts), the progress-bar drag handler watches which segment the cursor is hovering. If the cursor lingers over a segment for **≥100 ms**, it calls `player.preloadSegment(N)` to start loading that segment in the background. By the time the user releases at that position, the slot is usually ready → instant swap.

```ts
if (hoveredSeg !== scrubHoverSeg) {
  scrubHoverSeg = hoveredSeg;
  clearTimeout(scrubHoverTimer);
  scrubHoverTimer = setTimeout(() => player?.preloadSegment(hoveredSeg), 100);
}
```

## Performance expectations

After both fixes are in place:

| Scenario | Cost |
|---|---|
| Auto-advance to next segment (preloaded) | ~16 ms (one frame) — pure texture swap |
| Seek to neighbor (in pool) | ~16 ms |
| Seek to far segment, in HTTP cache, faststart | ~100–200 ms (decoder warm-up only) |
| Seek to far segment, cold HTTP, faststart | ~300–700 ms (network + decoder) |
| Seek to far segment, **without** faststart | 1–10 s (browser fetches file tail before any frame) ✗ |
| Black flicker on swap | 0 (active slot stays visible until new slot is ready) |

The "without faststart" row is why **Problem 1 dominates**. Without faststart, every other optimization in this document is invisible to the user.

## Tunables

In `walkthroughPlayer.ts`:

```ts
const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const POOL_SIZE = IS_MOBILE ? 2 : 4;
```

- **`POOL_SIZE`** — number of simultaneously-decoded video elements. 4 desktop is comfortable on machines with ≥8 GB RAM. 2 mobile keeps memory under ~150 MB on 4K 360° clips. Increasing on desktop helps users who frequently jump back and forth across the timeline.
- **`scrubHoverTimer` delay (overlay)** — 100 ms. Lower = more aggressive preload, more wasted bandwidth on rapid scrubs. Higher = release-then-wait if the user moves quickly.

## Things this design does NOT do

- **No HLS / DASH / MSE.** Single `<video>` adaptive streaming would let YouTube-style scrubbing within one continuous buffer, but it requires the backend to chunk and emit `.m3u8` / `.mpd` manifests, which is a much bigger lift. The pool architecture matches the current "one MP4 per segment" backend contract.
- **No video transcoding for adaptive bitrate.** All clips are served at one resolution.
- **No service-worker prefetch.** HTTP-cache `fetch()` is fire-and-forget; if the user closes the tab, partial downloads are abandoned.

If a single MP4 ever exceeds ~100 MB or campus 4G first-frame latency exceeds 5 s, revisit and consider HLS — see [http-range-video-serving.md](./http-range-video-serving.md) §"When to revisit".

## References

- [walkthroughPlayer.ts](../2.5d_indoor_navigation_frontend_v2/src/components/walkthroughPlayer.ts) — pool / texture / `gotoSegment` implementation
- [walkthroughOverlay.ts](../2.5d_indoor_navigation_frontend_v2/src/components/walkthroughOverlay.ts) — predictive preload during scrub
- [http-range-video-serving.md](./http-range-video-serving.md) — backend Range contract, why MP4-over-HTTP, why faststart matters
- [h264-high-speed-playback.md](./h264-high-speed-playback.md) — adjacent topic: why `playbackRate > 2` uses currentTime-step instead of native rate
- [`THREE.VideoTexture` source (v0.183)](../2.5d_indoor_navigation_frontend_v2/node_modules/three/src/textures/VideoTexture.js) — `requestVideoFrameCallback` registration that explains the original flicker
- ffmpeg `-movflags +faststart` — moves the `moov` atom to the front of the file
- RFC 7233 — HTTP Range Requests
