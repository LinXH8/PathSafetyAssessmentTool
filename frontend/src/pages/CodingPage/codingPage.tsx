import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useLocation } from "react-router-dom";

import type { Feature, LineString } from "geojson";
import { toaster } from "../../components/ui/toaster";

import type { AttributeRow } from "../../api";

import { resolveContributorTabGroup } from "./components/AttributesPanel";
import "../../components/visualization/AnalysisPanel.css";
import { fetchWidthVisualization } from "../../api/widthVisualization";
import type { WidthVisualizationResponse } from "../../api/widthVisualization";
import { fetchCurvatureVisualization } from "../../api/curvatureVisualization";
import type { CurvatureVisualizationResponse } from "../../api/curvatureVisualization";
import { aggregateTopContributors } from "../../utils/aggregateTopContributors";
import { useUiVersion } from "../../features/ui/useUiVersion";
import { FO_TYPE_SUGGESTIONS, NFO_TYPE_SUGGESTIONS } from "./codingConstants";
import {
  DELINEATION_PRESENT_SUGGESTIONS,
  SLIPPERY_ISSUE_TYPE_SUGGESTIONS,
} from "./codingHelpers";
import { useAttributeEditing } from "./hooks/useAttributeEditing";
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
  const [activeAttributeGroupTab, setActiveAttributeGroupTab] = useState<string | null>(null);

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

  // Attribute editing: row editors, parent/child interception (onEdit), dirty
  // tracking + saveAllProjects, and the forced multi-tag modal flags.
  const {
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
    pendingFacilityWidthParentChange,
    setPendingFacilityWidthParentChange,
  } = useAttributeEditing({
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
  });

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
