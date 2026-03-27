// ===== Navigation Graph Editor — Map Rendering =====

import maplibregl from 'maplibre-gl';
import { NavNode, NavEdge, EditorMapCallbacks, NODE_COLORS, NavNodeType } from './graphEditorTypes';

const PREFIX = 'graph-editor';

// Source IDs
const SRC_NODES = `${PREFIX}-nodes`;
const SRC_EDGES = `${PREFIX}-edges`;

// Layer IDs
const LYR_EDGES_LINE = `${PREFIX}-edges-line`;
const LYR_EDGES_CROSS = `${PREFIX}-edges-cross`;
const LYR_NODES_CIRCLE = `${PREFIX}-nodes-circle`;
const LYR_NODES_SELECTED = `${PREFIX}-nodes-selected`;
const LYR_NODES_LABELS = `${PREFIX}-nodes-labels`;
const LYR_EDGE_START = `${PREFIX}-edge-start`;

// ===== Init / Destroy =====

export function initEditorLayers(map: maplibregl.Map): void {
  // Empty GeoJSON sources
  const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

  map.addSource(SRC_NODES, { type: 'geojson', data: emptyFC });
  map.addSource(SRC_EDGES, { type: 'geojson', data: emptyFC });

  // Edge lines — same floor (solid)
  map.addLayer({
    id: LYR_EDGES_LINE,
    type: 'line',
    source: SRC_EDGES,
    filter: ['==', ['get', 'crossFloor'], false],
    paint: {
      'line-color': '#42A5F5',
      'line-width': 3,
      'line-opacity': 0.85,
    },
  });

  // Edge lines — cross floor (dashed)
  map.addLayer({
    id: LYR_EDGES_CROSS,
    type: 'line',
    source: SRC_EDGES,
    filter: ['==', ['get', 'crossFloor'], true],
    paint: {
      'line-color': '#FF8A65',
      'line-width': 3,
      'line-opacity': 0.75,
      'line-dasharray': [4, 3],
    },
  });

  // Node circles
  map.addLayer({
    id: LYR_NODES_CIRCLE,
    type: 'circle',
    source: SRC_NODES,
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'edgeStart'], true], 10,
        7,
      ],
      'circle-color': buildNodeColorExpression(),
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.9,
    },
  });

  // Selected node highlight ring
  map.addLayer({
    id: LYR_NODES_SELECTED,
    type: 'circle',
    source: SRC_NODES,
    filter: ['==', ['get', 'selected'], true],
    paint: {
      'circle-radius': 12,
      'circle-color': 'transparent',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#FFD600',
      'circle-opacity': 1,
    },
  });

  // Edge-start pulsing indicator (larger faint ring)
  map.addLayer({
    id: LYR_EDGE_START,
    type: 'circle',
    source: SRC_NODES,
    filter: ['==', ['get', 'edgeStart'], true],
    paint: {
      'circle-radius': 16,
      'circle-color': 'transparent',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FF6F03',
      'circle-opacity': 0.6,
    },
  });

  // Node labels
  map.addLayer({
    id: LYR_NODES_LABELS,
    type: 'symbol',
    source: SRC_NODES,
    layout: {
      'text-field': ['get', 'displayLabel'],
      'text-size': 11,
      'text-font': ['Noto Sans Regular'],
      'text-offset': [0, -1.5],
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': 'rgba(0,0,0,0.7)',
      'text-halo-width': 1,
    },
  });
}

export function destroyEditorLayers(map: maplibregl.Map): void {
  const layers = [LYR_NODES_LABELS, LYR_EDGE_START, LYR_NODES_SELECTED, LYR_NODES_CIRCLE, LYR_EDGES_CROSS, LYR_EDGES_LINE];
  for (const id of layers) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SRC_EDGES)) map.removeSource(SRC_EDGES);
  if (map.getSource(SRC_NODES)) map.removeSource(SRC_NODES);
}

// ===== Update Data =====

export function updateNodeLayer(
  map: maplibregl.Map,
  nodes: NavNode[],
  selectedId: string | null,
  edgeStartId: string | null,
): void {
  const source = map.getSource(SRC_NODES) as maplibregl.GeoJSONSource;
  if (!source) return;

  const features: GeoJSON.Feature[] = nodes.map(node => ({
    type: 'Feature',
    properties: {
      id: node.id,
      nodeType: node.type,
      level: node.level,
      building: node.building,
      label: node.label,
      displayLabel: node.label || node.type,
      selected: node.id === selectedId,
      edgeStart: node.id === edgeStartId,
    },
    geometry: {
      type: 'Point',
      coordinates: node.coordinates,
    },
  }));

  source.setData({ type: 'FeatureCollection', features });
}

