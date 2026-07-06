/**
 * @file useTreatmentEngine.ts
 * Owns the "By Segment" view's click-driven auto-save engine for treatment
 * application (see root CLAUDE.md "TreatmentDetailPage: By-Segment Auto-Save").
 *
 * Design invariants preserved EXACTLY from the pre-extraction container (do not
 * "improve" these without re-reading the CLAUDE.md write-up first):
 *  - Saves are CLICK-DRIVEN, not state-diff-driven: `scheduleSegmentSave` is the
 *    only way a save is scheduled. Nothing here reacts to `selectedTreatments`
 *    changing on its own, so seeding the checkbox set can never trigger a write.
 *  - `pendingSaveRef` holds a flush function for a debounced save that hasn't
 *    fired yet; the container flushes it on segment change / unmount so a
 *    toggle-then-navigate within the 300ms debounce window is never dropped.
 *  - `persistSegmentTreatments` always syncs `treatmentState` (even when
 *    `silent`), so the checkbox reflects the persisted set correctly on
 *    back-navigation; only the CURRENT-view UI (preview scores, post-treatment
 *    toggle, autosave status) is skipped when `silent` is true.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { applyTreatments } from "../../../api";
import type { ScoreType } from "../treatmentConstants";

type TreatmentStateMap = Record<
  number,
  { applied: boolean; treatment_ids: number[]; after_scores: ScoreType | null }
>;

export interface UseTreatmentEngineParams {
  /** Current global segment index being viewed. */
  currentIndex: number;
  /** Maps a global index to its owning project + local index. */
  resolveIndex: (globalIndex: number) => { name: string; localIndex: number } | null;
  /** Image reference sent alongside the apply call (unused server-side beyond logging). */
  imgRef?: string;
  setTreatmentState: Dispatch<SetStateAction<TreatmentStateMap>>;
  setPreviewScores: Dispatch<SetStateAction<ScoreType | null>>;
  setShowPostTreatment: Dispatch<SetStateAction<boolean>>;
}

export interface UseTreatmentEngineResult {
  autoSaveStatus: "idle" | "saving" | "saved";
  /** Debounced (300ms), click-driven auto-save for the segment view. */
  scheduleSegmentSave: (ids: number[]) => void;
}

/**
 * Provides the segment-view auto-save engine: a debounced, click-driven
 * `scheduleSegmentSave` that persists a segment's checked treatment ids via
 * `POST /treatments/apply`, keeps `treatmentState` in sync, and flushes any
 * pending save when the viewed segment changes (so navigating away never
 * silently drops the last toggle).
 */
export function useTreatmentEngine(params: UseTreatmentEngineParams): UseTreatmentEngineResult {
  const { currentIndex, resolveIndex, imgRef, setTreatmentState, setPreviewScores, setShowPostTreatment } = params;

  // Inline auto-save status for the "By Segment" view (replaces the Apply button)
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  // Debounce timer for the segment-view auto-save (click-driven).
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds a flush fn for a debounced auto-save that hasn't fired yet, so navigating
  // away (segment change / unmount) can persist it instead of dropping it.
  const pendingSaveRef = useRef<null | (() => void)>(null);

  // Persist a segment's checked treatments. `silent` skips current-view UI updates
  // (used when flushing on navigate-away) but always syncs the local treatment cache.
  const persistSegmentTreatments = useCallback(
    async (projectName: string, localIndex: number, savedGlobalIndex: number, ids: number[], silent: boolean) => {
      pendingSaveRef.current = null;
      if (!silent) setAutoSaveStatus("saving");
      try {
        const result = await applyTreatments(projectName, {
          segment_index: localIndex,
          treatment_ids: ids, // empty array resets the segment
          image_ref: imgRef,
        });
        const appliedIds = result.treatments_applied
          ? result.treatments_applied.split(",").map((x) => Number(x.trim())).filter((x) => !isNaN(x))
          : [];
        const afterScores =
          appliedIds.length > 0
            ? {
                BB: result.after_scores.BB,
                BP: result.after_scores.BP,
                SB: result.after_scores.SB,
                VB: result.after_scores.VB,
                total: result.after_scores["Overall Risk Level"],
              }
            : null;
        // Keep the local cache in sync so the checkbox stays ticked on back-navigation.
        setTreatmentState((prev) => {
          const next = { ...prev };
          if (appliedIds.length > 0) {
            next[savedGlobalIndex] = { applied: true, treatment_ids: appliedIds, after_scores: afterScores };
          } else {
            delete next[savedGlobalIndex];
          }
          return next;
        });
        if (!silent) {
          setPreviewScores(afterScores);
          setShowPostTreatment(appliedIds.length > 0);
          setAutoSaveStatus("saved");
          setTimeout(() => setAutoSaveStatus("idle"), 1500);
        }
      } catch (e) {
        if (!silent) setAutoSaveStatus("idle");
      }
    },
    // matches pre-extraction deps exactly: setTreatmentState/setPreviewScores/
    // setShowPostTreatment are stable setState setters, intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imgRef]
  );

  // Debounced auto-save for the segment view, driven by user clicks (not state diffing,
  // so seeding the checkbox set from persisted state never triggers a spurious write).
  const scheduleSegmentSave = useCallback(
    (ids: number[]) => {
      const ctx = resolveIndex(currentIndex);
      if (!ctx) return;
      const savedGlobalIndex = currentIndex;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Flush fn used on navigate-away so a still-pending change is never dropped.
      pendingSaveRef.current = () => {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        void persistSegmentTreatments(ctx.name, ctx.localIndex, savedGlobalIndex, ids, true);
      };
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void persistSegmentTreatments(ctx.name, ctx.localIndex, savedGlobalIndex, ids, false);
      }, 300);
    },
    [resolveIndex, currentIndex, persistSegmentTreatments]
  );

  // Flush any pending (debounced) auto-save when the user navigates to another
  // segment or leaves the page, so a quick toggle-then-navigate is never lost.
  useEffect(() => {
    return () => {
      const flush = pendingSaveRef.current;
      if (flush) {
        pendingSaveRef.current = null;
        void flush();
      }
    };
  }, [currentIndex]);

  return { autoSaveStatus, scheduleSegmentSave };
}
