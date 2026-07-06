import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { COLOR } from "../../../features/ui/designTokens";
import { Box, Text, Tabs, Button, Flex, Portal, Dialog } from "@chakra-ui/react";
import { toaster } from "../../../components/ui/toaster";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polygon as LeafletPolygon, Polyline as LeafletPolyline, Pane, ZoomControl } from "react-leaflet";
import { NUMERIC_FILTER_ATTRIBUTES, ATTRIBUTE_OPTIONS, ATTRIBUTE_LABELS, getCategoryColor, CATEGORY_COLORS, SUBCATEGORY_MAP, MULTI_VALUE_ATTRS } from "./AttributesDropdown";
import { AddSegmentsDialog } from "./AddSegmentsDialog";
import { MapCursorController } from "../../../components/common/MapCursorController";
import { AnalysisSidebar } from "../../../components/visualization/AnalysisSidebar";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { Feature, LineString } from "geojson";
import { to4326 } from "../../../utils/projection";
import { PolygonDrawingTool } from "../../../components/map/PolygonDrawing";
import { isPointInPolygon } from "../../../components/map/polygonUtils";
import { calculateScore, downloadFilteredImages, exportShapefile, deleteSegment, deleteSegmentsBatch, type CodingFilterContext, type FilteredProjectData } from "../../../api";
import { getCachedGeoJSON, getCachedAttributes, getCachedResults, invalidateProject, invalidateAll } from "../../../api/projectDataCache";
import { PROJECT_POINT_COLORS, CATEGORY_UNKNOWN_COLOR, MAP_INTERACTION_COLORS } from "../../../constants/mapColors";
import { SESSION_KEYS, LOCAL_KEYS, CODING_FILTER_CONTEXT_KEY } from "../../../constants/sessionKeys";
import {
  SAFETY_FOCUS_ATTRIBUTES,
  compareByOrder,
  getSemanticCategoryOrder,
  escapeCSV,
  type ProjectData,
  type VisibleSegment,
} from "./mapView/mapViewUtils";
import {
  PanToBounds,
  FitBounds,
  ViewportWatcher,
  ViewportPersister,
  MapInvalidateSize,
  MaybePortal,
} from "./mapView/leafletHelpers";
import { useViewportPersistence } from "./mapView/useViewportPersistence";
import { useFilterState } from "./mapView/useFilterState";
import { useAttributeText } from "./mapView/useAttributeText";
import { useGISLayerToggles } from "./mapView/useGISLayerToggles";
import { useImportedShapefile } from "./mapView/useImportedShapefile";
import { GISLayerOverlays } from "./mapView/GISLayerOverlays";
import { MapFiltersPanel } from "./mapView/MapFiltersPanel";
import { SegmentsTableTab } from "./mapView/SegmentsTableTab";
import { MapViewToolbar } from "./mapView/MapViewToolbar";

interface AttributeAnalysisMapViewProps {
  selectedProjects: string[];
  selectedAttributes: string[];
  onChartDataUpdate?: (data: {
    categoryDistributionData: { category: string; count: number; color: string }[];
    primaryFocusAttribute: string | null;
    categoryStatus: {
      attribute: string;
      categories: {
        category: string;
        isActive: boolean;
        color: string;
        subcategories?: { name: string; isActive: boolean; color: string }[];
      }[];
      rangeFilter?: { min: number; max: number; currentMin: number; currentMax: number };
    }[];
    totalSegmentsLoaded: number;
    totalSegmentsViewed: number;
  }) => void;
  onVisibleSegmentsChange?: (byProject: Record<string, number[]>) => void;
  loadedProjects: string[];
  hiddenProjects: string[];
  onHiddenProjectsChange: (hidden: string[]) => void;
  /** "v2" applies the redesigned chrome (comp Frame 3 "Map Block"). */
  variant?: "v1" | "v2";
  /**
   * v2 only — a DOM node (the left "Current Filters" accordion body) into which
   * the project / category-toggle UI is portalled. The map view keeps owning the
   * toggle state; only the rendered controls move. Null until the accordion's
   * body mounts; while null the controls simply aren't shown (filters still apply).
   */
  filtersPortalTarget?: HTMLElement | null;
}


