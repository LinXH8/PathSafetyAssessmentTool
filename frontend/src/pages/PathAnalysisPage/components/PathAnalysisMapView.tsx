import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Text, Tabs, Button, Flex, HStack, Portal, Input, IconButton, Dialog } from "@chakra-ui/react";
import { toaster } from "../../../components/ui/toaster";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, useMapEvents, Polygon as LeafletPolygon, Polyline as LeafletPolyline, Marker, Pane } from "react-leaflet";
import { FaDrawPolygon, FaMousePointer, FaPlus, FaTrash } from "react-icons/fa";
import { Slider } from "../../../components/ui/slider";
import { NUMERIC_FILTER_ATTRIBUTES, ATTRIBUTE_OPTIONS, ATTRIBUTE_LABELS, getCategoryColor, SUBCATEGORY_MAP, MULTI_VALUE_ATTRS, SUBCATEGORY_CHILD_ATTRS } from "./AttributesDropdown";
import { AddSegmentsDialog } from "./AddSegmentsDialog";
import { Menu } from "@chakra-ui/react";
import { MapCursorController } from "../../../components/common/MapCursorController";
import { AnalysisSidebar } from "../../../components/visualization/AnalysisSidebar";

import "leaflet/dist/leaflet.css";
import L, { divIcon } from "leaflet";
import proj4 from "proj4";
import type { Feature, FeatureCollection, GeoJsonProperties, LineString, MultiLineString, MultiPolygon, Polygon, Position } from "geojson";
import { fetchProjectAttributes, fetchProjectGeoJSON, fetchAttributeMappings, calculateScore, fetchProjectResults, downloadFilteredImages, exportShapefile, deleteSegment, deleteSegmentsBatch, previewUploadedShapefiles, type AttributeRow, type CodingFilterContext, type FilteredProjectData, CODING_FILTER_CONTEXT_KEY } from "../../../api";
import { getSegmentRiskBandColor } from "../../../components/visualization/scoreband/colorConstants";

const SAFETY_FOCUS_ATTRIBUTES = new Set(["VB Band", "BB Band", "SB Band", "BP Band", "Overall Risk Level"]);

// Attributes whose missing/blank value defaults to "Adequate" (code 1) per
// backend/src/CycleRAP/defaults.json. Scoring applies the same default
// (row.get(attr, 1)) and the coding panel renders "Adequate" for a blank cell,
// so Path Analysis must treat blank as "Adequate" too — otherwise the many
// segments that were never explicitly coded (null in attributes.csv) get dropped
// from visibleSegments and never appear even when "Adequate" is toggled on.
const ADEQUACY_DEFAULT_ATTRS = new Set(["Line of Sight", "Facility access"]);
interface UploadedBoundaryFeature {
  key: string;
  label: string;
  kind: "polygon" | "line";
  coords?: [number, number][];
  lineCoordsSets?: [number, number][][];
}

const FEATURE_LABEL_KEYS = [
  "name", "Name", "NAME", "label", "Label", "LABEL",
  "pln_area_n", "PLN_AREA_N", "subzone_n", "SUBZONE_N",
  "region_n", "REGION_N", "id", "ID", "OBJECTID", "FID",
];

