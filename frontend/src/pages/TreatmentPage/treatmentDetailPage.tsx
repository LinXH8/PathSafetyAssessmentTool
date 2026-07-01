import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  Box,
  Flex,
  Grid,
  GridItem,
  Text,
  Spinner,
  NumberInput,
  Button,
  Dialog,
  Portal,
  CloseButton,
} from "@chakra-ui/react";
import { LuCheck, LuCopy, LuImage } from "react-icons/lu";
import { Switch } from "../../components/ui/switch";
import { Tooltip } from "../../components/ui/tooltip";

import type { Feature, FeatureCollection } from "geojson";

import {
  fetchProjectDetail,
  applyTreatments,
  getSegmentTreatments,
  getAllTreatments,
  fetchAttributeMappings,
  previewTreatments,
  applySpecificTreatment,
  getTreatmentEffectiveness,
  getTreatmentSegmentEffectiveness,
  calculateScore,
  resetAllTreatments,
  saveTreatments,
} from "../../api";

import type { AttributeRow, CodingFilterContext } from "../../api";
import { getCachedGeoJSON, getCachedAttributes, getCachedResults } from "../../api/projectDataCache";
import ImagePanel from "../CodingPage/components/ImagePanel";
import PostTreatmentImageUpload from "./components/PostTreatmentImageUpload";
import AttributesPanel, { resolveContributorTabGroup } from "../CodingPage/components/AttributesPanel";
import GeoDataPanel from "../CodingPage/components/GeoDataPanel";
import SegmentScoresCard from "../../components/visualization/scoreband/SegmentScoresCard";
import { aggregateTopContributors } from "../../utils/aggregateTopContributors";
import { toaster } from "../../components/ui/toaster";
import { useUiVersion } from "../../features/ui/useUiVersion";

import {
  ALL_PROJECTS,
  getApplicableTreatments,
  applyTreatmentEffects,
  calculateBandFromScore,
  calculateBandDistributions,
  buildProjectImageUrl,
  buildTreatmentCopyMessage,
  copyTextToClipboard,
  copyRichContentToClipboard,
  type ProjectDetail,
  type AttributesResponse,
  type ScoreType,
  type Treatment,
  type CopyButtonState,
} from "./treatmentConstants";