export default function AttributeAnalysisMapView({
  selectedProjects,
  selectedAttributes,
  onChartDataUpdate,
  onVisibleSegmentsChange,
  loadedProjects,
  hiddenProjects,
  onHiddenProjectsChange,
  variant = "v1",
  filtersPortalTarget,
}: AttributeAnalysisMapViewProps) {
  const isV2 = variant === "v2";
  const navigate = useNavigate();
  // v2: a "Generate Report" button sits beside the Download dropdown (ported from
  // the v1 sidebar).
  const hasSavedReport = useMemo(() => {
    try { return !!localStorage.getItem(LOCAL_KEYS.REPORT_LAYOUT); } catch { return false; }
  }, []);
  // v2: the polygon / single-select tools move off the top bar into a floating
  // cluster over the map (mirrors Coding). This host is that overlay; the tools
  // portal into it. Null until it mounts (then they simply aren't shown).
  const [toolsHost, setToolsHost] = useState<HTMLElement | null>(null);
  const toolsHostRef = useCallback((n: HTMLDivElement | null) => setToolsHost(n), []);
  const [activeTab, setActiveTab] = useState<string>("map");
  const [projectsData, setProjectsData] = useState<ProjectData[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [panToBounds, setPanToBounds] = useState<L.LatLngBounds | null>(null);

  // Single canvas renderer shared by all CircleMarkers — avoids creating hundreds of
  // SVG DOM elements and dramatically reduces paint time with large project sets.
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

  // Separate canvas renderer for GIS overlay layers. Large padding (0.5 = 50% on each
  // side) prevents features near the viewport edge from disappearing during pan/zoom
  // when the canvas has not yet re-rendered for the new position.
  const gisCanvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

  // Track live map viewport so we can cull off-screen markers before React touches them.
  const [mapViewportBounds, setMapViewportBounds] = useState<L.LatLngBounds | null>(null);

  // Persisted viewport restore: seeds the map's initial center/zoom and lets the
  // data-load effect skip the auto-fit when returning from the Coding page.
  const { savedViewport, initialCenter, initialZoom } = useViewportPersistence();
  // Filter / focus / toggle state (sessionStorage-backed) + attribute mappings.
  const {
    attrMappings,
    categoryToggles, setCategoryToggles,
    subcategoryToggles, setSubcategoryToggles,
    rangeFilters, setRangeFilters,
    categoryFilterAttributeIndex, setCategoryFilterAttributeIndex,
    primaryFocusAttribute, setPrimaryFocusAttribute,
    activeFilters,
    categoryFilterAttribute,
  } = useFilterState(selectedAttributes);

  // Track if we should auto-fit bounds (only on initial project load, not on category changes)
  const [shouldAutoFit, setShouldAutoFit] = useState(false);

  // Imported boundary shapefile overlay (state + upload/clear handlers).
  const {
    importedBoundaries,
    importedBoundaryName,
    importedBoundaryLoading,
    importedBoundaryError,
    handleImportFiles,
    handleClearImportedShapefile,
  } = useImportedShapefile();

  // gisLayerColors / PROJECT_POINT_COLORS now live in constants/mapColors.ts
  // (imported above) — single source shared with AnalysisSidebar.

  // GIS layer toggles + overlay fetches live in useGISLayerToggles, called
  // after `gisQueryPoints` is computed (the near-segments fetch is data-driven,
  // within a radius of every loaded segment, rather than viewport-driven).

  // Mode states (Single Point & Polygon)
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [isPointAddMode, setIsPointAddMode] = useState(false);
  const [isPolygonMode, setIsPolygonMode] = useState(false);
  const [isPolygonAddMode, setIsPolygonAddMode] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);

  // Selection states
  const [segmentToDelete, setSegmentToDelete] = useState<{ projectName: string; index: number } | null>(null);
  const [segmentsToDelete, setSegmentsToDelete] = useState<{ projectName: string; index: number }[]>([]);
  const [segmentToAdd, setSegmentToAdd] = useState<{ projectName: string; index: number } | null>(null);
  const [segmentsToAdd, setSegmentsToAdd] = useState<{ projectName: string; indices: number[] }[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  // Dialog states
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [isAddSegmentsDialogOpen, setIsAddSegmentsDialogOpen] = useState(false);

  // Table filtering and sorting state
  const [globalSearch, setGlobalSearch] = useState<string>("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [sortConfig, setSortConfig] = useState<Array<{ column: string; direction: 'asc' | 'desc' }>>([]);

  // Handlers for Polygon Tool
  const handlePolygonPoint = (latlng: [number, number]) => {
    setPolygonPoints((prev) => [...prev, latlng]);
  };

  const handlePointUpdate = useCallback((index: number, latlng: [number, number]) => {
    setPolygonPoints((prev) => {
      const newPoints = [...prev];
      newPoints[index] = latlng;
      return newPoints;
    });
  }, []);

  const finishPolygonSelection = () => {
    console.log("finishPolygonSelection called");
    if (polygonPoints.length < 3) {
      toaster.create({ title: "Invalid Polygon", description: "Please select at least 3 points.", type: "error" });
      return;
    }

    // Identify points inside polygon
    const toDelete: { projectName: string; index: number }[] = [];

    // Iterate through all visible points (allPoints)
    // Note: This operates on the *filtered* view if we use filteredData, or all loaded points if we use allPoints.
    // Usually, users expect to delete what they see. Let's use allPoints to be safe, or filteredData? 
    // Given the visual nature, 'allPoints' corresponds to what's loaded. 
    // But if 'filteredData' is used for display, we should probably stick to visible points?
    // Let's us 'allPoints' but check if they are visible? Or simplified: just check all loaded points.
    // The user draws on the map, so they select geographically. 

    allPoints.forEach((pt) => {
      // pt.latlng is [lat, lon]
      if (isPointInPolygon(pt.latlng, polygonPoints)) {
        toDelete.push({ projectName: pt.projectName, index: pt.idx });
      }
    });

    if (toDelete.length === 0) {
      toaster.create({ title: "No points selected", description: "No points found inside the drawn polygon.", type: "info" });
      setPolygonPoints([]); // Reset
      return;
    }

    setSegmentsToDelete(toDelete);
    setDeleteConfirmationOpen(true);
  };

  const handleBatchDelete = async () => {
    if (segmentsToDelete.length === 0) return;
    setIsDeleting(true);

    try {
      // Group by project
      const byProject: Record<string, number[]> = {};
      segmentsToDelete.forEach(({ projectName, index }) => {
        if (!byProject[projectName]) byProject[projectName] = [];
        byProject[projectName].push(index);
      });

      // Execute batch delete for each project
      await Promise.all(
        Object.entries(byProject).map(async ([project, indices]) => {
          await deleteSegmentsBatch(project, indices);
        })
      );

      toaster.create({ title: "Batch Delete Successful", description: `Deleted ${segmentsToDelete.length} segments.`, type: "success" });

      // Drop cached geodata/attributes/results for the edited projects so the
      // forced reload below fetches fresh data instead of the pre-delete cache.
      Object.keys(byProject).forEach((project) => invalidateProject(project));

      // Cleanup UI
      setSegmentsToDelete([]);
      setPolygonPoints([]);
      setDeleteConfirmationOpen(false);
      setIsPolygonMode(false); // Optimize: exit mode or stay? Usually exit.

      // Refresh data
      // For simplicity, re-trigger the data fetch by toggling a dependency or calling a refresh function.
      // Since 'selectedProjects' is a dependency of the main useEffect, we can just force a re-run?
      // Or better: clear projectsData and it will reload because selectedProjects hasn't changed? 
      // Actually, if we just setProjectsData([]) it might show empty. 
      // We can create a refresh trigger state.
      setRefreshTrigger(prev => prev + 1);

      // Dispatch event to update charts (AggregatedScoreBandPanel)
      window.dispatchEvent(new Event("psat:scores:updated"));

    } catch (e: any) {
      toaster.create({ title: "Deletion Failed", description: e.message, type: "error" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteSegment = async () => {
    if (!segmentToDelete) return;
    setIsDeleting(true);
    try {
      await deleteSegment(segmentToDelete.projectName, segmentToDelete.index);
      toaster.create({ title: "Segment Deleted", type: "success" });
      // Drop cached data for the edited project so the reload fetches fresh data.
      invalidateProject(segmentToDelete.projectName);
      setSegmentToDelete(null);
      setDeleteConfirmationOpen(false);
      setRefreshTrigger(prev => prev + 1);

      // Dispatch event to update charts (AggregatedScoreBandPanel)
      window.dispatchEvent(new Event("psat:scores:updated"));
    } catch (e: any) {
      toaster.create({ title: "Deletion Failed", description: e.message, type: "error" });
    } finally {
      setIsDeleting(false);
    }
  };

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Helper function to get Overall Risk Score for a segment
  // Uses the "Overall Risk Level" field from the backend, which is the sum of BB + BP + SB + VB
  const getOverallRiskScore = (projectDataIndex: number, segmentIndex: number): number => {
    if (projectDataIndex >= projectsData.length || !projectsData[projectDataIndex].scores) {
      return 0;
    }
    const segmentScores = projectsData[projectDataIndex].scores[segmentIndex];
    if (!segmentScores) {
      return 0;
    }
    // Use the "Overall Risk Level" field which is the actual CycleRAP composite score
    const overallRiskLevel = segmentScores["Overall Risk Level"];
    return typeof overallRiskLevel === 'number' ? overallRiskLevel : 0;
  };

  // Define table columns
  const tableColumns = useMemo(() => {
    // The filter/toggle attribute columns (+ any subcategory child columns).
    const attrCols: { key: string; label: string }[] = [];
    for (const attr of activeFilters) {
      attrCols.push({ key: attr, label: ATTRIBUTE_LABELS[attr] ?? attr });
      const subcat = SUBCATEGORY_MAP[attr];
      if (subcat) {
        const childAttr = subcat.childAttr;
        attrCols.push({ key: childAttr, label: ATTRIBUTE_LABELS[childAttr] ?? childAttr });
      }
    }
    if (isV2) {
      // v2 order: Project Name, Segment No., Overall Risk Score, Coordinates,
      // then the toggle attributes, then Image Reference last (it's long).
      return [
        { key: "Project", label: "Project Name" },
        { key: "Segment #", label: "Segment No." },
        { key: "Overall Risk Score", label: "Overall Risk Score" },
        { key: "Coordinates", label: "Coordinates" },
        ...attrCols,
        { key: "Image Reference", label: "Image Reference" },
      ];
    }
    // v1 order (unchanged).
    return [
      { key: "Project", label: "Project" },
      { key: "Segment #", label: "Segment #" },
      { key: "Image Reference", label: "Image Reference" },
      { key: "Coordinates", label: "Coordinates" },
      ...attrCols,
      { key: "Overall Risk Score", label: "Overall Risk Score" },
    ];
  }, [activeFilters, isV2]);


  // Attribute code → display/filter text derivation (memoised callbacks).
  const {
    getAttrText,
    getFilterAttributeText,
    getFocusedAttributeValue,
  } = useAttributeText(attrMappings, subcategoryToggles);


  // Generate distinct colors for each project
  const projectColors = useMemo(() => {
    const colors = PROJECT_POINT_COLORS;
    const colorMap: Record<string, string> = {};
    loadedProjects.forEach((proj, idx) => {
      colorMap[proj] = colors[idx % colors.length];
    });
    return colorMap;
  }, [loadedProjects]);

  // Load geodata and attributes for all selected projects
  useEffect(() => {
    if (selectedProjects.length === 0) {
      setProjectsData([]);
      return;
    }

    let aborted = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const promises = selectedProjects.map(async (projectName) => {
          // Fetch geodata and attributes (required). Served from the shared
          // session cache so back-navigation from the Coding page is instant.
          const [geoJson, attrResponse] = await Promise.all([
            getCachedGeoJSON(projectName),
            getCachedAttributes(projectName),
          ]);

          // Fetch scores (optional - if fails, continue with empty scores).
          // Prefer the cached read-only GET /results (no recompute, no disk write).
          // Only fall back to POST /score (which computes + persists) when the
          // project has never been scored yet.
          let scores: Record<string, any>[] = [];
          try {
            const resultsResponse = await getCachedResults(projectName);
            scores = resultsResponse.result_rows || [];
          } catch (e) {
          }
          // Only compute+persist (the expensive POST) if no cached results exist.
          if (scores.length === 0) {
            try {
              const scoresResponse = await calculateScore(projectName);
              scores = scoresResponse.result_rows || [];
            } catch (e) {
            }
          }

          return {
            projectName,
            geoFeatures: geoJson.features as Feature<LineString, any>[],
            attributes: attrResponse.rows,
            scores: scores,
            color: projectColors[projectName],
          };
        });

        const results = await Promise.all(promises);
        if (!aborted) {
          setProjectsData(results);
          // Auto-fit only on a fresh load. When returning from the Coding page a
          // saved viewport exists, so keep the user's previous pan/zoom instead.
          if (!savedViewport.current) {
            setShouldAutoFit(true);
            // Reset after a short delay to allow the fit to happen
            setTimeout(() => setShouldAutoFit(false), 500);
          }
        }
      } catch (e: any) {
        if (!aborted) setErr(e?.message ?? "Failed to load data");
      } finally {
        if (!aborted) setLoading(false);
      }
    })();

    return () => { aborted = true; };
  }, [selectedProjects, projectColors, refreshTrigger]);

  // O(1) lookup of a project's index in projectsData by name (avoids per-cell findIndex)
  const projectIndexByName = useMemo(() => {
    const map: Record<string, number> = {};
    projectsData.forEach((p, i) => { map[p.projectName] = i; });
    return map;
  }, [projectsData]);

  // Helper function to get column value as string
  function getColumnValue(point: any, columnKey: string): string {
    if (columnKey === "Project") return point.projectName;
    if (columnKey === "Segment #") return (point.idx + 1).toString();
    if (columnKey === "Image Reference") return point.f.properties?.["Image Reference"] ?? "-";
    if (columnKey === "Coordinates") return `${point.latlng[0].toFixed(6)}, ${point.latlng[1].toFixed(6)}`;
    if (columnKey === "Overall Risk Score") {
      const projectDataIndex = projectIndexByName[point.projectName] ?? -1;
      const score = getOverallRiskScore(projectDataIndex, point.idx);
      return score.toFixed(2);
    }
    if (columnKey === "Overall Risk Level") {
      const projectDataIndex = projectIndexByName[point.projectName] ?? -1;
      if (projectDataIndex < 0 || !projectsData[projectDataIndex].scores) {
        return "Low";
      }

      const segmentScores = projectsData[projectDataIndex].scores[point.idx];
      if (!segmentScores) {
        return "Low";
      }

      // Overall Risk Level = maximum category from the individual crash type bands
      // (same logic as Coding Page)
      let maxRiskLevel = 0; // 0: Low, 1: Med, 2: High, 3: Extreme

      // Optimize: If backend sends "Overall Risk Level Band", use it directly (1-4)
      if (segmentScores["Overall Risk Level Band"] !== undefined) {
        // Backend 1=Low (0), 2=Med (1), 3=High (2), 4=Extreme (3)
        maxRiskLevel = (segmentScores["Overall Risk Level Band"] as number) - 1;
      }

      if (maxRiskLevel === 3) return "Extreme";
      else if (maxRiskLevel === 2) return "High";
      else if (maxRiskLevel === 1) return "Medium";
      else return "Low";
    }

    // Dynamic attribute columns
    if (!point.attributes) return "-";
    const attrValue = point.attributes[columnKey];
    const result = getAttrText(columnKey, attrValue) || "-";

    return result;
  }

  // Compute actual min/max from data for each numeric filter attribute
  // Compute actual min/max from data for each numeric filter attribute (for sidebar slider bounds)
  const dataRangeBounds = useMemo(() => {
    const bounds: Record<string, { min: number; max: number }> = {};
    NUMERIC_FILTER_ATTRIBUTES.forEach(attr => {
      let min = Infinity;
      let max = -Infinity;
      projectsData.forEach(pd => {
        pd.attributes.forEach(row => {
          if (!row) return;
          const v = Number(row[attr]);
          if (!isNaN(v)) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
        });
      });
      bounds[attr] = {
        min: isFinite(min) ? min : 0,
        max: isFinite(max) ? max : 100,
      };
    });
    return bounds;
  }, [projectsData]);

  const visibleSegments = useMemo(() => {
    const segments: VisibleSegment[] = [];

    // Filtering (getFilterAttributeText) and focus coloring (getCategoryColor) both rely on
    // attrMappings to turn numeric attribute codes into the text labels that categoryToggles
    // and the colour maps are keyed by. If mappings aren't ready yet (cold module cache after
    // a multi-page round-trip), every segment's value is an unmatched code → nothing gets
    // filtered out and nothing gets a category colour, producing a one-frame flash of ALL
    // segments rendered grey. When mappings are required but not ready, render nothing for
    // that frame instead (a brief blank is far less jarring than "irrelevant grey segments").
    const mappingsReady = Object.keys(attrMappings).length > 0;
    const needsMappings =
      activeFilters.length > 0 || (!!primaryFocusAttribute && primaryFocusAttribute !== "Project");
    if (needsMappings && !mappingsReady) return segments;

    projectsData.forEach((projectData) => {
      projectData.geoFeatures.forEach((feature, i) => {
        const g = feature.geometry;
        if (g?.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length > 0) {
          // Get the corresponding attributes for this feature (by index)
          const attributes = projectData.attributes[i];

          if (attributes) {
            const segmentScores = projectData.scores?.[i] ?? null;

            // Simple check: Does this segment have all active filter attributes with values?
            let matchesAllFilters = true;
            for (const filterAttr of activeFilters) {
              // Numeric range filter (Road AADT, Road operating speed)
              if (NUMERIC_FILTER_ATTRIBUTES.has(filterAttr)) {
                const numVal = Number(attributes[filterAttr]);
                const bounds = dataRangeBounds[filterAttr];
                const [rMin, rMax] = rangeFilters[filterAttr] ?? [bounds?.min ?? 0, bounds?.max ?? 100];
                if (isNaN(numVal) || numVal < rMin || numVal > rMax) {
                  matchesAllFilters = false;
                  break;
                }
                continue;
              }

              const attrValueText = getFilterAttributeText(filterAttr, projectData.projectName, attributes, segmentScores);

              if (!attrValueText || attrValueText === "Not Selected") {
                matchesAllFilters = false;
                break;
              }

              // Check category toggles
              if (categoryToggles[filterAttr]) {
                if (categoryToggles[filterAttr][attrValueText] === false) {
                  matchesAllFilters = false;
                  break;
                }
              }

              // Check subcategory toggles (Layer 3)
              const subcatConfig = SUBCATEGORY_MAP[filterAttr];
              if (subcatConfig) {
                const childOptions = subcatConfig.parentCategories[attrValueText];
                if (childOptions && subcategoryToggles[subcatConfig.childAttr]) {
                  const childValue = getFilterAttributeText(subcatConfig.childAttr, projectData.projectName, attributes, segmentScores);
                  if (childValue) {
                    const childToggles = subcategoryToggles[subcatConfig.childAttr];
                    if (MULTI_VALUE_ATTRS.has(subcatConfig.childAttr) && childValue.includes(", ")) {
                      const parts = childValue.split(", ").map((s: string) => s.trim());
                      // Unknown values (not in predefined toggle set) proxy through "Others"
                      const anyEnabled = parts.some((part: string) => {
                        const effectiveVal = part in childToggles ? childToggles[part] : childToggles["Others"];
                        return effectiveVal !== false;
                      });
                      if (!anyEnabled) {
                        matchesAllFilters = false;
                        break;
                      }
                    } else {
                      // Unknown single value proxies through "Others"
                      const effectiveVal = childValue in childToggles ? childToggles[childValue] : childToggles["Others"];
                      if (effectiveVal === false) {
                        matchesAllFilters = false;
                        break;
                      }
                    }
                  }
                }
              }
            }

            if (!matchesAllFilters) {
              return;
            }

            segments.push({
              idx: i,
              latlng: to4326(g.coordinates[0]),
              f: feature,
              attributes,
              projectName: projectData.projectName,
              projectColor: projectData.color,
              scores: segmentScores,
            });
          }
        }
      });
    });

    return segments;
  }, [projectsData, activeFilters, categoryToggles, subcategoryToggles, rangeFilters, dataRangeBounds, getFilterAttributeText, attrMappings, primaryFocusAttribute]);

  // Per-project map of visible (filtered) segment indices. Indices are 0-based and
  // match geoFeatures/attributes/scores order, so the Top Risk Contributors panel can
  // slice /results result_rows by these indices to aggregate only surviving segments.
  const visibleSegmentIndicesByProject = useMemo(() => {
    const byProject: Record<string, number[]> = {};
    visibleSegments.forEach((s) => {
      (byProject[s.projectName] ??= []).push(s.idx);
    });
    return byProject;
  }, [visibleSegments]);

  // Lift the visible-segment index map up to the parent so sibling panels (Top Risk
  // Contributors) can react to filters.
  useEffect(() => {
    onVisibleSegmentsChange?.(visibleSegmentIndicesByProject);
  }, [visibleSegmentIndicesByProject, onVisibleSegmentsChange]);

  // ── Persist the filtered segment set for the Report Builder ───────────────
  // The Report Builder reads "pathAnalysis_filteredSegments" to render a second
  // set of report sections reflecting exactly what the user filtered here.
  // Filtering only narrows when activeFilters is non-empty, so an empty filter
  // removes the key (which disables the Report Builder's filtered-sections
  // toggle). Indices are 0-based, matching geoFeatures/attributes/scores order.
  useEffect(() => {
    if (activeFilters.length === 0) {
      sessionStorage.removeItem(SESSION_KEYS.PA_FILTERED_SEGMENTS);
      sessionStorage.removeItem(SESSION_KEYS.PA_FILTERED_SEGMENT_VALUES);
      return;
    }
    // Per active-filter attribute, the resolved category VALUE for each filtered
    // segment — so the Report Builder's "Map (Filtered)" can recolour by any of
    // the user's filter attributes. The Report Builder maps each value to a
    // colour via the same `categoryStatus` it already displays, guaranteeing the
    // map matches the legend.
    const valuesByProject: Record<string, Record<number, Record<string, string>>> = {};
    visibleSegments.forEach((s) => {
      const segVals: Record<string, string> = {};
      activeFilters.forEach((attr) => {
        segVals[attr] = attr === "Project" ? s.projectName : getFocusedAttributeValue(attr, s);
        // Also capture the Level-3 (sub-category) value, so the Report Builder can
        // colour by secondary categories (e.g. "FO Type" under "Fixed Obstacle on
        // Facility") when the parent collapses to a single category.
        const sub = SUBCATEGORY_MAP[attr];
        if (sub) {
          const childVal = getFocusedAttributeValue(sub.childAttr, s);
          if (childVal && childVal !== "None") segVals[`${attr}__child`] = childVal;
        }
      });
      (valuesByProject[s.projectName] ??= {})[s.idx] = segVals;
    });
    sessionStorage.setItem(SESSION_KEYS.PA_FILTERED_SEGMENTS, JSON.stringify(visibleSegmentIndicesByProject));
    sessionStorage.setItem(SESSION_KEYS.PA_FILTERED_SEGMENT_VALUES, JSON.stringify(valuesByProject));
  }, [visibleSegments, visibleSegmentIndicesByProject, activeFilters, getFocusedAttributeValue]);

  const effectiveFocusAttribute = useMemo(() => {
    if (!primaryFocusAttribute) {
      return null;
    }

    if (primaryFocusAttribute === "Project") {
      return primaryFocusAttribute;
    }

    const subcatConfig = SUBCATEGORY_MAP[primaryFocusAttribute];
    if (!subcatConfig || visibleSegments.length === 0) {
      return primaryFocusAttribute;
    }

    const visibleParentCategories = new Set<string>();
    visibleSegments.forEach((segment) => {
      const parentValue = getFocusedAttributeValue(primaryFocusAttribute, segment);
      if (parentValue) {
        visibleParentCategories.add(parentValue);
      }
    });

    // Determine remaining Level-2 categories from the real visible values and current toggles,
    // rather than only SUBCATEGORY_MAP keys. This keeps legacy/non-mapped values from
    // incorrectly collapsing focus to Level 3.
    const remainingParentCategories = Array.from(visibleParentCategories).filter(
      (parentCategory) => categoryToggles[primaryFocusAttribute]?.[parentCategory] !== false,
    );

    if (remainingParentCategories.length !== 1) {
      return primaryFocusAttribute;
    }

    const [remainingParentCategory] = remainingParentCategories;
    const childOptions = subcatConfig.parentCategories[remainingParentCategory];
    if (!childOptions?.length) {
      return primaryFocusAttribute;
    }

    const hasChildValues = visibleSegments.some((segment) => {
      const parentValue = getFocusedAttributeValue(primaryFocusAttribute, segment);
      if (parentValue !== remainingParentCategory) {
        return false;
      }

      const childValue = getFocusedAttributeValue(subcatConfig.childAttr, segment);
      return !!childValue && childValue !== "None";
    });

    return hasChildValues ? subcatConfig.childAttr : primaryFocusAttribute;
  }, [categoryToggles, getFocusedAttributeValue, primaryFocusAttribute, visibleSegments]);

  // Generate colors for attribute categories based on the effective focus level.
  // Colors come from CATEGORY_COLORS (AttributesDropdown) — the single source
  // shared with getCategoryColor and the filter pills.
  const attributeCategoryColors = useMemo(() => {
    if (!effectiveFocusAttribute) return {};

    const attributeColors = CATEGORY_COLORS[effectiveFocusAttribute];
    if (typeof attributeColors === "object" && attributeColors !== null) {
      return attributeColors as Record<string, string>;
    }

    if (SAFETY_FOCUS_ATTRIBUTES.has(effectiveFocusAttribute || "")) {
      return {
        "Low": CATEGORY_COLORS["Low"] as string,
        "Medium": CATEGORY_COLORS["Medium"] as string,
        "High": CATEGORY_COLORS["High"] as string,
        "Extreme": CATEGORY_COLORS["Extreme"] as string,
      };
    }

    return {} as Record<string, string>;
  }, [effectiveFocusAttribute]);

  // Extract visible points and then color them using the deepest surviving focus attribute.
  const allPoints = useMemo(() => {
    const focusAttribute = effectiveFocusAttribute ?? "Project";

    return visibleSegments.map((segment) => {
      const attributeValue = getFocusedAttributeValue(focusAttribute, segment);
      // Segments with no meaningful value for the focused attribute would otherwise
      // resolve to the grey "unknown" fallback (#6B7280). This happens e.g. when
      // focus drills to a child like "FO Type" but a segment has no coded type
      // ("None"), leaving the map a sea of indistinguishable grey. Fall back to the
      // project color so those segments stay visible and distinguishable.
      const hasFocusValue = attributeValue && attributeValue !== "None" && attributeValue !== "Not Selected";
      const color = focusAttribute === "Project" || !hasFocusValue
        ? segment.projectColor
        : getCategoryColor(focusAttribute, attributeValue);

      return {
        idx: segment.idx,
        latlng: segment.latlng,
        f: segment.f,
        attributes: segment.attributes,
        projectName: segment.projectName,
        color,
        attributeValue,
      };
    });
  }, [effectiveFocusAttribute, getFocusedAttributeValue, visibleSegments]);

  const allLatLngs = useMemo(() => allPoints.map(p => p.latlng), [allPoints]);

  // Unique, thinned segment coordinates ([lon, lat]) used as the centres for the GIS
  // proximity query. Snapping to a ~110 m grid and de-duplicating keeps a dense project
  // from sending tens of thousands of essentially-overlapping query points; the 200 m
  // buffer around each kept point still covers everything in between.
  const gisQueryPoints = useMemo(() => {
    const seen = new Set<string>();
    const pts: [number, number][] = [];
    for (const { latlng } of allPoints) {
      const [lat, lng] = latlng;
      const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push([lng, lat]); // API expects [lon, lat]
    }
    return pts;
  }, [allPoints]);

  // GIS overlay layer toggles + debounced near-segments / defects fetches.
  const {
    isGisSidebarOpen, setIsGisSidebarOpen,
    gisLayers,
    pathDefects,
    showFootpath, setShowFootpath,
    showCycling, setShowCycling,
    showShared, setShowShared,
    showRoadcrossing, setShowRoadcrossing,
    showMrtExit, setShowMrtExit,
    showBusStop, setShowBusStop,
    showBusLane, setShowBusLane,
    showParkingLot, setShowParkingLot,
    showKerbLine, setShowKerbLine,
    showBicycleCrossing, setShowBicycleCrossing,
    showPathDefects, setShowPathDefects,
    showStateLand, setShowStateLand,
    showStatBoard, setShowStatBoard,
    showLandPrivate, setShowLandPrivate,
    showLandMinistry, setShowLandMinistry,
  } = useGISLayerToggles({ gisQueryPoints, mapViewportBounds });

  // Cull off-screen markers before React renders them. A 20% padding around the
  // viewport keeps markers visible during small pans without mounting them all.
  const viewportPoints = useMemo(() => {
    if (!mapViewportBounds) return allPoints;
    const sw = mapViewportBounds.getSouthWest();
    const ne = mapViewportBounds.getNorthEast();
    const latPad = (ne.lat - sw.lat) * 0.2;
    const lngPad = (ne.lng - sw.lng) * 0.2;
    return allPoints.filter(({ latlng }) => {
      const [lat, lng] = latlng;
      return lat >= sw.lat - latPad && lat <= ne.lat + latPad &&
        lng >= sw.lng - lngPad && lng <= ne.lng + lngPad;
    });
  }, [allPoints, mapViewportBounds]);

  // Filter data with global search and per-column filters
  const filteredData = useMemo(() => {
    let result = allPoints;

    // Apply global search (OR across all columns)
    if (globalSearch.trim()) {
      const searchLower = globalSearch.toLowerCase().trim();
      result = result.filter(point => {
        return tableColumns.some(col => {
          const value = getColumnValue(point, col.key).toLowerCase();
          return value.includes(searchLower);
        });
      });
    }

    // Apply per-column filters (AND logic)
    Object.entries(columnFilters).forEach(([columnKey, filterValue]) => {
      if (filterValue.trim()) {
        const filterLower = filterValue.toLowerCase().trim();

        result = result.filter(point => {
          const value = getColumnValue(point, columnKey).toLowerCase();

          let matches = false;

          // Special handling for Facility Width per Direction - strict prefix match
          // This prevents "Very Narrow" from showing up when filtering for "Narrow" (starts with 'n')
          if (columnKey === "Facility Width per Direction") {
            matches = value.startsWith(filterLower);
          }
          // Special handling for Present/Not Present attributes
          else if (value === "present" || value === "not present") {
            // For Present/Not Present: use first-character matching
            if (!filterLower) {
              matches = true; // Empty filter shows all
            } else if (filterLower[0] === 'p') {
              matches = value === "present"; // 'p' matches only "present"
            } else if (filterLower[0] === 'n') {
              matches = value === "not present"; // 'n' matches only "not present"
            } else {
              matches = false; // Other characters don't match
            }
          } else {
            // For other attributes, use word-boundary matching
            if (value === filterLower) {
              matches = true; // Exact match
            } else if (value.startsWith(filterLower)) {
              matches = true; // Prefix match
            } else if (value.includes(` ${filterLower}`) || value.includes(`-${filterLower}`)) {
              matches = true; // Word boundary match
            }
          }

          return matches;
        });
      }
    });

    return result;
  }, [allPoints, globalSearch, columnFilters, tableColumns, projectsData, activeFilters, attrMappings]);

  // Sort data with multi-column sorting
  const sortedData = useMemo(() => {
    if (sortConfig.length === 0) return filteredData;

    return [...filteredData].sort((a, b) => {
      // Iterate through sort config in priority order
      for (const { column, direction } of sortConfig) {
        const aVal = getColumnValue(a, column);
        const bVal = getColumnValue(b, column);

        // Numeric comparison for Segment # and Overall Risk Score
        if (column === "Segment #" || column === "Overall Risk Score") {
          const aNum = parseFloat(aVal);
          const bNum = parseFloat(bVal);
          const numCompare = aNum - bNum;
          if (numCompare !== 0) {
            return direction === 'asc' ? numCompare : -numCompare;
          }
        }
        // Semantic comparison for Risk Levels (Low < Medium < High < Extreme)
        else if (column === "Overall Risk Level" || ["VB Band", "BB Band", "SB Band", "BP Band"].includes(column)) {
          const riskOrder = ["Low", "Medium", "High", "Extreme"];
          const aIndex = riskOrder.indexOf(aVal);
          const bIndex = riskOrder.indexOf(bVal);

          // If value not found (e.g. "-"), treat as lowest or handle separately
          // Here we treat unknown values as smaller than "Low"
          const aRank = aIndex === -1 ? -1 : aIndex;
          const bRank = bIndex === -1 ? -1 : bIndex;

          const rankCompare = aRank - bRank;
          if (rankCompare !== 0) {
            return direction === 'asc' ? rankCompare : -rankCompare;
          }
        }
        // Semantic comparison for Facility Width (Very Narrow < Narrow < Wide)
        else if (column === "Facility Width per Direction") {
          const widthOrder = ["Very Narrow", "Narrow", "Wide"];
          const aIndex = widthOrder.indexOf(aVal);
          const bIndex = widthOrder.indexOf(bVal);

          const aRank = aIndex === -1 ? -1 : aIndex;
          const bRank = bIndex === -1 ? -1 : bIndex;

          const rankCompare = aRank - bRank;
          if (rankCompare !== 0) {
            return direction === 'asc' ? rankCompare : -rankCompare;
          }
        }
        else {
          // String comparison for other columns
          const strCompare = aVal.localeCompare(bVal);
          if (strCompare !== 0) {
            return direction === 'asc' ? strCompare : -strCompare;
          }
        }
        // If equal, continue to next sort criterion
      }
      return 0; // All sort criteria equal
    });
  }, [filteredData, sortConfig]);

  // Get categories available in loaded data for the current sidebar attribute
  const availableCategories = useMemo(() => {
    if (!categoryFilterAttribute) return [];
    const categoriesInData = new Set<string>();

    projectsData.forEach((projectData) => {
      if (categoryFilterAttribute === "Project") {
        categoriesInData.add(projectData.projectName);
        return;
      }
      if (categoryFilterAttribute === "Overall Risk Level") {
        projectData.geoFeatures.forEach((_, i) => {
          if (projectData.scores && projectData.scores.length > i) {
            const segmentScores = projectData.scores[i];
            const bands = [
              segmentScores["VB Band"] ?? 1,
              segmentScores["BB Band"] ?? 1,
              segmentScores["SB Band"] ?? 1,
              segmentScores["BP Band"] ?? 1
            ];
            const maxBand = Math.max(...bands);
            let category = "Low";
            if (maxBand <= 1) category = "Low";
            else if (maxBand <= 2) category = "Medium";
            else if (maxBand <= 3) category = "High";
            else category = "Extreme";
            categoriesInData.add(category);
          }
        });
        return;
      }
      projectData.geoFeatures.forEach((_, i) => {
        const attributes = projectData.attributes[i];
        if (attributes) {
          const segmentScores = projectData.scores?.[i] ?? null;
          const attrValueText = getFilterAttributeText(categoryFilterAttribute, projectData.projectName, attributes, segmentScores);
          if (attrValueText) {
            // Multi-value attributes: split "Bollards, Fence" into individual categories
            if (MULTI_VALUE_ATTRS.has(categoryFilterAttribute) && attrValueText.includes(", ")) {
              attrValueText.split(", ").forEach((part: string) => categoriesInData.add(part.trim()));
            } else {
              categoriesInData.add(attrValueText);
            }
          }
        }
      });
    });

    const categories = Array.from(categoriesInData);
    const semanticOrder = getSemanticCategoryOrder(categoryFilterAttribute);
    if (semanticOrder) {
      categories.sort((a, b) => compareByOrder(a, b, semanticOrder));
    } else {
      categories.sort();
    }
    return categories;
  }, [categoryFilterAttribute, getFilterAttributeText, projectsData]);

  // Initialise / update category toggles when the sidebar attribute or its available categories change
  useEffect(() => {
    if (!categoryFilterAttribute) return;
    setCategoryToggles(prev => {
      const newToggles = { ...prev };
      if (!newToggles[categoryFilterAttribute]) newToggles[categoryFilterAttribute] = {};
      const updatedAttributeToggles: Record<string, boolean> = { ...newToggles[categoryFilterAttribute] };
      availableCategories.forEach(category => {
        if (!(category in updatedAttributeToggles)) updatedAttributeToggles[category] = true;
      });
      newToggles[categoryFilterAttribute] = updatedAttributeToggles;
      return newToggles;
    });
  }, [categoryFilterAttribute, availableCategories]);

  // Initialise subcategory toggles when the sidebar attribute has subcategories
  useEffect(() => {
    if (!categoryFilterAttribute) return;
    const subcatConfig = SUBCATEGORY_MAP[categoryFilterAttribute];
    if (!subcatConfig) return;
    setSubcategoryToggles(prev => {
      const childAttr = subcatConfig.childAttr;
      const allChildOptions = Object.values(subcatConfig.parentCategories).flat();
      if (!allChildOptions.length) return prev;
      const existing = prev[childAttr] ?? {};
      let changed = false;
      const updated = { ...existing };
      allChildOptions.forEach(opt => {
        if (!(opt in updated)) { updated[opt] = true; changed = true; }
      });
      if (!changed) return prev;
      return { ...prev, [childAttr]: updated };
    });
  }, [categoryFilterAttribute]);


  // Calculate bounds for each project based on actual geodata
  const projectBounds = useMemo(() => {
    const boundsMap: Record<string, L.LatLngBounds> = {};

    projectsData.forEach((projectData) => {
      const projectPoints: [number, number][] = [];

      projectData.geoFeatures.forEach((feature) => {
        const g = feature.geometry;
        if (g?.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length > 0) {
          projectPoints.push(to4326(g.coordinates[0]));
        }
      });

      if (projectPoints.length > 0) {
        boundsMap[projectData.projectName] = L.latLngBounds(
          projectPoints.map(([lat, lng]) => L.latLng(lat, lng))
        );
      }
    });

    return boundsMap;
  }, [projectsData]);

  const handleProjectClick = (projectName: string) => {
    const bounds = projectBounds[projectName];
    if (bounds) {
      setPanToBounds(bounds);
      // Reset after a short delay to allow re-clicking the same project
      setTimeout(() => setPanToBounds(null), 100);
    }
  };


  // Generate CSV content from sorted and filtered data
  const generateCSV = (): string => {
    const headers = tableColumns.map(col => col.label);

    const rows = sortedData.map(point => {
      return tableColumns.map(col => {
        return getColumnValue(point, col.key);
      });
    });

    const csvContent = [headers, ...rows]
      .map(row => row.map(escapeCSV).join(","))
      .join("\n");

    return csvContent;
  };

  // Download CSV file
  // Build a CodingFilterContext (per-project filtered indices + colored points + legend)
  // from the currently visible, non-hidden segments. Shared by the segment-click → Coding
  // navigation and the "Open in Treatment (filtered)" button. Returns null when no filters
  // are active (caller treats this as "no restriction").
  const buildFilterContext = (): CodingFilterContext | null => {
    if (activeFilters.length === 0) return null;

    const projectMap = new Map<string, FilteredProjectData>();
    const visiblePoints = allPoints.filter(pt => !hiddenProjects.includes(pt.projectName));
    visiblePoints.forEach(pt => {
      if (!projectMap.has(pt.projectName)) {
        projectMap.set(pt.projectName, { projectName: pt.projectName, filteredIndices: [], points: [] });
      }
      const entry = projectMap.get(pt.projectName)!;
      entry.filteredIndices.push(pt.idx);
      entry.points.push({ latlng: pt.latlng, color: pt.color, idx: pt.idx });
    });

    let legend: CodingFilterContext['legend'] | undefined;
    if (effectiveFocusAttribute && effectiveFocusAttribute !== "Project") {
      const seen = new Map<string, string>();
      visiblePoints.forEach(pt => {
        const val = pt.attributeValue;
        if (val && val !== "None" && val !== "Not Selected" && !seen.has(val)) {
          seen.set(val, pt.color);
        }
      });
      const canonical = ATTRIBUTE_OPTIONS[effectiveFocusAttribute] ?? [];
      const entries = Array.from(seen.entries())
        .map(([category, color]) => ({ category, color }))
        .sort((a, b) => {
          const ai = canonical.indexOf(a.category);
          const bi = canonical.indexOf(b.category);
          if (ai === -1 && bi === -1) return a.category.localeCompare(b.category);
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      if (entries.length > 0) legend = { attribute: effectiveFocusAttribute, entries };
    }

    return { projects: Array.from(projectMap.values()), ...(legend ? { legend } : {}) };
  };

  // Open the currently-loaded projects in the Treatment Application page, restricted to the
  // currently-filtered segments. When no filters are active, opens all segments (the
  // ?filtered=1 switch is omitted so the Treatment page applies no restriction).
  const handleOpenInTreatment = (): void => {
    if (loadedProjects.length === 0) return;
    const ctx = buildFilterContext();
    sessionStorage.setItem(SESSION_KEYS.TREATMENT_LOADED_PROJECTS, JSON.stringify(loadedProjects));
    const encoded = loadedProjects.map(name => encodeURIComponent(name)).join(',');
    if (ctx && ctx.projects.length > 0) {
      sessionStorage.setItem(SESSION_KEYS.TREATMENT_FILTER_CONTEXT, JSON.stringify(ctx));
      navigate(`/treatment/${encoded}?filtered=1`);
    } else {
      sessionStorage.removeItem(SESSION_KEYS.TREATMENT_FILTER_CONTEXT);
      navigate(`/treatment/${encoded}`);
    }
  };

  const handleDownloadCSV = (): void => {
    const csvContent = generateCSV();
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `project_analysis-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Download Filtered Images
  const handleDownloadImages = async () => {
    try {
      // 1. Collect images from sortedData (filtered)
      const projectImages: Record<string, string[]> = {};

      sortedData.forEach(point => {
        const projectName = point.projectName;
        const imageRef = point.f.properties?.["Image Reference"];

        // Skip if no image reference or placeholder
        if (projectName && imageRef && imageRef !== "-" && imageRef !== "None" && imageRef !== "") {
          if (!projectImages[projectName]) {
            projectImages[projectName] = [];
          }
          projectImages[projectName].push(imageRef);
        }
      });

      // Check if we have any images
      const totalImages = Object.values(projectImages).reduce((acc, list) => acc + list.length, 0);
      if (totalImages === 0) {
        alert("No images found in the current filtered selection.");
        return;
      }

      // 2. Call API
      // Show loading indicator usually, but for now just await
      // You might want to set loading=true if you have a global loading state or local one
      const blob = await downloadFilteredImages({ projects: projectImages });

      // 3. Trigger Download
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `filtered_images_${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (e: any) {
      console.error("Failed to download images", e);
      alert(`Failed to download images: ${e.message}`);
    }
  };

  // Export filtered segments as a shapefile ZIP
  const handleDownloadShapefile = async () => {
    try {
      const projectImages: Record<string, string[]> = {};
      sortedData.forEach(point => {
        const projectName = point.projectName;
        const imageRef = point.f.properties?.["Image Reference"];
        if (projectName && imageRef && imageRef !== "-" && imageRef !== "None" && imageRef !== "") {
          if (!projectImages[projectName]) {
            projectImages[projectName] = [];
          }
          projectImages[projectName].push(imageRef);
        }
      });

      if (Object.keys(projectImages).length === 0) {
        alert("No segments with image references found in the current view.");
        return;
      }

      const blob = await exportShapefile({ projects: projectImages });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `shapefile_export_${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (e: any) {
      console.error("Failed to export shapefile", e);
      alert(`Failed to export shapefile: ${e.message}`);
    }
  };

  // Calculate category distribution data for the chart
  const categoryDistributionData = useMemo(() => {
    if (!effectiveFocusAttribute) return [];

    // Count occurrences of each category
    const categoryCounts: Record<string, number> = {};

    if (effectiveFocusAttribute === "Project") {
      // For Project focus, count segments per project
      allPoints.forEach((point) => {
        const project = point.projectName;
        if (project) {
          categoryCounts[project] = (categoryCounts[project] || 0) + 1;
        }
      });

      // Convert to array format for the chart with project colors
      return Object.entries(categoryCounts)
        .map(([project, count]) => ({
          category: project,
          count,
          color: projectColors[project] || CATEGORY_UNKNOWN_COLOR,
        }))
        .sort((a, b) => b.count - a.count); // Sort by count descending
    } else {
      // For attribute focus, count segments per category value
      allPoints.forEach((point) => {
        const category = point.attributeValue;
        if (category) {
          categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        }
      });

      // Convert to array format for the chart
      const chartData = Object.entries(categoryCounts)
        .map(([category, count]) => ({
          category,
          count,
          color: attributeCategoryColors[category] || CATEGORY_UNKNOWN_COLOR,
        }));

      const semanticOrder = getSemanticCategoryOrder(effectiveFocusAttribute);
      if (semanticOrder) {
        return chartData.sort((a, b) => compareByOrder(a.category, b.category, semanticOrder));
      }

      // Default: sort by count descending
      return chartData.sort((a, b) => b.count - a.count);
    }
  }, [allPoints, effectiveFocusAttribute, attributeCategoryColors, projectColors]);

  // Calculate status of all selected filter attributes (Active/Inactive categories)
  const categoryStatus = useMemo(() => {
    const attributesToCheck = [...selectedAttributes];
    if (primaryFocusAttribute === "Project" && !attributesToCheck.includes("Project")) {
      attributesToCheck.push("Project");
    }

    return attributesToCheck.map(attr => {
      // Numeric range filter: no category chips, just show the range bounds
      if (NUMERIC_FILTER_ATTRIBUTES.has(attr)) {
        const bounds = dataRangeBounds[attr] ?? { min: 0, max: 100 };
        const [currentMin, currentMax] = rangeFilters[attr] ?? [bounds.min, bounds.max];
        return {
          attribute: attr,
          categories: [] as { category: string; isActive: boolean; color: string; subcategories?: { name: string; isActive: boolean; color: string }[] }[],
          rangeFilter: { min: bounds.min, max: bounds.max, currentMin, currentMax },
        };
      }

      // 1. Get available categories for this attribute
      const categoriesSet = new Set<string>();

      if (attr === "Project") {
        selectedProjects.forEach(p => categoriesSet.add(p));
      } else {
        // Iterate through all data to find unique values for this attribute
        projectsData.forEach(projectData => {
          // Skip projects not selected
          if (!selectedProjects.includes(projectData.projectName)) return;

          if (!projectData.attributes) return;

          const isSafetyScore = ["VB Band", "BB Band", "SB Band", "BP Band", "Overall Risk Level"].includes(attr);

          if (attr === "Overall Risk Level") {
            projectData.geoFeatures.forEach((_, i) => {
              if (projectData.scores && projectData.scores.length > i) {
                const segmentScores = projectData.scores[i];
                const bands = [
                  segmentScores["VB Band"] ?? 1,
                  segmentScores["BB Band"] ?? 1,
                  segmentScores["SB Band"] ?? 1,
                  segmentScores["BP Band"] ?? 1
                ];
                const maxBand = Math.max(...bands);
                let category = "Low"; // Default
                if (maxBand <= 1) category = "Low";
                else if (maxBand <= 2) category = "Medium";
                else if (maxBand <= 3) category = "High";
                else category = "Extreme";
                categoriesSet.add(category);
              }
            });
          } else if (isSafetyScore) {
            // For specific bands
            const crashTypeKey = attr.replace(" Band", "");
            projectData.geoFeatures.forEach((_, i) => {
              if (projectData.scores && projectData.scores.length > i) {
                const segmentScores = projectData.scores[i];
                const scoreValue = segmentScores?.[crashTypeKey] !== undefined ? segmentScores[crashTypeKey] : 0;
                let attrValueText = "Low";
                if (['BB', 'BP', 'SB'].includes(crashTypeKey)) {
                  if (scoreValue < 5) attrValueText = "Low";
                  else if (scoreValue <= 10) attrValueText = "Medium";
                  else if (scoreValue <= 20) attrValueText = "High";
                  else attrValueText = "Extreme";
                } else {
                  if (scoreValue < 10) attrValueText = "Low";
                  else if (scoreValue <= 25) attrValueText = "Medium";
                  else if (scoreValue <= 60) attrValueText = "High";
                  else attrValueText = "Extreme";
                }
                categoriesSet.add(attrValueText);
              }
            });
          } else {
            // Standard attributes
            projectData.geoFeatures.forEach((_, i) => {
              const attributes = projectData.attributes[i];
              if (attributes) {
                const attrValue = attributes[attr];
                if (attrValue !== undefined && attrValue !== null) {
                  const text = getAttrText(attr, attrValue);
                  if (text) {
                    if (MULTI_VALUE_ATTRS.has(attr) && text.includes(", ")) {
                      text.split(", ").forEach((part: string) => categoriesSet.add(part.trim()));
                    } else {
                      categoriesSet.add(text);
                    }
                  }
                }
              }
            });
          }
        });
      }

      // 2. Sort categories
      const categories = Array.from(categoriesSet);
      if (["VB Band", "BB Band", "SB Band", "BP Band", "Overall Risk Level"].includes(attr)) {
        const riskOrder = ["Low", "Medium", "High", "Extreme"];
        categories.sort((a, b) => {
          const aIndex = riskOrder.indexOf(a);
          const bIndex = riskOrder.indexOf(b);
          if (aIndex === -1 && bIndex === -1) return 0;
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });
      } else if (attr === "Facility Width per Direction") {
        const widthOrder = ["Very Narrow", "Narrow", "Wide"];
        categories.sort((a, b) => {
          const aIndex = widthOrder.indexOf(a);
          const bIndex = widthOrder.indexOf(b);
          if (aIndex === -1 && bIndex === -1) return 0;
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });
      } else {
        categories.sort();
      }

      // 3. Map to status objects
      const currentToggles = categoryToggles[attr] || {};
      const categoryStatusItems = categories.map(cat => {
        const isActive = currentToggles[cat] !== false;
        let color = CATEGORY_UNKNOWN_COLOR;
        if (attr === "Project") {
          color = projectColors[cat] || color;
        } else {
          color = getCategoryColor(attr, cat);
        }

        // Subcategory items (Layer 3) — only for attributes that have a SUBCATEGORY_MAP entry
        const subcatConfig = SUBCATEGORY_MAP[attr];
        let subcategories: { name: string; isActive: boolean; color: string }[] | undefined;
        if (subcatConfig && subcatConfig.parentCategories[cat]) {
          const childAttr = subcatConfig.childAttr;
          subcategories = subcatConfig.parentCategories[cat].map(sub => ({
            name: sub,
            isActive: subcategoryToggles[childAttr]?.[sub] !== false,
            color: getCategoryColor(childAttr, sub),
          }));
        }

        return { category: cat, isActive, color, subcategories };
      });

      return {
        attribute: attr,
        categories: categoryStatusItems,
      };
    });
  }, [selectedAttributes, primaryFocusAttribute, selectedProjects, projectsData, categoryToggles, subcategoryToggles, rangeFilters, dataRangeBounds, projectColors]);

  // Notify parent when chart data updates
  useEffect(() => {
    if (onChartDataUpdate) {
      // Calculate total loaded segments
      const loadedCount = projectsData.reduce((acc, projectData) => {
        let count = 0;
        projectData.geoFeatures.forEach((feature) => {
          const g = feature.geometry;
          if (g?.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length > 0) {
            count++;
          }
        });
        return acc + count;
      }, 0);

      onChartDataUpdate({
        categoryDistributionData,
        primaryFocusAttribute: effectiveFocusAttribute,
        categoryStatus,
        totalSegmentsLoaded: loadedCount,
        totalSegmentsViewed: allPoints.length,
      });
    }
  }, [categoryDistributionData, effectiveFocusAttribute, categoryStatus, projectsData, allPoints.length, onChartDataUpdate]);

  // Clear polygon points and close dialog when toggling polygon mode
  useEffect(() => {
    // Both modes share the same points state, so clear if both are inactive
    if (!isPolygonMode && !isPolygonAddMode) {
      setPolygonPoints([]);
      setDeleteConfirmationOpen(false);
      setSegmentsToDelete([]);
    }
  }, [isPolygonMode, isPolygonAddMode]);

  // Clear single selections when toggling point modes
  useEffect(() => {
    if (!isDeleteMode && !isPointAddMode) {
      setSegmentToDelete(null);
      setSegmentToAdd(null);
    }
  }, [isDeleteMode, isPointAddMode]);

  // Handler for finishing "Add Segments" selection
  const finishAddSegmentsSelection = () => {
    if (polygonPoints.length < 3) {
      toaster.create({ title: "Invalid Polygon", description: "Need at least 3 points.", type: "warning" });
      return;
    }

    // Collect all points inside the polygon, grouped by project
    const selectedMap = new Map<string, number[]>();

    allPoints.forEach(p => {
      if (isPointInPolygon(p.latlng, polygonPoints)) {
        if (!selectedMap.has(p.projectName)) {
          selectedMap.set(p.projectName, []);
        }
        selectedMap.get(p.projectName)?.push(p.idx);
      }
    });

    if (selectedMap.size === 0) {
      toaster.create({ title: "No Segments", description: "No segments selected inside the polygon.", type: "warning" });
      return;
    }

    // Convert map to array for dialog
    const sources = Array.from(selectedMap.entries()).map(([projectName, indices]) => ({
      projectName,
      indices
    }));

    setSegmentsToAdd(sources);
    setIsAddSegmentsDialogOpen(true);
  };


  return (
    <Box
      borderWidth="1px"
      borderRadius={isV2 ? "6px" : "lg"}
      borderColor={isV2 ? COLOR.border : undefined}
      bg="white"
      overflow={isV2 ? "hidden" : undefined}
      h={isV2 ? "100%" : undefined}
      w={isV2 ? "100%" : undefined}
      minW={isV2 ? 0 : undefined}
      maxW={isV2 ? "100%" : undefined}
      display={isV2 ? "flex" : undefined}
      flexDirection={isV2 ? "column" : undefined}
      _dark={{ bg: "gray.800" }}
    >
      {/* Tabs */}
      <Tabs.Root
        value={activeTab}
        onValueChange={(e) => setActiveTab(e.value)}
        {...(isV2 ? { flex: "1", minH: 0, minW: 0, maxW: "100%", w: "100%", display: "flex", flexDirection: "column", overflow: "hidden" } : {})}
      >
        <MapViewToolbar
          isV2={isV2}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          allPointsCount={allPoints.length}
          activeFiltersCount={activeFilters.length}
          toolsHost={toolsHost}
          isDeleteMode={isDeleteMode}
          setIsDeleteMode={setIsDeleteMode}
          isPointAddMode={isPointAddMode}
          setIsPointAddMode={setIsPointAddMode}
          isPolygonMode={isPolygonMode}
          setIsPolygonMode={setIsPolygonMode}
          isPolygonAddMode={isPolygonAddMode}
          setIsPolygonAddMode={setIsPolygonAddMode}
          polygonPointsCount={polygonPoints.length}
          clearPolygonPoints={() => setPolygonPoints([])}
          closeDeleteConfirmation={() => setDeleteConfirmationOpen(false)}
          polygonSelectionCount={allPoints.filter(pt => isPointInPolygon(pt.latlng, polygonPoints)).length}
          finishPolygonSelection={finishPolygonSelection}
          finishAddSegmentsSelection={finishAddSegmentsSelection}
          handleOpenInTreatment={handleOpenInTreatment}
          onGenerateReport={() => {
            sessionStorage.removeItem(SESSION_KEYS.TREATMENT_LOADED_PROJECTS);
            navigate("/analysis/report");
          }}
          handleDownloadCSV={handleDownloadCSV}
          handleDownloadImages={handleDownloadImages}
          handleDownloadShapefile={handleDownloadShapefile}
        />

        {/* Map Tab Content */}
        <Tabs.Content value="map" {...(isV2 ? { p: 0, flex: "1", minH: 0, display: "flex", flexDirection: "column", overflow: "hidden" } : {})}>
          {/* Project Navigation Buttons and Legend */}
          {selectedProjects.length > 0 && (
            <Box p="4" borderBottom="1px solid" borderColor="gray.200" flexShrink={0}>
              <Text fontSize="sm" fontWeight="semibold" mb="2">
                Jump to Project:
              </Text>
              <Flex gap="2" flexWrap="wrap" mb="3">
                {selectedProjects.map((proj) => (
                  <Button
                    key={proj}
                    size="sm"
                    colorPalette={isV2 ? undefined : "blue"}
                    variant={isV2 ? "solid" : "outline"}
                    borderRadius={isV2 ? "999px" : undefined}
                    bg={isV2 ? projectColors[proj] : undefined}
                    color={isV2 ? "white" : undefined}
                    _hover={isV2 ? { opacity: 0.85 } : undefined}
                    onClick={() => handleProjectClick(proj)}
                  >
                    {proj}
                  </Button>
                ))}
              </Flex>

            </Box>
          )}

          {/* Filter attribute selector + per-category toggles. In v2 this UI is
              portalled into the left "Current Filters" accordion (the map view
              keeps owning the toggle state). `to=undefined` in v1 → renders here. */}
          {selectedProjects.length > 0 && (
            <MaybePortal to={isV2 ? (filtersPortalTarget ?? null) : undefined}>
            <MapFiltersPanel
              isV2={isV2}
              selectedAttributes={selectedAttributes}
              activeFilters={activeFilters}
              categoryFilterAttribute={categoryFilterAttribute}
              categoryFilterAttributeIndex={categoryFilterAttributeIndex}
              setCategoryFilterAttributeIndex={setCategoryFilterAttributeIndex}
              setPrimaryFocusAttribute={setPrimaryFocusAttribute}
              loadedProjects={loadedProjects}
              hiddenProjects={hiddenProjects}
              onHiddenProjectsChange={onHiddenProjectsChange}
              projectColors={projectColors}
              availableCategories={availableCategories}
              categoryToggles={categoryToggles}
              setCategoryToggles={setCategoryToggles}
              subcategoryToggles={subcategoryToggles}
              setSubcategoryToggles={setSubcategoryToggles}
              rangeFilters={rangeFilters}
              setRangeFilters={setRangeFilters}
              dataRangeBounds={dataRangeBounds}
            />
            </MaybePortal>
          )}

          <Box h={isV2 ? undefined : "650px"} flex={isV2 ? "1" : undefined} minH={isV2 ? 0 : undefined} position="relative">
            {loading && (
              <Box p="6">
                <Text color="gray.500">Loading map…</Text>
              </Box>
            )}
            {err && (
              <Box p="6">
                <Text color="red.600">Failed: {err}</Text>
              </Box>
            )}

            {!loading && !err && (
              <>
                {/* v2: floating tool cluster (polygon / single-select), top-right
                    over the map — same treatment as Coding's floating map controls.
                    The header tools portal into here via MaybePortal. */}
                {isV2 && allPoints.length > 0 && (
                  <Box
                    ref={toolsHostRef}
                    position="absolute"
                    top="12px"
                    right="12px"
                    zIndex={1000}
                    bg="white"
                    borderWidth="1px"
                    borderColor={COLOR.border}
                    borderRadius="6px"
                    boxShadow="sm"
                    p="1.5"
                    display="flex"
                    flexDirection="column"
                    gap="2"
                    alignItems="stretch"
                  />
                )}
                <AnalysisSidebar
                  variant={variant}
                  isOpen={isGisSidebarOpen}
                  onToggle={() => setIsGisSidebarOpen(v => !v)}
                  showFootpath={showFootpath} setShowFootpath={setShowFootpath}
                  showCycling={showCycling} setShowCycling={setShowCycling}
                  showShared={showShared} setShowShared={setShowShared}
                  showRoadcrossing={showRoadcrossing} setShowRoadcrossing={setShowRoadcrossing}
                  showMrtExit={showMrtExit} setShowMrtExit={setShowMrtExit}
                  showBusStop={showBusStop} setShowBusStop={setShowBusStop}
                  showBusLane={showBusLane} setShowBusLane={setShowBusLane}
                  showParkingLot={showParkingLot} setShowParkingLot={setShowParkingLot}
                  showKerbLine={showKerbLine} setShowKerbLine={setShowKerbLine}
                  showBicycleCrossing={showBicycleCrossing} setShowBicycleCrossing={setShowBicycleCrossing}
                  showPathDefects={showPathDefects} setShowPathDefects={setShowPathDefects}
                  showStateLand={showStateLand} setShowStateLand={setShowStateLand}
                  showStatBoard={showStatBoard} setShowStatBoard={setShowStatBoard}
                  showLandPrivate={showLandPrivate} setShowLandPrivate={setShowLandPrivate}
                  showLandMinistry={showLandMinistry} setShowLandMinistry={setShowLandMinistry}
                  onFilesSelected={handleImportFiles}
                  importedShapefileHasData={importedBoundaries.length > 0}
                  importedShapefileLoading={importedBoundaryLoading}
                  importedShapefileError={importedBoundaryError}
                  importedShapefileName={importedBoundaryName}
                  onClearImportedShapefile={handleClearImportedShapefile}
                />
                <MapContainer
                  center={initialCenter.current}
                  zoom={initialZoom.current}
                  maxZoom={22}
                  style={{ width: "100%", height: "100%" }}
                  scrollWheelZoom
                  preferCanvas={true}
                  zoomControl={false}
                >
                  {!isV2 && <ZoomControl position="topright" />}
                  <MapCursorController
                    mode={(isDeleteMode || isPolygonMode) ? 'delete' : (isPointAddMode || isPolygonAddMode) ? 'add' : 'default'}
                  />
                  {/* Render Polygon Tool */}
                  <PolygonDrawingTool
                    active={isPolygonMode || isPolygonAddMode}
                    color={isPolygonAddMode ? "blue" : "red"}
                    points={polygonPoints}
                    onAddPoint={handlePolygonPoint}
                    onPointUpdate={handlePointUpdate}
                  />

                  {/* Tile Layer */}
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; OpenStreetMap contributors & CARTO'
                    maxZoom={22}
                  />

                  {/* Auto-fit bounds if data is available and shouldAutoFit is true */}
                  {allLatLngs.length > 0 && <FitBounds points={allLatLngs} shouldFit={shouldAutoFit} />}

                  {/* Pan to specific project bounds when button clicked */}
                  {panToBounds && <PanToBounds bounds={panToBounds} />}

                  {/* Track viewport for marker culling */}
                  <ViewportWatcher onBoundsChange={setMapViewportBounds} />

                  {/* Persist center/zoom so back-navigation restores this view */}
                  <ViewportPersister />

                  {/* Force Leaflet to recalculate its container size after mount so
                      getBounds() reflects the real rendered height, not a zero/partial
                      height from before CSS layout has settled. */}
                  <MapInvalidateSize />

                  {/* Render visible points in a dedicated pane above any overlay layers.
                      Uses a shared canvas renderer (vs. per-marker SVG) and viewport
                      culling to stay fast with 15+ projects loaded. */}
                  <Pane name="segmentsPane" style={{ zIndex: 450 }}>
                    {viewportPoints.map(({ idx, latlng, f, projectName, color, attributeValue }) => {
                      const radius = 5;
                      const imageRef = f.properties?.["Image Reference"] as string | undefined;
                      const imageUrl = imageRef
                        ? `/api/projects/${encodeURIComponent(projectName)}/images/${encodeURIComponent(imageRef)}`
                        : null;
                      let label = `${projectName} - #${idx + 1}`;
                      if (effectiveFocusAttribute && attributeValue) {
                        label += ` | ${effectiveFocusAttribute}: ${attributeValue}`;
                      }

                      return (
                        <CircleMarker
                          key={`${projectName}-${idx}`}
                          center={latlng}
                          radius={radius}
                          pathOptions={{ color, weight: 1, opacity: 0.9, fillOpacity: 0.8 }}
                          pane="segmentsPane"
                          renderer={canvasRenderer}
                          eventHandlers={{
                            click: (e) => {
                              // If in polygon mode, add this point to the polygon and stop propagation
                              if (isPolygonMode || isPolygonAddMode) {
                                L.DomEvent.stopPropagation(e as any);
                                handlePolygonPoint(latlng);
                                return;
                              }

                              // Check delete modes first
                              if (isDeleteMode) {
                                setSegmentToDelete({ projectName: projectName, index: idx });
                                setDeleteConfirmationOpen(true);
                                return;
                              }
                              if (isPointAddMode) {
                                setSegmentToAdd({ projectName: projectName, index: idx });
                                setIsAddSegmentsDialogOpen(true);
                                return;
                              }

                              // Navigate to coding page for this project and segment.
                              // When filters are active, pass filter context so the Coding
                              // page map shows only filtered segments (+ the current segment).
                              const segmentIdx = idx + 1; // 1-based index for UI
                              const filterContext = buildFilterContext();
                              if (filterContext) {
                                sessionStorage.setItem(CODING_FILTER_CONTEXT_KEY, JSON.stringify(filterContext));
                              } else {
                                sessionStorage.removeItem(CODING_FILTER_CONTEXT_KEY);
                              }
                              navigate(`/coding/${encodeURIComponent(projectName)}?segment=${segmentIdx}`, {
                                state: { returnToAnalysis: true, filterContext }
                              });
                            }
                          }}
                        >
                          <Tooltip>
                            {imageUrl && (
                              <img
                                src={imageUrl}
                                alt="segment"
                                style={{
                                  display: "block",
                                  width: "200px",
                                  height: "133px",
                                  objectFit: "cover",
                                  margin: "0 auto 4px",
                                }}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            )}
                            <div>{label}</div>
                          </Tooltip>
                        </CircleMarker>
                      );
                    })}
                  </Pane>

                  {/* GIS Layers — rendered below segments pane (zIndex < 450).
                      gisCanvasRenderer provides 50% padding so lines near the viewport
                      edge stay visible during pan/zoom without flickering. */}
                  <GISLayerOverlays
                    gisLayers={gisLayers}
                    pathDefects={pathDefects}
                    gisCanvasRenderer={gisCanvasRenderer}
                    showFootpath={showFootpath}
                    showCycling={showCycling}
                    showShared={showShared}
                    showRoadcrossing={showRoadcrossing}
                    showMrtExit={showMrtExit}
                    showBusStop={showBusStop}
                    showBusLane={showBusLane}
                    showParkingLot={showParkingLot}
                    showKerbLine={showKerbLine}
                    showBicycleCrossing={showBicycleCrossing}
                    showPathDefects={showPathDefects}
                    showStateLand={showStateLand}
                    showStatBoard={showStatBoard}
                    showLandPrivate={showLandPrivate}
                    showLandMinistry={showLandMinistry}
                  />
                  {/* Imported shapefile overlay — non-interactive so hover doesn't interfere with segment nodes */}
                  {importedBoundaries.map((boundary) =>
                    boundary.kind === "polygon" && boundary.coords ? (
                      <LeafletPolygon
                        key={boundary.key}
                        positions={boundary.coords}
                        pathOptions={{ color: MAP_INTERACTION_COLORS.importedOverlay, weight: 2, opacity: 0.95, fillColor: MAP_INTERACTION_COLORS.importedOverlayFill, fillOpacity: 0.2, interactive: false }}
                      />
                    ) : (
                      <>
                        {(boundary.lineCoordsSets ?? []).map((lineCoords, partIndex) => (
                          <LeafletPolyline
                            key={`${boundary.key}-${partIndex}`}
                            positions={lineCoords}
                            pathOptions={{ color: MAP_INTERACTION_COLORS.importedOverlay, weight: 2.5, opacity: 0.95, interactive: false }}
                          />
                        ))}
                      </>
                    )
                  )}
                </MapContainer>
              </>
            )}
          </Box>
        </Tabs.Content>

        {/* Table Tab Content */}
        <SegmentsTableTab
          isV2={isV2}
          selectedProjects={selectedProjects}
          projectColors={projectColors}
          allPointsCount={allPoints.length}
          sortedData={sortedData}
          tableColumns={tableColumns}
          getColumnValue={getColumnValue}
          sortConfig={sortConfig}
          setSortConfig={setSortConfig}
          columnFilters={columnFilters}
          setColumnFilters={setColumnFilters}
          setGlobalSearch={setGlobalSearch}
        />
      </Tabs.Root>
      <Dialog.Root open={deleteConfirmationOpen} onOpenChange={(e) => setDeleteConfirmationOpen(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Confirm Deletion</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                {segmentToDelete
                  ? `Are you sure you want to delete segment #${segmentToDelete.index + 1} from project "${segmentToDelete.projectName}"?`
                  : `Are you sure you want to delete ${segmentsToDelete.length} segments across ${new Set(segmentsToDelete.map(s => s.projectName)).size} projects?`
                }
                <Text color="red.500" mt="2" fontSize="sm">This action cannot be undone. Associated images will also be deleted.</Text>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>
                <Button
                  colorPalette="red"
                  onClick={segmentToDelete ? handleDeleteSegment : handleBatchDelete}
                  loading={isDeleting}
                >
                  Delete
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      <AddSegmentsDialog
        isOpen={isAddSegmentsDialogOpen}
        onClose={() => {
          setIsAddSegmentsDialogOpen(false);
          setSegmentToAdd(null);
          setSegmentsToAdd([]);
        }}
        sources={
          segmentToAdd
            ? [{ projectName: segmentToAdd.projectName, indices: [segmentToAdd.index] }]
            : segmentsToAdd
        }
        onSuccess={() => {
          // Reset mode
          setIsPolygonAddMode(false);
          setPolygonPoints([]);
          // Copying segments mutates the target project's stored data. Clear the
          // shared cache so the next load/remount fetches fresh data rather than
          // serving the pre-copy cache.
          invalidateAll();
          // Show success toast is inside the dialog
        }}
      />
    </Box >
  );
}

