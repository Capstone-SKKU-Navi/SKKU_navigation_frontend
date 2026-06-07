// ===== Navigation Graph Editor — Map Rendering =====

import maplibregl from 'maplibre-gl';
import { NavNode, NavEdge, EditorMapCallbacks, NODE_COLORS, NavNodeType } from './graphEditorTypes';

const PREFIX = 'graph-editor';

// Source IDs
const SRC_NODES = `${PREFIX}-nodes`;
const SRC_EDGES = `${PREFIX}-edges`;
const SRC_DEBUG = `${PREFIX}-debug-perp`;

// Layer IDs
const LYR_EDGES_LINE = `${PREFIX}-edges-line`;
const LYR_EDGES_CROSS = `${PREFIX}-edges-cross`;
const LYR_EDGES_WEIGHT = `${PREFIX}-edges-weight`;
const LYR_NODES_CIRCLE = `${PREFIX}-nodes-circle`;
const LYR_NODES_SELECTED = `${PREFIX}-nodes-selected`;
const LYR_NODES_EDGE_ENDPOINT = `${PREFIX}-nodes-edge-endpoint`;
const LYR_NODES_LABELS = `${PREFIX}-nodes-labels`;
const LYR_EDGES_HIT = `${PREFIX}-edges-hit`; // invisible wide layer for click detection
const LYR_EDGE_START = `${PREFIX}-edge-start`;
// Debug: perpendicular-foot (수선의 발) visualizer
const LYR_DEBUG_EDGE = `${PREFIX}-debug-edge`;     // target corridor edge highlight
const LYR_DEBUG_DROP = `${PREFIX}-debug-drop`;     // click → foot connector (the 수선)
const LYR_DEBUG_POINTS = `${PREFIX}-debug-points`; // click + foot markers
const LYR_DEBUG_LABELS = `${PREFIX}-debug-labels`; // text annotations

const EDGE_FROM_COLOR = '#EF5350'; // red — "from" end of selected edge
const EDGE_TO_COLOR = '#2979FF';   // blue — "to" end of selected edge

// Debug toggle: edge weight label visibility (user checkbox in panel) — 2D mode only.
// Resets to false on each initEditorLayers call so the label can't get stuck on
// across editor close/reopen cycles.
let showEdgeWeights = false;
// Whether the editor is currently in 2D mode. Source of truth for the weight
// label visibility together with showEdgeWeights. In 3D mode the symbol layer
// is force-hidden regardless of the checkbox.
let in2DMode = true;

// ===== Init / Destroy =====

