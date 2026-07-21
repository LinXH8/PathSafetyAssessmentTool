import { useCallback, useEffect, useRef, useState } from "react";

import { calculateScoreForRow, saveAttributes, updateProject } from "../../../api";
import type { AttributeRow } from "../../../api";
import { invalidateProject } from "../../../api/projectDataCache";
import { toaster } from "../../../components/ui/toaster";
import { FACILITY_WIDTH_SUBCATEGORY_MAP } from "../codingConstants";
import type { AttrMappings, ProjectDataState } from "../codingConstants";
import { applyLogicChecks } from "../codingHelpers";
import type { PendingFacilityWidthParentChange } from "../layouts/CodingViewModel";
import { savedAttrsSnapshot } from "./useProjectDataCache";

/**
 * useAttributeEditing — attribute edit state, dirty tracking, and persistence for
 * the Coding page (`/coding/:projectNames`).
 *
 * Owns:
 * - the single/multi-field row editors (`editCurrentAttr` / `editCurrentAttrMany`)
 *   with a 500ms per-row debounce that recalculates the row's score;
 * - `onEdit`, the interception layer that enforces parent/child attribute rules
 *   (Delineation, FO/NFO, Loose-or-slippery, Facility Width) by opening the forced
 *   multi-tag selection modals, and applies the CycleRAP logic checks;
 * - the pending-modal flags those interceptions set (consumed by the layouts);
 * - `saveAllProjects` — persists every dirty project's attributes + counts. It MUST
 *   call `invalidateProject` for each dirty project (see root CLAUDE.md: "Child
 *   Attribute Color Stale After Save") so PathAnalysisPage re-fetches on back-nav;
 * - the `psat:save` / `psat:discard` window-event listeners and the
 *   `window.psat_hasUnsavedChanges` flag the Sidebar's exit guard reads.
 *
 * @param params — server-data spine pieces plus current-segment derivations.
 * @returns editors, save handler, and the pending-modal state/setters for the VM.
 *
 * Side effects: network writes (saveAttributes, updateProject, /results re-fetch),
 * toaster notifications; dispatches `psat:attribute:changed`, `psat:scores:updated`,
 * `psat:verified:updated`, `psat:autocoded:updated`; listens for `psat:save` and
 * `psat:discard`; writes `window.psat_hasUnsavedChanges`; reads/writes the
 * `savedAttrsSnapshot` module singleton.
 */
export interface UseAttributeEditingParams {
  currentProjectName: string | null;
  projectList: string[];
  projectData: Record<string, ProjectDataState>;
  updateProjectData: (projectName: string, updates: Partial<ProjectDataState>) => void;
  attrs: AttributeRow[];
  // Typed via indexed access — scores rows are untyped upstream (ProjectDataState).
  scores: ProjectDataState["scores"];
  editedRow: AttributeRow | null;
  currentAttr: AttributeRow | null;
  currentIndex: number;
  attrMappings: AttrMappings;
}

