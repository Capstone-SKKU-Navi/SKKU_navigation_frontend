// ===== Video Settings — per-video yaw stored globally =====
//
// Note: SAVE_URL is intentionally same-origin (the webpack dev server's
// setupMiddlewares writes to public/geojson/video_settings.json). It is NOT
// a backend Spring Boot endpoint and must not flow through getApiBase().

const SETTINGS_URL = '/geojson/video_settings.json';
const SAVE_URL = '/api/save-video-settings';

export interface VideoYawEntry {
  yaw?: number;       // corridor: single viewing direction
  entryYaw?: number;  // stair/elevator: entering direction
  exitYaw?: number;   // stair/elevator: exiting direction
}

let settings: Record<string, VideoYawEntry> = {};

export async function loadVideoSettings(): Promise<void> {
  try {
    const res = await fetch(SETTINGS_URL);
    if (res.ok) settings = await res.json();
  } catch { /* file not found */ }
}

export function getEntry(filename: string): VideoYawEntry | undefined {
  return settings[filename];
}

export function setField(filename: string, field: keyof VideoYawEntry, value: number): void {
  if (!settings[filename]) settings[filename] = {};
  settings[filename][field] = value;
  saveSettings();
}

export function getAllSettings(): Record<string, VideoYawEntry> {
  return { ...settings };
}

function saveSettings(): void {
  fetch(SAVE_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }).then(res => {
    if (!res.ok) console.warn('[VideoSettings] save failed:', res.status);
  }).catch(err => console.warn('[VideoSettings] save error:', err));
}