export function initEditorLayers(map: maplibregl.Map): void {
  showEdgeWeights = false;
  in2DMode = true;
  // Empty GeoJSON sources
  const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

  map.addSource(SRC_NODES, { type: 'geojson', data: emptyFC });
  map.addSource(SRC_EDGES, { type: 'geojson', data: emptyFC });
  map.addSource(SRC_DEBUG, { type: 'geojson', data: emptyFC });

  // Edge lines — same floor (solid)
  map.addLayer({
    id: LYR_EDGES_LINE,
    type: 'line',
    source: SRC_EDGES,
    filter: ['==', ['get', 'crossFloor'], false],
    paint: {
      'line-color': ['case', ['==', ['get', 'selected'], true], '#FFD600', '#42A5F5'],
      'line-width': ['case', ['==', ['get', 'selected'], true], 5, 3],
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
      'line-color': ['case', ['==', ['get', 'selected'], true], '#FFD600', '#FF8A65'],
      'line-width': ['case', ['==', ['get', 'selected'], true], 5, 3],
      'line-opacity': 0.75,
      'line-dasharray': [4, 3],
    },
  });

  // Edge weight label — placed at line center. Hidden by default; toggled by
  // the "edge weight 표시" checkbox in the editor panel.
  map.addLayer({
    id: LYR_EDGES_WEIGHT,
    type: 'symbol',
    source: SRC_EDGES,
    layout: {
      'text-field': ['to-string', ['get', 'weight']],
      'text-size': 11,
      'text-font': ['Noto Sans Regular'],
      'symbol-placement': 'line-center',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'visibility': 'none',
    },
    paint: {
      'text-color': '#FFEB3B',
      'text-halo-color': 'rgba(0,0,0,0.85)',
      'text-halo-width': 1.5,
    },
  });

  // Edge hit area — invisible wide layer for easier clicking
  map.addLayer({
    id: LYR_EDGES_HIT,
    type: 'line',
    source: SRC_EDGES,
    paint: {
      'line-color': 'transparent',
      'line-width': 16,
      'line-opacity': 0,
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
        ['==', ['get', 'nodeType'], 'room'], 4,
        7,
      ],
      'circle-color': buildNodeColorExpression(),
      'circle-stroke-width': [
        'case',
        ['==', ['get', 'nodeType'], 'room'], 1,
        2,
      ] as any,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': [
        'case',
        ['==', ['get', 'nodeType'], 'room'], 0.45,
        0.9,
      ] as any,
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

  // Directional highlight for endpoints of the currently-selected edge:
  // from = red, to = blue. Drawn above the normal node circle.
  map.addLayer({
    id: LYR_NODES_EDGE_ENDPOINT,
    type: 'circle',
    source: SRC_NODES,
    filter: ['any',
      ['==', ['get', 'edgeRole'], 'from'],
      ['==', ['get', 'edgeRole'], 'to'],
    ],
    paint: {
      'circle-radius': 14,
      'circle-color': 'transparent',
      'circle-stroke-width': 4,
      'circle-stroke-color': [
        'match', ['get', 'edgeRole'],
        'from', EDGE_FROM_COLOR,
        'to', EDGE_TO_COLOR,
        '#FFFFFF',
      ] as any,
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

  // ===== Debug: perpendicular foot (수선의 발) overlay — drawn on top =====

  // Target edge the foot lands on — thick magenta underline
  map.addLayer({
    id: LYR_DEBUG_EDGE,
    type: 'line',
    source: SRC_DEBUG,
    filter: ['==', ['get', 'role'], 'edge'],
    paint: {
      'line-color': '#E91E63',
      'line-width': 6,
      'line-opacity': 0.55,
    },
  });

  // The 수선 itself: click point → foot, dashed
  map.addLayer({
    id: LYR_DEBUG_DROP,
    type: 'line',
    source: SRC_DEBUG,
    filter: ['==', ['get', 'role'], 'drop'],
    paint: {
      'line-color': '#FF4081',
      'line-width': 2,
      'line-dasharray': [2, 2],
    },
  });

  // Click + foot markers
  map.addLayer({
    id: LYR_DEBUG_POINTS,
    type: 'circle',
    source: SRC_DEBUG,
    filter: ['any', ['==', ['get', 'role'], 'click'], ['==', ['get', 'role'], 'foot']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'role'], 'foot'], 7, 6],
      'circle-color': ['case', ['==', ['get', 'role'], 'foot'], '#FF1744', '#00E5FF'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });

  // Marker labels (foot shows perpendicular distance)
  map.addLayer({
    id: LYR_DEBUG_LABELS,
    type: 'symbol',
    source: SRC_DEBUG,
    filter: ['any', ['==', ['get', 'role'], 'click'], ['==', ['get', 'role'], 'foot']],
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-font': ['Noto Sans Regular'],
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#FFFFFF',
      'text-halo-color': 'rgba(0,0,0,0.85)',
      'text-halo-width': 1.5,
    },
  });
}

export function destroyEditorLayers(map: maplibregl.Map): void {
  const layers = [LYR_DEBUG_LABELS, LYR_DEBUG_POINTS, LYR_DEBUG_DROP, LYR_DEBUG_EDGE, LYR_NODES_LABELS, LYR_EDGE_START, LYR_NODES_EDGE_ENDPOINT, LYR_NODES_SELECTED, LYR_NODES_CIRCLE, LYR_EDGES_HIT, LYR_EDGES_WEIGHT, LYR_EDGES_CROSS, LYR_EDGES_LINE];
  for (const id of layers) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SRC_DEBUG)) map.removeSource(SRC_DEBUG);
  if (map.getSource(SRC_EDGES)) map.removeSource(SRC_EDGES);
  if (map.getSource(SRC_NODES)) map.removeSource(SRC_NODES);
}

// ===== Update Data =====

