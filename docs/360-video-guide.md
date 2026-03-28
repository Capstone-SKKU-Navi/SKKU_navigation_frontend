# 360° Video Naming Convention & Implementation Guide

## Overview

48 raw 360° videos (.insv) captured on 2026-03-28 for eng1 building (제1공학관).
Videos are **continuous recordings** — the route engine plays **segments** (`startTime` → `endTime`) of each video depending on the path.

- Corridor: room exit → play from the middle of a corridor video
- Staircase: 2F→4F → play a segment of the full 1F→5F staircase video
- Elevator: enter clip at departure floor + exit clip at arrival floor

---

## Naming Convention

### Pattern

```
eng1_{type}_{location}_{detail}.mp4
```

### Corridors (30 files)

`eng1_corridor_{wing}_{floor}F_{direction}.mp4`

| Parameter | Values                                       |
| --------- | -------------------------------------------- |
| wing      | `21`, `22`, `23`                             |
| floor     | `1F` ~ `5F`                                 |
| direction | `cw` (clockwise), `ccw` (counterclockwise)  |

```
eng1_corridor_21_1F_cw.mp4
eng1_corridor_21_1F_ccw.mp4
eng1_corridor_22_3F_cw.mp4
eng1_corridor_23_5F_ccw.mp4
```

### Staircases (8 files)

`eng1_stair_{id}_{direction}.mp4`

| Parameter | Values                          |
| --------- | ------------------------------- |
| id        | `1`, `2`, `3`, `4`             |
| direction | `up` (1F→5F), `down` (5F→1F)  |

```
eng1_stair_1_down.mp4     eng1_stair_1_up.mp4
eng1_stair_2_down.mp4     eng1_stair_2_up.mp4
eng1_stair_3_down.mp4     eng1_stair_3_up.mp4
eng1_stair_4_down.mp4     eng1_stair_4_up.mp4
```

### Elevators (10 files)

`eng1_elev_{id}_{floor}F.mp4`

| Parameter | Values       |
| --------- | ------------ |
| id        | `1`, `2`     |
| floor     | `1F` ~ `5F`  |

Each clip contains enter + exit at that floor as one continuous shot.

```
eng1_elev_1_1F.mp4    eng1_elev_2_1F.mp4
eng1_elev_1_2F.mp4    eng1_elev_2_2F.mp4
eng1_elev_1_3F.mp4    eng1_elev_2_3F.mp4
eng1_elev_1_4F.mp4    eng1_elev_2_4F.mp4
eng1_elev_1_5F.mp4    eng1_elev_2_5F.mp4
```

---

## Complete File List (48 files)

### Corridors (30)

```
eng1_corridor_21_1F_cw.mp4     eng1_corridor_21_1F_ccw.mp4
eng1_corridor_21_2F_cw.mp4     eng1_corridor_21_2F_ccw.mp4
eng1_corridor_21_3F_cw.mp4     eng1_corridor_21_3F_ccw.mp4
eng1_corridor_21_4F_cw.mp4     eng1_corridor_21_4F_ccw.mp4
eng1_corridor_21_5F_cw.mp4     eng1_corridor_21_5F_ccw.mp4
eng1_corridor_22_1F_cw.mp4     eng1_corridor_22_1F_ccw.mp4
eng1_corridor_22_2F_cw.mp4     eng1_corridor_22_2F_ccw.mp4
eng1_corridor_22_3F_cw.mp4     eng1_corridor_22_3F_ccw.mp4
eng1_corridor_22_4F_cw.mp4     eng1_corridor_22_4F_ccw.mp4
eng1_corridor_22_5F_cw.mp4     eng1_corridor_22_5F_ccw.mp4
eng1_corridor_23_1F_cw.mp4     eng1_corridor_23_1F_ccw.mp4
eng1_corridor_23_2F_cw.mp4     eng1_corridor_23_2F_ccw.mp4
eng1_corridor_23_3F_cw.mp4     eng1_corridor_23_3F_ccw.mp4
eng1_corridor_23_4F_cw.mp4     eng1_corridor_23_4F_ccw.mp4
eng1_corridor_23_5F_cw.mp4     eng1_corridor_23_5F_ccw.mp4
```

### Staircases (8)

```
eng1_stair_1_down.mp4     eng1_stair_1_up.mp4
eng1_stair_2_down.mp4     eng1_stair_2_up.mp4
eng1_stair_3_down.mp4     eng1_stair_3_up.mp4
eng1_stair_4_down.mp4     eng1_stair_4_up.mp4
```

