/**
 * useCurvatureOverlay.ts — curvature geometry conversion hook for GeoDataPanel.
 *
 * Single responsibility: convert the curvature-analysis response's EPSG:3414
 * diagnostics geometry into Leaflet-ready WGS84 [lat, lon] arrays (via the
 * shared `utils/projection.ts::to4326`). Kept separate from
 * `CurvatureOverlay.tsx` so that file only exports components
 * (react-refresh/only-export-components). Extracted from GeoDataPanel.tsx in S2.2.
 */
import { useMemo } from "react";
import { to4326 } from "../../../../utils/projection";
import type { CurvatureVisualizationResponse } from "../../../../api/curvatureVisualization";

/**
 * Convert the curvature response's EPSG:3414 geometry into Leaflet-ready
 * WGS84 [lat, lon] arrays.
 *
 * @param curvData curvature visualization response (or null/undefined when
 *   no analysis has been run for the current segment).
 * @returns `tripletPoints` — the minimum-radius triplet (P1..P3) or null;
 *   `circleCoords` — the 5 m analysis circle ring or null.
 * No side effects (pure memoised conversion).
 */
export function useCurvatureOverlay(curvData: CurvatureVisualizationResponse | null | undefined): {
  tripletPoints: [number, number][] | null;
  circleCoords: [number, number][] | null;
} {
  // Convert triplet points from EPSG:3414 to WGS84 (lat, lon) for display
  const tripletPoints: [number, number][] | null = useMemo(() => {
    if (!curvData?.diagnostics?.min_triplet?.points) return null;
    try {
      // to4326 registers EPSG:3414 once at module load and passes WGS84 through.
      return curvData.diagnostics.min_triplet.points.map((p) => to4326(p));
    } catch {
      return null;
    }
  }, [curvData]);

  const circleCoords: [number, number][] | null = useMemo(() => {
    if (!curvData?.circle_geojson?.geometry?.coordinates?.[0]) return null;
    return curvData.circle_geojson.geometry.coordinates[0].map(
      ([lon, lat]: [number, number]) => [lat, lon] as [number, number]
    );
  }, [curvData]);

  return { tripletPoints, circleCoords };
}
