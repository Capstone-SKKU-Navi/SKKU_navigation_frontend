const fs = require('fs');
const path = require('path');

const indoorLayerPath = path.join(__dirname, '..', 'src', 'components', 'indoorLayer.ts');
const source = fs.readFileSync(indoorLayerPath, 'utf8');

const gradientEnabled = source.match(/fill-extrusion-vertical-gradient'\]\s*=\s*true/);
const gradientLayerCalls = [
  ['rooms', /addExtrusionLayerPair\(map,\s*building,\s*'rooms',[\s\S]*?,\s*true\)/],
  ['corridors', /addExtrusionLayerPair\(map,\s*building,\s*'corridors',[\s\S]*?,\s*true\)/],
  ['stairs', /addExtrusionLayerPair\(map,\s*building,\s*'stairs',[\s\S]*?,\s*true\)/],
].filter(([, pattern]) => pattern.test(source)).map(([name]) => name);

if (gradientEnabled || gradientLayerCalls.length > 0) {
  throw new Error(
    `3D indoor floor layers must keep fill-extrusion-vertical-gradient disabled; enabled for: ${gradientLayerCalls.join(', ') || 'paint default'}`,
  );
}

const requiredOpaqueConstants = [
  'ACTIVE_ROOM_OPACITY',
  'ACTIVE_CORRIDOR_OPACITY',
  'ACTIVE_STAIRS_OPACITY',
];
const nonOpaque = requiredOpaqueConstants.filter((name) => {
  const pattern = new RegExp(`const\\s+${name}\\s*=\\s*1\\s*;`);
  return !pattern.test(source);
});

if (nonOpaque.length > 0) {
  throw new Error(
    `Active 3D floor slabs must be opaque so basemap polygons do not show through: ${nonOpaque.join(', ')}`,
  );
}

const keepsBasementsOnMapPlane = /l\s*<\s*0\s*\?\s*0\s*:\s*DEFAULT_FLOOR_HEIGHT/.test(source);
if (!keepsBasementsOnMapPlane) {
  throw new Error('Basement floors should stay on the map plane when selected.');
}

const excludesBasementBelowStack = /currentLevel\s*>\s*0[\s\S]*\['>=',\s*\['get',\s*'_level'\],\s*1\]/.test(source);
if (!excludesBasementBelowStack) {
  throw new Error('Above-ground 3D below-stacks must exclude basement floors to avoid B1/1F z-fighting.');
}

console.log('3D indoor floor slabs are opaque, flat-shaded, and above-ground below-stacks exclude basements.');
