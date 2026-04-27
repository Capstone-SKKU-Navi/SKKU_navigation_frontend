/**
 * Mobile floating action cluster — recenter, 3D toggle, clear route.
 *
 * The clear-route button only appears while a route is active. Tapping it
 * clears the route, walkthrough, and all preview markers in one shot.
 */

import { MOBILE_IDS } from './mobileChrome';
import * as GeoMap from '../components/geoMap';
import * as RouteActions from '../services/routeActions';

export function initMobileActions(): void {
  const center = document.getElementById(MOBILE_IDS.actCenter);
  const toggle3D = document.getElementById(MOBILE_IDS.act3D);
  const clear = document.getElementById(MOBILE_IDS.actClear);

  center?.addEventListener('click', () => {
    GeoMap.centerMapToBuilding();
  });

  toggle3D?.addEventListener('click', () => {
    GeoMap.toggle3D();
    const is3D = !GeoMap.isFlatMode();
    toggle3D.classList.toggle('active', is3D);
    const icon = toggle3D.querySelector('.material-icons');
    if (icon) icon.textContent = is3D ? 'map' : '3d_rotation';
  });

  clear?.addEventListener('click', () => {
    RouteActions.clearRoute();
  });

  // Toggle visibility of the clear-route button in response to route state.
  document.addEventListener('routeFound', () => {
    clear?.setAttribute('data-visible', 'true');
  });
  document.addEventListener('routeCleared', () => {
    clear?.setAttribute('data-visible', 'false');
  });
  // If endpoints were cleared (e.g. both inputs blank), hide the button too.
  document.addEventListener('routeEndpointChanged', () => {
    const { start, end } = RouteActions.getEndpoints();
    if (!start && !end) {
      clear?.setAttribute('data-visible', 'false');
    }
  });
}
