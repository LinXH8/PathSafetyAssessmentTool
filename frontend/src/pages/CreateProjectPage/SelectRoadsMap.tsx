import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Box,
  Button,
  Text,
  Flex,
  HStack,
  Badge,
} from "@chakra-ui/react";
import {
  MapContainer,
  Marker,
  Polyline as LeafletPolyline,
  Polygon as LeafletPolygon,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { FaDrawPolygon, FaFileImport, FaMapMarkedAlt, FaRoad, FaTrash } from "react-icons/fa";
import { FiChevronsLeft, FiChevronsRight } from "react-icons/fi";
import ThemeAwareTileLayer from "../../components/common/ThemeAwareTileLayer";
import { MapCursorController } from "../../components/common/MapCursorController";
import {
  previewUploadedShapefiles,
  queryPlanningAreasInBounds,
  queryRoadsInBounds,
  queryRoadsByName,
  queryRoadsInSelection,
  type PlanningAreaInBounds,
  type ProjectSelectionGeometry,
  type RoadInBounds,
} from "../../api";
import { toaster } from "../../components/ui/toaster";
import { FONT, COLOR } from "../../features/ui/designTokens";
import type { Feature, FeatureCollection, GeoJsonProperties, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const polygonVertexIcon = L.divIcon({
  className: "",
  html: '<div style="width:14px;height:14px;border-radius:9999px;background:#dc2626;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

type PolygonSource = "manual" | "planning-area" | "uploaded-shapefile" | null;

interface UploadedBoundaryFeature {
  key: string;
  label: string;
  kind: "polygon" | "line";
  selectionGeometry: ProjectSelectionGeometry;
  focusPoints: [number, number][];
  coords?: [number, number][];
  lineCoordsSets?: [number, number][][];
}

const SHAPEFILE_ACCEPT = ".zip,.shp,.shx,.dbf,.prj,.cpg,.sbn,.sbx";
const FEATURE_LABEL_KEYS = [
  "name",
  "Name",
  "NAME",
  "label",
  "Label",
  "LABEL",
  "pln_area_n",
  "PLN_AREA_N",
  "subzone_n",
  "SUBZONE_N",
  "region_n",
  "REGION_N",
  "id",
  "ID",
  "OBJECTID",
  "FID",
];

function cloneCoords(coords: [number, number][]): [number, number][] {
  return coords.map(([lat, lng]) => [lat, lng]);
}

function getUploadedBoundaryLabel(properties: GeoJsonProperties | null | undefined, featureIndex: number): string {
  if (properties) {
    for (const key of FEATURE_LABEL_KEYS) {
      const value = properties[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }
  }

  return `Uploaded Feature ${featureIndex + 1}`;
}

function toLeafletCoords(ring: number[][]): [number, number][] {
  return ring
    .filter((coord) => coord.length >= 2 && Number.isFinite(coord[0]) && Number.isFinite(coord[1]))
    .map(([lng, lat]) => [lat, lng]);
}

function toPolygonSelectionGeometry(points: [number, number][]): ProjectSelectionGeometry | null {
  if (points.length < 3) {
    return null;
  }

  const ring = points.map(([lat, lng]) => [lng, lat]);
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  if (firstLng !== lastLng || firstLat !== lastLat) {
    ring.push([firstLng, firstLat]);
  }

  return { type: "Polygon", coordinates: [ring] };
}

function extractUploadedBoundaryFeatures(collection: FeatureCollection): UploadedBoundaryFeature[] {
  const boundaries: UploadedBoundaryFeature[] = [];
  const aggregatedLineCoords: number[][][] = [];
  const aggregatedLineLabels: string[] = [];

  collection.features.forEach((feature: Feature, featureIndex) => {
    const baseLabel = getUploadedBoundaryLabel(feature.properties, featureIndex);
    const geometry = feature.geometry;

    if (!geometry) {
      return;
    }

    const appendBoundary = (ring: number[][], partIndex: number, totalParts: number) => {
      const coords = toLeafletCoords(ring);
      if (coords.length < 3) {
        return;
      }

      boundaries.push({
        key: `${featureIndex}-${partIndex}`,
        label: totalParts > 1 ? `${baseLabel} (part ${partIndex + 1})` : baseLabel,
        kind: "polygon",
        selectionGeometry: {
          type: "Polygon",
          coordinates: [ring],
        },
        focusPoints: cloneCoords(coords),
        coords,
      });
    };

    const appendLine = (lineCoords: number[][]) => {
      const coords = toLeafletCoords(lineCoords);
      if (coords.length < 2) {
        return;
      }
      aggregatedLineCoords.push(lineCoords);
      aggregatedLineLabels.push(baseLabel);
    };

    if (geometry.type === "Polygon") {
      const polygon = geometry as Polygon;
      if (polygon.coordinates[0]) {
        appendBoundary(polygon.coordinates[0] as number[][], 0, 1);
      }
      return;
    }

    if (geometry.type === "MultiPolygon") {
      const multiPolygon = geometry as MultiPolygon;
      multiPolygon.coordinates.forEach((polygonCoords, partIndex) => {
        if (polygonCoords[0]) {
          appendBoundary(polygonCoords[0] as number[][], partIndex, multiPolygon.coordinates.length);
        }
      });
      return;
    }

    if (geometry.type === "LineString") {
      appendLine((geometry as LineString).coordinates as number[][]);
      return;
    }

    if (geometry.type === "MultiLineString") {
      (geometry as MultiLineString).coordinates.forEach((lineCoords) => {
        appendLine(lineCoords as number[][]);
      });
    }
  });

  if (aggregatedLineCoords.length > 0) {
    const lineCoordsSets = aggregatedLineCoords.map((lineCoords) => toLeafletCoords(lineCoords)).filter((coords) => coords.length >= 2);
    const focusPoints = lineCoordsSets.flatMap((coords) => cloneCoords(coords));
    boundaries.push({
      key: "uploaded-lines",
      label: aggregatedLineLabels.length === 1
        ? aggregatedLineLabels[0]
        : `Uploaded Lines (${aggregatedLineCoords.length} features)`,
      kind: "line",
      selectionGeometry: aggregatedLineCoords.length === 1
        ? { type: "LineString", coordinates: aggregatedLineCoords[0] }
        : { type: "MultiLineString", coordinates: aggregatedLineCoords },
      focusPoints,
      lineCoordsSets,
    });
  }

  return boundaries;
}

function mergeRoadSelection(
  previousRoads: SelectedRoad[],
  nextRoads: Array<Omit<SelectedRoad, "selected">>,
  fallback: boolean
): SelectedRoad[] {
  const previousSelection = new Map(
    previousRoads.map((road) => [road.name, road.selected])
  );

  return nextRoads.map((road) => ({
    ...road,
    selected: previousSelection.get(road.name) ?? !fallback,
  }));
}

// ── Map click handler ──────────────────────────────────────────────
function MapClickHandler({
  active,
  onPoint,
}: {
  active: boolean;
  onPoint: (latlng: L.LatLng) => void;
}) {
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  useMapEvents({
    click(e) {
      if (activeRef.current) onPoint(e.latlng);
    },
  });
  return null;
}

function MapViewportWatcher({
  onViewportChange,
}: {
  onViewportChange: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number; zoom: number }) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const b = map.getBounds();
    onViewportChange({
      minLat: b.getSouth(),
      minLng: b.getWest(),
      maxLat: b.getNorth(),
      maxLng: b.getEast(),
      zoom: map.getZoom(),
    });
  }, [map, onViewportChange]);

  useMapEvents({
    moveend(e) {
      const m = e.target;
      const b = m.getBounds();
      onViewportChange({
        minLat: b.getSouth(),
        minLng: b.getWest(),
        maxLat: b.getNorth(),
        maxLng: b.getEast(),
        zoom: m.getZoom(),
      });
    },
    zoomend(e) {
      const m = e.target;
      const b = m.getBounds();
      onViewportChange({
        minLat: b.getSouth(),
        minLng: b.getWest(),
        maxLat: b.getNorth(),
        maxLng: b.getEast(),
        zoom: m.getZoom(),
      });
    },
  });

  return null;
}

function MapBoundsFitter({
  points,
}: {
  points: [number, number][] | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!points || points.length === 0) {
      return;
    }

    map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
  }, [map, points]);

  return null;
}