### Elevators (10)

```
eng1_elev_1_1F.mp4    eng1_elev_2_1F.mp4
eng1_elev_1_2F.mp4    eng1_elev_2_2F.mp4
eng1_elev_1_3F.mp4    eng1_elev_2_3F.mp4
eng1_elev_1_4F.mp4    eng1_elev_2_4F.mp4
eng1_elev_1_5F.mp4    eng1_elev_2_5F.mp4
```

---

## Video Settings (Yaw Calibration)

Each video has a calibrated **initial yaw** (camera viewing direction in degrees) stored in `public/geojson/video_settings.json`.

### Data Structure

```typescript
// Corridors: single yaw (walking direction)
{ "eng1_corridor_21_1F_cw.mp4": { "yaw": 189.87 } }

// Stairs & Elevators: entry + exit yaw (two camera directions)
{ "eng1_stair_1_up.mp4": { "entryYaw": 45.0, "exitYaw": 225.0 } }
{ "eng1_elev_1_3F.mp4":  { "entryYaw": 90.0, "exitYaw": 270.0 } }
```

### Setting Yaw Values

Use the **Video Settings** panel in the graph editor (gear icon):
1. Videos grouped by type (corridor / stair / elevator)
2. Click "360" button next to any video to open 360° preview
3. Drag to rotate the view to the correct initial camera direction
4. Confirm to save yaw value
5. Settings auto-save to `video_settings.json` via dev server PUT API

---

## Edge-Video Mapping

### Bidirectional Assignment

Each graph edge stores video data for **both traversal directions**:

```typescript
interface NavEdge {
  from: string;
  to: string;

  // Forward direction (from → to)
  videoFwd?: string;           // video filename
  videoFwdStart?: number;      // seek start (seconds)
  videoFwdEnd?: number;        // seek end (seconds)
  videoFwdExit?: string;       // exit clip (stairs/elevator only)
  videoFwdExitStart?: number;
  videoFwdExitEnd?: number;

  // Reverse direction (to → from)
  videoRev?: string;
  videoRevStart?: number;
  videoRevEnd?: number;
  videoRevExit?: string;
  videoRevExitStart?: number;
  videoRevExitEnd?: number;
}
```

- **FWD** = edge.from → edge.to
- **REV** = edge.to → edge.from
- Corridors: cw video maps to FWD, ccw auto-assigned to REV (via `getOppositeVideo()`)
- Stairs/Elevators: main clip = entry phase, exit clip = exit phase at arrival floor

### Smart Video Suggestion

When assigning a video to an edge, `videoCatalog.ts` ranks suggestions by:
1. Type match (corridor/stair/elevator edge → same type video)
2. Wing proximity (corridor edges near wing 21 → wing 21 videos ranked higher)
3. Floor match
4. Cross-floor detection (stair/elevator edges → vertical-movement videos)

### Single Edge Assignment

In the graph editor panel, select an edge to see:
- Two directional sections: "→ From → To" (FWD) and "← To → From" (REV)
- Video dropdown with smart suggestions
- Time range display (e.g., "12.5s ~ 28.0s")
- Timer button to open interactive 360° preview for time-range selection
- For stairs/elevators: additional entry + exit clip sections

### Multi-Edge Selection & Split Assignment

1. **Shift+click** edges to select multiple
2. Edges must form a **linear chain** (validated by `orderEdgeChain()`)
3. Chain is ordered topologically with alignment tracking (FWD/REV per edge)
4. **Assign & Split**: select one video → preview opens in split mode → drag N split markers → each edge gets its portion
5. REV direction: split mapping is reversed (first split → chain end)
6. Opposite direction auto-assigned for corridors (cw ↔ ccw)

---

## 360° Preview Overlay

Interactive Three.js preview with three modes:

| Mode | Purpose | UI |
|------|---------|----|
| `yaw` | Set initial camera direction | Drag sphere, confirm angle |
| `time-range` | Set startTime/endTime for one edge | Drag start/end markers on seekbar |
| `split` | Divide video across N edges | Place N-1 split markers on seekbar |

### Controls
- **Pointer drag**: Pan camera (longitude/latitude)
- **Mouse wheel**: Zoom (FOV 30°–100°)
- **Spacebar**: Play/pause toggle
- **Seekbar click**: Jump to time
- **Marker drag**: Adjust time boundaries (time-range & split modes)

