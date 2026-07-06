/**
 * @file useTreatmentAnalysis.ts
 * Owns the treatment-effectiveness / impact-analysis derivations for the
 * Treatment page: per-treatment effectiveness counts (fetched per project),
 * the ranked list of applicable treatments, before/after risk-band
 * distributions, the "% improved" headline stat, the after-treatment score
 * rows fed to the map, per-segment score-drop ranking for the "By Segment"
 * view, and the current segment's modified-attribute preview.
 *
 * Gotcha carried over from the pre-extraction container (see root CLAUDE.md
 * "Score Drops Disappear After Data Loads"): `segmentScoreDrops` is cleared by
 * the container's `gotoPage` on every navigation; this hook only re-populates
 * it when `accordionView === "segment"` and `currentIndex` changes. Do not
 * clear it here on unrelated re-renders.
 */
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { getTreatmentEffectiveness, getTreatmentSegmentEffectiveness } from "../../../api";
import type { AttributeRow } from "../../../api";
import {
  applyTreatmentEffects,
  calculateBandDistributions,
  calculateBandFromScore,
  getApplicableTreatments,
  type Treatment,
} from "../treatmentConstants";
import type { ProjectMapEntry } from "./useProjectMapping";
import type { TreatmentStateMap } from "./useTreatmentState";

export interface UseTreatmentAnalysisParams {
  projectMap: ProjectMapEntry[];
  attrs: AttributeRow[];
  scope: { start: number; count: number };
  isAllScope: boolean;
  activeProject: string;
  filterMode: boolean;
  filteredGlobalIndexSet: Set<number>;
  treatmentState: TreatmentStateMap;
  scores: Record<string, any>[];
  pageIndices: number[];
  accordionView: "segment" | "treatment";
  currentIndex: number;
  resolveIndex: (globalIndex: number) => { name: string; localIndex: number } | null;
  /** Applied + staged treatment ids for the current segment (used for the attribute preview). */
  combinedTreatmentIds: number[];
}

export interface BandCounts {
  VB: Record<number, number>;
  BB: Record<number, number>;
  SB: Record<number, number>;
  BP: Record<number, number>;
  Overall: Record<number, number>;
}

export interface UseTreatmentAnalysisResult {
  effectivenessLoading: boolean;
  allApplicableTreatments: Treatment[];
  effectivenessCounts: Record<number, number>;
  applicableCounts: Record<number, number>;
  segmentScoreDrops: Record<number, number>;
  setSegmentScoreDrops: Dispatch<SetStateAction<Record<number, number>>>;
  fullyAppliedTreatments: Set<number>;
  beforeBandCounts: BandCounts;
  afterBandCounts: BandCounts;
  afterTreatmentScores: Record<string, any>[];
  effectivenessLabel: string;
  improvedSegmentCount: number;
  modifiedAttrs: AttributeRow | null;
  changedAttributes: Set<string>;
  changedFieldSources: Record<string, string>;
}

/**
 * Derives every treatment-effectiveness / impact-analysis value the Treatment
 * page's cards and maps need, and fetches the two effectiveness endpoints
 * (`getTreatmentEffectiveness` per project, `getTreatmentSegmentEffectiveness`
 * per viewed segment) that back them.
 */
