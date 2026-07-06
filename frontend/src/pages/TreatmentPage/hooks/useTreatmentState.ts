/**
 * @file useTreatmentState.ts
 * Owns `treatmentState` — the per-global-index record of "has this segment had
 * treatments applied, and what were the after-treatment scores" — plus the
 * three effects that populate it:
 *  1. a background bulk load (one `getAllTreatments` call per project) once
 *     `projectMap` is known, so the page can render before treatment state
 *     arrives;
 *  2. a per-segment load whenever the viewed segment changes (or a manual
 *     `refreshTrigger` bump), which also drives `showPostTreatment`;
 *  3. `window` listeners for `psat:treat:all:completed` / `psat:reset:all:completed`,
 *     dispatched by the bulk "By Treatment" apply-to-all flow and the
 *     Reset-All flow respectively.
 *
 * Also derives `appliedTreatmentIds`/`segmentHasTreatments` for the current
 * segment, since both are pure lookups into `treatmentState`.
 */
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { getAllTreatments, getSegmentTreatments } from "../../../api";
import type { ScoreType } from "../treatmentConstants";
import type { ProjectMapEntry } from "./useProjectMapping";

export type TreatmentStateMap = Record<
  number,
  { applied: boolean; treatment_ids: number[]; after_scores: ScoreType | null }
>;

export interface UseTreatmentStateParams {
  projectNames: string[];
  projectMap: ProjectMapEntry[];
  resolveIndex: (globalIndex: number) => { name: string; localIndex: number } | null;
  currentIndex: number;
  /** Bumped to force a re-fetch of the current segment's treatment state. */
  refreshTrigger: number;
  /** Re-fetches the aggregated project data; called after a Reset-All completes. */
  fetchData: () => void | Promise<void>;
  setRefreshTrigger: Dispatch<SetStateAction<number>>;
  setSelectedTreatments: Dispatch<SetStateAction<Set<number>>>;
  setPreviewScores: Dispatch<SetStateAction<ScoreType | null>>;
  setShowPostTreatment: Dispatch<SetStateAction<boolean>>;
}

export interface UseTreatmentStateResult {
  treatmentState: TreatmentStateMap;
  setTreatmentState: Dispatch<SetStateAction<TreatmentStateMap>>;
  /** Treatment ids applied to the currently viewed segment (empty if none). */
  appliedTreatmentIds: number[];
  /** Whether the currently viewed segment has any applied treatments. */
  segmentHasTreatments: boolean;
}

/**
 * Loads and keeps `treatmentState` in sync across background bulk loads,
 * per-segment refreshes, and the Treat-All / Reset-All completion events.
 */
