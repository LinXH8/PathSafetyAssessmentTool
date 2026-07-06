/**
 * CurvatureOverlay.tsx — curvature-analysis map overlay for GeoDataPanel.
 *
 * Single responsibility: everything the "Analysis Overlay" toggle draws on the
 * map — the 5 m analysis circle, colour-coded path centrelines, the red
 * analysis point, the blue minimum-radius triplet points — plus the
 * `useCurvatureOverlay` hook that converts the backend's EPSG:3414 diagnostics
 * into Leaflet [lat, lon] pairs, and the `ZoomToCurvature` helper that zooms to
 * the circle when the overlay turns on. Extracted verbatim from
 * GeoDataPanel.tsx in S2.2 (the inline proj4 EPSG:3414 conversion now reuses
 * the shared `utils/projection.ts::to4326`).
 */
import { useEffect, useRef } from "react";
import { CircleMarker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import type { CurvatureVisualizationResponse } from "../../../../api/curvatureVisualization";

/**
 * Zooms to the curvature analysis 5m circle when the overlay is toggled on.
 * Zooms once per overlay activation (ref-guarded); resets when toggled off.
 *
 * Side effects: `map.fitBounds` on the circle bounds.
 */
export function ZoomToCurvature({ showCurvatureOverlay, circleCoords }: { showCurvatureOverlay: boolean; circleCoords: [number, number][] | null }) {
  const map = useMap();
  const hasZoomedRef = useRef(false);
  useEffect(() => {
    if (!showCurvatureOverlay) {
      hasZoomedRef.current = false;
      return;
    }
    if (hasZoomedRef.current || !circleCoords || circleCoords.length === 0) return;
    const bounds = L.latLngBounds(circleCoords.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [30, 30] });
    hasZoomedRef.current = true;
  }, [showCurvatureOverlay, circleCoords, map]);
  return null;
}

/**
 * Renders the curvature analysis overlays inside a `<MapContainer>`:
 * black 5 m circle outline, colour-coded path centrelines, red analysis
 * point and blue triplet points. Render nothing when `curvData` is absent
 * (the parent also gates on the overlay toggle).
 *
 * @param curvData curvature visualization response for the current segment.
 * @param circleCoords 5 m circle ring from `useCurvatureOverlay`.
 * @param tripletPoints triplet points from `useCurvatureOverlay`.
 * Pure presentational — no side effects.
 */
export function CurvatureOverlay({
  curvData,
  circleCoords,
  tripletPoints,
}: {
  curvData: CurvatureVisualizationResponse;
  circleCoords: [number, number][] | null;
  tripletPoints: [number, number][] | null;
}) {
  return (
    <>
      {/* Black circle outline (5m analysis window) */}
      {circleCoords && (
        <Polyline
          positions={circleCoords}
          pathOptions={{ color: '#000000', weight: 5, fill: false, opacity: 1 }}
        />
      )}
      {/* Path centerlines (color-coded) */}
      {curvData.paths?.map((path, pathIdx) => {
        const pathCoords = path.coordinates.map(([lon, lat]: [number, number]) => [lat, lon] as [number, number]);
        return (
          <Polyline
            key={`curv-path-${pathIdx}`}
            positions={pathCoords}
            pathOptions={{
              color: `rgb(${path.color.join(',')})`,
              weight: path.is_analysis_layer ? 6 : 4,
              opacity: path.is_analysis_layer ? 1 : 0.8,
            }}
          />
        );
      })}
      {/* Red dot (analysis point) */}
      {curvData.point && (
        <CircleMarker
          center={[curvData.point.lat, curvData.point.lon]}
          radius={12}
          pathOptions={{ fillColor: '#ff0000', fillOpacity: 1, color: '#ffffff', weight: 3 }}
        />
      )}
      {/* Blue triplet points (P1, P2, P3) */}
      {tripletPoints?.map((pt, ptIdx) => (
        <CircleMarker
          key={`triplet-${ptIdx}`}
          center={pt}
          radius={8}
          pathOptions={{ fillColor: '#1E90FF', fillOpacity: 1, color: '#ffffff', weight: 2 }}
        />
      ))}
    </>
  );
}
