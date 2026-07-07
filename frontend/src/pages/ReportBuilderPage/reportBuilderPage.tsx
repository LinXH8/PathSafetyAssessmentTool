/**
 * reportBuilderPage.tsx — the Report Builder container.
 *
 * Owns ALL report state and logic: session-restore of the loaded-project /
 * Path-Analysis-filter context, every data fetch (scores, enrichment,
 * treatments, project metadata, image date ranges, network benchmark), the
 * derived full / filtered / network datasets, the section layout model
 * (show / hide / reorder / auto-fit / save-restore), and PDF / Word export.
 * It assembles these into the rendered report canvas + left "Sections" panel.
 *
 * Decomposed in S2.5: pure types → `reportBuilderTypes.ts`; constants + default
 * layouts → `reportBuilderConstants.ts`; pure helpers (dataset build, flow
 * layout, saved-layout read) → `reportBuilderHelpers.ts`; presentational pieces
 * → `components/*`; the export pipeline → `hooks/usePdfExport.ts`. The container
 * still owns the interdependent data ↔ layout derivation web (`computeIdealHeight`
 * couples dataset sizes to section heights, and the mount effect reconciles the
 * restored layout against the live filter), which is why that spine stays here.
 * The view-model seam a future `ReportBuilderLayoutV2` would consume is defined
 * in `layouts/ReportBuilderViewModel.ts`.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  PointerSensor, KeyboardSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip as RechartTooltip } from "recharts";
import { useNavigate } from "react-router-dom";
import { MAP_MISSING_SCORE_COLOR, CATEGORY_UNKNOWN_COLOR } from "../../constants/mapColors";
import { RISK_COLORS, RISK_LABELS } from "../../utils/riskColors";
import "leaflet/dist/leaflet.css";
import "./reportBuilderPage.css";
import { getCachedResults } from "../../api/projectDataCache";
import { useUiVersion } from "../../features/ui/useUiVersion";
import { SESSION_KEYS, LOCAL_KEYS } from "../../constants/sessionKeys";
import type {
  BandDist, ElementState, EnrichedDetail, FilterCategoryStatus,
  ProjectTreatmentSummary, ReportDataset, TopRiskRow,
} from "./reportBuilderTypes";
import {
  CRASH_TYPE_LABELS, DEFAULT_ELEMENTS, FILTERED_ELEMENTS,
  FILTERED_SECTIONS_ENABLED, METHODOLOGY_TEXT, PAGE_GAP, PAGE_H,
  PROJ_CONT_HEADER_H, PROJ_HEADER_H, PROJ_PAGE_SIZE, PROJ_ROW_H,
  TREATMENT_NAMES, tdStyle, thStyle,
} from "./reportBuilderConstants";
import {
  buildCoreDataset, computeFlowLayout, dateToQuarterLabel, readSavedLayout,
} from "./reportBuilderHelpers";
import { AttrTag, EditableText, SegmentImage, TreatmentBadge } from "./components/reportPrimitives";
import { ReportMiniMap } from "./components/ReportMiniMap";
import { usePdfExport } from "./hooks/usePdfExport";
import { ReportBuilderLayoutV1 } from "./layouts/ReportBuilderLayoutV1";
import type { ReportBuilderViewModel } from "./layouts/ReportBuilderViewModel";

export default function ReportBuilderPage() {
  const navigate = useNavigate();
  const isV2 = useUiVersion() === "v2";
  const accent = isV2 ? "#319795" : "#a020d0";
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const hasAutoFit = useRef(false);
  const postTreatmentUploadRef = useRef<HTMLInputElement>(null);

  // ── State: auto-restored from localStorage if a saved layout exists ──────
  const [elements, setElements] = useState<ElementState[]>(() => {
    const REMOVED_IDS = new Set(["riskStats", "recommendations", "methodology", "segmentGallery", "deepDive", "filterAnalysis"]);
    const l = readSavedLayout();
    if (Array.isArray(l?.elements)) {
      const saved = (l.elements as ElementState[])
        .filter((e) => !REMOVED_IDS.has(e.id));
      // Inject any new default elements missing from the saved layout (e.g. benchmarkStats added after save)
      const savedIds = new Set(saved.map((e: ElementState) => e.id));
      const injected = DEFAULT_ELEMENTS.filter((e) => !savedIds.has(e.id));
      return injected.length > 0 ? [...saved, ...injected] : saved;
    }
    return DEFAULT_ELEMENTS;
  });
  const [currentPage, setCurrentPage] = useState(0);

  // ── Editable metadata ────────────────────────────────────────────────────
  const [reportTitle, setReportTitle] = useState(() => {
    const l = readSavedLayout(); return typeof l?.reportTitle === "string" ? l.reportTitle : "Path Safety Analysis Executive Summary";
  });
  const [projectNameOverrides, setProjectNameOverrides] = useState<Record<string, string>>(() => {
    const l = readSavedLayout(); return (l?.projectNameOverrides && typeof l.projectNameOverrides === "object") ? l.projectNameOverrides as Record<string, string> : {};
  });
  const [sectionTitles, setSectionTitles] = useState<Record<string, string>>(() => {
    const l = readSavedLayout(); return (l?.sectionTitles && typeof l.sectionTitles === "object") ? l.sectionTitles as Record<string, string> : {};
  });
  const [oicName, setOicName] = useState(() => {
    const l = readSavedLayout(); return typeof l?.oicName === "string" ? l.oicName : "";
  });
  const [purpose, setPurpose] = useState(() => {
    const l = readSavedLayout(); return typeof l?.purpose === "string" ? l.purpose : "";
  });
  const [recommendations, setRecommendations] = useState(() => {
    const l = readSavedLayout(); return typeof l?.recommendations === "string" ? l.recommendations : "";
  });
  const [reportDate, setReportDate] = useState(() => {
    const l = readSavedLayout(); return typeof l?.reportDate === "string" ? l.reportDate : new Date().toISOString().split("T")[0];
  });
  // ── Projects ─────────────────────────────────────────────────────────────
  const [loadedProjects, setLoadedProjects] = useState<string[]>([]);

  // ── Score data ────────────────────────────────────────────────────────────
  // `allScoreRows` is the single source of truth; per-section derived values
  // (distributions, top-risk, stats, …) are computed in `fullDataset` /
  // `filteredDataset` below.
  const [allScoreRows, setAllScoreRows] = useState<TopRiskRow[]>([]);
  const [enrichedMap, setEnrichedMap] = useState<Map<string, EnrichedDetail>>(new Map());
  const [isLoadingScores, setIsLoadingScores] = useState(false);

  // ── Network (all-profile) data for Benchmarking Stats comparison ──────────
  // allProfileProjects: every project in the active profile (fetched on mount).
  // networkScoreRows: null = not yet loaded, [] = loaded but empty.
  const [allProfileProjects, setAllProfileProjects] = useState<string[]>([]);
  const [networkScoreRows, setNetworkScoreRows] = useState<TopRiskRow[] | null>(null);
  const [isLoadingNetworkData, setIsLoadingNetworkData] = useState(false);

  // ── Path Analysis filtered subset ─────────────────────────────────────────
  // Per-project 0-based segment indices the user filtered to on the Path
  // Analysis map (null ⇒ no filter active ⇒ filtered sections unavailable).
  const [filteredIdxByProject, setFilteredIdxByProject] = useState<Record<string, number[]> | null>(null);
  // Per project → per 0-based segment index → per filter attribute → category value.
  // Drives the "Map (Filtered)" colour-by-attribute option (value → colour via
  // activeCategoryStatus, so the map matches the on-report legend).
  const [filteredSegValues, setFilteredSegValues] = useState<Record<string, Record<number, Record<string, string>>> | null>(null);
  const [includeFiltered, setIncludeFiltered] = useState<boolean>(() => {
    const l = readSavedLayout(); return l?.includeFiltered === true;
  });

  // ── Treatment data ────────────────────────────────────────────────────────
  const [treatmentSummaries, setTreatmentSummaries] = useState<ProjectTreatmentSummary[]>([]);
  const [segmentTreatmentMap, setSegmentTreatmentMap] = useState<Map<string, number[]>>(new Map());
  const [uploadingSegment, setUploadingSegment] = useState<{ project: string; segIndex: number } | null>(null);

  // ── Project metadata (name, dates, length) ────────────────────────────────
  const [projectMeta, setProjectMeta] = useState<Record<string, { dateCreated?: string; lastUpdated?: string; lengthKm?: number }>>({});
  // ── Image date ranges (earliest/latest image date per project from actual files) ─
  const [projectImageDates, setProjectImageDates] = useState<Record<string, { earliest: string; latest: string }>>({});
  const [imageDatesLoading, setImageDatesLoading] = useState(false);

  // ── Path Analysis filter sync ─────────────────────────────────────────────
  const [activeFilterNames, setActiveFilterNames] = useState<string[]>([]);
  const [activeCategoryStatus, setActiveCategoryStatus] = useState<FilterCategoryStatus[]>([]);

  const [hasSaved, setHasSaved] = useState(() => { try { return !!localStorage.getItem(LOCAL_KEYS.REPORT_LAYOUT); } catch { return false; } });
  const [saveToastVisible, setSaveToastVisible] = useState(false);
  const saveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // true when this mount auto-restored a previously saved layout
  const [wasAutoRestored] = useState(() => { try { return !!localStorage.getItem(LOCAL_KEYS.REPORT_LAYOUT); } catch { return false; } });
  const [restoreBannerVisible, setRestoreBannerVisible] = useState(wasAutoRestored);

  // ── Project picker (shown when session storage has no projects) ───────────
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<string[]>([]);
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [pickerLoading, setPickerLoading] = useState(false);

  // ── Session storage ───────────────────────────────────────────────────────
  useEffect(() => {
    const pa = sessionStorage.getItem(SESSION_KEYS.PA_LOADED_PROJECTS);
    const tr = sessionStorage.getItem(SESSION_KEYS.TREATMENT_LOADED_PROJECTS);
    const filters = sessionStorage.getItem(SESSION_KEYS.PA_ACTIVE_FILTERS);
    const catStatus = sessionStorage.getItem(SESSION_KEYS.PA_CATEGORY_STATUS);
    const filteredSegs = sessionStorage.getItem(SESSION_KEYS.PA_FILTERED_SEGMENTS);
    const filteredVals = sessionStorage.getItem(SESSION_KEYS.PA_FILTERED_SEGMENT_VALUES);
    const paP: string[] = pa ? JSON.parse(pa) : [];
    const trP: string[] = tr ? JSON.parse(tr) : [];
    const flt: string[] = filters ? JSON.parse(filters) : [];
    const cst: FilterCategoryStatus[] = catStatus ? JSON.parse(catStatus) : [];
    const fidx: Record<string, number[]> | null = filteredSegs ? JSON.parse(filteredSegs) : null;
    const fvals: Record<string, Record<number, Record<string, string>>> | null = filteredVals ? JSON.parse(filteredVals) : null;
    // Prefer the Treatment context when it's set (i.e. the report was launched from the
    // Treatment page); otherwise use the Path Analysis context. The two entry points clear
    // the other key, so this is unambiguous — and it means we no longer need to destructively
    // remove pathAnalysis_loadedProjects (which corrupted the Analysis page's loaded-projects
    // state on back-navigation).
    const combined = trP.length > 0 ? [...new Set(trP)] : [...new Set(paP)];
    setLoadedProjects(combined);
    setActiveFilterNames(flt);
    setActiveCategoryStatus(cst);
    setFilteredIdxByProject(fidx);
    setFilteredSegValues(fvals);
    // Reconcile a restored layout against the current filter: if no filter is
    // active, strip any "(Filtered)" sections (they would have no data) and
    // force the toggle off. Done here — with full knowledge of session state —
    // to avoid a mount-time race that could wipe legitimately saved sections.
    const hasFlt = !!fidx && flt.length > 0;
    if (!hasFlt) {
      setElements((prev) => (prev.some((e) => e.filtered) ? prev.filter((e) => !e.filtered) : prev));
      setIncludeFiltered(false);
    } else if (includeFiltered) {
      // Saved layout wanted filtered sections and a filter is active — ensure
      // they exist (e.g. layout saved before this feature added them).
      setElements((prev) => {
        if (prev.some((e) => e.filtered)) return prev;
        const existing = new Set(prev.map((e) => e.id));
        const toAdd = FILTERED_ELEMENTS.filter((fe) => !existing.has(fe.id)).map((fe) => ({ ...fe }));
        return toAdd.length ? [...prev, ...toAdd] : prev;
      });
    }
    // Always fetch all profile projects for the network benchmark comparison.
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const names: string[] = (d.projects ?? []).map((p: { name: string }) => p.name).sort();
        setAllProfileProjects(names);
        if (combined.length === 0) {
          setAvailableProjects(names);
          setShowProjectPicker(true);
        }
      })
      .catch(() => { if (combined.length === 0) setShowProjectPicker(true); });
  }, []);


  // ── Project metadata fetch (dates + route length) ────────────────────────
  useEffect(() => {
    if (loadedProjects.length === 0) return;
    const fetchMeta = async () => {
      const entries = await Promise.all(
        loadedProjects.map(async (name) => {
          try {
            const metaRes = await fetch(`/api/projects/${encodeURIComponent(name)}/metadata`);
            const meta = await metaRes.json();
            return {
              name,
              dateCreated: meta.date_created ?? undefined,
              lastUpdated: meta.last_updated ?? undefined,
            };
          } catch { return null; }
        })
      );
      const map: Record<string, { dateCreated?: string; lastUpdated?: string; lengthKm?: number }> = {};
      entries.forEach((e) => { if (e) map[e.name] = { dateCreated: e.dateCreated, lastUpdated: e.lastUpdated }; });
      setProjectMeta(map);
    };
    fetchMeta();
  }, [loadedProjects]);

  // ── Image date ranges fetched from actual image files ────────────────────
  useEffect(() => {
    if (loadedProjects.length === 0) return;
    const fetchImageDates = async () => {
      setImageDatesLoading(true);
      const entries = await Promise.all(
        loadedProjects.map(async (name) => {
          try {
            const res = await fetch(`/api/projects/${encodeURIComponent(name)}/image-date-range`);
            const data = await res.json();
            if (data.earliest && data.latest) return { name, earliest: data.earliest as string, latest: data.latest as string };
          } catch { /* skip */ }
          return null;
        })
      );
      const map: Record<string, { earliest: string; latest: string }> = {};
      entries.forEach((e) => { if (e) map[e.name] = { earliest: e.earliest, latest: e.latest }; });
      setProjectImageDates(map);
      setImageDatesLoading(false);
    };
    fetchImageDates();
  }, [loadedProjects]);

  // ── Quarter data derived from image capture dates ────────────────────────
  const quarterData = useMemo(() => {
    const map: Record<string, { earliest: string; latest: string; projects: string[] }> = {};
    Object.entries(projectImageDates).forEach(([name, range]) => {
      const label = dateToQuarterLabel(range.earliest);
      if (!map[label]) map[label] = { earliest: range.earliest, latest: range.latest, projects: [] };
      if (range.earliest < map[label].earliest) map[label].earliest = range.earliest;
      if (range.latest > map[label].latest) map[label].latest = range.latest;
      map[label].projects.push(name);
    });
    const parseLabel = (l: string) => { const m = l.match(/Q(\d)\s+(\d{4})/); return m ? [+m[2], +m[1]] : [0, 0]; };
    return Object.entries(map)
      .sort(([a], [b]) => { const [ay, aq] = parseLabel(a), [by, bq] = parseLabel(b); return ay !== by ? ay - by : aq - bq; })
      .map(([label, v]) => ({ label, ...v }));
  }, [projectImageDates]);

  const projectQuarterLabel = useMemo(() => {
    const out: Record<string, string> = {};
    quarterData.forEach(({ label, projects }) => projects.forEach((p) => { out[p] = label; }));
    return out;
  }, [quarterData]);

  // ── Score data fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    if (loadedProjects.length === 0) return;
    const fetchAll = async () => {
      setIsLoadingScores(true);
      try {
        const results = await Promise.all(
          loadedProjects.map(async (name) => {
            try {
              const res = await fetch(`/api/projects/${encodeURIComponent(name)}/results`);
              const data = await res.json();
              if (!data.ok || !Array.isArray(data.result_rows)) return { name, rows: [] };
              return { name, rows: data.result_rows.map((row: Record<string, unknown>, i: number) => ({ ...row, _project: name, _segIndex: i + 1 })) };
            } catch { return { name, rows: [] as unknown[] }; }
          })
        );
        const allRows: TopRiskRow[] = [];
        results.forEach(({ rows }) => { allRows.push(...(rows as TopRiskRow[])); });

        const withSum = allRows.map((row) => {
          const sumScore = (row["VB"] || 0) + (row["BB"] || 0) + (row["SB"] || 0) + (row["BP"] || 0);
          const maxBand = row["Overall Risk Level Band"] ??
            Math.max(row["VB Band"] || 0, row["BB Band"] || 0, row["SB Band"] || 0, row["BP Band"] || 0);
          return { ...row, _sumScore: sumScore, _maxBand: maxBand };
        }).sort((a, b) => b._sumScore - a._sumScore);

        setAllScoreRows(withSum);
      } finally {
        setIsLoadingScores(false);
      }
    };
    fetchAll();
  }, [loadedProjects]);

  // ── Network data fetch (lazy — only when benchmarkStats section is visible) ──
  useEffect(() => {
    const hasBenchmarkVisible = elements.some((e) => e.type === "benchmarkStats" && e.visible);
    if (!hasBenchmarkVisible || networkScoreRows !== null || allProfileProjects.length === 0) return;
    setIsLoadingNetworkData(true);
    Promise.all(
      allProfileProjects.map(async (name) => {
        try {
          const data = await getCachedResults(name);
          return (data.result_rows ?? []).map((row: Record<string, unknown>, i: number) => ({
            ...row,
            _project: name,
            _segIndex: i + 1,
          })) as TopRiskRow[];
        } catch { return [] as TopRiskRow[]; }
      })
    ).then((perProject) => {
      const rows = perProject.flat().map((row) => ({
        ...row,
        _sumScore: ((row as TopRiskRow).VB || 0) + ((row as TopRiskRow).BB || 0) + ((row as TopRiskRow).SB || 0) + ((row as TopRiskRow).BP || 0),
        _maxBand: (row as TopRiskRow)["Overall Risk Level Band"] ??
          Math.max((row as TopRiskRow)["VB Band"] || 0, (row as TopRiskRow)["BB Band"] || 0, (row as TopRiskRow)["SB Band"] || 0, (row as TopRiskRow)["BP Band"] || 0),
      }));
      setNetworkScoreRows(rows as TopRiskRow[]);
    }).catch(() => setNetworkScoreRows([]))
      .finally(() => setIsLoadingNetworkData(false));
  }, [elements, allProfileProjects, networkScoreRows]);

  // ── Datasets: full vs. Path-Analysis-filtered subset ──────────────────────
  // A filter is active iff Path Analysis persisted a filtered-segment map AND
  // named active filters. The filtered rows are `allScoreRows` restricted to the
  // persisted per-project 0-based indices (`_segIndex` is 1-based, hence -1).
  const hasFilter = !!filteredIdxByProject && activeFilterNames.length > 0;

  const filteredScoreRows = useMemo(() => {
    if (!filteredIdxByProject) return [] as TopRiskRow[];
    const sets: Record<string, Set<number>> = {};
    Object.entries(filteredIdxByProject).forEach(([p, idxs]) => { sets[p] = new Set(idxs); });
    return allScoreRows.filter((r) => sets[r._project]?.has(r._segIndex - 1));
  }, [allScoreRows, filteredIdxByProject]);

  const fullDataset = useMemo<ReportDataset>(() => ({
    ...buildCoreDataset(allScoreRows, loadedProjects),
    projects: loadedProjects, // keep 0-result projects visible (legacy behaviour)
    treatmentSummaries,
  }), [allScoreRows, loadedProjects, treatmentSummaries]);

  const filteredDataset = useMemo<ReportDataset>(() => {
    const core = buildCoreDataset(filteredScoreRows, loadedProjects);
    // Treatments restricted to the filtered segments only.
    const byProject = new Map<string, { treated: number; counts: Record<number, number> }>();
    filteredScoreRows.forEach((r) => {
      if (!byProject.has(r._project)) byProject.set(r._project, { treated: 0, counts: {} });
      const ids = segmentTreatmentMap.get(`${r._project}_${r._segIndex}`);
      if (ids && ids.length) {
        const e = byProject.get(r._project)!;
        e.treated++;
        ids.forEach((id) => { e.counts[id] = (e.counts[id] || 0) + 1; });
      }
    });
    const treatmentSummaries: ProjectTreatmentSummary[] = core.projects
      .filter((p) => byProject.has(p))
      .map((p) => { const v = byProject.get(p)!; return { project: p, treatedSegments: v.treated, treatmentCounts: v.counts }; });
    return { ...core, treatmentSummaries };
  }, [filteredScoreRows, loadedProjects, segmentTreatmentMap]);

  // ── Network dataset (all profile projects) ────────────────────────────────
  const networkDataset = useMemo(() => {
    if (!networkScoreRows) return null;
    return buildCoreDataset(networkScoreRows, allProfileProjects);
  }, [networkScoreRows, allProfileProjects]);

  // Segments needing image/attribute enrichment = union of both datasets' top rows.
  const enrichTargets = useMemo(() => {
    const map = new Map<string, TopRiskRow>();
    [...fullDataset.topRiskRows, ...filteredDataset.topRiskRows].forEach((r) => map.set(`${r._project}_${r._segIndex}`, r));
    return [...map.values()];
  }, [fullDataset.topRiskRows, filteredDataset.topRiskRows]);

  // ── Enrichment fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    if (enrichTargets.length === 0) return;
    const go = async () => {
      try {
        const res = await fetch("/api/report/segment-details", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: enrichTargets.map((r) => ({ project: r._project, segIndex: r._segIndex })) }),
        });
        const data = await res.json();
        if (data.ok && Array.isArray(data.details)) {
          const map = new Map<string, EnrichedDetail>();
          data.details.forEach((d: { project: string; segIndex: number; imageUrl?: string; topAttributes?: { name: string; multiplier: number }[]; postImageUrl?: string; postScores?: any }) => {
            map.set(`${d.project}_${d.segIndex}`, { 
                imageUrl: d.imageUrl ?? undefined, 
                topAttributes: d.topAttributes || [],
                postImageUrl: d.postImageUrl ?? undefined,
                postScores: d.postScores ?? undefined,
            });
          });
          setEnrichedMap(map);
        }
      } catch (err) { console.error("Enrichment failed:", err); }
    };
    go();
  }, [enrichTargets]);

  // ── Treatment fetch ───────────────────────────────────────────────────────
  useEffect(() => {
    if (loadedProjects.length === 0) return;
    const go = async () => {
      const newSegTreatMap = new Map<string, number[]>();
      const summaries = await Promise.all(
        loadedProjects.map(async (name) => {
          try {
            const res = await fetch(`/api/projects/${encodeURIComponent(name)}/treatments/all`);
            const data = await res.json();
            if (!data.ok) return null;
            const segments = (data.segments || {}) as Record<string, { treatments_applied?: number[] }>;
            const treatmentCounts: Record<number, number> = {};
            Object.entries(segments).forEach(([idx, seg]) => {
              const ids = seg.treatments_applied || [];
              if (ids.length > 0) {
                newSegTreatMap.set(`${name}_${parseInt(idx) + 1}`, ids);
                ids.forEach((id) => { treatmentCounts[id] = (treatmentCounts[id] || 0) + 1; });
              }
            });
            return { project: name, treatedSegments: Object.keys(segments).length, treatmentCounts } as ProjectTreatmentSummary;
          } catch { return null; }
        })
      );
      setSegmentTreatmentMap(newSegTreatMap);
      setTreatmentSummaries(summaries.filter(Boolean) as ProjectTreatmentSummary[]);
    };
    go();
  }, [loadedProjects]);

  // ── Ideal height per element type (based on current data) ────────────────
  const computeIdealHeight = useCallback((el: ElementState): number => {
    const H = 30; // handle
    const ds = el.filtered ? filteredDataset : fullDataset;
    const { distributions, scoreStats, attributeFrequency, topRiskRows, treatmentSummaries, projects } = ds;
    switch (el.type) {
      case "title": {
        // The "Projects:" line wraps when many/long project names are listed;
        // each extra wrapped line pushes the date inputs down. Without accounting
        // for this the fixed-height body (overflow:hidden) clips the bottom rows.
        const projChars = loadedProjects.reduce((s, n) => s + (projectNameOverrides[n] ?? n).length + 2, 9 /* "Projects: " */);
        const projLines = Math.max(1, Math.ceil(projChars / 80)); // ~80 chars/line at fontSize 12 across 754px
        // Each image date entry (quarter) is ~26px tall; base height assumes 1 entry.
        const extraQuarterH = Math.max(0, quarterData.length - 1) * 26;
        return H + 160 + projLines * 17 + extraQuarterH;
      }
      case "riskBands": return H + (distributions ? 480 : 60);
      case "map": return H + 612 + (el.filtered && el.colorBy && activeFilterNames.includes(el.colorBy) ? 30 : 0);
      case "summary": {
        // The "Active Filters" panel grows one row per filter, and each row's
        // category chips wrap — a flat constant clips it once >1 filter is set.
        if (activeFilterNames.length === 0) return H + 110;
        let h = H + 110 + 38; // base stats + panel padding/label
        activeFilterNames.forEach((fn) => {
          const st = activeCategoryStatus.find((s) => s.attribute === fn);
          const chips = st?.rangeFilter ? 1 : Math.max(1, st?.categories.length ?? 1);
          h += Math.max(1, Math.ceil(chips / 5)) * 18 + 6; // wrapped chip lines + row gap
        });
        return h;
      }
      case "topRisk": {
        const n = el.topN ?? 10;
        const header = 60;   // title + subtitle
        const thead = 36;   // table header row
        if (el.viewMode === "full-page") {
          // Exactly one stretch per page. Total height = n * PAGE_H.
          // Since the section itself includes a header (about 60px), we reserve n full pages.
          return n * PAGE_H;
        }
        if (el.viewMode === "tabular") return H + header + thead + n * 52 + 24;
        return H + header + Math.ceil(n / 3) * 240 + 24; // grid
      }
      case "treatmentSummary": {
        if (treatmentSummaries.length === 0) return H + 100;
        let h = H + 36;
        treatmentSummaries.forEach((ts) => { h += 54 + Object.keys(ts.treatmentCounts).length * 38 + 18; });
        return h + 16;
      }
      case "projectDetails": {
        if (projects.length === 0) return H + 60;
        // All projects render, chunked PROJ_PAGE_SIZE per PAGE_H-tall page. Each
        // non-final chunk occupies a full page; the section's total height is
        // (chunks-1) full pages + the natural height of the final chunk.
        const numChunks = Math.ceil(projects.length / PROJ_PAGE_SIZE);
        const lastCount = projects.length - (numChunks - 1) * PROJ_PAGE_SIZE;
        const headerH = numChunks > 1 ? PROJ_CONT_HEADER_H : PROJ_HEADER_H;
        const lastChunkH = H + headerH + lastCount * PROJ_ROW_H + 16;
        return (numChunks - 1) * PAGE_H + lastChunkH;
      }
      case "benchmarkStats": {
        const hasNet = !!networkDataset?.distributions;
        const cardH = hasNet ? 122 : 82;  // crash-type scorecard row (with-net includes two extra rows)
        const ovH = hasNet ? 80 : 62;     // Overall Risk strip (padding "14px 18px" + ~30px content; with-net adds network col)
        const rowH = hasNet ? 60 : 38;    // table row (padding "8px 6px" + enlarged font; with-net adds net row)
        // H + top-pad+title(36) + subtitle(14) + cards + cards-mb + strip + strip-mb
        //   + per-band-label+table-header(43) + 4 rows + bottom-pad(20)
        return H + 36 + 14 + cardH + 10 + ovH + 12 + 43 + 4 * rowH + 20;
      }
      case "riskStats": return H + 36 + (scoreStats ? 5 * 54 + 24 : 50); // each row: label line + range bar + scale labels + spacing
      case "topAttributes": return H + 36 + (attributeFrequency.length > 0 ? attributeFrequency.length * 34 + 16 : 50);
      case "recommendations": {
        // Auto-suggestion panel grows one (often wrapping) line per top risk
        // factor; flat 120 clipped the panel + textarea when several appear.
        const sug = Math.min(5, attributeFrequency.length) + (topRiskRows.some((r) => r._maxBand === 4) ? 1 : 0);
        const boxH = sug > 0 ? 30 + sug * 24 : 0;
        return H + 36 + boxH + 78; // + editable notes textarea (min height) & gaps
      }
      case "methodology": return H + 36 + 290; // intro paragraph (~5 wrapped lines) + thresholds table (6 rows) + segment-length note
      case "segmentGallery": return H + 36 + Math.max(1, Math.ceil(topRiskRows.length / 6)) * 92 + 16;
      default: return el.height;
    }
  }, [fullDataset, filteredDataset, loadedProjects, projectMeta, activeFilterNames, activeCategoryStatus, projectNameOverrides, quarterData]);

  // ── Auto-fit: snapshot ideal heights into state ───────────────────────────
  // Gap removal and page-break spacing are now automatic (see `layout` memo +
  // computeFlowLayout), so this only persists each section's ideal height so
  // saved layouts carry accurate `height` values. Order/`y` are untouched.
  const autoFitElements = useCallback(() => {
    setElements((prev) =>
      prev.map((el) => (el.visible ? { ...el, height: computeIdealHeight(el) } : el)),
    );
  }, [computeIdealHeight]);

  // ── Auto-fit on first data load ───────────────────────────────────────────
  // Must come after autoFitElements is defined to avoid a TDZ crash.
  useEffect(() => {
    if (!fullDataset.distributions || hasAutoFit.current) return;
    hasAutoFit.current = true;
    setTimeout(autoFitElements, 150);
  }, [fullDataset.distributions, autoFitElements]);

  // ── Element helpers ───────────────────────────────────────────────────────
  const updateElement = useCallback((id: string, changes: Partial<ElementState>) => {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, ...changes } : el)));
  }, []);
  const hideElement = useCallback((id: string) => updateElement(id, { visible: false }), [updateElement]);
  const showElement = useCallback((id: string) => {
    setElements((prev) => {
      const target = prev.find((e) => e.id === id);
      if (!target) return prev;
      const h = computeIdealHeight(target);
      // Re-show and move to the end of the array so it stacks below all other
      // visible sections (array order drives display order).
      const updated = [
        ...prev.filter((e) => e.id !== id),
        { ...target, visible: true, height: h },
      ];
      // Scroll the canvas to the bottom once the new section has laid out.
      setTimeout(() => {
        const c = canvasContainerRef.current;
        if (c) c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
      }, 30);
      return updated;
    });
  }, [computeIdealHeight]);

  // ── Filtered sections: master toggle ──────────────────────────────────────
  // ON  → append the "(Filtered)" duplicate of every non-title section that
  //       isn't already present (after the existing sections).
  // OFF → remove every filtered section.
  const toggleIncludeFiltered = useCallback(() => {
    setElements((prev) => {
      if (prev.some((e) => e.filtered)) {
        return prev.filter((e) => !e.filtered);
      }
      const existing = new Set(prev.map((e) => e.id));
      const toAdd = FILTERED_ELEMENTS.filter((fe) => !existing.has(fe.id)).map((fe) => ({ ...fe }));
      return [...prev, ...toAdd];
    });
    setIncludeFiltered((v) => !v);
    setTimeout(autoFitElements, 50);
  }, [autoFitElements]);

  // ── Drag end: reorder the elements array (dnd-kit drives ordering) ─────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setElements((prev) => {
      const oldIndex = prev.findIndex((e) => e.id === active.id);
      const newIndex = prev.findIndex((e) => e.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);
  const getEnriched = (row: TopRiskRow): EnrichedDetail => {
    const fromMap = enrichedMap.get(`${row._project}_${row._segIndex}`);
    // Pull top contributors directly from the scoring result row (already computed during scoring)
    const topAttributes: { name: string; multiplier: number }[] = [];
    for (let i = 1; i <= 5; i++) {
      const name = row[`Top ${i} Contributor` as keyof TopRiskRow] as string | undefined;
      const contribution = row[`Top ${i} Contribution` as keyof TopRiskRow] as number | undefined;
      if (name && contribution != null && contribution > 0) {
        topAttributes.push({ name, multiplier: contribution });
      }
    }
    return {
      imageUrl: fromMap?.imageUrl,
      topAttributes: topAttributes.length > 0 ? topAttributes : (fromMap?.topAttributes ?? []),
      postImageUrl: fromMap?.postImageUrl,
      postScores: fromMap?.postScores,
    };
  };
  const getSegmentTreatments = (row: TopRiskRow): number[] =>
    segmentTreatmentMap.get(`${row._project}_${row._segIndex}`) ?? [];

  // ── Map colour map (key `project_segIndex` → hex) ─────────────────────────
  // Risk-band colouring by default. A filtered map section may instead colour by
  // one of the user's active filter attributes: each segment's persisted category
  // value (`filteredSegValues`) is mapped to its colour via `activeCategoryStatus`
  // — the same source as the report legend, so the map always matches it.
  const buildMapColorMap = useCallback((ds: ReportDataset, el: ElementState): Map<string, string> => {
    const m = new Map<string, string>();
    const colorBy = el.colorBy && activeFilterNames.includes(el.colorBy) ? el.colorBy : null;
    if (el.filtered && colorBy) {
      const cats = activeCategoryStatus.find((s) => s.attribute === colorBy)?.categories ?? [];
      const parentColor = new Map(cats.map((c) => [c.category, c.color]));
      // Mirror Path Analysis: when only one parent category remains active and it
      // has sub-categories, colour by the secondary (Level-3) value instead.
      const activeParents = cats.filter((c) => c.isActive);
      const collapseParent = activeParents.length === 1 && (activeParents[0].subcategories?.length ?? 0) > 0
        ? activeParents[0] : null;
      const childColor = new Map((collapseParent?.subcategories ?? []).map((sc) => [sc.name, sc.color]));
      ds.rows.forEach((row) => {
        const segVals = filteredSegValues?.[row._project]?.[row._segIndex - 1];
        const parentVal = segVals?.[colorBy];
        let color: string | undefined;
        if (collapseParent && parentVal === collapseParent.category) {
          const childVal = segVals?.[`${colorBy}__child`];
          color = (childVal && childColor.get(childVal)) || collapseParent.color;
        } else if (parentVal) {
          color = parentColor.get(parentVal);
        }
        m.set(`${row._project}_${row._segIndex}`, color ?? CATEGORY_UNKNOWN_COLOR);
      });
    } else {
      ds.allBandMap.forEach((band, key) => m.set(key, RISK_COLORS[band] ?? MAP_MISSING_SCORE_COLOR));
    }
    return m;
  }, [activeFilterNames, activeCategoryStatus, filteredSegValues]);

  // ── Post-treatment image upload ───────────────────────────────────────────
  const handleUploadTreatmentImageClick = (project: string, segIndex: number) => {
    setUploadingSegment({ project, segIndex });
    postTreatmentUploadRef.current?.click();
  };

  const handlePostTreatmentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingSegment) return;
    e.target.value = "";
    const { project, segIndex } = uploadingSegment;
    setUploadingSegment(null);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project)}/segments/${segIndex}/post-treatment-image`,
        { method: "POST", body: formData }
      );
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      // Refresh enriched map for this segment so the new image appears immediately
      const detailsRes = await fetch("/api/report/segment-details", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: [{ project, segIndex }] }),
      });
      const detailsData = await detailsRes.json();
      if (detailsData.ok && Array.isArray(detailsData.details)) {
        // The post-treatment image URL is a static path that does not change
        // between uploads, so the browser keeps showing the previously-rendered
        // bitmap. Append a cache-busting timestamp so the <img> src string
        // changes and forces a fresh request.
        const bust = Date.now();
        setEnrichedMap((prev) => {
          const next = new Map(prev);
          detailsData.details.forEach((d: { project: string; segIndex: number; imageUrl?: string; topAttributes?: { name: string; multiplier: number }[]; postImageUrl?: string; postScores?: any }) => {
            const postUrl = d.postImageUrl
              ? `${d.postImageUrl}${d.postImageUrl.includes("?") ? "&" : "?"}t=${bust}`
              : undefined;
            next.set(`${d.project}_${d.segIndex}`, {
              imageUrl: d.imageUrl ?? undefined,
              topAttributes: d.topAttributes || [],
              postImageUrl: postUrl,
              postScores: d.postScores ?? undefined,
            });
          });
          return next;
        });
      }
    } catch (err) {
      console.error("Post-treatment image upload failed:", err);
      alert("Upload failed. Please try again.");
    }
  };

  // ── Display-name helpers ──────────────────────────────────────────────────
  const dispName = useCallback(
    (name: string) => projectNameOverrides[name] ?? name,
    [projectNameOverrides]
  );
  const dispNameWithQuarter = useCallback(
    (name: string) => {
      const q = projectQuarterLabel[name];
      return q ? `${dispName(name)} (${q})` : dispName(name);
    },
    [dispName, projectQuarterLabel]
  );
  const setProjectName = useCallback(
    (orig: string, display: string) =>
      setProjectNameOverrides((prev) => ({ ...prev, [orig]: display })),
    []
  );
  const secTitle = useCallback(
    (id: string, defaultTitle: string) => sectionTitles[id] ?? defaultTitle,
    [sectionTitles]
  );
  const setSecTitle = useCallback(
    (id: string, title: string) =>
      setSectionTitles((prev) => ({ ...prev, [id]: title })),
    []
  );

  // ── Save / Restore layout ─────────────────────────────────────────────────
  const saveLayout = useCallback(() => {
    try {
      localStorage.setItem(LOCAL_KEYS.REPORT_LAYOUT, JSON.stringify({
        elements, reportTitle, oicName, purpose, recommendations,
        reportDate, projectNameOverrides, sectionTitles, includeFiltered,
      }));
      setHasSaved(true);
      setSaveToastVisible(true);
      if (saveToastTimerRef.current) clearTimeout(saveToastTimerRef.current);
      saveToastTimerRef.current = setTimeout(() => setSaveToastVisible(false), 4000);
    } catch (e) { console.error("Save layout failed:", e); }
  }, [elements, reportTitle, oicName, purpose, recommendations, reportDate, projectNameOverrides, sectionTitles, includeFiltered]);

  // Auto-save layout on every change so navigation away never loses section arrangement.
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEYS.REPORT_LAYOUT, JSON.stringify({
        elements, reportTitle, oicName, purpose, recommendations,
        reportDate, projectNameOverrides, sectionTitles, includeFiltered,
      }));
      setHasSaved(true);
    } catch (e) { /* quota exceeded or private browsing — silent */ }
  }, [elements, reportTitle, oicName, purpose, recommendations, reportDate, projectNameOverrides, sectionTitles, includeFiltered]);

  const restoreLayout = useCallback(() => {
    try {
      const saved = localStorage.getItem(LOCAL_KEYS.REPORT_LAYOUT);
      if (!saved) return;
      const l = JSON.parse(saved);
      if (l.elements) setElements(l.elements);
      if (l.reportTitle !== undefined) setReportTitle(l.reportTitle);
      if (l.oicName !== undefined) setOicName(l.oicName);
      if (l.purpose !== undefined) setPurpose(l.purpose);
      if (l.recommendations !== undefined) setRecommendations(l.recommendations);
      if (l.reportDate !== undefined) setReportDate(l.reportDate);
      if (l.projectNameOverrides !== undefined) setProjectNameOverrides(l.projectNameOverrides);
      if (l.sectionTitles !== undefined) setSectionTitles(l.sectionTitles);
      if (l.includeFiltered !== undefined) setIncludeFiltered(l.includeFiltered);
    } catch (e) { console.error("Restore layout failed:", e); }
  }, []);

  const resetLayout = useCallback(() => {
    if (window.confirm("Are you sure you want to reset the layout to default? All unsaved changes will be lost.")) {
      localStorage.removeItem(LOCAL_KEYS.REPORT_LAYOUT);
      setElements(DEFAULT_ELEMENTS);
      setReportTitle("Path Safety Analysis Executive Summary");
      setOicName("");
      setPurpose("");
      setRecommendations("");
      setReportDate(new Date().toISOString().split("T")[0]);
      setProjectNameOverrides({});
      setSectionTitles({});
      setIncludeFiltered(false);
      setHasSaved(false);
    }
  }, []);

  // ── Project picker confirm ────────────────────────────────────────────────
  const loadSelectedProjects = useCallback(() => {
    setLoadedProjects([...pickerSelected]);
    setShowProjectPicker(false);
  }, [pickerSelected]);

  // ── Page navigation ───────────────────────────────────────────────────────
  const goToPage = useCallback((page: number) => {
    setCurrentPage(page);
    if (!canvasContainerRef.current || !canvasRef.current) return;
    const canvasTop = canvasRef.current.offsetTop;
    canvasContainerRef.current.scrollTo({ top: canvasTop + page * PAGE_H, behavior: "smooth" });
  }, []);

  // Scroll the canvas so the start of the given section is brought into view.
  const scrollToSection = useCallback((id: string) => {
    const container = canvasContainerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const el = canvas.querySelector(`[data-element-id="${id}"]`) as HTMLElement | null;
    if (!el) return;
    const elRect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const top = container.scrollTop + (elRect.top - containerRect.top) - 16;
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, []);

  const handleCanvasScroll = useCallback(() => {
    if (!canvasContainerRef.current || !canvasRef.current) return;
    const scrolled = canvasContainerRef.current.scrollTop;
    const canvasTop = canvasRef.current.offsetTop;
    const scrollInCanvas = Math.max(0, scrolled - canvasTop);
    setCurrentPage(Math.floor(scrollInCanvas / PAGE_H));
  }, []);

  // ── PDF / Word export (see hooks/usePdfExport.ts) ─────────────────────────
  const { exporting, handleDownloadPDF, handleDownloadWord } = usePdfExport({
    canvasRef, elements, fullDataset, getSegmentTreatments, loadedProjects,
    reportTitle, oicName, purpose, reportDate, quarterData, recommendations,
    projectMeta, activeFilterNames, activeCategoryStatus, projectNameOverrides,
    sectionTitles,
  });

  // ── Shared renderers ──────────────────────────────────────────────────────
  const renderDonutLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    if (percent < 0.03) return null;
    return (
      <text x={x} y={y} fill="#111" textAnchor="middle" dominantBaseline="central" style={{ fontSize: "10px", fontWeight: 700 }}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const renderBandDonut = (dist: BandDist, total: number) => {
    if (total === 0) return <div style={{ color: "#888", fontSize: 11, textAlign: "center", padding: "20px 0" }}>No data</div>;

    const chartData = [1, 2, 3, 4].map((band) => ({
      name: RISK_LABELS[band],
      value: dist[band] || 0,
      color: RISK_COLORS[band],
      band
    })).filter(d => d.value > 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
        <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>Total: {total} segments</div>
        <div style={{ width: 140, height: 140 }}>
          <PieChart width={140} height={140}>
            <Pie
              data={chartData}
              cx={70}
              cy={70}
              labelLine={false}
              label={renderDonutLabel}
              innerRadius={30}
              outerRadius={65}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <RechartTooltip contentStyle={{ fontSize: 10, padding: "4px 8px", borderRadius: 4 }} itemStyle={{ fontSize: 10, color: "#222" }} />
          </PieChart>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 12px", marginTop: 8 }}>
          {chartData.map((item) => (
            <div key={item.band} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color }} />
              <div style={{ color: "#222", fontWeight: 700 }}>{item.name}: {item.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };


  const renderBandBadge = (band: number, short = false) => (
    <span style={{ display: "inline-block", padding: short ? "1px 4px" : "1px 6px", borderRadius: 3, fontSize: short ? 9 : 10, fontWeight: 600, background: RISK_COLORS[band] || "#eee", color: band === 2 ? "#333" : "#fff" }}>
      {short ? (RISK_LABELS[band]?.slice(0, 3).toUpperCase() ?? "—") : (RISK_LABELS[band] ?? "—")}
    </span>
  );

  const renderViewToggle = (el: ElementState) => {
    const topN = el.topN ?? 10;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px 8px", borderTop: "1px dashed #e0d8f0", background: "transparent" }} onPointerDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#aaa", marginRight: 2, width: 30 }}>Top:</span>
          {[3, 5, 10].map((n) => {
            const active = topN === n;
            return (
              <button key={n}
                style={{ padding: "2px 5px", borderRadius: 10, border: `1px solid ${active ? "#a020d0" : "#ddd"}`, background: active ? "#f0e4f8" : "#fff", color: active ? "#a020d0" : "#777", cursor: "pointer", fontSize: 10, fontWeight: active ? 700 : 400, minWidth: 20 }}
                onClick={(e) => { e.stopPropagation(); updateElement(el.id, { topN: n }); setTimeout(autoFitElements, 50); }}
                onMouseDown={(e) => e.stopPropagation()}>{n}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Map (Filtered) colour-by selector (sidebar) ──────────────────────────
  const renderMapColorToggle = (el: ElementState) => {
    const current = el.colorBy && activeFilterNames.includes(el.colorBy) ? el.colorBy : "__risk__";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderTop: "1px dashed #e0d8f0" }} onPointerDown={(e) => e.stopPropagation()}>
        <span style={{ fontSize: 10, color: "#aaa", flexShrink: 0 }}>Color by:</span>
        <select
          value={current}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value;
            updateElement(el.id, { colorBy: v === "__risk__" ? undefined : v });
          }}
          style={{ flex: 1, fontSize: 10, padding: "2px 4px", borderRadius: 4, border: "1px solid #ddd", color: "#555", background: "#fff", cursor: "pointer", minWidth: 0 }}
        >
          <option value="__risk__">Overall Risk Level (default)</option>
          {activeFilterNames.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
    );
  };

  // ── Top Risk renderers ────────────────────────────────────────────────────
  const renderTopRiskFullPage = (rows: TopRiskRow[], elId: string) => (
    <div style={{ flex: 1, overflow: "visible", display: "flex", flexDirection: "column" }}>
      {rows.map((row, i) => {
        const e = getEnriched(row);
        const t = getSegmentTreatments(row);
        const isFirst = i === 0;
        const isLast = i === rows.length - 1;

        // Each page must exactly equal PAGE_H (except possibly the last one)
        // so that the chunks break precisely on the PDF boundaries.
        const height = isLast ? "auto" : PAGE_H;

        return (
          <div key={i} style={{ height, boxSizing: "border-box", paddingBottom: isLast ? 0 : PAGE_GAP, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {isFirst ? (
              <div style={{ padding: "8px 12px 12px", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                    <EditableText value={secTitle(elId, "Top Risk Stretches")} onChange={(val) => setSecTitle(elId, val)} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }} />
                    <div style={{ color: "#ddd", fontSize: 20 }}>|</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e" }}>
                      {dispNameWithQuarter(row._project)} <span style={{ color: "#666", fontWeight: 400, fontSize: 18 }}>Segment {row._segIndex}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: "#999" }}>Ranked highest to lowest · Before risk factors & after treatments applied</div>
                </div>
              </div>
            ) : (
              <div style={{ padding: "10px 14px 12px", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }}>
                  {secTitle(elId, "Top Risk Stretches")} <span style={{ color: "#aaa", fontWeight: 500 }}>(#{i + 1})</span>
                </div>
                <div style={{ color: "#ddd", fontSize: 20 }}>|</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e" }}>
                  {dispNameWithQuarter(row._project)} <span style={{ color: "#666", fontWeight: 400, fontSize: 18 }}>Segment {row._segIndex}</span>
                </div>
              </div>
            )}

            <div style={{ flex: 1, background: "#fff", border: `2px solid ${RISK_COLORS[row._maxBand] || "#ddd"}`, borderRadius: 8, margin: "0 14px", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
              {/* Top Row: Original */}
              <div style={{ flex: "1 1 50%", borderBottom: "1px solid #ddd", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {/* Image Section */}
                <div style={{ flex: 1, position: "relative", flexShrink: 1, minHeight: 0 }}>
                  <div style={{ position: "absolute", top: 16, right: 16, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 12px", borderRadius: 16, fontSize: 12, zIndex: 10 }}>Original</div>
                  <SegmentImage src={e.imageUrl} width="100%" height="100%" />
                  {/* Ranking Badge */}
                  <div style={{ position: "absolute", top: 16, left: 16, background: RISK_COLORS[row._maxBand] || "#333", color: "#fff", width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: "bold", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", zIndex: 10 }}>
                    {i + 1}
                  </div>
                </div>

                {/* Content Section */}
                <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12, overflow: "hidden", flexShrink: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
                    {/* Main Factors */}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#a020d0", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 }}>Top Contributing Attribute</div>
                      {e.topAttributes.length > 0 ? (
                        <div style={{ fontSize: 16, color: "#333", fontWeight: 500, display: "flex", alignItems: "center" }}>
                          <span style={{ marginRight: 8, color: "#cc2200" }}>⚠️</span>
                          {e.topAttributes[0].name}
                          <span style={{ marginLeft: 12, fontSize: 12, color: "#cc2200", fontWeight: 700, background: "#fdeded", padding: "2px 8px", borderRadius: 12 }}>+{e.topAttributes[0].multiplier.toFixed(1)}</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 14, color: "#bbb", fontStyle: "italic" }}>No contributing factors identified</div>
                      )}

                      {e.topAttributes.length > 1 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Other significant factors:</div>
                          <ul style={{ margin: 0, paddingLeft: 18, color: "#555", fontSize: 12, lineHeight: 1.4 }}>
                            {e.topAttributes.slice(1).map((a, j) => (
                              <li key={j}>{a.name} <span style={{ color: "#cc2200", fontWeight: 600 }}>(+{a.multiplier.toFixed(1)})</span></li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    {/* Header: Score */}
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 32, fontWeight: 800, color: RISK_COLORS[row._maxBand] || "#222", lineHeight: 1 }}>{row._sumScore.toFixed(1)}</div>
                      </div>
                      <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>Original Risk Score</div>
                    </div>
                  </div>

                  <div style={{ flex: 1, minHeight: 8 }} /> {/* Spacer */}

                  {/* Crash Type Scores */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, background: "#faf8fd", padding: "8px 12px", borderRadius: 8, border: "1px solid #ede8f5", flexShrink: 0 }}>
                    {(["VB", "BB", "SB", "BP"] as const).map((ct) => {
                      const band = row[`${ct} Band` as keyof TopRiskRow] as number;
                      const score = row[ct as keyof TopRiskRow] as number;
                      return (
                        <div key={ct} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#555", whiteSpace: "nowrap" }}>{CRASH_TYPE_LABELS[ct] || ct}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", justifyContent: "center" }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: RISK_COLORS[band] || "#333", minWidth: 32, textAlign: "right" }}>{score.toFixed(1)}</div>
                            <div style={{ padding: "2px 6px", borderRadius: 8, background: RISK_COLORS[band] || "#eee", color: band === 2 ? "#333" : "#fff", fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", minWidth: 50, textAlign: "center", whiteSpace: "nowrap" }}>
                              {RISK_LABELS[band] || "None"}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Bottom Row: Post Treatment */}
              <div style={{ flex: "1 1 50%", display: "flex", flexDirection: "column", background: "#fcfcfc", overflow: "hidden" }}>
                {/* Image Section */}
                <div style={{ flex: 1, position: "relative", flexShrink: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f9f9f9" }}>
                  {e.postImageUrl ? (
                    <>
                      <div style={{ position: "absolute", top: 16, right: 16, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 12px", borderRadius: 16, fontSize: 12, zIndex: 10 }}>Post Treatment</div>
                      <SegmentImage src={e.postImageUrl} width="100%" height="100%" />
                      <button 
                        data-html2canvas-ignore="true"
                        onClick={() => handleUploadTreatmentImageClick(row._project, row._segIndex)} 
                        style={{ position: "absolute", bottom: 16, right: 16, background: "rgba(160, 32, 208, 0.9)", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer", zIndex: 10, boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }}
                      >
                        Change Image
                      </button>
                    </>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#888", gap: 12 }}>
                      <div style={{ fontSize: 14 }}>Post treatment photo missing</div>
                      <button data-html2canvas-ignore="true" onClick={() => handleUploadTreatmentImageClick(row._project, row._segIndex)} style={{ padding: "8px 16px", background: "#a020d0", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>
                        Upload Treatment Image
                      </button>
                    </div>
                  )}
                </div>

                {/* Content Section */}
                <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12, overflow: "hidden", flexShrink: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
                    {/* Applied Treatments */}
                    <div style={{ flex: 1, background: "#f5fbf6", padding: "10px 14px", borderRadius: 8, border: "1px solid #c8e8d0" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#27ae60", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>Applied Treatments</div>
                      {t.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: 16, color: "#226633", fontSize: 11, lineHeight: 1.4 }}>
                          {t.map(id => <li key={id}>{TREATMENT_NAMES[id] ?? `Treatment ${id}`}</li>)}
                        </ul>
                      ) : (
                        <div style={{ fontSize: 11, color: "#88ca99", fontStyle: "italic" }}>No treatments applied</div>
                      )}
                    </div>
                    {/* Header: Score */}
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {t.length > 0 && e.postScores ? (
                          <div style={{ fontSize: 32, fontWeight: 800, color: RISK_COLORS[e.postScores.Overall_Band] || "#222", lineHeight: 1 }}>{e.postScores.Overall.toFixed(1)}</div>
                        ) : (
                          <div style={{ fontSize: 32, fontWeight: 800, color: "#ccc", lineHeight: 1 }}>—</div>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>Post Treatment Score</div>
                    </div>
                  </div>

                  <div style={{ flex: 1, minHeight: 8 }} /> {/* Spacer */}

                  {/* Crash Type Scores */}
                  {t.length > 0 && e.postScores ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, background: "#faf8fd", padding: "8px 12px", borderRadius: 8, border: "1px solid #ede8f5", flexShrink: 0 }}>
                      {(["VB", "BB", "SB", "BP"] as const).map((ct) => {
                        const band = e.postScores![`${ct}_Band` as keyof typeof e.postScores] as number;
                        const score = e.postScores![ct as keyof typeof e.postScores] as number;
                        return (
                          <div key={ct} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#555", whiteSpace: "nowrap" }}>{CRASH_TYPE_LABELS[ct] || ct}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", justifyContent: "center" }}>
                              <div style={{ fontSize: 18, fontWeight: 700, color: RISK_COLORS[band] || "#333", minWidth: 32, textAlign: "right" }}>{score.toFixed(1)}</div>
                              <div style={{ padding: "2px 6px", borderRadius: 8, background: RISK_COLORS[band] || "#eee", color: band === 2 ? "#333" : "#fff", fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", minWidth: 50, textAlign: "center", whiteSpace: "nowrap" }}>
                                {RISK_LABELS[band] || "None"}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#fcfcfc", padding: 16, borderRadius: 8, border: "1px dashed #e0e0e0", flexShrink: 0, height: 104 }}>
                      <div style={{ fontSize: 14, color: "#aaa" }}>No post-treatment scores available</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderTopRiskGrid = (rows: TopRiskRow[]) => (
    <div style={{ flex: 1, overflow: "visible", padding: "8px 10px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, alignContent: "start" }}>
      {rows.map((row, i) => {
        const e = getEnriched(row); const t = getSegmentTreatments(row);
        return (
          <div key={i} style={{ border: `2px solid ${RISK_COLORS[row._maxBand] || "#ddd"}`, borderRadius: 6, background: "#fff", overflow: "hidden" }}>
            <SegmentImage src={e.imageUrl} width={999} height={85} />
            <div style={{ padding: "7px 9px" }}>
              <div style={{ fontSize: 9, color: "#bbb" }}>Rank #{i + 1}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dispNameWithQuarter(row._project)}</div>
              <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>Segment {row._segIndex}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: "#222" }}>{row._sumScore.toFixed(1)}</span>
                {renderBandBadge(row._maxBand)}
              </div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#888", letterSpacing: 0.3, marginBottom: 2 }}>CONTRIBUTING FACTORS</div>
              <div style={{ marginBottom: 5 }}>
                {e.topAttributes.length > 0 ? e.topAttributes.map((a, j) => <AttrTag key={j} {...a} />) : <span style={{ fontSize: 9, color: "#bbb" }}>—</span>}
              </div>
              <TreatmentBadge ids={t} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 4px", marginTop: 5 }}>
                {(["VB", "BB", "SB", "BP"] as const).map((ct) => (
                  <div key={ct} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <span style={{ fontSize: 8, color: "#888", width: 16 }}>{ct}</span>
                    {renderBandBadge(row[`${ct} Band` as keyof TopRiskRow] as number, true)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderTopRiskTabular = (rows: TopRiskRow[]) => (
    <div style={{ flex: 1, overflow: "visible" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <thead>
          <tr style={{ background: "#f5f0fa", position: "sticky", top: 0, zIndex: 1 }}>
            <th style={{ ...thStyle, width: 24 }}>#</th>
            <th style={{ ...thStyle, width: 60 }}>Image</th>
            <th style={{ ...thStyle, width: 110 }}>Project</th>
            <th style={{ ...thStyle, width: 32 }}>Seg</th>
            <th style={{ ...thStyle, width: 44 }}>Score</th>
            <th style={thStyle}>Top 5 Risk Factors (Before)</th>
            <th style={thStyle}>Applied Treatments (After)</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>VB</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>BB</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>SB</th>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>BP</th>
            <th style={{ ...thStyle, width: 44, textAlign: "center" }}>Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const e = getEnriched(row); const t = getSegmentTreatments(row);
            return (
              <tr key={i} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: "#888" }}>{i + 1}</td>
                <td style={{ padding: "4px 6px" }}><SegmentImage src={e.imageUrl} width={55} height={38} /></td>
                <td style={{ ...tdStyle, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dispNameWithQuarter(row._project)}</td>
                <td style={tdStyle}>{row._segIndex}</td>
                <td style={{ ...tdStyle, fontWeight: 700, fontSize: 12 }}>{row._sumScore.toFixed(1)}</td>
                <td style={{ ...tdStyle, maxWidth: 160 }}>
                  {e.topAttributes.length > 0 ? e.topAttributes.map((a, j) => <AttrTag key={j} {...a} />) : <span style={{ color: "#bbb" }}>—</span>}
                </td>
                <td style={{ ...tdStyle, maxWidth: 160 }}>
                  {t.length > 0
                    ? t.map((id) => <span key={id} style={{ fontSize: 9, color: "#226633", display: "block", lineHeight: 1.5 }}>✓ {id}. {TREATMENT_NAMES[id] ?? `Treatment ${id}`}</span>)
                    : <span style={{ color: "#ccc", fontSize: 9 }}>None</span>}
                </td>
                {(["VB", "BB", "SB", "BP"] as const).map((ct) => (
                  <td key={ct} style={{ ...tdStyle, textAlign: "center", padding: "3px 2px" }}>
                    {renderBandBadge(row[`${ct} Band` as keyof TopRiskRow] as number, true)}
                  </td>
                ))}
                <td style={{ ...tdStyle, textAlign: "center", padding: "3px 2px" }}>{renderBandBadge(row._maxBand, true)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // ── Treatment Summary renderer ────────────────────────────────────────────
  const renderTreatmentSummary = (summaries: ProjectTreatmentSummary[], projectSegmentCounts: Record<string, number>) => {
    return (
      <div style={{ padding: "6px 12px" }}>
        {summaries.map((summary) => {
          const total = projectSegmentCounts[summary.project] ?? 0;
          const sorted = Object.entries(summary.treatmentCounts).sort(([, a], [, b]) => b - a);
          return (
            <div key={summary.project} style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #ede8f5" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e", flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                  <EditableText value={dispName(summary.project)} onChange={(v) => setProjectName(summary.project, v)} style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }} />
                  {projectQuarterLabel[summary.project] && (
                    <span style={{ fontSize: 11, color: "#a020d0", fontWeight: 600 }}>({projectQuarterLabel[summary.project]})</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#a020d0", fontWeight: 600, background: "#f0e4f8", padding: "2px 8px", borderRadius: 10 }}>
                  {summary.treatedSegments} / {total || "?"} segments treated
                </div>
              </div>
              {sorted.length === 0 ? <div style={{ fontSize: 11, color: "#aaa" }}>No treatments applied yet.</div> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {sorted.map(([idStr, count]) => {
                    const id = parseInt(idStr);
                    const name = TREATMENT_NAMES[id] ?? `Treatment ${id}`;
                    const pct = total > 0 ? ((count / total) * 100).toFixed(0) : null;
                    return (
                      <div key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 11, background: "#a020d0", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{id}</span>
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <div style={{ fontSize: 11, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>{name}</div>
                          {total > 0 && <div style={{ height: 5, background: "#f0f0f0", borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${pct}%`, background: "#a020d0", height: "100%", opacity: 0.7 }} /></div>}
                        </div>
                        <span style={{ fontSize: 11, color: "#a020d0", fontWeight: 600, flexShrink: 0, width: 60, textAlign: "right" }}>
                          {count} seg{count !== 1 ? "s" : ""}{pct ? ` (${pct}%)` : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Section header helper ─────────────────────────────────────────────────
  const SectionHeader = ({ title, subtitle, onTitleChange }: { title: string; subtitle?: string; onTitleChange?: (t: string) => void }) => (
    <div style={{ padding: "8px 14px 6px", flexShrink: 0, borderBottom: "1px solid #ede8f5" }}>
      {onTitleChange
        ? <EditableText value={title} onChange={onTitleChange} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }} />
        : <div style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }}>{title}</div>
      }
      {subtitle && <div style={{ fontSize: 10, color: "#999" }}>{subtitle}</div>}
    </div>
  );

  // ── Element content ───────────────────────────────────────────────────────
  const renderContent = (el: ElementState, orderIndex = 0) => {
    // "(Filtered)" duplicates read from the filtered subset; all others from the
    // full dataset. Editable text / images / project metadata stay shared.
    const ds = el.filtered ? filteredDataset : fullDataset;
    const {
      distributions, totalSegments, totalKm, projectSegmentCounts,
      projects, topRiskRows, scoreStats, attributeFrequency, treatmentSummaries,
    } = ds;
    switch (el.type) {

      // ── Title ──────────────────────────────────────────────────────────────
      case "title":
        return (
          <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
            <EditableText value={reportTitle} onChange={setReportTitle} style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e" }} placeholder="Report Title" />
            <div style={{ fontSize: 12, color: "#555" }}>
              <strong>Projects:</strong>{" "}
              {loadedProjects.length > 0
                ? loadedProjects.map((name, i) => (
                  <span key={name}>
                    {i > 0 && ", "}
                    <EditableText
                      value={dispName(name)}
                      onChange={(v) => setProjectName(name, v)}
                      style={{ fontSize: 12, color: "#555" }}
                      placeholder={name}
                    />
                    {projectQuarterLabel[name] && (
                      <span style={{ fontSize: 11, color: "#a020d0", fontWeight: 600, marginLeft: 3 }}>({projectQuarterLabel[name]})</span>
                    )}
                  </span>
                ))
                : "—"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 14px" }}>
              {[
                { label: "OIC In-charge", value: oicName, setter: setOicName, placeholder: "Enter name…", type: "text" },
                { label: "Purpose", value: purpose, setter: setPurpose, placeholder: "Enter purpose of report…", type: "text" },
              ].map(({ label, value, setter, placeholder, type }) => (
                <div key={label}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#a020d0", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
                  <input type={type} value={value} onChange={(e) => setter(e.target.value)} placeholder={placeholder}
                    onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                    style={{ width: "100%", padding: "4px 8px", borderRadius: 4, border: "1px solid #ddd", fontSize: 12, color: "#222", background: "#fafafa", boxSizing: "border-box" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 14px" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#a020d0", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>Report Date</div>
                <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)}
                  onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
                  style={{ width: "100%", padding: "4px 8px", borderRadius: 4, border: "1px solid #ddd", fontSize: 11, color: "#222", background: "#fafafa", boxSizing: "border-box" }} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#a020d0", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Image Date
                </div>
                {imageDatesLoading
                  ? <span style={{ fontSize: 11, color: "#aaa" }}>Loading...</span>
                  : quarterData.length === 0
                  ? <span style={{ fontSize: 11, color: "#aaa" }}>No survey dates available</span>
                  : quarterData.map(({ label, earliest, latest }) => {
                    const fmt = (iso: string) => { try { const d = new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; } catch { return iso; } };
                    return (
                      <div key={label} style={{ fontSize: 11, color: "#222", marginBottom: 2, background: "#f5fbf6", borderRadius: 4, padding: "3px 8px", border: "1px solid #c8e8d0" }}>
                        <strong>{label}:</strong> {fmt(earliest)}{earliest !== latest ? ` – ${fmt(latest)}` : ""}
                      </div>
                    );
                  })
                }
              </div>
            </div>
          </div>
        );

      // ── Risk Bands ─────────────────────────────────────────────────────────
      case "riskBands":
        return (
          <div style={{ padding: "10px 14px" }}>
            <EditableText value={secTitle(el.id, "Risk Band Distribution")} onChange={(t) => setSecTitle(el.id, t)} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e", display: "block", marginBottom: 10 }} />
            {!distributions ? <div style={{ color: "#888", fontSize: 12 }}>Loading…</div> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px 20px" }}>
                {(["Overall", "VB", "BB", "SB", "BP"] as const).map((type) => {
                  const dist = distributions[type];
                  const total = Object.values(dist).reduce((s, v) => s + v, 0);
                  return (
                    <div key={type}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#222", textAlign: "center", marginBottom: 2 }}>{CRASH_TYPE_LABELS[type]}</div>
                      {renderBandDonut(dist, total)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );

      // ── Map ────────────────────────────────────────────────────────────────
      case "map": {
        const colorByAttr = el.filtered && el.colorBy && activeFilterNames.includes(el.colorBy) ? el.colorBy : null;
        // Legend mirrors the colouring: show secondary (sub-category) chips when
        // the parent has collapsed to a single active category with sub-categories.
        const colorByCats = colorByAttr
          ? (activeCategoryStatus.find((s) => s.attribute === colorByAttr)?.categories.filter((c) => c.isActive) ?? [])
          : [];
        const collapseParent = colorByCats.length === 1 && (colorByCats[0].subcategories?.length ?? 0) > 0
          ? colorByCats[0] : null;
        const legendCats: { category: string; color: string }[] = collapseParent
          ? (collapseParent.subcategories ?? []).filter((sc) => sc.isActive).map((sc) => ({ category: sc.name, color: sc.color }))
          : colorByCats.map((c) => ({ category: c.category, color: c.color }));
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "5px 10px 6px", flexShrink: 0, borderBottom: "1px solid #ede8f5" }}>
              <EditableText
                value={secTitle(el.id, "Map Overview")}
                onChange={(t) => setSecTitle(el.id, t)}
                style={{ fontSize: 14, fontWeight: 600, color: "#1a1a2e" }}
              />
              {projects.length > 0 && (
                <div style={{ fontSize: 10, color: "#666", marginTop: 2, display: "flex", flexWrap: "wrap", gap: "3px 12px" }}>
                  <span><strong style={{ color: "#a020d0" }}>Projects:</strong>{" "}{loadedProjects.map(dispName).join(", ")}</span>
                  <span><strong style={{ color: "#a020d0" }}>Colored by:</strong>{" "}{colorByAttr ?? "Risk Band"}</span>
                  {el.filtered && activeFilterNames.length > 0 && (
                    <span><strong style={{ color: "#a020d0" }}>Filters:</strong>{" "}{activeFilterNames.join(", ")}</span>
                  )}
                </div>
              )}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 4, margin: 2 }}>
            {projects.length === 0
              ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, background: "#f7f7f7", border: "2px dashed #ccc", borderRadius: 4 }}><span style={{ fontSize: 12, color: "#aaa" }}>{el.filtered ? "No segments match the filter" : "No projects loaded"}</span></div>
              : <div style={{ flex: 1, overflow: "hidden" }}><ReportMiniMap projects={projects} colorMap={buildMapColorMap(ds, el)} orderIndex={orderIndex} /></div>}
            {projects.length > 0 && colorByAttr && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", padding: "5px 10px", background: "#faf8fd", borderTop: "1px solid #ede8f5", flexShrink: 0, alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#a020d0", marginRight: 2 }}>{colorByAttr}:</span>
                {legendCats.length > 0 ? legendCats.map((c) => (
                  <span key={c.category} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "#444" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: c.color, display: "inline-block" }} />
                    {c.category}
                  </span>
                )) : <span style={{ fontSize: 10, color: "#999" }}>colored by attribute</span>}
              </div>
            )}
            {projects.length > 0 && !colorByAttr && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", padding: "5px 10px", background: "#faf8fd", borderTop: "1px solid #ede8f5", flexShrink: 0, alignItems: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#555", marginRight: 2 }}>Risk Band:</span>
                {([1, 2, 3, 4] as const).map((band) => (
                  <span key={band} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "#444" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: RISK_COLORS[band], display: "inline-block" }} />
                    {RISK_LABELS[band]}
                  </span>
                ))}
              </div>
            )}
            {projects.length > 0 && (
              <div style={{ display: "flex", gap: 18, padding: "4px 10px", background: "#faf8fd", borderTop: "1px solid #ede8f5", flexShrink: 0, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#555" }}>
                  <strong style={{ color: "#a020d0" }}>{totalSegments}</strong> segments
                </span>
                {totalKm > 0 && (
                  <span style={{ fontSize: 11, color: "#555" }}>
                    <strong style={{ color: "#a020d0" }}>{totalKm.toFixed(1)} km</strong> total length
                  </span>
                )}
                <span style={{ fontSize: 11, color: "#555" }}>
                  {projects.length} project{projects.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
            </div>
          </div>
        );
      }

      // ── Summary ────────────────────────────────────────────────────────────
      case "summary":
        return (
          <div style={{ padding: "12px 18px" }}>
            <EditableText value={secTitle(el.id, "Summary")} onChange={(t) => setSecTitle(el.id, t)} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e", display: "block", marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 32, marginBottom: el.filtered && activeFilterNames.length > 0 ? 10 : 0 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#a020d0" }}>{projects.length}</div>
                <div style={{ fontSize: 11, color: "#666" }}>Projects</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#a020d0" }}>{totalSegments}</div>
                <div style={{ fontSize: 11, color: "#666" }}>Total Segments</div>
              </div>
              {totalKm > 0 && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#a020d0" }}>{totalKm.toFixed(1)}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>km Total Length</div>
                </div>
              )}
            </div>
            {el.filtered && activeFilterNames.length > 0 && (
              <div style={{ padding: "8px 10px", background: "#f5f0fa", borderRadius: 6, border: "1px solid #e8d8f8" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#a020d0", textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 6 }}>Active Filters:</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {activeFilterNames.map((filterName) => {
                    const status = activeCategoryStatus.find((s) => s.attribute === filterName);
                    const hasRange = !!status?.rangeFilter;
                    const inactiveCount = status?.categories.filter((c) => !c.isActive).length ?? 0;
                    return (
                      <div key={filterName} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "#5a2a8a", minWidth: 130, flexShrink: 0, paddingTop: 2 }}>{filterName}</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 5px", flex: 1 }}>
                          {hasRange && status?.rangeFilter ? (
                            <span style={{ fontSize: 10, color: "#555", background: "#ede8f8", borderRadius: 8, padding: "1px 7px" }}>
                              {status.rangeFilter.currentMin} – {status.rangeFilter.currentMax}
                              {(status.rangeFilter.currentMin !== status.rangeFilter.min || status.rangeFilter.currentMax !== status.rangeFilter.max) && (
                                <span style={{ color: "#a020d0", marginLeft: 4 }}>✱ filtered</span>
                              )}
                            </span>
                          ) : status?.categories ? (
                            status.categories.map((cat) => (
                              // inline-block + vertical-align middle + lineHeight:1 (not
                              // inline-flex) so html2canvas centres the dot & label in the
                              // PDF — it ignores flex align-items and drops text to the
                              // bottom of the line box. Browser-identical to the old flex pill.
                              <span key={cat.category} style={{ display: "inline-block", whiteSpace: "nowrap", lineHeight: 1, fontSize: 9, padding: "2px 6px", borderRadius: 8, background: cat.isActive ? cat.color + "22" : "#f0f0f0", border: `1px solid ${cat.isActive ? cat.color : "#ddd"}`, color: cat.isActive ? "#333" : "#bbb" }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: cat.isActive ? cat.color : "#ccc", display: "inline-block", verticalAlign: "middle", marginRight: 3 }} />
                                <span style={{ verticalAlign: "middle" }}>{cat.category}</span>
                              </span>
                            ))
                          ) : (
                            <span style={{ fontSize: 10, color: "#888", fontStyle: "italic" }}>all categories shown</span>
                          )}
                          {inactiveCount > 0 && (
                            <span style={{ fontSize: 9, color: "#e08800", background: "#fff8e0", borderRadius: 8, padding: "1px 6px", border: "1px solid #f0d080" }}>
                              {inactiveCount} hidden
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );

      // ── Benchmarking Statistics ────────────────────────────────────────────
      case "benchmarkStats": {
        const crashTypeCards = [
          { key: "VB" as const, label: "Vehicle–Bicycle" },
          { key: "BB" as const, label: "Bicycle–Bicycle" },
          { key: "SB" as const, label: "Single-Bicycle" },
          { key: "BP" as const, label: "Bicycle–Pedestrian" },
        ];

        const netDist = networkDataset?.distributions;
        const netTotal = networkDataset?.totalSegments ?? 0;

        const allLoaded =
          allProfileProjects.length > 0 &&
          loadedProjects.length === allProfileProjects.length &&
          allProfileProjects.every((p) => loadedProjects.includes(p));
        const showNet = !!netDist && !allLoaded;

        // Safe % = (Low + Medium) / total
        const safePctOf = (dist: BandDist, tot: number) =>
          tot > 0 ? (((dist[1] || 0) + (dist[2] || 0)) / tot) * 100 : 0;

        // Color avg score by weighted-average band from the distribution for that crash type
        const avgBandColor = (dist: BandDist) => {
          const total = ([1, 2, 3, 4] as const).reduce((s, b) => s + (dist[b] || 0), 0);
          if (!total) return "#999";
          const avgBand = ([1, 2, 3, 4] as const).reduce((s, b) => s + b * (dist[b] || 0), 0) / total;
          return RISK_COLORS[Math.min(4, Math.max(1, Math.round(avgBand))) as 1 | 2 | 3 | 4];
        };

        // Color safe% by threshold: ≥60% green, ≥40% amber, <40% red
        const safeColor = (pct: number) => (pct >= 60 ? "#27ae60" : pct >= 40 ? "#e67e22" : "#e74c3c");

        // ▲/▼ for safe %: more safe than network = green
        const deltaSafe = (lPct: number, nPct: number, size = 7) => {
          const d = lPct - nPct;
          if (Math.abs(d) < 1) return <span style={{ color: "#bbb", fontSize: size }}>≈</span>;
          return (
            <span style={{ color: d > 0 ? "#27ae60" : "#e74c3c", fontSize: size, fontWeight: 700 }}>
              {d > 0 ? "▲" : "▼"}{Math.abs(d).toFixed(1)}%
            </span>
          );
        };

        // ▲/▼ for avg score: lower avg = safer = good
        const deltaAvg = (lAvg: string, nAvg: string, size = 7) => {
          const ld = parseFloat(lAvg), nd = parseFloat(nAvg);
          if (isNaN(ld) || isNaN(nd)) return null;
          const d = ld - nd;
          if (Math.abs(d) < 0.05) return <span style={{ color: "#bbb", fontSize: size }}>≈</span>;
          return (
            <span style={{ color: d < 0 ? "#27ae60" : "#e74c3c", fontSize: size, fontWeight: 700 }}>
              {d > 0 ? "▲" : "▼"}{Math.abs(d).toFixed(2)}
            </span>
          );
        };

        // ▲/▼ per band cell: Low/Med more = good; High/Ext more = bad
        const deltaBand = (lPct: number, nPct: number, band: number) => {
          const d = lPct - nPct;
          if (Math.abs(d) < 1) return <span style={{ color: "#ccc", fontSize: 9 }}>≈</span>;
          const isGood = band <= 2 ? d > 0 : d < 0;
          return (
            <span style={{ color: isGood ? "#27ae60" : "#e74c3c", fontSize: 9, fontWeight: 700 }}>
              {d > 0 ? "▲" : "▼"}{Math.abs(d).toFixed(1)}%
            </span>
          );
        };

        // Overall stats
        const ovDist = distributions?.Overall;
        const ovTotal = ovDist ? Object.values(ovDist).reduce((a, b) => a + b, 0) || 1 : 1;
        const ovSafe = ovDist ? safePctOf(ovDist, ovTotal) : 0;
        const ovAvg = scoreStats?.Overall?.avg ?? "—";
        const netOvDist = netDist?.Overall;
        const netOvTotal = netOvDist ? Object.values(netOvDist).reduce((a, b) => a + b, 0) || 1 : 1;
        const netOvSafe = netOvDist ? safePctOf(netOvDist, netOvTotal) : 0;
        const netOvAvg = networkDataset?.scoreStats?.Overall?.avg;

        return (
          <div style={{ padding: "10px 14px" }}>
            <EditableText
              value={secTitle(el.id, "Benchmarking Statistics")}
              onChange={(t) => setSecTitle(el.id, t)}
              style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e", display: "block", marginBottom: 4 }}
            />
            <div style={{ fontSize: 10, color: "#888", marginBottom: 10, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <span>Risk band distribution &amp; avg scores · {totalSegments} segments loaded</span>
              {showNet && (
                <span style={{ color: "#bbb" }}>vs {netTotal} segments network-wide ({allProfileProjects.length} projects)</span>
              )}
              {allLoaded && (
                <span style={{ color: "#aaa", fontStyle: "italic" }}>All profile projects loaded — no separate baseline</span>
              )}
            </div>

            {!distributions ? (
              isLoadingScores ? (
                <div style={{ color: "#888", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <Loader2 size={14} className="rb-spinner" /> Loading score data...
                </div>
              ) : (
                <div style={{ color: "#888", fontSize: 12 }}>No score data — run scoring first.</div>
              )
            ) : (
              <>
                {/* ── Crash-type scorecards ─────────────────────────────────── */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  {crashTypeCards.map(({ key, label }) => {
                    const dist = distributions[key];
                    const tot = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
                    const avg = scoreStats?.[key]?.avg ?? "—";
                    const safe = safePctOf(dist, tot);
                    const netDistRow = netDist?.[key];
                    const netRowTot = netDistRow ? Object.values(netDistRow).reduce((a, b) => a + b, 0) || 1 : 1;
                    const netSafe = netDistRow ? safePctOf(netDistRow, netRowTot) : 0;
                    const netAvg = networkDataset?.scoreStats?.[key]?.avg;
                    return (
                      <div key={key} style={{
                        flex: 1,
                        border: "1px solid #e8e0f0",
                        borderRadius: 6,
                        padding: "8px 10px",
                        background: "#fdfbff",
                        display: "flex",
                        flexDirection: "column",
                        minWidth: 0,
                      }}>
                        <div style={{ fontSize: 8, fontWeight: 700, color: "#666", marginBottom: 5, letterSpacing: 0.3, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {label}
                        </div>
                        {/* Avg score — headline number */}
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 1 }}
                          title={`Average ${label} risk score across loaded segments (lower = safer)`}>
                          <span style={{ fontSize: 22, fontWeight: 800, color: avgBandColor(dist), lineHeight: 1 }}>{avg}</span>
                          <span style={{ fontSize: 7, color: "#aaa" }}>avg score</span>
                        </div>
                        {/* Mini distribution bar */}
                        <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", margin: "6px 0" }}>
                          {[1, 2, 3, 4].map((band) => {
                            const pct = (dist[band] || 0) / tot * 100;
                            return pct > 0 ? (
                              <div key={band} title={`${RISK_LABELS[band]}: ${pct.toFixed(1)}%`}
                                style={{ width: `${pct}%`, background: RISK_COLORS[band] }} />
                            ) : null;
                          })}
                        </div>
                        {/* Network comparison */}
                        {showNet && (
                          <div style={{ borderTop: "1px dashed #e8e0f0", paddingTop: 6, marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                            <div title={`Average ${label} score across all ${allProfileProjects.length} profile projects (network baseline)`}
                              style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <span style={{ fontSize: 9, color: "#aaa", whiteSpace: "nowrap" }}>Net avg</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#666" }}>{netAvg ?? "—"}</span>
                              {netAvg && deltaAvg(avg, netAvg, 11)}
                            </div>
                            <div title={`% of all profile segments rated Low or Medium risk for ${label}`}
                              style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <span style={{ fontSize: 9, color: "#aaa", whiteSpace: "nowrap" }}>Net</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#888" }}>{netSafe.toFixed(1)}%</span>
                              {deltaSafe(safe, netSafe, 11)}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* ── Overall summary strip ─────────────────────────────────── */}
                {ovDist && (
                  <div style={{
                    background: "#f0e8fc",
                    borderRadius: 8,
                    padding: "14px 18px",
                    marginBottom: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 18,
                    flexWrap: "wrap",
                  }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: "#6b21a8", whiteSpace: "nowrap" }}>Overall Risk</span>
                    <div title="Average overall risk score across loaded segments (lower = safer)"
                      style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>{ovAvg}</span>
                      <span style={{ fontSize: 10, color: "#888" }}>avg score</span>
                    </div>
                    <div style={{ flex: 1, display: "flex", height: 14, borderRadius: 5, overflow: "hidden", minWidth: 80 }}>
                      {[1, 2, 3, 4].map((band) => {
                        const pct = (ovDist[band] || 0) / ovTotal * 100;
                        return pct > 0 ? (
                          <div key={band} title={`${RISK_LABELS[band]}: ${pct.toFixed(1)}%`}
                            style={{ width: `${pct}%`, background: RISK_COLORS[band] }} />
                        ) : null;
                      })}
                    </div>
                    {showNet && netOvDist && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 16, borderLeft: "2px solid #d8c8f0" }}>
                        <div title={`Average overall score across all ${allProfileProjects.length} profile projects (network baseline)`}
                          style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, color: "#9b59b6", whiteSpace: "nowrap" }}>Net avg</span>
                          <span style={{ fontSize: 20, fontWeight: 700, color: "#7c3aed", lineHeight: 1 }}>{netOvAvg ?? "—"}</span>
                          {netOvAvg && deltaAvg(ovAvg, netOvAvg, 14)}
                        </div>
                        <div title="% of all profile segments rated Low or Medium risk overall (network baseline)"
                          style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, color: "#9b59b6", whiteSpace: "nowrap" }}>Net</span>
                          <span style={{ fontSize: 20, fontWeight: 700, color: "#7c3aed", lineHeight: 1 }}>{netOvSafe.toFixed(1)}%</span>
                          {deltaSafe(ovSafe, netOvSafe, 14)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Per-band detail table ─────────────────────────────────── */}
                <div style={{ fontSize: 10, color: "#aaa", marginBottom: 6, letterSpacing: 0.4, textTransform: "uppercase", fontWeight: 600 }}>
                  Per-band breakdown
                  {showNet && <span style={{ marginLeft: 10, fontWeight: 400, letterSpacing: 0 }}>
                    <span style={{ color: "#555" }}>■</span> Loaded &nbsp;
                    <span style={{ color: "#bbb" }}>■</span> Network
                  </span>}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f5f0fa" }}>
                      <th style={{ ...thStyle, width: 150, fontSize: 12 }}>Crash Type</th>
                      {[1, 2, 3, 4].map((band) => (
                        <th key={band} title={`% of segments scored ${RISK_LABELS[band as keyof typeof RISK_LABELS]} risk for this crash type`}
                          style={{ ...thStyle, textAlign: "center", color: RISK_COLORS[band], fontSize: 12 }}>
                          {RISK_LABELS[band]}
                        </th>
                      ))}
                      <th title="Average risk score for this crash type across loaded segments (lower = safer)"
                        style={{ ...thStyle, textAlign: "center", fontSize: 12 }}>Avg</th>
                      <th title="Risk band distribution across segments — coloured by band"
                        style={{ ...thStyle, textAlign: "center", fontSize: 12 }}>Distribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crashTypeCards.map(({ key, label }, ri) => {
                      const dist = distributions[key];
                      const tot = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
                      const avg = scoreStats?.[key]?.avg ?? "—";
                      const netDistRow = netDist?.[key];
                      const netRowTot = netDistRow ? Object.values(netDistRow).reduce((a, b) => a + b, 0) || 1 : 1;
                      const netAvg = networkDataset?.scoreStats?.[key]?.avg;
                      return (
                        <tr key={key} style={{ borderBottom: "1px solid #f0eaf8", background: ri % 2 === 0 ? "#fff" : "#fafafa" }}>
                          <td style={{ ...tdStyle, fontWeight: 600, color: "#444", fontSize: 12, padding: "8px 10px" }}>{label}</td>
                          {[1, 2, 3, 4].map((band) => {
                            const count = dist[band] || 0;
                            const pct = count / tot * 100;
                            const netCount = netDistRow?.[band] || 0;
                            const netPct = netCount / netRowTot * 100;
                            return (
                              <td key={band} style={{ ...tdStyle, textAlign: "center", padding: "8px 6px" }}>
                                <div title={`${pct.toFixed(1)}% of loaded segments scored ${RISK_LABELS[band as keyof typeof RISK_LABELS]} risk for ${label}`}
                                  style={{ color: RISK_COLORS[band], fontWeight: 700, fontSize: 14 }}>{pct.toFixed(1)}%</div>
                                {showNet && (
                                  <div title={`${netPct.toFixed(1)}% of all ${netTotal} profile segments scored ${RISK_LABELS[band as keyof typeof RISK_LABELS]} risk for ${label}`}
                                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, borderTop: "1px dashed #eee", marginTop: 5, paddingTop: 5 }}>
                                    <span style={{ color: "#999", fontSize: 11, fontWeight: 600 }}>{netPct.toFixed(1)}%</span>
                                    {deltaBand(pct, netPct, band)}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                          <td title={`Average ${label} score across loaded segments (lower = safer)`}
                            style={{ ...tdStyle, textAlign: "center", fontSize: 14, fontWeight: 600, color: avgBandColor(dist), padding: "8px 6px" }}>
                            {avg}
                            {showNet && netAvg && (
                              <div title={`Average ${label} score across all ${allProfileProjects.length} profile projects (network baseline)`}
                                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, color: "#999", fontSize: 11, fontWeight: 600, borderTop: "1px dashed #eee", marginTop: 5, paddingTop: 5 }}>
                                {netAvg} {deltaAvg(avg, netAvg, 11)}
                              </div>
                            )}
                          </td>
                          <td style={{ ...tdStyle, padding: "8px 10px", width: 100 }}>
                            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 1 }}>
                              {[1, 2, 3, 4].map((band) => {
                                const pct = (dist[band] || 0) / tot * 100;
                                return pct > 0 ? (
                                  <div key={band} title={`${RISK_LABELS[band]}: ${pct.toFixed(1)}%`}
                                    style={{ width: `${pct}%`, background: RISK_COLORS[band], minWidth: 2 }} />
                                ) : null;
                              })}
                            </div>
                            {showNet && netDistRow && (
                              <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", gap: 1, marginTop: 3, opacity: 0.5 }}>
                                {[1, 2, 3, 4].map((band) => {
                                  const pct = (netDistRow[band] || 0) / netRowTot * 100;
                                  return pct > 0 ? (
                                    <div key={band} style={{ width: `${pct}%`, background: RISK_COLORS[band], minWidth: 2 }} />
                                  ) : null;
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {isLoadingNetworkData && !allLoaded && (
                  <div style={{ color: "#aaa", fontSize: 9, display: "flex", alignItems: "center", gap: 5, marginTop: 6 }}>
                    <Loader2 size={10} className="rb-spinner" /> Loading network data for comparison…
                  </div>
                )}
              </>
            )}
          </div>
        );
      }

      // ── Top Risk Stretches ─────────────────────────────────────────────────
      case "topRisk": {
        const viewMode = el.viewMode || "full-page";
        const displayRows = topRiskRows.slice(0, el.topN ?? 10);

        if (viewMode === "full-page") {
          return (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {displayRows.length === 0 ? (
                <>
                  <div style={{ padding: "8px 12px 2px", flexShrink: 0 }}>
                    <EditableText value={secTitle(el.id, "Top Risk Stretches")} onChange={(t) => setSecTitle(el.id, t)} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }} />
                    <div style={{ fontSize: 10, color: "#999" }}>Ranked highest to lowest · Before risk factors & after treatments applied</div>
                  </div>
                  {isLoadingScores ? (
                    <div style={{ padding: 14, color: "#888", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                      <Loader2 size={14} className="rb-spinner" /> Loading score data...
                    </div>
                  ) : (
                    <div style={{ padding: 14, color: "#888", fontSize: 12 }}>No score data. Run scoring first.</div>
                  )}
                </>
              ) : (
                renderTopRiskFullPage(displayRows, el.id)
              )}
            </div>
          );
        }

        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "8px 12px 2px", flexShrink: 0 }}>
              <EditableText value={secTitle(el.id, "Top Risk Stretches")} onChange={(t) => setSecTitle(el.id, t)} style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }} />
              <div style={{ fontSize: 10, color: "#999" }}>Ranked highest to lowest · Before risk factors & after treatments applied</div>
            </div>
            {displayRows.length === 0
              ? isLoadingScores ? (
                  <div style={{ padding: 14, color: "#888", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <Loader2 size={14} className="rb-spinner" /> Loading score data...
                  </div>
                ) : (
                  <div style={{ padding: 14, color: "#888", fontSize: 12 }}>No score data. Run scoring first.</div>
                )
              : viewMode === "grid" ? renderTopRiskGrid(displayRows)
                : renderTopRiskTabular(displayRows)}
          </div>
        );
      }

      // ── Treatment Summary ──────────────────────────────────────────────────
      case "treatmentSummary": {
        if (projects.length === 0) {
          return (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <SectionHeader title={secTitle(el.id, "Treatment Summary")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle="" />
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", color: "#888", fontSize: 12 }}>{el.filtered ? "No segments match the filter." : "No project data loaded."}</div>
              </div>
            </div>
          );
        }
        if (treatmentSummaries.length === 0) {
          return (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <SectionHeader title={secTitle(el.id, "Treatment Summary")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle={`Data from: ${projects.map(dispName).join(", ")}`} />
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", color: "#888", fontSize: 12 }}>{el.filtered ? "No treatments on filtered segments." : "Loading treatment data…"}</div>
              </div>
            </div>
          );
        }

        const chunks: ProjectTreatmentSummary[][] = [];
        let currentChunk: ProjectTreatmentSummary[] = [];
        let currentHeight = 0;
        const MAX_H = 920; // safe max height for content below header

        for (const summary of treatmentSummaries) {
          const sorted = Object.keys(summary.treatmentCounts);
          const estHeight = 80 + (sorted.length === 0 ? 30 : sorted.length * 36);

          if (currentHeight + estHeight > MAX_H && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = [summary];
            currentHeight = estHeight;
          } else {
            currentChunk.push(summary);
            currentHeight += estHeight;
          }
        }
        if (currentChunk.length > 0) chunks.push(currentChunk);

        return (
          <div style={{ flex: 1, overflow: "visible", display: "flex", flexDirection: "column" }}>
            {chunks.map((chunk, i) => {
              const isLast = i === chunks.length - 1;
              const height = isLast ? "auto" : PAGE_H;
              const projectsInChunk = chunk.map(c => c.project);
              const subtitle = `Data from: ${projectsInChunk.map(dispName).join(", ")}`;

              return (
                <div key={i} style={{ height, boxSizing: "border-box", paddingBottom: isLast ? 0 : PAGE_GAP, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <SectionHeader title={secTitle(el.id, "Treatment Summary") + (i > 0 ? " (Cont.)" : "")} onTitleChange={i === 0 ? (t) => setSecTitle(el.id, t) : undefined} subtitle={subtitle} />
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    {renderTreatmentSummary(chunk, projectSegmentCounts)}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      // ── Project Details ────────────────────────────────────────────────────
      case "projectDetails": {
        const fmtDate = (iso?: string) => {
          if (!iso) return "—";
          try { const d = new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; }
          catch { return iso; }
        };
        const detailRow = (label: string, value: string) => (
          <div key={label} style={{ display: "flex", gap: 8, fontSize: 11, color: "#333", lineHeight: 1.9, borderBottom: "1px solid #f5f0fa" }}>
            <span style={{ width: 90, flexShrink: 0, color: "#888", fontWeight: 500 }}>{label}</span>
            <span style={{ fontWeight: 600, color: "#1a1a2e" }}>{value}</span>
          </div>
        );
        const renderProject = (name: string, isLastInChunk: boolean) => {
          const meta = projectMeta[name] ?? {};
          const count = projectSegmentCounts[name] ?? 0;
          const lenKm = (count * 10 / 1000).toFixed(1);
          const projRows = ds.rows.filter((r) => r._project === name);
          const projDist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
          projRows.forEach((r) => { const b = r._maxBand; if (b >= 1 && b <= 4) projDist[b]++; });
          const projTotal = projRows.length || 1;
          return (
            <div key={name} style={{ marginBottom: isLastInChunk ? 0 : 16, paddingBottom: isLastInChunk ? 0 : 14, borderBottom: isLastInChunk ? "none" : "1px solid #ede8f5" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <EditableText value={dispName(name)} onChange={(v) => setProjectName(name, v)} style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e", flex: 1 }} />
                {projectQuarterLabel[name] && (
                  <span style={{ fontSize: 11, color: "#a020d0", fontWeight: 600, background: "#f0e4f8", padding: "2px 7px", borderRadius: 8, whiteSpace: "nowrap" }}>{projectQuarterLabel[name]}</span>
                )}
                {projRows.length > 0 && renderBandBadge(Math.round(Object.entries(projDist).sort(([, a], [, b]) => b - a)[0][0] as unknown as number))}
              </div>
              <div style={{ marginBottom: 6 }}>
                {detailRow("Segments", `${count}`)}
                {detailRow("Length", `${lenKm} km`)}
                {detailRow("Survey", (() => {
                  const imgRange = projectImageDates[name];
                  if (imgRange) return imgRange.earliest === imgRange.latest ? fmtDate(imgRange.earliest) : `${fmtDate(imgRange.earliest)} – ${fmtDate(imgRange.latest)}`;
                  return fmtDate(meta.lastUpdated);
                })())}
                {detailRow("Analysis", fmtDate(meta.lastUpdated))}
              </div>
              {projRows.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, color: "#aaa", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>Overall Risk Distribution</div>
                  <div style={{ display: "flex", height: 10, borderRadius: 4, overflow: "hidden", gap: 1 }}>
                    {[1, 2, 3, 4].map((b) => {
                      const pct = projDist[b] / projTotal * 100;
                      return pct > 0 ? <div key={b} title={`${RISK_LABELS[b]}: ${pct.toFixed(1)}%`} style={{ width: `${pct}%`, background: RISK_COLORS[b], minWidth: 2 }} /> : null;
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 3 }}>
                    {[1, 2, 3, 4].map((b) => projDist[b] > 0 ? (
                      <span key={b} style={{ fontSize: 9, color: RISK_COLORS[b], fontWeight: 600 }}>
                        {RISK_LABELS[b]} {(projDist[b] / projTotal * 100).toFixed(1)}%
                      </span>
                    ) : null)}
                  </div>
                </div>
              )}
            </div>
          );
        };
        const projectRiskScores = Object.fromEntries(
          projects.map((name) => {
            const projRows = ds.rows.filter((r) => r._project === name);
            const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
            projRows.forEach((r) => { const b = r._maxBand; if (b >= 1 && b <= 4) dist[b]++; });
            const total = projRows.length || 1;
            return [name, (dist[4] * 8 + dist[3] * 4 + dist[2] * 2 + dist[1] * 1) / total];
          })
        );
        const sortedProjects = [...projects].sort((a, b) => projectRiskScores[b] - projectRiskScores[a]);
        const numChunks = Math.max(1, Math.ceil(projects.length / PROJ_PAGE_SIZE));
        return (
          // Each chunk (except the last) is exactly PAGE_H tall so its boundary
          // lands on the PDF page-break grid — a real page break between every
          // PROJ_PAGE_SIZE projects, not a click-to-paginate widget.
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {projects.length === 0 ? (
              <>
                <SectionHeader title={secTitle(el.id, "Project Details")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle={el.filtered ? "No segments match the filter" : "0 projects"} />
                <div style={{ padding: "8px 14px", color: "#888", fontSize: 12 }}>{el.filtered ? "No segments match the filter." : "No projects loaded."}</div>
              </>
            ) : (
              Array.from({ length: numChunks }).map((_, ci) => {
                const chunkProjects = sortedProjects.slice(ci * PROJ_PAGE_SIZE, (ci + 1) * PROJ_PAGE_SIZE);
                const isLastChunk = ci === numChunks - 1;
                return (
                  <div key={ci} style={{ height: isLastChunk ? "auto" : PAGE_H, paddingBottom: isLastChunk ? 0 : PAGE_GAP, boxSizing: "border-box", flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    {ci === 0 ? (
                      <SectionHeader title={secTitle(el.id, "Project Details")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle={`${projects.length} project${projects.length !== 1 ? "s" : ""} · ${totalSegments} segments · ${totalKm.toFixed(1)} km total`} />
                    ) : (
                      <div style={{ padding: "10px 14px 0", fontSize: 20, fontWeight: 600, color: "#1a1a2e" }}>
                        {secTitle(el.id, "Project Details")} <span style={{ color: "#aaa", fontWeight: 500 }}>(continued)</span>
                      </div>
                    )}
                    <div style={{ flex: 1, overflow: "hidden", padding: "8px 14px" }}>
                      {chunkProjects.map((name, pi) => renderProject(name, pi === chunkProjects.length - 1))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );
      }

      // ── Risk Statistics ────────────────────────────────────────────────────
      case "riskStats": {
        // Scale reference: VB max ≈100, BB/BP/SB max ≈40
        const SCALE_MAX: Record<string, number> = { Overall: 200, VB: 100, BB: 40, SB: 40, BP: 40 };
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <SectionHeader title={secTitle(el.id, "Risk Score Statistics")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle="Score range and average across all segments per crash type" />
            <div style={{ flex: 1, overflow: "visible", padding: "8px 14px" }}>
              {!scoreStats
                ? isLoadingScores ? (
                    <div style={{ color: "#888", fontSize: 12, padding: 8, display: "flex", alignItems: "center", gap: 6 }}>
                      <Loader2 size={14} className="rb-spinner" /> Loading score data...
                    </div>
                  ) : (
                    <div style={{ color: "#888", fontSize: 12, padding: 8 }}>No score data available.</div>
                  )
                : (["Overall", "VB", "BB", "SB", "BP"] as const).map((ct, i) => {
                  const { min, max, avg } = scoreStats[ct];
                  const scale = SCALE_MAX[ct] || 100;
                  const minN = parseFloat(min) || 0;
                  const maxN = parseFloat(max) || 0;
                  const avgN = parseFloat(avg) || 0;
                  const minPct = Math.min(100, minN / scale * 100);
                  const maxPct = Math.min(100, maxN / scale * 100);
                  const avgPct = Math.min(100, avgN / scale * 100);
                  const isOverall = ct === "Overall";
                  return (
                    <div key={ct} style={{ marginBottom: i < 4 ? 10 : 0, paddingBottom: i < 4 ? 10 : 0, borderBottom: i < 4 ? "1px solid #f5f0fa" : "none" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: isOverall ? 700 : 600, color: isOverall ? "#a020d0" : "#333", width: 130, flexShrink: 0 }}>{CRASH_TYPE_LABELS[ct]}</span>
                        <span style={{ fontSize: 10, color: "#87C424", fontWeight: 700 }}>min {min}</span>
                        <span style={{ fontSize: 10, color: "#aaa" }}>·</span>
                        <span style={{ fontSize: 10, color: "#555", fontWeight: 600 }}>avg {avg}</span>
                        <span style={{ fontSize: 10, color: "#aaa" }}>·</span>
                        <span style={{ fontSize: 10, color: "#CD1AFF", fontWeight: 700 }}>max {max}</span>
                      </div>
                      <div style={{ position: "relative", height: 12, background: "#f0eaf8", borderRadius: 6, overflow: "hidden" }}>
                        {/* range band */}
                        <div style={{ position: "absolute", left: `${minPct}%`, width: `${Math.max(0, maxPct - minPct)}%`, background: isOverall ? "#a020d0" : "#c080e8", height: "100%", opacity: 0.35 }} />
                        {/* avg marker */}
                        <div style={{ position: "absolute", left: `${avgPct}%`, width: 2, height: "100%", background: isOverall ? "#a020d0" : "#8040c0", transform: "translateX(-1px)" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 1 }}>
                        <span style={{ fontSize: 8, color: "#ccc" }}>0</span>
                        <span style={{ fontSize: 8, color: "#ccc" }}>{scale}</span>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        );
      }

      // ── Top Contributing Attributes ────────────────────────────────────────
      case "topAttributes": {
        const ATTR_COLORS = ["#a020d0", "#4472C4", "#C0504D", "#9BBB59", "#4BACC6", "#F79646", "#7030A0", "#2C4770", "#E46C0A", "#A9D18E"];
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <SectionHeader title={secTitle(el.id, "Top Risk Factors")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle={`Most frequently occurring risk contributors · ${totalSegments} segments total`} />
            <div style={{ flex: 1, overflow: "hidden", padding: "8px 14px" }}>
              {attributeFrequency.length === 0
                ? <div style={{ color: "#888", fontSize: 12 }}>No attribute data. Run scoring first.</div>
                : (() => {
                  const maxCount = attributeFrequency[0]?.[1] ?? 1;
                  return attributeFrequency.map(([name, count], i) => {
                    const pct = totalSegments > 0 ? (count / totalSegments * 100) : 0;
                    const barPct = count / maxCount * 100;
                    const color = ATTR_COLORS[i % ATTR_COLORS.length];
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <div style={{ width: 20, fontSize: 10, fontWeight: 700, color: "#bbb", textAlign: "right", flexShrink: 0 }}>#{i + 1}</div>
                        <div style={{ flex: 1, overflow: "hidden" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                            <span style={{ fontSize: 11, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "72%" }}>{name}</span>
                            <span style={{ fontSize: 10, color: "#888", flexShrink: 0, marginLeft: 4 }}>{count} segs · {pct.toFixed(1)}%</span>
                          </div>
                          <div style={{ height: 9, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: `${barPct}%`, background: color, height: "100%", opacity: 0.8 }} />
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
            </div>
          </div>
        );
      }

      // ── Recommendations ────────────────────────────────────────────────────
      case "recommendations": {
        // Auto-generate priority actions from top risk factors
        const autoSuggestions: string[] = [];
        attributeFrequency.slice(0, 5).forEach(([name, count]) => {
          const pct = totalSegments > 0 ? (count / totalSegments * 100).toFixed(0) : "?";
          autoSuggestions.push(`Address "${name}" — affects ${count} segments (${pct}% of network)`);
        });
        if (topRiskRows.length > 0) {
          const extremeCount = topRiskRows.filter((r) => r._maxBand === 4).length;
          if (extremeCount > 0) autoSuggestions.push(`Priority intervention on ${extremeCount} Extreme-rated segment${extremeCount > 1 ? "s" : ""} — immediate action required`);
        }
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <SectionHeader title={secTitle(el.id, "Recommendations")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle="Data-driven priority actions · editable notes below" />
            <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", padding: "6px 14px", gap: 6 }}>
              {autoSuggestions.length > 0 && (
                <div style={{ background: "#f5f0fa", borderRadius: 6, border: "1px solid #e0d0f0", padding: "8px 10px", flexShrink: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#a020d0", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Suggested Priority Actions</div>
                  {autoSuggestions.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, fontSize: 11, color: "#333", lineHeight: 1.6 }}>
                      <span style={{ color: "#a020d0", fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={recommendations}
                onChange={(e) => setRecommendations(e.target.value)}
                placeholder="Add custom recommendations, observations, or next steps here…"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                style={{ flex: 1, resize: "none", border: "1px solid #e0d0f0", borderRadius: 4, padding: "8px 10px", fontSize: 11, color: "#222", fontFamily: "inherit", background: "#fafcff", boxSizing: "border-box", outline: "none", lineHeight: 1.6, minHeight: 60 }}
              />
            </div>
          </div>
        );
      }

      // ── Methodology ────────────────────────────────────────────────────────
      case "methodology":
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <SectionHeader title={secTitle(el.id, "Methodology")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle="CycleRAP v2 — Cycling Road Assessment Programme" />
            <div style={{ flex: 1, overflow: "hidden", padding: "10px 14px" }}>
              <p style={{ fontSize: 11, color: "#444", lineHeight: 1.75, margin: "0 0 10px" }}>{METHODOLOGY_TEXT}</p>
              {/* Risk band thresholds table */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#a020d0", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 }}>Risk Band Thresholds</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr style={{ background: "#f5f0fa" }}>
                      <th style={{ ...thStyle }}>Crash Type</th>
                      {[1, 2, 3, 4].map((b) => (
                        <th key={b} style={{ ...thStyle, textAlign: "center", color: RISK_COLORS[b] }}>{RISK_LABELS[b]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Vehicle–Bicycle (VB)", ranges: ["< 10", "10 – 25", "25 – 60", "> 60"] },
                      { label: "Bicycle–Bicycle (BB)", ranges: ["< 5", "5 – 10", "10 – 20", "> 20"] },
                      { label: "Single-Bicycle (SB)", ranges: ["< 5", "5 – 10", "10 – 20", "> 20"] },
                      { label: "Bicycle–Pedestrian (BP)", ranges: ["< 5", "5 – 10", "10 – 20", "> 20"] },
                    ].map(({ label, ranges }, i) => (
                      <tr key={label} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa", borderBottom: "1px solid #f0eaf8" }}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{label}</td>
                        {ranges.map((r, j) => (
                          <td key={j} style={{ ...tdStyle, textAlign: "center", color: RISK_COLORS[j + 1], fontWeight: 600 }}>{r}</td>
                        ))}
                      </tr>
                    ))}
                    <tr style={{ background: "#f0e8fc", borderBottom: "1px solid #d8c4f0", fontWeight: 700 }}>
                      <td style={{ ...tdStyle, fontWeight: 700, color: "#a020d0" }}>Overall Risk</td>
                      <td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "#555", fontStyle: "italic" }}>Maximum band across all four crash types</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* Segment length note */}
              <div style={{ fontSize: 10, color: "#888", background: "#fafafa", borderRadius: 4, padding: "5px 8px", border: "1px solid #eee" }}>
                <strong>Segment length:</strong> Each segment represents 10 m of cycling facility (CycleRAP standard). Total network: {totalSegments} segments = {totalKm.toFixed(1)} km.
              </div>
            </div>
          </div>
        );

      // ── Segment Image Gallery ──────────────────────────────────────────────
      case "segmentGallery":
        return (
          <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <SectionHeader title={secTitle(el.id, "Segment Image Gallery")} onTitleChange={(t) => setSecTitle(el.id, t)} subtitle="Images for top-risk segments, ordered by rank" />
            <div style={{ flex: 1, overflow: "hidden", padding: "8px 10px" }}>
              {topRiskRows.length === 0
                ? <div style={{ color: "#888", fontSize: 12 }}>No segments loaded.</div>
                : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {topRiskRows.map((row, i) => {
                      const e = getEnriched(row);
                      return (
                        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <div style={{ position: "relative" }}>
                            <SegmentImage src={e.imageUrl} width={90} height={65} />
                            <div style={{ position: "absolute", top: 2, left: 2, background: "rgba(0,0,0,0.55)", borderRadius: 3, padding: "1px 5px", fontSize: 9, color: "#fff", fontWeight: 700 }}>#{i + 1}</div>
                            {renderBandBadge(row._maxBand, true) && (
                              <div style={{ position: "absolute", bottom: 2, right: 2 }}>{renderBandBadge(row._maxBand, true)}</div>
                            )}
                          </div>
                          <div style={{ fontSize: 8, color: "#666", textAlign: "center", maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dispNameWithQuarter(row._project)} · S{row._segIndex}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>
          </div>
        );

      default: return null;
    }
  };

  // ── Flow layout (single source of truth for heights + page-break spacing) ──
  const visibleElements = useMemo(
    () => elements.filter((e) => e.visible && (FILTERED_SECTIONS_ENABLED || !e.filtered)),
    [elements],
  );
  const layout = useMemo(
    () => computeFlowLayout(visibleElements, computeIdealHeight),
    [visibleElements, computeIdealHeight],
  );

  // ── Dynamic canvas size ───────────────────────────────────────────────────
  const canvasH = useMemo(() => {
    if (visibleElements.length === 0) return 3400;
    return Math.max(1200, layout.bottom + 80);
  }, [visibleElements, layout]);



  // Gap-constrained page separators: each band is clipped to the actual whitespace
  // We no longer manually calculate page breaks.
  // Instead, visual page backdrops with spaces between them are rendered.
  const totalPages = useMemo(() => Math.max(1, Math.ceil(canvasH / PAGE_H)), [canvasH]);

  // ── Checklist memo ────────────────────────────────────────────────────────
  const sectionChecklist = useMemo(() =>
    elements
      .filter((el) => FILTERED_SECTIONS_ENABLED || !el.filtered)
      .map((el) => ({ id: el.id, label: el.label, visible: el.visible, filtered: !!el.filtered })),
    [elements]
  );

  // ── Page ──────────────────────────────────────────────────────────────────
  // ── Assemble the shell-facing view-model (see layouts/ReportBuilderViewModel.ts) ──
  const vm: ReportBuilderViewModel = {
    isV2, accent, navigate,
    canvasRef, canvasContainerRef, postTreatmentUploadRef, handlePostTreatmentFileChange,
    autoFitElements, saveLayout, resetLayout, restoreLayout, hasSaved,
    goToPage, currentPage, totalPages,
    handleDownloadPDF, handleDownloadWord, exporting,
    saveToastVisible, setSaveToastVisible, restoreBannerVisible, setRestoreBannerVisible,
    hasFilter, includeFiltered, toggleIncludeFiltered,
    sensors, handleDragEnd, sectionChecklist, elements, hideElement, showElement, scrollToSection,
    renderViewToggle, renderMapColorToggle,
    handleCanvasScroll, canvasH, visibleElements, layout, computeIdealHeight, renderContent,
    showProjectPicker, pickerLoading, availableProjects, pickerSelected, setPickerSelected, loadSelectedProjects,
  };

  return <ReportBuilderLayoutV1 vm={vm} />;
}
