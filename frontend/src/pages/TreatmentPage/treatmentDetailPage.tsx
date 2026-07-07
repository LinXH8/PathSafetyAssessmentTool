import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";

import type { Feature, LineString } from "geojson";

import { fetchWidthVisualization } from "../../api/widthVisualization";
import type { WidthVisualizationResponse } from "../../api/widthVisualization";
import { fetchCurvatureVisualization } from "../../api/curvatureVisualization";
import type { CurvatureVisualizationResponse } from "../../api/curvatureVisualization";

import {
  fetchProjectDetail,
  fetchAttributeMappings,
  previewTreatments,
  applySpecificTreatment,
  calculateScore,
  resetAllTreatments,
  saveTreatments,
} from "../../api";

import type { AttributeRow, CodingFilterContext } from "../../api";
import { getCachedGeoJSON, getCachedAttributes, getCachedResults } from "../../api/projectDataCache";
import { resolveContributorTabGroup } from "../CodingPage/components/AttributesPanel";
import { aggregateTopContributors } from "../../utils/aggregateTopContributors";
import { toaster } from "../../components/ui/toaster";
import { useUiVersion } from "../../features/ui/useUiVersion";
import { SESSION_KEYS, LOCAL_KEYS } from "../../constants/sessionKeys";
import TreatmentDetailLayoutV1 from "./layouts/TreatmentDetailLayoutV1";
import TreatmentDetailLayoutV2 from "./layouts/TreatmentDetailLayoutV2";
import type { TreatmentViewModel } from "./layouts/TreatmentViewModel";

import {
  ALL_PROJECTS,
  buildProjectImageUrl,
  buildTreatmentCopyMessage,
  copyTextToClipboard,
  copyRichContentToClipboard,
  type ScoreType,
  type CopyButtonState,
} from "./treatmentConstants";
import { useProjectMapping } from "./hooks/useProjectMapping";
import { useTreatmentState } from "./hooks/useTreatmentState";
import { useTreatmentEngine } from "./hooks/useTreatmentEngine";
import { useTreatmentAnalysis } from "./hooks/useTreatmentAnalysis";