export function updateEdgeLayer(
  map: maplibregl.Map,
  edgeData: { edge: NavEdge; fromNode: NavNode; toNode: NavNode }[],
  currentLevel: number,
): void {
  const source = map.getSource(SRC_EDGES) as maplibregl.GeoJSONSource;
  if (!source) return;

  const features: GeoJSON.Feature[] = edgeData.map(({ edge, fromNode, toNode }) => {
    const crossFloor = fromNode.level !== toNode.level;

    let coords: number[][];
    if (crossFloor) {
      const onLevel = fromNode.level === currentLevel ? fromNode : toNode;
      const offLevel = fromNode.level === currentLevel ? toNode : fromNode;
      coords = buildArcCoords(onLevel.coordinates, offLevel.coordinates);
    } else {
      coords = [fromNode.coordinates, toNode.coordinates];
    }

    return {
      type: 'Feature',
      properties: {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        weight: edge.weight,
        crossFloor,
        targetLevel: crossFloor
          ? (fromNode.level === currentLevel ? toNode.level : fromNode.level)
          : null,
      },
      geometry: {
        type: 'LineString',
        coordinates: coords,
      },
    };
  });

  source.setData({ type: 'FeatureCollection', features });
}

// ===== Click Handlers =====

let mapClickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
let nodeClickHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;

export function setClickHandlers(map: maplibregl.Map, callbacks: EditorMapCallbacks): void {
  removeClickHandlers(map);

  nodeClickHandler = (e: maplibregl.MapMouseEvent) => {
    e.originalEvent.stopPropagation();
    const features = map.queryRenderedFeatures(e.point, { layers: [LYR_NODES_CIRCLE] });
    if (features.length > 0) {
      const nodeId = features[0].properties?.id;
      if (nodeId) {
        callbacks.onNodeClick(nodeId);
        return;
      }
    }
  };

  mapClickHandler = (e: maplibregl.MapMouseEvent) => {
    // Check if a node was clicked first
    const features = map.queryRenderedFeatures(e.point, { layers: [LYR_NODES_CIRCLE] });
    if (features.length > 0) {
      const nodeId = features[0].properties?.id;
      if (nodeId) {
        callbacks.onNodeClick(nodeId);
        return;
      }
    }

    // Check if an edge was clicked
    const edgeFeatures = map.queryRenderedFeatures(e.point, { layers: [LYR_EDGES_LINE, LYR_EDGES_CROSS] });
    if (edgeFeatures.length > 0) {
      const edgeId = edgeFeatures[0].properties?.id;
      if (edgeId) {
        callbacks.onEdgeClick(edgeId);
        return;
      }
    }

    // Map click (no feature hit)
    callbacks.onMapClick([e.lngLat.lng, e.lngLat.lat]);
  };

  map.on('click', mapClickHandler);

  // Cursor changes
  map.on('mouseenter', LYR_NODES_CIRCLE, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', LYR_NODES_CIRCLE, () => {
    map.getCanvas().style.cursor = '';
  });
}

export function removeClickHandlers(map: maplibregl.Map): void {
  if (mapClickHandler) {
    map.off('click', mapClickHandler);
    mapClickHandler = null;
  }
  if (nodeClickHandler) {
    nodeClickHandler = null;
  }
  map.getCanvas().style.cursor = '';
}

// ===== Helpers =====

const ARC_SEGMENTS = 24;
const ARC_BULGE_METERS = 15; // perpendicular offset in meters

/**
 * Build a curved arc between two coordinates for cross-floor edges.
 * Uses a quadratic bezier with the control point offset perpendicular
 * to the midpoint. When endpoints are identical or very close, creates
 * a visible loop so the edge is never invisible.
 */
function buildArcCoords(a: number[], b: number[]): number[][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dist = Math.sqrt(dx * dx + dy * dy);

  // ~1 meter in degrees at mid-latitudes
  const meterInDeg = 1 / 111_320;
  const bulge = ARC_BULGE_METERS * meterInDeg;

  let cx: number, cy: number;
  if (dist < meterInDeg * 0.5) {
    // Endpoints overlap — make a visible loop (offset both control points)
    cx = a[0] + bulge;
    cy = a[1] + bulge * 0.6;
    // Return a loop: out to control, back to start
    const pts: number[][] = [];
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const t = i / ARC_SEGMENTS;
      const angle = t * Math.PI * 2;
      pts.push([
        a[0] + Math.cos(angle) * bulge * 0.5,
        a[1] + Math.sin(angle) * bulge * 0.5,
      ]);
    }
    return pts;
  }

  // Normal arc: control point perpendicular to midpoint
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  // Perpendicular unit vector
  const nx = -dy / dist;
  const ny = dx / dist;
  cx = mx + nx * bulge;
  cy = my + ny * bulge;

  // Quadratic bezier: P(t) = (1-t)²·A + 2(1-t)t·C + t²·B
  const pts: number[][] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const t = i / ARC_SEGMENTS;
    const u = 1 - t;
    pts.push([
      u * u * a[0] + 2 * u * t * cx + t * t * b[0],
      u * u * a[1] + 2 * u * t * cy + t * t * b[1],
    ]);
  }
  return pts;
}