export function useTreatmentState(params: UseTreatmentStateParams): UseTreatmentStateResult {
  const {
    projectNames,
    projectMap,
    resolveIndex,
    currentIndex,
    refreshTrigger,
    fetchData,
    setRefreshTrigger,
    setSelectedTreatments,
    setPreviewScores,
    setShowPostTreatment,
  } = params;

  const [treatmentState, setTreatmentState] = useState<TreatmentStateMap>({});

  // Load treatment state in background AFTER page is already visible
  useEffect(() => {
    if (projectNames.length === 0 || projectMap.length === 0) return;

    let cancelled = false;
    (async () => {
      const newTreatmentState: Record<number, any> = {};
      await Promise.all(projectNames.map(async (name) => {
        const projectInfo = projectMap.find(p => p.name === name);
        if (!projectInfo) return;
        try {
          const { segments } = await getAllTreatments(name);
          for (const [localIdxStr, seg] of Object.entries(segments)) {
            if (seg.has_treatments) {
              const globalIndex = projectInfo.startIndex + parseInt(localIdxStr, 10);
              newTreatmentState[globalIndex] = {
                applied: true,
                treatment_ids: seg.treatments_applied,
                after_scores: seg.after_scores ? {
                  BB: seg.after_scores.BB,
                  BP: seg.after_scores.BP,
                  SB: seg.after_scores.SB,
                  VB: seg.after_scores.VB,
                  total: seg.after_scores["Overall Risk Level"],
                } : null,
              };
            }
          }
        } catch (e) {
          console.error(`Failed to load treatments for ${name}:`, e);
        }
      }));
      if (!cancelled && Object.keys(newTreatmentState).length > 0) {
        setTreatmentState(newTreatmentState);
      }
    })();

    return () => { cancelled = true; };
  }, [projectNames, projectMap]);

  // Listen for Treat All completion event
  useEffect(() => {
    const handleTreatAllCompleted = (event: Event) => {
      const customEvent = event as CustomEvent;
      const details = customEvent.detail; // Array of treatment details (now with projectName)

      if (details && Array.isArray(details)) {
        // Map treatment details to global indices based on projectMap
        setTreatmentState((prevState) => {
          const newState = { ...prevState };

          details.forEach((detail: any) => {
            const projectName = detail.projectName;
            const localIndex = detail.segment_index;
            const afterScores = detail.after_scores;

            // Find the project in projectMap to get the start index
            const project = projectMap.find(p => p.name === projectName);
            if (project) {
              const globalIndex = project.startIndex + localIndex;
              newState[globalIndex] = {
                applied: true,
                treatment_ids: detail.treatments_applied || detail.treatment_ids || [],
                after_scores: afterScores ? {
                  BB: afterScores.BB,
                  BP: afterScores.BP,
                  SB: afterScores.SB,
                  VB: afterScores.VB,
                  total: afterScores["Overall Risk Level"],
                } : null,
              };
            }
          });

          return newState;
        });

        setRefreshTrigger(prev => prev + 1);
      } else {
        setRefreshTrigger(prev => prev + 1);
        setTreatmentState({});
      }
    };

    const handleResetAllCompleted = () => {
      fetchData();
      setRefreshTrigger(prev => prev + 1);
      setTreatmentState({}); // Clear all local treatment states
      setSelectedTreatments(new Set()); // Clear selection
      setPreviewScores(null); // Clear preview
    };

    window.addEventListener("psat:treat:all:completed", handleTreatAllCompleted);
    window.addEventListener("psat:reset:all:completed", handleResetAllCompleted);

    return () => {
      window.removeEventListener("psat:treat:all:completed", handleTreatAllCompleted);
      window.removeEventListener("psat:reset:all:completed", handleResetAllCompleted);
    };
    // matches pre-extraction deps exactly: fetchData/setRefreshTrigger/setSelectedTreatments/
    // setPreviewScores are referentially stable (useCallback / setState setters), so only
    // projectMap drives re-attach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectMap]);

  // Load treatment state when segment changes
  useEffect(() => {
    const ctx = resolveIndex(currentIndex);
    if (!ctx) return;

    let cancelled = false;

    (async () => {
      try {
        const state = await getSegmentTreatments(ctx.name, ctx.localIndex);
        if (cancelled) return;

        if (state.has_treatments) {
          // Refresh the authoritative cache for this segment; the seeding effect below
          // re-ticks the checkboxes from treatmentState (no spurious auto-save).
          setTreatmentState((prev) => ({
            ...prev,
            [currentIndex]: {
              applied: true,
              treatment_ids: state.treatments_applied,
              after_scores: state.after_scores
                ? {
                  BB: state.after_scores.BB,
                  BP: state.after_scores.BP,
                  SB: state.after_scores.SB,
                  VB: state.after_scores.VB,
                  total: state.after_scores["Overall Risk Level"],
                }
                : null,
            },
          }));
          setShowPostTreatment(true);
        } else {
          setShowPostTreatment(false);
        }
      } catch (e) {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
    // matches pre-extraction deps exactly: setShowPostTreatment is a stable setState setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveIndex, currentIndex, refreshTrigger]);

  const appliedTreatmentIds = useMemo(() => {
    return treatmentState[currentIndex]?.treatment_ids ?? [];
  }, [currentIndex, treatmentState]);

  const segmentHasTreatments = treatmentState[currentIndex]?.applied === true;

  return { treatmentState, setTreatmentState, appliedTreatmentIds, segmentHasTreatments };
}
