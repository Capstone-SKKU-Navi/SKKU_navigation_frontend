export type FeedbackEntryKey = 'type' | 'target' | 'debug' | 'screenshotReportId';

export interface FeedbackFormConfig {
  formUrl: string;
  entries: Partial<Record<FeedbackEntryKey, string>>;
}

export interface FeedbackIssue {
  type?: string;
  target?: string;
  debug?: string;
  screenshotReportId?: string;
}

export interface FeedbackScreenshotStatus {
  reportId: string;
  status: 'queued' | 'disabled' | 'capture_failed' | 'upload_failed';
}

export interface RoomFeedbackTarget {
  building?: string;
  level: number;
  ref: string;
  name?: string;
}

export interface PointFeedbackTarget {
  building?: string;
  level: number;
  lng: number;
  lat: number;
}

export type RouteEndpointFeedbackTarget =
  | { kind: 'room'; building?: string; ref: string; name?: string }
  | { kind: 'coord'; building?: string; level: number; lng: number; lat: number }
  | null;

declare const __FEEDBACK_FORM_URL__: string | undefined;
declare const __FEEDBACK_ENTRY_TYPE__: string | undefined;
declare const __FEEDBACK_ENTRY_TARGET__: string | undefined;
declare const __FEEDBACK_ENTRY_DEBUG__: string | undefined;
declare const __FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID__: string | undefined;

declare global {
  interface Window {
    __FEEDBACK_FORM_URL__?: string;
  }
}

const DEFAULT_FEEDBACK_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfZmbjBazwcqqBCN88k5Gt9NO_NBOSaToD1s7lU3hNkRd4WRQ/viewform';
const DEFAULT_FEEDBACK_ENTRY_TYPE = 'entry.535998606';
const DEFAULT_FEEDBACK_ENTRY_TARGET = 'entry.307290085';
const DEFAULT_FEEDBACK_ENTRY_DEBUG = 'entry.1498754538';
const DEFAULT_FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID = 'entry.2038317800';

export function getFeedbackFormConfig(): FeedbackFormConfig {
  return {
    formUrl: (typeof window !== 'undefined' && window.__FEEDBACK_FORM_URL__)
      || getInjectedString('__FEEDBACK_FORM_URL__')
      || DEFAULT_FEEDBACK_FORM_URL,
    entries: {
      type: getInjectedString('__FEEDBACK_ENTRY_TYPE__') || DEFAULT_FEEDBACK_ENTRY_TYPE,
      target: getInjectedString('__FEEDBACK_ENTRY_TARGET__') || DEFAULT_FEEDBACK_ENTRY_TARGET,
      debug: getInjectedString('__FEEDBACK_ENTRY_DEBUG__') || DEFAULT_FEEDBACK_ENTRY_DEBUG,
      screenshotReportId: getInjectedString('__FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID__') || DEFAULT_FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID,
    },
  };
}

export function buildFeedbackFormUrl(config: FeedbackFormConfig, issue: FeedbackIssue): string | null {
  const formUrl = config.formUrl.trim();
  if (!formUrl) return null;

  const url = new URL(formUrl);
  appendEntry(url, config.entries.type, issue.type);
  appendEntry(url, config.entries.target, issue.target);
  appendEntry(url, config.entries.debug, issue.debug);
  appendEntry(url, config.entries.screenshotReportId, issue.screenshotReportId);
  return url.toString();
}

export function formatRoomFeedbackTarget(target: RoomFeedbackTarget): string {
  const building = target.building || 'unknown';
  const name = target.name ? ` (${target.name})` : '';
  return `${building} / ${formatFeedbackLevel(target.level)} / ${target.ref}${name}`;
}

export function formatPointFeedbackTarget(target: PointFeedbackTarget): string {
  const building = target.building || 'unknown';
  return `${building} / ${formatFeedbackLevel(target.level)} / ${target.lng.toFixed(6)}, ${target.lat.toFixed(6)}`;
}

export function formatRouteEndpointFeedbackLabel(target: RouteEndpointFeedbackTarget): string {
  if (!target) return '미선택';
  if (target.kind === 'room') {
    const building = target.building ? `${target.building} / ` : '';
    const name = target.name ? ` (${target.name})` : '';
    return `${building}${target.ref}${name}`;
  }
  return formatPointFeedbackTarget(target);
}

export function formatFeedbackLevel(level: number): string {
  return level < 0 ? `B${Math.abs(level)}` : `${level}F`;
}

export function createFeedbackReportId(now = new Date(), random = Math.random): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  const suffix = Math.floor(random() * 2176782336).toString(36).padStart(6, '0').slice(0, 6);
  return `fb_${stamp}_${suffix}`;
}

export function appendScreenshotDebug(debug: string, screenshot: FeedbackScreenshotStatus): string {
  const extra = [
    `screenshot_report_id: ${screenshot.reportId}`,
    `screenshot_status: ${screenshot.status}`,
  ].join('\n');
  return debug ? `${debug}\n${extra}` : extra;
}

function appendEntry(url: URL, entryId: string | undefined, value: string | undefined): void {
  if (!entryId || !value) return;
  url.searchParams.set(entryId, value);
}

function getInjectedString(name: string): string {
  switch (name) {
    case '__FEEDBACK_FORM_URL__':
      return typeof __FEEDBACK_FORM_URL__ !== 'undefined' ? __FEEDBACK_FORM_URL__ || '' : '';
    case '__FEEDBACK_ENTRY_TYPE__':
      return typeof __FEEDBACK_ENTRY_TYPE__ !== 'undefined' ? __FEEDBACK_ENTRY_TYPE__ || '' : '';
    case '__FEEDBACK_ENTRY_TARGET__':
      return typeof __FEEDBACK_ENTRY_TARGET__ !== 'undefined' ? __FEEDBACK_ENTRY_TARGET__ || '' : '';
    case '__FEEDBACK_ENTRY_DEBUG__':
      return typeof __FEEDBACK_ENTRY_DEBUG__ !== 'undefined' ? __FEEDBACK_ENTRY_DEBUG__ || '' : '';
    case '__FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID__':
      return typeof __FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID__ !== 'undefined' ? __FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID__ || '' : '';
    default:
      return '';
  }
}