function buildNodeColorExpression(): maplibregl.ExpressionSpecification {
  const entries: string[] = [];
  for (const [type, color] of Object.entries(NODE_COLORS)) {
    entries.push(type, color);
  }
  return [
    'match', ['get', 'nodeType'],
    ...entries,
    '#B0BEC5', // default
  ] as unknown as maplibregl.ExpressionSpecification;
}

// ===== 2D Layer Visibility Toggle =====

export function set2DNodeLayersVisible(map: maplibregl.Map, visible: boolean): void {
  const vis = visible ? 'visible' : 'none';
  for (const id of [LYR_NODES_CIRCLE, LYR_NODES_SELECTED, LYR_NODES_LABELS, LYR_EDGE_START]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', vis);
    }
  }
}

export function set2DEdgeLayersVisible(map: maplibregl.Map, visible: boolean): void {
  const vis = visible ? 'visible' : 'none';
  for (const id of [LYR_EDGES_LINE, LYR_EDGES_CROSS]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', vis);
    }
  }
}

// ===== Floating 3D Node Overlay =====
// Renders graph editor nodes as HTML divs at correct floor heights in 3D mode.
// Same projection technique as FloatingLabels (MercatorCoordinate + pixelMatrix3D).

interface FloatingNodeEntry {
  el: HTMLDivElement;
  nodeId: string;
  lngLat: [number, number];
  altitude: number;
}

let storedMap: maplibregl.Map | null = null;
let floatingContainer: HTMLDivElement | null = null;
let floatingNodeEntries: FloatingNodeEntry[] = [];
let floatingNodesActive = false;
let floatingNodeClickCb: ((nodeId: string) => void) | null = null;

export function initFloatingNodes(mapInst: maplibregl.Map, onNodeClick: (nodeId: string) => void): void {
  storedMap = mapInst;
  floatingNodeClickCb = onNodeClick;

  floatingContainer = document.createElement('div');
  floatingContainer.className = 'ge-floating-nodes-container';
  mapInst.getContainer().appendChild(floatingContainer);
  mapInst.on('render', updateFloatingNodePositions);
}

export function destroyFloatingNodes(): void {
  clearFloatingNodes();
  if (storedMap) {
    storedMap.off('render', updateFloatingNodePositions);
  }
  if (floatingContainer) {
    floatingContainer.remove();
    floatingContainer = null;
  }
  storedMap = null;
  floatingNodeClickCb = null;
}

export function updateFloatingNodeLayer(
  nodes: NavNode[],
  selectedId: string | null,
  edgeStartId: string | null,
  levelBaseGetter: (level: number) => number,
  roomThickness: number,
  currentLevel: number,
): void {
  clearFloatingNodes();
  if (!floatingContainer || !storedMap) return;

  floatingNodesActive = true;

  for (const node of nodes) {
    const altitude = levelBaseGetter(node.level) + roomThickness + 0.5;
    const color = NODE_COLORS[node.type] || '#B0BEC5';
    const isSelected = node.id === selectedId;
    const isEdgeStart = node.id === edgeStartId;
    const isInactive = node.level !== currentLevel;

    const el = document.createElement('div');
    el.className = 'ge-floating-node';
    el.style.setProperty('--node-color', color);

    if (isSelected) el.classList.add('selected');
    if (isEdgeStart) el.classList.add('edge-start');
    if (isInactive) el.classList.add('inactive');

    const labelText = node.label || node.type;
    const labelEl = document.createElement('span');
    labelEl.className = 'ge-floating-node-label';
    labelEl.textContent = labelText;
    el.appendChild(labelEl);

    const nodeId = node.id;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      floatingNodeClickCb?.(nodeId);
    });

    floatingContainer.appendChild(el);
    floatingNodeEntries.push({ el, nodeId, lngLat: node.coordinates, altitude });
  }

  updateFloatingNodePositions();
}

export function clearFloatingNodes(): void {
  for (const fn of floatingNodeEntries) fn.el.remove();
  floatingNodeEntries = [];
  floatingNodesActive = false;
}

