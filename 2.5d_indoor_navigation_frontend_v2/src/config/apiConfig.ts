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

// `process.env.NODE_ENV` is inlined at build time by webpack's DefinePlugin
// (auto-set from the `mode` config). The exact literal `process.env.NODE_ENV`
// is the only form that gets substituted — `typeof process`, optional
// chaining, etc. would survive into the bundle and crash in the browser
// (webpack 5 does not polyfill the `process` global).
declare const process: { env: { NODE_ENV?: string } };
const IS_DEV = process.env.NODE_ENV === 'development';

const DEFAULT_API_BASE = IS_DEV ? '/api' : 'http://localhost:8080/api';

export function getApiBase(): string {
  const raw = (typeof window !== 'undefined' && window.__API_BASE__) || DEFAULT_API_BASE;
  // Strip any trailing slash so callers using `${base}/path` never produce `//`.
  return raw.replace(/\/+$/, '');
}