export function useTreatmentAnalysis(params: UseTreatmentAnalysisParams): UseTreatmentAnalysisResult {
  const {
    projectMap,
    attrs,
    scope,
    isAllScope,
    activeProject,
    filterMode,
    filteredGlobalIndexSet,
    treatmentState,
    scores,
    pageIndices,
    accordionView,
    currentIndex,
    resolveIndex,
    combinedTreatmentIds,
  } = params;

  // Effectiveness = # of segments whose Overall Risk Level Band improves when the
  // treatment is applied in isolation. Raw per-project counts are fetched once per
  // project set; effectivenessCounts/applicableCounts below aggregate them per the
  // active scope (all projects, or just the selected tab).
  const [perProjectEff, setPerProjectEff] = useState<Record<string, { counts: Record<number, number>; applicable: Record<number, number> }>>({});
  const [effectivenessLoading, setEffectivenessLoading] = useState<boolean>(false);

  const { effectivenessCounts, applicableCounts } = useMemo(() => {
    const names = isAllScope ? Object.keys(perProjectEff) : [activeProject];
    const counts: Record<number, number> = {};
    const applicable: Record<number, number> = {};
    for (const name of names) {
      const r = perProjectEff[name];
      if (!r) continue;
      for (const [tidStr, c] of Object.entries(r.counts)) counts[+tidStr] = (counts[+tidStr] ?? 0) + (c ?? 0);
      for (const [tidStr, c] of Object.entries(r.applicable)) applicable[+tidStr] = (applicable[+tidStr] ?? 0) + (c ?? 0);
    }
    return { effectivenessCounts: counts, applicableCounts: applicable };
  }, [perProjectEff, isAllScope, activeProject]);

  // Score drop for each treatment applied in isolation on the currently viewed segment.
  // Keyed by treatment id; populated when accordionView === "segment" and currentIndex changes.
  const [segmentScoreDrops, setSegmentScoreDrops] = useState<Record<number, number>>({});

  const allApplicableTreatments = useMemo(() => {
    if (!attrs || attrs.length === 0) return [];

    const uniqueMap = new Map<number, Treatment>();
    // Only consider segments within the active focus scope (and, in filter mode, the
    // filtered subset).
    for (let i = scope.start; i < scope.start + scope.count; i++) {
      if (filterMode && !filteredGlobalIndexSet.has(i)) continue;
      const row = attrs[i];
      if (!row) continue;
      const applicable = getApplicableTreatments(row as any);
      applicable.forEach(t => {
        if (!uniqueMap.has(t.id)) {
          uniqueMap.set(t.id, t);
        }
      });
    }

    return Array.from(uniqueMap.values()).sort((a, b) => {
      const ea = effectivenessCounts[a.id] ?? 0;
      const eb = effectivenessCounts[b.id] ?? 0;
      if (eb !== ea) return eb - ea;
      return a.id - b.id;
    });
  }, [attrs, effectivenessCounts, scope, filterMode, filteredGlobalIndexSet]);

  const fullyAppliedTreatments = useMemo(() => {
    const fullyApplied = new Set<number>();

    allApplicableTreatments.forEach(t => {
      let applicableCount = 0;
      let appliedCount = 0;

      for (let i = scope.start; i < scope.start + scope.count; i++) {
        if (filterMode && !filteredGlobalIndexSet.has(i)) continue;
        const attr = attrs[i] as any;
        if (!attr) continue;
        const applicable = getApplicableTreatments(attr);
        if (applicable.some(x => x.id === t.id)) {
          applicableCount++;
          if (treatmentState[i]?.applied && treatmentState[i]?.treatment_ids?.includes(t.id)) {
            appliedCount++;
          }
        }
      }

      if (applicableCount > 0 && applicableCount === appliedCount) {
        fullyApplied.add(t.id);
      }
    });

    return fullyApplied;
  }, [allApplicableTreatments, attrs, treatmentState, scope, filterMode, filteredGlobalIndexSet]);

  // Calculate before treatment band distributions (navigable segments within the active
  // scope — the filtered subset in filter mode, otherwise the whole scope window).
  const beforeBandCounts = useMemo(() => {
    return calculateBandDistributions(pageIndices.map(gi => scores[gi]).filter(Boolean));
  }, [scores, pageIndices]);

  // Calculate after treatment band distributions (navigable segments within the active scope)
  const afterBandCounts = useMemo(() => {
    const treatedSegments = pageIndices.map((index) => {
      const scoreRow = scores[index];
      if (!scoreRow) return null;
      const state = treatmentState[index];
      if (!state?.applied || !state.after_scores) {
        return scoreRow; // Not treated, return original
      }

      const bbBand = calculateBandFromScore(state.after_scores.BB, 'BB');
      const bpBand = calculateBandFromScore(state.after_scores.BP, 'BP');
      const sbBand = calculateBandFromScore(state.after_scores.SB, 'SB');
      const vbBand = calculateBandFromScore(state.after_scores.VB, 'VB');
      const overallBand = Math.max(bbBand, bpBand, sbBand, vbBand);

      // Create new row with after-treatment scores
      return {
        ...scoreRow,
        "BB": state.after_scores.BB,
        "BB Band": bbBand,
        "BP": state.after_scores.BP,
        "BP Band": bpBand,
        "SB": state.after_scores.SB,
        "SB Band": sbBand,
        "VB": state.after_scores.VB,
        "VB Band": vbBand,
        "Overall Risk Level": state.after_scores.total,
        "Overall Risk Level Band": overallBand,
      };
    });
    return calculateBandDistributions(treatedSegments.filter(Boolean) as Record<string, any>[]);
  }, [scores, treatmentState, pageIndices]);

  // Effectiveness — % AND count of in-scope segments whose Overall Risk Level band
  // improved (dropped) after the applied treatments. Drives the v2 top row.
  const { effectivenessLabel, improvedSegmentCount } = useMemo(() => {
    if (scope.count === 0) return { effectivenessLabel: "0%", improvedSegmentCount: 0 };
    let improved = 0;
    for (let i = scope.start; i < scope.start + scope.count; i++) {
      const orig = scores[i];
      const state = treatmentState[i];
      if (!orig || !state?.applied || !state.after_scores) continue;
      const beforeOverall = Math.max(
        calculateBandFromScore(orig["BB"], "BB"),
        calculateBandFromScore(orig["BP"], "BP"),
        calculateBandFromScore(orig["SB"], "SB"),
        calculateBandFromScore(orig["VB"], "VB"),
      );
      const afterOverall = Math.max(
        calculateBandFromScore(state.after_scores.BB, "BB"),
        calculateBandFromScore(state.after_scores.BP, "BP"),
        calculateBandFromScore(state.after_scores.SB, "SB"),
        calculateBandFromScore(state.after_scores.VB, "VB"),
      );
      if (afterOverall < beforeOverall) improved++;
    }
    return { effectivenessLabel: `${Math.round((improved / scope.count) * 100)}%`, improvedSegmentCount: improved };
  }, [scores, treatmentState, scope]);

  // Create after-treatment scores for map visualization
  const afterTreatmentScores = useMemo(() => {
    return scores.map((scoreRow, index) => {
      const state = treatmentState[index];
      if (!state?.applied || !state.after_scores) {
        return scoreRow; // Not treated, return original
      }
      // Create new row with after-treatment scores
      return {
        ...scoreRow,
        "BB": state.after_scores.BB,
        "BP": state.after_scores.BP,
        "SB": state.after_scores.SB,
        "VB": state.after_scores.VB,
        "Overall Risk Level": state.after_scores.total,
      };
    });
  }, [scores, treatmentState]);

  // Compute modified attributes and changed attributes for the current segment
  // using both applied treatments and any pending selections.
  const { modifiedAttrs, changedAttributes, changedFieldSources } = useMemo(() => {
    const currentAttrs = attrs[currentIndex] || null;
    if (!currentAttrs || combinedTreatmentIds.length === 0) {
      return { modifiedAttrs: currentAttrs, changedAttributes: new Set<string>(), changedFieldSources: {} };
    }
    const { modifiedRow, changedAttributes: changed } = applyTreatmentEffects(
      currentAttrs,
      combinedTreatmentIds
    );
    const sources: Record<string, string> = {};
    changed.forEach((attr) => {
      sources[attr] = "Treatment";
    });
    return { modifiedAttrs: modifiedRow, changedAttributes: changed, changedFieldSources: sources };
  }, [attrs, combinedTreatmentIds, currentIndex]);

  // Fetch per-treatment effectiveness counts per project, stored raw so the
  // active scope can aggregate them (all projects, or just the selected tab).
  useEffect(() => {
    if (projectMap.length === 0) return;

    let cancelled = false;
    setEffectivenessLoading(true);
    (async () => {
      try {
        const results = await Promise.all(
          projectMap.map(p => getTreatmentEffectiveness(p.name).catch(() => null))
        );
        if (cancelled) return;

        const byProject: Record<string, { counts: Record<number, number>; applicable: Record<number, number> }> = {};
        results.forEach((r, i) => {
          const name = projectMap[i]?.name;
          if (!name || !r || !r.ok) return;
          const counts: Record<number, number> = {};
          const applicable: Record<number, number> = {};
          for (const [tidStr, count] of Object.entries(r.counts)) {
            const tid = parseInt(tidStr, 10);
            if (Number.isFinite(tid)) counts[tid] = count ?? 0;
          }
          for (const [tidStr, count] of Object.entries(r.applicable_counts ?? {})) {
            const tid = parseInt(tidStr, 10);
            if (Number.isFinite(tid)) applicable[tid] = count ?? 0;
          }
          byProject[name] = { counts, applicable };
        });
        setPerProjectEff(byProject);
      } finally {
        if (!cancelled) setEffectivenessLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [projectMap]);

  // Fetch per-treatment score drops for the current segment to rank the "By Segment" list.
  useEffect(() => {
    if (accordionView !== "segment") return;
    const ctx = resolveIndex(currentIndex);
    if (!ctx) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await getTreatmentSegmentEffectiveness(ctx.name, ctx.localIndex);
        if (cancelled || !result.ok) return;
        const drops: Record<number, number> = {};
        for (const [tidStr, drop] of Object.entries(result.score_drops)) {
          const tid = parseInt(tidStr, 10);
          if (Number.isFinite(tid)) drops[tid] = drop;
        }
        setSegmentScoreDrops(drops);
      } catch {
        // non-fatal: list will remain in default order
      }
    })();

    return () => { cancelled = true; };
  }, [accordionView, currentIndex, resolveIndex]);

  return {
    effectivenessLoading,
    allApplicableTreatments,
    effectivenessCounts,
    applicableCounts,
    segmentScoreDrops,
    setSegmentScoreDrops,
    fullyAppliedTreatments,
    beforeBandCounts,
    afterBandCounts,
    afterTreatmentScores,
    effectivenessLabel,
    improvedSegmentCount,
    modifiedAttrs,
    changedAttributes,
    changedFieldSources,
  };
}