export function updateNodeLayer(
  map: maplibregl.Map,
  nodes: NavNode[],
  selectedId: string | null,
  edgeStartId: string | null,
  edgeFromId: string | null = null,
  edgeToId: string | null = null,
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
      displayLabel: node.label || node.id.slice(5, 13),
      selected: node.id === selectedId,
      edgeStart: node.id === edgeStartId,
      edgeRole: node.id === edgeFromId ? 'from' : node.id === edgeToId ? 'to' : '',
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
  selectedEdgeIds: string[] = [],
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
        selected: selectedEdgeIds.includes(edge.id),
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

// ===== Debug: perpendicular foot overlay =====

export interface DebugPerpData {
  click: [number, number];   // input coordinate
  foot: [number, number];    // 수선의 발 (projection on edge)
  edgeA: [number, number];   // target edge endpoint A
  edgeB: [number, number];   // target edge endpoint B
  perpDistM: number;         // click → foot distance (meters)
}

/** Render (or clear, when `data` is null) the 수선의 발 debug overlay. */
export function updateDebugPerpLayer(map: maplibregl.Map, data: DebugPerpData | null): void {
  const source = map.getSource(SRC_DEBUG) as maplibregl.GeoJSONSource;
  if (!source) return;

  if (!data) {
    source.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  const features: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      properties: { role: 'edge' },
      geometry: { type: 'LineString', coordinates: [data.edgeA, data.edgeB] },
    },
    {
      type: 'Feature',
      properties: { role: 'drop' },
      geometry: { type: 'LineString', coordinates: [data.click, data.foot] },
    },
    {
      type: 'Feature',
      properties: { role: 'click', label: '클릭' },
      geometry: { type: 'Point', coordinates: data.click },
    },
    {
      type: 'Feature',
      properties: { role: 'foot', label: `수선의 발 (${data.perpDistM.toFixed(1)}m)` },
      geometry: { type: 'Point', coordinates: data.foot },
    },
  ];

  source.setData({ type: 'FeatureCollection', features });
}

