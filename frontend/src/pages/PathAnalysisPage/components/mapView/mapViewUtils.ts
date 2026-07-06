/**
 * mapViewUtils.ts — pure helpers, constants and data types for the Path
 * Analysis map view (`PathAnalysisMapView.tsx`).
 *
 * Single responsibility: stateless utilities extracted from the map-view
 * monolith [S2.1] — uploaded-shapefile boundary parsing, grade / crossing-type
 * label normalisation, semantic category ordering, and the shared ProjectData /
 * VisibleSegment shapes. No React, no network, no storage access.
 */

import type { Feature, FeatureCollection, GeoJsonProperties, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";
import type { AttributeRow } from "../../../../api";

/** Safety-score attributes whose categories come from score bands, not attribute codes. */
export const SAFETY_FOCUS_ATTRIBUTES = new Set(["VB Band", "BB Band", "SB Band", "BP Band", "Overall Risk Level"]);

// Radius (metres) around each loaded segment within which GIS overlay features are
// fetched. Matches the Coding page's single-point query radius.
export const GIS_SEGMENT_RADIUS_M = 200;

// Attributes whose missing/blank value defaults to "Adequate" (code 1) per
// backend/src/CycleRAP/defaults.json. Scoring applies the same default
// (row.get(attr, 1)) and the coding panel renders "Adequate" for a blank cell,
// so Path Analysis must treat blank as "Adequate" too — otherwise the many
// segments that were never explicitly coded (null in attributes.csv) get dropped
// from visibleSegments and never appear even when "Adequate" is toggled on.
export const ADEQUACY_DEFAULT_ATTRS = new Set(["Line of Sight", "Facility access"]);

/** One renderable feature parsed out of a user-uploaded boundary shapefile. */
export interface UploadedBoundaryFeature {
  key: string;
  label: string;
  kind: "polygon" | "line";
  coords?: [number, number][];
  lineCoordsSets?: [number, number][][];
}

const FEATURE_LABEL_KEYS = [
  "name", "Name", "NAME", "label", "Label", "LABEL",
  "pln_area_n", "PLN_AREA_N", "subzone_n", "SUBZONE_N",
  "region_n", "REGION_N", "id", "ID", "OBJECTID", "FID",
];

/** Best-effort display label for an uploaded boundary feature (first known name-ish property). */
function getUploadedBoundaryLabel(properties: GeoJsonProperties | null | undefined, featureIndex: number): string {
  if (properties) {
    for (const key of FEATURE_LABEL_KEYS) {
      const value = properties[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
  }
  return `Feature ${featureIndex + 1}`;
}

/** Converts a GeoJSON [lng, lat] ring to Leaflet [lat, lng] pairs, dropping malformed coords. */
function toShapefileLeafletCoords(ring: number[][]): [number, number][] {
  return ring
    .filter((coord) => coord.length >= 2 && Number.isFinite(coord[0]) && Number.isFinite(coord[1]))
    .map(([lng, lat]) => [lat, lng]);
}

/**
 * Flattens an uploaded shapefile FeatureCollection into renderable boundary
 * features: polygons individually (multi-polygons per part), all line features
 * aggregated into one entry. Returns [] when nothing usable was found.
 */
export function extractUploadedBoundaryFeatures(collection: FeatureCollection): UploadedBoundaryFeature[] {
  const boundaries: UploadedBoundaryFeature[] = [];
  const aggregatedLineCoords: number[][][] = [];
  const aggregatedLineLabels: string[] = [];

  collection.features.forEach((feature, featureIndex) => {
    const baseLabel = getUploadedBoundaryLabel(feature.properties, featureIndex);
    const geometry = feature.geometry;
    if (!geometry) return;

    if (geometry.type === "Polygon") {
      const coords = toShapefileLeafletCoords((geometry as Polygon).coordinates[0] as number[][]);
      if (coords.length >= 3) boundaries.push({ key: `${featureIndex}-0`, label: baseLabel, kind: "polygon", coords });
    } else if (geometry.type === "MultiPolygon") {
      const multi = geometry as MultiPolygon;
      multi.coordinates.forEach((polygonCoords, partIndex) => {
        const coords = toShapefileLeafletCoords(polygonCoords[0] as number[][]);
        if (coords.length >= 3) boundaries.push({
          key: `${featureIndex}-${partIndex}`,
          label: multi.coordinates.length > 1 ? `${baseLabel} (part ${partIndex + 1})` : baseLabel,
          kind: "polygon", coords,
        });
      });
    } else if (geometry.type === "LineString") {
      const lineCoords = (geometry as LineString).coordinates as number[][];
      const coords = toShapefileLeafletCoords(lineCoords);
      if (coords.length >= 2) { aggregatedLineCoords.push(lineCoords); aggregatedLineLabels.push(baseLabel); }
    } else if (geometry.type === "MultiLineString") {
      (geometry as MultiLineString).coordinates.forEach((lineCoords) => {
        const coords = toShapefileLeafletCoords(lineCoords as number[][]);
        if (coords.length >= 2) { aggregatedLineCoords.push(lineCoords as number[][]); aggregatedLineLabels.push(baseLabel); }
      });
    }
  });

  if (aggregatedLineCoords.length > 0) {
    const lineCoordsSets = aggregatedLineCoords.map((lc) => toShapefileLeafletCoords(lc)).filter((c) => c.length >= 2);
    boundaries.push({
      key: "uploaded-lines",
      label: aggregatedLineLabels.length === 1 ? aggregatedLineLabels[0] : `Imported Lines (${aggregatedLineCoords.length} features)`,
      kind: "line",
      lineCoordsSets,
    });
  }

  return boundaries;
}

type GradeBucket = {
  label: string;
  aliases: string[];
  maxPercent?: number;
};

const GRADE_BUCKETS: GradeBucket[] = [
  { label: "<=2% (1:25)", maxPercent: 2, aliases: ["<=2 degrees (1:25)", "<=4% (1:25)"] },
  { label: "2.9% (1:20)", maxPercent: 2.9, aliases: ["2.9 degrees (1:20)", "5% (1:20)"] },
  { label: "3.8% (1:15)", maxPercent: 3.8, aliases: ["3.8 degrees (1:15)", "6.7% (1:15)"] },
  { label: "4.7% (1:12)", maxPercent: 4.7, aliases: ["4.7 degrees (1:12)", "8.3% (1:12)", "< 5 Degrees"] },
  { label: ">=5%", aliases: [">=5 degrees", ">8.3% (>1:12)", "=/> 5 Degrees"] },
];
const GRADE_FILTER_OPTIONS = GRADE_BUCKETS.map(({ label }) => label);
const ROAD_SPEED_LIMIT_FILTER_OPTIONS = ["NA", "30 km/h", "40 km/h", "50 km/h", "60 km/h", "70 km/h", "80 km/h", "90 km/h"];
export const CROSSING_TYPE_FILTER_OPTIONS = ["Zebra Crossing", "Signalised PC", "Bicycle Crossing", "Unsignalised Junction", "Development Access"];

/** Ordering comparator honouring an explicit label order; unknown labels sort last. */
export const compareByOrder = (left: string, right: string, order: string[]): number => {
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  if (leftIndex === -1 && rightIndex === -1) return 0;
  if (leftIndex === -1) return 1;
  if (rightIndex === -1) return -1;
  return leftIndex - rightIndex;
};

/** Semantic (non-alphabetical) category order for known attributes, else null. */
export const getSemanticCategoryOrder = (attributeName: string | null | undefined): string[] | null => {
  if (!attributeName) return null;
  if (SAFETY_FOCUS_ATTRIBUTES.has(attributeName)) return ["Low", "Medium", "High", "Extreme"];
  if (attributeName === "Facility Width per Direction") return ["Very Narrow", "Narrow", "Wide"];
  if (attributeName === "Grade") return GRADE_FILTER_OPTIONS;
  if (attributeName === "Road speed limit") return ROAD_SPEED_LIMIT_FILTER_OPTIONS;
  if (attributeName === "Crossing Type") return CROSSING_TYPE_FILTER_OPTIONS;
  return null;
};

/** Buckets a raw Gradient % into the canonical Grade filter label. */
export const getGradeBucketFromPercent = (gradientPct: number): string => {
  const absoluteGradientPercent = Math.abs(gradientPct);
  return GRADE_BUCKETS.find((bucket) => bucket.maxPercent === undefined || absoluteGradientPercent <= bucket.maxPercent)?.label ?? GRADE_BUCKETS[GRADE_BUCKETS.length - 1].label;
};

/** Normalises legacy Grade label spellings (degrees / alternative ratios) to the canonical bucket label. */
export const normalizeGradeLabel = (value: string): string => {
  const normalizedValue = value.trim();
  const matchingBucket = GRADE_BUCKETS.find(({ label, aliases }) => label === normalizedValue || aliases.includes(normalizedValue));
  return matchingBucket?.label ?? normalizedValue;
};

/** Maps a free-text crossing description to one of the canonical Crossing Type filter labels (or null). */
export const normalizeCrossingTypeLabel = (value: string): string | null => {
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) return null;
  if (normalizedValue.includes("zebra")) return "Zebra Crossing";
  if (normalizedValue.includes("signalised") || normalizedValue.includes("signalized")) return "Signalised PC";
  if (normalizedValue.includes("bicycle crossing") || normalizedValue.includes("pedestrian cum bicycle crossing")) return "Bicycle Crossing";
  if (normalizedValue.includes("unsignalised junction") || normalizedValue.includes("unsignalized junction")) return "Unsignalised Junction";
  if (normalizedValue.includes("development access")) return "Development Access";
  return null;
};

/** Per-project data bundle loaded from the shared project cache. */
export type ProjectData = {
  projectName: string;
  geoFeatures: Feature<LineString, any>[];
  attributes: AttributeRow[];
  scores: Record<string, any>[]; // Raw crash type scores (BB, SB, VB, BP)
  color: string;
};

/** A segment that survived the active filters, ready to render on the map. */
export type VisibleSegment = {
  idx: number;
  latlng: [number, number];
  f: Feature<LineString, any>;
  attributes: AttributeRow;
  projectName: string;
  projectColor: string;
  scores: Record<string, any> | null;
};

/** CSV helper: escape CSV values with proper quoting. */
export const escapeCSV = (value: string): string => {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};
