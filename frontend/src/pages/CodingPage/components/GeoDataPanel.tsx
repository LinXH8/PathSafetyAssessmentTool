import ThemeAwareTileLayer from "../../../components/common/ThemeAwareTileLayer";
import {
  Card, CardBody, Text, Box, Flex, IconButton, Button,
  Dialog, Portal, Menu
} from "@chakra-ui/react";
import { AnalysisSidebar } from "../../../components/visualization/AnalysisSidebar";
import { FaMousePointer, FaDrawPolygon, FaPlus, FaTrash } from "react-icons/fa";
import { toaster } from "../../../components/ui/toaster";
import { Switch } from "../../../components/ui/switch";
import { AddSegmentsDialog } from "../../PathAnalysisPage/components/AddSegmentsDialog";
import { MapCursorController } from "../../../components/common/MapCursorController";
// import { copySegments } from "../../../api"; // Removed unused import
import type { Feature, FeatureCollection, LineString, Position } from "geojson";
import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { RISK_BAND_COLORS } from "../../../components/visualization/scoreband/colorConstants";
import type { CodingFilterContext } from "../../../api";
import { CODING_FILTER_CONTEXT_KEY } from "../../../api";
import { useNavigate } from "react-router-dom";


import { MapContainer, CircleMarker, Polyline, Polygon, Tooltip, useMap, useMapEvents, Marker, Circle, Pane } from "react-leaflet";
import L, { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";

import proj4 from "proj4";
import type { CurvatureVisualizationResponse } from '../../../api/curvatureVisualization';
import { GRADIENT_STATUS_NO_LIDAR_RESULT, getGradientDisplayState } from "../../../utils/gradientDisplay";

type Props = {
  projectName: string;                       // Current project name from parent
  feature: Feature<LineString, any> | null;  // 当前段（父组件传入）
  index: number;                             // 当前页（父组件传入，0-based）
  onJump?: (idx: number) => void;            // Jump to segment callback
  containerHeight?: number;                  // 容器总高度（包括header）
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
};

type GJ = FeatureCollection<LineString, any>;

// Deep emerald used for the "verified" dot halo. Deliberately distinct from the
// yellow-green LOW risk-band colour (#87C424) so verified state stays legible.
const VERIFIED_HALO_COLOR = "#16A34A";

type ScoreRow = {
  "Overall Risk Level": number;
  [key: string]: any;
};

// --- EPSG:3414 (SVY21 / Singapore TM) 定义 -> EPSG:4326 ---
proj4.defs(
  "EPSG:3414",
  "+proj=tmerc +lat_0=1.366666666666667 +lon_0=103.8333333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs"
);
const to4326 = (p: Position): [number, number] => {
  const x = p[0];
  const y = p[1];
  
  // If arguably already WGS84 (Singapore lon is ~103, lat is ~1.3)
  // Newly created projects natively output EPSG:4326, so we must not project SVY21 -> WGS84.
  if (x >= 90 && x <= 120 && y >= -10 && y <= 20) {
    return [y, x]; // return [lat, lon]
  }

  // 返回 [lat, lng]
  const [lon, lat] = proj4("EPSG:3414", "EPSG:4326", p as [number, number]) as [number, number];
  return [lat, lon];
};

// 小组件：根据点集自动 fit bounds (only on initial load)
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const hasFitRef = useRef(false);
  useEffect(() => {
    if (!points.length || hasFitRef.current) return;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [24, 24] });
    hasFitRef.current = true;
  }, [points, map]);
  return null;
}

// Flies map to given bounds whenever bounds/panKey change (not null).
// panKey is a monotonic counter that forces React to re-fire the effect even when the
// bounds reference hasn't changed (e.g. clicking the same project tab twice).
// The fitBounds call is deferred by one tick (setTimeout 0) so that ALL other React
// effects from the same render commit (MapAutoCenter, ZoomToGIS, etc.) have already
// completed — preventing any animation race conditions.
function PanToBounds({ bounds, panKey }: { bounds: L.LatLngBounds | null; panKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    const timerId = setTimeout(() => {
      // Re-measure the container size — critical for small / side-by-side panels
      // where the layout may have shifted between renders.
      map.invalidateSize();
      // Cancel any in-flight Leaflet animation (setView / flyTo) so fitBounds wins.
      map.stop();
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 18 });
    }, 0);
    return () => clearTimeout(timerId);
  }, [bounds, panKey, map]);
  return null;
}

// Refits the map to a set of latlngs whenever `fitKey` changes (e.g. project tab
// switch). Unlike FitBounds (which only fires once on initial load), this re-fires
// on every token bump. Deferred by a tick so other effects from the same commit settle.
function FitToFeatures({ latlngs, fitKey }: { latlngs: [number, number][]; fitKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (!latlngs.length) return;
    const timerId = setTimeout(() => {
      map.invalidateSize();
      map.stop();
      map.fitBounds(L.latLngBounds(latlngs.map(([lat, lng]) => L.latLng(lat, lng))), { padding: [20, 20], maxZoom: 18 });
    }, 0);
    return () => clearTimeout(timerId);
    // Intentionally only re-fire on fitKey change, not when latlngs reference updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

// Zoom to current point when GIS layers are active
function ZoomToGIS({ center, anyLayerOn }: { center: [number, number] | null; anyLayerOn: boolean }) {
  const map = useMap();
  const prevLayerOnRef = useRef(false);
  useEffect(() => {
    // Zoom in when a layer is turned on (transition from off->on)
    if (anyLayerOn && !prevLayerOnRef.current && center) {
      map.setView(center, 17, { animate: true });
    }
    // When all layers turned off, fit the full route again
    if (!anyLayerOn && prevLayerOnRef.current && center) {
      // Don't force re-fit — just let user navigate freely
    }
    prevLayerOnRef.current = anyLayerOn;
  }, [anyLayerOn, center, map]);
  return null;
}

// Zooms to the curvature analysis 5m circle when the overlay is toggled on.
function ZoomToCurvature({ showCurvatureOverlay, circleCoords }: { showCurvatureOverlay: boolean; circleCoords: [number, number][] | null }) {
  const map = useMap();
  const hasZoomedRef = useRef(false);
  useEffect(() => {
    if (!showCurvatureOverlay) {
      hasZoomedRef.current = false;
      return;
    }
    if (hasZoomedRef.current || !circleCoords || circleCoords.length === 0) return;
    const bounds = L.latLngBounds(circleCoords.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [30, 30] });
    hasZoomedRef.current = true;
  }, [showCurvatureOverlay, circleCoords, map]);
  return null;
}

// Path Defect marker — ⚠️ emoji used in the "Path Defects" overlay.
const defectIcon = divIcon({
  className: "path-defect-marker",
  html: `<div style="font-size:20px;line-height:20px;text-align:center;opacity:0.5;filter:drop-shadow(0 0 2px rgba(0,0,0,0.5));pointer-events:auto;">⚠️</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// Polygon Drawing Tool Component
// Custom icon to mimic CircleMarker but allow dragging
const createCustomIcon = (color: string) => {
  return divIcon({
    className: "custom-polygon-marker",
    html: `<div style="
      background-color: ${color};
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid white;
      box-shadow: 0 0 4px rgba(0,0,0,0.4);
      cursor: grab;
    "></div>`,
    iconSize: [20, 20], // Hit box size
    iconAnchor: [10, 10], // Centered (half of 20)
  });
};

