import type maplibregl from 'maplibre-gl';

export interface FeedbackScreenshotConfig {
  uploadUrl: string;
  token: string;
}

export interface FeedbackScreenshotPayload {
  reportId: string;
  issueType: string;
  target: string;
  debug: string;
  dataUrl: string;
}

declare const __FEEDBACK_SCREENSHOT_UPLOAD_URL__: string | undefined;
declare const __FEEDBACK_SCREENSHOT_TOKEN__: string | undefined;

declare global {
  interface Window {
    __FEEDBACK_SCREENSHOT_UPLOAD_URL__?: string;
    __FEEDBACK_SCREENSHOT_TOKEN__?: string;
  }
}

const DEFAULT_SCREENSHOT_UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbwkOjTmvO_0CEHmfSD82Arr9K4rc3TLSm8OQsfcNAT7ZGYRegc02BFANKf6rR1NUyoPOg/exec';
const DEFAULT_SCREENSHOT_TOKEN = 'skku-feedback-2026';

export function getFeedbackScreenshotConfig(): FeedbackScreenshotConfig {
  return {
    uploadUrl: (typeof window !== 'undefined' && window.__FEEDBACK_SCREENSHOT_UPLOAD_URL__)
      || getInjectedScreenshotString('__FEEDBACK_SCREENSHOT_UPLOAD_URL__')
      || DEFAULT_SCREENSHOT_UPLOAD_URL,
    token: (typeof window !== 'undefined' && window.__FEEDBACK_SCREENSHOT_TOKEN__)
      || getInjectedScreenshotString('__FEEDBACK_SCREENSHOT_TOKEN__')
      || DEFAULT_SCREENSHOT_TOKEN,
  };
}

export function captureMapCanvas(map: maplibregl.Map | null, quality = 0.72): string | null {
  const canvas = map?.getCanvas();
  if (!canvas) return null;
  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch (err) {
    console.warn('[Feedback] map screenshot capture failed:', err);
    return null;
  }
}

export function submitScreenshotUpload(config: FeedbackScreenshotConfig, payload: FeedbackScreenshotPayload): boolean {
  if (!config.uploadUrl || !payload.dataUrl) return false;

  const frameName = `feedback_upload_${payload.reportId}`;
  const iframe = document.createElement('iframe');
  iframe.name = frameName;
  iframe.style.display = 'none';

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = config.uploadUrl;
  form.target = frameName;
  form.enctype = 'application/x-www-form-urlencoded';
  form.style.display = 'none';

  const fields: Record<string, string> = {
    token: config.token,
    report_id: payload.reportId,
    issue_type: payload.issueType,
    target: payload.target,
    debug: payload.debug,
    screenshot_data_url: payload.dataUrl,
  };

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(iframe);
  document.body.appendChild(form);
  form.submit();
  window.setTimeout(() => {
    form.remove();
    iframe.remove();
  }, 10000);
  return true;
}

function getInjectedScreenshotString(name: string): string {
  switch (name) {
    case '__FEEDBACK_SCREENSHOT_UPLOAD_URL__':
      return typeof __FEEDBACK_SCREENSHOT_UPLOAD_URL__ !== 'undefined' ? __FEEDBACK_SCREENSHOT_UPLOAD_URL__ || '' : '';
    case '__FEEDBACK_SCREENSHOT_TOKEN__':
      return typeof __FEEDBACK_SCREENSHOT_TOKEN__ !== 'undefined' ? __FEEDBACK_SCREENSHOT_TOKEN__ || '' : '';
    default:
      return '';
  }
}
