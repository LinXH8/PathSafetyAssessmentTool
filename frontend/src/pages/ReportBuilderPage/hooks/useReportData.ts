/**
 * useReportData.ts — the Report Builder's server-data spine.
 *
 * Extracted verbatim from `reportBuilderPage.tsx` (S2.5 decomposition). Owns
 * every per-project fetch (scores, enrichment, treatments, project metadata,
 * image date ranges, network benchmark) and the derived full / filtered /
 * network datasets, plus the post-treatment image upload flow. It is a pure
 * data spine: the container passes in the loaded-project list and the restored
 * Path-Analysis filter context, and consumes the datasets / helpers this hook
 * returns — there is no circular coupling back into the layout state.
 *
 * Load-bearing behaviour preserved exactly (root CLAUDE.md): the post-treatment
 * upload re-fetches segment-details and patches `enrichedMap` with the
 * cache-busting `?t=` timestamp so the changed image renders immediately.
 *
 * Side effects: fetches `/api/projects/<name>/{metadata,image-date-range,
 * results,treatments/all}`, `/api/report/segment-details`, and the
 * post-treatment image endpoints; reads the shared results cache
 * (`getCachedResults`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCachedResults } from "../../../api/projectDataCache";
import { MAP_MISSING_SCORE_COLOR, CATEGORY_UNKNOWN_COLOR } from "../../../constants/mapColors";
import { RISK_COLORS } from "../../../utils/riskColors";
import { buildCoreDataset, dateToQuarterLabel } from "../reportBuilderHelpers";
import type {
  ElementState, EnrichedDetail, FilterCategoryStatus,
  ProjectTreatmentSummary, ReportDataset, TopRiskRow,
} from "../reportBuilderTypes";

/** One quarter's aggregated image-date range + member projects. */
export interface QuarterRange { label: string; earliest: string; latest: string; projects: string[] }

/** Inputs the container supplies (loaded projects + restored filter context). */
export interface UseReportDataParams {
  loadedProjects: string[];
  allProfileProjects: string[];
  /** Whether a benchmarkStats section is visible (gates the network fetch). */
  benchmarkVisible: boolean;
  filteredIdxByProject: Record<string, number[]> | null;
  filteredSegValues: Record<string, Record<number, Record<string, string>>> | null;
  activeFilterNames: string[];
  activeCategoryStatus: FilterCategoryStatus[];
}

export interface UseReportDataResult {
  fullDataset: ReportDataset;
  filteredDataset: ReportDataset;
  networkDataset: Omit<ReportDataset, "treatmentSummaries"> | null;
  treatmentSummaries: ProjectTreatmentSummary[];
  quarterData: QuarterRange[];
  projectQuarterLabel: Record<string, string>;
  projectMeta: Record<string, { dateCreated?: string; lastUpdated?: string; lengthKm?: number }>;
  projectImageDates: Record<string, { earliest: string; latest: string }>;
  imageDatesLoading: boolean;
  isLoadingScores: boolean;
  isLoadingNetworkData: boolean;
  getEnriched: (row: TopRiskRow) => EnrichedDetail;
  getSegmentTreatments: (row: TopRiskRow) => number[];
  buildMapColorMap: (ds: ReportDataset, el: ElementState) => Map<string, string>;
  postTreatmentUploadRef: React.RefObject<HTMLInputElement | null>;
  handleUploadTreatmentImageClick: (project: string, segIndex: number) => void;
  handlePostTreatmentFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

/**
 * Assemble every server-derived report value from the loaded projects and the
 * restored Path-Analysis filter context.
 */
export function useReportData({
  loadedProjects, allProfileProjects, benchmarkVisible,
  filteredIdxByProject, filteredSegValues, activeFilterNames, activeCategoryStatus,
}: UseReportDataParams): UseReportDataResult {
  const postTreatmentUploadRef = useRef<HTMLInputElement>(null);

  const [allScoreRows, setAllScoreRows] = useState<TopRiskRow[]>([]);
  const [enrichedMap, setEnrichedMap] = useState<Map<string, EnrichedDetail>>(new Map());
  const [isLoadingScores, setIsLoadingScores] = useState(false);

  const [networkScoreRows, setNetworkScoreRows] = useState<TopRiskRow[] | null>(null);
  const [isLoadingNetworkData, setIsLoadingNetworkData] = useState(false);

  const [treatmentSummaries, setTreatmentSummaries] = useState<ProjectTreatmentSummary[]>([]);
  const [segmentTreatmentMap, setSegmentTreatmentMap] = useState<Map<string, number[]>>(new Map());
  const [uploadingSegment, setUploadingSegment] = useState<{ project: string; segIndex: number } | null>(null);

  const [projectMeta, setProjectMeta] = useState<Record<string, { dateCreated?: string; lastUpdated?: string; lengthKm?: number }>>({});
  const [projectImageDates, setProjectImageDates] = useState<Record<string, { earliest: string; latest: string }>>({});
  const [imageDatesLoading, setImageDatesLoading] = useState(false);

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
    if (!benchmarkVisible || networkScoreRows !== null || allProfileProjects.length === 0) return;
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
  }, [benchmarkVisible, allProfileProjects, networkScoreRows]);

  // ── Datasets: full vs. Path-Analysis-filtered subset ──────────────────────
  // The filtered rows are `allScoreRows` restricted to the persisted per-project
  // 0-based indices (`_segIndex` is 1-based, hence -1).
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

  const getEnriched = useCallback((row: TopRiskRow): EnrichedDetail => {
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
  }, [enrichedMap]);
  const getSegmentTreatments = useCallback((row: TopRiskRow): number[] =>
    segmentTreatmentMap.get(`${row._project}_${row._segIndex}`) ?? [], [segmentTreatmentMap]);

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
  const handleUploadTreatmentImageClick = useCallback((project: string, segIndex: number) => {
    setUploadingSegment({ project, segIndex });
    postTreatmentUploadRef.current?.click();
  }, []);

  const handlePostTreatmentFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [uploadingSegment]);

  return {
    fullDataset, filteredDataset, networkDataset, treatmentSummaries,
    quarterData, projectQuarterLabel, projectMeta, projectImageDates,
    imageDatesLoading, isLoadingScores, isLoadingNetworkData,
    getEnriched, getSegmentTreatments, buildMapColorMap,
    postTreatmentUploadRef, handleUploadTreatmentImageClick, handlePostTreatmentFileChange,
  };
}
