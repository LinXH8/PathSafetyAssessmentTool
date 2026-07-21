import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Feature, LineString } from "geojson";

import { autocodeImage, autocodeGIS, autocodeAllStream, calculateScoreForRow } from "../../../api";
import type { AttributeRow } from "../../../api";
import { toaster } from "../../../components/ui/toaster";
import type { ProjectDataState } from "../codingConstants";
import { migrateAttrRows, normalizeAttributeValues } from "../codingHelpers";
import { defaultProjectData, projectDataCache } from "./useProjectDataCache";

/**
 * Parent -> child field(s) that must be carried along whenever the parent is
 * selectively patched. Mirrors the backend's `actual_filter` companion-append
 * list in `backend/app/api/projects/autocode.py::_bulk_gen`. Keep in sync.
 */
const COMPANION_FIELD_MAP: Record<string, string[]> = {
  "Grade": ["Gradient %"],
  "Delineation": ["Delineation Type"],
  "Major Surface Deformation or Drain Opening": ["Defect Type"],
  "Crossing Facility": ["Crossing Type"],
  "Fixed Obstacle on Facility": ["FO Type"],
  "Non-Fixed Obstacle on Facility": ["NFO Type"],
  "Curvature": ["Curvature Sub-category"],
  "Facility Width per Direction": ["Facility Width Sub-category"],
};

/**
 * useAutocode — autocode orchestration for the Coding page (`/coding/:projectNames`).
 *
 * Owns the auto-coding overlay state (running flag, message, progress, per-project
 * progress) and the four window-event-driven autocode flows dispatched by the
 * sidebar / layouts:
 *   - `psat:autocode:one`          — CV + GIS for the current segment
 *   - `psat:autocode:all`          — streaming CV + GIS for every segment
 *   - `psat:autocode:by-field`     — streaming autocode for selected attributes only
 *   - `psat:autocode:all-projects` — sequential autocode across all loaded projects
 *
 * @param params — the server-data spine pieces (from useProjectDataCache) plus the
 *   container-derived current-segment values (currentIndex/imgRef/currentFeature).
 * @returns `{ autoCoding, autoCodeMsg, progress, projectProgress }` for the ViewModel.
 *
 * Side effects: network calls (autocode endpoints, /score, /baseline,
 * /autocode-metadata), toaster notifications; dispatches `psat:scores:updated`,
 * `psat:baseline:updated`, `psat:attribute:changed`-adjacent updates via
 * updateProjectData; listens for the four `psat:autocode:*` window events.
 */
export interface UseAutocodeParams {
  currentProjectName: string | null;
  projectList: string[];
  projectData: Record<string, ProjectDataState>;
  setProjectData: Dispatch<SetStateAction<Record<string, ProjectDataState>>>;
  updateProjectData: (projectName: string, updates: Partial<ProjectDataState>) => void;
  updateAutocodedSegmentCount: (projectName: string | null, count: number) => Promise<void>;
  baselineRowsRef: MutableRefObject<AttributeRow[]>;
  attrs: AttributeRow[];
  // Typed via indexed access — scores rows are untyped upstream (ProjectDataState).
  scores: ProjectDataState["scores"];
  changedFieldsByRow: Record<number, string[]>;
  fieldSourcesByRow: Record<number, Record<string, string>>;
  currentIndex: number;
  imgRef: string | undefined;
  currentFeature: Feature | null;
}

