import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useLocation } from "react-router-dom";

import type { Feature, LineString } from "geojson";
import { toaster } from "../../components/ui/toaster";

import {
  calculateScoreForRow,
  updateProject,
} from "../../api";

import type { AttributeRow } from "../../api";
import { autocodeImage, autocodeGIS, autocodeAllStream } from "../../api";

import { resolveContributorTabGroup } from "./components/AttributesPanel";
import { saveAttributes } from "../../api";
import "../../components/visualization/AnalysisPanel.css";
import { invalidateProject } from "../../api/projectDataCache";
import { fetchWidthVisualization } from "../../api/widthVisualization";
import type { WidthVisualizationResponse } from "../../api/widthVisualization";
import { fetchCurvatureVisualization } from "../../api/curvatureVisualization";
import type { CurvatureVisualizationResponse } from "../../api/curvatureVisualization";
import { aggregateTopContributors } from "../../utils/aggregateTopContributors";
import { useUiVersion } from "../../features/ui/useUiVersion";
import {
  FO_TYPE_SUGGESTIONS,
  NFO_TYPE_SUGGESTIONS,
  FACILITY_WIDTH_SUBCATEGORY_MAP,
} from "./codingConstants";
import {
  DELINEATION_PRESENT_SUGGESTIONS,
  SLIPPERY_ISSUE_TYPE_SUGGESTIONS,
  migrateAttrRows,
  normalizeAttributeValues,
  applyLogicChecks,
} from "./codingHelpers";
import { useFilterContext } from "./hooks/useFilterContext";
import {
  useProjectDataCache,
  defaultProjectData,
  projectDataCache,
  savedAttrsSnapshot,
} from "./hooks/useProjectDataCache";
import CodingLayoutV1 from "./layouts/CodingLayoutV1";
import CodingLayoutV2 from "./layouts/CodingLayoutV2";
import type { CodingViewModel } from "./layouts/CodingViewModel";


