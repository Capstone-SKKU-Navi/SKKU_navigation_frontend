# HTTP Range-Based Video Serving — Backend API Decision

## TL;DR

The Java backend should serve walkthrough videos via a plain MP4 endpoint with HTTP Range support (RFC 7233), not a CDN redirect, not HLS, not DASH. The frontend player is already built on this assumption. Implementation on Spring Boot is a handful of lines; the frontend needs **zero** changes beyond pointing `videoBase` at the new URL.

## Why this came up

The current frontend loads videos from a static `/videos/{filename}` path ([backendService.ts:39](../2.5d_indoor_navigation_frontend_v2/src/services/backendService.ts#L39)) served by `webpack-dev-server`. The backend plan (2026-04-03 meeting) is to serve videos from `GET /api/videos/{filename}`. Question: what's the standard way for a Java backend to deliver video, and does the frontend need to change?

## What the frontend actually needs

The walkthrough player ([walkthroughPlayer.ts](../2.5d_indoor_navigation_frontend_v2/src/components/walkthroughPlayer.ts)) is a double-buffered 360° segment player built around the `<video>` element and Three.js `VideoTexture`. It assumes the server behaves like a seekable file.

Key behaviors that force the server's hand:

| Frontend behavior | Server requirement |
|---|---|
| `video.currentTime = seg.videoStart` right after `video.src = url` (player.ts:178, 283) | `206 Partial Content` on `Range: bytes=N-` |
| Double-buffer: one file playing, another preloading (player.ts:73-78, 168-185) | ≥2 concurrent connections per client; cheap partial reads |
| Seek-mode fast-forward at >2× — sets `currentTime` each frame (player.ts:348-361) | Cheap small Range requests |
| `video.crossOrigin = 'anonymous'` for `VideoTexture` (player.ts:539) | CORS headers including `Access-Control-Expose-Headers` |
| Sub-second first-frame when seeking into a long clip | MP4 with `moov` atom at the front (`-movflags +faststart`) |

There is **no `hls.js`, no `MediaSource`, no `.m3u8` parsing** anywhere. The pipeline is MP4-only.

## Misconception check: is Range "already implemented"?

Partly — and only by accident.

- **Frontend:** No explicit Range code exists, and none is needed. The `<video>` element issues Range requests itself when `currentTime` is set. That is a browser feature, not application code.
- **Local dev:** `webpack-dev-server` serves static files through `send` / `serve-static`, which handle Range by default. So every local test already exercises the Range code path — you just never had to write or configure it.
- **Java backend:** Not implemented yet. The `/api/videos/{filename}` endpoint from the API v2 design is still a TODO on the backend side.

You can confirm the local behavior right now in DevTools → Network → any `.mp4`:

- Request header: `Range: bytes=0-`
- Response status: `206 Partial Content`
- Response header: `Content-Range: bytes 0-…/N`

If you see those, Range is working. Any backend that produces the same responses is a drop-in replacement.

## The options surveyed

### 1. HTTP Byte-Range Streaming (RFC 7233) — recommended

Plain MP4 over HTTP. Browser sends `Range: bytes=…`, server replies `206 Partial Content` with `Content-Range`. This is the universal baseline for `<video>`.

**Pros:** Zero frontend changes. Trivial Spring implementation. Cacheable. No extra encoding step beyond `+faststart`.

**Cons:** No adaptive bitrate — one quality per file. Fine for LAN/campus demo.

### 2. HLS (HTTP Live Streaming)

`.m3u8` playlist + 2–10s `.ts`/`.m4s` segments. Client switches bitrates mid-stream.

**Pros:** Adaptive bitrate, CDN-friendly, clean on slow mobile networks.

**Cons:** Requires `hls.js` on non-Safari, requires ffmpeg pre-segmentation, and **would force a rewrite of the current player** — segment grouping and seek-into-file logic become a different problem under MediaSource.

### 3. MPEG-DASH

ISO-standard equivalent of HLS with `.mpd` manifests. Same pros/cons. Worth considering only if DRM (Widevine/PlayReady) is required. Not our case.

### 4. Pre-signed URL redirect (CDN / S3)

Backend returns a short-lived signed URL to object storage; client fetches directly.

**Pros:** Offloads bandwidth from the app server.

**Cons:** Requires cloud object storage + signing infra. Overkill for a capstone on an on-prem VM.

### 5. WebRTC / RTSP / RTMP

Real-time/live streaming. Not applicable — our clips are pre-recorded.

## Decision

**Option 1.** HTTP Range over MP4 via Spring Boot.

## Implementation

### Spring controller

```java
@RestController
@RequestMapping("/api/videos")
public class VideoController {

  private final Path videoRoot = Paths.get("/data/videos");

  @GetMapping("/{filename:.+\\.mp4}")
  public ResponseEntity<ResourceRegion> video(
      @PathVariable String filename,
      @RequestHeader HttpHeaders headers) throws IOException {

    Resource video = new FileSystemResource(videoRoot.resolve(filename));
    if (!video.exists()) return ResponseEntity.notFound().build();

    long length = video.contentLength();
    List<HttpRange> ranges = headers.getRange();
    ResourceRegion region = ranges.isEmpty()
        ? new ResourceRegion(video, 0, Math.min(1 << 20, length))
        : ranges.get(0).toResourceRegion(video);

    return ResponseEntity
        .status(ranges.isEmpty() ? HttpStatus.OK : HttpStatus.PARTIAL_CONTENT)
        .contentType(MediaType.valueOf("video/mp4"))
        .header(HttpHeaders.ACCEPT_RANGES, "bytes")
        .header(HttpHeaders.CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(region);
  }
}
```

Alternative: just configure Spring's static resource handler pointing at the video directory — it supports Range automatically via `ResourceHttpRequestHandler`. Same behavior, no controller needed.

### CORS

Frontend uses `video.crossOrigin = 'anonymous'` so `VideoTexture` can upload frames to WebGL. The backend must:

- Allow the frontend origin (`http://localhost:8082`, `http://localhost:3000`, deploy domain).
- Expose Range-related headers so the browser can read them:
  `Access-Control-Expose-Headers: Accept-Ranges, Content-Range, Content-Length`

### MP4 encoding

Re-mux every video with:

```
ffmpeg -i input.mp4 -c copy -movflags +faststart output.mp4
```

Without `+faststart`, the `moov` atom sits at the end of the file. The browser then has to download the whole tail before the first seek completes, defeating Range. `-c copy` avoids re-encoding — it just moves the atom.

### Response headers checklist

On a `Range: bytes=0-` request to the Spring endpoint, the response must look like:

```
HTTP/1.1 206 Partial Content
Content-Type: video/mp4
Accept-Ranges: bytes
Content-Range: bytes 0-1048575/52428800
Content-Length: 1048576
Access-Control-Allow-Origin: <frontend origin>
Access-Control-Expose-Headers: Accept-Ranges, Content-Range, Content-Length
Cache-Control: public, max-age=31536000, immutable
```

Do **not** gzip `video/mp4`.

### Verification

```
curl -I -H "Range: bytes=0-1023" http://localhost:8080/api/videos/sample.mp4
```

Expect `HTTP/1.1 206 Partial Content` and the headers above. If you see `200 OK` instead, Range is broken and every seek will download the whole file.

## Frontend changes

Exactly one line when the backend is ready:

```ts
// src/services/backendService.ts
setVideoBase('http://backend.example.com/api/videos');
```

No player changes, no preload changes, no Three.js changes.

## When to revisit

Switch to HLS only if:

- A single MP4 grows past ~100 MB AND mobile users on 4G see ≥5s first-frame latency, or
- You need adaptive bitrate for wildly varying network conditions.

For the current capstone scope (campus LAN, pre-recorded per-corridor clips, short duration), Option 1 is the right call.

## References

- RFC 7233 — HTTP Range Requests
- Spring `ResourceRegion` / `HttpRange` — `org.springframework.http`
- ffmpeg `-movflags +faststart`
- [walkthroughPlayer.ts](../2.5d_indoor_navigation_frontend_v2/src/components/walkthroughPlayer.ts) — the player that assumes this server contract
- [backendService.ts:49](../2.5d_indoor_navigation_frontend_v2/src/services/backendService.ts#L49) — `getVideoUrl` / `setVideoBase`
