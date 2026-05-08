declare module '*.scss';
declare module '*.css';
declare module '*.json';

// deck.gl module declarations
declare module '@deck.gl/mapbox' {
  import type { Map, IControl } from 'maplibre-gl';

  interface MapboxOverlayProps {
    interleaved?: boolean;
    layers?: any[];
  }

  export class MapboxOverlay {
    constructor(props: MapboxOverlayProps);
    setProps(props: Partial<MapboxOverlayProps>): void;
    props: MapboxOverlayProps;
    onAdd(map: Map): HTMLDivElement;
    onRemove(): void;
    getDefaultPosition(): string;
  }
}

declare module '@deck.gl/layers' {
  export class PathLayer<D = any> {
    constructor(props: any);
    id: string;
  }

  export class ScatterplotLayer<D = any> {
    constructor(props: any);
    id: string;
  }

  export class GeoJsonLayer<D = any> {
    constructor(props: any);
    id: string;
  }
}

declare module '@deck.gl/core' {
  export class Deck {
    constructor(props: any);
  }

  export class WebMercatorViewport {
    constructor(props: {
      longitude?: number;
      latitude?: number;
      zoom?: number;
      pitch?: number;
      bearing?: number;
      width?: number;
      height?: number;
      altitude?: number;
      fovy?: number;
    });
    project(xyz: number[], opts?: { topLeft?: boolean }): number[];
    unproject(xyz: number[], opts?: { topLeft?: boolean; targetZ?: number }): number[];
  }
}
