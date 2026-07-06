/**
 * SVY21 (EPSG:3414) ↔ WGS84 (EPSG:4326) coordinate projection helpers.
 *
 * Singapore's national grid uses SVY21 (Transverse Mercator). Leaflet and GeoJSON
 * consumers expect WGS84 [lat, lon]. Call to4326() on any coordinate that may be
 * in either system — the WGS84 pass-through prevents double-projection for newer
 * projects that natively output EPSG:4326 GeoJSON (see CLAUDE.md for background).
 *
 * SVY21 eastings are in the range ~20 000–48 000, so a longitude value of ~103.8
 * is unambiguously WGS84 and is detected by the guard below.
 *
 * Used by: GeoDataPanel, PathAnalysisMapView, reportBuilderPage.
 */

import proj4 from "proj4";
import type { Position } from "geojson";

proj4.defs(
  "EPSG:3414",
  "+proj=tmerc +lat_0=1.366666666666667 +lon_0=103.8333333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs"
);

/**
 * Convert a GeoJSON Position to a Leaflet-style [lat, lon] pair.
 *
 * Coordinates already in WGS84 (Singapore longitude ≈ 103.8, latitude ≈ 1.3)
 * are returned as-is without projection. Coordinates in SVY21 (easting > 20 000)
 * are projected to WGS84 via proj4.
 *
 * @param p - GeoJSON position ([x, y, …]) in either EPSG:3414 or EPSG:4326.
 * @returns [lat, lon] in WGS84 suitable for Leaflet.
 */
export function to4326(p: Position): [number, number] {
  const x = p[0];
  const y = p[1];

  // Pass-through: already WGS84 (Singapore lon ≈ 103, lat ≈ 1.3).
  // SVY21 eastings are ~20 000–48 000 and never fall in this range.
  if (x >= 90 && x <= 120 && y >= -10 && y <= 20) {
    return [y, x]; // [lat, lon]
  }

  const [lon, lat] = proj4("EPSG:3414", "EPSG:4326", p as [number, number]) as [number, number];
  return [lat, lon];
}