export function useAttributeEditing({
  currentProjectName,
  projectList,
  projectData,
  updateProjectData,
  attrs,
  scores,
  editedRow,
  currentAttr,
  currentIndex,
  attrMappings,
}: UseAttributeEditingParams) {
  // Forced multi-tag selection modal flags (set by onEdit's parent/child rules)
  const [pendingPresentDelineationChange, setPendingPresentDelineationChange] = useState(false);
  const [pendingNotPresentDelineationChange, setPendingNotPresentDelineationChange] = useState(false);
  const [pendingPresentFOChange, setPendingPresentFOChange] = useState(false);
  const [pendingPresentNFOChange, setPendingPresentNFOChange] = useState(false);
  const [pendingPresentSlipperyChange, setPendingPresentSlipperyChange] = useState(false);
  const [pendingPresentDefectChange, setPendingPresentDefectChange] = useState(false);
  const [pendingFacilityWidthParentChange, setPendingFacilityWidthParentChange] =
    useState<PendingFacilityWidthParentChange | null>(null);

  // Debounce handles for per-row score recalculation
  const scoreDebounceRef = useRef<Record<number, number>>({});

  // Cleanup score-recalc debounce timers on unmount
  useEffect(() => {
    return () => {
      Object.values(scoreDebounceRef.current).forEach(timeout => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      });
      scoreDebounceRef.current = {};
    };
  }, []);

  /** Atomically update multiple fields on the current row, then debounce score recalculation. */
  const editCurrentAttrMany = useCallback(
    (updates: Record<string, string | number | boolean | null>) => {
      if (!currentProjectName || !attrs?.[currentIndex]) return;
      const updatedRow = { ...attrs[currentIndex], ...updates };
      updateProjectData(currentProjectName, {
        attrs: attrs.map((row, i) => (i === currentIndex ? updatedRow : row)),
        isDirty: true,
      });
      // Dispatch for the first changed field (sufficient for validation listener)
      const firstField = Object.keys(updates)[0];
      if (firstField !== undefined) {
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field: firstField, value: updates[firstField] }
        }));
      }
      const currentIdx = currentIndex;
      if (scoreDebounceRef.current[currentIdx] !== undefined) {
        clearTimeout(scoreDebounceRef.current[currentIdx]);
      }
      scoreDebounceRef.current[currentIdx] = window.setTimeout(async () => {
        if (!currentProjectName) return;
        try {
          const newScore = await calculateScoreForRow(currentProjectName, updatedRow);
          updateProjectData(currentProjectName, {
            scores: scores.map((score, i) =>
              i === currentIdx ? { ...score, ...newScore } : score
            ),
          });
          window.dispatchEvent(new CustomEvent("psat:scores:updated"));
        } catch {}
      }, 500);
    },
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentIndex, currentProjectName, attrs, scores]
  );

  // Reusable save function
  const saveAllProjects = useCallback(async (): Promise<boolean> => {
    if (projectList.length === 0) return true;

    try {
      // Only save projects that actually have unsaved changes
      const dirtyProjects = projectList.filter(projName => projectData[projName]?.isDirty);

      if (dirtyProjects.length > 0) {
        const savePromises = dirtyProjects.map(projName => {
          const projData = projectData[projName];
          if (!projData?.attrs) return Promise.resolve();

          const attrsAtSaveTime = projData.attrs;
          return Promise.all([
            saveAttributes(projName, attrsAtSaveTime),
            updateProject(projName, {
              autocoded_segment_count: projData.autocodedSegmentCount ?? 0,
              verified_segment_count: projData.verifiedSegmentCount ?? 0
            })
          ]).then(() => {
            savedAttrsSnapshot[projName] = attrsAtSaveTime;
          });
        });

        await Promise.all(savePromises);

        // Invalidate PathAnalysis cache so back-navigation sees fresh attributes/results
        dirtyProjects.forEach(projName => invalidateProject(projName));

        // Mark saved projects as clean
        dirtyProjects.forEach(projName => {
          updateProjectData(projName, { isDirty: false });
        });

        // Re-fetch scores for saved projects to reflect backend updates
        for (const projName of dirtyProjects) {
          try {
            const res = await fetch(`/api/projects/${encodeURIComponent(projName)}/results`);
            if (res.ok) {
              const result = await res.json();
              if (result.ok && result.result_rows) {
                updateProjectData(projName, { scores: result.result_rows });
              }
            }
          } catch (e) {
            // Ignore fetch error, user just won't see updated scores immediately
          }
        }
      }

      // Dispatch events to update Projects page for all projects (counts may have changed)
      projectList.forEach(projName => {
        const projData = projectData[projName];
        if (projData) {
          window.dispatchEvent(new CustomEvent("psat:verified:updated", {
            detail: { projectName: projName, verifiedSegmentCount: projData.verifiedSegmentCount ?? 0 }
          }));
          window.dispatchEvent(new CustomEvent("psat:autocoded:updated", {
            detail: { projectName: projName, autocodedSegmentCount: projData.autocodedSegmentCount ?? 0 }
          }));
        }
      });

      toaster.create({
        title: "Saved",
        description: dirtyProjects.length > 0
          ? `${dirtyProjects.length} project(s) saved successfully.`
          : "Nothing to save.",
        type: "success"
      });
      return true;

    } catch (e: unknown) {
      toaster.create({
        title: "Save failed",
        description: e instanceof Error ? e.message : String(e),
        type: "error"
      });
      return false;
    }
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectList, projectData]);

  // Save handler - saves all loaded projects (attributes + metadata)
  useEffect(() => {
    function handleSaveEvent() {
      saveAllProjects();
    }

    window.addEventListener("psat:save", handleSaveEvent);
    return () => window.removeEventListener("psat:save", handleSaveEvent);
  }, [saveAllProjects]);

  // Keep window.psat_hasUnsavedChanges in sync so Sidebar can skip the dialog when there are no real changes
  useEffect(() => {
    (window as any).psat_hasUnsavedChanges = projectList.some(projName => {
      const current = projectData[projName]?.attrs;
      const snapshot = savedAttrsSnapshot[projName];
      if (!current || !snapshot) return false;
      return JSON.stringify(current) !== JSON.stringify(snapshot);
    });
  }, [projectData, projectList]);

  // Revert all projects to their last-saved snapshot when the sidebar dispatches psat:discard
  useEffect(() => {
    function handleDiscard() {
      projectList.forEach(projName => {
        const snapshot = savedAttrsSnapshot[projName];
        if (snapshot) updateProjectData(projName, { attrs: snapshot, isDirty: false });
      });
    }
    window.addEventListener("psat:discard", handleDiscard);
    return () => window.removeEventListener("psat:discard", handleDiscard);
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectList]);

  // Update edited row when current row changes
  useEffect(() => {
    if (!currentProjectName) return;
    updateProjectData(currentProjectName, {
      editedRow: currentAttr ? { ...currentAttr } : null,
    });
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAttr, currentProjectName]);

  // Handlers for attribute editing
  const onAttrChange = useCallback(
    (key: string, value: string | number | boolean | null) => {
      if (!currentProjectName) return;
      updateProjectData(currentProjectName, {
        editedRow: editedRow ? { ...editedRow, [key]: value } : null,
      });
    },
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [editedRow, currentProjectName]
  );

  const editCurrentAttr = (field: string, value: string | number | boolean | null) => {
    if (!currentProjectName || !attrs || !attrs[currentIndex]) return;

    const updatedRow = { ...attrs[currentIndex], [field]: value };

    updateProjectData(currentProjectName, {
      attrs: attrs.map((row, i) =>
        i === currentIndex ? updatedRow : row
      ),
      isDirty: true,
    });

    // Dispatch event to notify validation component of attribute change
    window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
      detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
    }));

    const currentIdx = currentIndex;

    if (scoreDebounceRef.current[currentIdx] !== undefined) {
      clearTimeout(scoreDebounceRef.current[currentIdx]);
    }

    scoreDebounceRef.current[currentIdx] = window.setTimeout(async () => {
      if (!currentProjectName) return;

      try {
        const newScore = await calculateScoreForRow(currentProjectName, updatedRow);

        updateProjectData(currentProjectName, {
          scores: scores.map((score, i) =>
            i === currentIdx
              ? { ...score, ...newScore }
              : score
          ),
        });

        window.dispatchEvent(new CustomEvent("psat:scores:updated"));
      } catch {
      }
    }, 500);
  };

  // Intercept "Delineation" transitions to force Delineation Type selection
  const onEdit = useCallback((field: string, value: string | number | boolean | null) => {
    if (field === "Delineation") {
      const prevVal = attrs[currentIndex]?.["Delineation"];
      if (value === 2 && Number(prevVal) === 1) {
        // Present → Not Present: clear Delineation Type, then prompt for Absent/In Poor Condition
        if (!currentProjectName || !attrs || !attrs[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Delineation": value, "Delineation Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field: "Delineation", value }
        }));
        setPendingNotPresentDelineationChange(true);
        return;
      }
      if (value === 1 && Number(prevVal) === 2) {
        // Not Present → Present: atomically set Delineation=Present and clear Delineation Type,
        // then force category selection. Two separate editCurrentAttr calls would race on the
        // same stale attrs snapshot, causing the second write to overwrite the first.
        if (!currentProjectName || !attrs || !attrs[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Delineation": value, "Delineation Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field: "Delineation", value }
        }));
        setPendingPresentDelineationChange(true);
        return;
      }
    }
    // --- Fixed Obstacle on Facility ---
    if (field === "Fixed Obstacle on Facility") {
      const prevVal = attrs[currentIndex]?.["Fixed Obstacle on Facility"];
      if (value === 2 && Number(prevVal) === 1) {
        // Present → Not Present: null out FO Type atomically
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Fixed Obstacle on Facility": value, "FO Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        const currentIdx = currentIndex;
        if (scoreDebounceRef.current[currentIdx] !== undefined) clearTimeout(scoreDebounceRef.current[currentIdx]);
        scoreDebounceRef.current[currentIdx] = window.setTimeout(async () => {
          if (!currentProjectName) return;
          try {
            const newScore = await calculateScoreForRow(currentProjectName, updatedRow);
            updateProjectData(currentProjectName, {
              scores: scores.map((score, i) => i === currentIdx ? { ...score, ...newScore } : score),
            });
            window.dispatchEvent(new CustomEvent("psat:scores:updated"));
          } catch {}
        }, 500);
        return;
      }
      if (value === 1 && Number(prevVal) === 2) {
        // Not Present → Present: clear FO Type, force selection
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Fixed Obstacle on Facility": value, "FO Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        setPendingPresentFOChange(true);
        return;
      }
    }

    // --- Non-Fixed Obstacle on Facility ---
    if (field === "Non-Fixed Obstacle on Facility") {
      const prevVal = attrs[currentIndex]?.["Non-Fixed Obstacle on Facility"];
      if (value === 2 && Number(prevVal) === 1) {
        // Present → Not Present: null out NFO Type atomically
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Non-Fixed Obstacle on Facility": value, "NFO Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        const currentIdx = currentIndex;
        if (scoreDebounceRef.current[currentIdx] !== undefined) clearTimeout(scoreDebounceRef.current[currentIdx]);
        scoreDebounceRef.current[currentIdx] = window.setTimeout(async () => {
          if (!currentProjectName) return;
          try {
            const newScore = await calculateScoreForRow(currentProjectName, updatedRow);
            updateProjectData(currentProjectName, {
              scores: scores.map((score, i) => i === currentIdx ? { ...score, ...newScore } : score),
            });
            window.dispatchEvent(new CustomEvent("psat:scores:updated"));
          } catch {}
        }, 500);
        return;
      }
      if (value === 1 && Number(prevVal) === 2) {
        // Not Present → Present: clear NFO Type, force selection
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Non-Fixed Obstacle on Facility": value, "NFO Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        setPendingPresentNFOChange(true);
        return;
      }
    }

    // --- Loose or slippery surface ---
    if (field === "Loose or slippery surface") {
      const prevVal = attrs[currentIndex]?.["Loose or slippery surface"];
      if (value === 2 && Number(prevVal) === 1) {
        // Present → Not Present: null out Issue Type (Slippery) atomically
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Loose or slippery surface": value, "Issue Type (Slippery)": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        const currentIdx = currentIndex;
        if (scoreDebounceRef.current[currentIdx] !== undefined) clearTimeout(scoreDebounceRef.current[currentIdx]);
        scoreDebounceRef.current[currentIdx] = window.setTimeout(async () => {
          if (!currentProjectName) return;
          try {
            const newScore = await calculateScoreForRow(currentProjectName, updatedRow);
            updateProjectData(currentProjectName, {
              scores: scores.map((score, i) => i === currentIdx ? { ...score, ...newScore } : score),
            });
            window.dispatchEvent(new CustomEvent("psat:scores:updated"));
          } catch {}
        }, 500);
        return;
      }
      if (value === 1 && Number(prevVal) === 2) {
        // Not Present → Present: clear Issue Type (Slippery), force selection
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Loose or slippery surface": value, "Issue Type (Slippery)": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        setPendingPresentSlipperyChange(true);
        return;
      }
    }

    // --- Major Surface Deformation or Drain Opening ---
    if (field === "Major Surface Deformation or Drain Opening") {
      const prevVal = attrs[currentIndex]?.["Major Surface Deformation or Drain Opening"];
      if (value === 2 && Number(prevVal) === 1) {
        // Present → Not Present: null out Defect Type atomically
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Major Surface Deformation or Drain Opening": value, "Defect Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        const currentIdx = currentIndex;
        if (scoreDebounceRef.current[currentIdx] !== undefined) clearTimeout(scoreDebounceRef.current[currentIdx]);
        scoreDebounceRef.current[currentIdx] = window.setTimeout(async () => {
          if (!currentProjectName) return;
          try {
            const newScore = await calculateScoreForRow(currentProjectName, updatedRow);
            updateProjectData(currentProjectName, {
              scores: scores.map((score, i) => i === currentIdx ? { ...score, ...newScore } : score),
            });
            window.dispatchEvent(new CustomEvent("psat:scores:updated"));
          } catch {}
        }, 500);
        return;
      }
      if (value === 1 && Number(prevVal) === 2) {
        // Not Present → Present: clear Defect Type, force selection
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Major Surface Deformation or Drain Opening": value, "Defect Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        setPendingPresentDefectChange(true);
        return;
      }
    }

    // --- Facility Width per Direction ---
    if (field === "Facility Width per Direction") {
      const codeStr = String(value);
      const dict = attrMappings["Facility Width per Direction"];
      const newCategoryLabel = dict?.[codeStr] ?? null;
      const subCategories = newCategoryLabel ? FACILITY_WIDTH_SUBCATEGORY_MAP[newCategoryLabel] : null;

      if (newCategoryLabel && subCategories) {
        const currentSubCat = (attrs[currentIndex]?.["Facility Width Sub-category"] as string | null) ?? null;
        const isCompatible = !!currentSubCat && subCategories.includes(currentSubCat);

        if (isCompatible) {
          editCurrentAttr(field, value);
          return;
        }

        const originalParentCode = (attrs[currentIndex]?.["Facility Width per Direction"] as string | number | null) ?? null;
        editCurrentAttrMany({
          "Facility Width per Direction": value,
          "Facility Width Sub-category": null,
        });
        setPendingFacilityWidthParentChange({
          categoryLabel: newCategoryLabel,
          subCategories,
          originalParentCode,
          originalSubCategory: currentSubCat,
        });
        return;
      }
    }

    const row = attrs[currentIndex];
    const { extraUpdates, notifications: logicNotifs } = applyLogicChecks(field, value, row ?? {});
    if (Object.keys(extraUpdates).length > 0) {
      editCurrentAttrMany({ [field]: value, ...extraUpdates });
    } else {
      editCurrentAttr(field, value);
    }
    const infoNotifs = logicNotifs.filter(n => !n.isWarning);
    const warnNotifs = logicNotifs.filter(n => n.isWarning);
    if (infoNotifs.length > 0) {
      toaster.create({
        title: "Logic check",
        description: infoNotifs.map(n => n.description).join(" · "),
        type: "info",
      });
    }
    for (const w of warnNotifs) {
      toaster.create({
        title: "Logic check warning",
        description: w.description,
        type: "warning",
      });
    }
  }, [attrs, currentIndex, editCurrentAttr, editCurrentAttrMany, attrMappings, currentProjectName, updateProjectData]);

  return {
    editCurrentAttr,
    editCurrentAttrMany,
    onAttrChange,
    onEdit,
    saveAllProjects,
    pendingPresentDelineationChange,
    setPendingPresentDelineationChange,
    pendingNotPresentDelineationChange,
    setPendingNotPresentDelineationChange,
    pendingPresentFOChange,
    setPendingPresentFOChange,
    pendingPresentNFOChange,
    setPendingPresentNFOChange,
    pendingPresentSlipperyChange,
    setPendingPresentSlipperyChange,
    pendingPresentDefectChange,
    setPendingPresentDefectChange,
    pendingFacilityWidthParentChange,
    setPendingFacilityWidthParentChange,
  };
}
