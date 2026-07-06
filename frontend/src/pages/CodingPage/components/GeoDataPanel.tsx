/**
 * GeoDataPanel.tsx — the shared map preview & analysis panel.
 *
 * Single responsibility: orchestrate the segment map — geodata/score loading,
 * segment dots (risk-band coloured, filter/scope aware), the GIS layer /
 * defects / curvature overlays, the segment editing tools and the analysis
 * sidebar — behind a FROZEN external prop contract. Consumed by the Coding
 * page layouts (CodingLayoutV1/V2) and the Treatment page's Before/After map
 * panels (TreatmentDetailLayoutV1/V2); `variant="v2"` gates the redesigned
 * chrome (floating tool cluster, no Leaflet zoom control).
 *
 * Decomposed in S2.2 — state hooks and overlay sub-components live in
 * ./GeoDataPanel/ (useGISToggleState, useGISLayerData, useSegmentEditTools,
 * GISLayersOverlay, DefectsLayer, CurvatureOverlay, MapToolCluster,
 * mapHelpers).
 */
import ThemeAwareTileLayer from "../../../components/common/ThemeAwareTileLayer";
import {
  Card, CardBody, Text, Box, Flex, Button,
  Dialog, Portal
} from "@chakra-ui/react";
import { AnalysisSidebar } from "../../../components/visualization/AnalysisSidebar";
import { Switch } from "../../../components/ui/switch";
import { AddSegmentsDialog } from "../../PathAnalysisPage/components/AddSegmentsDialog";
import { MapCursorController } from "../../../components/common/MapCursorController";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { RISK_BAND_COLORS } from "../../../components/visualization/scoreband/colorConstants";
import { MAP_MISSING_SCORE_COLOR, MAP_INTERACTION_COLORS } from "../../../constants/mapColors";
import type { CodingFilterContext } from "../../../api";
import { CODING_FILTER_CONTEXT_KEY } from "../../../constants/sessionKeys";
import { useNavigate } from "react-router-dom";


