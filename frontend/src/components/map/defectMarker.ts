/**
 * defectMarker.ts — the canonical "Path Defect" map marker.
 *
 * A warning triangle in the path-defect colour (GIS_LAYER_COLORS.path_defects),
 * shared by the Coding map (DefectsLayer) and the Path Analysis map
 * (GISLayerOverlays) so the on-map symbol is identical on both pages AND matches
 * the Layer View legend glyph (AnalysisSidebar's `warning` LayerGeometryIcon).
 *
 * The triangle SHAPE carries the "warning" semantics, which frees the fill colour
 * to be the layer colour without needing a separate icon vs. colour marker.
 */
import { divIcon } from "leaflet";
import { GIS_LAYER_COLORS } from "../../constants/mapColors";

/** Warning-triangle divIcon for a single path-defect point. */
export function makeDefectIcon(size = 22) {
  const c = GIS_LAYER_COLORS.path_defects;
  return divIcon({
    className: "path-defect-marker",
    html:
      `<svg width="${size}" height="${size}" viewBox="0 0 16 16" ` +
      `style="display:block;filter:drop-shadow(0 0 1.5px rgba(0,0,0,0.55))">` +
      `<path d="M8 1.5 L15 14 L1 14 Z" fill="${c}" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>` +
      `<rect x="7.15" y="6" width="1.7" height="4" rx="0.85" fill="#fff"/>` +
      `<circle cx="8" cy="12" r="0.95" fill="#fff"/>` +
      `</svg>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
