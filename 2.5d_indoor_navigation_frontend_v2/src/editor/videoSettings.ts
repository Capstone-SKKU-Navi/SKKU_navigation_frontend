// ===== Video Settings — per-video yaw stored globally =====
//
// Two read paths share this module:
//   1. Runtime walkthrough (main.ts → loadVideoSettings) reads the published
//      file at /geojson/video_settings.json. Never mutates.
//   2. Graph editor session reads the same published file at activate time,
//      then immediately overrides via hydrateFromSave() with whatever lives in
//      editor/save.json (the working file). All mutations during the session
//      go through setField → onMutated callback → graphEditorState autosaves
//      the whole save bundle to /api/save-editor-state. The combined
//      video_settings.json is rewritten only at publish time.

const SETTINGS_URL = '/geojson/video_settings.json';

export interface VideoYawEntry {
  yaw?: number;       // corridor: single viewing direction
  entryYaw?: number;  // stair/elevator: entering direction
  exitYaw?: number;   // stair/elevator: exiting direction
  updatedAt?: number; // epoch ms; bumped on every set. Drives import-time recency merge.
}

let settings: Record<string, VideoYawEntry> = {};
let onMutated: (() => void) | null = null;
let mutatedSuppressed = false;

/**
 * Editor wires this to its autosave-the-bundle pipeline. Runtime never sets
 * it, so non-editor callers see the existing fire-and-forget read behaviour.
 */
export function setOnMutated(cb: (() => void) | null): void {
  onMutated = cb;
}

/**
 * Pause notifications during a multi-step transaction (e.g. import) where
 * intermediate states would write a chimera bundle to disk. The caller must
 * pair this with `resumeMutated` and run its own save afterwards.
 */
export function suppressMutated(): void {
  mutatedSuppressed = true;
}

export function resumeMutated(): void {
  mutatedSuppressed = false;
}

function fireMutated(): void {
  if (!mutatedSuppressed) onMutated?.();
}

export async function loadVideoSettings(): Promise<void> {
  try {
    const res = await fetch(SETTINGS_URL);
    if (res.ok) settings = await res.json();
  } catch { /* file not found */ }
}

/**
 * Editor activation calls this with the videoSettings slice from the save
 * file, replacing whatever loadVideoSettings hydrated from the published file.
 * Skipped silently when the save bundle has no video data.
 */
export function hydrateFromSave(saved: Record<string, VideoYawEntry> | undefined | null): void {
  if (!saved) return;
  settings = { ...saved };
}

export function getEntry(filename: string): VideoYawEntry | undefined {
  return settings[filename];
}

export function setField(filename: string, field: keyof VideoYawEntry, value: number): void {
  if (!settings[filename]) settings[filename] = {};
  settings[filename][field] = value;
  settings[filename].updatedAt = Date.now();
  fireMutated();
}

export function getAllSettings(): Record<string, VideoYawEntry> {
  return { ...settings };
}

/**
 * Wholesale replace — used by the legacy "Import save" filesystem flow when
 * we want a clean overwrite rather than a merge. In-editor "Import save"
 * uses mergeFromImport instead so per-video tuning is preserved across both
 * collaborators.
 */
export function replaceAll(map: Record<string, VideoYawEntry>): void {
  settings = { ...map };
  fireMutated();
}

/**
 * Per-key recency merge. For each filename in `incoming`, the side with the
 * larger `updatedAt` wins. Local entries absent from `incoming` are kept
 * untouched — imports never delete local yaw values.
 */
export function mergeFromImport(incoming: Record<string, VideoYawEntry> | undefined | null): void {
  if (!incoming) return;
  for (const [filename, incEntry] of Object.entries(incoming)) {
    if (!incEntry) continue;
    const incTime = incEntry.updatedAt ?? -1;
    const local = settings[filename];
    const localTime = local?.updatedAt ?? -1;
    if (incTime > localTime) {
      settings[filename] = { ...incEntry };
    }
  }
  fireMutated();
}
