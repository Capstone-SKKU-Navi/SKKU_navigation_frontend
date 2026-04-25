// Mean of the unique polygon ring vertices. Assumes the ring is closed
// (first === last), so the trailing duplicate vertex is dropped from the
// average. Returns [lng, lat].

export function polygonCenter(coords: number[][]): [number, number] {
  const len = Math.max(1, coords.length - 1);
  let sumLng = 0;
  let sumLat = 0;
  for (let i = 0; i < len; i++) {
    sumLng += coords[i][0];
    sumLat += coords[i][1];
  }
  return [sumLng / len, sumLat / len];
}

// Same vertex-mean, but pulls the outer ring out of a Polygon / MultiPolygon
// before averaging. Used by indoorLayer label placement.
export function polygonGeomCenter(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): [number, number] {
  const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
  return polygonCenter(ring);
}