function getUploadedBoundaryLabel(properties: GeoJsonProperties | null | undefined, featureIndex: number): string {
  if (properties) {
    for (const key of FEATURE_LABEL_KEYS) {
      const value = properties[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
  }
  return `Feature ${featureIndex + 1}`;
}

function toShapefileLeafletCoords(ring: number[][]): [number, number][] {
  return ring
    .filter((coord) => coord.length >= 2 && Number.isFinite(coord[0]) && Number.isFinite(coord[1]))
    .map(([lng, lat]) => [lat, lng]);
}

function extractUploadedBoundaryFeatures(collection: FeatureCollection): UploadedBoundaryFeature[] {
  const boundaries: UploadedBoundaryFeature[] = [];
  const aggregatedLineCoords: number[][][] = [];
  const aggregatedLineLabels: string[] = [];

  collection.features.forEach((feature, featureIndex) => {
    const baseLabel = getUploadedBoundaryLabel(feature.properties, featureIndex);
    const geometry = feature.geometry;
    if (!geometry) return;

    if (geometry.type === "Polygon") {
      const coords = toShapefileLeafletCoords((geometry as Polygon).coordinates[0] as number[][]);
      if (coords.length >= 3) boundaries.push({ key: `${featureIndex}-0`, label: baseLabel, kind: "polygon", coords });
    } else if (geometry.type === "MultiPolygon") {
      const multi = geometry as MultiPolygon;
      multi.coordinates.forEach((polygonCoords, partIndex) => {
        const coords = toShapefileLeafletCoords(polygonCoords[0] as number[][]);
        if (coords.length >= 3) boundaries.push({
          key: `${featureIndex}-${partIndex}`,
          label: multi.coordinates.length > 1 ? `${baseLabel} (part ${partIndex + 1})` : baseLabel,
          kind: "polygon", coords,
        });
      });
    } else if (geometry.type === "LineString") {
      const lineCoords = (geometry as LineString).coordinates as number[][];
      const coords = toShapefileLeafletCoords(lineCoords);
      if (coords.length >= 2) { aggregatedLineCoords.push(lineCoords); aggregatedLineLabels.push(baseLabel); }
    } else if (geometry.type === "MultiLineString") {
      (geometry as MultiLineString).coordinates.forEach((lineCoords) => {
        const coords = toShapefileLeafletCoords(lineCoords as number[][]);
        if (coords.length >= 2) { aggregatedLineCoords.push(lineCoords as number[][]); aggregatedLineLabels.push(baseLabel); }
      });
    }
  });

  if (aggregatedLineCoords.length > 0) {
    const lineCoordsSets = aggregatedLineCoords.map((lc) => toShapefileLeafletCoords(lc)).filter((c) => c.length >= 2);
    boundaries.push({
      key: "uploaded-lines",
      label: aggregatedLineLabels.length === 1 ? aggregatedLineLabels[0] : `Imported Lines (${aggregatedLineCoords.length} features)`,
      kind: "line",
      lineCoordsSets,
    });
  }

  return boundaries;
}

type GradeBucket = {
  label: string;
  aliases: string[];
  maxPercent?: number;
};

const GRADE_BUCKETS: GradeBucket[] = [
  { label: "<=2% (1:25)", maxPercent: 2, aliases: ["<=2 degrees (1:25)", "<=4% (1:25)"] },
  { label: "2.9% (1:20)", maxPercent: 2.9, aliases: ["2.9 degrees (1:20)", "5% (1:20)"] },
  { label: "3.8% (1:15)", maxPercent: 3.8, aliases: ["3.8 degrees (1:15)", "6.7% (1:15)"] },
  { label: "4.7% (1:12)", maxPercent: 4.7, aliases: ["4.7 degrees (1:12)", "8.3% (1:12)", "< 5 Degrees"] },
  { label: ">=5%", aliases: [">=5 degrees", ">8.3% (>1:12)", "=/> 5 Degrees"] },
];
const GRADE_FILTER_OPTIONS = GRADE_BUCKETS.map(({ label }) => label);
const ROAD_SPEED_LIMIT_FILTER_OPTIONS = ["NA", "30 km/h", "40 km/h", "50 km/h", "60 km/h", "70 km/h", "80 km/h", "90 km/h"];
const CROSSING_TYPE_FILTER_OPTIONS = ["Zebra Crossing", "Signalised PC", "Bicycle Crossing", "Unsignalised Junction", "Development Access"];

const compareByOrder = (left: string, right: string, order: string[]): number => {
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  if (leftIndex === -1 && rightIndex === -1) return 0;
  if (leftIndex === -1) return 1;
  if (rightIndex === -1) return -1;
  return leftIndex - rightIndex;
};

const getSemanticCategoryOrder = (attributeName: string | null | undefined): string[] | null => {
  if (!attributeName) return null;
  if (SAFETY_FOCUS_ATTRIBUTES.has(attributeName)) return ["Low", "Medium", "High", "Extreme"];
  if (attributeName === "Facility Width per Direction") return ["Very Narrow", "Narrow", "Wide"];
  if (attributeName === "Grade") return GRADE_FILTER_OPTIONS;
  if (attributeName === "Road speed limit") return ROAD_SPEED_LIMIT_FILTER_OPTIONS;
  if (attributeName === "Crossing Type") return CROSSING_TYPE_FILTER_OPTIONS;
  return null;
};

const getGradeBucketFromPercent = (gradientPct: number): string => {
  const absoluteGradientPercent = Math.abs(gradientPct);
  return GRADE_BUCKETS.find((bucket) => bucket.maxPercent === undefined || absoluteGradientPercent <= bucket.maxPercent)?.label ?? GRADE_BUCKETS[GRADE_BUCKETS.length - 1].label;
};

const normalizeGradeLabel = (value: string): string => {
  const normalizedValue = value.trim();
  const matchingBucket = GRADE_BUCKETS.find(({ label, aliases }) => label === normalizedValue || aliases.includes(normalizedValue));
  return matchingBucket?.label ?? normalizedValue;
};

const normalizeCrossingTypeLabel = (value: string): string | null => {
  const normalizedValue = value.trim().toLowerCase();
  if (!normalizedValue) return null;
  if (normalizedValue.includes("zebra")) return "Zebra Crossing";
  if (normalizedValue.includes("signalised") || normalizedValue.includes("signalized")) return "Signalised PC";
  if (normalizedValue.includes("bicycle crossing") || normalizedValue.includes("pedestrian cum bicycle crossing")) return "Bicycle Crossing";
  if (normalizedValue.includes("unsignalised junction") || normalizedValue.includes("unsignalized junction")) return "Unsignalised Junction";
  if (normalizedValue.includes("development access")) return "Development Access";
  return null;
};

// --- EPSG:3414 (SVY21 / Singapore TM) definition -> EPSG:4326 ---
proj4.defs(
  "EPSG:3414",
  "+proj=tmerc +lat_0=1.366666666666667 +lon_0=103.8333333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs"
);



const to4326 = (p: Position): [number, number] => {
  const [lon, lat] = proj4("EPSG:3414", "EPSG:4326", p as [number, number]) as [number, number];
  return [lat, lon];
};

// Component to pan to specific bounds
function PanToBounds({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [bounds, map]);
  return null;
}

// Component to auto-fit bounds based on points - only on initial load
function FitBounds({ points, shouldFit }: { points: [number, number][]; shouldFit: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length || !shouldFit) return;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [points, map, shouldFit]);
  return null;
}

// Reports live viewport bounds after pan/zoom so the parent can cull off-screen markers.
// Uses a debounced state update so React batches marker mount/unmount after the gesture ends.
function ViewportWatcher({ onBoundsChange }: { onBoundsChange: (b: L.LatLngBounds) => void }) {
  const map = useMap();
  const cbRef = useRef(onBoundsChange);
  cbRef.current = onBoundsChange;

  useEffect(() => { cbRef.current(map.getBounds()); }, [map]);

  useMapEvents({
    moveend: (e) => cbRef.current(e.target.getBounds()),
    zoomend: (e) => cbRef.current(e.target.getBounds()),
  });
  return null;
}

// Helper: Point in Polygon Algorithm (Ray Casting)
function isPointInPolygon(point: [number, number], vs: [number, number][]) {
  // point: [lat, lon], vs: [[lat, lon], ...]
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

interface PolygonDrawingToolProps {
  isPolygonMode: boolean;
  isPolygonAddMode: boolean;
  onPolygonPoint: (latlng: L.LatLng) => void;
  onPointUpdate: (index: number, latlng: L.LatLng) => void;
  polygonPoints: [number, number][];
}

interface DraggableMarkerProps {
  position: [number, number];
  index: number;
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

function PolygonDrawingTool({ isPolygonMode, isPolygonAddMode, onPolygonPoint, onPointUpdate, polygonPoints }: PolygonDrawingToolProps) {
  const modeRef = useRef(false);
  const polygonRef = useRef<L.Polygon>(null);
  const polylineRef = useRef<L.Polyline>(null);

  // Keep latest points in a ref for access inside drag handler without re-binding
  const pointsRef = useRef(polygonPoints);
  useEffect(() => {
    pointsRef.current = polygonPoints;
  }, [polygonPoints]);

  useEffect(() => {
    modeRef.current = isPolygonMode || isPolygonAddMode;
  }, [isPolygonMode, isPolygonAddMode]);

  useMapEvents({
    click(e) {
      if (modeRef.current) {
        onPolygonPoint(e.latlng);
      }
    },
  });

  const handleDrag = useCallback((index: number, latlng: L.LatLng) => {
    // Imperatively update the polygon/polyline shape during drag for performance
    const currentPoints = pointsRef.current;
    if (!currentPoints) return;

    // Create new array with updated point
    const newPoints = [...currentPoints];
    newPoints[index] = [latlng.lat, latlng.lng];

    // Convert to Leaflet LatLng objects to be safe
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
    // Commit the change to state on drag end
    onPointUpdate(index, latlng);
  }, [onPointUpdate]);

  const color = isPolygonAddMode ? "blue" : "red";

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

  const icon = useMemo(() => createCustomIcon(color), [color]);

  if (polygonPoints.length === 0) return null;

  return (
    <>
      {polygonPoints.map((pt, idx) => (
        <DraggableMarker
          key={`poly-point-${idx}`}
          position={pt}
          index={idx}
          icon={icon}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
        />
      ))}
      <LeafletPolyline
        ref={polylineRef}
        positions={polygonPoints}
        pathOptions={{ color: color, dashArray: "5, 5" }}
      />
      {polygonPoints.length >= 3 && (
        <LeafletPolygon
          ref={polygonRef}
          positions={polygonPoints}
          pathOptions={{ color: color, fillOpacity: 0.2 }}
        />
      )}
    </>
  );
}

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
  loadedProjects: string[];
  hiddenProjects: string[];
  onHiddenProjectsChange: (hidden: string[]) => void;
}


type ProjectData = {
  projectName: string;
  geoFeatures: Feature<LineString, any>[];
  attributes: AttributeRow[];
  scores: Record<string, any>[]; // Raw crash type scores (BB, SB, VB, BP)
  color: string;
};

type VisibleSegment = {
  idx: number;
  latlng: [number, number];
  f: Feature<LineString, any>;
  attributes: AttributeRow;
  projectName: string;
  projectColor: string;
  scores: Record<string, any> | null;
};

export default function AttributeAnalysisMapView({
  selectedProjects,
  selectedAttributes,
  onChartDataUpdate,
  loadedProjects,
  hiddenProjects,
  onHiddenProjectsChange,
}: AttributeAnalysisMapViewProps) {
  const navigate = useNavigate();
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<string>("map");
  const [projectsData, setProjectsData] = useState<ProjectData[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [panToBounds, setPanToBounds] = useState<L.LatLngBounds | null>(null);

  // Single canvas renderer shared by all CircleMarkers — avoids creating hundreds of
  // SVG DOM elements and dramatically reduces paint time with large project sets.
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

  // Track live map viewport so we can cull off-screen markers before React touches them.
  const [mapViewportBounds, setMapViewportBounds] = useState<L.LatLngBounds | null>(null);
  const [attrMappings, setAttrMappings] = useState<Record<string, Record<string, string>>>({});

  // Category toggle states — tracks per-attribute per-value visibility
  const [categoryToggles, setCategoryToggles] = useState<Record<string, Record<string, boolean>>>(() => {
    try {
      const stored = sessionStorage.getItem("pathAnalysisMap_categoryToggles");
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  // Subcategory toggle states — tracks per-child-attr per-value visibility (Layer 3)
  const [subcategoryToggles, setSubcategoryToggles] = useState<Record<string, Record<string, boolean>>>(() => {
    try {
      const stored = sessionStorage.getItem("pathAnalysisMap_subcategoryToggles");
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  // Range filter states for numeric attributes
  const [rangeFilters, setRangeFilters] = useState<Record<string, [number, number]>>(() => {
    try {
      const stored = sessionStorage.getItem("pathAnalysisMap_rangeFilters");
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  // Track which attribute to show categories for in the sidebar.
  // Index -1 is reserved for the always-present "Projects" tab (colors by project).
  const [categoryFilterAttributeIndex, setCategoryFilterAttributeIndex] = useState<number>(() => {
    try {
      const stored = sessionStorage.getItem("pathAnalysisMap_categoryFilterIndex");
      return stored !== null ? Number(stored) : -1;
    } catch { return -1; }
  });

  // Track if we should auto-fit bounds (only on initial project load, not on category changes)
  const [shouldAutoFit, setShouldAutoFit] = useState(false);

  // Track which attribute is the primary focus for coloring
  const [primaryFocusAttribute, setPrimaryFocusAttribute] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem("pathAnalysisMap_primaryFocus") || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    sessionStorage.setItem("pathAnalysisMap_categoryToggles", JSON.stringify(categoryToggles));
  }, [categoryToggles]);

  useEffect(() => {
    sessionStorage.setItem("pathAnalysisMap_subcategoryToggles", JSON.stringify(subcategoryToggles));
  }, [subcategoryToggles]);

  useEffect(() => {
    sessionStorage.setItem("pathAnalysisMap_rangeFilters", JSON.stringify(rangeFilters));
  }, [rangeFilters]);

  useEffect(() => {
    sessionStorage.setItem("pathAnalysisMap_categoryFilterIndex", String(categoryFilterAttributeIndex));
  }, [categoryFilterAttributeIndex]);

  useEffect(() => {
    if (primaryFocusAttribute) {
      sessionStorage.setItem("pathAnalysisMap_primaryFocus", primaryFocusAttribute);
    } else {
      sessionStorage.removeItem("pathAnalysisMap_primaryFocus");
    }
  }, [primaryFocusAttribute]);

  // When all filters are reset, revert coloring to by-project
  useEffect(() => {
    if (selectedAttributes.length === 0) {
      setCategoryFilterAttributeIndex(-1);
      setPrimaryFocusAttribute("Project");
    }
  }, [selectedAttributes]);

  // GIS layer toggles
  const [isGisSidebarOpen, setIsGisSidebarOpen] = useState(false);
  const [gisLayers, setGisLayers] = useState<Record<string, any[]> | null>(null);
  const [pathDefects, setPathDefects] = useState<{ lat: number; lon: number; type_of_defect?: string; location?: string; date_of_inspection?: string }[] | null>(null);
  const [showFootpath, setShowFootpath] = useState(false);
  const [showCycling, setShowCycling] = useState(false);
  const [showShared, setShowShared] = useState(false);
  const [showRoadcrossing, setShowRoadcrossing] = useState(false);
  const [showMrtExit, setShowMrtExit] = useState(false);
  const [showBusStop, setShowBusStop] = useState(false);
  const [showBusLane, setShowBusLane] = useState(false);
  const [showParkingLot, setShowParkingLot] = useState(false);
  const [showKerbLine, setShowKerbLine] = useState(false);
  const [showBicycleCrossing, setShowBicycleCrossing] = useState(false);
  const [showPathDefects, setShowPathDefects] = useState(false);
  const [showStateLand, setShowStateLand] = useState(false);
  const [showStatBoard, setShowStatBoard] = useState(false);
  const [showLandPrivate, setShowLandPrivate] = useState(false);
  const [showLandMinistry, setShowLandMinistry] = useState(false);
  const gisAbortRef = useRef<AbortController | null>(null);
  const gisTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defectsAbortRef = useRef<AbortController | null>(null);
  const defectsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Imported shapefile overlay
  const [importedBoundaries, setImportedBoundaries] = useState<UploadedBoundaryFeature[]>([]);
  const [importedBoundaryName, setImportedBoundaryName] = useState<string | null>(null);
  const [importedBoundaryLoading, setImportedBoundaryLoading] = useState(false);
  const [importedBoundaryError, setImportedBoundaryError] = useState<string | null>(null);

  const handleImportFiles = useCallback(async (files: File[]) => {
    const sourceFile = files.find((f) => f.name.toLowerCase().endsWith(".shp") || f.name.toLowerCase().endsWith(".zip"));
    if (!sourceFile) {
      const message = "Upload a .zip shapefile or a .shp file with its companion files (.dbf, .shx, .prj).";
      setImportedBoundaryError(message);
      toaster.create({ title: "Import failed", description: message, type: "warning" });
      return;
    }
    setImportedBoundaryLoading(true);
    setImportedBoundaryError(null);
    try {
      const geojson = await previewUploadedShapefiles(files);
      const boundaries = extractUploadedBoundaryFeatures(geojson);
      if (boundaries.length === 0) {
        throw new Error("No polygon or line features were found in the uploaded shapefile.");
      }
      setImportedBoundaryName(sourceFile.name);
      setImportedBoundaries(boundaries);
      toaster.create({ title: "Shapefile imported", description: `Loaded ${boundaries.length} feature(s) from ${sourceFile.name}.`, type: "success" });
    } catch (err: any) {
      const message = err?.message ?? "Failed to import shapefile.";
      setImportedBoundaryError(message);
      toaster.create({ title: "Import failed", description: message, type: "error" });
    } finally {
      setImportedBoundaryLoading(false);
    }
  }, []);

  const handleClearImportedShapefile = useCallback(() => {
    setImportedBoundaries([]);
    setImportedBoundaryName(null);
    setImportedBoundaryError(null);
  }, []);

  const gisLayerColors = {
    footpath: "#1E90FF", cycling: "#B91C1C", shared: "#A855F7",
    roadcrossing: "#10B981", mrt_exit: "#06B6D4", bicycle_crossing: "#F97316",
    bus_stop: "#8B5CF6", bus_lane: "#EAB308", parking_lot: "#D97706",
    kerb_line: "#D946EF", state_land: "#14B8A6", stat_board: "#F59E0B",
    land_private: "#6366F1", land_ministry: "#EC4899",
  } as const;

  // Viewport-based GIS layer fetch — re-fires (debounced) on pan/zoom or toggle change
  useEffect(() => {
    const anyOn = showFootpath || showCycling || showShared || showRoadcrossing || showMrtExit ||
      showBusStop || showBusLane || showParkingLot || showKerbLine || showBicycleCrossing ||
      showStateLand || showStatBoard || showLandPrivate || showLandMinistry;

    if (!anyOn || !mapViewportBounds) {
      setGisLayers(null);
      return;
    }

    if (gisTimerRef.current) clearTimeout(gisTimerRef.current);
    gisTimerRef.current = setTimeout(async () => {
      if (gisAbortRef.current) gisAbortRef.current.abort();
      const controller = new AbortController();
      gisAbortRef.current = controller;

      try {
        const sw = mapViewportBounds.getSouthWest();
        const ne = mapViewportBounds.getNorthEast();
        const layers: string[] = [];
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

        const res = await fetch('/api/projects/gis/viewport', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox: [sw.lng, sw.lat, ne.lng, ne.lat], layers }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        const data = await res.json();
        if (data.ok) setGisLayers(data.layers);
      } catch (e: any) {
        if (e.name !== 'AbortError') console.error('[GIS Viewport] Fetch error:', e);
      }
    }, 500);

    return () => { if (gisTimerRef.current) clearTimeout(gisTimerRef.current); };
  }, [mapViewportBounds, showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop, showBusLane, showParkingLot, showKerbLine, showBicycleCrossing, showStateLand, showStatBoard, showLandPrivate, showLandMinistry]);

  // Viewport-center-based path defects fetch
  useEffect(() => {
    if (!showPathDefects || !mapViewportBounds) {
      setPathDefects(null);
      return;
    }

    if (defectsTimerRef.current) clearTimeout(defectsTimerRef.current);
    defectsTimerRef.current = setTimeout(async () => {
      if (defectsAbortRef.current) defectsAbortRef.current.abort();
      const controller = new AbortController();
      defectsAbortRef.current = controller;

      try {
        const sw = mapViewportBounds.getSouthWest();
        const ne = mapViewportBounds.getNorthEast();
        const centerLat = (sw.lat + ne.lat) / 2;
        const centerLon = (sw.lng + ne.lng) / 2;
        // Radius: half the viewport diagonal in metres (rough WGS84 → metres)
        const diagDeg = Math.sqrt((ne.lat - sw.lat) ** 2 + (ne.lng - sw.lng) ** 2);
        const radius = Math.min(Math.round((diagDeg / 2) * 111_000), 3000);

        const res = await fetch('/api/defects/nearby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ point: [centerLon, centerLat], radius }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        const data = await res.json();
        if (data.ok) setPathDefects(data.defects ?? []);
      } catch (e: any) {
        if (e.name !== 'AbortError') console.error('[Defects Viewport] Fetch error:', e);
      }
    }, 500);

    return () => { if (defectsTimerRef.current) clearTimeout(defectsTimerRef.current); };
  }, [mapViewportBounds, showPathDefects]);

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
  const handlePolygonPoint = (latlng: L.LatLng) => {
    setPolygonPoints((prev) => [...prev, [latlng.lat, latlng.lng]]);
  };

  const handlePointUpdate = useCallback((index: number, latlng: L.LatLng) => {
    setPolygonPoints((prev) => {
      const newPoints = [...prev];
      newPoints[index] = [latlng.lat, latlng.lng];
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

  // Active filters = the attributes selected via FilterPanel (passed as prop)
  const activeFilters = useMemo(() => selectedAttributes, [selectedAttributes]);

  // Auto-focus the newest filter when one is added; revert coloring when the focused
  // filter is removed (otherwise primaryFocusAttribute goes stale and the map keeps
  // coloring by a filter that is no longer active).
  const prevFiltersRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const added = activeFilters.find(f => !prev.includes(f));
    if (added) {
      const idx = activeFilters.indexOf(added);
      setCategoryFilterAttributeIndex(idx);
      setPrimaryFocusAttribute(added);
    } else if (
      primaryFocusAttribute &&
      primaryFocusAttribute !== "Project" &&
      !activeFilters.includes(primaryFocusAttribute)
    ) {
      // The focused attribute was removed — revert to project-colour mode so that
      // the tab (-1) and primaryFocusAttribute ("Project") always agree. Jumping to
      // the first remaining filter here races with the out-of-bounds reset below,
      // which forces the index to -1 and leaves primaryFocusAttribute stale.
      setCategoryFilterAttributeIndex(-1);
      setPrimaryFocusAttribute("Project");
    }
    prevFiltersRef.current = activeFilters;
  }, [activeFilters, primaryFocusAttribute]);

  // Reset sidebar index if out of bounds (fall back to the Projects tab at -1)
  useEffect(() => {
    if (categoryFilterAttributeIndex >= activeFilters.length) {
      setCategoryFilterAttributeIndex(-1);
    }
  }, [activeFilters.length, categoryFilterAttributeIndex]);

  // Load attribute mappings on mount
  useEffect(() => {
    fetchAttributeMappings()
      .then(mappings => {
        // Ensure adequacy-mapped attributes are always present (backend may omit them)
        const adequacyMap: Record<string, string> = { "1": "Adequate", "2": "Inadequate" };
        if (!mappings["Line of Sight"]) mappings["Line of Sight"] = adequacyMap;
        if (!mappings["Facility access"]) mappings["Facility access"] = adequacyMap;
        setAttrMappings(mappings);
      })
      .catch(() => {
        // Minimal fallback so at least adequacy attributes work offline
        setAttrMappings({
          "Line of Sight": { "1": "Adequate", "2": "Inadequate" },
          "Facility access": { "1": "Adequate", "2": "Inadequate" },
        });
      });
  }, []);

  // Initialize default toggles for all active filters when they change
  useEffect(() => {
    setCategoryToggles(prev => {
      const updated = { ...prev };
      for (const filterAttr of activeFilters) {
        if (!updated[filterAttr]) updated[filterAttr] = {};
      }
      return updated;
    });
  }, [activeFilters]);

  // The attribute whose categories are currently shown in the sidebar.
  // Index -1 represents the always-present "Projects" tab (colour by project).
  const categoryFilterAttribute = categoryFilterAttributeIndex === -1
    ? "Project"
    : activeFilters[categoryFilterAttributeIndex];

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
    const cols: { key: string; label: string }[] = [
      { key: "Project", label: "Project" },
      { key: "Segment #", label: "Segment #" },
      { key: "Image Reference", label: "Image Reference" },
      { key: "Coordinates", label: "Coordinates" },
    ];
    for (const attr of activeFilters) {
      cols.push({ key: attr, label: ATTRIBUTE_LABELS[attr] ?? attr });
      const subcat = SUBCATEGORY_MAP[attr];
      if (subcat) {
        const childAttr = subcat.childAttr;
        cols.push({ key: childAttr, label: ATTRIBUTE_LABELS[childAttr] ?? childAttr });
      }
    }
    cols.push({ key: "Overall Risk Score", label: "Overall Risk Score" });
    return cols;
  }, [activeFilters]);


  // Helper function to convert numeric attribute value to text using mappings
  const getAttrText = (attrName: string, attrValue: any): string => {
    // Subcategory child attrs: null/empty/undefined → "None"
    if (SUBCATEGORY_CHILD_ATTRS.has(attrName)) {
      if (attrValue === null || attrValue === undefined || attrValue === "" || attrValue === "null") {
        return "None";
      }
    }

    // Generic null/empty handling. The backend treats a missing attribute as its
    // default code (backend/src/CycleRAP/defaults.json) rather than "unset", so we
    // mirror those defaults here: adequacy attributes default to "Adequate" (1),
    // and most presence attributes default to "Not Present" (2). Without this,
    // default-valued segments are silently dropped from the map and filters.
    if (attrValue === null || attrValue === undefined || attrValue === "" || String(attrValue).toLowerCase() === "null") {
      if (ADEQUACY_DEFAULT_ATTRS.has(attrName)) return "Adequate";
      const opts = ATTRIBUTE_OPTIONS[attrName];
      if (opts && opts.includes("Not Present")) return "Not Present";
      return ""; // no valid category — exclude this segment from toggle counts
    }

    // Handle safety score band values (VB Band, BB Band, SB Band, BP Band)
    // These map to exactly 4 categories based on score thresholds:
    // Low: <10, Medium: 10-25, High: 25-60, Extreme: >60
    if (["VB Band", "BB Band", "SB Band", "BP Band"].includes(attrName)) {
      const numValue = Number(attrValue);
      if (isNaN(numValue)) {
        return "Low"; // Default to Low if invalid
      }

      // Map backend bands to frontend categories: Low, Medium, High, Extreme
      // Note: Band 5 may still exist in old data, map it to Extreme
      const riskCategoryMap: Record<number, string> = {
        1: "Low",      // Band 1: score <10
        2: "Medium",   // Band 2: score 10-25
        3: "High",     // Band 3: score 25-60
        4: "Extreme",  // Band 4: score >60
        5: "Extreme",  // Band 5 (legacy): score >60 - treat same as Band 4
      };

      return riskCategoryMap[numValue] || "Low"; // Default to Low if unknown
    }

    // Special handling for Overall Risk Level - calculated from actual score, not a band index
    if (attrName === "Overall Risk Level") {
      // This shouldn't happen as Overall Risk Level is calculated in the filter logic,
      // but handle it gracefully just in case
      const scoreValue = Number(attrValue);
      if (isNaN(scoreValue)) return "Low";
      if (scoreValue < 10) return "Low";
      if (scoreValue <= 25) return "Medium";
      if (scoreValue <= 60) return "High";
      return "Extreme";
    }

    // If we have a mapping for this attribute, apply it (handles both string and number values from CSV)
    if (attrMappings[attrName]) {
      const key = String(attrValue);
      if (attrMappings[attrName][key]) {
        return attrMappings[attrName][key];
      }
      // Try numeric key if string key didn't work
      const numKey = Number(attrValue);
      if (!isNaN(numKey) && attrMappings[attrName][String(numKey)]) {
        return attrMappings[attrName][String(numKey)];
      }
      // Fall through to return raw value
    }

    return String(attrValue);
  };

  const getSafetyAttributeText = useCallback((attributeName: string, segmentScores: Record<string, any> | null | undefined): string => {
    if (!segmentScores) {
      return "Low";
    }

    if (attributeName === "Overall Risk Level") {
      let maxRiskLevel = 0;

      if (segmentScores["Overall Risk Level Band"] !== undefined) {
        maxRiskLevel = (segmentScores["Overall Risk Level Band"] as number) - 1;
      } else {
        ["BB", "BP", "SB", "VB"].forEach((type) => {
          const scoreValue = Number(segmentScores[type] ?? 0);
          let riskLevel = 0;

          if (["BB", "BP", "SB"].includes(type)) {
            if (scoreValue > 20) riskLevel = 3;
            else if (scoreValue > 10) riskLevel = 2;
            else if (scoreValue >= 5) riskLevel = 1;
          } else {
            if (scoreValue > 60) riskLevel = 3;
            else if (scoreValue > 25) riskLevel = 2;
            else if (scoreValue >= 10) riskLevel = 1;
          }

          if (riskLevel > maxRiskLevel) {
            maxRiskLevel = riskLevel;
          }
        });
      }

      if (maxRiskLevel === 3) return "Extreme";
      if (maxRiskLevel === 2) return "High";
      if (maxRiskLevel === 1) return "Medium";
      return "Low";
    }

    const crashTypeKey = attributeName.replace(" Band", "");
    const scoreValue = Number(segmentScores[crashTypeKey] ?? 0);

    if (["BB", "BP", "SB"].includes(crashTypeKey)) {
      if (scoreValue < 5) return "Low";
      if (scoreValue <= 10) return "Medium";
      if (scoreValue <= 20) return "High";
      return "Extreme";
    }

    if (scoreValue < 10) return "Low";
    if (scoreValue <= 25) return "Medium";
    if (scoreValue <= 60) return "High";
    return "Extreme";
  }, []);

  const getGradeFilterText = useCallback((attributes: AttributeRow): string => {
    const gradientPct = Number(attributes["Gradient %"]);
    if (!Number.isNaN(gradientPct)) {
      return getGradeBucketFromPercent(gradientPct);
    }

    const fallbackGrade = getAttrText("Grade", attributes["Grade"]);
    return normalizeGradeLabel(fallbackGrade);
  }, [attrMappings]);

  const getDerivedCrossingTypes = useCallback((attributes: AttributeRow): string[] => {
    const derivedTypes = new Set<string>();
    const rawCrossingType = attributes["Crossing Type"];

    if (rawCrossingType !== null && rawCrossingType !== undefined && String(rawCrossingType).trim() !== "") {
      String(rawCrossingType)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          const normalizedType = normalizeCrossingTypeLabel(part);
          if (normalizedType) {
            derivedTypes.add(normalizedType);
          }
        });
    }

    const hasIntersectionOrRoadCrossing = getAttrText("Intersection or Road Crossing", attributes["Intersection or Road Crossing"]) === "Present";
    const hasPropertyAccess = getAttrText("Property Access", attributes["Property Access"]) === "Present";

    if (hasPropertyAccess) {
      derivedTypes.add("Development Access");
    } else if (hasIntersectionOrRoadCrossing && derivedTypes.size === 0) {
      derivedTypes.add("Unsignalised Junction");
    }

    return CROSSING_TYPE_FILTER_OPTIONS.filter((option) => derivedTypes.has(option));
  }, [attrMappings]);

  const getCrossingFacilityFilterText = useCallback((attributes: AttributeRow): string => {
    const rawCrossingFacility = getAttrText("Crossing Facility", attributes["Crossing Facility"]);
    if (rawCrossingFacility === "Present") {
      return "Present";
    }
    return getDerivedCrossingTypes(attributes).length > 0 ? "Present" : rawCrossingFacility;
  }, [attrMappings, getDerivedCrossingTypes]);

  const getFilterAttributeText = useCallback((
    attributeName: string,
    projectName: string,
    attributes: AttributeRow,
    segmentScores: Record<string, any> | null,
  ): string => {
    if (attributeName === "Project") {
      return projectName;
    }

    if (SAFETY_FOCUS_ATTRIBUTES.has(attributeName)) {
      return getSafetyAttributeText(attributeName, segmentScores);
    }

    if (attributeName === "Grade") {
      return getGradeFilterText(attributes);
    }

    if (attributeName === "Crossing Type") {
      return getDerivedCrossingTypes(attributes).join(", ");
    }

    if (attributeName === "Crossing Facility") {
      return getCrossingFacilityFilterText(attributes);
    }



    if (attributeName === "Delineation Type") {
      const delineationType = getAttrText("Delineation Type", attributes["Delineation Type"]);
      return delineationType === "None" ? "" : delineationType;
    }

    return getAttrText(attributeName, attributes[attributeName]);
  }, [attrMappings, getCrossingFacilityFilterText, getDerivedCrossingTypes, getGradeFilterText, getSafetyAttributeText]);

  const getFocusedAttributeValue = useCallback((attributeName: string, segment: VisibleSegment): string => {
    const valueText = getFilterAttributeText(attributeName, segment.projectName, segment.attributes, segment.scores);
    if (!valueText) {
      return "";
    }

    if (MULTI_VALUE_ATTRS.has(attributeName) && valueText.includes(", ")) {
      const parts = valueText.split(", ").map((part) => part.trim()).filter(Boolean);
      const toggles = subcategoryToggles[attributeName];
      return parts.find((part) => toggles?.[part] !== false) ?? parts[0] ?? "";
    }

    return valueText;
  }, [getFilterAttributeText, subcategoryToggles]);


  // Generate distinct colors for each project
  const projectColors = useMemo(() => {
    const colors = [
      "#2563EB", // Blue
      "#DC2626", // Red
      "#16A34A", // Green
      "#CA8A04", // Yellow
      "#9333EA", // Purple
      "#EA580C", // Orange
      "#0891B2", // Cyan
      "#DB2777", // Pink
    ];
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
          // Fetch geodata and attributes (required)
          const [geoJson, attrResponse] = await Promise.all([
            fetchProjectGeoJSON(projectName),
            fetchProjectAttributes(projectName),
          ]);

          // Fetch scores (optional - if fails, continue with empty scores).
          // Prefer the read-only GET /results (no recompute, no disk write).
          // Only fall back to POST /score (which computes + persists) when the
          // project has never been scored yet.
          let scores: Record<string, any>[] = [];
          try {
            const resultsResponse = await fetchProjectResults(projectName);
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
          // Enable auto-fit when new projects are loaded
          setShouldAutoFit(true);
          // Reset after a short delay to allow the fit to happen
          setTimeout(() => setShouldAutoFit(false), 500);
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
                    if (MULTI_VALUE_ATTRS.has(subcatConfig.childAttr) && childValue.includes(", ")) {
                      const parts = childValue.split(", ").map((s: string) => s.trim());
                      const anyEnabled = parts.some((part: string) => subcategoryToggles[subcatConfig.childAttr][part] !== false);
                      if (!anyEnabled) {
                        matchesAllFilters = false;
                        break;
                      }
                    } else if (subcategoryToggles[subcatConfig.childAttr][childValue] === false) {
                      matchesAllFilters = false;
                      break;
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
  }, [projectsData, activeFilters, categoryToggles, subcategoryToggles, rangeFilters, dataRangeBounds, getFilterAttributeText]);

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
  const attributeCategoryColors = useMemo(() => {
    if (!effectiveFocusAttribute) return {};

    const categoryColors: Record<string, string | Record<string, string>> = {
      "Low": "#87C424",
      "Medium": "#FFCC1A",
      "High": "#FF5B1A",
      "Extreme": "#CD1AFF",
      "Adjacent Sidewalk 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Adjacent Road Lane 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Adjacent Vehicle Parking 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Adjacent Severe Hazard 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Adjacent object or level change 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Adjacent Road Lane 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Adjacent Vehicle Parking 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Adjacent Severe Hazard 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Adjacent object or level change 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Line of Sight": { "Adequate": "#16A34A", "Inadequate": "#DC2626" },
      "Fixed Obstacle on Facility": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "FO Type": {
        "Lamp Post": "#DC2626",
        "Traffic Light": "#EA580C",
        "Pillar": "#F59E0B",
        "Bollards": "#CA8A04",
        "Billboards": "#7C3AED",
        "Billboard": "#7C3AED",
        "Sign Poles": "#0284C7",
        "Sign Pole": "#0284C7",
        "Fence": "#0891B2",
        "Vegetation": "#16A34A",
        "Others": "#6B7280",
      },
      "Non-Fixed Obstacle on Facility": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "NFO Type": {
        "Barrier": "#DC2626",
        "Bins": "#EA580C",
        "Bicycle": "#F59E0B",
        "Cone": "#CA8A04",
        "Others": "#6B7280",
      },
      "Width Restriction": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Light Segregation": { "Present": "#16A34A", "Not Present": "#DC2626" },
      "Facility access": { "Adequate": "#16A34A", "Inadequate": "#DC2626" },
      "Loose or slippery surface": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Major Surface Deformation or Drain Opening": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Tram or Train Rails": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Delineation": { "Present": "#16A34A", "Not Present": "#DC2626" },
      "Street Lighting": { "Present": "#16A34A", "Not Present": "#DC2626" },
      "Grade": {
        "<=2% (1:25)": "#16A34A",
        "2.9% (1:20)": "#65A30D",
        "3.8% (1:15)": "#CA8A04",
        "4.7% (1:12)": "#EA580C",
        ">=5%": "#DC2626",
      },
      "Curvature": { "No Sharp Turn Present": "#16A34A", "Sharp Turn Present": "#DC2626" },
      "Curvature Sub-category": {
        "<6.5m": "#DC2626",
        "<10m": "#EA580C",
        "Path Junction": "#9333EA",
        "Sharp Bend": "#EA580C",
        "Both": "#9333EA",
        "10–18m": "#16A34A",
        ">18m": "#2563EB",
      },
      "Facility Width per Direction": { "Wide": "#16A34A", "Narrow": "#FFCC1A", "Very Narrow": "#DC2626" },
      "Facility Width Sub-category": {
        "≤1.5m": "#DC2626",
        ">1.5–1.8m": "#EA580C",
        ">1.8–<2m": "#F59E0B",
        "2–<3.5m": "#16A34A",
        "3.5–4m": "#0891B2",
        ">4m": "#2563EB",
      },
      "Peak pedestrian flow along or across facility": { "None": "#6B7280", "Low": "#16A34A", "Moderate to high": "#DC2626" },
      "Peak bicycle/LV traffic flow": { "Low": "#16A34A", "Moderate to high": "#DC2626" },
      "Observed proportion of cargo bikes and mopeds": { "Low": "#16A34A", "Moderate to high": "#DC2626" },
      "Heavy vehicle flow": { "Low": "#16A34A", "Moderate to high": "#DC2626" },
      "Bicycle/LV speed – average": { "< 20km/h": "#16A34A", "=/> 20km/h": "#DC2626" },
      "Bicycle/LV speed differential": { "< 10km/h": "#16A34A", "=/> 10km/h": "#DC2626" },
      "Intersection or Road Crossing": { "Present": "#16A34A", "Not Present": "#DC2626" },
      "Crossing Facility": { "Present": "#16A34A", "Not Present": "#DC2626" },
      "Crossing Type": {
        "Zebra Crossing": "#CA8A04",
        "Signalised PC": "#2563EB",
        "Bicycle Crossing": "#16A34A",
        "Unsignalised Junction": "#EA580C",
        "Development Access": "#9333EA",
      },
      "Pedestrian Crossing": { "Present": "#16A34A", "Not Present": "#DC2626" },
      "Intersecting Bicycle Facility": { "Present": "#16A34A", "Not Present": "#DC2626" },
      "Property Access": { "Present": "#DC2626", "Not Present": "#16A34A" },
      "Intersection Approach": { "Separate/NA": "#16A34A", "Shared": "#DC2626" },
      "Number of lanes – adjacent road": { "1 per Direction/NA": "#16A34A", "> 1 per Direction": "#DC2626" },
      "Number of lanes – intersecting road": { "1 per Direction/NA": "#16A34A", "> 1 per Direction": "#DC2626" },
      "Road speed limit": {
        "NA": "#6B7280",
        "30 km/h": "#16A34A",
        "40 km/h": "#65A30D",
        "50 km/h": "#FFCC1A",
        "60 km/h": "#F59E0B",
        "70 km/h": "#EA580C",
        "80 km/h": "#DC2626",
        "90 km/h": "#991B1B",
      },
      "Flow Direction": { "One Way": "#2563EB", "Two Way": "#9333EA" },
      "Delineation Type": {
        "Cycling Path": "#2563EB",
        "Red Stripe": "#DC2626",
        "Signalised Crossing": "#EA580C",
        "Zebra Crossing": "#CA8A04",
      },
      "Facility Type": {
        "Sidewalk": "#2563EB",
        "Multi-Use Path": "#9333EA",
        "Off-Road Bicycle Path": "#16A34A",
        "On-road Bicycle Lane": "#CA8A04",
        "Road Shoulder": "#F59E0B",
        "Mixed Traffic Road Lane": "#DC2626",
      },
      "Area type": {
        "Urban": "#2563EB",
        "Suburban": "#0891B2",
        "Rural": "#16A34A",
        "Industrial": "#EA580C",
        "Recreational": "#9333EA",
      },
    };

    const attributeColors = categoryColors[effectiveFocusAttribute];
    if (typeof attributeColors === "object" && attributeColors !== null) {
      return attributeColors as Record<string, string>;
    }

    if (SAFETY_FOCUS_ATTRIBUTES.has(effectiveFocusAttribute || "")) {
      return {
        "Low": categoryColors["Low"] as string,
        "Medium": categoryColors["Medium"] as string,
        "High": categoryColors["High"] as string,
        "Extreme": categoryColors["Extreme"] as string,
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

  // Handle column header click for sorting
  const handleHeaderClick = (columnKey: string) => {
    setSortConfig(prevConfig => {
      // Find if this column is already in sort config
      const existingIndex = prevConfig.findIndex(s => s.column === columnKey);

      if (existingIndex === 0) {
        // If it's the primary sort, toggle direction
        const currentDirection = prevConfig[0].direction;
        return [
          { column: columnKey, direction: currentDirection === 'asc' ? 'desc' : 'asc' },
          ...prevConfig.slice(1) // Keep other sort criteria
        ];
      } else if (existingIndex > 0) {
        // If it's a secondary sort, move it to primary and set to 'asc'
        const updated = [...prevConfig];
        updated.splice(existingIndex, 1);
        return [{ column: columnKey, direction: 'asc' }, ...updated];
      } else {
        // Not in config, add as primary sort
        return [{ column: columnKey, direction: 'asc' }, ...prevConfig];
      }
    });
  };

  // Default center (Singapore)
  const initialCenter = useRef<[number, number]>([1.3521, 103.8198]);

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

  const handleTableProjectJump = (projectName: string) => {
    const container = tableContainerRef.current;
    if (!container) return;
    const row = container.querySelector<HTMLTableRowElement>(`tr[data-project="${CSS.escape(projectName)}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  // CSV helper: escape CSV values with proper quoting
  const escapeCSV = (value: string): string => {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
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
          color: projectColors[project] || "#6B7280",
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
          color: attributeCategoryColors[category] || "#6B7280",
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
        let color = "#6B7280";
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
      borderRadius="lg"
      bg="white"
      _dark={{ bg: "gray.800" }}
    >
      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={(e) => setActiveTab(e.value)}>
        <Flex justify="space-between" align="center" borderBottom="1px solid" borderColor="gray.200" bg="white" _dark={{ bg: "gray.800" }} py="3" px="4">
          <HStack gap="4">
            <Tabs.List>
              <Tabs.Trigger value="map">Map View</Tabs.Trigger>
              <Tabs.Trigger value="table">Table View</Tabs.Trigger>
            </Tabs.List>

            {allPoints.length > 0 && (
              <>
                <HStack gap="0" mr="2">
                  <Menu.Root positioning={{ placement: "bottom-end", strategy: "fixed" }}>
                    <Menu.Trigger asChild>
                      <IconButton
                        aria-label="Single Point Tools"
                        size="sm"
                        variant={(isDeleteMode || isPointAddMode) ? "solid" : "outline"}
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
                        borderTopRightRadius={0}
                        borderBottomRightRadius={0}
                      >
                        {isDeleteMode ? <FaTrash /> : isPointAddMode ? <FaPlus /> : <FaMousePointer />}
                      </IconButton>
                    </Menu.Trigger>
                    <Menu.Positioner>
                      <Menu.Content zIndex={2000}>
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
                        size="sm"
                        variant={(isPolygonMode || isPolygonAddMode) ? "solid" : "outline"}
                        colorPalette={(isPolygonMode || isPolygonAddMode) ? (isPolygonMode ? "red" : "blue") : "gray"}
                        borderTopLeftRadius={0}
                        borderBottomLeftRadius={0}
                        borderLeft="none"
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
                        {isPolygonMode ? <FaTrash /> : isPolygonAddMode ? <FaPlus /> : <FaDrawPolygon />}
                      </IconButton>
                    </Menu.Trigger>
                    <Menu.Positioner>
                      <Menu.Content zIndex={2000}>
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
                </HStack>

                {polygonPoints.length >= 3 && isPolygonMode && (
                  <Button
                    size="sm"
                    colorPalette="red"
                    onClick={finishPolygonSelection}
                  >
                    Delete Selected ({
                      // Preview count
                      allPoints.filter(pt => isPointInPolygon(pt.latlng, polygonPoints)).length
                    } segments)
                  </Button>
                )}

                {polygonPoints.length >= 3 && isPolygonAddMode && (
                  <Button
                    size="sm"
                    colorPalette="blue"
                    onClick={finishAddSegmentsSelection}
                  >
                    Copy Selected ({
                      allPoints.filter(pt => isPointInPolygon(pt.latlng, polygonPoints)).length
                    } segments)
                  </Button>
                )}
              </>
            )}
          </HStack>

          {allPoints.length > 0 && (
            <HStack gap="2">
              <Button
                colorPalette="blue"
                size="sm"
                onClick={handleDownloadCSV}
              >
                Download Table
              </Button>
              <Button
                colorPalette="teal"
                size="sm"
                variant="outline"
                onClick={handleDownloadImages}
              >
                Download Images
              </Button>
              <Button
                colorPalette="green"
                size="sm"
                variant="outline"
                onClick={handleDownloadShapefile}
              >
                Download Shapefile
              </Button>
            </HStack>
          )}
        </Flex>

        {/* Map Tab Content */}
        <Tabs.Content value="map">
          {/* Project Navigation Buttons and Legend */}
          {selectedProjects.length > 0 && (
            <Box p="4" borderBottom="1px solid" borderColor="gray.200">
              <Text fontSize="sm" fontWeight="semibold" mb="2">
                Jump to Project:
              </Text>
              <Flex gap="2" flexWrap="wrap" mb="3">
                {selectedProjects.map((proj) => (
                  <Button
                    key={proj}
                    size="sm"
                    colorPalette="blue"
                    variant="outline"
                    onClick={() => handleProjectClick(proj)}
                  >
                    {proj}
                  </Button>
                ))}
              </Flex>

            </Box>
          )}

          {/* Filter attribute selector + per-category toggles */}
          {selectedProjects.length > 0 && (
            <Box borderBottom="1px solid" borderColor="gray.200">
              {/* Tabs: always-present "Projects" tab + one per active filter */}
              <Tabs.Root
                value={categoryFilterAttributeIndex === -1 ? "project" : String(categoryFilterAttributeIndex)}
                onValueChange={e => {
                  if (e.value === "project") {
                    setCategoryFilterAttributeIndex(-1);
                    setPrimaryFocusAttribute("Project");
                    return;
                  }
                  const idx = Number(e.value);
                  setCategoryFilterAttributeIndex(idx);
                  setPrimaryFocusAttribute(activeFilters[idx]);
                }}
                variant="line"
              >
                <Box overflowX="auto">
                  <Tabs.List px="4" minW="max-content">
                    <Tabs.Trigger value="project" fontSize="sm" whiteSpace="nowrap">
                      1. Projects
                    </Tabs.Trigger>
                    {selectedAttributes.map((attr, idx) => (
                      <Tabs.Trigger key={attr} value={String(idx)} fontSize="sm" whiteSpace="nowrap">
                        {idx + 2}. {(ATTRIBUTE_LABELS[attr] ?? attr).slice(0, 22)}
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </Box>

                {[null, ...selectedAttributes].map((attr, i) => {
                  const isProjectsTab = attr === null;
                  const idx = i - 1; // -1 for projects, 0..n for attrs
                  const tabValue = isProjectsTab ? "project" : String(idx);
                  return (
                  <Tabs.Content key={tabValue} value={tabValue} p="4">
                    {isProjectsTab ? (
                      <>
                        <Flex align="center" justify="space-between" mb="2">
                          <Text fontSize="xs" fontWeight="semibold" color="gray.500" _dark={{ color: "gray.400" }}>
                            Projects (toggle to show/hide on the map)
                          </Text>
                          {hiddenProjects.length > 0 && (
                            <Button
                              size="xs"
                              variant="ghost"
                              colorPalette="gray"
                              onClick={() => onHiddenProjectsChange([])}
                            >
                              Show all
                            </Button>
                          )}
                        </Flex>
                        <Flex flexWrap="wrap" gap="2">
                          {loadedProjects.map(projectName => {
                            const hex = projectColors[projectName];
                            const isOn = !hiddenProjects.includes(projectName);
                            return (
                              <Flex
                                key={projectName}
                                as="button"
                                align="center"
                                gap="2"
                                px="3"
                                py="1.5"
                                borderWidth="1px"
                                borderRadius="md"
                                cursor="pointer"
                                userSelect="none"
                                transition="all 0.15s"
                                style={isOn
                                  ? { backgroundColor: hex + "22", borderColor: hex }
                                  : { backgroundColor: "transparent", borderColor: "#E2E8F0" }
                                }
                                onClick={() => {
                                  if (isOn) {
                                    onHiddenProjectsChange([...hiddenProjects, projectName]);
                                  } else {
                                    onHiddenProjectsChange(hiddenProjects.filter(p => p !== projectName));
                                  }
                                }}
                              >
                                <Text
                                  fontSize="sm"
                                  fontWeight={isOn ? "semibold" : "normal"}
                                  color={isOn ? "gray.800" : "gray.400"}
                                  _dark={{ color: isOn ? "gray.100" : "gray.500" }}
                                  userSelect="none"
                                >
                                  {projectName}
                                </Text>
                                <Box
                                  w="30px"
                                  h="17px"
                                  borderRadius="full"
                                  position="relative"
                                  flexShrink={0}
                                  transition="background 0.15s"
                                  style={{ backgroundColor: isOn ? hex : "#CBD5E0" }}
                                >
                                  <Box
                                    position="absolute"
                                    w="13px"
                                    h="13px"
                                    borderRadius="full"
                                    bg="white"
                                    top="2px"
                                    transition="left 0.15s"
                                    style={{ left: isOn ? "15px" : "2px" }}
                                  />
                                </Box>
                              </Flex>
                            );
                          })}
                        </Flex>
                      </>
                    ) : (
                    /* Per-category toggles for the selected attribute */
                    categoryFilterAttribute && (
                      <>
                        {/* Header row: label + reset button */}
                  <Flex align="center" justify="space-between" mb="2">
                    <Text fontSize="xs" fontWeight="semibold" color="gray.500" _dark={{ color: "gray.400" }}>
                      {ATTRIBUTE_LABELS[categoryFilterAttribute] ?? categoryFilterAttribute}
                    </Text>
                    <Button
                      size="xs"
                      variant="ghost"
                      colorPalette="gray"
                      onClick={() => {
                        const opts = ATTRIBUTE_OPTIONS[categoryFilterAttribute] ?? availableCategories;
                        setCategoryToggles(prev => ({
                          ...prev,
                          [categoryFilterAttribute]: Object.fromEntries(opts.map(c => [c, true])),
                        }));
                        const subcatConfig = SUBCATEGORY_MAP[categoryFilterAttribute];
                        if (subcatConfig) {
                          const allChildOpts = Object.values(subcatConfig.parentCategories).flat();
                          setSubcategoryToggles(prev => ({
                            ...prev,
                            [subcatConfig.childAttr]: Object.fromEntries(allChildOpts.map(c => [c, true])),
                          }));
                        }
                      }}
                    >
                      Reset
                    </Button>
                  </Flex>
                  {NUMERIC_FILTER_ATTRIBUTES.has(categoryFilterAttribute) ? (
                    /* Numeric range filter: slider inputs */
                    <Box>
                      <Text fontSize="xs" color="gray.500" mb="2">
                        Range filter for {ATTRIBUTE_LABELS[categoryFilterAttribute] ?? categoryFilterAttribute}:
                      </Text>
                      {(() => {
                        const bounds = dataRangeBounds[categoryFilterAttribute];
                        const [rMin, rMax] = rangeFilters[categoryFilterAttribute] ?? [bounds?.min ?? 0, bounds?.max ?? 100];
                        return (
                          <Box px="2">
                            <Slider
                              min={bounds?.min ?? 0}
                              max={bounds?.max ?? 100}
                              step={1}
                              value={[rMin, rMax]}
                              onValueChange={({ value }) => {
                                setRangeFilters(prev => ({
                                  ...prev,
                                  [categoryFilterAttribute]: [value[0], value[1]] as [number, number],
                                }));
                              }}
                            />
                            <Flex justify="space-between" mt="1">
                              <Text fontSize="xs" color="gray.500">{rMin}</Text>
                              <Text fontSize="xs" color="gray.500">{rMax}</Text>
                            </Flex>
                          </Box>
                        );
                      })()}
                    </Box>
                ) : (
                  /* Layer 2 chips each followed immediately by their Layer 3 children */
                  <Flex direction="column" gap="2">
                    {(ATTRIBUTE_OPTIONS[categoryFilterAttribute] ?? availableCategories).map(category => {
                      const isOn = categoryToggles[categoryFilterAttribute]?.[category] ?? true;
                      const hexColor = getCategoryColor(categoryFilterAttribute, category);
                      const subcatConfig = SUBCATEGORY_MAP[categoryFilterAttribute];
                      const childAttr = subcatConfig?.childAttr;
                      const subcats = subcatConfig?.parentCategories[category];
                      const hasSubcats = isOn && subcats?.length;
                      return (
                        <Box key={category}>
                          {/* Layer 2 chip */}
                          <Flex
                            as="button"
                            align="center"
                            gap="2"
                            px="3"
                            py="1.5"
                            borderWidth="1px"
                            borderRadius="md"
                            cursor="pointer"
                            userSelect="none"
                            transition="all 0.15s"
                            style={isOn
                              ? { backgroundColor: hexColor + "22", borderColor: hexColor }
                              : { backgroundColor: "transparent", borderColor: "#E2E8F0" }
                            }
                            onClick={() => {
                              setCategoryToggles(prev => ({
                                ...prev,
                                [categoryFilterAttribute]: {
                                  ...prev[categoryFilterAttribute],
                                  [category]: !isOn,
                                },
                              }));
                            }}
                          >
                            <Text
                              fontSize="sm"
                              fontWeight={isOn ? "semibold" : "normal"}
                              color={isOn ? "gray.800" : "gray.400"}
                              _dark={{ color: isOn ? "gray.100" : "gray.500" }}
                              userSelect="none"
                            >
                              {category}
                            </Text>
                            <Box
                              w="30px"
                              h="17px"
                              borderRadius="full"
                              position="relative"
                              flexShrink={0}
                              transition="background 0.15s"
                              style={{ backgroundColor: isOn ? hexColor : "#CBD5E0" }}
                            >
                              <Box
                                position="absolute"
                                w="13px"
                                h="13px"
                                borderRadius="full"
                                bg="white"
                                top="2px"
                                transition="left 0.15s"
                                style={{ left: isOn ? "15px" : "2px" }}
                              />
                            </Box>
                          </Flex>

                          {/* Layer 3 chips — only visible when parent is ON */}
                          {hasSubcats && childAttr && (
                            <Box
                              mt="1.5"
                              ml="3"
                              pl="3"
                              borderLeft="2px solid"
                              style={{ borderColor: hexColor + "66" }}
                            >
                              <Flex gap="1.5" flexWrap="wrap">
                                {subcats!.map(sub => {
                                  const subOn = subcategoryToggles[childAttr]?.[sub] ?? true;
                                  const subColor = getCategoryColor(childAttr, sub);
                                  return (
                                    <Flex
                                      key={sub}
                                      as="button"
                                      align="center"
                                      gap="1.5"
                                      px="2.5"
                                      py="1"
                                      borderWidth="1px"
                                      borderRadius="md"
                                      cursor="pointer"
                                      userSelect="none"
                                      transition="all 0.15s"
                                      style={subOn
                                        ? { backgroundColor: subColor + "22", borderColor: subColor }
                                        : { backgroundColor: "transparent", borderColor: "#E2E8F0" }
                                      }
                                      onClick={() => {
                                        setSubcategoryToggles(prev => ({
                                          ...prev,
                                          [childAttr]: {
                                            ...prev[childAttr],
                                            [sub]: !subOn,
                                          },
                                        }));
                                      }}
                                    >
                                      <Text
                                        fontSize="xs"
                                        fontWeight={subOn ? "semibold" : "normal"}
                                        color={subOn ? "gray.700" : "gray.400"}
                                        _dark={{ color: subOn ? "gray.200" : "gray.500" }}
                                        userSelect="none"
                                      >
                                        {sub}
                                      </Text>
                                      <Box
                                        w="24px"
                                        h="14px"
                                        borderRadius="full"
                                        position="relative"
                                        flexShrink={0}
                                        transition="background 0.15s"
                                        style={{ backgroundColor: subOn ? subColor : "#CBD5E0" }}
                                      >
                                        <Box
                                          position="absolute"
                                          w="10px"
                                          h="10px"
                                          borderRadius="full"
                                          bg="white"
                                          top="2px"
                                          transition="left 0.15s"
                                          style={{ left: subOn ? "12px" : "2px" }}
                                        />
                                      </Box>
                                    </Flex>
                                  );
                                })}
                              </Flex>
                            </Box>
                          )}
                        </Box>
                      );
                    })}
                  </Flex>
                  )}
                </>
              )
                    )}
                  </Tabs.Content>
                  );
                })}
              </Tabs.Root>
            </Box>
          )}

          <Box h="650px" position="relative">
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
                <AnalysisSidebar
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
                  zoom={13}
                  maxZoom={22}
                  style={{ width: "100%", height: "100%" }}
                  scrollWheelZoom
                  preferCanvas={true}
                >
                  <MapCursorController
                    mode={(isDeleteMode || isPolygonMode) ? 'delete' : (isPointAddMode || isPolygonAddMode) ? 'add' : 'default'}
                  />
                  {/* Render Polygon Tool */}
                  <PolygonDrawingTool
                    isPolygonMode={isPolygonMode}
                    isPolygonAddMode={isPolygonAddMode}
                    onPolygonPoint={handlePolygonPoint}
                    onPointUpdate={handlePointUpdate}
                    polygonPoints={polygonPoints}
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
                                handlePolygonPoint(L.latLng(latlng[0], latlng[1]));
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
                              let filterContext: CodingFilterContext | null = null;
                              if (activeFilters.length > 0) {
                                // Group visible non-hidden segments by project
                                const projectMap = new Map<string, FilteredProjectData>();
                                visibleSegments
                                  .filter(s => !hiddenProjects.includes(s.projectName))
                                  .forEach(s => {
                                    if (!projectMap.has(s.projectName)) {
                                      projectMap.set(s.projectName, { projectName: s.projectName, filteredIndices: [], points: [] });
                                    }
                                    const entry = projectMap.get(s.projectName)!;
                                    entry.filteredIndices.push(s.idx);
                                    entry.points.push({
                                      latlng: s.latlng,
                                      color: getSegmentRiskBandColor(s.scores),
                                      idx: s.idx,
                                    });
                                  });
                                filterContext = { projects: Array.from(projectMap.values()) };
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

                  {/* GIS Layers — rendered below segments pane (zIndex < 450) */}
                  {gisLayers && showFootpath && gisLayers.footpath?.map((f, i) => (
                    <LeafletPolyline key={`fp-${i}`} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.footpath, weight: 3, opacity: 0.8 }} />
                  ))}
                  {gisLayers && showCycling && gisLayers.cycling?.map((f, i) => (
                    <LeafletPolyline key={`cy-${i}`} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.cycling, weight: 3, opacity: 0.8 }} />
                  ))}
                  {gisLayers && showShared && gisLayers.shared?.map((f, i) => (
                    <LeafletPolyline key={`sh-${i}`} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.shared, weight: 3, opacity: 0.8 }} />
                  ))}
                  {gisLayers && showRoadcrossing && gisLayers.roadcrossing?.map((f, i) => (
                    <LeafletPolyline key={`rc-${i}`} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.roadcrossing, weight: 3, opacity: 0.8 }} />
                  ))}
                  {gisLayers && showKerbLine && gisLayers.kerb_line?.map((f, i) => (
                    <LeafletPolyline key={`kl-${i}`} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.kerb_line, weight: 2, opacity: 0.8 }} />
                  ))}
                  {gisLayers && showBusLane && gisLayers.bus_lane?.map((f, i) => {
                    const isMulti = Array.isArray(f.coordinates[0]) && Array.isArray(f.coordinates[0][0]);
                    if (isMulti) return (f.coordinates as any).map((line: any, j: number) => (
                      <LeafletPolyline key={`bl-${i}-${j}`} positions={line.map((c: any) => [c[1], c[0]])} pathOptions={{ color: gisLayerColors.bus_lane, weight: 4, opacity: 0.8, dashArray: "5, 10" }}><Tooltip>Bus Lane</Tooltip></LeafletPolyline>
                    ));
                    return <LeafletPolyline key={`bl-${i}`} positions={f.coordinates.map((c: any) => [c[1], c[0]])} pathOptions={{ color: gisLayerColors.bus_lane, weight: 4, opacity: 0.8, dashArray: "5, 10" }}><Tooltip>Bus Lane</Tooltip></LeafletPolyline>;
                  })}
                  {gisLayers && showMrtExit && gisLayers.mrt_exit?.map((f, i) => (
                    <CircleMarker key={`mrt-${i}`} center={[f.coordinates[0][1], f.coordinates[0][0]]} radius={6} pathOptions={{ color: gisLayerColors.mrt_exit, weight: 2, opacity: 0.9, fillOpacity: 0.7 }}><Tooltip>MRT Exit</Tooltip></CircleMarker>
                  ))}
                  {gisLayers && showBicycleCrossing && gisLayers.bicycle_crossing?.map((f, i) => (
                    <CircleMarker key={`bc-${i}`} center={[f.coordinates[0][1], f.coordinates[0][0]]} radius={6} pathOptions={{ color: gisLayerColors.bicycle_crossing, weight: 2, opacity: 0.9, fillOpacity: 0.7 }}><Tooltip>Bicycle Crossing</Tooltip></CircleMarker>
                  ))}
                  {gisLayers && showBusStop && gisLayers.bus_stop?.map((f, i) =>
                    f.geometry_type === "point"
                      ? <CircleMarker key={`bs-${i}`} center={[f.coordinates[0][1], f.coordinates[0][0]]} radius={6} pathOptions={{ color: gisLayerColors.bus_stop, weight: 2, opacity: 0.9, fillOpacity: 0.7 }}><Tooltip>Bus Stop</Tooltip></CircleMarker>
                      : <LeafletPolyline key={`bs-${i}`} positions={f.coordinates.map((c: any) => [c[1], c[0]])} pathOptions={{ color: gisLayerColors.bus_stop, weight: 4, opacity: 0.8 }}><Tooltip>Bus Shelter</Tooltip></LeafletPolyline>
                  )}
                  {gisLayers && showParkingLot && gisLayers.parking_lot?.map((f, i) =>
                    f.geometry_type === "polygon"
                      ? <LeafletPolygon key={`pk-${i}`} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.parking_lot, weight: 2, opacity: 0.8, fillOpacity: 0.3 }}><Tooltip>Parking Lot</Tooltip></LeafletPolygon>
                      : <CircleMarker key={`pk-${i}`} center={[f.coordinates[0][1], f.coordinates[0][0]]} radius={6} pathOptions={{ color: gisLayerColors.parking_lot, weight: 2, opacity: 0.9, fillOpacity: 0.7 }}><Tooltip>Parking Lot</Tooltip></CircleMarker>
                  )}
                  {gisLayers && showStateLand && gisLayers.state_land?.map((f, i) => (
                    <LeafletPolygon key={`sl-${i}`} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.state_land, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}><Tooltip>{f.properties?.OWNRSHP_CL ?? "State Land"}</Tooltip></LeafletPolygon>
                  ))}
                  {gisLayers && showStatBoard && gisLayers.stat_board?.map((f, i) => (
                    <LeafletPolygon key={`sb-${i}`} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.stat_board, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}><Tooltip>{f.properties?.OWNRSHP_CL ?? "Stat Board"}</Tooltip></LeafletPolygon>
                  ))}
                  {gisLayers && showLandPrivate && gisLayers.land_private?.map((f, i) => (
                    <LeafletPolygon key={`lp-${i}`} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.land_private, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}><Tooltip>{f.properties?.OWNRSHP_CL ?? "Private Land"}</Tooltip></LeafletPolygon>
                  ))}
                  {gisLayers && showLandMinistry && gisLayers.land_ministry?.map((f, i) => (
                    <LeafletPolygon key={`lm-${i}`} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.land_ministry, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}><Tooltip>{f.properties?.OWNRSHP_CL ?? "Ministry Land"}</Tooltip></LeafletPolygon>
                  ))}
                  {showPathDefects && pathDefects?.map((d, i) => (
                    <CircleMarker key={`def-${i}`} center={[d.lat, d.lon]} radius={7} pathOptions={{ color: "#EF4444", weight: 2, opacity: 1, fillOpacity: 0.8 }}>
                      <Tooltip>{`${d.type_of_defect || "Defect"} — ${d.location || "Unknown"}${d.date_of_inspection ? ` (${d.date_of_inspection})` : ""}`}</Tooltip>
                    </CircleMarker>
                  ))}

                  {/* Imported shapefile overlay — non-interactive so hover doesn't interfere with segment nodes */}
                  {importedBoundaries.map((boundary) =>
                    boundary.kind === "polygon" && boundary.coords ? (
                      <LeafletPolygon
                        key={boundary.key}
                        positions={boundary.coords}
                        pathOptions={{ color: "#EA580C", weight: 2, opacity: 0.95, fillColor: "#FDBA74", fillOpacity: 0.2, interactive: false }}
                      />
                    ) : (
                      <>
                        {(boundary.lineCoordsSets ?? []).map((lineCoords, partIndex) => (
                          <LeafletPolyline
                            key={`${boundary.key}-${partIndex}`}
                            positions={lineCoords}
                            pathOptions={{ color: "#EA580C", weight: 2.5, opacity: 0.95, interactive: false }}
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
        <Tabs.Content value="table">
          <Box>
            {selectedProjects.length > 0 && allPoints.length > 0 && (
              <Box p="4" borderBottom="1px solid" borderColor="gray.200">
                <Text fontSize="sm" fontWeight="semibold" mb="2">
                  Jump to Project:
                </Text>
                <Flex gap="2" flexWrap="wrap">
                  {selectedProjects.map((proj) => (
                    <Button
                      key={proj}
                      size="sm"
                      colorPalette="blue"
                      variant="outline"
                      onClick={() => handleTableProjectJump(proj)}
                    >
                      {proj}
                    </Button>
                  ))}
                </Flex>
              </Box>
            )}
            {allPoints.length === 0 ? (
              <Box p="6">
                <Text color="gray.500">No data to display. Please select projects and load them.</Text>
              </Box>
            ) : (
              <>
                {/* Above-table controls */}
                <Box p="4" borderBottom="1px solid" borderColor="gray.200" bg="gray.50" _dark={{ bg: "gray.700" }}>
                  {/* Sort Controls */}
                  {sortConfig.length > 0 && (
                    <Box>
                      <Text fontSize="sm" fontWeight="semibold" mb="2">Active Sort Order:</Text>
                      <Flex gap="2" flexWrap="wrap">
                        {sortConfig.map((sort, index) => (
                          <Flex key={sort.column} align="center" gap="2" px="3" py="1" bg="blue.50" borderRadius="md" _dark={{ bg: "blue.900" }}>
                            <Text fontSize="sm" fontWeight="500">
                              {index + 1}. {sort.column} {sort.direction === 'asc' ? '↑' : '↓'}
                            </Text>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => {
                                setSortConfig(prev => prev.filter((_, i) => i !== index));
                              }}
                            >
                              ✕
                            </Button>
                          </Flex>
                        ))}
                      </Flex>
                    </Box>
                  )}

                  {/* Filtered count + clear */}
                  <Flex align="center" gap="3" mt="3">
                    <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
                      Showing {sortedData.length} of {allPoints.length} segments
                    </Text>
                    {(sortConfig.length > 0 || Object.keys(columnFilters).length > 0) && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setGlobalSearch("");
                          setColumnFilters({});
                          setSortConfig([]);
                        }}
                      >
                        Clear All
                      </Button>
                    )}
                  </Flex>
                </Box>

                {/* Table */}
                <Box ref={tableContainerRef} overflowX="auto" overflowY="auto" maxH="650px">
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: "var(--chakra-colors-bg-subtle)" }}>
                        {tableColumns.map(col => {
                          const sortIndex = sortConfig.findIndex(s => s.column === col.key);
                          const sortDirection = sortIndex >= 0 ? sortConfig[sortIndex].direction : null;

                          return (
                            <th
                              key={col.key}
                              style={{
                                padding: "8px 12px",
                                textAlign: "left",
                                borderBottom: "2px solid var(--chakra-colors-border-subtle)",
                                cursor: "pointer",
                                userSelect: "none",
                                position: "sticky",
                                top: 0,
                                zIndex: 1,
                                backgroundColor: "var(--chakra-colors-bg-subtle)",
                              }}
                              onClick={() => handleHeaderClick(col.key)}
                            >
                              <Flex align="center" gap="2" mb="1">
                                <Text fontWeight="600" fontSize="sm">
                                  {col.label}
                                </Text>
                                {sortDirection && (
                                  <Text fontSize="xs" color="blue.600">
                                    {sortDirection === 'asc' ? '↑' : '↓'}
                                    {sortIndex > 0 && <sup>{sortIndex + 1}</sup>}
                                  </Text>
                                )}
                              </Flex>
                              {/* Per-column filter input */}
                              <Input
                                size="xs"
                                placeholder={`Filter ${col.label}...`}
                                value={columnFilters[col.key] || ""}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                  e.stopPropagation();
                                  setColumnFilters(prev => ({
                                    ...prev,
                                    [col.key]: e.target.value
                                  }));
                                }}
                                onClick={(e: React.MouseEvent<HTMLInputElement>) => e.stopPropagation()}
                              />
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedData.length === 0 ? (
                        <tr>
                          <td colSpan={tableColumns.length} style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid #e2e8f0" }}>
                            <Text color="gray.500" fontSize="sm">No results found</Text>
                          </td>
                        </tr>
                      ) : (
                        sortedData.map(({ idx, latlng, f, projectName, color, attributes }, globalIdx) => (
                          <tr key={`${projectName}-${idx}-${globalIdx}`} data-project={projectName}>
                            {tableColumns.map(col => {
                              const value = getColumnValue(
                                { idx, latlng, f, projectName, color, attributes },
                                col.key
                              );

                              return (
                                <td key={col.key} style={{ padding: "12px", borderBottom: "1px solid #e2e8f0" }}>
                                  {col.key === "Project" ? (
                                    <Flex align="center" gap="2">
                                      <Box w="8px" h="8px" borderRadius="full" bg={color} />
                                      <Text fontSize="sm">{value}</Text>
                                    </Flex>
                                  ) : col.key === "Coordinates" ? (
                                    <Text fontSize="xs" fontFamily="mono">{value}</Text>
                                  ) : col.key === "Overall Risk Score" ? (
                                    <Text fontSize="sm" fontWeight="600">{value}</Text>
                                  ) : (
                                    <Text fontSize="sm">{value}</Text>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </Box>
              </>
            )}
          </Box>
        </Tabs.Content>
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
          // Show success toast is inside the dialog
        }}
      />
    </Box >
  );
}

