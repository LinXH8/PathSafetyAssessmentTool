/**
 * polygonUtils — geometric helpers for the interactive polygon selection feature.
 *
 * Separated from PolygonDrawing.tsx so that non-component utility exports do not
 * violate the react-refresh/only-export-components rule (fast-refresh requires
 * component-only files for HMR to work correctly).
 *
 * Consumers:
 *   PolygonDrawing.tsx — re-exports isPointInPolygon for convenience
 *   PathAnalysisMapView.tsx — filters segments inside a drawn polygon
 *   GeoDataPanel.tsx       — filters segments inside a drawn polygon
 */

/**
 * Point-in-polygon test using the ray-casting algorithm.
 *
 * Works on [lat, lng] tuples — treats longitude as the x-axis and latitude as
 * the y-axis (standard geographic convention). The result is the same regardless
 * of which axis is labelled x/y, as long as both `point` and `vs` use the same
 * convention — which they always do here (Leaflet click events → [lat, lng]).
 *
 * @param point - Test point as [lat, lng].
 * @param vs    - Polygon vertices as [lat, lng] tuples (≥ 3 for a valid polygon).
 * @returns     true if `point` lies strictly inside the polygon.
 */
export function isPointInPolygon(point: [number, number], vs: [number, number][]): boolean {
  // x = longitude (east-west), y = latitude (north-south)
  const x = point[1], y = point[0];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][1], yi = vs[i][0];
    const xj = vs[j][1], yj = vs[j][0];
    const intersect = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
