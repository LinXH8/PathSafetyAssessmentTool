/**
 * Central registry for every sessionStorage and localStorage key string used
 * across the application. Import from here instead of inlining raw strings
 * so every cross-page contract is auditable in a single place.
 *
 * Rules:
 *   - Key strings are FROZEN — never rename them. Existing user sessions store
 *     JSON under the live key string; renaming silently loses persisted state.
 *   - Only containers and custom hooks may read/write storage. Layout shells
 *     must never touch sessionStorage or localStorage (frontend/CLAUDE.md §0
 *     rule 2). Use `useSessionState` (hooks/useSessionState.ts) in containers.
 *   - Add new keys here before using them anywhere else in the codebase.
 */

// ── sessionStorage keys ───────────────────────────────────────────────────────

/** sessionStorage keys — SPA-session lifespan (cleared on tab close). */
export const SESSION_KEYS = {
  // ─── Path Analysis container state ─────────────────────────────────────────
  /** Projects the user explicitly selected to load into Path Analysis. */
  PA_SELECTED_PROJECTS:         "pathAnalysis_selectedProjects",
  /** Projects currently loaded in the Path Analysis page. */
  PA_LOADED_PROJECTS:           "pathAnalysis_loadedProjects",
  /** Active filter attribute list in Path Analysis. */
  PA_ACTIVE_FILTERS:            "pathAnalysis_activeFilters",
  /** Projects hidden from the Path Analysis view. */
  PA_HIDDEN_PROJECTS:           "pathAnalysis_hiddenProjects",
  /** Category-status array used by Report Builder for colouring filtered segments. */
  PA_CATEGORY_STATUS:           "pathAnalysis_categoryStatus",
  // ─── Path Analysis filtered-segment data (consumed by Report Builder) ───────
  /** Per-project map of visible (filtered) segment indices. */
  PA_FILTERED_SEGMENTS:         "pathAnalysis_filteredSegments",
  /** Per-project, per-segment, per-filter attribute values for recolouring. */
  PA_FILTERED_SEGMENT_VALUES:   "pathAnalysis_filteredSegmentValues",
  // ─── Path Analysis map view state ──────────────────────────────────────────
  /**
   * Persisted map center + zoom so back-navigation from CodingPage restores
   * the viewport the user left. Cleared on a deliberate Projects-page reselect.
   * See CLAUDE.md §"PathAnalysisPage: Slow Reload + Flash + Lost View On Return".
   */
  PA_MAP_VIEWPORT:              "pathAnalysisMap_viewport",
  /** Per-attribute, per-value category toggle state (Layer 2 filters). */
  PA_MAP_CATEGORY_TOGGLES:      "pathAnalysisMap_categoryToggles",
  /** Per-child-attribute, per-value subcategory toggle state (Layer 3 filters). */
  PA_MAP_SUBCATEGORY_TOGGLES:   "pathAnalysisMap_subcategoryToggles",
  /** Per-attribute numeric range filter bounds. */
  PA_MAP_RANGE_FILTERS:         "pathAnalysisMap_rangeFilters",
  /** Index into the active filter list that drives the category colour legend. */
  PA_MAP_CATEGORY_FILTER_INDEX: "pathAnalysisMap_categoryFilterIndex",
  /** Attribute name currently driving the primary colouring of map segments. */
  PA_MAP_PRIMARY_FOCUS:         "pathAnalysisMap_primaryFocus",
  // ─── Coding page ────────────────────────────────────────────────────────────
  /**
   * Filter context written by PathAnalysisMapView when the user clicks a segment
   * to open CodingPage. Consumed by CodingPage's `resolveFilterContext()`.
   * See CLAUDE.md §"CodingPage: Filter Colors Leak" for the full lifecycle.
   */
  CODING_FILTER_CONTEXT:        "codingFilterContext",
  // ─── Treatment page ─────────────────────────────────────────────────────────
  /** Projects loaded in the Treatment page — read by Report Builder to scope its data. */
  TREATMENT_LOADED_PROJECTS:    "treatment_loadedProjects",
  /** Filter context passed from PathAnalysisPage when opening Treatment in filtered mode. */
  TREATMENT_FILTER_CONTEXT:     "treatment_filterContext",
  // ─── Shared project selection ───────────────────────────────────────────────
  /**
   * Shared project-selection set, kept in sync across the Home page and the
   * v2 Quick Select sidebar via CustomEvent broadcast. Managed by
   * `features/projectSelection.ts` — do not read or write this key directly.
   */
  PROJECT_SELECTION:            "psat:projectSelection",
} as const;

/** Type union of every sessionStorage key string. */
export type SessionKey = (typeof SESSION_KEYS)[keyof typeof SESSION_KEYS];

/**
 * Named alias for `SESSION_KEYS.CODING_FILTER_CONTEXT`.
 * Exported under the legacy name so existing call sites can migrate their
 * import path from `api/projects` to `constants/sessionKeys` without changing
 * the local identifier.
 */
export const CODING_FILTER_CONTEXT_KEY: "codingFilterContext" =
  SESSION_KEYS.CODING_FILTER_CONTEXT;

// ── localStorage keys ─────────────────────────────────────────────────────────

/** localStorage keys — persisted across browser sessions. */
export const LOCAL_KEYS = {
  /**
   * Which UI version to render (`"v1"` | `"v2"`). Resolution order:
   * URL `?ui=` param → this key → default `"v2"`.
   * Managed exclusively by `features/ui/useUiVersion.ts`.
   */
  UI_VERSION:           "psat:uiVersion",
  /**
   * Saved report-builder layout (section order, visibility, Top-N).
   * Read by Sidebar, PathAnalysisMapView, and TreatmentDetailPage to toggle
   * "Generate Report" vs "Continue Report".
   * Written/read by `ReportBuilderPage/reportBuilderPage.tsx`.
   */
  REPORT_LAYOUT:        "psat_report_layout",
  /**
   * Prefix for per-project GIS layer toggle snapshots. Always build the full
   * key with `gisLayerToggleKey(projectName)` — never concatenate manually.
   */
  GIS_LAYER_TOGGLES_PREFIX: "gisLayerToggles_",
  /**
   * Persistent folder-summary stats cache (segment count / quarter / distance)
   * for the Create Project page. Managed exclusively by
   * `CreateProjectPage/folderSummaryCache.ts` — do not read or write elsewhere.
   */
  FOLDER_SUMMARY_CACHE: "psat:create:folderSummaries:v1",
} as const;

/** Type union of every localStorage key string (or prefix). */
export type LocalKey = (typeof LOCAL_KEYS)[keyof typeof LOCAL_KEYS];

/**
 * Returns the full localStorage key for a project's GIS layer toggles.
 * Always use this helper — never inline the template — so the key derivation
 * stays in one place.
 */
export function gisLayerToggleKey(projectName: string): string {
  return `${LOCAL_KEYS.GIS_LAYER_TOGGLES_PREFIX}${projectName}`;
}
