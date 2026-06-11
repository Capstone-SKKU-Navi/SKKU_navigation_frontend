import * as BackendService from '../services/backendService';
import * as GeoMap from './geoMap';
import * as RouteActions from '../services/routeActions';
import * as WalkthroughOverlay from './walkthroughOverlay';
import {
  appendScreenshotDebug,
  buildFeedbackFormUrl,
  createFeedbackReportId,
  formatFeedbackLevel,
  formatPointFeedbackTarget,
  formatRoomFeedbackTarget,
  formatRouteEndpointFeedbackLabel,
  getFeedbackFormConfig,
  type FeedbackIssue,
  type RouteEndpointFeedbackTarget,
} from '../services/feedbackForm';
import {
  captureMapCanvas,
  getFeedbackScreenshotConfig,
  submitScreenshotUpload,
} from '../services/feedbackScreenshot';
import type { RouteEndpoint } from '../services/routeActions';

type ToastFn = (message: string) => void;

let activeMenu: HTMLElement | null = null;
let activePickCleanup: (() => void) | null = null;

export function setupFeedbackButton(btn: HTMLElement, toast: ToastFn = showInlineToast): void {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeMenu) {
      closeFeedbackMenu();
      return;
    }
    showFeedbackMenu(btn, toast);
  });
}

