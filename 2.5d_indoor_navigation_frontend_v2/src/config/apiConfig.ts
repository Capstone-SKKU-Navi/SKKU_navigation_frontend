// ===== API base URL =====
//
// In development the bundle calls a relative `/api` so webpack-dev-server's
// proxy can forward to Spring Boot — this keeps everything same-origin for
// the browser, which matters when the page is loaded from a LAN IP (mobile
// testing) where the backend's CORS allowlist would otherwise reject it.
//
// In production the bundle hits the absolute backend URL (override via
// `window.__API_BASE__` for staging / different hosts).

declare global {
  interface Window {
    __API_BASE__?: string;
  }
}

// `process.env.*` is inlined at build time by webpack's DefinePlugin (NODE_ENV
// is auto-set from the `mode` config; API_BASE_URL is injected explicitly in
// webpack.config.js). The exact literal `process.env.X` is the only form that
// gets substituted — `typeof process`, optional chaining, etc. would survive
// into the bundle and crash in the browser (webpack 5 does not polyfill the
// `process` global).
declare const process: { env: { NODE_ENV?: string; API_BASE_URL?: string } };
const IS_DEV = process.env.NODE_ENV === 'development';

// Build-time API base URL. In dev: '/api' so webpack-dev-server proxy handles
// it. In prod: whatever was injected via the API_BASE_URL env var at build
// time (Vercel project setting). If unset, falls back to '/api' (relative)
// so a same-origin reverse proxy can still work — an empty literal would
// produce broken URLs like `/route?...`.
const BUILD_API_BASE = process.env.API_BASE_URL || '';
const DEFAULT_API_BASE = IS_DEV ? '/api' : (BUILD_API_BASE || '/api');

export function getApiBase(): string {
  const raw = (typeof window !== 'undefined' && window.__API_BASE__) || DEFAULT_API_BASE;
  // Strip any trailing slash so callers using `${base}/path` never produce `//`.
  return raw.replace(/\/+$/, '');
}