interface DraggableMarkerProps {
  position: [number, number];
  index: number;
  color: string;
  icon: L.DivIcon;
  onDrag: (index: number, latlng: L.LatLng) => void;
  onDragEnd: (index: number, latlng: L.LatLng) => void;
}

function DraggableMarker({ position, index, icon, onDrag, onDragEnd }: DraggableMarkerProps) {
  const eventHandlers = useMemo(
    () => ({
      drag: (e: L.LeafletEvent) => {
        const marker = e.target;
        const pos = marker.getLatLng();
        onDrag(index, pos);
      },
      dragend: (e: L.LeafletEvent) => {
        const marker = e.target;
        const pos = marker.getLatLng();
        onDragEnd(index, pos);
      },
      click: (e: L.LeafletEvent) => {
        L.DomEvent.stopPropagation(e as any);
      },
    }),
    [index, onDrag, onDragEnd]
  );

  return (
    <Marker
      position={position}
      draggable={true}
      icon={icon}
      eventHandlers={eventHandlers}
    />
  );
}

// Polygon Drawing Tool Component
function PolygonDrawingTool({ active, points, onAddPoint, onPointUpdate, color = "orange" }: {
  active: boolean,
  points: [number, number][],
  onAddPoint: (latlng: [number, number]) => void,
  onPointUpdate: (index: number, latlng: [number, number]) => void,
  color?: string
}) {
  const activeRef = useRef(active);
  const polygonRef = useRef<L.Polygon>(null);
  const polylineRef = useRef<L.Polyline>(null);
  const pointsRef = useRef(points);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  const icon = useMemo(() => createCustomIcon(color), [color]);

  useMapEvents({
    click(e) {
      if (activeRef.current) {
        onAddPoint([e.latlng.lat, e.latlng.lng]);
      }
    },
  });

  const handleDrag = useCallback((index: number, latlng: L.LatLng) => {
    const currentPoints = pointsRef.current;
    if (!currentPoints) return;

    // Create new array with updated point
    const newPoints = [...currentPoints];
    newPoints[index] = [latlng.lat, latlng.lng];

    // Convert to Leaflet LatLng objects
    const latLngs = newPoints.map(p => L.latLng(p[0], p[1]));

    // Update Leaflet layers directly
    if (polygonRef.current) {
      polygonRef.current.setLatLngs(latLngs);
    }
    if (polylineRef.current) {
      polylineRef.current.setLatLngs(latLngs);
    }
  }, []);

  const handleDragEnd = useCallback((index: number, latlng: L.LatLng) => {
    onPointUpdate(index, [latlng.lat, latlng.lng]);
  }, [onPointUpdate]);

  if (!active || points.length === 0) return null;

  return (
    <>
      {points.map((p, i) => (
        <DraggableMarker
          key={`poly-point-${i}`}
          position={p}
          index={i}
          color={color}
          icon={icon}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
        />
      ))}
      <Polyline
        ref={polylineRef}
        positions={points}
        pathOptions={{ color: color, dashArray: "5, 5" }}
      />
      {points.length >= 3 && (
        <Polygon
          ref={polygonRef}
          positions={points}
          pathOptions={{ color: color, fillOpacity: 0.2, stroke: false }}
        />
      )}
    </>
  );
}

// PIP Algorithm (Ray Casting)
const isPointInPolygon = (point: [number, number], vs: [number, number][]) => {
  // point: [lat, lon], vs: [[lat, lon], ...]
  // x = lon, y = lat
  const x = point[1], y = point[0];

  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][1], yi = vs[i][0];
    const xj = vs[j][1], yj = vs[j][0];

    const intersect = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// No global cache needed anymore as we use localStorage

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <Flex direction="column" align="center" lineHeight="1.1">
      <Text fontSize="9px" color="gray.400" fontWeight="medium" letterSpacing="wide" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="xs" fontWeight="semibold" color="gray.700" _dark={{ color: "gray.200" }}>
        {value}
      </Text>
    </Flex>
  );
}

