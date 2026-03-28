// ===== Walkthrough Video Overlay — Shared Types =====

export interface WalkthroughClip {
  index: number;
  videoFile: string;        // e.g. "eng1_corridor_21_1F_cw.mp4"
  videoStart: number;       // seek start (seconds within video file)
  videoEnd: number;         // seek end
  duration: number;         // videoEnd - videoStart
  globalStart: number;      // cumulative start in total walkthrough timeline
  globalEnd: number;        // cumulative end
  yaw: number;              // initial viewing direction (degrees)
  level: number;            // floor level during this clip
  isExitClip: boolean;      // stairs/elevator exit clip
  edgeId: string;           // source edge ID
  /** Route coordinate index range this clip covers */
  coordStartIdx: number;
  coordEndIdx: number;
  /** Route distance range */
  routeDistStart: number;
  routeDistEnd: number;
  /** Can continue from previous clip without seeking (same video, contiguous time) */
  contiguous: boolean;
}

export interface VideoSegment {
  index: number;
  videoFile: string;
  videoStart: number;    // first clip's videoStart
  videoEnd: number;      // last clip's videoEnd
  clipStartIdx: number;  // first clip index (inclusive)
  clipEndIdx: number;    // last clip index (inclusive)
  globalStart: number;
  globalEnd: number;
}

export interface WalkthroughPlaylist {
  clips: WalkthroughClip[];
  segments: VideoSegment[];
  totalDuration: number;
  coordinates: GeoJSON.Position[];
  levels: number[];
  /** Cumulative distance from start, parallel to coordinates */
  cumulativeDist: number[];
  /** First coord index with video (perpendicular foot) */
  videoStartCoordIdx: number;
  /** Last coord index with video (perpendicular foot) */
  videoEndCoordIdx: number;
  /** 0..1 normalized clip boundary positions for progress bar markers */
  segmentBoundaries: number[];
}

export interface WalkthroughConfig {
  /** Auto-pan map to follow the orange position circle */
  cameraFollow: boolean;
  /** Initial overlay width (px) */
  overlayWidth: number;
  /** Initial overlay height (px) */
  overlayHeight: number;
}

export const DEFAULT_WALKTHROUGH_CONFIG: WalkthroughConfig = {
  cameraFollow: true,
  overlayWidth: 480,
  overlayHeight: 340,
};
