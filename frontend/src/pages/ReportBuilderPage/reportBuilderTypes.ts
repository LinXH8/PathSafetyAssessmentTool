/**
 * reportBuilderTypes.ts — shared type definitions for the Report Builder page.
 *
 * Pure type module (no runtime code) extracted verbatim from
 * `reportBuilderPage.tsx` during the S2.5 decomposition. These describe the
 * report's section model (`ElementState`), the score-derived dataset bundle
 * (`ReportDataset` + its parts), enrichment/treatment payloads, and the
 * Path-Analysis filter-context snapshot the report restores from sessionStorage.
 *
 * Side effects: none.
 */
import type { FeatureCollection } from "geojson";

/** The distinct report sections a user can show / hide / reorder. */
export type ElementType =
  | "title" | "riskBands" | "map" | "summary" | "topRisk" | "treatmentSummary"
  | "projectDetails" | "riskStats" | "topAttributes" | "recommendations" | "methodology" | "segmentGallery"
  | "benchmarkStats";

/** Render mode for list-style sections (currently only Top Risk Stretches). */
export type ViewMode = "grid" | "tabular" | "full-page";

/** One report section's persisted layout + display state. */
export interface ElementState {
  id: string; type: ElementType; label: string;
  x: number; y: number; width: number; height: number;
  visible: boolean; viewMode?: ViewMode; topN?: number;
  // When true this is a "(Filtered)" duplicate that renders from the
  // Path-Analysis-filtered segment subset instead of all loaded segments.
  filtered?: boolean;
  // Map sections only: which filter attribute to colour segments by (a name from
  // the active Path Analysis filters). Undefined ⇒ default risk-band colouring.
  colorBy?: string;
}

/** Band (1–4) → segment count. */
export type BandDist = Record<number, number>;

/** Per-crash-type band distributions plus the combined "Overall". */
export interface Distributions {
  VB: BandDist; BB: BandDist; SB: BandDist; BP: BandDist; Overall: BandDist;
}

/** A single scored segment row (a `/results` row augmented with derived fields). */
export interface TopRiskRow {
  _project: string; _segIndex: number; _sumScore: number; _maxBand: number;
  VB: number; "VB Band": number; BB: number; "BB Band": number;
  SB: number; "SB Band": number; BP: number; "BP Band": number;
  "Overall Risk Level Band"?: number;
  "Top 1 Contributor"?: string; "Top 1 Contribution"?: number;
  "Top 2 Contributor"?: string; "Top 2 Contribution"?: number;
  "Top 3 Contributor"?: string; "Top 3 Contribution"?: number;
  "Top 4 Contributor"?: string; "Top 4 Contribution"?: number;
  "Top 5 Contributor"?: string; "Top 5 Contribution"?: number;
}

/** Per-segment image + top attributes + post-treatment enrichment. */
export interface EnrichedDetail {
  imageUrl?: string;
  topAttributes: { name: string; multiplier: number }[];
  postImageUrl?: string;
  postScores?: {
    VB: number; VB_Band: number;
    BB: number; BB_Band: number;
    SB: number; SB_Band: number;
    BP: number; BP_Band: number;
    Overall: number; Overall_Band: number;
  };
}

/** Treatment coverage summary for one project. */
export interface ProjectTreatmentSummary {
  project: string;
  treatedSegments: number;
  treatmentCounts: Record<number, number>;
}

export interface GeoEntry { name: string; data: FeatureCollection }
export interface StatEntry { min: string; max: string; avg: string }
export interface ScoreStats {
  VB: StatEntry; BB: StatEntry; SB: StatEntry; BP: StatEntry; Overall: StatEntry;
}

export interface FilterSubcategoryItem { name: string; isActive: boolean; color: string }
export interface FilterCategoryItem { category: string; isActive: boolean; color: string; subcategories?: FilterSubcategoryItem[] }
export interface FilterCategoryStatus {
  attribute: string;
  categories: FilterCategoryItem[];
  rangeFilter?: { min: number; max: number; currentMin: number; currentMax: number };
}

/**
 * All score-derived values a section needs. Computed once for the full segment
 * set and once for the filtered subset, so the same render code can serve both.
 */
export interface ReportDataset {
  rows: TopRiskRow[];
  distributions: Distributions | null;
  allBandMap: Map<string, number>;
  totalSegments: number;
  totalKm: number;
  projectSegmentCounts: Record<string, number>;
  projects: string[];               // loaded projects present in this dataset
  topRiskRows: TopRiskRow[];        // top 10 by summed score
  scoreStats: ScoreStats | null;
  attributeFrequency: [string, number][];
  treatmentSummaries: ProjectTreatmentSummary[];
}
