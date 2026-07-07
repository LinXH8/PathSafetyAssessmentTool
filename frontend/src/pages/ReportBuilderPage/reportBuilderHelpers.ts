/**
 * reportBuilderHelpers.ts — pure helper functions for the Report Builder page.
 *
 * Extracted verbatim from `reportBuilderPage.tsx` (S2.5 decomposition). All
 * functions here are stateless: they derive report data from score rows
 * (`buildCoreDataset`), compute the page-break-aware flow layout
 * (`avoidPageBreak` / `computeFlowLayout`), format quarter labels
 * (`dateToQuarterLabel`), and read the persisted layout blob (`readSavedLayout`).
 *
 * Side effects: `readSavedLayout` reads `localStorage` (guarded, never throws).
 */
import { LOCAL_KEYS } from "../../constants/sessionKeys";
import type {
  Distributions, ElementState,
  ReportDataset, ScoreStats, StatEntry, TopRiskRow,
} from "./reportBuilderTypes";
import { PAGE_GAP, PAGE_H } from "./reportBuilderConstants";

// ── Quarter utilities ────────────────────────────────────────────────────────
/** Map an ISO date (`YYYY-MM`) to a `Q<n> <year>` label. */
export function dateToQuarterLabel(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  return `Q${Math.ceil(month / 3)} ${year}`;
}

/**
 * Pure derivation of every score-based value from a row set. `treatmentSummaries`
 * is added by the caller since it depends on async treatment state.
 */
export function buildCoreDataset(
  rows: TopRiskRow[],
  loadedProjects: string[],
): Omit<ReportDataset, "treatmentSummaries"> {
  const projectSegmentCounts: Record<string, number> = {};
  rows.forEach((r) => { projectSegmentCounts[r._project] = (projectSegmentCounts[r._project] || 0) + 1; });
  const projects = loadedProjects.filter((p) => (projectSegmentCounts[p] ?? 0) > 0);
  const totalSegments = rows.length;
  const totalKm = totalSegments * 10 / 1000;

  if (rows.length === 0) {
    return { rows, distributions: null, allBandMap: new Map(), totalSegments, totalKm, projectSegmentCounts, projects, topRiskRows: [], scoreStats: null, attributeFrequency: [] };
  }

  const dist: Distributions = {
    VB: { 1: 0, 2: 0, 3: 0, 4: 0 }, BB: { 1: 0, 2: 0, 3: 0, 4: 0 },
    SB: { 1: 0, 2: 0, 3: 0, 4: 0 }, BP: { 1: 0, 2: 0, 3: 0, 4: 0 },
    Overall: { 1: 0, 2: 0, 3: 0, 4: 0 },
  };
  const bMap = new Map<string, number>();
  rows.forEach((row) => {
    if (row["VB Band"] >= 1 && row["VB Band"] <= 4) dist.VB[row["VB Band"]]++;
    if (row["BB Band"] >= 1 && row["BB Band"] <= 4) dist.BB[row["BB Band"]]++;
    if (row["SB Band"] >= 1 && row["SB Band"] <= 4) dist.SB[row["SB Band"]]++;
    if (row["BP Band"] >= 1 && row["BP Band"] <= 4) dist.BP[row["BP Band"]]++;
    const overall = row["Overall Risk Level Band"] ??
      Math.max(row["VB Band"] || 0, row["BB Band"] || 0, row["SB Band"] || 0, row["BP Band"] || 0);
    if (overall >= 1 && overall <= 4) { dist.Overall[overall]++; bMap.set(`${row._project}_${row._segIndex}`, overall); }
  });

  const topRiskRows = [...rows].sort((a, b) => b._sumScore - a._sumScore).slice(0, 10);

  const stat = (vals: number[]): StatEntry => {
    const sorted = [...vals].sort((a, b) => a - b);
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    return { min: sorted[0].toFixed(1), max: sorted[sorted.length - 1].toFixed(1), avg: avg.toFixed(1) };
  };
  const scoreStats: ScoreStats = {
    VB: stat(rows.map((r) => r.VB || 0)),
    BB: stat(rows.map((r) => r.BB || 0)),
    SB: stat(rows.map((r) => r.SB || 0)),
    BP: stat(rows.map((r) => r.BP || 0)),
    Overall: stat(rows.map((r) => r._sumScore || 0)),
  };

  const count = new Map<string, number>();
  rows.forEach((row) => {
    for (let i = 1; i <= 3; i++) {
      const name = row[`Top ${i} Contributor` as keyof TopRiskRow] as string | undefined;
      if (name) count.set(name, (count.get(name) || 0) + 1);
    }
  });
  const attributeFrequency = [...count.entries()].sort(([, a], [, b]) => b - a).slice(0, 10) as [string, number][];

  return { rows, distributions: dist, allBandMap: bMap, totalSegments, totalKm, projectSegmentCounts, projects, topRiskRows, scoreStats, attributeFrequency };
}