export function clearDebugPerp(map: maplibregl.Map): void {
  updateDebugPerpLayer(map, null);
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
    // Debug modes (e.g. 수선의 발) want every click as a raw map coordinate,
    // bypassing node/edge hit-testing so the click lands exactly where pressed.
    if (callbacks.shouldRouteAllClicksToMap?.()) {
      callbacks.onMapClick([e.lngLat.lng, e.lngLat.lat]);
      return;
    }

    // Check if a node was clicked first
    const features = map.queryRenderedFeatures(e.point, { layers: [LYR_NODES_CIRCLE] });
    if (features.length > 0) {
      const nodeId = features[0].properties?.id;
      if (nodeId) {
        callbacks.onNodeClick(nodeId);
        return;
      }
    }

    // Check if an edge was clicked (use wide hit layer for easier detection)
    const edgeFeatures = map.queryRenderedFeatures(e.point, { layers: [LYR_EDGES_HIT] });
    if (edgeFeatures.length > 0) {
      const edgeId = edgeFeatures[0].properties?.id;
      if (edgeId) {
        callbacks.onEdgeClick(edgeId, e.originalEvent.shiftKey);
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
  map.on('mouseenter', LYR_EDGES_HIT, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', LYR_EDGES_HIT, () => {
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

// ===== Drag-to-move =====
//
// Activates only on mousedown over a node circle in the 2D layer. Threshold-
// gated (>3px movement) so a plain click still falls through to the click
// handler — node selection still works as before.

export interface DragHandlerCallbacks {
  isEnabled: () => boolean;                                    // false → bail out (e.g. wrong mode, 3D)
  onStart: (nodeId: string) => void;                           // about to drag
  onMove: (nodeId: string, coords: [number, number]) => void;  // live preview
  onCommit: (nodeId: string, coords: [number, number]) => void;// final position
  onCancel: (nodeId: string) => void;                          // Esc during drag
}

let dragMousedownHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
let dragMoveHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
let dragUpHandler: ((e: maplibregl.MapMouseEvent) => void) | null = null;
let dragKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let dragNodeId: string | null = null;
let dragStartScreen: { x: number; y: number } | null = null;
let dragMoved = false;

export function setDragHandler(map: maplibregl.Map, cbs: DragHandlerCallbacks): void {
  removeDragHandler(map);

  const cleanup = () => {
    if (dragMoveHandler) { map.off('mousemove', dragMoveHandler); dragMoveHandler = null; }
    if (dragUpHandler) { map.off('mouseup', dragUpHandler); dragUpHandler = null; }
    if (dragKeyHandler) { document.removeEventListener('keydown', dragKeyHandler); dragKeyHandler = null; }
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    dragNodeId = null;
    dragStartScreen = null;
    dragMoved = false;
  };

  dragMousedownHandler = (e: maplibregl.MapMouseEvent) => {
    if (!cbs.isEnabled()) return;
    if (e.originalEvent.button !== 0) return; // left button only
    const features = map.queryRenderedFeatures(e.point, { layers: [LYR_NODES_CIRCLE] });
    if (features.length === 0) return;
    const nodeId = features[0].properties?.id;
    if (!nodeId) return;

    dragNodeId = nodeId;
    dragStartScreen = { x: e.point.x, y: e.point.y };
    dragMoved = false;
    map.dragPan.disable();
    cbs.onStart(nodeId);

    dragMoveHandler = (me: maplibregl.MapMouseEvent) => {
      if (!dragNodeId || !dragStartScreen) return;
      if (!dragMoved) {
        const dx = Math.abs(me.point.x - dragStartScreen.x);
        const dy = Math.abs(me.point.y - dragStartScreen.y);
        if (dx <= 3 && dy <= 3) return;
        dragMoved = true;
        map.getCanvas().style.cursor = 'grabbing';
      }
      cbs.onMove(dragNodeId, [me.lngLat.lng, me.lngLat.lat]);
    };

    dragUpHandler = (ue: maplibregl.MapMouseEvent) => {
      const id = dragNodeId;
      const moved = dragMoved;
      cleanup();
      if (id && moved) cbs.onCommit(id, [ue.lngLat.lng, ue.lngLat.lat]);
      // If !moved this was a click — let the regular click handler fire.
    };

    dragKeyHandler = (ke: KeyboardEvent) => {
      if (ke.key !== 'Escape' || !dragNodeId) return;
      const id = dragNodeId;
      cleanup();
      cbs.onCancel(id);
    };

    map.on('mousemove', dragMoveHandler);
    map.on('mouseup', dragUpHandler);
    document.addEventListener('keydown', dragKeyHandler);
  };

  map.on('mousedown', dragMousedownHandler);
}

export function removeDragHandler(map: maplibregl.Map): void {
  if (dragMousedownHandler) { map.off('mousedown', dragMousedownHandler); dragMousedownHandler = null; }
  if (dragMoveHandler) { map.off('mousemove', dragMoveHandler); dragMoveHandler = null; }
  if (dragUpHandler) { map.off('mouseup', dragUpHandler); dragUpHandler = null; }
  if (dragKeyHandler) { document.removeEventListener('keydown', dragKeyHandler); dragKeyHandler = null; }
  map.dragPan.enable();
  dragNodeId = null;
  dragStartScreen = null;
  dragMoved = false;
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
  in2DMode = visible;
  const vis = visible ? 'visible' : 'none';
  for (const id of [LYR_EDGES_LINE, LYR_EDGES_CROSS, LYR_EDGES_HIT]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', vis);
    }
  }
  // Weight label is debug-only and 2D-only: force hidden in 3D, follow the
  // checkbox in 2D.
  applyEdgeWeightVisibility(map);
}

export function setEdgeWeightLabelVisible(map: maplibregl.Map, visible: boolean): void {
  showEdgeWeights = visible;
  applyEdgeWeightVisibility(map);
}

function applyEdgeWeightVisibility(map: maplibregl.Map): void {
  if (!map.getLayer(LYR_EDGES_WEIGHT)) return;
  const shouldShow = showEdgeWeights && in2DMode;
  map.setLayoutProperty(LYR_EDGES_WEIGHT, 'visibility', shouldShow ? 'visible' : 'none');
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
  edgeFromId: string | null = null,
  edgeToId: string | null = null,
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
    const isEdgeFrom = node.id === edgeFromId;
    const isEdgeTo = node.id === edgeToId;

    const el = document.createElement('div');
    el.className = 'ge-floating-node';
    el.style.setProperty('--node-color', color);

    if (isSelected) el.classList.add('selected');
    if (isEdgeStart) el.classList.add('edge-start');
    if (isEdgeFrom) el.classList.add('edge-from');
    if (isEdgeTo) el.classList.add('edge-to');
    if (isInactive) el.classList.add('inactive');
    if (node.type === 'room') el.classList.add('room-node');

    const labelText = node.label || node.id.slice(5, 13);
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
