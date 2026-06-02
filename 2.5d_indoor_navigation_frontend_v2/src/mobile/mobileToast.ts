/**
 * Mobile top-of-screen warning toast.
 *
 * Currently surfaces `routeNotFound` events from `services/routeActions` —
 * before, mobile path-find failures were silent. Renders a brief banner
 * under the safe-area top inset and auto-hides.
 */

import { MOBILE_IDS } from './mobileChrome';

const VISIBLE_MS = 2400;

export function initMobileToast(): void {
  const toast = document.getElementById(MOBILE_IDS.toast);
  if (!toast) return;
  const text = toast.querySelector<HTMLElement>('.m-toast-text');
  if (!text) return;

  let hideTimer: number | null = null;

  const show = (message: string): void => {
    text.textContent = message;
    toast.setAttribute('data-visible', 'true');
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      toast.setAttribute('data-visible', 'false');
      hideTimer = null;
    }, VISIBLE_MS);
  };

  document.addEventListener('routeNotFound', (e: Event) => {
    const detail = (e as CustomEvent<{ message?: string }>).detail;
    show(detail?.message ?? '경로를 찾을 수 없습니다');
  });
  // Generic toast channel (e.g. share confirmation).
  document.addEventListener('mToast', (e: Event) => {
    const detail = (e as CustomEvent<{ message?: string }>).detail;
    if (detail?.message) show(detail.message);
  });
  // A successful route supersedes any pending warning.
  document.addEventListener('routeFound', () => {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    toast.setAttribute('data-visible', 'false');
  });
}
