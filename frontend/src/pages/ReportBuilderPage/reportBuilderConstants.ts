/**
 * reportBuilderConstants.ts — static layout geometry, label maps, default
 * section layouts, and shared table styles for the Report Builder page.
 *
 * Extracted verbatim from `reportBuilderPage.tsx` (S2.5 decomposition). All
 * values are module-level constants — no component state, no side effects.
 * `DEFAULT_ELEMENTS` / `FILTERED_ELEMENTS` seed the section list; the `CANVAS_W`
 * / `PAGE_H` / `PAGE_GAP` geometry is load-bearing for the PDF page-break grid
 * (see `computeFlowLayout` and `handleDownloadPDF`).
 */
import type React from "react";
import type { ElementState } from "./reportBuilderTypes";

// ── Canvas / page geometry ───────────────────────────────────────────────────
export const CANVAS_W = 794;
export const PAGE_H = 1123;
export const PAGE_GAP = 24;

// ── Project Details paging ───────────────────────────────────────────────────
// Project Details renders ALL projects, chunked into pages of PROJ_PAGE_SIZE.
// Each non-final chunk is sized to exactly one PAGE_H so its boundary lands on
// the PDF page-break grid (a real page break in the report), instead of a
// click-to-paginate widget. Heights below are generous per-project estimates
// used both for chunk-fit and section sizing.
export const PROJ_PAGE_SIZE = 5;
export const PROJ_ROW_H = 188; // est. height of one project's detail block
export const PROJ_HEADER_H = 66;  // full section header (first chunk)
export const PROJ_CONT_HEADER_H = 30; // "(continued)" header (later chunks)

export const CRASH_TYPE_LABELS: Record<string, string> = {
  Overall: "Overall Risk", VB: "Vehicle–Bicycle", BB: "Bicycle–Bicycle",
  SB: "Single-Bicycle", BP: "Bicycle–Pedestrian",
};

// CycleRAP v2.14 STM treatment IDs/names (kept in sync with
// backend/app/services/data/stm_v214_treatments.json).
export const TREATMENT_NAMES: Record<number, string> = {
  1: "Upgrade existing facility to an on-road bicycle lane with light segregation",
  2: "Upgrade existing facility to an on-road bicycle lane with safety barrier (Adjacent road lane 0-1m)",
  3: "Upgrade existing facility to an on-road bicycle lane with safety barrier (Adjacent road lane 1-3m)",
  4: "Upgrade existing facility to a cycling-priority street",
  5: "Upgrade existing facility to a cycling-priority street (mph)",
  6: "Upgrade existing facility to a multi-use path",
  7: "Upgrade existing facility to an off-road bicycle path",
  8: "Upgrade existing facility to a one-way bicycle facility",
  9: "Improve surface conditions",
  10: "Fix surface deformation or upgrade drain opening",
  11: "Install light segregation",
  12: "Install lighting",
  13: "Clear facility – Remove fixed obstacle/s",
  14: "Clear facility – Remove non-fixed obstacle/s",
  15: "Clear facility – Remove width restriction",
  16: "Improve facility access",
  17: "Redesign the curve",
  18: "Improve line of sight (sight distance)",
  19: "Widen the facility",
  20: "Install protective barrier",
  21: "Improve delineation",
  22: "Review intersection approach",
  23: "Improve safety of crossing design",
  24: "Evaluate need for grade separated crossing",
  25: "Remove or reconfigure parking",
  26: "Review configuration of train/tram rails",
  27: "Install traffic calming (km/h)",
  28: "Install traffic calming (mph)",
  29: "Vehicles speed control",
  30: "Bicycles speed control",
};

export const METHODOLOGY_TEXT = `This report uses the CycleRAP (Cycling Road Assessment Programme) methodology to assess the safety of cycling infrastructure. Each segment is evaluated against a set of risk attributes covering facility design, surface quality, hazards, intersections, and usage patterns. A risk multiplier is computed for each attribute based on its coded value, and the combined score determines the segment's risk band (Low / Medium / High / Extreme) for four crash types: Vehicle–Bicycle (VB), Bicycle–Bicycle (BB), Single-Bicycle (SB), and Bicycle–Pedestrian (BP). Higher scores and bands indicate greater risk exposure and a greater need for intervention.`;