export default function TreatmentDetailPage() {
  const { projectName } = useParams<{ projectName: string }>();
  const navigate = useNavigate();
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
      const raw = sessionStorage.getItem("treatment_filterContext");
      return raw ? (JSON.parse(raw) as CodingFilterContext) : null;
    } catch {
      return null;
    }
  }, [filterMode]);

  const [projectMap, setProjectMap] = useState<Array<{
    name: string;
    startIndex: number;
    count: number;
    detail: ProjectDetail;
  }>>([]);

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

  const [geoFeatures, setGeoFeatures] = useState<Feature[]>([]);
  const [scores, setScores] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTreatments, setSelectedTreatments] = useState<Set<number>>(new Set());
  // Inline auto-save status for the "By Segment" view (replaces the Apply button)
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  // Debounce timer for the segment-view auto-save (click-driven).
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds a flush fn for a debounced auto-save that hasn't fired yet, so navigating
  // away (segment change / unmount) can persist it instead of dropping it.
  const pendingSaveRef = useRef<null | (() => void)>(null);

  const [attrMappings, setAttrMappings] = useState<Record<string, Record<string, string>>>({});
  const [showPostTreatment, setShowPostTreatment] = useState<boolean>(false);
  const [activeAttributeGroupTab, setActiveAttributeGroupTab] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Treatment application state
  const [treatmentState, setTreatmentState] = useState<Record<number, {
    applied: boolean;
    treatment_ids: number[];
    after_scores: ScoreType | null;
  }>>({});

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

  const appliedTreatmentIds = useMemo(() => {
    return treatmentState[currentIndex]?.treatment_ids ?? [];
  }, [currentIndex, treatmentState]);

  const segmentHasTreatments = treatmentState[currentIndex]?.applied === true;

  const combinedTreatmentIds = useMemo(() => {
    return [...new Set([...appliedTreatmentIds, ...Array.from(selectedTreatments)])];
  }, [appliedTreatmentIds, selectedTreatments]);

  // Helper to resolve index
  const resolveIndex = useCallback((globalIndex: number) => {
    for (const p of projectMap) {
      if (globalIndex >= p.startIndex && globalIndex < p.startIndex + p.count) {
        return { name: p.name, localIndex: globalIndex - p.startIndex };
      }
    }
    return null;
  }, [projectMap]);

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
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [projectNames]);

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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
  }, [projectMap]);

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
  }, [resolveIndex, currentIndex, refreshTrigger]);

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
    } catch (e: any) {
      console.error("Apply specific failed:", e);
      alert(e.message || "Failed to apply treatment");
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
    [len]
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
    sessionStorage.setItem("treatment_loadedProjects", JSON.stringify(projectNames));
    sessionStorage.removeItem("pathAnalysis_loadedProjects");
    navigate("/analysis/report");
  }, [projectNames, navigate]);

  return (
    <Box p="4">
      {/* Back to the Path Analysis page. Analysis restores its loaded projects + filters
          from sessionStorage (and the shared projectDataCache), so its state is preserved. */}
      <Flex mb="3">
        <Button
          variant="outline"
          colorPalette="gray"
          size="sm"
          onClick={() => navigate("/analysis/path")}
        >
          ← Back to Analysis
        </Button>
      </Flex>

      {/* Project Tabs - scope the whole page to one project (or All Projects) */}
      {projectNames.length > 1 && (
        <Flex gap="2" mb="4" wrap="wrap">
          {/* All Projects tab — aggregate view across every loaded project */}
          <Button
            onClick={() => {
              setActiveProject(ALL_PROJECTS);
              setCurrentPage((filterMode ? (filteredGlobalIndices[0] ?? 0) : 0) + 1);
              setPageInput("1");
              setPanKey((k) => k + 1);
            }}
            variant={isAllScope ? "solid" : "outline"}
            colorPalette={isAllScope ? "blue" : "gray"}
            size="md"
          >
            All Projects ({filterMode ? filteredGlobalIndices.length : len})
          </Button>
          {projectNames.map((proj) => {
            const isActive = activeProject === proj;
            const segmentCount = getProjectSegmentCount(proj);
            if (segmentCount === 0) return null;
            return (
              <Button
                key={proj}
                onClick={() => {
                  setActiveProject(proj);
                  // Narrow focus and jump to this project's first segment
                  const firstSegmentPage = getProjectFirstSegmentIndex(proj) + 1;
                  setCurrentPage(firstSegmentPage);
                  setPageInput("1"); // scope-relative first page
                  setPanKey((k) => k + 1);
                }}
                variant={isActive ? "solid" : "outline"}
                colorPalette={isActive ? "blue" : "gray"}
                size="md"
              >
                {proj} ({segmentCount})
              </Button>
            );
          })}
        </Flex>
      )}

      {/* Header with project info and pagination */}
      <Flex justify="space-between" align="center" mb="3">
        <Box>
          <Text fontSize="lg" fontWeight="bold" color="gray.900" _dark={{ color: "white" }}>
            {currentCtx ? currentCtx.name : "Unknown Project"}
          </Text>
          <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
            Loaded: {projectNames.length} project{projectNames.length > 1 ? 's' : ''}
          </Text>
        </Box>

        <Flex align="center" gap="3">
          <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
            {scopeTotal > 0 ? `${scopePage} / ${scopeTotal}` : "0 / 0"}
          </Text>

          <NumberInput.Root
            maxW="120px"
            min={1}
            max={scopeTotal || 1}
            defaultValue={String(scopePage)}
            value={pageInput}
            onValueChange={(e) => setPageInput(e.value)}
          >
            <NumberInput.Control />
            <NumberInput.Input
              onBlur={() => commitPage(pageInput)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.currentTarget.blur();
                }
              }}
            />
          </NumberInput.Root>
        </Flex>
      </Flex>

      {/* Map Previews: Before and After Treatment - Side by Side */}
      <Grid templateColumns={{ base: "1fr", lg: "repeat(2, minmax(0, 1fr))" }} gap="16px" mb="6" w="100%">
        {/* Before Treatment Map */}
        <GridItem minW="0" w="100%">
          <GeoDataPanel
            projectName={currentCtx ? currentCtx.name : ""}
            feature={
              geoFeatures[currentIndex]?.geometry?.type === "LineString"
                ? (geoFeatures[currentIndex] as any)
                : null
            }
            index={currentIndex}
            onJump={(i) => setCurrentPage(i + 1)}
            containerHeight={MAP_HEIGHT}
            subtitle="Before Treatment"
            geoFeatures={geoFeatures as Feature<LineString, any>[]}
            startIndex={0}
            scores={scores as any}
            scopeRange={isAllScope ? null : scope}
            filterContext={mapFilterContext}
            autoFitKey={panKey}
            panKey={panKey}
          />
        </GridItem>

        {/* After Treatment Map */}
        <GridItem minW="0" w="100%">
          <GeoDataPanel
            projectName={currentCtx ? currentCtx.name : ""}
            feature={
              geoFeatures[currentIndex]?.geometry?.type === "LineString"
                ? (geoFeatures[currentIndex] as any)
                : null
            }
            index={currentIndex}
            onJump={(i) => setCurrentPage(i + 1)}
            containerHeight={MAP_HEIGHT}
            scores={afterTreatmentScores as any}
            subtitle="After Treatment"
            geoFeatures={geoFeatures as Feature<LineString, any>[]}
            startIndex={0}
            scopeRange={isAllScope ? null : scope}
            filterContext={mapFilterContext}
            autoFitKey={panKey}
            panKey={panKey}
          />
        </GridItem>
      </Grid>

      {/* Main layout: 3 Columns - Image | Treatments | Scores+Attributes */}
      <Grid templateColumns={{ base: "1fr", lg: "0.5fr 1.5fr 1.5fr" }} gap="16px" mb="6">
        {/* Left: Recommended Treatments (Vertical, Scrollable) */}
        <GridItem position="relative" minH={{ base: "400px", lg: "0" }}>
          <Box
            position={{ base: "relative", lg: "absolute" }}
            top="0" bottom="0" left="0" right="0"
            display="flex"
            flexDirection="column"
            bg="gray.50"
            _dark={{ bg: "gray.800" }}
            borderWidth="1px"
            borderColor="gray.200"
            borderRadius="md"
            overflow="hidden"
          >
            <Box p="3" borderBottomWidth="1px" borderColor="gray.200" _dark={{ borderColor: "gray.700" }}>
              <Text fontSize="sm" fontWeight="bold" color="gray.700" _dark={{ color: "gray.200" }}>
                Treatment Options
              </Text>
              <Tooltip
                content={
                  accordionView === "segment" ? (
                    <Text>
                      <b>By Segment:</b> View and apply treatments for the current segment only.
                    </Text>
                  ) : (
                    <Text>
                      <b>By Treatment:</b> View and apply a single treatment across all applicable segments.
                    </Text>
                  )
                }
                showArrow
                openDelay={400}
                contentProps={{ maxW: "250px" }}
              >
                <Box mt="2">
                  <select
                    value={accordionView}
                    onChange={(e) => {
                      setAccordionView(e.target.value as "segment" | "treatment");
                      setSelectedTreatments(new Set());
                    }}
                    style={{
                      width: "100%",
                      padding: "6px",
                      borderRadius: "6px",
                      border: "1px solid var(--chakra-colors-gray-300)",
                      backgroundColor: "white",
                      color: "inherit",
                      fontSize: "14px",
                      cursor: "pointer",
                    }}
                    className="theme-select"
                  >
                    <option value="segment">By Segment</option>
                    <option value="treatment">By Treatment</option>
                  </select>
                </Box>
              </Tooltip>
            </Box>

            <Box flex="1" overflowY="auto" p="3">
              {(() => {
                let displayTreatments: Treatment[] = [];
                const currentAttr = attrs[currentIndex] as any;

                if (accordionView === "segment") {
                  if (!currentAttr) {
                    return <Text fontSize="xs" color="gray.400">No segment data</Text>;
                  }
                  displayTreatments = getApplicableTreatments(currentAttr)
                    .sort((a, b) => (segmentScoreDrops[b.id] ?? 0) - (segmentScoreDrops[a.id] ?? 0));
                } else {
                  if (effectivenessLoading) {
                    return (
                      <Flex direction="column" align="center" justify="center" gap="3" py="8">
                        <Spinner size="sm" color="blue.500" />
                        <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
                          Ranking Treatment Options...
                        </Text>
                      </Flex>
                    );
                  }
                  displayTreatments = allApplicableTreatments.filter(t =>
                    (effectivenessCounts[t.id] ?? 0) > 0
                  );
                }

                if (displayTreatments.length === 0) {
                  return (
                    <Text fontSize="xs" color="gray.400" _dark={{ color: "gray.500" }}>
                      {accordionView === "segment" ? "No treatments applicable" : "No treatments applicable in whole project"}
                    </Text>
                  );
                }

                return (
                  <Flex direction="column" gap="2">
                    {displayTreatments.map((t) => {
                      const isApplied = accordionView === "segment"
                        ? (treatmentState[currentIndex]?.applied && treatmentState[currentIndex]?.treatment_ids.includes(t.id))
                        : fullyAppliedTreatments.has(t.id);

                      // In segment view treatments auto-save and stay toggleable; only the
                      // bulk "by treatment" view disables already-applied rows.
                      const isDisabled = accordionView === "segment" ? false : isApplied;

                      // Segment view: a checked treatment IS the applied state, so keep it as a
                      // normal blue ticked checkbox rather than the green "applied" styling
                      // (which is reserved for the bulk "by treatment" view).
                      const showAppliedStyle = accordionView === "segment" ? false : isApplied;

                      return (
                        <Flex
                          key={t.id}
                          gap="2"
                          align="flex-start"
                          p="2"
                          borderRadius="md"
                          bg={
                            showAppliedStyle
                              ? "green.50"
                              : selectedTreatments.has(t.id)
                                ? "blue.50"
                                : "white"
                          }
                          borderWidth="1px"
                          borderColor={
                            showAppliedStyle
                              ? "green.200"
                              : selectedTreatments.has(t.id)
                                ? "blue.200"
                                : "gray.200"
                          }
                          cursor={isDisabled ? "not-allowed" : "pointer"}
                          opacity={isDisabled ? 0.6 : 1}
                          transition="all 0.2s"
                          _hover={{
                            borderColor: isDisabled ? undefined : "blue.300",
                            shadow: isDisabled ? undefined : "sm"
                          }}
                          _dark={{
                            bg: showAppliedStyle
                              ? "green.900"
                              : selectedTreatments.has(t.id)
                                ? "blue.900"
                                : "gray.700",
                            borderColor: showAppliedStyle
                              ? "green.700"
                              : selectedTreatments.has(t.id)
                                ? "blue.700"
                                : "gray.600",
                          }}
                          onClick={() => {
                            if (isDisabled) return;
                            const newSelected = new Set(selectedTreatments);
                            if (newSelected.has(t.id)) {
                              newSelected.delete(t.id);
                            } else {
                              newSelected.add(t.id);
                            }
                            setSelectedTreatments(newSelected);
                            // Segment view auto-saves on toggle; treatment view stages for Apply.
                            if (accordionView === "segment") {
                              scheduleSegmentSave(Array.from(newSelected).sort((a, b) => a - b));
                            }
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={accordionView === "segment" ? selectedTreatments.has(t.id) : (isApplied || selectedTreatments.has(t.id))}
                            disabled={isDisabled}
                            onChange={() => { }}
                            style={{ marginTop: '3px', cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                            aria-label={`Select treatment: ${t.name}`}
                          />
                          <Box flex="1">
                            <Text fontSize="xs" fontWeight="medium" color="gray.900" _dark={{ color: "white" }} lineHeight="1.2">
                              {t.name}
                              {showAppliedStyle && " ✓"}
                            </Text>
                            {accordionView === "treatment" && (
                              <Text fontSize="2xs" color="blue.600" _dark={{ color: "blue.300" }} mt="1" fontWeight="semibold">
                                {(() => {
                                  const count = effectivenessCounts[t.id] ?? 0;
                                  const applicable = applicableCounts[t.id] ?? 0;
                                  const denominator = applicable > 0 ? applicable : attrs.length;
                                  const pct = (denominator > 0 && count > 0) ? count / denominator * 100 : 0;
                                  const display = count > 0 ? Math.max(0.1, pct).toFixed(1) : "0.0";
                                  const scope = applicable > 0 ? "applicable segments" : "segments";
                                  return `Improves ${display}% of ${scope}`;
                                })()}
                              </Text>
                            )}
                            {accordionView === "segment" && segmentScoreDrops[t.id] !== undefined && (
                              <Text fontSize="2xs" color="blue.600" _dark={{ color: "blue.300" }} mt="1" fontWeight="semibold">
                                {`Score drop: ${segmentScoreDrops[t.id].toFixed(1)}`}
                              </Text>
                            )}
                            {t.description && (
                              <Text fontSize="2xs" color="gray.500" _dark={{ color: "gray.400" }} mt="1">
                                {t.description}
                              </Text>
                            )}
                          </Box>
                        </Flex>
                      );
                    })}
                  </Flex>
                );
              })()}
            </Box>

            {/* Action Buttons Footer */}
            <Box p="3" borderTopWidth="1px" borderColor="gray.200" bg="white" _dark={{ borderColor: "gray.700", bg: "gray.800" }}>
              <Flex direction="column" gap="2">
                <Flex gap="2">
                  <Button
                    flex="1"
                    size="xs"
                    variant="outline"
                    colorScheme={selectedTreatments.size > 0 ? "red" : "blue"}
                    disabled={
                      (() => {
                        if (accordionView === "segment") {
                          const currentAttr = attrs[currentIndex] as any;
                          if (!currentAttr) return true;
                          const applicable = getApplicableTreatments(currentAttr);
                          const appliedIds = treatmentState[currentIndex]?.treatment_ids ?? [];
                          return applicable.every(t => appliedIds.includes(t.id));
                        } else {
                          return allApplicableTreatments.length === 0;
                        }
                      })()
                    }
                    onClick={() => {
                      let next: Set<number>;
                      if (selectedTreatments.size > 0) {
                        next = new Set();
                      } else if (accordionView === "segment") {
                        const currentAttr = attrs[currentIndex] as any;
                        if (!currentAttr) return;
                        next = new Set(getApplicableTreatments(currentAttr).map(t => t.id));
                      } else {
                        next = new Set(allApplicableTreatments.map(t => t.id));
                      }
                      setSelectedTreatments(next);
                      // Segment view auto-saves the resulting set; treatment view stages for Apply.
                      if (accordionView === "segment") {
                        scheduleSegmentSave(Array.from(next).sort((a, b) => a - b));
                      }
                    }}
                  >
                    {selectedTreatments.size > 0 ? "Clear" : "All"}
                  </Button>
                  {accordionView === "segment" && autoSaveStatus !== "idle" && (
                    <Flex flex="1" align="center" justify="flex-end" gap="1" fontSize="xs">
                      {autoSaveStatus === "saving" ? (
                        <>
                          <Spinner size="xs" />
                          <Text color="gray.500" _dark={{ color: "gray.400" }}>Saving…</Text>
                        </>
                      ) : (
                        <>
                          <LuCheck color="#22c55e" />
                          <Text color="green.600" _dark={{ color: "green.300" }}>Saved</Text>
                        </>
                      )}
                    </Flex>
                  )}
                </Flex>

                <Flex width="full" gap="2" align="stretch" wrap="wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Copy treatment prompt"
                    disabled={!hasApplied && !hasSelected}
                    loading={copyButtonState === "copying"}
                    gap="1"
                    onClick={() => {
                      const ids = hasApplied ? appliedTreatmentIds : Array.from(selectedTreatments);
                      void handleCopyTreatmentPrompt(ids);
                    }}
                  >
                    {copyButtonState === "copied" ? <LuCheck /> : <LuCopy />}
                    <span>{copyButtonLabel}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Copy current image"
                    disabled={!currentImageUrl}
                    loading={imageCopyButtonState === "copying"}
                    gap="1"
                    onClick={() => { void handleCopyCurrentImage(); }}
                  >
                    {imageCopyButtonState === "copied" ? <LuCheck /> : <LuImage />}
                    <span>{imageCopyButtonLabel}</span>
                  </Button>
                  {/* Per-segment view auto-saves on toggle, so the Apply button only
                      drives the bulk "by treatment" apply-to-all confirmation flow. */}
                  {accordionView !== "segment" && (
                    <Button
                      size="sm"
                      flex="1"
                      variant="solid"
                      colorScheme="blue"
                      disabled={selectedTreatments.size === 0 || applyLoading}
                      loading={applyLoading}
                      onClick={async () => {
                        if (selectedTreatments.size === 0 || !currentCtx) return;
                        setOpenConfirmAlert(true);
                      }}
                    >
                      {`Apply (${selectedTreatments.size})`}
                    </Button>
                  )}
                </Flex>
              </Flex>
            </Box>
          </Box>
        </GridItem>

        {/* Middle: Image Panel + Navigation Controls */}
        <GridItem
          display="flex"
          flexDirection="column"
          minH={`${PANEL_HEIGHT}px`}
        >
          {/* Navigation Controls */}
          <Flex
            flex="0 0 auto"
            h={`${CONTROLS_H}px`}
            w="100%"
            minW={0}
            align="center"
            gap="2"
            mb="4"
            position="relative"
            zIndex={1}
            bg="bg"
          >
            <Button
              flex="1"
              minW={0}
              size="sm"
              variant="outline"
              onClick={() => {
                const prev = pageIndices[scopePage - 2];
                if (prev !== undefined) gotoPage(prev + 1);
              }}
              disabled={scopePage <= 1}
            >
              Previous
            </Button>

            <Button
              flex="1"
              minW={0}
              size="sm"
              variant="solid"
              onClick={() => {
                const next = pageIndices[scopePage];
                if (next !== undefined) gotoPage(next + 1);
              }}
              disabled={scopePage >= scopeTotal}
            >
              Next
            </Button>
          </Flex>

          <Box flex="1 1 auto" minH={0} display="flex" flexDirection="column">
            <Box flex="1 1 50%" minH={0} display="flex" flexDirection="column">
              <ImagePanel
                projectName={currentCtx?.name}
                imageRef={imgRef}
              />
            </Box>
            <Box flex="1 1 50%" minH={0} display="flex" flexDirection="column">
              <PostTreatmentImageUpload
                projectName={currentCtx?.name || ""}
                segmentIndex={(currentCtx?.localIndex ?? currentIndex) + 1}
              />
            </Box>
          </Box>
        </GridItem>

        {/* Right: Crash Type Scores + Attributes Panel */}
        <GridItem
          display="flex"
          flexDirection="column"
          gap="4"
        >
          <Box
            bg="white"
            borderRadius="md"
            p="1"
            borderWidth="1px"
            borderColor="gray.200"
            _dark={{ bg: "gray.800", borderColor: "gray.600" }}
          >
            <SegmentScoresCard
              scores={(() => {
                const originalScores = scores[currentIndex] as any || null;
                const appliedAfterScores = treatmentState[currentIndex]?.after_scores;
                const appliedScoreRow = appliedAfterScores
                  ? {
                    ...scores[currentIndex],
                    BB: appliedAfterScores.BB,
                    BP: appliedAfterScores.BP,
                    SB: appliedAfterScores.SB,
                    VB: appliedAfterScores.VB,
                    "Overall Risk Level": appliedAfterScores.total,
                  } as any
                  : originalScores;

                // Live preview only for the bulk "by treatment" view's STAGED (unsaved)
                // selection. In segment view the selection mirrors the applied set, so the
                // Pre/Post toggle (showPostTreatment) is the source of truth instead.
                if (isStagingPreview) {
                  if (previewLoading || !previewScores) {
                    return appliedScoreRow;
                  }
                  return {
                    ...scores[currentIndex],
                    BB: previewScores.BB,
                    BP: previewScores.BP,
                    SB: previewScores.SB,
                    VB: previewScores.VB,
                    "Overall Risk Level": previewScores.total
                  } as any;
                }

                if (!showPostTreatment) {
                  return originalScores;
                }

                if (appliedAfterScores) {
                  return appliedScoreRow;
                }

                return originalScores;
              })()}
              beforeScores={
                (isStagingPreview || (showPostTreatment && treatmentState[currentIndex]?.applied))
                  ? {
                    BB: scores[currentIndex]?.["BB"] ?? 0,
                    BP: scores[currentIndex]?.["BP"] ?? 0,
                    SB: scores[currentIndex]?.["SB"] ?? 0,
                    VB: scores[currentIndex]?.["VB"] ?? 0,
                    "Overall Risk Level": scores[currentIndex]?.["Overall Risk Level"] ?? 0,
                  }
                  : undefined
              }
              showPreviewBackground={isStagingPreview}
              projectContributors={projectContributors}
              onContributorClick={handleContributorClick}
            />
          </Box>

          <Box
            flex="1"
            minH="0"
            overflow="hidden"
            bg="white"
            borderRadius="md"
            borderWidth="1px"
            borderColor="gray.200"
            _dark={{ bg: "gray.800", borderColor: "gray.600" }}
            display="flex"
            flexDirection="column"
          >
            <Flex
              p="2"
              borderBottomWidth="1px"
              borderColor="gray.200"
              _dark={{ borderColor: "gray.700" }}
              align="center"
              justify="space-between"
            >
              <Text fontSize="sm" fontWeight="bold">
                Attributes
              </Text>
              <Flex align="center" gap="2">
                <Text fontSize="xs" color={segmentHasTreatments ? undefined : "gray.400"}>
                  Show Pre-Treatment
                </Text>
                <Switch
                  // Untreated segments have nothing to compare: keep the toggle off + greyed.
                  checked={segmentHasTreatments ? !showPostTreatment : false}
                  disabled={!segmentHasTreatments}
                  onCheckedChange={(e: any) => setShowPostTreatment(!e.checked)}
                />
              </Flex>
            </Flex>
            <Box flex="1" minH="0">
              <AttributesPanel
                row={
                  // Pre-treatment toggle wins: show original attrs when showing pre-treatment,
                  // the treatment-modified attrs otherwise (staged preview or applied).
                  !showPostTreatment
                    ? attrs[currentIndex]
                    : (isStagingPreview || treatmentState[currentIndex]?.applied)
                      ? modifiedAttrs
                      : attrs[currentIndex]
                }
                mappings={attrMappings}
                changedFields={
                  showPostTreatment ? Array.from(changedAttributes) : []
                }
                // changedFieldSources prop name was redundant? AttributesPanel accepts fieldSources
                fieldSources={
                  showPostTreatment ? changedFieldSources : {}
                }
                highlightMessage="Modified by treatment"
                activeGroupTab={activeAttributeGroupTab}
                readOnly={true}
              />
            </Box>
          </Box>
        </GridItem>
      </Grid>

      {/* Overall Analysis Footer */}
      <Box mt="6">
        <OverallTreatmentAnalysis
          beforeBandCounts={beforeBandCounts}
          afterBandCounts={afterBandCounts}
        />
      </Box>

      {/* Confirm Apply All Dialog */}
      <Dialog.Root open={openConfirmAlert} onOpenChange={(d) => setOpenConfirmAlert(d.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Apply Treatments to {isAllScope ? "All Projects" : activeProject}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <p>Are you sure you want to apply the following treatments to all eligible segments in {isAllScope ? "all loaded projects" : activeProject}?</p>
                <ul style={{ marginTop: "0.5rem", paddingLeft: "1.25rem" }}>
                  {Array.from(selectedTreatments).map(id => {
                    const t = TREATMENTS.find(tr => tr.id === id);
                    return <li key={id}><strong>{t ? t.name : `Treatment ${id}`}</strong></li>;
                  })}
                </ul>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" disabled={applyLoading}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button colorPalette="blue" onClick={handleConfirmApplyToAll} loading={applyLoading}>
                  Confirm
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

    </Box>
  );
}