// ── Page-break avoidance ──────────────────────────────────────────────────────
// If placing an element at `y` with height `h` would straddle a page break,
// push it to just after the break. Elements taller than a full page are left
// as-is (nothing we can do without splitting them).
export function avoidPageBreak(y: number, h: number, margin = 20): number {
  if (h >= PAGE_H) return y;
  // Push sections that land inside the shadow zone at the top of a new page
  const prevBreak = Math.floor(y / PAGE_H) * PAGE_H;
  if (prevBreak > 0 && y < prevBreak + margin) {
    return avoidPageBreak(prevBreak + margin, h, margin);
  }
  // Push sections that straddle the next page break, ONLY if they can fit on a single page
  const nextBreak = Math.ceil(y / PAGE_H) * PAGE_H;
  const usableH = PAGE_H - PAGE_GAP - margin;
  if (nextBreak > y && y + h > nextBreak - PAGE_GAP && h <= usableH) {
    return avoidPageBreak(nextBreak + margin, h, margin);
  }
  return y;
}

// ── Flow layout (replaces resolveOverlaps) ───────────────────────────────────
// Sections now render in document flow in array order (dnd-kit drives the order).
// This pass turns the ordered list + per-section heights into the `marginTop`
// spacer each section needs: a constant 10px gap, plus any extra push required
// so the section doesn't straddle a page break (avoidPageBreak). `top` is kept
// for reference/debug; `bottom` is the total stacked height for canvas sizing.
export interface FlowEntry { height: number; top: number; marginTop: number }
export function computeFlowLayout(
  visible: ElementState[],
  heightOf: (el: ElementState) => number,
): { map: Map<string, FlowEntry>; bottom: number } {
  const map = new Map<string, FlowEntry>();
  let cursor = 20;     // top padding before the first section
  let prevBottom = 0;  // bottom edge of the previously placed section
  for (const el of visible) {
    const height = heightOf(el);
    let top = avoidPageBreak(cursor, height);
    // Project Details chunks projects into PAGE_H-tall pages. When it spans more
    // than one page it must begin exactly on a page boundary so every internal
    // chunk boundary coincides with the PDF slice grid (real page breaks).
    if ((el.type === "projectDetails" || (el.type === "topRisk" && el.viewMode === "full-page")) && height > PAGE_H && prevBottom > 0) {
      top = Math.ceil(cursor / PAGE_H) * PAGE_H;
    }
    map.set(el.id, { height, top, marginTop: top - prevBottom });
    prevBottom = top + height;
    cursor = prevBottom + 10;
  }
  return { map, bottom: prevBottom };
}

// ── Read saved layout once (used by lazy state initialisers) ─────────────────
/** Read + parse the persisted layout blob from localStorage (null if absent). */
export function readSavedLayout(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEYS.REPORT_LAYOUT);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
