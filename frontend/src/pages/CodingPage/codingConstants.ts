import type { Feature } from "geojson";
import type { AttributeRow } from "../../api";

/**
 * Shared types + constants for the Coding page, extracted from codingPage.tsx so
 * that both the container (codingPage.tsx) and the layout shells
 * (layouts/CodingLayout*.tsx) can import them without a circular dependency.
 *
 * Only the items needed by BOTH the container and a layout live here. Container-
 * only helpers (migrations, logic checks, the per-project cache singletons) stay
 * in codingPage.tsx; render-only helpers (PresentMultiTagModal,
 * getParentCategoryForSubcat, PANEL_HEIGHT) live in CodingLayoutV1.tsx.
 */

export type ProjectDetail = { name: string; versions: string[]; latest: string };
export type AttrMappings = Record<string, Record<string, string>>;

// Per-project data state held in the container and surfaced to the layouts via
// the view-model.
export type ProjectDataState = {
  detail: ProjectDetail | null;
  attrs: AttributeRow[];
  geoFeatures: Feature[];
  scores: any[];
  currentPage: number;
  changedFieldsByRow: Record<number, string[]>;
  fieldSourcesByRow: Record<number, Record<string, string>>;
  loading: boolean;
  error: string | null;
  editedRow: AttributeRow | null;
  verified?: boolean;
  verifiedSegmentCount?: number;
  autocodedSegmentCount?: number;
  isDirty?: boolean;
};

export const FO_TYPE_SUGGESTIONS = ["Lamp Post", "Traffic Light", "Covered Linkway Pole", "Bollard", "Billboard", "Sign Pole", "Railing", "Utility Box", "Vegetation", "Others"];
export const NFO_TYPE_SUGGESTIONS = ["Barrier", "Bin", "Bicycle", "Cone", "Others"];

export const FACILITY_WIDTH_SUBCATEGORY_MAP: Record<string, string[]> = {
  "Very Narrow": ["≤1.5m", ">1.5–1.8m", ">1.8–<2m"],
  "Narrow": ["2–<3.5m", "3.5–4m"],
  "Wide": [">4m"],
};