export default function TreatmentDetailPage() {
  const { projectName } = useParams<{ projectName: string }>();
  const ui = useUiVersion();

  // Parse project names
  const projectNames = useMemo(() => {
    if (!projectName) return [];
    try {
      return projectName.split(',').map(name => {
        try {
          return decodeURIComponent(name);
        } catch {
          return name;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }, [projectName]);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Filter mode: opened from the Path Analysis page's "Treat Filtered Segments" button.
  // The ?filtered=1 query param is the authoritative switch — only when present do we honor
  // the (possibly stale) treatment_filterContext sessionStorage key. This restricts the page
  // to the filtered subset (pagination, both maps, treatment counts) without dropping segments
  // from the aggregated arrays (which would break the global→local index mapping).
  const filterMode = searchParams.get("filtered") === "1";
  const filterContext = useMemo<CodingFilterContext | null>(() => {
    if (!filterMode) return null;
    try {
      const raw = sessionStorage.getItem(SESSION_KEYS.TREATMENT_FILTER_CONTEXT);
      return raw ? (JSON.parse(raw) as CodingFilterContext) : null;
    } catch {
      return null;
    }
  }, [filterMode]);

  // Multi-project global-index bookkeeping (see root CLAUDE.md "Multi-Project Index Mapping").
  const { projectMap, setProjectMap, resolveIndex } = useProjectMapping();

  const [attrs, setAttrs] = useState<AttributeRow[]>([]);
  const [accordionView, setAccordionView] = useState<"segment" | "treatment">("segment");

  // Active tab — either a project name or ALL_PROJECTS. Drives the page-wide focus scope.
  const [activeProject, setActiveProject] = useState<string>(ALL_PROJECTS);
  // Monotonic counter bumped on tab switch to force the maps to recenter on the scope.
  const [panKey, setPanKey] = useState<number>(0);

  // Focus scope derived from the active tab. ALL_PROJECTS spans every segment;
  // a project tab narrows to that project's global-index window. Every consumer
  // (maps, treatment list, counts, donuts) reads from this.
  const isAllScope = activeProject === ALL_PROJECTS;
  const scope = useMemo(() => {
    if (isAllScope) return { start: 0, count: attrs.length };
    const p = projectMap.find((p) => p.name === activeProject);
    return p ? { start: p.startIndex, count: p.count } : { start: 0, count: attrs.length };
  }, [isAllScope, activeProject, projectMap, attrs.length]);

  // Ordered list of global indices the user can navigate / that should render. In filter
  // mode this is the filtered subset (mapped from each project's local indices via its
  // startIndex window); otherwise it is the full contiguous range. `pageIndices` is further
  // narrowed to the active project scope. Arrays (attrs/geoFeatures/scores) stay full, so the
  // global→local mapping used for treatment application is unaffected.
  const filteredGlobalIndices = useMemo<number[]>(() => {
    if (!filterContext) return [];
    const out: number[] = [];
    for (const p of projectMap) {
      const fp = filterContext.projects.find((x) => x.projectName === p.name);
      if (!fp) continue;
      for (const localIdx of [...fp.filteredIndices].sort((a, b) => a - b)) {
        if (localIdx >= 0 && localIdx < p.count) out.push(p.startIndex + localIdx);
      }
    }
    return out;
  }, [filterContext, projectMap]);

  const filteredGlobalIndexSet = useMemo(
    () => new Set(filteredGlobalIndices),
    [filteredGlobalIndices]
  );

  // The ordered global indices the pager walks for the current scope.
  const pageIndices = useMemo<number[]>(() => {
    if (filterMode) {
      return filteredGlobalIndices.filter(
        (gi) => gi >= scope.start && gi < scope.start + scope.count
      );
    }
    return Array.from({ length: scope.count }, (_, i) => scope.start + i);
  }, [filterMode, filteredGlobalIndices, scope]);

  const [geoFeatures, setGeoFeatures] = useState<Feature[]>([]);
  const [scores, setScores] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTreatments, setSelectedTreatments] = useState<Set<number>>(new Set());

  const [attrMappings, setAttrMappings] = useState<Record<string, Record<string, string>>>({});
  const [showPostTreatment, setShowPostTreatment] = useState<boolean>(false);
  const [activeAttributeGroupTab, setActiveAttributeGroupTab] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [applyLoading, setApplyLoading] = useState(false);
  const [openConfirmAlert, setOpenConfirmAlert] = useState(false);
  const [copyButtonState, setCopyButtonState] = useState<CopyButtonState>("idle");

  // The "Confirm Apply All" Chakra/Zag Dialog locks page scroll while open by
  // setting `data-scroll-locked` + inline `overflow: hidden` / `pointer-events: none`
  // on <html>/<body>. If the page unmounts (e.g. clicking "Generate Report" →
  // navigating to the Report Builder) before Zag restores those styles, the lock
  // leaks and the window can no longer scroll when the user navigates back.
  // Clear the lock whenever the dialog closes, and on unmount, so the page is
  // always scrollable again. See CLAUDE.md "Chakra UI Dialog: Blocking Interaction".
  const clearScrollLock = useCallback(() => {
    const body = document.body;
    const html = document.documentElement;
    body.style.overflow = "";
    html.style.overflow = "";
    body.style.pointerEvents = "";
    html.style.pointerEvents = "";
    body.removeAttribute("data-scroll-locked");
    html.removeAttribute("data-scroll-locked");
  }, []);

  useEffect(() => {
    if (!openConfirmAlert) {
      // Delay past Zag's close animation/cleanup so we win the race.
      const t = setTimeout(clearScrollLock, 400);
      return () => clearTimeout(t);
    }
  }, [openConfirmAlert, clearScrollLock]);

  // Safety net: clear any leftover lock on unmount (navigation away) and on mount
  // (returning from the Report Builder) so the treatment page is never stuck.
  useEffect(() => {
    clearScrollLock();
    return () => clearScrollLock();
  }, [clearScrollLock]);


  const [imageCopyButtonState, setImageCopyButtonState] = useState<CopyButtonState>("idle");

  // Preview state
  const [previewScores, setPreviewScores] = useState<ScoreType | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);


  // v2 page-level action loading states
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [resetAllConfirmOpen, setResetAllConfirmOpen] = useState(false);
  const [isResettingAll, setIsResettingAll] = useState(false);
  const len = attrs.length;
  const initialSegment = searchParams.get("segment");
  // Pending ?segment= navigation, consumed once data has loaded (see effect near gotoPage).
  const pendingSegment = useRef<number | null>(initialSegment ? parseInt(initialSegment, 10) : null);
  const [currentPage, setCurrentPage] = useState<number>(initialSegment ? parseInt(initialSegment, 10) : 1);
  const [pageInput, setPageInput] = useState(String(currentPage));

  const currentIndex = useMemo(
    () => Math.max(0, Math.min(len - 1, currentPage - 1)),
    [currentPage, len]
  );

  // Safety net: if the current segment isn't in the navigable list (e.g. projectMap
  // resolves after navigation, a scope/tab switch, or — in filter mode — an initial page
  // that isn't part of the filtered subset), snap to the first navigable segment.
  useEffect(() => {
    if (pageIndices.length === 0) return;
    if (!pageIndices.includes(currentIndex)) {
      setCurrentPage(pageIndices[0] + 1);
    }
  }, [pageIndices, currentIndex]);

  const handleContributorClick = useCallback((name: string) => {
    const targetGroup = resolveContributorTabGroup(name);
    if (targetGroup) {
      setActiveAttributeGroupTab(targetGroup);
    }
  }, []);

  // Get segment count for a specific project
  const getProjectSegmentCount = useCallback((projectName: string): number => {
    const project = projectMap.find(p => p.name === projectName);
    if (!project) return 0;
    if (filterMode) {
      return filteredGlobalIndices.filter(
        gi => gi >= project.startIndex && gi < project.startIndex + project.count
      ).length;
    }
    return project.count;
  }, [projectMap, filterMode, filteredGlobalIndices]);

  // Get the first (navigable) global segment index for a specific project — in filter mode
  // the first filtered segment, otherwise the project's first segment.
  const getProjectFirstSegmentIndex = useCallback((projectName: string): number => {
    const project = projectMap.find(p => p.name === projectName);
    if (!project) return 0;
    if (filterMode) {
      const first = filteredGlobalIndices.find(
        gi => gi >= project.startIndex && gi < project.startIndex + project.count
      );
      return first ?? project.startIndex;
    }
    return project.startIndex;
  }, [projectMap, filterMode, filteredGlobalIndices]);

  const currentFeature = useMemo<Feature | null>(() => {
    return geoFeatures[currentIndex] ?? null;
  }, [geoFeatures, currentIndex]);

  // Curvature/width metrics for the current segment (populates the map controls'
  // Curv./Width readouts — mirrors the Coding page's fetch so Treatment isn't blank).
  const [widthData, setWidthData] = useState<WidthVisualizationResponse | null>(null);
  const [curvData, setCurvData] = useState<CurvatureVisualizationResponse | null>(null);

  useEffect(() => {
    const ctx = resolveIndex(currentIndex);
    if (!ctx || !currentFeature || currentFeature.geometry?.type !== "LineString") {
      setWidthData(null);
      setCurvData(null);
      return;
    }
    const coords = (currentFeature.geometry as LineString).coordinates as [number, number][];

    const widthController = new AbortController();
    const curvController = new AbortController();

    setWidthData(null);
    setCurvData(null);

    fetchWidthVisualization(ctx.name, coords, ctx.localIndex, widthController.signal)
      .then((data) => { if (!widthController.signal.aborted) setWidthData(data); })
      .catch((e) => { if (widthController.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return; });

    fetchCurvatureVisualization(ctx.name, coords, ctx.localIndex, curvController.signal)
      .then((data) => { if (!curvController.signal.aborted) setCurvData(data); })
      .catch((e) => { if (curvController.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return; });

    return () => {
      widthController.abort();
      curvController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, currentFeature]);

  // Grade/Gradient come straight off the current segment's attributes (physical
  // properties — unaffected by treatment).
  const gradeMetrics = useMemo(() => {
    const row = attrs[currentIndex] as Record<string, unknown> | undefined;
    return {
      grade: (row?.["Grade"] as number | null) ?? null,
      gradientPct: (row?.["Gradient %"] as number | null) ?? null,
      gradientStatus: (row?.["Gradient Status"] as string | null) ?? null,
    };
  }, [attrs, currentIndex]);

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

  // Fetch project data
  const fetchData = useCallback(async () => {
    if (projectNames.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      // Read endpoints go through the shared projectDataCache (the same cache the Path
      // Analysis page warms). Opening Treatment from Analysis's "Open in Treatment" button —
      // and navigating back and forth — is then a cache hit instead of a full re-fetch.
      const results = await Promise.all(projectNames.map(async (name) => {
        const [d, a, gjson, resultsRes] = await Promise.all([
          fetchProjectDetail(name),
          getCachedAttributes(name),
          getCachedGeoJSON(name),
          getCachedResults(name)
            .then(async data => {
              if (!data.result_rows || data.result_rows.length === 0) {
                const calc = await calculateScore(name);
                return calc.ok ? calc : { result_rows: [] };
              }
              return data;
            })
            .catch(() => ({ result_rows: [] })),
        ]);
        return { name, detail: d ?? null, attrs: a?.rows ?? [], geo: gjson?.features ?? [], scores: resultsRes?.result_rows ?? [] };
      }));

      // Aggregate
      const newMap: any[] = [];
      const newAttrs: any[] = [];
      const newGeo: any[] = [];
      const newScores: any[] = [];

      let start = 0;
      for (const res of results) {
        // Cap to min(geo, scores) to prevent index misalignment when a project
        // has no attributes (e.g. TPYLor63Q25: 208 geo features, 0 scores).
        const geoCount = Math.min(res.geo.length, res.scores.length);
        newMap.push({ name: res.name, startIndex: start, count: geoCount, detail: res.detail });
        newAttrs.push(...res.attrs.slice(0, geoCount));
        newGeo.push(...res.geo.slice(0, geoCount));
        newScores.push(...res.scores.slice(0, geoCount));
        start += geoCount;
      }

      setProjectMap(newMap);
      setAttrs(newAttrs);
      setGeoFeatures(newGeo);
      setScores(newScores);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [projectNames, setProjectMap]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch attribute mappings (global, not per-project)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const map = await fetchAttributeMappings();
        if (!cancelled) setAttrMappings(map);
      } catch {
        if (!cancelled) setAttrMappings({});
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Treatment application state: which segments have treatments applied, plus the
  // background/segment-change loads and the Treat-All/Reset-All completion listeners.
  const { treatmentState, setTreatmentState, appliedTreatmentIds, segmentHasTreatments } = useTreatmentState({
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
  });

  const combinedTreatmentIds = useMemo(() => {
    return [...new Set([...appliedTreatmentIds, ...Array.from(selectedTreatments)])];
  }, [appliedTreatmentIds, selectedTreatments]);

  // Segment view: the checkboxes reflect ONLY the active segment's persisted treatments.
  // On every segment change we hard-reset the selection to that segment's saved set, so a
  // treatment checked on one segment never leaks onto another. `treatmentState` is
  // bulk-loaded on mount and synced on save, making this reliable on back-navigation.
  // Saves are click-driven (scheduleSegmentSave), so seeding here never triggers a write.
  const lastSeededIndexRef = useRef<number | null>(null);
  useEffect(() => {
    if (accordionView !== "segment") {
      lastSeededIndexRef.current = null; // force a re-seed when returning to segment view
      return;
    }
    const persisted = treatmentState[currentIndex]?.treatment_ids ?? [];
    if (lastSeededIndexRef.current !== currentIndex) {
      // Entered a new segment — reset checkboxes to exactly this segment's treatments.
      lastSeededIndexRef.current = currentIndex;
      setSelectedTreatments(new Set(persisted));
      return;
    }
    // Same segment, treatmentState arrived/changed (async bulk-load): fill in only when the
    // user hasn't selected anything yet, so in-progress edits are never clobbered.
    setSelectedTreatments((prev) =>
      prev.size === 0 && persisted.length > 0 ? new Set(persisted) : prev
    );
  }, [currentIndex, treatmentState, accordionView]);

  // Resolve current project name for UI display
  const currentCtx = resolveIndex(currentIndex);

  const handleConfirmApplyToAll = useCallback(async () => {
    if (selectedTreatments.size === 0 || !currentCtx) return;
    setApplyLoading(true);
    setOpenConfirmAlert(false);
    try {
      const allDetails: any[] = [];
      // Apply across every project (All Projects) or only the active tab's project.
      const targets = isAllScope ? projectMap : projectMap.filter(p => p.name === activeProject);
      for (const id of Array.from(selectedTreatments)) {
        for (const proj of targets) {
          const res = await applySpecificTreatment(proj.name, id);
          if (res.details) {
            res.details.forEach((d: any) => d.projectName = proj.name);
            allDetails.push(...res.details);
          }
        }
      }
      window.dispatchEvent(new CustomEvent("psat:treat:all:completed", { detail: allDetails }));
      setSelectedTreatments(new Set());
      setShowPostTreatment(true);
    } catch (e: unknown) {
      console.error("Apply specific failed:", e);
      alert(e instanceof Error ? e.message : "Failed to apply treatment");
    } finally {
      setApplyLoading(false);
    }
  }, [selectedTreatments, currentCtx, isAllScope, projectMap, activeProject]);

  // Bulk "by treatment" view: live, non-persisting preview of the selected treatments.
  useEffect(() => {
    if (accordionView === "segment") return; // segment view persists via scheduleSegmentSave
    const ctx = resolveIndex(currentIndex);
    if (!ctx || currentIndex < 0 || selectedTreatments.size === 0) {
      setPreviewScores(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewScores(null);
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const result = await previewTreatments(ctx.name, {
          segment_index: ctx.localIndex,
          treatment_ids: combinedTreatmentIds,
        });
        if (cancelled || !result.ok) return;
        setPreviewScores({
          BB: result.after_scores.BB,
          BP: result.after_scores.BP,
          SB: result.after_scores.SB,
          VB: result.after_scores.VB,
          total: result.after_scores["Overall Risk Level"],
        });
      } catch (e) {
        // ignore
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [combinedTreatmentIds, currentIndex, resolveIndex, selectedTreatments, accordionView]);

  // Segment-view click-driven auto-save engine (see root CLAUDE.md "By-Segment Auto-Save").
  const { autoSaveStatus, scheduleSegmentSave } = useTreatmentEngine({
    currentIndex,
    resolveIndex,
    imgRef,
    setTreatmentState,
    setPreviewScores,
    setShowPostTreatment,
  });

  // Treatment-effectiveness / impact-analysis derivations (effectiveness counts, applicable
  // treatments, before/after band distributions, score-drop ranking, modified-attrs preview).
  const {
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
  } = useTreatmentAnalysis({
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
  });

  // Pagination
  const gotoPage = useCallback(
    (page: number) => {
      if (len === 0) return;
      const clamped = Math.min(Math.max(1, page), len);
      setCurrentPage(clamped);
      // Reset selected treatments and preview when navigating to a new segment
      setSelectedTreatments(new Set());
      setPreviewScores(null);
      setPreviewLoading(false);
      setSegmentScoreDrops({});
    },
    [len, setSegmentScoreDrops]
  );

  // Apply the ?segment= param once data is loaded — the useState initializer
  // alone is racy against the debounced commitPage clamp below.
  useEffect(() => {
    if (pendingSegment.current === null || len === 0) return;
    gotoPage(pendingSegment.current);
    pendingSegment.current = null;
  }, [len, gotoPage]);

  // Page number shown to the user — the position of the current segment within the
  // navigable list (`pageIndices`), which already accounts for project scope and (in
  // filter mode) the filtered subset. currentPage/currentIndex stay global internally.
  const scopePage = Math.max(1, pageIndices.indexOf(currentIndex) + 1);
  const scopeTotal = pageIndices.length;

  useEffect(() => {
    setPageInput(String(scopePage));
  }, [scopePage]);

  const commitPage = useCallback(
    (valStr: string) => {
      const raw = Number(valStr);
      if (!Number.isFinite(raw)) return;
      // Data not loaded yet — don't let the clamp below collapse the page to 1.
      if (pageIndices.length === 0) return;
      // valStr is a 1-based position within the navigable list; map back to a global index.
      const relClamped = Math.min(Math.max(1, raw), pageIndices.length);
      const targetGlobal = pageIndices[relClamped - 1];
      // Skip if the page hasn't actually changed — prevents spurious gotoPage calls
      // (which reset segmentScoreDrops) when scope/gotoPage are recreated on data load.
      if (targetGlobal === undefined || targetGlobal === currentIndex) return;
      gotoPage(targetGlobal + 1);
    },
    [gotoPage, pageIndices, currentIndex]
  );

  useEffect(() => {
    const t = setTimeout(() => commitPage(pageInput), 300);
    return () => clearTimeout(t);
  }, [pageInput, commitPage]);

  // Filter context for the before/after maps. The maps receive ALL aggregated features with
  // startIndex=0, so GeoDataPanel's localIdx === global index. We therefore build a SINGLE
  // entry keyed to the active project name (the only one GeoDataPanel reads) whose
  // filteredIndices are the GLOBAL indices to show (the filtered subset within the active
  // scope = pageIndices). `points` is left empty so the maps keep their risk-band / after-
  // treatment colors (filterColorMap falls back to the score-based color).
  const mapFilterContext = useMemo<CodingFilterContext | null>(() => {
    if (!filterMode || !filterContext || !currentCtx) return null;
    return {
      projects: [{ projectName: currentCtx.name, filteredIndices: pageIndices, points: [] }],
    };
  }, [filterMode, filterContext, currentCtx, pageIndices]);


  const projectContributors = useMemo(() => {
    if (!currentCtx?.name) return null;
    const entry = projectMap.find((p) => p.name === currentCtx.name);
    if (!entry) return null;
    const slice = scores.slice(entry.startIndex, entry.startIndex + entry.count) as Array<Record<string, unknown>>;
    return {
      projectName: currentCtx.name,
      contributors: aggregateTopContributors(slice),
    };
  }, [scores, projectMap, currentCtx?.name]);

  const currentImageUrl = useMemo(() => {
    if (!currentCtx?.name || !imgRef) {
      return null;
    }

    return buildProjectImageUrl(currentCtx.name, imgRef);
  }, [currentCtx, imgRef]);

  const handleCopyTreatmentPrompt = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    const message = buildTreatmentCopyMessage(ids);
    setCopyButtonState("copying");

    try {
      await copyTextToClipboard(message);
      setCopyButtonState("copied");
      toaster.create({
        title: "Prompt copied",
        description: "The treatment prompt is ready to paste.",
        type: "success",
      });
    } catch (error) {
      setCopyButtonState("error");
      toaster.create({
        title: "Copy failed",
        description: error instanceof Error ? error.message : "Failed to copy the treatment prompt.",
        type: "error",
      });
    }
  }, []);

  const handleCopyCurrentImage = useCallback(async () => {
    if (!currentImageUrl) return;
    setImageCopyButtonState("copying");

    try {
      await copyRichContentToClipboard({ imageUrl: currentImageUrl, imageOnly: true });
      setImageCopyButtonState("copied");
      toaster.create({
        title: "Image copied",
        description: "The segment image is ready to paste.",
        type: "success",
      });
    } catch (error) {
      setImageCopyButtonState("error");
      toaster.create({
        title: "Image copy failed",
        description: error instanceof Error ? error.message : "Failed to copy the image.",
        type: "error",
      });
    }
  }, [currentImageUrl]);

  useEffect(() => {
    const hasTransient =
      copyButtonState === "copied" || copyButtonState === "error" ||
      imageCopyButtonState === "copied" || imageCopyButtonState === "error";

    if (!hasTransient) return;

    const timeout = window.setTimeout(() => {
      setCopyButtonState("idle");
      setImageCopyButtonState("idle");
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [copyButtonState, imageCopyButtonState]);

  const copyButtonLabel =
    copyButtonState === "copying"
      ? "Copying..."
      : copyButtonState === "copied"
        ? "Copied!"
        : copyButtonState === "error"
          ? "Copy failed"
          : "Copy Prompt";

  const imageCopyButtonLabel =
    imageCopyButtonState === "copying"
      ? "Copying..."
      : imageCopyButtonState === "copied"
        ? "Copied!"
        : imageCopyButtonState === "error"
          ? "Copy failed"
          : "Copy Image";

  const hasApplied = appliedTreatmentIds.length > 0;
  const hasSelected = selectedTreatments.size > 0;
  // In the bulk "by treatment" view the selection is staged (unsaved) and drives a live
  // score/attribute preview. In segment view the selection mirrors the applied set, so
  // the Pre/Post toggle controls the display instead — never the selection size.
  const isStagingPreview = accordionView !== "segment" && selectedTreatments.size > 0;

  // ── Unsaved-changes guard (feeds the Sidebar's v2 exit-confirmation dialog) ──────────
  // Segment-view treatment toggles auto-persist to the backend (every `apply` calls
  // `save_all`, and a pending debounce is flushed on unmount), so the ONLY genuinely
  // unsaved state is a staged bulk "By Treatment" selection that hasn't been applied yet.
  // Expose exactly that as `window.psat_hasUnsavedChanges` — the flag `Sidebar.guardedAction`
  // reads (route-gated to /treatment/*) to decide whether to prompt before navigating away.
  useEffect(() => {
    (window as any).psat_hasUnsavedChanges = isStagingPreview;
    // Clear on unmount so a stale flag never prompts on an unrelated page.
    return () => { (window as any).psat_hasUnsavedChanges = false; };
  }, [isStagingPreview]);

  // The shared exit dialog dispatches `psat:save` / `psat:discard`; honour both so its
  // buttons act on the staged selection (Save = commit it exactly as the Apply button
  // would; Discard = drop the staged draft and its live preview).
  useEffect(() => {
    const handleSave = () => { void handleConfirmApplyToAll(); };
    const handleDiscard = () => {
      setSelectedTreatments(new Set());
      setPreviewScores(null);
      setSegmentScoreDrops({});
    };
    window.addEventListener("psat:save", handleSave);
    window.addEventListener("psat:discard", handleDiscard);
    return () => {
      window.removeEventListener("psat:save", handleSave);
      window.removeEventListener("psat:discard", handleDiscard);
    };
  }, [handleConfirmApplyToAll, setSegmentScoreDrops]);

  // ════════ v2 page-level actions (on-canvas; v1 routes these via the sidebar) ════════
  const onConfirmResetAll = useCallback(async () => {
    const targets = isAllScope ? projectNames : [activeProject];
    setIsResettingAll(true);
    try {
      let totalReset = 0;
      const errors: string[] = [];
      for (const proj of targets) {
        try {
          const result = await resetAllTreatments(proj);
          if (result.ok) totalReset += result.segments_reset;
        } catch {
          errors.push(`${proj}: Failed`);
        }
      }
      toaster.create({
        title: "Treatments Reset",
        description: `Reset ${totalReset} segments across ${targets.length} project(s).`,
        type: "success",
      });
      window.dispatchEvent(new CustomEvent("psat:reset:all:completed"));
      setResetAllConfirmOpen(false);
      if (errors.length > 0) {
        toaster.create({ description: `Errors: ${errors.join("; ")}`, type: "error" });
      }
    } catch (error) {
      toaster.create({
        description: error instanceof Error ? error.message : "Failed to reset treatments",
        type: "error",
      });
    } finally {
      setIsResettingAll(false);
    }
  }, [isAllScope, projectNames, activeProject]);

  const onSaveAll = useCallback(async () => {
    setIsSavingAll(true);
    try {
      const errors: string[] = [];
      for (const proj of projectNames) {
        try {
          await saveTreatments(proj);
        } catch {
          errors.push(`${proj}: Failed`);
        }
      }
      if (errors.length === 0) {
        toaster.create({
          title: "Treatments Saved",
          description: `Saved all changes for ${projectNames.length} project(s).`,
          type: "success",
        });
      } else {
        toaster.create({ description: `Saved with some errors: ${errors.join("; ")}`, type: "error" });
      }
    } finally {
      setIsSavingAll(false);
    }
  }, [projectNames]);

  const onGenerateReport = useCallback(() => {
    sessionStorage.setItem(SESSION_KEYS.TREATMENT_LOADED_PROJECTS, JSON.stringify(projectNames));
    sessionStorage.removeItem(SESSION_KEYS.PA_LOADED_PROJECTS);
    navigate("/analysis/report");
  }, [projectNames, navigate]);

  const hasSavedReport = useMemo(() => {
    try { return !!localStorage.getItem(LOCAL_KEYS.REPORT_LAYOUT); } catch { return false; }
  }, []);

  const vm: TreatmentViewModel = {
    projectNames,
    loading,
    error,
    attrs,
    geoFeatures,
    scores,
    afterTreatmentScores,
    len,
    activeProject,
    isAllScope,
    scope,
    panKey,
    currentCtx,
    curvData,
    widthM: widthData?.width ?? null,
    grade: gradeMetrics.grade,
    gradientPct: gradeMetrics.gradientPct,
    gradientStatus: gradeMetrics.gradientStatus,
    onSelectAllProjects: () => {
      setActiveProject(ALL_PROJECTS);
      setCurrentPage((filterMode ? (filteredGlobalIndices[0] ?? 0) : 0) + 1);
      setPageInput("1");
      setPanKey((k) => k + 1);
    },
    onSelectProject: (name) => {
      setActiveProject(name);
      setCurrentPage(getProjectFirstSegmentIndex(name) + 1);
      setPageInput("1");
      setPanKey((k) => k + 1);
    },
    getProjectSegmentCount,
    currentIndex,
    currentPage,
    scopePage,
    scopeTotal,
    pageIndices,
    pageInput,
    setPageInput,
    commitPage,
    gotoPage,
    imgRef,
    currentImageUrl,
    accordionView,
    setAccordionView,
    effectivenessLoading,
    allApplicableTreatments,
    effectivenessCounts,
    applicableCounts,
    segmentScoreDrops,
    fullyAppliedTreatments,
    selectedTreatments,
    setSelectedTreatments,
    treatmentState,
    applyLoading,
    hasApplied,
    hasSelected,
    appliedTreatmentIds,
    onApplyTreatments: () => {},
    onResetTreatments: () => {
      setSelectedTreatments(new Set());
      scheduleSegmentSave([]);
    },
    autoSaveStatus,
    scheduleSegmentSave,
    copyButtonState,
    copyButtonLabel,
    imageCopyButtonState,
    imageCopyButtonLabel,
    onCopyTreatmentPrompt: handleCopyTreatmentPrompt,
    onCopyCurrentImage: handleCopyCurrentImage,
    showPostTreatment,
    setShowPostTreatment,
    segmentHasTreatments,
    modifiedAttrs,
    changedAttributes,
    changedFieldSources,
    attrMappings,
    activeAttributeGroupTab,
    onContributorClick: handleContributorClick,
    isStagingPreview,
    previewScores,
    previewLoading,
    projectContributors,
    mapFilterContext,
    filterMode,
    beforeBandCounts,
    afterBandCounts,
    openConfirmAlert,
    setOpenConfirmAlert,
    onConfirmApplyToAll: handleConfirmApplyToAll,
    onBack: () => navigate("/analysis/path"),
    effectivenessLabel,
    improvedSegmentCount,
    onResetAll: () => setResetAllConfirmOpen(true),
    onSaveAll,
    onGenerateReport,
    hasSavedReport,
    isSavingAll,
    resetAllConfirmOpen,
    onConfirmResetAll,
    onCancelResetAll: () => setResetAllConfirmOpen(false),
    isResettingAll,
  };

  return ui === "v2"
    ? <TreatmentDetailLayoutV2 {...vm} />
    : <TreatmentDetailLayoutV1 {...vm} />;
}