// ── Default layout ───────────────────────────────────────────────────────────
// Page 1: title, summary (with filters), map
// Page 2: risk bands, top risk stretches
// Page 3+: treatments, supplementary (off by default)
// Auto-fit corrects positions on first load.
export const DEFAULT_ELEMENTS: ElementState[] = [
  // — Page 1 —
  { id: "title", type: "title", label: "Title", x: 20, y: 20, width: 754, height: 205, visible: true },
  { id: "summary", type: "summary", label: "Summary", x: 20, y: 240, width: 754, height: 150, visible: true },
  { id: "map", type: "map", label: "Map", x: 20, y: 405, width: 754, height: 350, visible: true },
  // — Page 2 —
  // TEMPORARILY REMOVED: benchmarkStats. Re-enable by restoring this element and
  // removing "benchmarkStats"/"benchmarkStats_filtered" from REMOVED_IDS in
  // useReportLayout.ts. Rendering/data logic is left intact.
  // { id: "benchmarkStats", type: "benchmarkStats", label: "Benchmarking Stats", x: 20, y: 1163, width: 754, height: 340, visible: false },
  { id: "riskBands", type: "riskBands", label: "Risk Bands", x: 20, y: 1523, width: 754, height: 450, visible: true },
  { id: "topAttributes", type: "topAttributes", label: "Risk Factors", x: 20, y: 1993, width: 754, height: 210, visible: true },
  { id: "projectDetails", type: "projectDetails", label: "Project Details", x: 20, y: 2223, width: 754, height: 220, visible: true },
  // — Page 3 —
  { id: "topRisk", type: "topRisk", label: "Top Risk Stretches", x: 20, y: 2463, width: 754, height: 730, visible: true, viewMode: "full-page", topN: 10 },
  { id: "treatmentSummary", type: "treatmentSummary", label: "Treatments", x: 20, y: 3213, width: 754, height: 360, visible: true },
];

// ── Filtered sections (primary stack when a filter is active) ─────────────────
// A clone of every default section EXCEPT the title, flagged `filtered` so it
// renders from the Path-Analysis-filtered subset. When a filter is active these
// are the DEFAULT/primary sections (clean labels — no "(Filtered)" suffix), with
// the all-segments "(Overall)" stack (OVERALL_ELEMENTS) appended below only if
// the user opts in. See `toggleIncludeOverall` and the mount reconciliation.
//
// TEMPORARY: set to false to hide the toggle and suppress all filtered sections
// from the report (logic kept intact). Flip back to true to re-enable.
export const FILTERED_SECTIONS_ENABLED = true;
export const FILTERED_SUFFIX = "_filtered";
export const FILTERED_ELEMENTS: ElementState[] = DEFAULT_ELEMENTS
  .filter((e) => e.id !== "title")
  .map((e) => ({ ...e, id: `${e.id}${FILTERED_SUFFIX}`, label: e.label, filtered: true, visible: e.visible }));

// Canonical base array for filtered mode: the (unfiltered/plain) title on top,
// then the filtered primary stack.
export const FILTERED_BASE_ELEMENTS: ElementState[] = [DEFAULT_ELEMENTS[0], ...FILTERED_ELEMENTS];

// ── Overall sections (optional appended stack when a filter is active) ────────
// The all-segments clones appended BELOW the filtered stack when the user checks
// "Include overall sections". Reuse the plain DEFAULT_ELEMENTS ids (no collision
// with the `_filtered` primary stack) and carry an "(Overall)" label suffix. In
// no-filter mode DEFAULT_ELEMENTS is the base instead, so the two never coexist.
export const OVERALL_ELEMENTS: ElementState[] = DEFAULT_ELEMENTS
  .filter((e) => e.id !== "title")
  .map((e) => ({ ...e, label: `${e.label} (Overall)`, filtered: false, visible: e.visible }));

// ── Shared table styles ──────────────────────────────────────────────────────
export const thStyle: React.CSSProperties = {
  padding: "5px 8px", textAlign: "left", fontWeight: 600,
  fontSize: 10, color: "#555", borderBottom: "2px solid #e0d0f0", whiteSpace: "nowrap",
};
export const tdStyle: React.CSSProperties = { padding: "3px 6px", fontSize: 10, color: "#333" };