function updateFloatingNodePositions(): void {
  if (!storedMap || !floatingNodesActive || floatingNodeEntries.length === 0) return;

  const transform = (storedMap as any).transform;
  const canvas = storedMap.getCanvas();
  const viewW = canvas.clientWidth;
  const viewH = canvas.clientHeight;

  for (const fn of floatingNodeEntries) {
    const pos = projectNode3D(transform, fn.lngLat, fn.altitude);
    if (pos && pos.x >= -50 && pos.x <= viewW + 50 && pos.y >= -50 && pos.y <= viewH + 50) {
      fn.el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%)`;
      fn.el.style.display = '';
    } else {
      fn.el.style.display = 'none';
    }
  }
}

function projectNode3D(transform: any, lngLat: [number, number], altMeters: number): { x: number; y: number } | null {
  try {
    const mc = maplibregl.MercatorCoordinate.fromLngLat(lngLat, 0);
    const p = transform.coordinatePoint(mc, altMeters, transform.pixelMatrix3D);
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}

// ===== Floating 3D Edge Overlay =====
// Renders graph editor edges as SVG lines at correct floor heights in 3D mode.

interface FloatingEdgeEntry {
  el: SVGLineElement;
  fromLngLat: [number, number];
  toLngLat: [number, number];
  fromAltitude: number;
  toAltitude: number;
}

let floatingEdgesSvg: SVGSVGElement | null = null;
let floatingEdgeEntries: FloatingEdgeEntry[] = [];
let floatingEdgesActive = false;

export function initFloatingEdges(mapInst: maplibregl.Map): void {
  floatingEdgesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  floatingEdgesSvg.classList.add('ge-floating-edges-container');
  mapInst.getContainer().appendChild(floatingEdgesSvg);
  mapInst.on('render', updateFloatingEdgePositions);
}

export function destroyFloatingEdges(): void {
  clearFloatingEdges();
  if (storedMap) {
    storedMap.off('render', updateFloatingEdgePositions);
  }
  if (floatingEdgesSvg) {
    floatingEdgesSvg.remove();
    floatingEdgesSvg = null;
  }
}

export function updateFloatingEdgeLayer(
  edgeData: { edge: NavEdge; fromNode: NavNode; toNode: NavNode }[],
  levelBaseGetter: (level: number) => number,
  roomThickness: number,
  currentLevel: number,
): void {
  clearFloatingEdges();
  if (!floatingEdgesSvg || !storedMap) return;

  floatingEdgesActive = true;

  for (const { edge, fromNode, toNode } of edgeData) {
    const fromAlt = levelBaseGetter(fromNode.level) + roomThickness + 0.5;
    const toAlt = levelBaseGetter(toNode.level) + roomThickness + 0.5;
    const crossFloor = fromNode.level !== toNode.level;
    const touchesCurrent = fromNode.level === currentLevel || toNode.level === currentLevel;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.classList.add('ge-floating-edge');
    if (crossFloor) line.classList.add('cross-floor');
    if (!touchesCurrent) line.classList.add('inactive');

    floatingEdgesSvg.appendChild(line);
    floatingEdgeEntries.push({
      el: line,
      fromLngLat: fromNode.coordinates,
      toLngLat: toNode.coordinates,
      fromAltitude: fromAlt,
      toAltitude: toAlt,
    });
  }

  updateFloatingEdgePositions();
}

export function clearFloatingEdges(): void {
  for (const fe of floatingEdgeEntries) fe.el.remove();
  floatingEdgeEntries = [];
  floatingEdgesActive = false;
}

function updateFloatingEdgePositions(): void {
  if (!storedMap || !floatingEdgesActive || floatingEdgeEntries.length === 0) return;

  const transform = (storedMap as any).transform;
  const canvas = storedMap.getCanvas();
  const viewW = canvas.clientWidth;
  const viewH = canvas.clientHeight;

  floatingEdgesSvg!.setAttribute('width', String(viewW));
  floatingEdgesSvg!.setAttribute('height', String(viewH));

  const margin = 200;

  for (const fe of floatingEdgeEntries) {
    const from = projectNode3D(transform, fe.fromLngLat, fe.fromAltitude);
    const to = projectNode3D(transform, fe.toLngLat, fe.toAltitude);

    if (from && to) {
      const fromVisible = from.x >= -margin && from.x <= viewW + margin && from.y >= -margin && from.y <= viewH + margin;
      const toVisible = to.x >= -margin && to.x <= viewW + margin && to.y >= -margin && to.y <= viewH + margin;

      if (fromVisible || toVisible) {
        fe.el.setAttribute('x1', String(from.x));
        fe.el.setAttribute('y1', String(from.y));
        fe.el.setAttribute('x2', String(to.x));
        fe.el.setAttribute('y2', String(to.y));
        fe.el.style.display = '';
        continue;
      }
    }
    fe.el.style.display = 'none';
  }
}
