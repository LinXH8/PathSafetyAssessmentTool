/**
 * MAP COLOR SOURCE OF TRUTH
 *
 * Single home for every non-RSB color rendered on a Leaflet map. RSB (Risk Score
 * Band) colors are deliberately NOT here — they live in
 * `components/visualization/scoreband/colorConstants.ts` and must stay the single
 * source for risk semantics.
 *
 * Co-occurrence constraints these palettes must respect:
 *  - GIS layers appear on every map alongside RSB segment colors → GIS hues should
 *    stay distinct from the four RSB band colors.
 *  - GIS layers appear alongside project-point colors on Path Analysis → GIS hues
 *    should stay distinct from PROJECT_POINT_COLORS too.
 *  - RSB and project points never share a map, so they have no mutual constraint.
 *
 * NOTE: these are the current production values, gathered verbatim from the three
 * places they used to be duplicated. Changing a value here changes it everywhere.
 */

/**
 * Per-layer GIS overlay colors (footpath, cycling, …). Keys match the layer `key`
 * used by AnalysisSidebar and the `gisLayers` record in PathAnalysisMapView.
 */
export const GIS_LAYER_COLORS = {
  footpath:         "#1E90FF",
  cycling:          "#B91C1C",
  shared:           "#A855F7",
  roadcrossing:     "#10B981",
  bicycle_crossing: "#F97316",
  mrt_exit:         "#06B6D4",
  bus_stop:         "#8B5CF6",
  bus_lane:         "#EAB308",
  parking_lot:      "#D97706",
  kerb_line:        "#D946EF",
  path_defects:     "#EF4444",
  state_land:       "#14B8A6",
  stat_board:       "#F59E0B",
  land_private:     "#6366F1",
  land_ministry:    "#EC4899",
} as const;

export type GisLayerKey = keyof typeof GIS_LAYER_COLORS;

/**
 * Path Analysis "color by project" point palette. Assigned round-robin
 * (`PROJECT_POINT_COLORS[idx % length]`), so up to 8 projects get distinct colors
 * before wrapping.
 */
export const PROJECT_POINT_COLORS = [
  "#2563EB", // Blue
  "#DC2626", // Red
  "#16A34A", // Green
  "#CA8A04", // Yellow
  "#9333EA", // Purple
  "#EA580C", // Orange
  "#0891B2", // Cyan
  "#DB2777", // Pink
] as const;

/**
 * Standalone GIS Layers viewer (GisLayersPage) colors. This page renders ANY
 * selected shapefile generically by geometry type — it is NOT per-semantic-layer,
 * so it intentionally does not reuse GIS_LAYER_COLORS.
 */
export const GIS_VIEWER_GEOMETRY_COLORS = {
  line: "#2563EB",
  polygon: "#9333EA",
  pointStroke: "#DC2626",
  pointFill: "#EF4444",
} as const;