---

## Walkthrough Player Architecture

### Data Flow

```
User selects route → graphService.findRoute()
  ↓
walkthroughPlanner.buildWalkthroughPlaylist(route)
  ├─ Iterate edgePath → build clips from edge.videoFwd/videoRev + times
  ├─ Compute partial clips at start/end via perpendicular foot projection
  ├─ Group contiguous clips → VideoSegment[]
  └─ Return WalkthroughPlaylist { clips, segments, coordinates, totalDuration }
  ↓
walkthroughOverlay.showWalkthroughOverlay(playlist)
  ├─ Build floating overlay UI (draggable, resizable)
  └─ walkthroughPlayer.createWalkthroughPlayer(canvas, playlist)
      ├─ Load clips[0] → activeVideo
      ├─ Preload next segment → standbyVideo
      └─ Render loop:
          ├─ Update camera yaw from current clip
          ├─ Check segment boundary → swapToStandby()
          ├─ onProgress(globalTime) → UI + map sync
          └─ Position indicator + floor sync on map
```

### Key Types

```typescript
interface WalkthroughClip {
  videoFile: string;          // e.g., "eng1_corridor_21_3F_cw.mp4"
  videoStart: number;         // seek start within video (seconds)
  videoEnd: number;           // seek end within video (seconds)
  globalStart: number;        // cumulative start in playlist timeline
  globalEnd: number;          // cumulative end in playlist timeline
  yaw: number;                // initial camera direction (degrees)
  level: number;              // floor number during this clip
  isExitClip: boolean;        // true for stairs/elevator exit phase
  edgeId: string;             // source graph edge ID
  coordStartIdx: number;      // route coordinate range start
  coordEndIdx: number;        // route coordinate range end
  routeDistStart: number;     // distance along route (meters)
  routeDistEnd: number;
  contiguous: boolean;        // same video + no time gap from previous clip
}

interface VideoSegment {
  videoFile: string;          // single video file for this segment
  videoStart: number;         // continuous play range start
  videoEnd: number;           // continuous play range end
  clipStartIdx: number;       // first clip index in segment
  clipEndIdx: number;         // last clip index in segment
  globalStart: number;
  globalEnd: number;
}

interface WalkthroughPlaylist {
  clips: WalkthroughClip[];
  segments: VideoSegment[];
  totalDuration: number;
  coordinates: GeoJSON.Position[];   // full route polyline
  levels: number[];                  // floor at each coordinate
  cumulativeDist: number[];          // distance along route (meters)
  videoStartCoordIdx: number;        // where video coverage begins
  videoEndCoordIdx: number;          // where video coverage ends
  segmentBoundaries: number[];       // normalized (0..1) clip boundaries for progress bar
}
```

### Double Buffering

Two `<video>` elements run in parallel to eliminate loading gaps:

1. **Active buffer**: Currently playing, mapped to Three.js SphereGeometry via VideoTexture
2. **Standby buffer**: Preloading next segment (video src set, seeked to start time)
3. On segment boundary: **instant swap** — pause active, swap references, create new texture, start preloading next
4. Fallback: if standby not ready, load directly on active buffer (async with timeout)

### Seek-Based High-Speed Playback

H.264 decoders stall at native `playbackRate` > 2x due to inter-frame dependencies. Solution:

- Rates ≤ 2x: use native `video.playbackRate`
- Rates > 2x: pause video, advance `currentTime` in render loop:
  ```
  targetTime = seekBaseVideo + (performance.now() - seekBaseReal) * rate / 1000
  video.currentTime = targetTime
  ```
- Supported rates: 0.5x, 1x, 2x, 5x, 10x

### Partial Edge Handling

When a route starts/ends in the middle of an edge (e.g., room door partway along a corridor):

1. Perpendicular foot projection finds the closest point on the edge
2. Ratio `t = distToA / (distToA + distToB)` determines position along edge
3. Clip time is interpolated: `clipStart = videoStart + t * (videoEnd - videoStart)`
4. Only the relevant portion of the video plays

### Contiguity Detection

Two consecutive clips are **contiguous** if:
- Same video file
- Time gap < 50ms (`TIME_EPSILON`)

Contiguous clips are grouped into a single `VideoSegment` — no buffer swap needed, the video plays through continuously.

