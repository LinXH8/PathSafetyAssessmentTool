/**
 * Typed seam for the Path Analysis page (the "don't break this" interface).
 *
 * `pathAnalysisPage.tsx` (the container) owns all server state, sessionStorage
 * keys and the `projectDataCache` contracts; it assembles ONE of these objects
 * and hands it to whichever shell (`PathAnalysisLayoutV1` / `PathAnalysisLayoutV2`)
 * is active. Both shells consume this identical contract — the shell is a pure
 * function of this object and must never fetch, own server state, or touch
 * sessionStorage directly (see temp/UI_V2_REDESIGN_GUIDE.md §3).
 */

export interface PathAnalysisChartData {
  categoryDistributionData: { category: string; count: number; color: string; breakdown?: { name: string; count: number }[] }[];
  primaryFocusAttribute: string | null;
  categoryStatus: {
    attribute: string;
    categories: {
      category: string;
      isActive: boolean;
      color: string;
      subcategories?: { name: string; isActive: boolean; color: string }[];
    }[];
    rangeFilter?: { min: number; max: number; currentMin: number; currentMax: number };
  }[];
  totalSegmentsLoaded: number;
  totalSegmentsViewed: number;
}

export interface PathAnalysisViewModel {
  // ── data ──────────────────────────────────────────────────────────────
  /** Every project loaded into the page (drives Overall Risk Level + Map). */
  loadedProjects: string[];
  /** `loadedProjects` minus `hiddenProjects` — what the map actually plots. */
  visibleProjects: string[];
  /** Active filter attribute names (max 5), shared with the map view. */
  activeFilters: string[];
  /** Projects toggled off on the map. */
  hiddenProjects: string[];
  /**
   * Per-project visible (filtered) segment indices reported by the map view so
   * the Top Risk Contributors panel can react to active filters. `null` until
   * the map first reports (panel then aggregates all segments).
   */
  visibleSegmentsByProject: Record<string, number[]> | null;
  /** Derived distribution / category-status data pushed up by the map view. */
  chartData: PathAnalysisChartData;

  // ── callbacks ─────────────────────────────────────────────────────────
  onActiveFiltersChange: (filters: string[]) => void;
  onHiddenProjectsChange: (hidden: string[]) => void;
  onVisibleSegmentsChange: (byProject: Record<string, number[]>) => void;
  onChartDataUpdate: (data: PathAnalysisChartData) => void;
}