export default function GeoDataPanel({ projectName, index, onJump, containerHeight = 650, scores: externalScores, subtitle, geoFeatures: externalGeoFeatures, startIndex = 0, onDataChange, filterContext, verifiedByProject, panToBounds, panKey = 0, scopeRange, autoFitKey = 0, curvData, showCurvatureOverlay, onToggleCurvatureOverlay, widthM, grade, gradientPct, gradientStatus }: Props) {
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

  // Read initial toggle states from localStorage if available
  const cachedLayers = useMemo(() => {
    if (!projectName) return {};
    try {
      const stored = localStorage.getItem(`gisLayerToggles_${projectName}`);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }, [projectName]);
  
  // GIS Layer toggles (matching curvature analysis colors)
  // If the overlay was on when the session ended (overlayEnabled !== false), the 3 path layers
  // were in "overlay-managed" mode — reset them to false because the overlay always starts off.
  // Treating a missing key (old localStorage entries) the same as true migrates stale data.
  const overlayWasOn = cachedLayers.overlayEnabled !== false;
  const [showFootpath, setShowFootpath] = useState(overlayWasOn ? false : (cachedLayers.showFootpath ?? false));  // Blue
  const [showCycling, setShowCycling] = useState(overlayWasOn ? false : (cachedLayers.showCycling ?? false));     // Red
  const [showShared, setShowShared] = useState(overlayWasOn ? false : (cachedLayers.showShared ?? false));       // Orange
  const [showRoadcrossing, setShowRoadcrossing] = useState(cachedLayers.showRoadcrossing ?? false);  // Red
  const [showMrtExit, setShowMrtExit] = useState(cachedLayers.showMrtExit ?? false);     // Cyan
  const [showBusStop, setShowBusStop] = useState(cachedLayers.showBusStop ?? false);     // Purple
  const [showBusLane, setShowBusLane] = useState(cachedLayers.showBusLane ?? false);     // Yellow
  const [showParkingLot, setShowParkingLot] = useState(cachedLayers.showParkingLot ?? false); // Gold
  const [showKerbLine, setShowKerbLine] = useState(cachedLayers.showKerbLine ?? false);   // Deep Pink
  const [showBicycleCrossing, setShowBicycleCrossing] = useState(cachedLayers.showBicycleCrossing ?? false); // Orange
  const [showPathDefects, setShowPathDefects] = useState(cachedLayers.showPathDefects ?? false); // Red
  const [showStateLand, setShowStateLand] = useState(cachedLayers.showStateLand ?? false);
  const [showStatBoard, setShowStatBoard] = useState(cachedLayers.showStatBoard ?? false);
  const [showLandPrivate, setShowLandPrivate] = useState(cachedLayers.showLandPrivate ?? false);
  const [showLandMinistry, setShowLandMinistry] = useState(cachedLayers.showLandMinistry ?? false);

  // Update localStorage whenever these toggles change.
  // overlayEnabled is persisted so the next session knows whether the 3 path layers were
  // in "overlay-managed" mode and should be reset (rather than restored as stale trues).
  useEffect(() => {
    if (!projectName) return;
    localStorage.setItem(`gisLayerToggles_${projectName}`, JSON.stringify({
      showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop, showBusLane, showParkingLot, showKerbLine, showBicycleCrossing, showPathDefects,
      showStateLand, showStatBoard, showLandPrivate, showLandMinistry,
      overlayEnabled: showCurvatureOverlay ?? false,
    }));
  }, [showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop, showBusLane, showParkingLot, showKerbLine, showBicycleCrossing, showPathDefects, showStateLand, showStatBoard, showLandPrivate, showLandMinistry, showCurvatureOverlay, projectName]);

  // Sync GIS toggle states when the project changes. useState initializers only fire
  // on first mount; without this effect, switching projects leaves stale toggle values
  // from the previous project (e.g. footpath/cycling/shared left on by Analysis Overlay).
  useEffect(() => {
    const wasOn = cachedLayers.overlayEnabled !== false;
    setShowFootpath(wasOn ? false : (cachedLayers.showFootpath ?? false));
    setShowCycling(wasOn ? false : (cachedLayers.showCycling ?? false));
    setShowShared(wasOn ? false : (cachedLayers.showShared ?? false));
    setShowRoadcrossing(cachedLayers.showRoadcrossing ?? false);
    setShowMrtExit(cachedLayers.showMrtExit ?? false);
    setShowBusStop(cachedLayers.showBusStop ?? false);
    setShowBusLane(cachedLayers.showBusLane ?? false);
    setShowParkingLot(cachedLayers.showParkingLot ?? false);
    setShowKerbLine(cachedLayers.showKerbLine ?? false);
    setShowBicycleCrossing(cachedLayers.showBicycleCrossing ?? false);
    setShowPathDefects(cachedLayers.showPathDefects ?? false);
    setShowStateLand(cachedLayers.showStateLand ?? false);
    setShowStatBoard(cachedLayers.showStatBoard ?? false);
    setShowLandPrivate(cachedLayers.showLandPrivate ?? false);
    setShowLandMinistry(cachedLayers.showLandMinistry ?? false);
  }, [cachedLayers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-enable path layers when Analysis Overlay is turned on; never auto-disable them
  useEffect(() => {
    if (!showCurvatureOverlay) return;
    if (!showFootpath) setShowFootpath(true);
    if (!showCycling) setShowCycling(true);
    if (!showShared) setShowShared(true);
  }, [showCurvatureOverlay]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [isAnalysisSidebarOpen, setIsAnalysisSidebarOpen] = useState(false);

  // Delete Mode State
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [isPointAddMode, setIsPointAddMode] = useState(false);
  const [isPolygonMode, setIsPolygonMode] = useState(false); // Polygon batch delete mode
  const [isPolygonAddMode, setIsPolygonAddMode] = useState(false); // Polygon batch copy mode
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [isAddSegmentsDialogOpen, setIsAddSegmentsDialogOpen] = useState(false);
  const [segmentToDelete, setSegmentToDelete] = useState<number | null>(null);
  const [segmentToAdd, setSegmentToAdd] = useState<number | null>(null);
  const [segmentsToDelete, setSegmentsToDelete] = useState<number[]>([]); // For batch delete
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Clear single selections when toggling point modes
  useEffect(() => {
    if (!isDeleteMode && !isPointAddMode) {
      setSegmentToDelete(null);
      setSegmentToAdd(null);
    }
  }, [isDeleteMode, isPointAddMode]);

  // Clear polygon points and close dialog when toggling polygon mode
  useEffect(() => {
    setPolygonPoints([]);
    setDeleteConfirmationOpen(false);
    setSegmentsToDelete([]);
  }, [isPolygonMode]);

  // GIS Layer data
  type GISLayerFeature = {
    coordinates: [number, number][];
    properties: { width?: number };
    geometry_type?: "line" | "point" | "polygon";
  };
  type GISLayers = {
    footpath: GISLayerFeature[];
    cycling: GISLayerFeature[];
    shared: GISLayerFeature[];
    roadcrossing: GISLayerFeature[];
    mrt_exit: GISLayerFeature[];
    bicycle_crossing: GISLayerFeature[];
    bus_stop: GISLayerFeature[];
    bus_lane: GISLayerFeature[];
    parking_lot: GISLayerFeature[];
    kerb_line: GISLayerFeature[];
  };
  const [gisLayers, setGisLayers] = useState<GISLayers | null>(null);

  // Path Defects overlay (xlsx-backed defect inspection records)
  type PathDefect = {
    lat: number;
    lon: number;
    type_of_defect: string;
    location: string;
    date_of_inspection: string;
  };
  const [pathDefects, setPathDefects] = useState<PathDefect[] | null>(null);

  // 拉取整条 geodata（如果没有 external geofeatures）
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

  // 取每条 LineString 的首点（转 4326），并保留原 feature
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

  // 当前高亮点 - use globalIdx to match the index prop (global index)
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

  // Convert triplet points from EPSG:3414 to WGS84 (lat, lon) for display
  const tripletPoints: [number, number][] | null = useMemo(() => {
    if (!curvData?.diagnostics?.min_triplet?.points) return null;

    try {
      if (!proj4.defs('EPSG:3414')) {
        proj4.defs('EPSG:3414', '+proj=tmerc +lat_0=1.366666666666667 +lon_0=103.8333333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs');
      }
      return curvData.diagnostics.min_triplet.points.map(([x, y]: [number, number]) => {
        const [lon, lat] = proj4('EPSG:3414', 'WGS84', [x, y]);
        return [lat, lon] as [number, number];
      });
    } catch (error) {
      return null;
    }
  }, [curvData]);
  
  const circleCoords: [number, number][] | null = useMemo(() => {
    if (!curvData?.circle_geojson?.geometry?.coordinates?.[0]) return null;
    return curvData.circle_geojson.geometry.coordinates[0].map(
      ([lon, lat]: [number, number]) => [lat, lon] as [number, number]
    );
  }, [curvData]);

  const gradientState = getGradientDisplayState(
    { grade, gradientPct, gradientStatus },
    { percentDigits: 1 },
  );

  // 初始中心（无数据时默认新加坡中心点）
  const initialCenter = useRef<[number, number]>([1.3521, 103.8198]);

  // Fetch GIS layers when any toggle is turned on and we have a current point
  // Skip GIS layers when using external geofeatures from multiple projects
  useEffect(() => {
    // Don't fetch GIS layers for multi-project display
    // if (hasExternalGeoFeatures) {
    //   setGisLayers(null);
    //   return;
    // }

    if (!decodedName || activeGisLat === null || activeGisLon === null) return;

    const anyLayerEnabled = showFootpath || showCycling || showShared || showRoadcrossing || showMrtExit || showBusStop || showBusLane || showParkingLot || showKerbLine || showBicycleCrossing || showStateLand || showStatBoard || showLandPrivate || showLandMinistry;
    if (!anyLayerEnabled) {
      setGisLayers(null);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const lat = activeGisLat;
        const lon = activeGisLon;

        const layers = [];
        if (showCycling) layers.push('cycling');
        if (showShared) layers.push('shared');
        if (showFootpath) layers.push('footpath');
        if (showRoadcrossing) layers.push('roadcrossing');
        if (showMrtExit) layers.push('mrt_exit');
        if (showBicycleCrossing) layers.push('bicycle_crossing');
        if (showBusStop) layers.push('bus_stop');
        if (showBusLane) layers.push('bus_lane');
        if (showParkingLot) layers.push('parking_lot');
        if (showKerbLine) layers.push('kerb_line');
        if (showStateLand) layers.push('state_land');
        if (showStatBoard) layers.push('stat_board');
        if (showLandPrivate) layers.push('land_private');
        if (showLandMinistry) layers.push('land_ministry');

        // Fetch GIS layers near the active query point
        const res = await fetch(`/api/projects/${encodeURIComponent(decodedName)}/gis/layers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            point: [lon, lat],  // API expects [lon, lat]
            radius: 200,
            layers: layers
          }),
          signal: controller.signal
        });

        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        const data = await res.json();

        if (data.ok) {
          setGisLayers(data.layers);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.error("[GIS] Fetch error:", e);
        }
      }
    })();

    return () => { controller.abort(); };
  }, [decodedName, activeGisLat, activeGisLon, showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop, showBusLane, showParkingLot, showKerbLine, showBicycleCrossing, showStateLand, showStatBoard, showLandPrivate, showLandMinistry, hasExternalGeoFeatures]);

  // Fetch Path Defects within the search radius around the active query point.
  // Kept separate from the GIS layers fetch so toggling defects doesn't refetch
  // every GIS layer (and vice versa).
  useEffect(() => {
    if (activeGisLat === null || activeGisLon === null) return;
    if (!showPathDefects) {
      setPathDefects(null);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/defects/nearby`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            point: [activeGisLon, activeGisLat],
            radius: 200,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        const data = await res.json();
        if (data.ok) setPathDefects(data.defects ?? []);
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.error("[Defects] Fetch error:", e);
        }
      }
    })();

    return () => { controller.abort(); };
  }, [activeGisLat, activeGisLon, showPathDefects]);

  // Layer colors matching curvature analysis
  const layerColors = {
    footpath: "#1E90FF",    // DodgerBlue
    cycling: "#B91C1C",     // Deep Red
    shared: "#A855F7",      // Purple
    roadcrossing: "#10B981", // Emerald/Green
    mrt_exit: "#06B6D4",    // Cyan
    bicycle_crossing: "#F97316", // Orange
    bus_stop: "#8B5CF6",    // Purple
    bus_lane: "#EAB308",    // Yellow
    parking_lot: "#D97706", // Amber/Gold
    kerb_line: "#D946EF",   // Fuchsia
    state_land: "#14B8A6",  // Teal
    stat_board: "#F59E0B",  // Amber
    land_private: "#6366F1", // Indigo
    land_ministry: "#EC4899", // Pink
  };

  // Get segment color based on the crash type with the highest score
  const getSegmentColor = (segmentIndex: number): string => {
    if (!activeScores || segmentIndex >= activeScores.length) {
      return "#2563EB"; // Default blue if no scores
    }

    const segmentScores = activeScores[segmentIndex];
    if (!segmentScores) {
      return "#2563EB"; // Default blue if no score data for this segment
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

  const handleDeleteSegment = useCallback(async () => {
    if (segmentToDelete === null || !decodedName) return;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(decodedName)}/segments/${segmentToDelete}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error(await res.text().catch(() => res.statusText));
      }

      toaster.create({
        title: "Point Deleted",
        description: `Segment #${segmentToDelete + 1} deleted successfully.`,
        type: "success",
      });

      // Clear selection and close dialog
      setSegmentToDelete(null);
      setDeleteConfirmationOpen(false);
      setIsDeleteMode(false);

      // Trigger data refresh if callback provided
      if (onDataChange) {
        onDataChange();
      } else {
        // Fallback: reload page? Or maybe just re-fetch Geodata? 
        // Re-fetching geodata isn't enough as indices shift globally.
        // Ideally parent should handle this.
        window.location.reload();
      }

    } catch (e: any) {
      toaster.create({
        title: "Delete Failed",
        description: e?.message ?? "Failed to delete segment",
        type: "error",
      });
    }
  }, [segmentToDelete, decodedName, onDataChange]);

  // Handle adding points to polygon
  const handlePolygonPoint = useCallback((latlng: [number, number]) => {
    setPolygonPoints(prev => {
      // Double click logic is hard with simple click handler, using a Close button instead usually better
      // But let's check if clicked near first point to close?
      // Or just let user click a "Finish" button.
      // Let's rely on a "Finish Selection" button in the header instead of complex map interaction.
      return [...prev, latlng];
    });
  }, []);

  // Handle updating points when dragged
  const handlePointUpdate = useCallback((index: number, latlng: [number, number]) => {
    setPolygonPoints(prev => {
      const newPoints = [...prev];
      newPoints[index] = latlng;
      return newPoints;
    });
  }, []);

  // Finish Polygon Selection: Find points inside and confirm
  const finishPolygonSelection = useCallback(() => {
    if (polygonPoints.length < 3) {
      toaster.create({ title: "Invalid Polygon", description: "Need at least 3 points.", type: "warning" });
      return;
    }

    // Find all points inside
    const indicesInside: number[] = [];
    points.forEach(p => {
      if (isPointInPolygon(p.latlng, polygonPoints)) {
        indicesInside.push(p.globalIdx);
      }
    });

    if (indicesInside.length === 0) {
      toaster.create({ title: "No Points Selected", description: "No points found inside the polygon.", type: "info" });
      setPolygonPoints([]);
      setIsPolygonMode(false);
      return;
    }

    setSegmentsToDelete(indicesInside);
    setDeleteConfirmationOpen(true);
  }, [polygonPoints, points]);

  // Handle Batch Deletion
  const handleBatchDelete = useCallback(async () => {
    if (segmentsToDelete.length === 0 || !decodedName) return;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(decodedName)}/segments/delete-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indices: segmentsToDelete })
      });

      if (!res.ok) {
        throw new Error(await res.text().catch(() => res.statusText));
      }

      toaster.create({
        title: "Batch Delete Successful",
        description: `Deleted ${segmentsToDelete.length} segments.`,
        type: "success",
      });

      // Reset states
      setSegmentsToDelete([]);
      setPolygonPoints([]);
      setDeleteConfirmationOpen(false);
      setIsPolygonMode(false);
      setIsDeleteMode(false); // also turn off single delete mode if on

      // Refresh
      if (onDataChange) {
        onDataChange();
      } else {
        window.location.reload();
      }

    } catch (e: any) {
      toaster.create({
        title: "Delete Failed",
        description: e?.message ?? "Failed to delete segments",
        type: "error",
      });
    }
  }, [segmentsToDelete, decodedName, onDataChange]);

  const finishAddSegmentsSelection = useCallback(() => {
    if (polygonPoints.length < 3) {
      toaster.create({ title: "Invalid Polygon", description: "Need at least 3 points.", type: "warning" });
      return;
    }
    const indices = points
      .filter(p => isPointInPolygon(p.latlng, polygonPoints))
      .map(p => p.globalIdx);

    if (indices.length === 0) {
      toaster.create({ title: "No Segments", description: "No segments selected.", type: "warning" });
      return;
    }

    setIsAddSegmentsDialogOpen(true);
  }, [polygonPoints, points]);


  return (
    <Card.Root display="flex" flexDirection="column" h={`${containerHeight}px`} overflow="hidden" borderRadius="none">
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
        <Flex align="center" gap="1.5" ml="auto">
          <Flex align="center" gap="3" mr="2" pr="2" borderRight="1px solid" borderColor="gray.200" _dark={{ borderColor: "gray.600" }}>
            <StatPill
              label="Curv"
              value={curvData?.radius != null ? `${curvData.radius.toFixed(1)} m` : "—"}
            />
            <StatPill
              label="Width"
              value={widthM != null ? `${widthM.toFixed(2)} m` : "—"}
            />
            <StatPill
              label="Grade"
              value={
                gradientState.mode === "grade"
                  ? gradientState.text.replace("Grade 1 (<5°)", "<5°").replace("Grade 2 (≥5°)", "≥5°")
                  : gradientState.text === GRADIENT_STATUS_NO_LIDAR_RESULT
                    ? "N/A"
                    : gradientState.text
              }
            />
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
      </Box>

          {/* Tools + GIS layer toggles */}
          <Box px="4" pt="2" pb="2" borderBottom="1px solid" borderColor="gray.200" _dark={{ borderColor: "gray.700" }}>
            {/* Tool icon buttons */}
            <Flex align="center" gap="2" wrap="wrap" mb="2" onClick={(e) => e.stopPropagation()}>
              <Menu.Root positioning={{ placement: "bottom-end", strategy: "fixed" }}>
                <Menu.Trigger asChild>
                  <IconButton
                    aria-label="Single Point Tools"
                    size="xs"
                    variant={(isDeleteMode || isPointAddMode) ? "solid" : "ghost"}
                    colorPalette={(isDeleteMode || isPointAddMode) ? (isDeleteMode ? "red" : "blue") : "gray"}
                    onClick={(e) => {
                      if (isDeleteMode || isPointAddMode) {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDeleteMode(false);
                        setIsPointAddMode(false);
                        setIsPolygonMode(false);
                        setIsPolygonAddMode(false);
                        setPolygonPoints([]);
                      }
                    }}
                    title="Single Point Tools"
                  >
                    {isPointAddMode ? <FaPlus /> : (isDeleteMode ? <FaTrash /> : <FaMousePointer />)}
                  </IconButton>
                </Menu.Trigger>
                <Menu.Positioner>
                  <Menu.Content zIndex={1500}>
                    <Menu.Item
                      value="delete"
                      onClick={() => {
                        setIsDeleteMode(true);
                        setIsPointAddMode(false);
                        setIsPolygonMode(false);
                        setIsPolygonAddMode(false);
                        setPolygonPoints([]);
                      }}
                    >
                      <FaMousePointer /> Single Point Delete
                    </Menu.Item>
                    <Menu.Item
                      value="add"
                      onClick={() => {
                        setIsDeleteMode(false);
                        setIsPointAddMode(true);
                        setIsPolygonMode(false);
                        setIsPolygonAddMode(false);
                        setPolygonPoints([]);
                      }}
                    >
                      <FaPlus /> Single Point Copy
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Menu.Root>

              <Menu.Root positioning={{ placement: "bottom-start", strategy: "fixed" }}>
                <Menu.Trigger asChild>
                  <IconButton
                    aria-label="Polygon Tools"
                    variant={(isPolygonMode || isPolygonAddMode) ? "solid" : "ghost"}
                    size="xs"
                    colorPalette={(isPolygonMode || isPolygonAddMode) ? (isPolygonMode ? "orange" : "blue") : "gray"}
                    title="Polygon Tools"
                    onClick={(e) => {
                      if (isPolygonMode || isPolygonAddMode) {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsPolygonMode(false);
                        setIsPolygonAddMode(false);
                        setIsDeleteMode(false);
                        setIsPointAddMode(false);
                        setPolygonPoints([]);
                      }
                    }}
                  >
                    {isPolygonAddMode ? <FaPlus /> : (isPolygonMode ? <FaTrash /> : <FaDrawPolygon />)}
                  </IconButton>
                </Menu.Trigger>
                <Menu.Positioner>
                  <Menu.Content zIndex={1500}>
                    <Menu.Item
                      value="delete"
                      onClick={() => {
                        setIsPolygonMode(true);
                        setIsPolygonAddMode(false);
                        setIsDeleteMode(false);
                        setIsPointAddMode(false);
                        setPolygonPoints([]);
                        setDeleteConfirmationOpen(false);
                      }}
                    >
                      <FaTrash /> Delete Segments
                    </Menu.Item>
                    <Menu.Item
                      value="add"
                      onClick={() => {
                        setIsPolygonMode(false);
                        setIsPolygonAddMode(true);
                        setIsDeleteMode(false);
                        setIsPointAddMode(false);
                        setPolygonPoints([]);
                        setDeleteConfirmationOpen(false);
                      }}
                    >
                      <FaPlus /> Copy/Add Segments
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Menu.Root>

              {isPolygonMode && (
                <Button
                  size="xs"
                  variant="outline"
                  colorPalette="orange"
                  disabled={polygonPoints.length < 3}
                  onClick={finishPolygonSelection}
                >
                  Delete Selected ({
                    points.filter(p => isPointInPolygon(p.latlng, polygonPoints)).length
                  } segments)
                </Button>
              )}

              {isPolygonAddMode && (
                <Button
                  size="xs"
                  variant="outline"
                  colorPalette="blue"
                  disabled={polygonPoints.length < 3}
                  onClick={finishAddSegmentsSelection}
                >
                  Copy Selected ({
                    points.filter(p => isPointInPolygon(p.latlng, polygonPoints)).length
                  } segments)
                </Button>
              )}
            </Flex>

        </Box>
      <CardBody flex="1" minH={0} p={0} position="relative">
        {loading && <Text color="gray.500">Loading map…</Text>}
        {err && <Text color="red.600">Failed: {err}</Text>}

        {!loading && !err && (
          <Box border="1px solid" borderColor="gray.200" borderRadius="md" overflow="hidden" h="100%">
            <MapContainer
              center={initialCenter.current}
              zoom={13}
              maxZoom={22}
              style={{ width: "100%", height: "100%" }}
              scrollWheelZoom
            >
              <MapCursorController
                mode={(isDeleteMode || isPolygonMode) ? 'delete' : (isPointAddMode || isPolygonAddMode) ? 'add' : 'default'}
              />
              {/* CartoDB Light basemap - same as Curvature Analysis */}
              <ThemeAwareTileLayer />

              {/* 数据范围自适应 (first load only) */}
              {allLatLngs.length > 0 && <FitBounds points={allLatLngs} />}

              {/* Auto-zoom to current point when GIS layers active */}
              <ZoomToGIS
                center={activeQueryPoint}
                anyLayerOn={showFootpath || showCycling || showShared || showRoadcrossing || showMrtExit || showBusStop || showBusLane || showParkingLot || showKerbLine || showBicycleCrossing || showPathDefects}
              />

              {/* Zoom to the 5m curvature circle when the overlay is enabled */}
              <ZoomToCurvature showCurvatureOverlay={showCurvatureOverlay ?? false} circleCoords={circleCoords} />

              {/* 自动跟随当前选中点 */}
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

              {/* GIS Layers - Render below the segment points */}
              {gisLayers && showFootpath && gisLayers.footpath && (
                gisLayers.footpath.map((feature, i) => (
                  <Polyline
                    key={`footpath-${i}`}

                    positions={feature.coordinates.map(([lon, lat]) => [lat, lon])}
                    pathOptions={{
                      color: layerColors.footpath,
                      weight: 3,
                      opacity: 0.8
                    }}
                  />
                ))
              )}

              {gisLayers && showCycling && gisLayers.cycling && (
                gisLayers.cycling.map((feature, i) => (
                  <Polyline
                    key={`cycling-${i}`}

                    positions={feature.coordinates.map(([lon, lat]) => [lat, lon])}
                    pathOptions={{
                      color: layerColors.cycling,
                      weight: 3,
                      opacity: 0.8
                    }}
                  />
                ))
              )}

              {gisLayers && showShared && gisLayers.shared && (
                gisLayers.shared.map((feature, i) => (
                  <Polyline
                    key={`shared-${i}`}

                    positions={feature.coordinates.map(([lon, lat]) => [lat, lon])}
                    pathOptions={{
                      color: layerColors.shared,
                      weight: 3,
                      opacity: 0.8
                    }}
                  />
                ))
              )}

              {gisLayers && showRoadcrossing && gisLayers.roadcrossing && (
                gisLayers.roadcrossing.map((feature, i) => (
                  <Polyline
                    key={`roadcrossing-${i}`}

                    positions={feature.coordinates.map(([lon, lat]) => [lat, lon])}
                    pathOptions={{
                      color: layerColors.roadcrossing,
                      weight: 3,
                      opacity: 0.8
                    }}
                  />
                ))
              )}

              {/* MRT Exit - Point layer rendered as CircleMarkers */}
              {gisLayers && showMrtExit && gisLayers.mrt_exit && (
                gisLayers.mrt_exit.map((feature, i) => (
                  <CircleMarker
                    key={`mrt_exit-${i}`}

                    center={[feature.coordinates[0][1], feature.coordinates[0][0]]}
                    radius={6}
                    pathOptions={{
                      color: layerColors.mrt_exit,
                      weight: 2,
                      opacity: 0.9,
                      fillOpacity: 0.7
                    }}
                  >
                    <Tooltip>MRT Exit</Tooltip>
                  </CircleMarker>
                ))
              )}

              {/* Bus Stop - Point or Line (Shelters) */}
              {gisLayers && showBusStop && gisLayers.bus_stop && (
                gisLayers.bus_stop.map((feature, i) => {
                  if (feature.geometry_type === "point") {
                    return (
                      <CircleMarker
                        key={`bus_stop-${i}`}
    
                        center={[feature.coordinates[0][1], feature.coordinates[0][0]]}
                        radius={6}
                        pathOptions={{
                          color: layerColors.bus_stop,
                          weight: 2,
                          opacity: 0.9,
                          fillOpacity: 0.7
                        }}
                      >
                        <Tooltip>Bus Stop</Tooltip>
                      </CircleMarker>
                    );
                  } else if (feature.geometry_type === "line") {
                    return (
                      <Polyline
                        key={`bus_shelter-${i}`}
    
                        positions={feature.coordinates.map(c => [c[1], c[0]])}
                        pathOptions={{
                          color: layerColors.bus_stop,
                          weight: 4,
                          opacity: 0.8
                        }}
                      >
                        <Tooltip>Bus Shelter</Tooltip>
                      </Polyline>
                    );
                  }
                  return null;
                })
              )}

              {/* Bus Lane - LineString or MultiLineString layer */}
              {gisLayers && showBusLane && gisLayers.bus_lane && (
                gisLayers.bus_lane.map((feature, i) => {
                  const coords = feature.coordinates;
                  // If it's a MultiLineString structure (array of arrays of coordinates)
                  const isMulti = Array.isArray(coords[0]) && Array.isArray(coords[0][0]);
                  
                  if (isMulti) {
                    return (coords as any).map((line: any, j: number) => (
                      <Polyline
                        key={`bus_lane-${i}-${j}`}
    
                        positions={line.map((c: any) => [c[1], c[0]])}
                        pathOptions={{
                          color: layerColors.bus_lane,
                          weight: 4,
                          opacity: 0.8,
                          dashArray: "5, 10"
                        }}
                      >
                         <Tooltip>Bus Lane</Tooltip>
                      </Polyline>
                    ));
                  }

                  return (
                    <Polyline
                      key={`bus_lane-${i}`}
  
                      positions={coords.map((c: any) => [c[1], c[0]])}
                      pathOptions={{
                        color: layerColors.bus_lane,
                        weight: 4,
                        opacity: 0.8,
                        dashArray: "5, 10"
                      }}
                    >
                       <Tooltip>Bus Lane</Tooltip>
                    </Polyline>
                  );
                })
              )}

              {/* Parking Lot - Polygon layer */}
              {gisLayers && showParkingLot && gisLayers.parking_lot && (
                gisLayers.parking_lot.map((feature, i) => {
                  const geomType = feature.geometry_type;
                  if (geomType === "polygon") {
                    return (
                      <Polygon
                        key={`parking_lot-${i}`}
    
                        positions={feature.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
                        pathOptions={{
                          color: layerColors.parking_lot,
                          weight: 2,
                          opacity: 0.8,
                          fillOpacity: 0.3
                        }}
                      >
                        <Tooltip>Parking Lot</Tooltip>
                      </Polygon>
                    );
                  }
                  // Fallback: render as point if geometry_type is "point"
                  return (
                    <CircleMarker
                      key={`parking_lot-${i}`}
  
                      center={[feature.coordinates[0][1], feature.coordinates[0][0]]}
                      radius={6}
                      pathOptions={{
                        color: layerColors.parking_lot,
                        weight: 2,
                        opacity: 0.9,
                        fillOpacity: 0.7
                      }}
                    >
                      <Tooltip>Parking Lot</Tooltip>
                    </CircleMarker>
                  );
                })
              )}

              {/* Kerb Line - LineString layer */}
              {gisLayers && showKerbLine && gisLayers.kerb_line && (
                gisLayers.kerb_line.map((feature, i) => (
                  <Polyline
                    key={`kerb_line-${i}`}

                    positions={feature.coordinates.map(([lon, lat]) => [lat, lon])}
                    pathOptions={{
                      color: layerColors.kerb_line,
                      weight: 3,
                      opacity: 0.8
                    }}
                  />
                ))
              )}

              {/* Bicycle Crossing - Point layer rendered as CircleMarkers */}
              {gisLayers && showBicycleCrossing && gisLayers.bicycle_crossing && (
                gisLayers.bicycle_crossing.map((feature, i) => (
                  <CircleMarker
                    key={`bicycle_crossing-${i}`}

                    center={[feature.coordinates[0][1], feature.coordinates[0][0]]}
                    radius={6}
                    pathOptions={{
                      color: layerColors.bicycle_crossing,
                      weight: 2,
                      opacity: 0.9,
                      fillOpacity: 0.7
                    }}
                  >
                    <Tooltip>Bicycle Crossing</Tooltip>
                  </CircleMarker>
                ))
              )}

              {/* Land Ownership - Polygon layers */}
              {gisLayers && showStateLand && gisLayers.state_land && (
                gisLayers.state_land.map((feature, i) => (
                  <Polygon
                    key={`state_land-${i}`}

                    positions={feature.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
                    pathOptions={{ color: layerColors.state_land, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}
                  >
                    <Tooltip>{feature.properties?.OWNRSHP_CL ?? "State Land"}</Tooltip>
                  </Polygon>
                ))
              )}

              {gisLayers && showStatBoard && gisLayers.stat_board && (
                gisLayers.stat_board.map((feature, i) => (
                  <Polygon
                    key={`stat_board-${i}`}

                    positions={feature.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
                    pathOptions={{ color: layerColors.stat_board, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}
                  >
                    <Tooltip>{feature.properties?.OWNRSHP_CL ?? "Stat Board"}</Tooltip>
                  </Polygon>
                ))
              )}

              {gisLayers && showLandPrivate && gisLayers.land_private && (
                gisLayers.land_private.map((feature, i) => (
                  <Polygon
                    key={`land_private-${i}`}

                    positions={feature.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
                    pathOptions={{ color: layerColors.land_private, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}
                  >
                    <Tooltip>{feature.properties?.OWNRSHP_CL ?? "Private Land"}</Tooltip>
                  </Polygon>
                ))
              )}

              {gisLayers && showLandMinistry && gisLayers.land_ministry && (
                gisLayers.land_ministry.map((feature, i) => (
                  <Polygon
                    key={`land_ministry-${i}`}

                    positions={feature.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
                    pathOptions={{ color: layerColors.land_ministry, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}
                  >
                    <Tooltip>{feature.properties?.OWNRSHP_CL ?? "Ministry Land"}</Tooltip>
                  </Polygon>
                ))
              )}

              {/* Path Defects - ⚠️ markers within the 200m search radius */}
              {showPathDefects && pathDefects?.map((d, i) => (
                <Marker
                  key={`defect-${i}`}
                  position={[d.lat, d.lon]}
                  icon={defectIcon}
                >
                  <Tooltip>{`${d.type_of_defect || "Defect"} — ${d.location || "Unknown"}${d.date_of_inspection ? ` (${d.date_of_inspection})` : ""}`}</Tooltip>
                </Marker>
              ))}

              
              {/* === Curvature Analysis Overlays === */}
              {showCurvatureOverlay && curvData && (
                <>
                  {/* Black circle outline (5m analysis window) */}
                  {circleCoords && (
                    <Polyline
                      positions={circleCoords}
                      pathOptions={{ color: '#000000', weight: 5, fill: false, opacity: 1 }}
                    />
                  )}
                  {/* Path centerlines (color-coded) */}
                  {curvData.paths?.map((path: any, pathIdx: number) => {
                    const pathCoords = path.coordinates.map(([lon, lat]: [number, number]) => [lat, lon] as [number, number]);
                    return (
                      <Polyline
                        key={`curv-path-${pathIdx}`}
                        positions={pathCoords}
                        pathOptions={{
                          color: `rgb(${path.color.join(',')})`,
                          weight: path.is_analysis_layer ? 6 : 4,
                          opacity: path.is_analysis_layer ? 1 : 0.8,
                        }}
                      />
                    );
                  })}
                  {/* Red dot (analysis point) */}
                  {curvData.point && (
                    <CircleMarker
                      center={[curvData.point.lat, curvData.point.lon]}
                      radius={12}
                      pathOptions={{ fillColor: '#ff0000', fillOpacity: 1, color: '#ffffff', weight: 3 }}
                    />
                  )}
                  {/* Blue triplet points (P1, P2, P3) */}
                  {tripletPoints?.map((pt, ptIdx) => (
                    <CircleMarker
                      key={`triplet-${ptIdx}`}
                      center={pt}
                      radius={8}
                      pathOptions={{ fillColor: '#1E90FF', fillOpacity: 1, color: '#ffffff', weight: 2 }}
                    />
                  ))}
                </>
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
                  const color = isActive ? "#1E63D8" : baseColor;
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
                            e.target.setStyle({ color: "red", weight: 4 });
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