import { MapContainer, CircleMarker, Tooltip, useMap, Circle, Pane, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { to4326 } from "../../../utils/projection";
import { PolygonDrawingTool } from "../../../components/map/PolygonDrawing";
import { isPointInPolygon } from "../../../components/map/polygonUtils";
import type { CurvatureVisualizationResponse } from '../../../api/curvatureVisualization';
import { GRADIENT_STATUS_NO_LIDAR_RESULT, getGradientDisplayState } from "../../../utils/gradientDisplay";

import { FitBounds, FitToFeatures, MapAutosize, PanToBounds, StatPill, ZoomToGIS } from "./GeoDataPanel/mapHelpers";
import { CurvatureOverlay, ZoomToCurvature } from "./GeoDataPanel/CurvatureOverlay";
import { useCurvatureOverlay } from "./GeoDataPanel/useCurvatureOverlay";
import { useGISToggleState } from "./GeoDataPanel/useGISToggleState";
import { useGISLayers, usePathDefects } from "./GeoDataPanel/useGISLayerData";
import { GISLayersOverlay } from "./GeoDataPanel/GISLayersOverlay";
import { DefectsLayer } from "./GeoDataPanel/DefectsLayer";
import { useSegmentEditTools } from "./GeoDataPanel/useSegmentEditTools";
import { MapToolCluster } from "./GeoDataPanel/MapToolCluster";

type Props = {
  projectName: string;                       // Current project name from parent
  feature: Feature<LineString, any> | null;  // Current segment (passed from parent)
  index: number;                             // Current page index (passed from parent, 0-based)
  onJump?: (idx: number) => void;            // Jump to segment callback
  containerHeight?: number | string;         // Total container height (including header); number=px or a CSS length string (e.g. clamp/vh) for fluid v2 maps
  scores?: ScoreRow[];                       // Optional scores passed from parent for real-time updates
  subtitle?: string;                         // Optional subtitle to display next to "Map Preview"
  geoFeatures?: Feature<LineString, any>[];  // Optional pre-loaded geofeatures (for multi-project display)
  startIndex?: number;                       // Start index in global segments array (used with geoFeatures for multi-project)
  onDataChange?: () => void;                 // Callback when data is modified (e.g. deleted)
  filterContext?: CodingFilterContext | null; // From Path Analysis: restricts which segments appear on the map
  verifiedByProject?: Record<string, number[]>; // project name → verified segment indices (in-memory review state)
  panToBounds?: L.LatLngBounds | null;       // When set, immediately flies map to these bounds (e.g. on project tab switch)
  panKey?: number;                           // Monotonic counter to force PanToBounds effect re-fire
  scopeRange?: { start: number; count: number } | null; // In-focus global index window; out-of-scope segments are dimmed. null = no scoping
  autoFitKey?: number;                       // Bump to refit the map to the in-scope segments (e.g. on project tab switch)
  curvData?: CurvatureVisualizationResponse | null;
  showCurvatureOverlay?: boolean;
  onToggleCurvatureOverlay?: () => void;
  widthM?: number | null;
  grade?: number | null;
  gradientPct?: number | null;
  gradientStatus?: string | null;
  /** "v1" (default) = current Chakra layout; "v2" = Home.dc.html FRAME 4 map (floating tools, no Leaflet zoom control, card chrome). */
  variant?: "v1" | "v2";
};

type GJ = FeatureCollection<LineString, any>;

// Deep emerald used for the "verified" dot halo. Deliberately distinct from the
// yellow-green LOW risk-band colour (#87C424) so verified state stays legible.
// Sourced from the shared map-color base (constants/mapColors.ts).
const VERIFIED_HALO_COLOR = MAP_INTERACTION_COLORS.verifiedHalo;

type ScoreRow = {
  "Overall Risk Level": number;
  [key: string]: any;
};

// Map behaviour helpers (fit/pan/zoom/resize) + StatPill extracted to
// ./GeoDataPanel/mapHelpers.tsx in S2.2. MapAutoCenter intentionally remains
// nested inside the component body below (see its comment).

export default function GeoDataPanel({ projectName, index, onJump, containerHeight = 650, scores: externalScores, subtitle, geoFeatures: externalGeoFeatures, startIndex = 0, onDataChange, filterContext, verifiedByProject, panToBounds, panKey = 0, scopeRange, autoFitKey = 0, curvData, showCurvatureOverlay, onToggleCurvatureOverlay, widthM, grade, gradientPct, gradientStatus, variant = "v1" }: Props) {
  const navigate = useNavigate();

  const decodedName = useMemo(() => {
    if (!projectName) return null;
    try { return decodeURIComponent(projectName); } catch { return projectName; }
  }, [projectName]);

  const [fc, setFc] = useState<GJ | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);


  // Use external geofeatures if provided (for multi-project display), otherwise use fetched data
  const hasExternalGeoFeatures = externalGeoFeatures !== undefined;

  // Internal scores state (fallback if externalScores not provided)
  const [internalScores, setInternalScores] = useState<ScoreRow[]>([]);

  // Derived active scores - prioritize external props for real-time updates
  const activeScores = useMemo(() => {
    return (externalScores && externalScores.length > 0) ? externalScores : internalScores;
  }, [externalScores, internalScores]);

  // GIS layer toggles — localStorage-backed, cross-panel-synced (extracted to
  // ./GeoDataPanel/useGISToggleState in S2.2). Destructured so the JSX below
  // (AnalysisSidebar wiring, layer gating) stays identical to pre-extraction.
  const { toggles: gisToggles, setters: gisToggleSetters } = useGISToggleState(projectName, showCurvatureOverlay);
  const {
    showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop,
    showBusLane, showParkingLot, showKerbLine, showBicycleCrossing, showPathDefects,
    showStateLand, showStatBoard, showLandPrivate, showLandMinistry,
  } = gisToggles;
  const {
    setShowFootpath, setShowCycling, setShowShared, setShowRoadcrossing, setShowMrtExit,
    setShowBusStop, setShowBusLane, setShowParkingLot, setShowKerbLine, setShowBicycleCrossing,
    setShowPathDefects, setShowStateLand, setShowStatBoard, setShowLandPrivate, setShowLandMinistry,
  } = gisToggleSetters;

// Sub-component to pan map to current selection.
// When panKey changes (project tab clicked), MapAutoCenter suppresses its setView
// for a 800ms window. This prevents async treatment-fetch callbacks from causing
// a re-render that overrides PanToBounds' fitBounds.
function MapAutoCenter({ center, anyLayerOn, panKey }: { center: [number, number] | null; anyLayerOn?: boolean; panKey?: number }) {
  const map = useMap();
  const prevCenterRef = useRef<[number, number] | null>(null);
  const prevPanKeyRef = useRef(panKey ?? 0);
  const suppressUntilRef = useRef(0);
  useEffect(() => {
    if (!center) return;
    const prevCenter = prevCenterRef.current;
    const centerChanged = !prevCenter || prevCenter[0] !== center[0] || prevCenter[1] !== center[1];
    prevCenterRef.current = center;

    // If panKey just changed, start a suppression window.
    const currentPanKey = panKey ?? 0;
    if (currentPanKey !== prevPanKeyRef.current) {
      prevPanKeyRef.current = currentPanKey;
      suppressUntilRef.current = Date.now() + 800;
      return;
    }

    // Still within the suppression window — let PanToBounds' fitBounds stand.
    if (Date.now() < suppressUntilRef.current) {
      return;
    }

    if (centerChanged) {
      // When navigating to a new segment, pan to it
      // If GIS layers are on, zoom in close enough to see them
      const targetZoom = anyLayerOn ? Math.max(map.getZoom(), 17) : map.getZoom();
      map.setView(center, targetZoom, { animate: true });
    }
  }, [center, anyLayerOn, map, panKey]);
  return null;
}


  // Analysis sidebar open state
  // Layer View starts collapsed in both v1 and v2; expand via the edge tab.
  const [isAnalysisSidebarOpen, setIsAnalysisSidebarOpen] = useState(false);

  // Segment editing tools (single/polygon delete & copy) are extracted to
  // ./GeoDataPanel/useSegmentEditTools in S2.2 and instantiated after the
  // `points` memo below (the polygon tools hit-test against it).

  // GIS layer + path-defect data are fetched by ./GeoDataPanel/useGISLayerData
  // hooks, instantiated after the active query point is derived below.

  // Fetch the full geodata for this project (skipped when parent provides external geofeatures)
  useEffect(() => {
    // Skip if we have external geofeatures provided by parent
    if (hasExternalGeoFeatures) {
      setFc({ type: "FeatureCollection", features: externalGeoFeatures });
      setLoading(false);
      return;
    }

    if (!decodedName) return;
    let aborted = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = await fetch(`/api/projects/${encodeURIComponent(decodedName)}/geodata`);
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        const data = (await res.json()) as GJ;
        if (!aborted) setFc(data);
      } catch (e: any) {
        if (!aborted) setErr(e?.message ?? "Failed to load geodata");
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => { aborted = true; };
  }, [decodedName, hasExternalGeoFeatures, externalGeoFeatures]);

  // Helper function to fetch scores
  const fetchScores = useCallback(async () => {
    if (!decodedName) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(decodedName)}/results`);
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      if (data.ok && Array.isArray(data.result_rows)) {
        setInternalScores(data.result_rows);
      }
    } catch (e: any) {
    }
  }, [decodedName]);

  // Fetch Overall Risk Levels for color coding on component mount (fallback if no external scores)
  useEffect(() => {
    if (!decodedName) return;
    // Only fetch if we don't have external scores
    if (!externalScores || externalScores.length === 0) {
      fetchScores();
    }
  }, [decodedName, fetchScores, externalScores]);

  // Listen for score update events (triggered after Calculate Score button is clicked)
  // If we have external scores (from parent), don't fetch from API - let parent updates drive the scores
  // Only fetch from API if we're using the fallback mechanism (no external scores)
  useEffect(() => {
    const handleScoresUpdated = () => {
      // Only refetch from API if we don't have external scores
      if (!externalScores || externalScores.length === 0) {
        fetchScores();
      }
    };

    window.addEventListener("psat:scores:updated", handleScoresUpdated);
    return () => window.removeEventListener("psat:scores:updated", handleScoresUpdated);
  }, [fetchScores, externalScores]);

  // Extract the first point of each LineString (reprojected to WGS84) and keep a reference to the original feature.
  // For multi-project display, localIdx is the index within geoFeatures,
  // and globalIdx is the index within the aggregated scores array
  const points = useMemo(() => {
    if (!fc) return [] as { localIdx: number; globalIdx: number; latlng: [number, number]; f: Feature<LineString, any> }[];
    const arr: { localIdx: number; globalIdx: number; latlng: [number, number]; f: Feature<LineString, any> }[] = [];
    fc.features.forEach((f, i) => {
      const g = f.geometry;
      if (g?.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length > 0) {
        arr.push({ localIdx: i, globalIdx: startIndex + i, latlng: to4326(g.coordinates[0]), f });
      }
    });
    return arr;
  }, [fc, startIndex]);

  const allLatLngs = useMemo(() => points.map(p => p.latlng), [points]);

  // When a focus scope is active, the map refits to just the in-scope segments;
  // otherwise it fits all loaded segments.
  const scopeLatLngs = useMemo(
    () => (scopeRange
      ? points
          .filter(p => p.globalIdx >= scopeRange.start && p.globalIdx < scopeRange.start + scopeRange.count)
          .map(p => p.latlng)
      : allLatLngs),
    [points, scopeRange, allLatLngs]
  );

  // When a filter context is active, only show filtered segments + the current one.
  // localIdx equals the 0-based position in the project's geo features (= globalIdx when startIndex=0).
  const currentProjectFilterData = useMemo(
    () => filterContext?.projects.find(p => p.projectName === decodedName) ?? null,
    [filterContext, decodedName]
  );

  const otherProjectsFilterData = useMemo(
    () => filterContext ? filterContext.projects.filter(p => p.projectName !== decodedName) : [],
    [filterContext, decodedName]
  );

  const filterIndexSet = useMemo(
    () => currentProjectFilterData ? new Set(currentProjectFilterData.filteredIndices) : null,
    [currentProjectFilterData]
  );

  const filterColorMap = useMemo(
    () => currentProjectFilterData
      ? new Map(currentProjectFilterData.points.map(p => [p.idx, p.color]))
      : null,
    [currentProjectFilterData]
  );

  // Verified segment indices for the current project — drives the "checked" dot treatment.
  const verifiedSet = useMemo(
    () => new Set((decodedName && verifiedByProject?.[decodedName]) || []),
    [verifiedByProject, decodedName]
  );

  // Currently highlighted point — use globalIdx to match the index prop (global index)
  const current = useMemo(() => points.find(p => p.globalIdx === index) ?? null, [points, index]);

  // GIS query point: starts at current segment, can be repositioned by clicking on the map
  // Stored as { lat, lon } primitives so React useEffect deps work reliably (no array reference issues)
  const currentLat = current?.latlng[0] ?? null;
  const currentLon = current?.latlng[1] ?? null;
  const [gisLat, setGisLat] = useState<number | null>(null);
  const [gisLon, setGisLon] = useState<number | null>(null);

  // When segment changes (user clicks a green dot → navigates to new segment),
  // reset the GIS query point to the new segment's first coordinate.
  useEffect(() => {
    if (currentLat !== null && currentLon !== null) {
      setGisLat(currentLat);
      setGisLon(currentLon);
    }
  }, [index, currentLat, currentLon]);

  // Active query point (primitives, reliable for useEffect deps)
  const activeGisLat = gisLat ?? currentLat;
  const activeGisLon = gisLon ?? currentLon;

  // Array form for rendering (buffer circle, zoom components)
  const activeQueryPoint: [number, number] | null =
    (activeGisLat !== null && activeGisLon !== null) ? [activeGisLat, activeGisLon] : null;

  // Curvature overlay geometry (EPSG:3414 → WGS84 via the shared projection util).
  const { tripletPoints, circleCoords } = useCurvatureOverlay(curvData);

  const gradientState = getGradientDisplayState(
    { grade, gradientPct, gradientStatus },
    { percentDigits: 1 },
  );

  // Initial map centre (defaults to Singapore centre when no data is loaded)
  const initialCenter = useRef<[number, number]>([1.3521, 103.8198]);

  // GIS layer features + path defects around the active query point
  // (fetch effects extracted to ./GeoDataPanel/useGISLayerData in S2.2).
  const gisLayers = useGISLayers(decodedName, activeGisLat, activeGisLon, gisToggles, hasExternalGeoFeatures);
  const pathDefects = usePathDefects(activeGisLat, activeGisLon, showPathDefects);

  // Segment editing tools (modes, polygon selection, delete/copy actions).
  const editTools = useSegmentEditTools(decodedName, points, onDataChange);
  const {
    isDeleteMode, isPointAddMode, isPolygonMode, isPolygonAddMode,
    polygonPoints, setPolygonPoints,
    deleteConfirmationOpen, setDeleteConfirmationOpen,
    isAddSegmentsDialogOpen, setIsAddSegmentsDialogOpen,
    segmentToDelete, setSegmentToDelete,
    segmentToAdd, setSegmentToAdd,
    segmentsToDelete,
    cancelRef,
    handleDeleteSegment, handlePolygonPoint, handlePointUpdate,
    handleBatchDelete,
    setIsPointAddMode, setIsPolygonAddMode,
  } = editTools;

  // Get segment color based on the crash type with the highest score
  const getSegmentColor = (segmentIndex: number): string => {
    if (!activeScores || segmentIndex >= activeScores.length) {
      return MAP_MISSING_SCORE_COLOR; // Default blue if no scores
    }

    const segmentScores = activeScores[segmentIndex];
    if (!segmentScores) {
      return MAP_MISSING_SCORE_COLOR; // Default blue if no score data for this segment
    }

    const crashTypes = ["BB", "BP", "SB", "VB"];

    let maxRiskLevel = 0; // 0: Low, 1: Med, 2: High, 3: Extreme

    // Find the crash type with the highest risk level
    crashTypes.forEach((crashType) => {
      const score = segmentScores[crashType] || 0;
      let riskLevel = 0;

      if (['BB', 'BP', 'SB'].includes(crashType)) {
        if (score > 20) riskLevel = 3;       // Extreme
        else if (score > 10) riskLevel = 2;  // High
        else if (score >= 5) riskLevel = 1;  // Medium
        else riskLevel = 0;                  // Low
      } else {
        // VB
        if (score > 60) riskLevel = 3;       // Extreme
        else if (score > 25) riskLevel = 2;  // High
        else if (score >= 10) riskLevel = 1; // Medium
        else riskLevel = 0;                  // Low
      }

      if (riskLevel > maxRiskLevel) {
        maxRiskLevel = riskLevel;
      }
    });

    switch (maxRiskLevel) {
      case 3: return RISK_BAND_COLORS.EXTREME;
      case 2: return RISK_BAND_COLORS.HIGH;
      case 1: return RISK_BAND_COLORS.MEDIUM;
      default: return RISK_BAND_COLORS.LOW;
    }
  };

  // Metric readouts shared by the v1 header pills and the v2 floating map cluster.
  const curvDisplay = curvData?.radius != null ? `${curvData.radius.toFixed(1)} m` : "—";
  const widthDisplay = widthM != null ? `${widthM.toFixed(2)} m` : "—";
  const gradeDisplay =
    gradientState.mode === "grade"
      ? gradientState.text.replace("Grade 1 (<5°)", "<5°").replace("Grade 2 (≥5°)", "≥5°")
      : gradientState.text === GRADIENT_STATUS_NO_LIDAR_RESULT
        ? "N/A"
        : gradientState.text;

  return (
    <Card.Root display="flex" flexDirection="column" h={typeof containerHeight === "number" ? `${containerHeight}px` : containerHeight} overflow="hidden" borderRadius={variant === "v2" ? "6px" : "none"} position={variant === "v2" ? "relative" : undefined}>

      {/* Clickable title bar restored as a static header */}
      <Box
        px="4"
        py="3"
        borderBottom="1px solid"
        borderColor="gray.200"
        _dark={{ borderColor: "gray.700" }}
        display="flex"
        alignItems="center"
        gap="2"
      >
        <Text fontSize="md" fontWeight="bold" color="gray.800" _dark={{ color: "gray.100" }}>
          Map Preview & Analysis
        </Text>
        {subtitle && (
          <Text fontSize="sm" fontWeight="medium" color="gray.600" _dark={{ color: "gray.400" }}>
            - {subtitle}
          </Text>
        )}
        {/* v1: metric pills + Analysis Overlay toggle live in the header. v2 (Home.dc.html
            FRAME 4): metrics move into the floating map cluster and the overlay toggle moves
            into the Layer View panel, leaving the header as a plain title. */}
        {variant !== "v2" && (
          <Flex align="center" gap="1.5" ml="auto">
            <Flex align="center" gap="3" mr="2" pr="2" borderRight="1px solid" borderColor="gray.200" _dark={{ borderColor: "gray.600" }}>
              <StatPill label="Curv" value={curvDisplay} />
              <StatPill label="Width" value={widthDisplay} />
              <StatPill label="Grade" value={gradeDisplay} />
            </Flex>
            <Text fontSize="xs" fontWeight="medium" color={showCurvatureOverlay ? "gray.900" : "gray.400"} _dark={{ color: showCurvatureOverlay ? "gray.100" : "gray.500" }}>
              Analysis Overlay
            </Text>
            <Switch
              colorPalette="gray"
              size="sm"
              checked={showCurvatureOverlay}
              onCheckedChange={onToggleCurvatureOverlay}
            />
          </Flex>
        )}
      </Box>

      {/* Tools + GIS layer toggles. v1: a bordered toolbar row under the header.
          v2 (Home.dc.html FRAME 4): a floating cluster over the top-right of the map.
          Extracted to ./GeoDataPanel/MapToolCluster in S2.2. */}
      <MapToolCluster
        variant={variant}
        edit={editTools}
        points={points}
        curvDisplay={curvDisplay}
        widthDisplay={widthDisplay}
        gradeDisplay={gradeDisplay}
      />
      <CardBody flex="1" minH={0} p={0} position="relative">
        {loading && <Text color="gray.500">Loading map…</Text>}
        {err && <Text color="red.600">Failed: {err}</Text>}

        {!loading && !err && (
          <Box
            border={variant === "v2" ? "none" : "1px solid"}
            borderColor="gray.200"
            borderRadius={variant === "v2" ? "none" : "md"}
            overflow="hidden"
            h="100%"
          >
            <MapContainer
              center={initialCenter.current}
              zoom={13}
              maxZoom={22}
              style={{ width: "100%", height: "100%" }}
              scrollWheelZoom
              zoomControl={false}
            >
              {variant !== "v2" && <ZoomControl position="topright" />}
              <MapAutosize />
              <MapCursorController
                mode={(isDeleteMode || isPolygonMode) ? 'delete' : (isPointAddMode || isPolygonAddMode) ? 'add' : 'default'}
              />
              {/* CartoDB Light basemap - same as Curvature Analysis */}
              <ThemeAwareTileLayer />

              {/* Auto-fit bounds to all data points (first load only) */}
              {allLatLngs.length > 0 && <FitBounds points={allLatLngs} />}

              {/* Auto-zoom to current point when GIS layers active */}
              <ZoomToGIS
                center={activeQueryPoint}
                anyLayerOn={showFootpath || showCycling || showShared || showRoadcrossing || showMrtExit || showBusStop || showBusLane || showParkingLot || showKerbLine || showBicycleCrossing || showPathDefects}
              />

              {/* Zoom to the 5m curvature circle when the overlay is enabled */}
              <ZoomToCurvature showCurvatureOverlay={showCurvatureOverlay ?? false} circleCoords={circleCoords} />

              {/* Auto-pan to the currently selected segment point */}
              <MapAutoCenter
                center={current?.latlng ?? null}
                anyLayerOn={showFootpath || showCycling || showShared || showRoadcrossing || showMrtExit || showBusStop || showBusLane || showParkingLot || showKerbLine || showBicycleCrossing || showPathDefects}
                panKey={panKey}
              />

              {/* Fly to specific project bounds when tab is clicked — MUST be last so it overrides MapAutoCenter */}
              <PanToBounds bounds={panToBounds ?? null} panKey={panKey} />

              {/* Refit to the in-focus scope (e.g. selected project tab) on token bump */}
              <FitToFeatures latlngs={scopeLatLngs} fitKey={autoFitKey} />



              {/* 搜索半径可视化 (200m) — follows current segment dot */}
              {activeQueryPoint && (() => {
                const [lat, lon] = activeQueryPoint;
                return (
                  <Circle
                    center={[lat, lon]}
                    radius={200}
                    pathOptions={{
                      color: '#3182ce',
                      fillColor: '#3182ce',
                      fillOpacity: 0.1,
                      dashArray: '5, 5'
                    }}
                  />
                );
              })()}

              {/* GIS layer features (paths, transit, parking, land ownership) —
                  extracted to ./GeoDataPanel/GISLayersOverlay in S2.2 */}
              <GISLayersOverlay gisLayers={gisLayers} toggles={gisToggles} />

              {/* Path Defects - ⚠️ markers within the 200m search radius */}
              {showPathDefects && <DefectsLayer defects={pathDefects} />}

              
              {/* Curvature analysis overlays — extracted to ./GeoDataPanel/CurvatureOverlay in S2.2 */}
              {showCurvatureOverlay && curvData && (
                <CurvatureOverlay curvData={curvData} circleCoords={circleCoords} tripletPoints={tripletPoints} />
              )}

              {/* 所有起点 — rendered in a dedicated pane above GIS overlay layers */}
              <Pane name="segmentsPane" style={{ zIndex: 610 }}>
                {points.map(({ localIdx, globalIdx, latlng, f }) => {
                  const isActive = globalIdx === index;
                  // Hide segments outside the filter set (current segment always shown)
                  if (filterIndexSet && !filterIndexSet.has(localIdx) && !isActive) return null;
                  // Dim segments outside the active focus scope (still shown for context).
                  const inScope = !scopeRange || (globalIdx >= scopeRange.start && globalIdx < scopeRange.start + scopeRange.count);
                  const dimmed = !inScope && !isActive;
                  const baseColor = filterColorMap?.get(localIdx) ?? getSegmentColor(globalIdx);
                  const color = isActive ? MAP_INTERACTION_COLORS.activeSegment : baseColor;
                  const radius = isActive ? 9 : 5;
                  // Handle both new and old column names for backward compatibility
                  const imgRef = f.properties?.["Image Reference"];
                  const isVerified = verifiedSet.has(localIdx);
                  const scoreValue = activeScores[globalIdx]?.["Overall Risk Level"] ?? activeScores[globalIdx]?.["CycleRAP score"];
                  const label = `#${globalIdx + 1} ${imgRef ?? ""} - Score: ${scoreValue?.toFixed(2) ?? "N/A"}${isVerified ? " ✓ Verified" : ""}`;
                  // Include score + verified state in key to force re-render when either changes
                  const keyWithScore = `${globalIdx}-${scoreValue?.toFixed(2) ?? "loading"}-${isVerified ? "v" : "u"}`;

                  return (
                    <Fragment key={keyWithScore}>
                    {/* Verified halo — deep-emerald ring behind the dot, distinct from the
                        yellow-green LOW risk colour so it reads clearly at a glance. */}
                    {isVerified && (
                      <CircleMarker
                        center={latlng}
                        radius={radius + 5}
                        pathOptions={{ color: VERIFIED_HALO_COLOR, weight: 3, opacity: dimmed ? 0.25 : 0.95, fillColor: VERIFIED_HALO_COLOR, fillOpacity: dimmed ? 0.08 : 0.25 }}
                        pane="segmentsPane"
                        interactive={false}
                      />
                    )}
                    <CircleMarker
                      center={latlng}
                      radius={radius}
                      pathOptions={{ color, weight: isActive ? 4 : 1, opacity: dimmed ? 0.25 : 0.9, fillOpacity: dimmed ? 0.15 : (isVerified ? 0.55 : (isActive ? 0.95 : 0.8)) }}
                      pane="segmentsPane"
                      eventHandlers={{
                        click: (e) => {
                          // If in polygon mode, add this point to the polygon and stop propagation
                          if (isPolygonMode || isPolygonAddMode) {
                            L.DomEvent.stopPropagation(e as any);
                            handlePolygonPoint(latlng);
                            return;
                          }

                          if (isDeleteMode) {
                            setSegmentToDelete(globalIdx);
                            setDeleteConfirmationOpen(true);
                          } else if (isPointAddMode) {
                            setSegmentToAdd(globalIdx);
                            setIsAddSegmentsDialogOpen(true);
                          } else {
                            onJump?.(globalIdx);
                          }
                        },
                        mouseover: (e) => {
                          if (isDeleteMode) {
                            e.target.setStyle({ color: MAP_INTERACTION_COLORS.deleteHover, weight: 4 });
                            const target = e.originalEvent.target as HTMLElement;
                            if (target) target.style.cursor = "pointer";
                          }
                        },
                        mouseout: (e) => {
                          if (isDeleteMode) {
                            e.target.setStyle({ color: color, weight: isActive ? 3 : 1 });
                          }
                        }
                      }}
                    >
                      <Tooltip>{isDeleteMode ? "Click to Delete" : (isPointAddMode ? "Click to Copy" : label)}</Tooltip>
                    </CircleMarker>
                    </Fragment>
                  );
                })}
              </Pane>

              {/* Cross-project filtered segments from Path Analysis */}
              {otherProjectsFilterData.length > 0 && (
                <Pane name="crossProjectPane" style={{ zIndex: 609 }}>
                  {otherProjectsFilterData.flatMap(proj => {
                    const projVerified = new Set(verifiedByProject?.[proj.projectName] ?? []);
                    return proj.points.map((pt, i) => {
                      const isVerified = projVerified.has(pt.idx);
                      return (
                        <Fragment key={`xp-${proj.projectName}-${i}`}>
                          {isVerified && (
                            <CircleMarker
                              center={pt.latlng}
                              radius={9}
                              pathOptions={{ color: VERIFIED_HALO_COLOR, weight: 3, opacity: 0.95, fillColor: VERIFIED_HALO_COLOR, fillOpacity: 0.25 }}
                              pane="crossProjectPane"
                              interactive={false}
                            />
                          )}
                          <CircleMarker
                            center={pt.latlng}
                            radius={5}
                            pathOptions={{ color: pt.color, weight: 1, opacity: 0.9, fillOpacity: isVerified ? 0.55 : 0.8 }}
                            pane="crossProjectPane"
                            eventHandlers={{
                              click: () => {
                                // Navigate to the other project, preserving the full filter context
                                sessionStorage.setItem(CODING_FILTER_CONTEXT_KEY, JSON.stringify(filterContext));
                                navigate(
                                  `/coding/${encodeURIComponent(proj.projectName)}?segment=${pt.idx + 1}`,
                                  { state: { returnToAnalysis: true, filterContext } }
                                );
                              },
                            }}
                          >
                            <Tooltip>#{pt.idx + 1} — {proj.projectName}{isVerified ? " ✓ Verified" : ""}</Tooltip>
                          </CircleMarker>
                        </Fragment>
                      );
                    });
                  })}
                </Pane>
              )}

              <PolygonDrawingTool
                active={isPolygonMode || isPolygonAddMode}
                points={polygonPoints}
                onAddPoint={handlePolygonPoint}
                onPointUpdate={handlePointUpdate}
                color={isPolygonAddMode ? "blue" : "red"}
              />

            </MapContainer>
          </Box>
        )}

        {!loading && !err && points.length === 0 && (
          <Text color="gray.500" mt="2">No geodata to show.</Text>
        )}

        <AnalysisSidebar
          variant={variant}
          isOpen={isAnalysisSidebarOpen}
          onToggle={() => setIsAnalysisSidebarOpen(v => !v)}
          showFootpath={showFootpath}
          setShowFootpath={setShowFootpath}
          showCycling={showCycling}
          setShowCycling={setShowCycling}
          showShared={showShared}
          setShowShared={setShowShared}
          showRoadcrossing={showRoadcrossing}
          setShowRoadcrossing={setShowRoadcrossing}
          showMrtExit={showMrtExit}
          setShowMrtExit={setShowMrtExit}
          showBusStop={showBusStop}
          setShowBusStop={setShowBusStop}
          showBusLane={showBusLane}
          setShowBusLane={setShowBusLane}
          showParkingLot={showParkingLot}
          setShowParkingLot={setShowParkingLot}
          showKerbLine={showKerbLine}
          setShowKerbLine={setShowKerbLine}
          showBicycleCrossing={showBicycleCrossing}
          setShowBicycleCrossing={setShowBicycleCrossing}
          showPathDefects={showPathDefects}
          setShowPathDefects={setShowPathDefects}
          showStateLand={showStateLand}
          setShowStateLand={setShowStateLand}
          showStatBoard={showStatBoard}
          setShowStatBoard={setShowStatBoard}
          showLandPrivate={showLandPrivate}
          setShowLandPrivate={setShowLandPrivate}
          showLandMinistry={showLandMinistry}
          setShowLandMinistry={setShowLandMinistry}
          {...(variant === "v2"
            ? { showCurvatureOverlay: showCurvatureOverlay ?? false, onToggleCurvatureOverlay }
            : {})}
        />
      </CardBody>

      {/* Delete Confirmation Dialog */}
      <Dialog.Root open={deleteConfirmationOpen} onOpenChange={(e) => setDeleteConfirmationOpen(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Confirm Deletion</Dialog.Title>
                <Dialog.CloseTrigger />
              </Dialog.Header>
              <Dialog.Body>
                {segmentsToDelete.length > 0
                  ? `Are you sure you want to delete ${segmentsToDelete.length} selected segments?`
                  : `Are you sure you want to delete segment #${segmentToDelete !== null ? segmentToDelete + 1 : "?"}?`
                }
                <br />
                This action cannot be undone.
              </Dialog.Body>
              <Dialog.Footer>
                <Button variant="outline" ref={cancelRef} onClick={() => setDeleteConfirmationOpen(false)}>
                  Cancel
                </Button>
                <Button colorPalette="red" onClick={segmentsToDelete.length > 0 ? handleBatchDelete : handleDeleteSegment}>
                  Delete {segmentsToDelete.length > 0 ? `(${segmentsToDelete.length})` : ""}
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
        }}
        sources={[{
          projectName: decodedName || "",
          indices: segmentToAdd !== null
            ? [segmentToAdd]
            : points
              .filter(p => isPointInPolygon(p.latlng, polygonPoints))
              .map(p => p.globalIdx)
        }]}
        onSuccess={() => {
          setIsPolygonAddMode(false);
          setPolygonPoints([]);
          setSegmentToAdd(null);
          setIsPointAddMode(false); // Reset single point mode
          if (onDataChange) onDataChange();
        }}
      />

    </Card.Root >
  );
}
