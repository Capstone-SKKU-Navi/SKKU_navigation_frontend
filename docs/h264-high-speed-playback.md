# H.264 High-Speed Playback — Why >2x Stutters

## TL;DR

`video.playbackRate = 4` tells the browser to decode 4x frames per second.
H.264's inter-frame compression makes this impossible to sustain — the decoder stalls and the video freezes.

## H.264 Frame Types

H.264 uses three frame types to compress video:

```
I ← P ← P ← P ← P ← I ← P ← P ← P ← P ← I
│                      │                      │
keyframe               keyframe               keyframe
(full image)           (full image)           (full image)
```

- **I-frame (keyframe)**: Complete image. Independently decodable.
- **P-frame**: Stores only the *difference* from the previous frame. Must decode all preceding frames back to the last I-frame.
- **B-frame**: Stores differences from *both* previous and next frames. Even more dependent.

Typical keyframe interval: 2–10 seconds (60–300 frames at 30fps).

## What Happens at 4x

A 30fps video at 4x = 120 decoded frames/sec.

To display frame #150 (a P-frame), the decoder must:
1. Find the last I-frame (say, frame #120)
2. Decode frames #120 → #121 → #122 → ... → #150 sequentially
3. All within 8.3ms (1/120s)

This sequential dependency is the bottleneck. The decoder **cannot skip frames** — every P-frame depends on the one before it.

```
1x (30fps):  decode 1 frame per 33ms  ✓ easy
2x (60fps):  decode 1 frame per 16ms  ✓ tight but feasible
4x (120fps): decode 1 frame per 8ms   ✗ decoder can't keep up
```

When the decoder falls behind:
1. Browser drops frames → choppy visual
2. If too many frames drop, browser stalls playback entirely → **freeze**
3. After catching up, playback resumes → **the "pause then resume" behavior**

## Why Local Files Still Stutter

The bottleneck is **CPU/GPU decode time**, not I/O.
Local file = no network latency, but the decoder still has to process every inter-frame dependency chain.

## Our Fix: Seek-Based Stepping

For rates > 2x, we don't use native `playbackRate`. Instead:

```
Native 4x:     play → decode 120fps → stall → freeze
Seek-based 4x: pause → seek +133ms → decode 1 frame → seek +133ms → ...
```

1. Video stays **paused** (zero decoder pressure)
2. Each animation frame: `video.currentTime += elapsed * rate`
3. Browser decodes **one frame** from nearest keyframe
4. Three.js VideoTexture reads the new frame

Trade-off: visual shows keyframe-interval jumps (not every frame), but no stuttering.

## Threshold

| Rate | Method | Why |
|------|--------|-----|
| 0.5x–2x | Native `playbackRate` | Decoder handles 15–60fps fine |
| >2x | Seek-based stepping | Avoids decoder stalls |

Implementation: `walkthroughPlayer.ts`, `SEEK_THRESHOLD = 2`.

## Alternative: Re-encode with Frequent Keyframes

If smooth 4x visual is needed, re-encode source videos:

```bash
# Keyframe every 15 frames (~0.5s at 30fps), no B-frames
ffmpeg -i input.mp4 -g 15 -bf 0 -tune fastdecode -c:v libx264 output.mp4

# All-intra (every frame is a keyframe) — largest file, best seeking
ffmpeg -i input.mp4 -g 1 -c:v libx264 output.mp4
```

Shorter keyframe interval = less inter-frame dependency = faster decode at high speeds.
Trade-off: file size increases significantly (2–5x for all-intra).

## References

- `video.getVideoPlaybackQuality().droppedVideoFrames` — measure frame drops
- `video.fastSeek(time)` — snap to nearest keyframe (faster than `currentTime`)
- `requestVideoFrameCallback()` — fires only when a frame is composited