export function useAutocode({
  currentProjectName,
  projectList,
  projectData,
  setProjectData,
  updateProjectData,
  updateAutocodedSegmentCount,
  baselineRowsRef,
  attrs,
  scores,
  changedFieldsByRow,
  fieldSourcesByRow,
  currentIndex,
  imgRef,
  currentFeature,
}: UseAutocodeParams) {
  const [autoCoding, setAutoCoding] = useState(false);
  const [autoCodeMsg, setAutoCodeMsg] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [projectProgress, setProjectProgress] = useState<Record<string, { processed: number; total: number }>>({});

  // Refs for cleanup
  const cleanupTimeoutRef = useRef<number | null>(null);
  const autoCodingRef = useRef(false);

  // Helper function to clear auto-coding state
  const clearAutoCodingState = useCallback(() => {
    setAutoCoding(false);
    setAutoCodeMsg("");
    setProgress(0);
    setProjectProgress({});
    if (cleanupTimeoutRef.current !== null) {
      clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }
  }, []);

  // Cleanup the pending clear-state timeout on unmount
  useEffect(() => {
    return () => {
      if (cleanupTimeoutRef.current !== null) {
        clearTimeout(cleanupTimeoutRef.current);
        cleanupTimeoutRef.current = null;
      }
    };
  }, []);

  // Keep autoCodingRef in sync with autoCoding state
  useEffect(() => {
    autoCodingRef.current = autoCoding;
  }, [autoCoding]);

  const applyUpdatesToCurrentRow = useCallback(
    (updates: Record<string, number | string | boolean | null>) => {
      if (!updates || Object.keys(updates).length === 0) return;
      if (!currentProjectName) return;
      setProjectData(prev => {
        const projName = currentProjectName;
        return {
          ...prev,
          [projName]: {
            ...prev[projName] || defaultProjectData,
            isDirty: true,
            attrs: (prev[projName]?.attrs || []).map((row, i) =>
              i === currentIndex ? { ...row, ...updates } : row
            ),
          },
        };
      });
    },
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentIndex, currentProjectName]
  );

  // Update the autocode baseline after autocode runs.
  // Pass fieldsToUpdate to do a selective column-only merge (preserves manual edits
  // to previously-autocoded attributes). Omit it for a full baseline replacement
  // (e.g. "autocode all" where every field is overwritten).
  const updateAutocodeBaseline = useCallback(
    (updatedAttrs: AttributeRow[], fieldsToUpdate?: string[]) => {
      if (!currentProjectName) return;
      try {
        let rowsToSave: AttributeRow[];
        if (fieldsToUpdate && fieldsToUpdate.length > 0 && baselineRowsRef.current.length > 0) {
          // Only patch the autocoded columns into the existing baseline so that
          // manual edits to other attributes are not baked into the reference values.
          rowsToSave = baselineRowsRef.current.map((baselineRow, i) => {
            const updatedRow = updatedAttrs[i];
            if (!updatedRow) return baselineRow;
            const patch: Record<string, unknown> = {};
            for (const field of fieldsToUpdate) {
              if (field in updatedRow) patch[field] = updatedRow[field];
              for (const companion of COMPANION_FIELD_MAP[field] ?? []) {
                if (companion in updatedRow) patch[companion] = updatedRow[companion];
              }
            }
            return { ...baselineRow, ...patch };
          });
        } else {
          rowsToSave = updatedAttrs;
        }
        const normalized = normalizeAttributeValues(rowsToSave);
        fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/baseline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: normalized })
        }).then(() => {
          window.dispatchEvent(new CustomEvent("psat:baseline:updated", {
            detail: { projectName: currentProjectName }
          }));
        });
      } catch (e) {
      }
    },
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentProjectName]
  );

  // Helper to save autocode metadata
  const saveAutocodeMetadata = useCallback((projName: string, changedFields: any, fieldSources: any) => {
    fetch(`/api/projects/${encodeURIComponent(projName)}/autocode-metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changedFieldsByRow: changedFields, fieldSourcesByRow: fieldSources })
    }).catch(e => console.error("Failed to save autocode metadata", e));
  }, []);

  // Auto-code one segment
  useEffect(() => {
    if (!currentProjectName) return;

    const handler = async () => {
      if (autoCodingRef.current) return;

      try {
        setAutoCoding(true);
        autoCodingRef.current = true;
        setAutoCodeMsg("Starting…");
        setProgress(5);

        if (!imgRef) throw new Error("Missing imageRef");
        if (!currentFeature || currentFeature.geometry?.type !== "LineString") {
          throw new Error("Missing LineString geometry");
        }
        const line = (currentFeature.geometry as LineString).coordinates;

        setAutoCodeMsg("Running Computer Vision…");
        setProgress(35);
        const cvPromise = autocodeImage(currentProjectName, imgRef);

        setAutoCodeMsg("Running GIS rules…");
        setProgress(65);
        const gisPromise = autocodeGIS(currentProjectName, line);

        const [cv, g] = await Promise.all([cvPromise, gisPromise]);

        setAutoCodeMsg("Merging updates…");
        setProgress(85);
        const merged = { ...(cv?.updates ?? {}), ...(g?.updates ?? {}) };

        const cvChanged = cv?.changed_fields ?? [];
        const gisChanged = g?.changed_fields ?? [];
        const allChanged = [...new Set([...cvChanged, ...gisChanged])];

        const fieldSources: Record<string, string> = {
          ...(cv?.field_sources ?? {}),
          ...(g?.field_sources ?? {}),
        };
        cvChanged.forEach(field => { if (!fieldSources[field]) fieldSources[field] = "CV"; });
        gisChanged.forEach(field => { if (!fieldSources[field]) fieldSources[field] = "GIS"; });

        updateProjectData(currentProjectName, {
          changedFieldsByRow: {
            ...changedFieldsByRow,
            [currentIndex]: allChanged
          },
          fieldSourcesByRow: {
            ...fieldSourcesByRow,
            [currentIndex]: fieldSources
          }
        });

        // Save metadata immediately
        saveAutocodeMetadata(currentProjectName, {
          ...changedFieldsByRow,
          [currentIndex]: allChanged
        }, {
          ...fieldSourcesByRow,
          [currentIndex]: fieldSources
        });

        applyUpdatesToCurrentRow(merged);

        // Update autocode baseline with new values
        const updatedAttrs = attrs.map((row, i) =>
          i === currentIndex ? { ...row, ...merged } : row
        );
        updateAutocodeBaseline(updatedAttrs);

        setProgress(95);
        if (currentProjectName && currentIndex !== undefined && attrs[currentIndex]) {
          try {
            const updatedRow = { ...attrs[currentIndex], ...merged };
            const newScore = await calculateScoreForRow(currentProjectName, updatedRow);

            updateProjectData(currentProjectName, {
              scores: scores.map((score, i) =>
                i === currentIndex ? { ...score, ...newScore } : score
              )
            });
          } catch {
          }
        }

        setProgress(100);
        setAutoCodeMsg("Done");
        toaster.create({
          title: "Auto-code (current) done",
          description: `CV + GIS updates applied. ${allChanged.length} fields changed.`,
          type: "success",
        });
      } catch (e: unknown) {
        toaster.create({
          title: "Auto-code failed",
          description: e instanceof Error ? e.message : String(e),
          type: "error",
        });
      } finally {
        if (cleanupTimeoutRef.current !== null) {
          clearTimeout(cleanupTimeoutRef.current);
        }
        cleanupTimeoutRef.current = window.setTimeout(() => {
          clearAutoCodingState();
        }, 300);
      }
    };

    window.addEventListener("psat:autocode:one", handler);
    return () => window.removeEventListener("psat:autocode:one", handler);
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectName, imgRef, currentFeature, applyUpdatesToCurrentRow, updateAutocodeBaseline, currentIndex, attrs, scores, changedFieldsByRow, fieldSourcesByRow]);

  // Auto-code all segments
  useEffect(() => {
    if (!currentProjectName) return;

    const handler = async () => {
      if (autoCodingRef.current) return;
      try {
        setAutoCoding(true);
        autoCodingRef.current = true;
        setAutoCodeMsg("CV + GIS for all records…");
        setProgress(10);
        const attrLength = attrs.length;
        setProjectProgress({ [currentProjectName]: { processed: 0, total: attrLength } });

        const r = await autocodeAllStream(
          currentProjectName,
          { all: true, save: false },
          (processed, total, _errors) => {
            setProjectProgress({ [currentProjectName]: { processed, total } });
            setProgress(10 + Math.round((processed / total) * 75));
          },
        );

        const allChangedFieldsByRow: Record<number, string[]> =
          ("changed_by_row" in r && r.changed_by_row) ? r.changed_by_row : {};
        const allSourcesByRow: Record<number, Record<string, string>> =
          ("sources_by_row" in r && r.sources_by_row) ? r.sources_by_row : {};
        const totalOk = ("ok" in r ? r.ok : 0) || 0;
        const totalFail = ("fail" in r ? r.fail : 0) || 0;

        // After all segments processed, fetch updated attributes and recalculate scores
        setProgress(85);
        try {
          const rows = ("updated_attributes" in r && r.updated_attributes) ? migrateAttrRows(r.updated_attributes) : null;
          if (rows) {
            const prevChanged = projectDataCache[currentProjectName]?.changedFieldsByRow ?? {};
            const prevSources = projectDataCache[currentProjectName]?.fieldSourcesByRow ?? {};
            const mergedChanged: Record<number, string[]> = { ...prevChanged };
            for (const [k, v] of Object.entries(allChangedFieldsByRow)) {
              const n = Number(k);
              mergedChanged[n] = [...new Set([...(mergedChanged[n] ?? []), ...(v as string[])])];
            }
            const mergedSources: Record<number, Record<string, string>> = { ...prevSources };
            for (const [k, v] of Object.entries(allSourcesByRow)) {
              const n = Number(k);
              mergedSources[n] = { ...(mergedSources[n] ?? {}), ...(v as Record<string, string>) };
            }
            updateProjectData(currentProjectName, {
              attrs: rows,
              changedFieldsByRow: mergedChanged,
              fieldSourcesByRow: mergedSources,
              isDirty: true,
            });

            // Save metadata
            saveAutocodeMetadata(currentProjectName, mergedChanged, mergedSources);

            // Update autocode baseline with new values from all segments
            updateAutocodeBaseline(rows);

            // Recalculate scores
            const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/score`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ attributes: rows }),
            });

            if (res.ok) {
              const result = await res.json();
              if (result.ok && Array.isArray(result.result_rows)) {
                updateProjectData(currentProjectName, {
                  scores: result.result_rows,
                });
              }
            }
          }
        } catch {
        }

        setProgress(100);
        setAutoCodeMsg("Completed");

        // Update autocoded segment count to total segments when autocode all completes
        if (totalOk > 0 && totalFail === 0) {
          // Only set to 100% if all segments were successfully autocoded
          const totalSegments = attrs.length;
          updateAutocodedSegmentCount(currentProjectName, totalSegments);
        }

        const totalProcessed = totalOk + totalFail;
        toaster.create({
          title: "Auto-code (all) done",
          description: `Total: ${totalProcessed}, OK: ${totalOk}, Failed: ${totalFail}${totalFail > 0 ? " (check console for details)" : ""}`,
          type: totalFail > 0 ? "warning" : "success",
        });

      } catch (e: unknown) {
        toaster.create({
          title: "Auto-code failed",
          description: e instanceof Error ? e.message : String(e),
          type: "error",
        });
      } finally {
        if (cleanupTimeoutRef.current !== null) {
          clearTimeout(cleanupTimeoutRef.current);
        }
        cleanupTimeoutRef.current = window.setTimeout(() => {
          clearAutoCodingState();
        }, 300);
      }
    };

    window.addEventListener("psat:autocode:all", handler);
    return () => window.removeEventListener("psat:autocode:all", handler);
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectName, attrs.length, updateAutocodeBaseline, updateAutocodedSegmentCount]);

  // Auto-code all segments for selected attributes only
  useEffect(() => {
    if (!currentProjectName) return;

    const handler = async (e: Event) => {
      const fields: string[] = (e as CustomEvent).detail?.fields ?? [];
      if (fields.length === 0) return;
      if (autoCodingRef.current) return;
      try {
        setAutoCoding(true);
        autoCodingRef.current = true;
        setAutoCodeMsg(`Autocoding ${fields.length} attribute(s) for all records…`);
        setProgress(10);
        const attrLength = attrs.length;
        setProjectProgress({ [currentProjectName]: { processed: 0, total: attrLength } });

        // Streaming call — progress counter updates as each segment completes
        const r = await autocodeAllStream(
          currentProjectName,
          { all: true, fields, save: false },
          (processed, total, _errors) => {
            setProjectProgress({ [currentProjectName]: { processed, total } });
            setProgress(10 + Math.round((processed / total) * 75)); // 10% → 85%
          },
        );

        const allChangedFieldsByRow: Record<number, string[]> =
          ("changed_by_row" in r && r.changed_by_row) ? r.changed_by_row : {};
        const allSourcesByRow: Record<number, Record<string, string>> =
          ("sources_by_row" in r && r.sources_by_row) ? r.sources_by_row : {};
        const totalOk = ("ok" in r ? r.ok : 0) || 0;
        const totalFail = ("fail" in r ? r.fail : 0) || 0;

        setProgress(85);
        try {
          // Use updated_attributes returned by the batch call — avoids an extra fetchProjectAttributes round trip
          const rows = ("updated_attributes" in r && r.updated_attributes) ? migrateAttrRows(r.updated_attributes) : null;
          if (rows) {
            const prevChanged = projectDataCache[currentProjectName]?.changedFieldsByRow ?? {};
            const prevSources = projectDataCache[currentProjectName]?.fieldSourcesByRow ?? {};
            const mergedChanged: Record<number, string[]> = { ...prevChanged };
            for (const [k, v] of Object.entries(allChangedFieldsByRow)) {
              const n = Number(k);
              mergedChanged[n] = [...new Set([...(mergedChanged[n] ?? []), ...(v as string[])])];
            }
            const mergedSources: Record<number, Record<string, string>> = { ...prevSources };
            for (const [k, v] of Object.entries(allSourcesByRow)) {
              const n = Number(k);
              mergedSources[n] = { ...(mergedSources[n] ?? {}), ...(v as Record<string, string>) };
            }
            // Selective patch: only overwrite the requested fields so that a
            // previous by-attribute run's un-saved changes are not clobbered.
            const currentAttrs = projectDataCache[currentProjectName]?.attrs ?? attrs;
            const patchedAttrs = currentAttrs.map((oldRow, idx) => {
              const newRow = rows[idx];
              if (!newRow) return oldRow;
              const patch: Record<string, unknown> = {};
              for (const field of fields) {
                if (field in newRow) patch[field] = newRow[field];
                for (const companion of COMPANION_FIELD_MAP[field] ?? []) {
                  if (companion in newRow) patch[companion] = newRow[companion];
                }
              }
              return { ...oldRow, ...patch };
            });

            updateProjectData(currentProjectName, {
              attrs: patchedAttrs,
              changedFieldsByRow: mergedChanged,
              fieldSourcesByRow: mergedSources,
              isDirty: true,
            });

            saveAutocodeMetadata(currentProjectName, mergedChanged, mergedSources);
            updateAutocodeBaseline(patchedAttrs, fields);

            const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/score`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ attributes: patchedAttrs }),
            });

            if (res.ok) {
              const result = await res.json();
              if (result.ok && Array.isArray(result.result_rows)) {
                updateProjectData(currentProjectName, { scores: result.result_rows });
              }
            }
          }
        } catch {
          // score recalculation failure is non-fatal
        }

        setProgress(100);
        setAutoCodeMsg("Completed");

        const totalProcessed = totalOk + totalFail;
        toaster.create({
          title: "Auto-code (by attribute) done",
          description: `Total: ${totalProcessed}, OK: ${totalOk}, Failed: ${totalFail}${totalFail > 0 ? " (check console for details)" : ""}`,
          type: totalFail > 0 ? "warning" : "success",
        });

      } catch (e: unknown) {
        toaster.create({
          title: "Auto-code failed",
          description: e instanceof Error ? e.message : String(e),
          type: "error",
        });
      } finally {
        if (cleanupTimeoutRef.current !== null) {
          clearTimeout(cleanupTimeoutRef.current);
        }
        cleanupTimeoutRef.current = window.setTimeout(() => {
          clearAutoCodingState();
        }, 300);
      }
    };

    window.addEventListener("psat:autocode:by-field", handler);
    return () => window.removeEventListener("psat:autocode:by-field", handler);
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectName, attrs.length, updateAutocodeBaseline]);

  // Auto-code all segments in all loaded projects
  useEffect(() => {
    const handler = async () => {
      if (autoCodingRef.current) return;
      try {
        setAutoCoding(true);
        autoCodingRef.current = true;
        setAutoCodeMsg("CV + GIS for all segments in all projects…");
        setProgress(10);

        // Auto-code all projects sequentially
        const projectsToAutocode = projectList;
        let totalProcessed = 0;
        let totalSuccessful = 0;
        let totalFailed = 0;
        const errors: any[] = [];

        // Initialize project progress with correct totals
        const initialProgress: Record<string, { processed: number; total: number }> = {};
        projectsToAutocode.forEach(name => {
          const projDataSnapshot = projectData[name];
          let total = 0;
          if (projDataSnapshot?.attrs && Array.isArray(projDataSnapshot.attrs)) {
            total = projDataSnapshot.attrs.length;
          }
          initialProgress[name] = { processed: 0, total };
        });
        setProjectProgress(initialProgress);

        for (let i = 0; i < projectsToAutocode.length; i++) {
          const projectName = projectsToAutocode[i];
          // Get the actual attrs length for this project from the current state
          let projectAttrsLength = 0;
          const projectDataSnapshot = projectData[projectName];
          if (projectDataSnapshot?.attrs && Array.isArray(projectDataSnapshot.attrs)) {
            projectAttrsLength = projectDataSnapshot.attrs.length;
          }

          setAutoCodeMsg(`Auto-coding project ${i + 1}/${projectsToAutocode.length}: ${projectName}…`);
          setProgress(10 + (i / projectsToAutocode.length) * 80);

          // Mark project as started with correct total
          setProjectProgress(prev => ({
            ...prev,
            [projectName]: { processed: 0, total: projectAttrsLength }
          }));

          try {
            const r = await autocodeAllStream(
              projectName,
              { all: true, save: false },
              (processed, total, _errors) => {
                setProjectProgress(prev => ({
                  ...prev,
                  [projectName]: { processed, total }
                }));
              },
            );

            const projectChangedFieldsByRow: Record<number, string[]> =
              ("changed_by_row" in r && r.changed_by_row) ? r.changed_by_row : {};
            const projectSourcesByRow: Record<number, Record<string, string>> =
              ("sources_by_row" in r && r.sources_by_row) ? r.sources_by_row : {};
            const projectOk = ("ok" in r ? r.ok : 0) || 0;
            const projectFail = ("fail" in r ? r.fail : 0) || 0;
            if ("errors" in r && r.errors && r.errors.length > 0) {
              errors.push(...r.errors);
            }

            // After all segments of this project are processed, use the returned in-memory rows
            try {
              const rows = ("updated_attributes" in r && r.updated_attributes) ? migrateAttrRows(r.updated_attributes) : null;
              if (rows) {
                const prevChanged = projectDataCache[projectName]?.changedFieldsByRow ?? {};
                const prevSources = projectDataCache[projectName]?.fieldSourcesByRow ?? {};
                const mergedChanged: Record<number, string[]> = { ...prevChanged };
                for (const [k, v] of Object.entries(projectChangedFieldsByRow)) {
                  const n = Number(k);
                  mergedChanged[n] = [...new Set([...(mergedChanged[n] ?? []), ...(v as string[])])];
                }
                const mergedSources: Record<number, Record<string, string>> = { ...prevSources };
                for (const [k, v] of Object.entries(projectSourcesByRow)) {
                  const n = Number(k);
                  mergedSources[n] = { ...(mergedSources[n] ?? {}), ...(v as Record<string, string>) };
                }
                updateProjectData(projectName, {
                  attrs: rows,
                  changedFieldsByRow: mergedChanged,
                  fieldSourcesByRow: mergedSources,
                  isDirty: true,
                });

                // Save metadata
                saveAutocodeMetadata(projectName, mergedChanged, mergedSources);


                // Update autocode baseline for this project
                try {
                  fetch(`/api/projects/${encodeURIComponent(projectName)}/baseline`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ rows })
                  });
                } catch (e) {
                }

                // Recalculate scores
                const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/score`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ attributes: rows }),
                });

                if (res.ok) {
                  const result = await res.json();
                  if (result.ok && Array.isArray(result.result_rows)) {
                    updateProjectData(projectName, {
                      scores: result.result_rows,
                    });
                  }
                }
              }
            } catch {
            }

            // Update autocoded segment count for this project if autocode was successful
            if (projectOk > 0 && projectFail === 0) {
              updateAutocodedSegmentCount(projectName, projectAttrsLength);
            }

            totalProcessed += projectAttrsLength;
            totalSuccessful += projectOk;
            totalFailed += projectFail;
          } catch (e: unknown) {
            totalFailed += projectAttrsLength;
            errors.push({ projectName, reason: e instanceof Error ? e.message : undefined });
          }
        }

        setProgress(95);

        // Notify map of score updates
        window.dispatchEvent(new CustomEvent("psat:scores:updated"));

        setProgress(100);
        setAutoCodeMsg("Completed");

        // Show summary
        if (totalProcessed > 0) {
          toaster.create({
            title: "Auto-code (all projects) done",
            description: `Total: ${totalProcessed}, OK: ${totalSuccessful}, Failed: ${totalFailed}${totalFailed > 0 ? " (check console for details)" : ""}`,
            type: totalFailed > 0 ? "warning" : "success",
          });
        }
      } catch (e: unknown) {
        toaster.create({
          title: "Auto-code failed",
          description: e instanceof Error ? e.message : String(e),
          type: "error",
        });
      } finally {
        if (cleanupTimeoutRef.current !== null) {
          clearTimeout(cleanupTimeoutRef.current);
        }
        cleanupTimeoutRef.current = window.setTimeout(() => {
          clearAutoCodingState();
        }, 300);
      }
    };

    window.addEventListener("psat:autocode:all-projects", handler);
    return () => window.removeEventListener("psat:autocode:all-projects", handler);
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectList, projectData, updateAutocodedSegmentCount]);

  return { autoCoding, autoCodeMsg, progress, projectProgress };
}