// Re-measure the map once layout settles and on container resize. In the v2
// layout the map fills a flex cell whose height can finalize after Leaflet
// inits, which otherwise leaves a half-grey tile area.
function MapAutosize() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    const t = window.setTimeout(fix, 200);
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(map.getContainer());
    } catch { /* ResizeObserver unsupported — the timeout still covers mount */ }
    return () => { clearTimeout(t); ro?.disconnect(); };
  }, [map]);
  return null;
}

// ── Polygon overlay ────────────────────────────────────────────────
function PolygonOverlay({
  points,
}: {
  points: [number, number][];
}) {
  if (points.length === 0) return null;
  return (
    <>
      <LeafletPolyline
        positions={points}
        pathOptions={{ color: "red", dashArray: "5, 5" }}
      />
      {points.length >= 3 && (
        <LeafletPolygon
          positions={points}
          pathOptions={{ color: "red", fillOpacity: 0.15 }}
        />
      )}
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────
export interface SelectedRoad {
  /** The real, createable source-folder name (carries quarter suffix when downloaded). */
  name: string;
  /** Human-friendly display label, e.g. "TPY Lor 4 (1Q2026)". Falls back to `name`. */
  label?: string;
  points: number;
  exists: boolean;
  selected: boolean;
}

interface SelectRoadsMapProps {
  onSelectionChange: (roads: SelectedRoad[]) => void;
  onSelectionGeometryChange: (selectionGeometry: ProjectSelectionGeometry | null) => void;
  refreshKey?: number;
  focusRoadName?: string;
  /** "v1" (default) = current Chakra layout; "v2" = Home.dc.html Frame 2 map layout. */
  variant?: "v1" | "v2";
}

export default function SelectRoadsMap({ onSelectionChange, onSelectionGeometryChange, refreshKey = 0, focusRoadName, variant = "v1" }: SelectRoadsMapProps) {
  // v2-only: the Layer View side panel can be collapsed via the map's edge rail.
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  // Polygon state
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);
  const [polygonSource, setPolygonSource] = useState<PolygonSource>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [uploadedBoundaries, setUploadedBoundaries] = useState<UploadedBoundaryFeature[]>([]);
  const [uploadedBoundaryName, setUploadedBoundaryName] = useState<string | null>(null);
  const [uploadedBoundaryLoading, setUploadedBoundaryLoading] = useState(false);
  const [uploadedBoundaryError, setUploadedBoundaryError] = useState<string | null>(null);
  const [highlightUploadedBoundaryKey, setHighlightUploadedBoundaryKey] = useState<string | null>(null);
  const [mapFocusPoints, setMapFocusPoints] = useState<[number, number][] | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Road results
  const [roads, setRoads] = useState<SelectedRoad[]>([]);
  const [querying, setQuerying] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);
  const [showRoadOverlay, setShowRoadOverlay] = useState(false);
  const [viewportState, setViewportState] = useState<{ minLat: number; minLng: number; maxLat: number; maxLng: number; zoom: number } | null>(null);
  const [overlayRoads, setOverlayRoads] = useState<RoadInBounds[]>([]);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [highlightRoadName, setHighlightRoadName] = useState<string | null>(null);
  const [showPlanningAreaOverlay, setShowPlanningAreaOverlay] = useState(false);
  const [overlayPlanningAreas, setOverlayPlanningAreas] = useState<PlanningAreaInBounds[]>([]);
  const [planningAreaLoading, setPlanningAreaLoading] = useState(false);
  const [highlightPlanningAreaKey, setHighlightPlanningAreaKey] = useState<string | null>(null);
  const [selectedUploadedBoundary, setSelectedUploadedBoundary] = useState<UploadedBoundaryFeature | null>(null);
  const [focusRoadSegments, setFocusRoadSegments] = useState<RoadInBounds[]>([]);
  const roadsRef = useRef<SelectedRoad[]>([]);
  const polygonSourceRef = useRef<PolygonSource>(null);
  // Memoize so the geometry keeps a stable identity across renders. Without this
  // it is a fresh object every render, which makes the effects below re-fire in a
  // loop and perpetually cancel the debounced road query before it can run.
  const currentSelectionGeometry = useMemo(
    () => selectedUploadedBoundary?.selectionGeometry ?? toPolygonSelectionGeometry(polygonPoints),
    [selectedUploadedBoundary, polygonPoints]
  );

  useEffect(() => {
    roadsRef.current = roads;
  }, [roads]);

  useEffect(() => {
    polygonSourceRef.current = polygonSource;
  }, [polygonSource]);

  useEffect(() => {
    const name = (focusRoadName ?? "").trim();
    if (!name) {
      setFocusRoadSegments([]);
      return;
    }
    let cancelled = false;
    queryRoadsByName(name)
      .then((segments) => {
        if (cancelled) return;
        setFocusRoadSegments(segments);
        if (segments.length > 0) {
          setMapFocusPoints(segments.flatMap((s) => s.coords));
        }
      })
      .catch(() => {
        if (!cancelled) setFocusRoadSegments([]);
      });
    return () => { cancelled = true; };
  }, [focusRoadName]);

  // ─ Handlers ─────────────────────────────────────────────────────
  const addPoint = useCallback((latlng: L.LatLng) => {
    setSelectedUploadedBoundary(null);
    setHighlightPlanningAreaKey(null);
    setHighlightUploadedBoundaryKey(null);
    setPolygonSource("manual");
    setPolygonPoints((prev) =>
      polygonSourceRef.current === "planning-area"
        ? [[latlng.lat, latlng.lng]]
        : [...prev, [latlng.lat, latlng.lng]]
    );
  }, []);

  const movePoint = useCallback((index: number, latlng: L.LatLng) => {
    setSelectedUploadedBoundary(null);
    setHighlightUploadedBoundaryKey(null);
    setPolygonSource("manual");
    setPolygonPoints((prev) =>
      prev.map((point, pointIndex) =>
        pointIndex === index ? [latlng.lat, latlng.lng] : point
      )
    );
  }, []);

  const clearPolygon = useCallback(() => {
    setPolygonPoints([]);
    setPolygonSource(null);
    setSelectedUploadedBoundary(null);
    setRoads([]);
    setQueryError(null);
    setIsFallback(false);
    setHighlightPlanningAreaKey(null);
    setHighlightUploadedBoundaryKey(null);
    onSelectionChange([]);
    onSelectionGeometryChange(null);
  }, [onSelectionChange, onSelectionGeometryChange]);

  const selectPlanningArea = useCallback((area: PlanningAreaInBounds) => {
    setIsDrawing(false);
    setPolygonSource("planning-area");
    setSelectedUploadedBoundary(null);
    setQueryError(null);
    setIsFallback(false);
    setHighlightPlanningAreaKey(`${area.name}-${area.partIndex}`);
    setHighlightUploadedBoundaryKey(null);
    setPolygonPoints(area.coords);
    setMapFocusPoints(cloneCoords(area.coords));
  }, []);

  const selectUploadedBoundary = useCallback((boundary: UploadedBoundaryFeature) => {
    setIsDrawing(false);
    setPolygonSource("uploaded-shapefile");
    setSelectedUploadedBoundary(boundary);
    setQueryError(null);
    setIsFallback(false);
    setHighlightPlanningAreaKey(null);
    setHighlightUploadedBoundaryKey(boundary.key);
    setPolygonPoints(boundary.kind === "polygon" ? cloneCoords(boundary.coords ?? []) : []);
    setMapFocusPoints(cloneCoords(boundary.focusPoints));
  }, []);

  const clearUploadedBoundaries = useCallback(() => {
    if (polygonSourceRef.current === "uploaded-shapefile") {
      clearPolygon();
    }
    setUploadedBoundaries([]);
    setUploadedBoundaryName(null);
    setUploadedBoundaryError(null);
    setHighlightUploadedBoundaryKey(null);
  }, [clearPolygon]);

  const handleBoundaryFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    const sourceFile = files.find((file) => file.name.toLowerCase().endsWith(".shp") || file.name.toLowerCase().endsWith(".zip"));
    if (!sourceFile) {
      const message = "Upload a .zip shapefile or a .shp file with its companion files (.dbf, .shx, .prj).";
      setUploadedBoundaryError(message);
      toaster.create({ title: "Boundary import failed", description: message, type: "warning" });
      return;
    }

    setUploadedBoundaryLoading(true);
    setUploadedBoundaryError(null);

    try {
      clearPolygon();
      const geojson = await previewUploadedShapefiles(files);
      const boundaries = extractUploadedBoundaryFeatures(geojson);
      if (boundaries.length === 0) {
        throw new Error("No polygon or line features were found in the uploaded shapefile.");
      }

      setUploadedBoundaryName(sourceFile.name);
      setUploadedBoundaries(boundaries);
      setHighlightUploadedBoundaryKey(null);
      setMapFocusPoints(cloneCoords(boundaries.flatMap((boundary) => boundary.focusPoints)));

      if (boundaries.length === 1) {
        selectUploadedBoundary(boundaries[0]);
        toaster.create({
          title: "Shapefile imported",
          description: boundaries[0].kind === "line"
            ? `${sourceFile.name} was imported and its line network was selected automatically.`
            : `${sourceFile.name} was imported and its only polygon was selected automatically.`,
          type: "success",
        });
      } else {
        toaster.create({
          title: "Shapefile imported",
          description: `${sourceFile.name} was imported. Click one of the shapes on the map to use it.`,
          type: "success",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import shapefile.";
      setUploadedBoundaries([]);
      setUploadedBoundaryName(null);
      setUploadedBoundaryError(message);
      toaster.create({ title: "Shapefile import failed", description: message, type: "error" });
    } finally {
      setUploadedBoundaryLoading(false);
    }
  }, [clearPolygon, selectUploadedBoundary]);

  useEffect(() => {
    if (!showRoadOverlay || !viewportState || viewportState.zoom < 13) {
      setOverlayRoads([]);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setOverlayLoading(true);
      try {
        const result = await queryRoadsInBounds(
          {
            minLat: viewportState.minLat,
            minLng: viewportState.minLng,
            maxLat: viewportState.maxLat,
            maxLng: viewportState.maxLng,
          },
          2500
        );
        if (!cancelled) {
          setOverlayRoads(result);
        }
      } catch (e) {
        if (!cancelled) {
          setOverlayRoads([]);
        }
      } finally {
        if (!cancelled) {
          setOverlayLoading(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [showRoadOverlay, viewportState]);

  useEffect(() => {
    if (!showPlanningAreaOverlay || !viewportState || viewportState.zoom < 10) {
      setOverlayPlanningAreas([]);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setPlanningAreaLoading(true);
      try {
        const result = await queryPlanningAreasInBounds(
          {
            minLat: viewportState.minLat,
            minLng: viewportState.minLng,
            maxLat: viewportState.maxLat,
            maxLng: viewportState.maxLng,
          },
          300
        );
        if (!cancelled) {
          setOverlayPlanningAreas(result);
        }
      } catch (e) {
        if (!cancelled) {
          setOverlayPlanningAreas([]);
        }
      } finally {
        if (!cancelled) {
          setPlanningAreaLoading(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [showPlanningAreaOverlay, viewportState]);

  useEffect(() => {
    onSelectionGeometryChange(currentSelectionGeometry ?? null);
  }, [currentSelectionGeometry, onSelectionGeometryChange]);

  // ─ Query backend when a selection geometry is active ────────────
  useEffect(() => {
    if (currentSelectionGeometry == null) {
      setRoads([]);
      roadsRef.current = [];
      onSelectionChange([]);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(async () => {
      setQuerying(true);
      setQueryError(null);
      try {
        const { roads: result, fallback } = await queryRoadsInSelection(currentSelectionGeometry);
        if (cancelled) return;
        setIsFallback(fallback);
        const mapped = mergeRoadSelection(roadsRef.current, result, fallback);
        setRoads(mapped);
        roadsRef.current = mapped;
        onSelectionChange(mapped);
      } catch (e: any) {
        if (!cancelled) setQueryError(e?.message ?? "Query failed");
      } finally {
        if (!cancelled) setQuerying(false);
      }
    }, 400); // debounce

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [currentSelectionGeometry, onSelectionChange, refreshKey]);

  // ─ Selection helpers ────────────────────────────────────────────
  const toggleRoad = useCallback(
    (name: string) => {
      setRoads((prev) => {
        const next = prev.map((r) =>
          r.name === name ? { ...r, selected: !r.selected } : r
        );
        onSelectionChange(next);
        return next;
      });
    },
    [onSelectionChange]
  );

  const selectAll = useCallback(() => {
    setRoads((prev) => {
      const next = prev.map((r) => ({ ...r, selected: true }));
      onSelectionChange(next);
      return next;
    });
  }, [onSelectionChange]);

  const deselectAll = useCallback(() => {
    setRoads((prev) => {
      const next = prev.map((r) => ({ ...r, selected: false }));
      onSelectionChange(next);
      return next;
    });
  }, [onSelectionChange]);

  const deselectUnavailable = useCallback(() => {
    setRoads((prev) => {
      const next = prev.map((road) =>
        road.selected && !road.exists ? { ...road, selected: false } : road
      );
      onSelectionChange(next);
      return next;
    });
  }, [onSelectionChange]);

  const allSelected = roads.length > 0 && roads.every((r) => r.selected);
  const selectedUnavailableCount = roads.filter((road) => road.selected && !road.exists).length;
  const availableRoadCount = roads.filter((road) => road.exists).length;
  const unavailableRoadCount = roads.length - availableRoadCount;
  const toolbarStatus = isDrawing
    ? "Click on the map to place vertices. Draw at least 3 points."
    : polygonSource === "manual" && polygonPoints.length > 0
      ? "Drag the red vertices to fine-tune a manually drawn polygon."
    : showRoadOverlay && overlayLoading
      ? "Loading roads..."
      : showPlanningAreaOverlay && planningAreaLoading
        ? "Loading planning areas..."
        : null;

  let roadStatus: { text: string; color: string } | null = null;
  if (querying) {
    roadStatus = { text: "Searching for roads...", color: "gray.500" };
  } else if (queryError) {
    roadStatus = { text: queryError, color: "red.500" };
  } else if (currentSelectionGeometry != null && roads.length === 0) {
    roadStatus = { text: "No roads found in the selected area or path.", color: "gray.500" };
  } else if (showPlanningAreaOverlay && !planningAreaLoading && viewportState && viewportState.zoom < 10) {
    roadStatus = { text: "Zoom in to level 10 or above to view planning areas.", color: "gray.500" };
  }

  const uploadedBoundaryStatus = uploadedBoundaryLoading
    ? { text: "Importing shapefile...", color: "blue.500" }
    : uploadedBoundaryError
      ? { text: uploadedBoundaryError, color: "red.500" }
      : uploadedBoundaries.length > 0
        ? {
            text: polygonSource === "uploaded-shapefile"
              ? `Using imported selection from ${uploadedBoundaryName ?? "shapefile"}.`
              : `Imported ${uploadedBoundaryName ?? "shapefile"}. Click a shape on the map to use it.`,
            color: "blue.600",
          }
        : null;

  // ── Shared map element (identical Leaflet setup for both variants) ──
  const renderMap = () => (
    <MapContainer
      center={[1.3521, 103.8198]}
      zoom={12}
      style={{ height: variant === "v2" ? "100%" : "350px", width: "100%" }}
      scrollWheelZoom
    >
      <ThemeAwareTileLayer />
      <MapAutosize />
      <MapCursorController mode={isDrawing ? "add" : "default"} />
      <MapClickHandler active={isDrawing} onPoint={addPoint} />
      <MapViewportWatcher onViewportChange={setViewportState} />
      <MapBoundsFitter points={mapFocusPoints} />
      {showPlanningAreaOverlay && overlayPlanningAreas.map((area) => {
        const areaKey = `${area.name}-${area.partIndex}`;
        const isHighlighted = highlightPlanningAreaKey === areaKey;
        return (
          <LeafletPolygon
            key={areaKey}
            positions={area.coords}
            pathOptions={{
              color: isHighlighted ? "#0F766E" : "#0D9488",
              weight: isHighlighted ? 3 : 1.5,
              opacity: 0.9,
              fillColor: isHighlighted ? "#14B8A6" : "#5EEAD4",
              fillOpacity: isHighlighted ? 0.28 : 0.12,
            }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e as any);
                selectPlanningArea(area);
              },
            }}
          >
            <Popup>
              <Text fontSize="sm" fontWeight="semibold">{area.name}</Text>
            </Popup>
          </LeafletPolygon>
        );
      })}
      {uploadedBoundaries.map((boundary) => {
        const isHighlighted = highlightUploadedBoundaryKey === boundary.key;
        return (
          boundary.kind === "polygon" && boundary.coords ? (
            <LeafletPolygon
              key={boundary.key}
              positions={boundary.coords}
              pathOptions={{
                color: isHighlighted ? "#C2410C" : "#EA580C",
                weight: isHighlighted ? 3 : 1.5,
                opacity: 0.95,
                fillColor: isHighlighted ? "#FB923C" : "#FDBA74",
                fillOpacity: isHighlighted ? 0.28 : 0.14,
              }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e as any);
                  selectUploadedBoundary(boundary);
                },
              }}
            >
              <Popup>
                <Text fontSize="sm" fontWeight="semibold">{boundary.label}</Text>
                <Text fontSize="xs" color="orange.700">Imported area selection</Text>
              </Popup>
            </LeafletPolygon>
          ) : (
            <>
              {(boundary.lineCoordsSets ?? []).map((lineCoords, partIndex) => (
                <LeafletPolyline
                  key={`${boundary.key}-${partIndex}`}
                  positions={lineCoords}
                  pathOptions={{
                    color: isHighlighted ? "#C2410C" : "#EA580C",
                    weight: isHighlighted ? 4 : 2.5,
                    opacity: 0.95,
                  }}
                  eventHandlers={{
                    click: (e) => {
                      L.DomEvent.stopPropagation(e as any);
                      selectUploadedBoundary(boundary);
                    },
                  }}
                >
                  <Popup>
                    <Text fontSize="sm" fontWeight="semibold">{boundary.label}</Text>
                    <Text fontSize="xs" color="orange.700">Imported path selection</Text>
                  </Popup>
                </LeafletPolyline>
              ))}
            </>
          )
        );
      })}
      {showRoadOverlay && overlayRoads.map((road, idx) => (
        <LeafletPolyline
          key={`${road.name}-${idx}`}
          positions={road.coords}
          pathOptions={{
            color: highlightRoadName === road.name ? "#1D4ED8" : (road.exists ? "#16A34A" : "#6B7280"),
            weight: highlightRoadName === road.name ? 4 : 2,
            opacity: 0.75,
          }}
          eventHandlers={{
            click: () => {
              setHighlightRoadName(road.name);
              const hit = roads.find((r) => r.name === road.name);
              if (hit && !hit.selected) {
                toggleRoad(road.name);
              }
            },
          }}
        >
          <Popup>
            <Text fontSize="xs" fontWeight="bold">{road.name}</Text>
            <Text fontSize="xs" color={road.exists ? "green.600" : "orange.600"}>
              {road.exists ? "Available" : "Not Downloaded"}
            </Text>
          </Popup>
        </LeafletPolyline>
      ))}
      {focusRoadSegments.map((seg, idx) => (
        <LeafletPolyline
          key={`focus-road-${idx}`}
          positions={seg.coords}
          pathOptions={{ color: "#F59E0B", weight: 5, opacity: 0.9 }}
          interactive={false}
        />
      ))}
      <PolygonOverlay
        points={polygonPoints}
      />
      {polygonSource === "manual" && polygonPoints.map((point, index) => (
        <Marker
          key={`polygon-point-${index}-${point[0]}-${point[1]}`}
          position={point}
          icon={polygonVertexIcon}
          draggable
          eventHandlers={{
            dragend: (event) => {
              const latlng = (event.target as L.Marker).getLatLng();
              movePoint(index, latlng);
            },
          }}
        />
      ))}
    </MapContainer>
  );

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept={SHAPEFILE_ACCEPT}
      multiple
      onChange={handleBoundaryFileChange}
      style={{ display: "none" }}
    />
  );

  // ── v2 render — Home.dc.html Frame 2 map layout ──────────────────
  if (variant === "v2") {
    return (
      <div style={{ display: "flex", gap: 16, height: "100%", minHeight: 0 }}>
        {/* Left: map card (Layer View panel + map well) */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", overflow: "hidden", border: `1px solid ${COLOR.border}`, borderRadius: 6 }}>
          {layerPanelOpen && (
            <div style={{ width: 340, flexShrink: 0, borderRight: `1px solid ${COLOR.rowDivider}`, padding: 14, display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
              <div style={{ ...v2Title, marginBottom: 16 }}>Layer View</div>
              <V2LayerRow label="Roads" color="#16A34A" geometry="line" on={showRoadOverlay} onToggle={() => setShowRoadOverlay((v) => !v)} />
              <V2LayerRow label="Planning Area" color="#0D9488" geometry="polygon" on={showPlanningAreaOverlay} onToggle={() => setShowPlanningAreaOverlay((v) => !v)} />
              <div style={{ flex: 1 }} />
              <div style={{ ...v2Title, marginBottom: 7 }}>Import</div>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{ width: "100%", height: 40, boxSizing: "border-box", padding: 0, background: COLOR.gray800, border: "none", borderRadius: 6, fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.white, cursor: "pointer" }}
              >
                {uploadedBoundaries.length > 0 ? "Replace Shapefile" : "Import Shapefile"}
              </button>
            </div>
          )}

          {/* Map well */}
          <div style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden", background: COLOR.gray100 }}>
            {renderMap()}
            {/* Collapse / expand tab — small rounded handle (same as v1). */}
            <button
              onClick={() => setLayerPanelOpen((v) => !v)}
              title={layerPanelOpen ? "Collapse Layer View" : "Expand Layer View"}
              style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 24, height: 40, display: "flex", alignItems: "center", justifyContent: "center", background: COLOR.white, border: `1px solid ${COLOR.border}`, borderLeft: "none", borderTopRightRadius: 6, borderBottomRightRadius: 6, boxShadow: "0 1px 4px rgba(0,0,0,0.16)", color: COLOR.gray600, cursor: "pointer", padding: 0, zIndex: 500 }}
            >
              {layerPanelOpen ? <FiChevronsLeft size={14} /> : <FiChevronsRight size={14} />}
            </button>
            {/* Floating tool cluster (Draw Polygon + Clear) */}
            <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 5, background: COLOR.white, border: `1px solid ${COLOR.border}`, borderRadius: 6, padding: 4, zIndex: 500 }}>
              <button
                onClick={clearPolygon}
                title="Clear polygon"
                style={v2ToolBtn(false)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLOR.danger} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
              </button>
              <button
                onClick={() => setIsDrawing((v) => !v)}
                title={isDrawing ? "Drawing… click map to add points" : "Draw polygon"}
                style={v2ToolBtn(isDrawing)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={isDrawing ? COLOR.white : COLOR.text} strokeWidth="2" strokeLinejoin="round"><polygon points="12 3 20 9 17 19 7 19 4 9" /></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Right: Roads Found card */}
        <div style={{ flex: 1, minWidth: 0, border: `1px solid ${COLOR.border}`, borderRadius: 6, display: "flex", flexDirection: "column", padding: "14px 16px", boxSizing: "border-box", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexShrink: 0 }}>
            <span style={v2Title}>Roads Found</span>
            {roads.length > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {selectedUnavailableCount > 0 && (
                  <button onClick={deselectUnavailable} style={v2GhostInline}>Deselect Unavailable</button>
                )}
                <button onClick={allSelected ? deselectAll : selectAll} style={v2GhostInline}>{allSelected ? "Deselect All" : "Select All"}</button>
              </div>
            )}
          </div>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", padding: "0 8px", flexShrink: 0, marginBottom: 6 }}>
            <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center" }}>
              <div onClick={roads.length > 0 ? (allSelected ? deselectAll : selectAll) : undefined} style={v2Checkbox(allSelected)}>{allSelected && v2Check}</div>
              <span style={v2HeaderLabel}>Folder Name</span>
              <span style={{ fontSize: 12, color: COLOR.gray400, cursor: "pointer" }}>↕</span>
            </div>
            <div style={{ width: 120, flexShrink: 0, display: "flex", gap: 5, alignItems: "center", justifyContent: "center" }}>
              <span style={v2HeaderLabel}>Segments</span>
              <span style={{ fontSize: 12, color: COLOR.gray400, cursor: "pointer" }}>↕</span>
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {roads.length === 0 ? (
              <div style={{ padding: "32px 12px", textAlign: "center", fontFamily: FONT, fontSize: 12, color: COLOR.gray500 }}>
                {querying ? "Searching for roads…" : "Draw a polygon, pick a planning area, or import a shapefile to find roads."}
              </div>
            ) : (
              roads.map((road) => (
                <div
                  key={road.name}
                  onClick={() => toggleRoad(road.name)}
                  style={{ display: "flex", alignItems: "center", padding: "8px 8px", minHeight: 35, boxSizing: "border-box", borderBottom: `1px solid ${COLOR.rowDivider}`, cursor: "pointer", background: road.selected ? COLOR.gray100 : "transparent" }}
                >
                  <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                    <div onClick={(e) => { e.stopPropagation(); toggleRoad(road.name); }} style={v2Checkbox(road.selected)}>{road.selected && v2Check}</div>
                    <span style={{ fontFamily: FONT, fontWeight: 400, fontSize: 16, color: road.exists ? COLOR.text : COLOR.gray500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={road.exists ? (road.label ?? road.name) : `${road.label ?? road.name} — not downloaded`}>
                      {road.label ?? road.name}{!road.exists && <span style={{ fontSize: 12, color: COLOR.gray400 }}> · not downloaded</span>}
                    </span>
                  </div>
                  <span style={{ width: 120, flexShrink: 0, textAlign: "center", fontFamily: FONT, fontSize: 16, color: COLOR.text }}>{road.points}</span>
                </div>
              ))
            )}
          </div>

          {roadStatus && (
            <div style={{ flexShrink: 0, marginTop: 8, fontFamily: FONT, fontSize: 12, color: roadStatus.color.includes("red") ? COLOR.danger : COLOR.gray500 }}>{roadStatus.text}</div>
          )}
          {isFallback && roads.length > 0 && (
            <div style={{ flexShrink: 0, marginTop: 4, fontFamily: FONT, fontSize: 12, color: COLOR.danger }}>No image data has been downloaded for this area — project creation is not possible until images are available.</div>
          )}
        </div>

        {hiddenFileInput}
      </div>
    );
  }

  // ── v1 render ────────────────────────────────────────────────────
  return (
    <Box>
      {/* Toolbar */}
      <Flex mb={2} gap={2} alignItems="center" wrap="wrap">
        <Button
          size="sm"
          variant={isDrawing ? "solid" : "outline"}
          colorPalette={isDrawing ? "red" : "gray"}
          onClick={() => setIsDrawing(!isDrawing)}
        >
          <FaDrawPolygon />
          <Text ml={1}>{isDrawing ? "Drawing…" : "Draw Polygon"}</Text>
        </Button>

        {polygonPoints.length > 0 && (
          <Button size="sm" variant="outline" colorPalette="red" onClick={clearPolygon}>
            <FaTrash />
            <Text ml={1}>Clear</Text>
          </Button>
        )}

        <Button
          size="sm"
          variant={showRoadOverlay ? "solid" : "outline"}
          colorPalette={showRoadOverlay ? "blue" : "gray"}
          onClick={() => setShowRoadOverlay((v) => !v)}
        >
          <FaRoad />
          <Text ml={1}>{showRoadOverlay ? "Hide Roads" : "Show Roads"}</Text>
        </Button>

        <Button
          size="sm"
          variant={showPlanningAreaOverlay ? "solid" : "outline"}
          colorPalette={showPlanningAreaOverlay ? "teal" : "gray"}
          onClick={() => setShowPlanningAreaOverlay((v) => !v)}
        >
          <FaMapMarkedAlt />
          <Text ml={1}>{showPlanningAreaOverlay ? "Hide Planning Areas" : "Show Planning Areas"}</Text>
        </Button>

        <Button
          size="sm"
          variant={uploadedBoundaries.length > 0 ? "solid" : "outline"}
          colorPalette={uploadedBoundaries.length > 0 ? "orange" : "gray"}
          loading={uploadedBoundaryLoading}
          onClick={() => fileInputRef.current?.click()}
        >
          <FaFileImport />
          <Text ml={1}>{uploadedBoundaries.length > 0 ? "Replace Shapefile" : "Import Shapefile"}</Text>
        </Button>

        {uploadedBoundaries.length > 0 && (
          <Button size="sm" variant="outline" colorPalette="orange" onClick={clearUploadedBoundaries}>
            <FaTrash />
            <Text ml={1}>Clear Imported</Text>
          </Button>
        )}

        {hiddenFileInput}
      </Flex>

      <Box minH="36px" mb={2}>
        {toolbarStatus && (
          <Text fontSize="xs" color="gray.500">
            {toolbarStatus}
          </Text>
        )}
        {uploadedBoundaryStatus && (
          <Text fontSize="xs" color={uploadedBoundaryStatus.color} mt={toolbarStatus ? 1 : 0}>
            {uploadedBoundaryStatus.text}
          </Text>
        )}
      </Box>

      {/* Map */}
      <Box borderRadius="md" overflow="hidden" border="1px solid" borderColor="gray.200">
        {renderMap()}
      </Box>

      <Box minH="24px" mt={2}>
        {roadStatus && (
          <Text fontSize="sm" color={roadStatus.color}>
            {roadStatus.text}
          </Text>
        )}
      </Box>

      {roads.length > 0 && !isFallback && (
        <Box mt={3}>
          <Flex justifyContent="space-between" alignItems="center" mb={2}>
            <Text fontSize="sm" fontWeight="bold">
              Roads Found ({roads.filter((r) => r.selected).length}/{roads.length} selected, {availableRoadCount} available{unavailableRoadCount > 0 ? `, ${unavailableRoadCount} not downloaded` : ""})
            </Text>
            <HStack gap={2}>
              {selectedUnavailableCount > 0 && (
                <Button size="xs" variant="ghost" colorPalette="orange" onClick={deselectUnavailable}>
                  Deselect Unavailable
                </Button>
              )}
              <Button size="xs" variant="ghost" onClick={allSelected ? deselectAll : selectAll}>
                {allSelected ? "Deselect All" : "Select All"}
              </Button>
            </HStack>
          </Flex>

          <Box
            maxH="200px"
            overflowY="auto"
            border="1px solid"
            borderColor="gray.200"
            borderRadius="md"
          >
            {roads.map((road) => (
              <Flex
                key={road.name}
                px={3}
                py={2}
                alignItems="center"
                justifyContent="space-between"
                cursor="pointer"
                _hover={{ bg: "gray.50" }}
                onClick={() => toggleRoad(road.name)}
                borderBottom="1px solid"
                borderColor="gray.100"
              >
                <HStack gap={2}>
                  <input
                    type="checkbox"
                    checked={road.selected}
                    onChange={() => toggleRoad(road.name)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <Text fontSize="sm">{road.label ?? road.name}</Text>
                </HStack>
                <HStack gap={2}>
                  <Text fontSize="xs" color="gray.500">
                    {road.points} pts
                  </Text>
                  {road.exists ? (
                    <Badge colorPalette="green" size="sm">Available</Badge>
                  ) : (
                    <Badge colorPalette="orange" size="sm">Not Downloaded</Badge>
                  )}
                </HStack>
              </Flex>
            ))}
          </Box>
        </Box>
      )}

      {roads.length > 0 && isFallback && (
        <Box mt={3}>
          <Text fontSize="sm" fontWeight="bold" color="orange.600" mb={1}>
            No road image data in this area
          </Text>
          <Text fontSize="xs" color="gray.500" mb={2}>
            The following planning areas overlap your selection, but no image folders have been downloaded for them. Project creation is not possible until images are available.
          </Text>
          <Box
            maxH="200px"
            overflowY="auto"
            border="1px solid"
            borderColor="orange.200"
            borderRadius="md"
          >
            {roads.map((area) => (
              <Flex
                key={area.name}
                px={3}
                py={2}
                alignItems="center"
                borderBottom="1px solid"
                borderColor="gray.100"
              >
                <Text fontSize="sm" color="gray.600">{area.name}</Text>
              </Flex>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── v2 presentational helpers (Home.dc.html Frame 2 map layout) ──────
const v2Title: React.CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text };
const v2HeaderLabel: React.CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text };
const v2GhostInline: React.CSSProperties = {
  height: 30,
  padding: "0 10px",
  background: "transparent",
  border: `1px solid ${COLOR.borderInput}`,
  borderRadius: 6,
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 14,
  color: COLOR.text,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function v2ToolBtn(active: boolean): React.CSSProperties {
  // Ghost-inside-container treatment: the floating cluster owns the single outer
  // border; inactive buttons are borderless so they don't double up (matches the
  // Coding / Path Analysis floating map controls).
  return {
    width: 28,
    height: 28,
    background: active ? COLOR.blue : "transparent",
    border: `1px solid ${active ? COLOR.blue : "transparent"}`,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
  };
}

// 16×16 checkbox per DESIGN_GUIDE §7.
function v2Checkbox(checked: boolean): React.CSSProperties {
  return checked
    ? { width: 16, height: 16, background: COLOR.blue, border: `1px solid ${COLOR.blue}`, borderRadius: 2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }
    : { width: 16, height: 16, border: `1px solid ${COLOR.borderInput}`, borderRadius: 2, flexShrink: 0, background: COLOR.white, cursor: "pointer", display: "flex" };
}

const v2Check = (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
    <path d="M2 6l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Small black glyph signifying how the layer draws on the map (line / polygon).
// Fixed 14px box so the row height never shifts.
function V2GeometryIcon({ type }: { type: "line" | "polygon" | "point" }) {
  const common = { width: 14, height: 14, viewBox: "0 0 16 16", style: { flexShrink: 0, display: "block" } as const };
  if (type === "line") {
    return (
      <svg {...common} fill="none" stroke="#000" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="2 12 6 6 10 10 14 4" />
      </svg>
    );
  }
  if (type === "point") {
    return (
      <svg {...common} fill="#000">
        <path d="M8 1.5c-2.5 0-4.5 2-4.5 4.5 0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5C12.5 3.5 10.5 1.5 8 1.5z" />
        <circle cx="8" cy="6" r="1.7" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none" stroke="#000" strokeWidth={1.6} strokeLinejoin="round">
      <polygon points="8 2 14 6.5 11.7 14 4.3 14 2 6.5" />
    </svg>
  );
}

function V2LayerRow({ label, color, geometry, on, onToggle }: { label: string; color: string; geometry: "line" | "polygon" | "point"; on: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        <V2GeometryIcon type={geometry} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontFamily: FONT, fontSize: 16, color: COLOR.text }}>{label}</span>
      </div>
      <div
        onClick={onToggle}
        style={{ width: 30, height: 16, borderRadius: 999, background: on ? color : COLOR.borderInput, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s" }}
      >
        <div style={{ position: "absolute", top: 2, left: 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", transform: on ? "translateX(14px)" : "none", transition: "transform .15s" }} />
      </div>
    </div>
  );
}