---

## Walkthrough Overlay UI

### Layout
- Floating overlay window (480 x 340px default, draggable, resizable)
- Top: 360° video canvas (Three.js renderer)
- Bottom: control bar

### Controls
| Control | Action |
|---------|--------|
| Play/Pause | Toggle playback (spacebar shortcut) |
| Progress bar | Click to seek, drag thumb to scrub, segment boundary markers shown |
| Time label | Current / total time display |
| Speed selector | 0.5x / 1x / 2x / 5x / 10x |
| Follow toggle | Auto-pan map to current position |
| Fullscreen | Expand to viewport, map becomes minimap |

### Map Integration
- **Position indicator**: Orange circle at interpolated route position (updated via `getPositionAtTime()`)
- **Floor sync**: Dispatches `walkthroughLevelChange` event when crossing floor boundaries
- **Camera follow**: `map.easeTo()` centers on position with 300ms animation; disabled on user map interaction

---

## Example Route Playback

```
Route: Room 21301 → Staircase 2 → Room 22502

Edge 1: room exit      → corridor A         (no video — room exit)
Edge 2: corridor A     → corridor B         eng1_corridor_21_3F_cw.mp4  [12.5s ~ 28.0s]
Edge 3: corridor B     → stair 2 entrance   eng1_corridor_21_3F_cw.mp4  [28.0s ~ 35.2s]
  → Edges 2-3 are contiguous (same video, no gap) → grouped as one VideoSegment
Edge 4: stair entrance → stair exit 5F      eng1_stair_2_up.mp4         [24.0s ~ 48.0s]
  → Buffer swap: standby had stair video preloaded → instant transition
Edge 5: stair exit     → corridor C         eng1_corridor_22_5F_ccw.mp4 [0.0s ~ 15.0s]
  → Exit clip plays first (eng1_stair_2_up exit phase), then corridor begins
Edge 6: corridor C     → room 22502         eng1_corridor_22_5F_ccw.mp4 [15.0s ~ 22.3s]
  → Contiguous with Edge 5 → same segment, no swap
```

---

## Export Settings

### Step 1: Insta360 Studio

| Setting       | Value                          |
| ------------- | ------------------------------ |
| Format        | MP4                            |
| Codec         | H.264                          |
| Resolution    | 3840 x 1920                    |
| Bitrate       | Default (30-40 Mbps)           |
| Frame Rate    | Keep original (30fps)          |
| Stabilization | FlowState ON                   |
| Audio         | OFF                            |

### Step 2: Web Compression (FFmpeg)

```bash
ffmpeg -i input.mp4 -c:v libx264 -crf 23 -preset medium -an output.mp4
```

| Flag              | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `-c:v libx264`    | H.264 codec (universal browser support)                |
| `-crf 23`         | Quality/size balance (18=high, 28=low)                 |
| `-preset medium`  | Encoding speed (`slow` for better compression)         |
| `-an`             | Strip audio                                            |

Expected output: ~5-15 MB per corridor, ~20-40 MB per staircase.

### Why H.264?

Three.js VideoTexture uses the `<video>` element internally.
H.264 is the only codec with universal browser support (Chrome, Firefox, Safari, Edge).
H.265 has no Firefox/Chrome support without hardware flags.

---

## Source Files Reference

| File | Role |
|------|------|
| `editor/videoCatalog.ts` | 48-video catalog, smart suggestion ranking, opposite-direction lookup |
| `editor/videoSettings.ts` | Per-video yaw storage, load/save to `video_settings.json` |
| `editor/videoSettingsPanel.ts` | Bulk yaw assignment UI (grouped by type) |
| `editor/videoPreview.ts` | Three-mode 360° preview (yaw / time-range / split) |
| `editor/graphEditorPanel.ts` | Edge-video assignment UI (single + multi-edge) |
| `editor/graphEditor.ts` | Multi-edge chain ordering, split assignment logic |
| `components/walkthroughOverlay.ts` | Walkthrough UI (overlay, progress bar, map sync) |
| `components/walkthroughPlayer.ts` | Double-buffered 360° playback engine |
| `components/walkthroughTypes.ts` | Clip, Segment, Playlist type definitions |
| `services/walkthroughPlanner.ts` | Route → playlist conversion (partial edges, contiguity) |
| `public/geojson/video_settings.json` | Calibrated yaw values for all 48 videos |