export default function CodingPage() {
  const { projectNames } = useParams<{ projectNames: string }>();

  // Parse multiple project names from URL
  const projectList = useMemo(() => {
    if (!projectNames) return [];
    try {
      return projectNames.split(',').map(name => {
        try {
          return decodeURIComponent(name);
        } catch {
          return name;
        }
      });
    } catch {
      return [];
    }
  }, [projectNames]);

  // When the URL params change (e.g. cross-project navigation from GeoDataPanel),
  // sync activeTab to the first project in the new list if the current tab is gone.
  useEffect(() => {
    if (projectList.length > 0 && !projectList.includes(activeTab) && activeTab !== "coding-guide") {
      setActiveTab(projectList[0]);
    }
  // activeTab intentionally excluded — we only want to react to projectList changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectList]);

  // Current active tab (project name or "coding-guide")
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (projectNames) {
      try {
        const names = projectNames.split(',').map(name => {
          try {
            return decodeURIComponent(name);
          } catch {
            return name;
          }
        });
        return names[0] ?? "coding-guide";
      } catch {
        return "coding-guide";
      }
    }
    return "coding-guide";
  });
  const currentProjectName = activeTab === "coding-guide" ? null : activeTab;
  const isShowingCodingGuide = activeTab === "coding-guide";

  // Server-data spine: project load/cache, baseline, scores, counts, mappings.
  // Owns projectData / updateProjectData / currentData, threaded to the other hooks.
  const {
    projectData,
    setProjectData,
    updateProjectData,
    currentData,
    refreshCurrentProject,
    updateVerifiedSegmentCount,
    updateAutocodedSegmentCount,
    imagesLoaded,
    imageLoadingProgress,
    baselineRows,
    baselineRowsRef,
    attrMappings,
    handleSaveOptions,
  } = useProjectDataCache(currentProjectName);

  // Global state
  const [autoCoding, setAutoCoding] = useState(false);
  const [autoCodeMsg, setAutoCodeMsg] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [projectProgress, setProjectProgress] = useState<Record<string, { processed: number; total: number }>>({});
  const [editingOptions, setEditingOptions] = useState<{ field: string; currentValue: string | null; delineationNotPresent?: boolean } | null>(null);
  const [pendingPresentDelineationChange, setPendingPresentDelineationChange] = useState(false);
  const [pendingNotPresentDelineationChange, setPendingNotPresentDelineationChange] = useState(false);
  const [pendingPresentFOChange, setPendingPresentFOChange] = useState(false);
  const [pendingPresentNFOChange, setPendingPresentNFOChange] = useState(false);
  const [pendingPresentSlipperyChange, setPendingPresentSlipperyChange] = useState(false);
  const [pendingFacilityWidthParentChange, setPendingFacilityWidthParentChange] = useState<{
    categoryLabel: string;
    subCategories: string[];
    originalParentCode: string | number | null;
    originalSubCategory: string | null;
  } | null>(null);
  const [activeAttributeGroupTab, setActiveAttributeGroupTab] = useState<string | null>(null);

  // Refs for cleanup
  const cleanupTimeoutRef = useRef<number | null>(null);
  const scoreDebounceRef = useRef<Record<number, number>>({});
  const autoCodingRef = useRef(false);

  // Handle query params for deep linking (e.g. ?segment=5)
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const initialSegment = queryParams.get("segment");
  const hasInitializedSegmentRef = useRef(false);

  // Filter context from Path Analysis — persisted in sessionStorage for reload survival.
  // See useFilterContext for the priority-1/fallback logic (filter-colour leak fix).
  const filterContext = useFilterContext(location.state);

  // Save confirmation dialog state
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Analysis sidebar state (lifted from AnalysisPanel)
  const [widthData, setWidthData] = useState<WidthVisualizationResponse | null>(null);
  const [curvData, setCurvData] = useState<CurvatureVisualizationResponse | null>(null);
  const [showCurvatureOverlay, setShowCurvatureOverlay] = useState(false);

  const handleContributorClick = useCallback((name: string) => {
    const targetGroup = resolveContributorTabGroup(name);
    if (targetGroup) {
      setActiveAttributeGroupTab(targetGroup);
    }
  }, []);

  // Reset the segment-init guard whenever the active project changes so that
  // cross-project navigation (which reuses the same component instance) can
  // apply the new ?segment= query param for the incoming project.
  useEffect(() => {
    hasInitializedSegmentRef.current = false;
  }, [currentProjectName]);

  useEffect(() => {
    if (!initialSegment || !currentProjectName || hasInitializedSegmentRef.current) return;

    const segmentIdx = parseInt(initialSegment, 10);
    if (!isNaN(segmentIdx) && segmentIdx > 0) {
      // We can only set the page if we know the total length, or at least we trust the input.
      // The actual clamping happens in updateProjectData or valid rendering,
      // but here we just blindly set the currentPage if it seems valid.
      // We'll trust the component to clamp it if it's out of bounds once data is loaded.
      updateProjectData(currentProjectName, { currentPage: segmentIdx });
      hasInitializedSegmentRef.current = true;
    }
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSegment, currentProjectName]);

  // Shorthand accessors
  const {
    detail,
    attrs,
    geoFeatures,
    scores,
    currentPage,
    changedFieldsByRow,
    fieldSourcesByRow,
    loading,
    error,
    editedRow,
  } = currentData;

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

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (cleanupTimeoutRef.current !== null) {
        clearTimeout(cleanupTimeoutRef.current);
        cleanupTimeoutRef.current = null;
      }
      Object.values(scoreDebounceRef.current).forEach(timeout => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      });
      scoreDebounceRef.current = {};
    };
  }, []);

  // Keep autoCodingRef in sync with autoCoding state
  useEffect(() => {
    autoCodingRef.current = autoCoding;
  }, [autoCoding]);

  const len = attrs.length;
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [segmentInput, setSegmentInput] = useState(String(currentData.verifiedSegmentCount ?? 0));
  const [autocodedSegmentInput, setAutocodedSegmentInput] = useState(String(currentData.autocodedSegmentCount ?? 0));

  const currentIndex = useMemo(
    () => Math.max(0, Math.min(len - 1, currentPage - 1)),
    [currentPage, len]
  );

  const projectContributors = useMemo(() => {
    if (!currentProjectName) return null;
    const slice = scores as unknown as Array<Record<string, unknown>>;
    return {
      projectName: currentProjectName,
      contributors: aggregateTopContributors(slice),
    };
  }, [scores, currentProjectName]);

  const currentAttr = useMemo<AttributeRow | null>(
    () => (len > 0 ? attrs[currentIndex] : null),
    [attrs, currentIndex]
  );

  const currentFeature = useMemo<Feature | null>(() => {
    return geoFeatures[currentIndex] ?? null;
  }, [geoFeatures, currentIndex]);

  const imgRef = useMemo<string | undefined>(() => {
    const fromAttr =
      (attrs?.[currentIndex] as any)?.["Image Reference"] ??
      (attrs?.[currentIndex] as any)?.["image"] ??
      (attrs?.[currentIndex] as any)?.["img"];

    const p = (currentFeature?.properties as any) || {};
    const fromFeature =
      p?.["Image Reference"] ??
      p?.["Image_Reference"] ??
      p?.["image"] ??
      p?.["img"];

    return (fromAttr ?? fromFeature) || undefined;
  }, [attrs, currentIndex, currentFeature]);

  // Per-segment verification for the Path Analysis review flow. Held in memory only
  // (deliberately NOT persisted to the backend) and keyed by project name → segment
  // index. A single shared store means verified state survives switching between the
  // open projects, and resets when the reviewer leaves and re-enters the page. Only
  // surfaced when entered from Path Analysis (i.e. a filter context is present).
  const cameFromPathAnalysis = filterContext != null;
  const [verifiedByProject, setVerifiedByProject] = useState<Record<string, number[]>>({});

  const currentSegmentVerified = useMemo(
    () => !!currentProjectName && (verifiedByProject[currentProjectName] ?? []).includes(currentIndex),
    [verifiedByProject, currentProjectName, currentIndex]
  );

  const toggleCurrentSegmentVerified = useCallback(() => {
    if (!currentProjectName) return;
    setVerifiedByProject(prev => {
      const existing = prev[currentProjectName] ?? [];
      const isVerified = existing.includes(currentIndex);
      const next = isVerified
        ? existing.filter(i => i !== currentIndex)
        : [...existing, currentIndex];
      return { ...prev, [currentProjectName]: next };
    });
  }, [currentProjectName, currentIndex]);

  // Preload next images to improve user experience
  useEffect(() => {
    if (!currentProjectName || !attrs.length) return;

    const PRELOAD_COUNT = 5;
    const indicesToPreload = [];
    for (let i = 1; i <= PRELOAD_COUNT; i++) {
      if (currentIndex + i < attrs.length) {
        indicesToPreload.push(currentIndex + i);
      }
    }

    indicesToPreload.forEach(idx => {
      const row = attrs[idx];
      const feat = geoFeatures[idx] ?? null;

      const fromAttr =
        (row as any)?.["Image Reference"] ??
        (row as any)?.["image"] ??
        (row as any)?.["img"];

      const p = (feat?.properties as any) || {};
      const fromFeature =
        p?.["Image Reference"] ??
        p?.["Image_Reference"] ??
        p?.["image"] ??
        p?.["img"];

      const nextImgRef = (fromAttr ?? fromFeature) || undefined;

      if (nextImgRef) {
        const url = `/api/projects/${encodeURIComponent(currentProjectName)}/images/${encodeURIComponent(nextImgRef)}`;
        const img = new Image();
        img.src = url;
      }
    });
  }, [currentIndex, currentProjectName, attrs, geoFeatures]);

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
              // Mirror alias pairs that the patchedAttrs builder also applies
              if (field === "Grade" && "Gradient %" in updatedRow) patch["Gradient %"] = updatedRow["Gradient %"];
              if (field === "Delineation" && "Delineation Type" in updatedRow) patch["Delineation Type"] = updatedRow["Delineation Type"];
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
                // Mirror the alias pairs the backend's _bulk_gen filter uses
                if (field === "Grade" && "Gradient %" in newRow) patch["Gradient %"] = newRow["Gradient %"];
                if (field === "Delineation" && "Delineation Type" in newRow) patch["Delineation Type"] = newRow["Delineation Type"];
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

  // Get original autocode values for current row
  const originalCurrentAttr = useMemo<AttributeRow | null>(() => {
    if (currentIndex < 0 || currentIndex >= baselineRows.length) return null;
    return baselineRows[currentIndex] || null;
  }, [currentIndex, baselineRows]);

  const presentDelineationTypeOptions = useMemo(() => {
    const projectValues = Array.from(new Set(
      Object.values(projectData)
        .flatMap((pd) => pd?.attrs ?? [])
        .flatMap((row) => {
          const v = row["Delineation Type"];
          if (!v) return [];
          return String(v).split(",").map((s) => s.trim()).filter(Boolean);
        })
    )).filter((v) => v !== "Absent" && v !== "In Poor Condition" && v !== "Faded Marking");
    return Array.from(new Set([...DELINEATION_PRESENT_SUGGESTIONS, ...projectValues])).sort();
  }, [projectData]);

  const foTypeOptions = useMemo(() => {
    const projectValues = Array.from(new Set(
      Object.values(projectData).flatMap((pd) => pd?.attrs ?? [])
        .flatMap((row) => {
          const v = row["FO Type"];
          if (!v) return [];
          return String(v).split(",").map((s) => s.trim()).filter(Boolean);
        })
    ));
    return Array.from(new Set([...FO_TYPE_SUGGESTIONS, ...projectValues])).sort();
  }, [projectData]);

  const nfoTypeOptions = useMemo(() => {
    const projectValues = Array.from(new Set(
      Object.values(projectData).flatMap((pd) => pd?.attrs ?? [])
        .flatMap((row) => {
          const v = row["NFO Type"];
          if (!v) return [];
          return String(v).split(",").map((s) => s.trim()).filter(Boolean);
        })
    ));
    return Array.from(new Set([...NFO_TYPE_SUGGESTIONS, ...projectValues])).sort();
  }, [projectData]);

  const slipperyIssueTypeOptions = useMemo(() => {
    const projectValues = Array.from(new Set(
      Object.values(projectData).flatMap((pd) => pd?.attrs ?? [])
        .flatMap((row) => {
          const v = row["Issue Type (Slippery)"];
          if (!v) return [];
          return String(v).split(",").map((s) => s.trim()).filter(Boolean);
        })
    ));
    return Array.from(new Set([...SLIPPERY_ISSUE_TYPE_SUGGESTIONS, ...projectValues])).sort();
  }, [projectData]);

  // Fetch width and curvature data when project or segment changes
  useEffect(() => {
    if (!currentProjectName || !currentFeature || currentFeature.geometry?.type !== "LineString") {
      setWidthData(null);
      setCurvData(null);
      return;
    }
    const coords = (currentFeature.geometry as LineString).coordinates as [number, number][];

    const widthController = new AbortController();
    const curvController = new AbortController();

    setWidthData(null);
    setCurvData(null);

    fetchWidthVisualization(currentProjectName, coords, currentIndex, widthController.signal)
      .then((data) => {
        if (!widthController.signal.aborted) setWidthData(data);
      })
      .catch((e) => {
        if (widthController.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      });

    fetchCurvatureVisualization(currentProjectName, coords, currentIndex, curvController.signal)
      .then((data) => {
        if (!curvController.signal.aborted) setCurvData(data);
      })
      .catch((e) => {
        if (curvController.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      });

    return () => {
      widthController.abort();
      curvController.abort();
    };
  }, [currentProjectName, currentIndex, currentFeature]);

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

  // Pagination
  const gotoPage = useCallback((page: number) => {
    if (len === 0 || !currentProjectName) return;
    const clamped = Math.min(Math.max(1, page), len);
    updateProjectData(currentProjectName, { currentPage: clamped });
  // updateProjectData/setProjectData/baselineRowsRef come from useProjectDataCache and are
  // recreated per render; deliberately omitted to preserve pre-extraction effect timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [len, currentProjectName]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    setSegmentInput(String(currentData.verifiedSegmentCount ?? 0));
  }, [currentData.verifiedSegmentCount]);

  useEffect(() => {
    setAutocodedSegmentInput(String(currentData.autocodedSegmentCount ?? 0));
  }, [currentData.autocodedSegmentCount]);

  const commitPage = useCallback(
    (valStr: string, isBlur = false) => {
      if (valStr.trim() === "" && !isBlur) return;
      const raw = valStr.trim() === "" ? 1 : Number(valStr);
      if (!Number.isFinite(raw)) return;
      const clamped = Math.min(Math.max(1, raw), len || 1);
      gotoPage(clamped);
      if (isBlur) setPageInput(String(clamped));
    },
    [gotoPage, len]
  );

  const commitSegment = useCallback(
    (valStr: string, isBlur = false) => {
      if (valStr.trim() === "" && !isBlur) return;
      const raw = valStr.trim() === "" ? 0 : Number(valStr);
      if (!Number.isFinite(raw)) return;
      const clamped = Math.max(0, Math.min(len || 0, raw));
      // Guard against infinite loop if value hasn't changed
      if (clamped === (currentData.verifiedSegmentCount ?? 0)) {
        if (isBlur) setSegmentInput(String(clamped));
        return;
      }
      updateVerifiedSegmentCount(currentProjectName!, clamped);
    },
    [currentProjectName, len, updateVerifiedSegmentCount, currentData.verifiedSegmentCount]
  );

  const commitAutocodedSegment = useCallback(
    (valStr: string, isBlur = false) => {
      if (valStr.trim() === "" && !isBlur) return;
      const raw = valStr.trim() === "" ? 0 : Number(valStr);
      if (!Number.isFinite(raw)) return;
      const clamped = Math.max(0, Math.min(len || 0, raw));
      // Guard against infinite loop if value hasn't changed
      if (clamped === (currentData.autocodedSegmentCount ?? 0)) {
        if (isBlur) setAutocodedSegmentInput(String(clamped));
        return;
      }
      updateAutocodedSegmentCount(currentProjectName!, clamped);
    },
    [currentProjectName, len, updateAutocodedSegmentCount, currentData.autocodedSegmentCount]
  );

  // Warn user before leaving the page (browser close, refresh, etc.)
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // ── Path Analysis return-flow handlers (lifted from the v1 JSX) ──
  const returnToAnalysis = Boolean((location.state as any)?.returnToAnalysis);

  const onBackToAnalysis = () => {
    const anyChanges = projectList.some(projName => {
      const current = projectData[projName]?.attrs;
      const snapshot = savedAttrsSnapshot[projName];
      if (!current || !snapshot) return false;
      return JSON.stringify(current) !== JSON.stringify(snapshot);
    });
    if (anyChanges) {
      setIsSaveDialogOpen(true);
    } else {
      toaster.create({ title: "No changes to save.", type: "info" });
      window.history.back();
    }
  };

  const onDiscardAndExit = () => {
    setIsSaveDialogOpen(false);
    // Revert each project's attrs back to the last-saved snapshot so that
    // if the user navigates back to CodingPage the stale edits are gone.
    projectList.forEach(projName => {
      const snapshot = savedAttrsSnapshot[projName];
      if (snapshot) {
        updateProjectData(projName, { attrs: snapshot, isDirty: false });
      }
    });
    toaster.create({ title: "Changes discarded.", type: "info" });
    window.history.back();
  };

  const onSaveAndExit = async () => {
    setIsSaving(true);
    const success = await saveAllProjects();
    setIsSaving(false);
    if (success) {
      setIsSaveDialogOpen(false);
      window.history.back();
    }
  };

  const ui = useUiVersion();

  const vm: CodingViewModel = {
    projectList,
    projectData,
    activeTab,
    setActiveTab,
    isShowingCodingGuide,
    currentProjectName,
    loading,
    error,
    imagesLoaded,
    imageLoadingProgress,
    autoCoding,
    progress,
    autoCodeMsg,
    projectProgress,
    detail,
    currentData,
    attrs,
    scores,
    geoFeatures,
    currentIndex,
    currentPage,
    len,
    currentAttr,
    originalCurrentAttr,
    imgRef,
    changedFieldsByRow,
    fieldSourcesByRow,
    attrMappings,
    segmentInput,
    setSegmentInput,
    commitSegment,
    autocodedSegmentInput,
    setAutocodedSegmentInput,
    commitAutocodedSegment,
    pageInput,
    setPageInput,
    commitPage,
    gotoPage,
    projectContributors,
    handleContributorClick,
    activeAttributeGroupTab,
    cameFromPathAnalysis,
    currentSegmentVerified,
    toggleCurrentSegmentVerified,
    verifiedByProject,
    filterContext,
    returnToAnalysis,
    onBackToAnalysis,
    onDiscardAndExit,
    onSaveAndExit,
    isSaveDialogOpen,
    setIsSaveDialogOpen,
    isSaving,
    onAttrChange,
    onEdit,
    editCurrentAttr,
    editCurrentAttrMany,
    widthData,
    curvData,
    showCurvatureOverlay,
    setShowCurvatureOverlay,
    refreshCurrentProject,
    editingOptions,
    setEditingOptions,
    handleSaveOptions,
    presentDelineationTypeOptions,
    foTypeOptions,
    nfoTypeOptions,
    slipperyIssueTypeOptions,
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
    pendingFacilityWidthParentChange,
    setPendingFacilityWidthParentChange,
  };

  return ui === "v2" ? <CodingLayoutV2 {...vm} /> : <CodingLayoutV1 {...vm} />;
}
