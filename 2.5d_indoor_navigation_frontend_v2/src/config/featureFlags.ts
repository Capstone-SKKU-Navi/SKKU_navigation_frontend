// ===== Feature Flags =====
//
// Dev-toggleable behaviors. Flip values here (or via `window.__FLAGS__`) to
// experiment without touching call sites.

declare global {
  interface Window {
    __FLAGS__?: Partial<FeatureFlags>;
  }
}

export interface FeatureFlags {
  /**
   * When both endpoints are set (room or coord), automatically run findRoute
   * — no explicit "find" button click needed. Applies to room selections from
   *  autocomplete / popups / radial menu just like coord drag-drops.
   */
  autoFindRouteOnEndpointSet: boolean;
}

const DEFAULTS: FeatureFlags = {
  autoFindRouteOnEndpointSet: true,
};

export function getFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
  const override = (typeof window !== 'undefined' && window.__FLAGS__?.[key]);
  return (override ?? DEFAULTS[key]) as FeatureFlags[K];
}
