import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useLocation } from "react-router-dom";

import type { Feature, LineString } from "geojson";
import { toaster } from "../../components/ui/toaster";

import {
  calculateScoreForRow,
  updateProject,
} from "../../api";

import type { AttributeRow } from "../../api";

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
  applyLogicChecks,
} from "./codingHelpers";
import { useFilterContext } from "./hooks/useFilterContext";
import { useAutocode } from "./hooks/useAutocode";
import { useProjectDataCache, savedAttrsSnapshot } from "./hooks/useProjectDataCache";
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

  // Debounce handles for per-row score recalculation (attribute editing)
  const scoreDebounceRef = useRef<Record<number, number>>({});

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

  // Autocode orchestration: overlay state + the four psat:autocode:* event flows.
  const { autoCoding, autoCodeMsg, progress, projectProgress } = useAutocode({
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
  });

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