function showFeedbackMenu(anchor: HTMLElement, toast: ToastFn): void {
  closeFeedbackMenu();

  const menu = document.createElement('div');
  menu.className = 'feedback-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button type="button" data-feedback-kind="map"><span class="material-icons">pin_drop</span><span>방/지도 오류</span></button>
    <button type="button" data-feedback-kind="route"><span class="material-icons">alt_route</span><span>경로 오류</span></button>
    <button type="button" data-feedback-kind="video"><span class="material-icons">videocam</span><span>영상 오류</span></button>
    <button type="button" data-feedback-kind="other"><span class="material-icons">edit</span><span>기타</span></button>
  `;
  document.body.appendChild(menu);
  activeMenu = menu;

  positionMenu(menu, anchor);

  menu.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-feedback-kind]');
    if (!btn) return;
    const kind = btn.dataset.feedbackKind;
    closeFeedbackMenu();
    if (kind === 'map') startMapFeedbackPick(toast);
    else if (kind === 'route') openRouteFeedback(toast);
    else if (kind === 'video') openVideoFeedback(toast);
    else openGenericFeedback(toast);
  });

  window.setTimeout(() => {
    document.addEventListener('click', closeFeedbackMenu, { once: true });
  }, 0);
}

function positionMenu(menu: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const top = Math.min(window.innerHeight - menuRect.height - 12, rect.bottom + 8);
  const left = Math.min(window.innerWidth - menuRect.width - 12, Math.max(12, rect.right - menuRect.width));
  menu.style.top = `${Math.max(12, top)}px`;
  menu.style.left = `${left}px`;
}

function closeFeedbackMenu(): void {
  activeMenu?.remove();
  activeMenu = null;
}

function startMapFeedbackPick(toast: ToastFn): void {
  cancelActivePick();

  const map = GeoMap.getMap();
  if (!map) {
    toast('지도가 아직 준비되지 않았습니다');
    return;
  }

  let handled = false;
  const banner = showPickBanner();
  const canvas = map.getCanvas();
  canvas.classList.add('feedback-pick-cursor');

  const cleanup = () => {
    document.removeEventListener('roomClicked', onRoomClicked as EventListener, true);
    document.removeEventListener('keydown', onKeyDown);
    map.off('click', onMapClicked);
    canvas.classList.remove('feedback-pick-cursor');
    banner.remove();
    if (activePickCleanup === cleanup) activePickCleanup = null;
  };
  activePickCleanup = cleanup;

  const finish = (type: string, target: string, debug: string) => {
    if (handled) return;
    handled = true;
    cleanup();
    openFeedbackForm({ type, target, debug }, toast);
  };

  function onRoomClicked(e: CustomEvent): void {
    const detail = e.detail ?? {};
    if (!detail.ref) return;
    e.stopImmediatePropagation();

    const room = BackendService.getRoomList().find(r => r.ref === detail.ref);
    const target = formatRoomFeedbackTarget({
      building: room?.building,
      level: Number(detail.level ?? room?.level?.[0] ?? GeoMap.getCurrentLevel()),
      ref: detail.ref,
      name: room?.name || detail.name,
    });
    finish('방/지도 오류', target, buildDebugPayload([
      ['feedback_target', 'room'],
      ['building', room?.building],
      ['level', detail.level],
      ['room_ref', detail.ref],
      ['room_name', room?.name || detail.name],
    ]));
  }

  function onMapClicked(e: any): void {
    window.setTimeout(() => {
      if (handled) return;
      const lng = Number(e.lngLat.lng);
      const lat = Number(e.lngLat.lat);
      const building = BackendService.getBuildingForCoordinates([lng, lat]) ?? 'unknown';
      const level = GeoMap.getCurrentLevel();
      const target = formatPointFeedbackTarget({ building, level, lng, lat });
      finish('방/지도 오류', target, buildDebugPayload([
        ['feedback_target', 'map_point'],
        ['building', building],
        ['level', level],
        ['lng', lng.toFixed(8)],
        ['lat', lat.toFixed(8)],
      ]));
    }, 0);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') cleanup();
  }

  document.addEventListener('roomClicked', onRoomClicked as EventListener, true);
  document.addEventListener('keydown', onKeyDown);
  map.on('click', onMapClicked);
}

function openRouteFeedback(toast: ToastFn): void {
  const { start, end } = RouteActions.getEndpoints();
  const startLabel = formatRouteEndpointFeedbackLabel(toRouteFeedbackTarget(start));
  const endLabel = formatRouteEndpointFeedbackLabel(toRouteFeedbackTarget(end));
  const target = `출발 ${startLabel} -> 도착 ${endLabel}`;
  openFeedbackForm({
    type: '경로 오류',
    target,
    debug: buildDebugPayload([
      ['feedback_target', 'route'],
      ['start', JSON.stringify(start)],
      ['end', JSON.stringify(end)],
    ]),
  }, toast);
}

function toRouteFeedbackTarget(endpoint: RouteEndpoint | null): RouteEndpointFeedbackTarget {
  if (!endpoint) return null;
  if (endpoint.kind === 'coord') {
    return {
      kind: 'coord',
      building: BackendService.getBuildingForCoordinates([endpoint.lng, endpoint.lat]) ?? 'unknown',
      level: endpoint.level,
      lng: endpoint.lng,
      lat: endpoint.lat,
    };
  }

  const room = BackendService.getRoomList().find(r => r.ref === endpoint.ref);
  return {
    kind: 'room',
    building: room?.building,
    ref: endpoint.ref,
    name: room?.name,
  };
}

function openVideoFeedback(toast: ToastFn): void {
  const ctx = WalkthroughOverlay.getWalkthroughFeedbackContext();
  const target = ctx
    ? `${ctx.videoFile} / ${formatFeedbackLevel(ctx.level)} / ${ctx.videoStart.toFixed(1)}-${ctx.videoEnd.toFixed(1)}s`
    : '영상 화면 미선택';
  openFeedbackForm({
    type: '360도 영상 오류',
    target,
    debug: buildDebugPayload([
      ['feedback_target', 'walkthrough_video'],
      ['video_file', ctx?.videoFile],
      ['level', ctx?.level],
      ['edge_id', ctx?.edgeId],
      ['global_time', ctx?.globalTime?.toFixed(2)],
      ['video_range', ctx ? `${ctx.videoStart.toFixed(2)}-${ctx.videoEnd.toFixed(2)}` : undefined],
    ]),
  }, toast);
}

function openGenericFeedback(toast: ToastFn): void {
  openFeedbackForm({
    type: '기타 피드백',
    debug: buildDebugPayload([
      ['feedback_target', 'generic'],
      ['level', GeoMap.getCurrentLevel()],
    ]),
  }, toast);
}

function openFeedbackForm(issue: FeedbackIssue & { type: string }, toast: ToastFn): void {
  const issueWithScreenshot = attachScreenshot(issue);
  const url = buildFeedbackFormUrl(getFeedbackFormConfig(), issueWithScreenshot);
  if (!url) {
    toast('피드백 폼 링크가 아직 설정되지 않았습니다');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function attachScreenshot(issue: FeedbackIssue & { type: string }): FeedbackIssue & { type: string } {
  const reportId = createFeedbackReportId();
  const screenshotConfig = getFeedbackScreenshotConfig();
  let status: 'queued' | 'disabled' | 'capture_failed' | 'upload_failed' = 'disabled';

  if (screenshotConfig.uploadUrl) {
    const dataUrl = captureMapCanvas(GeoMap.getMap());
    if (dataUrl) {
      const queued = submitScreenshotUpload(screenshotConfig, {
        reportId,
        issueType: issue.type,
        target: issue.target ?? '',
        debug: issue.debug ?? '',
        dataUrl,
      });
      status = queued ? 'queued' : 'upload_failed';
    } else {
      status = 'capture_failed';
    }
  }

  return {
    ...issue,
    screenshotReportId: reportId,
    debug: appendScreenshotDebug(issue.debug ?? '', { reportId, status }),
  };
}

function showPickBanner(): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'feedback-pick-banner';
  banner.setAttribute('role', 'status');
  banner.innerHTML = `
    <span class="material-icons">pin_drop</span>
    <span>문제가 있는 방이나 위치를 지도에서 눌러주세요</span>
  `;
  document.body.appendChild(banner);
  return banner;
}

function cancelActivePick(): void {
  activePickCleanup?.();
  activePickCleanup = null;
}

function buildDebugPayload(extra: Array<[string, unknown]>): string {
  const rows: Array<[string, unknown]> = [
    ['time', new Date().toISOString()],
    ['url', window.location.href],
    ['user_agent', navigator.userAgent],
    ['screen', `${window.innerWidth}x${window.innerHeight}`],
    ['mode', GeoMap.isFlatMode() ? '2D' : '3D'],
    ...extra,
  ];
  return rows
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n');
}

function showInlineToast(message: string): void {
  const prev = document.querySelector('.feedback-toast');
  prev?.remove();

  const toast = document.createElement('div');
  toast.className = 'feedback-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2400);
}
