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
 *
 * Colors are chosen by GEOMETRY priority against the RSB band hues (Low #87C424,
 * Medium #FFCC1A, High #FF5B1A, Extreme #CD1AFF), because GIS overlays sit on top
 * of RSB-colored segments:
 *  - POINTS matter most — RSB segment nodes are ALSO points — so point layers are
 *    held well clear of all four RSB hues.
 *  - LINES are lower priority but the worst RSB look-alikes were still moved.
 *  - POLYGONS are outlined + translucent, so RSB overlap is a non-issue → unchanged.
 */
export const GIS_LAYER_COLORS = {
  // ── Points (CircleMarkers) — highest priority vs RSB nodes ──
  bicycle_crossing: "#1D4ED8", // blue    (was #F97316 orange ≈ RSB High)
  mrt_exit:         "#06B6D4", // cyan    (unchanged — already RSB-safe)
  bus_stop:         "#BE185D", // rose    (was #8B5CF6 violet ≈ RSB Extreme)
  parking_lot:      "#047857", // emerald (was #D97706 amber  ≈ RSB Medium)
  path_defects:     "#EF4444", // red     (unchanged — danger convention, RSB-safe)
  // ── Lines (Polylines) — lower priority; moved the 3 RSB look-alikes ──
  footpath:         "#1E90FF", // blue     (unchanged)
  cycling:          "#B91C1C", // crimson  (unchanged — dark red, distinct from RSB orange)
  shared:           "#0891B2", // teal     (was #A855F7 violet  ≈ RSB Extreme)
  roadcrossing:     "#10B981", // emerald  (unchanged)
  bus_lane:         "#4F46E5", // indigo   (was #EAB308 yellow  ≈ RSB Medium)
  kerb_line:        "#64748B", // slate    (was #D946EF fuchsia ≈ RSB Extreme; kerb = concrete)
  // ── Polygons (outlined + translucent) — RSB overlap irrelevant; unchanged ──
  state_land:       "#14B8A6", // teal
  stat_board:       "#F59E0B", // amber
  land_private:     "#6366F1", // indigo
  land_ministry:    "#EC4899", // pink
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

/**
 * Fallback color for a segment/point that has NO resolvable risk scores. Semantic,
 * not decorative — seeing this blue on a map means the scores lookup returned nothing
 * (see the "blue segments = broken scores" note in colorConstants / CLAUDE.md). The
 * grey "unknown category" fallback is CATEGORY_UNKNOWN_COLOR (defined with the
 * category palette below).
 */
export const MAP_MISSING_SCORE_COLOR = "#2563EB";

/**
 * Map interaction / annotation colors shared by the Coding and Path Analysis maps —
 * selection, verified state, delete-mode hover, and imported-shapefile overlays.
 * These sit ON TOP of RSB/category segment colors, so they are chosen to stay legible
 * against them (e.g. verifiedHalo is a deep emerald, distinct from the LOW band's
 * yellow-green #87C424).
 */
export const MAP_INTERACTION_COLORS = {
  verifiedHalo:        "#16A34A", // emerald halo around verified segments
  activeSegment:       "#1E63D8", // currently-selected segment node
  deleteHover:         "#FF0000", // hover highlight while in delete mode (was literal "red")
  importedOverlay:     "#EA580C", // imported shapefile outline (line/polygon stroke)
  importedOverlayFill: "#FDBA74", // imported shapefile polygon fill
} as const;

/**
 * Path Analysis "color by attribute category" palette. Single source of truth for
 * the filter-pill colors, focus-attribute map point colors, and the legend / pie /
 * bar readouts. Consumed via getCategoryColor() below and re-exported from
 * PathAnalysisPage/components/AttributesDropdown for backward-compatible imports.
 *
 * Each key is either a flat color (band-level scores like Low/Medium/High/Extreme,
 * which mirror the RSB hues) or a nested value→hex map for a specific attribute.
 * Values with no explicit color fall back to CATEGORY_UNKNOWN_COLOR.
 */
export const CATEGORY_UNKNOWN_COLOR = "#6B7280"; // grey "unknown/other" fallback

export const CATEGORY_COLORS: Record<string, string | Record<string, string>> = {
    "Not Selected": "#9CA3AF",
    "Low": "#87C424",
    "Medium": "#FFCC1A",
    "High": "#FF5B1A",
    "Extreme": "#CD1AFF",
    "Adjacent Sidewalk 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Road Lane 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Vehicle Parking 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Severe Hazard 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent object or level change 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Road Lane 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Vehicle Parking 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Severe Hazard 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent object or level change 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Line of Sight": { "Adequate": "#16A34A", "Inadequate": "#DC2626" },
    "Fixed Obstacle on Facility": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "FO Type": {
      "Lamp Post": "#DC2626",
      "Traffic Light": "#EA580C",
      "Covered Linkway Pole": "#F59E0B",
      "Bollard": "#CA8A04",
      "Bollards": "#CA8A04",
      "Billboard": "#7C3AED",
      "Billboards": "#7C3AED",
      "Sign Pole": "#0284C7",
      "Sign Poles": "#0284C7",
      "Railing": "#0891B2",
      "Utility Box": "#EC4899",
      "Vegetation": "#16A34A",
      "Others": "#6B7280",
    },
    "Non-Fixed Obstacle on Facility": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "NFO Type": {
      "Barrier": "#DC2626",
      "Bin": "#EA580C",
      "Bins": "#EA580C",
      "Bicycle": "#F59E0B",
      "Cone": "#CA8A04",
      "Others": "#6B7280",
    },
    "Width Restriction": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Light Segregation": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Facility access": { "Adequate": "#16A34A", "Inadequate": "#DC2626" },
    "Loose or slippery surface": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Major Surface Deformation or Drain Opening": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Tram or Train Rails": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Delineation": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Delineation Type": {
      "Cycling Path":     "#2563EB",
      "Red Stripe":       "#DC2626",
      "Signalised Crossing": "#EA580C",
      "Zebra Crossing":   "#CA8A04",
      "Faded Marking":    "#9CA3AF",
    },
    "Street Lighting": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Grade": {
      "<=2% (1:25)": "#16A34A",
      "2.9% (1:20)": "#65A30D",
      "3.8% (1:15)": "#CA8A04",
      "4.7% (1:12)": "#EA580C",
      ">=5%": "#DC2626",
    },
    "Curvature": { "No Sharp Turn Present": "#16A34A", "Sharp Turn Present": "#DC2626" },
    "Facility Width per Direction": { "Wide": "#16A34A", "Narrow": "#FFCC1A", "Very Narrow": "#DC2626" },
    "Peak pedestrian flow along or across facility": { "None": "#6B7280", "Low": "#16A34A", "Moderate to high": "#DC2626" },
    "Peak bicycle/LV traffic flow": { "Low": "#16A34A", "Moderate to high": "#DC2626" },
    "Observed proportion of cargo bikes and mopeds": { "Low": "#16A34A", "Moderate to high": "#DC2626" },
    "Heavy vehicle flow": { "Low": "#16A34A", "Moderate to high": "#DC2626" },
    "Bicycle/LV speed – average": { "< 20km/h": "#16A34A", "=/> 20km/h": "#DC2626" },
    "Bicycle/LV speed differential": { "< 10km/h": "#16A34A", "=/> 10km/h": "#DC2626" },
    "Intersection or Road Crossing": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Crossing Facility": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Crossing Type": {
      "Zebra Crossing": "#CA8A04",
      "Signalised PC": "#2563EB",
      "Bicycle Crossing": "#16A34A",
      "Unsignalised Junction": "#EA580C",
      "Development Access": "#9333EA",
    },
    "Pedestrian Crossing": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Intersecting Bicycle Facility": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Property Access": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Intersection Approach": { "Separate/NA": "#16A34A", "Shared": "#DC2626" },
    "Number of lanes – adjacent road": { "1 per Direction/NA": "#16A34A", "> 1 per Direction": "#DC2626" },
    "Number of lanes – intersecting road": { "1 per Direction/NA": "#16A34A", "> 1 per Direction": "#DC2626" },
    "Road speed limit": {
      "NA": "#6B7280",
      "30 km/h": "#16A34A",
      "40 km/h": "#65A30D",
      "50 km/h": "#FFCC1A",
      "60 km/h": "#F59E0B",
      "70 km/h": "#EA580C",
      "80 km/h": "#DC2626",
      "90 km/h": "#991B1B",
    },
    "Flow Direction": { "One Way": "#2563EB", "Two Way": "#9333EA" },
    "Facility Type": {
      "Sidewalk": "#2563EB",
      "Multi-Use Path": "#9333EA",
      "Off-Road Bicycle Path": "#16A34A",
      "On-road Bicycle Lane": "#CA8A04",
      "Road Shoulder": "#F59E0B",
      "Mixed Traffic Road Lane": "#DC2626",
    },
    "Facility Width Sub-category": {
      "≤1.5m":     "#DC2626",
      ">1.5–1.8m": "#EA580C",
      ">1.8–<2m":  "#F59E0B",
      "2–<3.5m":   "#16A34A",
      "3.5–4m":    "#0891B2",
      ">4m":            "#2563EB",
    },
    "Curvature Sub-category": {
      "<6.5m":         "#DC2626",
      "<10m":          "#EA580C",
      "Path Junction": "#9333EA",
      "Sharp Bend":    "#EA580C",
      "Both":          "#9333EA",
      "10–18m":    "#16A34A",
      ">18m":           "#2563EB",
    },
    "Area type": {
      "Urban":        "#2563EB",
      "Suburban":     "#0891B2",
      "Rural":        "#16A34A",
      "Industrial":   "#EA580C",
      "Recreational": "#9333EA",
    },
};

/**
 * Returns the display hex color for a given attribute name and category value.
 * Backed by CATEGORY_COLORS (the single source above).
 */
export function getCategoryColor(attribute: string, category: string): string {
  const isSafetyScore = ["VB Band", "BB Band", "SB Band", "BP Band", "Overall Risk Level"].includes(attribute);

  if (isSafetyScore) {
    return (CATEGORY_COLORS[category] as string) || CATEGORY_UNKNOWN_COLOR;
  }

  const attributeColors = CATEGORY_COLORS[attribute];
  if (typeof attributeColors === "object" && attributeColors !== null) {
    return (attributeColors as Record<string, string>)[category] || CATEGORY_UNKNOWN_COLOR;
  }
  if (typeof attributeColors === "string") return attributeColors;
  return CATEGORY_UNKNOWN_COLOR;
}
