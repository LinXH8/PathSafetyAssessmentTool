import ThemeAwareTileLayer from "../../components/common/ThemeAwareTileLayer";
import { useEffect, useState, useMemo, useRef } from "react";
import { listShapefiles, deleteShapefile, renameShapefile, revertShapefile, type ShapefileInfo } from "../../api";
import { Spinner, Text, Badge, Box, Flex, HStack, Button } from "@chakra-ui/react";
import ShapefileModal from "../sidebar/components/ShapefileModal";
import EditParametersModal from "./EditParametersModal";
import { MapContainer, Polyline, CircleMarker, Polygon as LeafletPolygon, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useColorModeValue } from "../../components/ui/color-mode";
import { GIS_VIEWER_GEOMETRY_COLORS } from "../../constants/mapColors";
import { useUiVersion } from "../../features/ui/useUiVersion";
const getLayerMetadata = (fileName: string) => {
  const name = fileName.toLowerCase();
  
  // Paths
  if (name.includes("footpath")) return { reqCols: "WIDTH", affects: "Facility Width, Curvature" };
  if (name.includes("cycling")) return { reqCols: "WIDTH", affects: "Facility Width, Curvature" };
  if (name.includes("shared")) return { reqCols: "WIDTH", affects: "Facility Width, Curvature" };
  
  // Crossings
  if (name.includes("bicyclecrossing") || (name.includes("bicycle") && name.includes("crossing"))) return { reqCols: "None (Proximity)", affects: "Crossing Facility, Crossing Type" };
  if (name.includes("roadcrossing") || (name.includes("road") && name.includes("crossing"))) return { reqCols: "None (Proximity)", affects: "Pedestrian Crossing" };
  
  // Speed / Links
  if (name.includes("speedlimit") || name.includes("speed_limit")) return { reqCols: "SPEEDLIMIT", affects: "Road speed limit" };
  if (name.includes("link")) return { reqCols: "LK_ID_NUM", affects: "Road operating speed" };
  
  // Public Transport
  if (name.includes("mrt")) return { reqCols: "None (Proximity)", affects: "Pedestrian Crossing, Peak Flow" };
  if (name.includes("busstop") || name.includes("bus_stop") || name.includes("bus stop")) return { reqCols: "None (Proximity)", affects: "Pedestrian Crossing" };
  if (name.includes("busshelter") || name.includes("bus_shelter") || name.includes("bus shelter")) return { reqCols: "None (Proximity)", affects: "Peak Pedestrian Flow" };
  if (name.includes("bus") && name.includes("lane")) return { reqCols: "None (Proximity)", affects: "Heavy vehicle flow" };
  
  // Area Types
  if (name.includes("industrial")) return { reqCols: "None (Containment)", affects: "Area type (Industrial)" };
  if (name.includes("rural")) return { reqCols: "None (Containment)", affects: "Area type (Rural)" };
  if (name.includes("recreation")) return { reqCols: "None (Containment)", affects: "Area type (Recreational)" };
  if (name.includes("central") || name.includes("inner")) return { reqCols: "None (Containment)", affects: "Area type (Urban)" };
  
  // Other infrastructure
  if (name.includes("parking")) return { reqCols: "None (Proximity)", affects: "Adjacent Vehicle Parking" };
  if (name.includes("kerb")) return { reqCols: "None (Proximity)", affects: "Lanes – adjacent road" };
  if (name.includes("count")) return { reqCols: "DataType, DateTime, Count_Data", affects: "User Counts" };
  
  return { reqCols: "Unknown", affects: "Unknown" };
};

// Helper component to adjust bounds
function FitBounds({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24] });
    }
  }, [bounds, map]);
  return null;
}

type ParsedLine = { positions: [number, number][]; props: any };
type ParsedPoint = { latlng: [number, number]; props: any };
type ParsedPolygon = { positions: [number, number][][]; props: any };

export default function GisLayersPage() {
  const [shapefiles, setShapefiles] = useState<ShapefileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Map state
  const [selectedLayer, setSelectedLayer] = useState<ShapefileInfo | null>(null);
  const [geojsonData, setGeojsonData] = useState<any | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  
  const [shapefileModalOpen, setShapefileModalOpen] = useState(false);
  const [editingParamsFile, setEditingParamsFile] = useState<ShapefileInfo | null>(null);

  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const [confirmRevertPath, setConfirmRevertPath] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  type FilterMode = "all" | "autocoding" | "project" | "analysis";
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [filterText, setFilterText] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoveredFilter, setHoveredFilter] = useState<FilterMode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  const getLayerPurpose = (file: ShapefileInfo): FilterMode => {
    const cat = file.category.toLowerCase();
    const name = file.base_name.toLowerCase();

    // Project Setup: boundary and road network reference layers
    if (cat === "planning_area" || cat === "road_name") return "project";
    if (cat === "linkid_shape_file" && name.includes("node")) return "project";

    // Auto-coding: layers that feed the scoring engine but are NOT overlays in the Analysis page
    // (area/landuse classification polygons, speed limit lines, road link network)
    if (
      cat === "area_type" ||
      cat.startsWith("landuse") ||
      cat.startsWith("central") ||        // Centralmb2025 urban area type polygon
      cat === "speed_limit" ||
      cat === "linkid_shape_file"          // link file (non-node already caught above)
    ) return "autocoding";

    // Analysis: everything else — all layers shown as overlays in the Analysis page
    // (path centrelines, crossings, transit, parking, kerb, defects, land type, AMG counts)
    return "analysis";
  };

  const initialCenter = useRef<[number, number]>([1.3521, 103.8198]);

  // ── v2 design tokens (DESIGN_GUIDE.md): 6px radius, no shadow, gray.200
  // borders, 32px content padding, 700 headers, teal = global-scope action.
  const isV2 = useUiVersion() === "v2";
  const cardRadius = isV2 ? "6px" : "lg";
  const cardShadow = isV2 ? "none" : "sm";
  const headWeight = isV2 ? "700" : "600";
  const contentPad = isV2 ? 8 : 6;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filterOptions: { value: FilterMode; label: string; desc: string }[] = [
    { value: "all",        label: "All Layers",    desc: "Shows every available GIS shapefile in this project across all categories." },
    { value: "autocoding", label: "Auto-coding",   desc: "Layers that feed directly into the scoring calculations. Includes area type polygons (urban/rural/recreational), land use classifications, speed limit lines, and the road link network file." },
    { value: "project",    label: "Project Setup", desc: "Reference layers required before a project can be created or run. Includes planning area boundaries, the road name network (to match paths to roads), and the road network node file for intersection referencing." },
    { value: "analysis",   label: "Analysis",      desc: "All layers displayed as overlays in the Analysis page. Includes path centrelines (footpath, cycling, shared), road and bicycle crossings, MRT exits, bus stops, bus lanes, parking lots, kerb lines, path defects, land type categories, and AMG pedestrian/cyclist count data." },
  ];

  // Color Mode Values
  const rootBg = useColorModeValue("gray.50", "gray.900");
  const titleColor = useColorModeValue("gray.900", "white");
  const subtitleColor = useColorModeValue("gray.600", "gray.400");
  const panelBg = useColorModeValue("white", "gray.800");
  const panelHeaderBg = useColorModeValue("gray.50", "gray.850"); // Using something close to 900 or 800
  const panelHeaderBorder = useColorModeValue("gray.200", "gray.700");
  const borderColor = useColorModeValue("gray.200", "gray.700");
  const itemBorderColor = useColorModeValue("gray.100", "gray.700");
  const itemBg = useColorModeValue("white", "gray.800");
  const itemHoverBg = useColorModeValue("gray.50", "gray.700");
  const selectedItemBg = useColorModeValue("blue.50", "blue.900");
  const selectedItemHoverBg = useColorModeValue("blue.100", "blue.800");
  const metaBg = useColorModeValue("gray.50", "gray.700");
  const metaBorder = useColorModeValue("gray.200", "gray.600");
  const textColor = useColorModeValue("gray.700", "gray.200");
  const mutedTextColor = useColorModeValue("gray.500", "gray.400");
  const mapContainerBg = useColorModeValue("gray.100", "gray.800");
  const emptyStateColor = useColorModeValue("gray.500", "gray.400");
  const mapOverlayBg = useColorModeValue("whiteAlpha.800", "blackAlpha.700");
  const mapOverlayTextColor = useColorModeValue("gray.600", "gray.300");

  const loadLayers = async () => {
    try {
      setLoading(true);
      const data = await listShapefiles();
      const sortedData = data.sort((a, b) => a.name.localeCompare(b.name));
      setShapefiles(sortedData);
      setError(null);
    } catch (err: any) {
      console.error("Failed to load shapefiles", err);
      setError(err.message || "Failed to load shapefiles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLayers();
  }, []);

  const handleStartEdit = (file: ShapefileInfo) => {
    setEditingPath(file.path);
    setEditName(file.name);
    setConfirmDeletePath(null);
    setConfirmRevertPath(null);
    setActionError(null);
  };

  const handleCancelEdit = () => {
    setEditingPath(null);
    setEditName("");
    setActionError(null);
  };

  const handleSaveEdit = async (file: ShapefileInfo) => {
    if (!editName.trim()) {
      handleCancelEdit();
      return;
    }
    try {
      setActionLoading(true);
      setActionError(null);
      await renameShapefile(file.path, editName.trim());
      setEditingPath(null);
      setEditName("");
      await loadLayers();
    } catch (err: any) {
      setActionError(err.message || "Rename failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteClick = (file: ShapefileInfo) => {
    setConfirmDeletePath(file.path);
    setEditingPath(null);
    setEditName("");
    setConfirmRevertPath(null);
    setActionError(null);
  };

  const handleRevertClick = (file: ShapefileInfo) => {
    setConfirmRevertPath(file.path);
    setEditingPath(null);
    setEditName("");
    setConfirmDeletePath(null);
    setActionError(null);
  };

  const handleCancelRevert = () => {
    setConfirmRevertPath(null);
    setActionError(null);
  };

  const handleConfirmRevert = async (file: ShapefileInfo) => {
    try {
      setActionLoading(true);
      setActionError(null);
      await revertShapefile(file.path);
      setConfirmRevertPath(null);
      if (selectedLayer?.path === file.path) setSelectedLayer(null);
      await loadLayers();
    } catch (err: any) {
      setActionError(err.message || "Revert failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelDelete = () => {
    setConfirmDeletePath(null);
    setActionError(null);
  };

  const handleConfirmDelete = async (file: ShapefileInfo) => {
    try {
      setActionLoading(true);
      setActionError(null);
      await deleteShapefile(file.path);
      setConfirmDeletePath(null);
      if (selectedLayer?.path === file.path) setSelectedLayer(null);
      await loadLayers();
    } catch (err: any) {
      setActionError(err.message || "Delete failed");
    } finally {
      setActionLoading(false);
    }
  };

  // Fetch GeoJSON when a layer is selected
  useEffect(() => {
    if (!selectedLayer) {
      setGeojsonData(null);
      return;
    }

    let aborted = false;
    async function loadGeoJson() {
      try {
        setMapLoading(true);
        setMapError(null);
        
        const res = await fetch("/api/shapefiles/geojson", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            path: selectedLayer!.path,
            max_features: 10000 
          })
        });
        
        if (!res.ok) {
          throw new Error(await res.text().catch(() => "Failed to load map data"));
        }
        
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        if (!aborted) {
          setGeojsonData(data);
        }
      } catch (err: any) {
        console.error("Error loading geojson:", err);
        if (!aborted) setMapError(err.message || "Failed to parse shapefile geometry");
      } finally {
        if (!aborted) setMapLoading(false);
      }
    }

    loadGeoJson();
    return () => { aborted = true; };
  }, [selectedLayer]);

  // Parse ALL geometry types from GeoJSON
  const mapFeatures = useMemo(() => {
    if (!geojsonData || !geojsonData.features) return null;
    
    const lines: ParsedLine[] = [];
    const points: ParsedPoint[] = [];
    const polygons: ParsedPolygon[] = [];
    let bounds = L.latLngBounds([]);

    geojsonData.features.forEach((feature: any) => {
      const geom = feature.geometry;
      if (!geom) return;
      const props = feature.properties || {};

      switch (geom.type) {
        case "Point": {
          const [lon, lat] = geom.coordinates;
          const ll: [number, number] = [lat, lon];
          points.push({ latlng: ll, props });
          bounds.extend(ll);
          break;
        }
        case "MultiPoint": {
          geom.coordinates.forEach((c: [number, number]) => {
            const ll: [number, number] = [c[1], c[0]];
            points.push({ latlng: ll, props });
            bounds.extend(ll);
          });
          break;
        }
        case "LineString": {
          const coords = geom.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
          lines.push({ positions: coords, props });
          coords.forEach((c: [number, number]) => bounds.extend(c));
          break;
        }
        case "MultiLineString": {
          geom.coordinates.forEach((line: [number, number][]) => {
            const coords = line.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
            lines.push({ positions: coords, props });
            coords.forEach((c: [number, number]) => bounds.extend(c));
          });
          break;
        }
        case "Polygon": {
          const rings = geom.coordinates.map((ring: [number, number][]) =>
            ring.map((c: [number, number]) => [c[1], c[0]] as [number, number])
          );
          polygons.push({ positions: rings, props });
          rings[0]?.forEach((c: [number, number]) => bounds.extend(c));
          break;
        }
        case "MultiPolygon": {
          geom.coordinates.forEach((poly: [number, number][][]) => {
            const rings = poly.map((ring: [number, number][]) =>
              ring.map((c: [number, number]) => [c[1], c[0]] as [number, number])
            );
            polygons.push({ positions: rings, props });
            rings[0]?.forEach((c: [number, number]) => bounds.extend(c));
          });
          break;
        }
      }
    });

    const totalCount = lines.length + points.length + polygons.length;
    return { lines, points, polygons, bounds: bounds.isValid() ? bounds : null, totalCount };
  }, [geojsonData]);


  const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const renderTooltip = (props: any) => (
    <Tooltip sticky>
      <Box p={1}>
        {Object.entries(props).slice(0, 5).map(([k, v]) => (
          <Text key={k} fontSize="xs"><strong>{k}:</strong> {String(v)}</Text>
        ))}
      </Box>
    </Tooltip>
  );

  return (
    <Box display="flex" flexDirection="column" h="100%" p={contentPad} bg={rootBg} overflowY="auto">
      <Flex mb={6} justify="space-between" align="flex-start">
        <Box>
          <Text fontSize={isV2 ? "xl" : "2xl"} fontWeight={headWeight} color={titleColor} mb={2}>GIS Layers Mapping</Text>
          <Text fontSize="sm" color={subtitleColor}>
            View all the shapefiles currently available in the system on the interactive map below.
          </Text>
        </Box>
        <Button onClick={() => setShapefileModalOpen(true)} colorPalette={isV2 ? "teal" : "blue"} size={isV2 ? "md" : "sm"}>
          Update GIS Layer
        </Button>
      </Flex>

      <Flex h="calc(100vh - 180px)" gap="4">
        {/* Left Side: Table of Layers */}
        <Box
          flex="0 0 400px"
          bg={panelBg}
          borderRadius={cardRadius}
          boxShadow={cardShadow}
          overflow="hidden"
          display="flex"
          flexDirection="column"
          borderWidth="1px"
          borderColor={borderColor}
        >
          <Box p={4} borderBottom="1px solid" borderColor={panelHeaderBorder} bg={panelHeaderBg}>
            <Flex align="center" justify="space-between" gap="3" mb={2}>
              <Text fontWeight={headWeight} color={titleColor} whiteSpace="nowrap">Layers</Text>
              <Box ref={filterDropdownRef} position="relative" flex={1} minWidth={0}>
                {/* Trigger button */}
                <button
                  onClick={() => setDropdownOpen(o => !o)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--chakra-colors-gray-300)",
                    background: "transparent",
                    color: "inherit",
                    fontSize: "13px",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span>{filterOptions.find(o => o.value === filterMode)?.label}</span>
                  <span style={{ marginLeft: 6, fontSize: "10px", opacity: 0.6 }}>{dropdownOpen ? "▲" : "▼"}</span>
                </button>

                {/* Dropdown list — labels only */}
                {dropdownOpen && (
                  <Box
                    position="absolute"
                    top="calc(100% + 4px)"
                    left={0}
                    right={0}
                    zIndex={999}
                    bg={panelBg}
                    border="1px solid"
                    borderColor={borderColor}
                    borderRadius="6px"
                    boxShadow="md"
                    overflow="hidden"
                    onMouseLeave={() => { setHoveredFilter(null); setTooltipPos(null); }}
                  >
                    {filterOptions.map(opt => (
                      <Box
                        key={opt.value}
                        px={3}
                        py="8px"
                        cursor="pointer"
                        bg={filterMode === opt.value ? selectedItemBg : "transparent"}
                        _hover={{ bg: filterMode === opt.value ? selectedItemHoverBg : itemHoverBg }}
                        onMouseEnter={(e) => {
                          setHoveredFilter(opt.value);
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setTooltipPos({ x: rect.right + 10, y: rect.top + rect.height / 2 });
                        }}
                        onClick={() => { setFilterMode(opt.value); setDropdownOpen(false); setHoveredFilter(null); setTooltipPos(null); }}
                      >
                        <Text fontSize="13px" fontWeight={filterMode === opt.value ? headWeight : "400"} color={textColor}>
                          {opt.label}
                        </Text>
                      </Box>
                    ))}
                  </Box>
                )}

                {/* Description tooltip — position:fixed escapes the panel's overflow:hidden */}
                {dropdownOpen && hoveredFilter && tooltipPos && (
                  <Box
                    position="fixed"
                    top={`${tooltipPos.y}px`}
                    left={`${tooltipPos.x}px`}
                    zIndex={9999}
                    bg="#2D3748"
                    borderRadius="6px"
                    boxShadow="lg"
                    p={3}
                    width="230px"
                    pointerEvents="none"
                    style={{ transform: "translateY(-50%)" }}
                  >
                    {/* Left-pointing arrow */}
                    <Box
                      position="absolute"
                      left="-6px"
                      top="50%"
                      width={0}
                      height={0}
                      style={{
                        transform: "translateY(-50%)",
                        borderTop: "6px solid transparent",
                        borderBottom: "6px solid transparent",
                        borderRight: "6px solid #2D3748",
                      }}
                    />
                    <Text fontSize="12px" fontWeight={headWeight} color="white" mb="4px">
                      {filterOptions.find(o => o.value === hoveredFilter)?.label}
                    </Text>
                    <Text fontSize="11px" color="gray.300" lineHeight="1.6">
                      {filterOptions.find(o => o.value === hoveredFilter)?.desc}
                    </Text>
                  </Box>
                )}
              </Box>
            </Flex>
            <input
              type="text"
              placeholder="Filter shapefiles..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={{
                width: "100%",
                padding: "4px 10px",
                borderRadius: "6px",
                border: "1px solid var(--chakra-colors-gray-300)",
                background: "transparent",
                color: "inherit",
                fontSize: "13px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </Box>
          {actionError && (
            <Box px={3} py={2} bg="red.50" _dark={{ bg: "red.950", borderColor: "red.700" }} borderBottom="1px solid" borderColor="red.200">
              <Flex align="center" justify="space-between" gap="2">
                <Text fontSize="xs" color="red.700" _dark={{ color: "red.300" }}>{actionError}</Text>
                <Button size="xs" variant="ghost" colorPalette="red" onClick={() => setActionError(null)}>✕</Button>
              </Flex>
            </Box>
          )}
          
          <Box flex="1" overflowY="auto">
            {loading ? (
              <Flex justify="center" align="center" h="100%" p={4}>
                <Spinner /><Text ml={3} color={textColor}>Loading files...</Text>
              </Flex>
            ) : error ? (
                 <Box p={4} color="red.500">{error}</Box>
            ) : shapefiles.length === 0 ? (
                 <Box p={4} color={emptyStateColor}>No shapefiles found.</Box>
            ) : (() => {
              const filtered = shapefiles.filter(f => {
                const modeMatch = filterMode === "all" || getLayerPurpose(f) === filterMode;
                const textMatch = !filterText || f.name.toLowerCase().includes(filterText.toLowerCase());
                return modeMatch && textMatch;
              });
              return (
              <div className="layer-list-container">
                {filtered.length === 0 ? (
                  <Box p={4} color={emptyStateColor}>
                    No shapefiles match{filterText ? ` "${filterText}"` : ""}.
                  </Box>
                ) : null}
                {filtered.map(file => {
                  const isSelected = selectedLayer?.path === file.path;
                  return (
                    <Box
                      key={file.path}
                      p={3}
                      borderBottom="1px solid"
                      borderColor={itemBorderColor}
                      cursor="pointer"
                      bg={isSelected ? selectedItemBg : itemBg}
                      _hover={{ bg: isSelected ? selectedItemHoverBg : itemHoverBg }}
                      onClick={() => setSelectedLayer(isSelected ? null : file)}
                      transition="background-color 0.2s"
                    >
                      {/* Name row with Edit / Delete buttons */}
                      <Flex align="center" justify="space-between" gap="2">
                        {editingPath === file.path ? (
                          <Flex align="center" gap="1" flex="1" onClick={(e) => e.stopPropagation()}>
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveEdit(file);
                                if (e.key === "Escape") handleCancelEdit();
                              }}
                              style={{
                                flex: 1,
                                fontSize: "0.8rem",
                                fontWeight: 600,
                                border: "1px solid #3182ce",
                                borderRadius: "4px",
                                padding: "2px 6px",
                                outline: "none",
                                background: "transparent",
                                color: "inherit",
                              }}
                              autoFocus
                            />
                            <Button size="xs" colorPalette="blue" variant="solid" onClick={() => handleSaveEdit(file)} disabled={actionLoading}>Save</Button>
                            <Button size="xs" variant="ghost" onClick={handleCancelEdit} disabled={actionLoading}>Cancel</Button>
                          </Flex>
                        ) : (
                          <>
                            <Text fontWeight={headWeight} fontSize="sm" truncate title={file.name} color={titleColor} flex="1">
                              {file.name}
                            </Text>
                            <HStack gap="1" flexShrink={0} onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="blue"
                                onClick={(e) => { e.stopPropagation(); handleStartEdit(file); }}
                                title="Rename shapefile"
                              >
                                Edit
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="purple"
                                onClick={(e) => { e.stopPropagation(); setEditingParamsFile(file); }}
                                title="Edit required columns / affected parameters"
                              >
                                Params
                              </Button>
                              {file.is_renamed && (
                                <Button
                                  size="xs"
                                  variant={confirmRevertPath === file.path ? "solid" : "ghost"}
                                  colorPalette="purple"
                                  onClick={(e) => { e.stopPropagation(); handleRevertClick(file); }}
                                  title="Revert to original name"
                                >
                                  Revert
                                </Button>
                              )}
                              <Button
                                size="xs"
                                variant={confirmDeletePath === file.path ? "solid" : "ghost"}
                                colorPalette="red"
                                onClick={(e) => { e.stopPropagation(); handleDeleteClick(file); }}
                                title="Delete shapefile"
                              >
                                Delete
                              </Button>
                            </HStack>
                          </>
                        )}
                      </Flex>

                      {/* Inline delete confirmation */}
                      {confirmDeletePath === file.path && (
                        <Flex
                          align="center"
                          gap="2"
                          mt="2"
                          p="2"
                          bg="red.50"
                          _dark={{ bg: "red.950" }}
                          borderRadius="md"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Text fontSize="xs" color="red.700" _dark={{ color: "red.300" }} flex="1">
                            Delete "{file.name}"? This cannot be undone.
                          </Text>
                          <Button size="xs" colorPalette="red" variant="solid" onClick={() => handleConfirmDelete(file)} disabled={actionLoading}>Confirm</Button>
                          <Button size="xs" variant="ghost" onClick={handleCancelDelete} disabled={actionLoading}>Cancel</Button>
                        </Flex>
                      )}

                      {/* Inline revert confirmation */}
                      {confirmRevertPath === file.path && (
                        <Flex
                          align="center"
                          gap="2"
                          mt="2"
                          p="2"
                          bg="purple.50"
                          _dark={{ bg: "purple.950" }}
                          borderRadius="md"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Text fontSize="xs" color="purple.700" _dark={{ color: "purple.300" }} flex="1">
                            Revert "{file.name}" back to its original name "{file.original_name}"?
                          </Text>
                          <Button size="xs" colorPalette="purple" variant="solid" onClick={() => handleConfirmRevert(file)} disabled={actionLoading}>Confirm</Button>
                          <Button size="xs" variant="ghost" onClick={handleCancelRevert} disabled={actionLoading}>Cancel</Button>
                        </Flex>
                      )}

                      <HStack mt={1} fontSize="xs" color={mutedTextColor} justify="space-between">
                        <HStack gap="2">
                          <Badge colorPalette="blue" variant="subtle" size="sm">{file.category}</Badge>
                          {file.geom_type && (
                            <Badge colorPalette="purple" variant="outline" size="sm">{file.geom_type}</Badge>
                          )}
                        </HStack>
                        <Text>{formatBytes(file.size)}</Text>
                      </HStack>
                      <HStack mt={1} fontSize="xs" color={mutedTextColor} gap="3" align="flex-start">
                        <Text flexShrink={0}><strong>Year:</strong> {file.year}</Text>
                        <Text whiteSpace="normal" wordBreak="break-word"><strong>Source:</strong> {file.source}</Text>
                      </HStack>
                      <Box mt={2} p={2} bg={metaBg} borderRadius="md" fontSize="xs" border="1px solid" borderColor={metaBorder}>
                        <Text color={textColor} mb={1}>
                          <Text as="span" fontWeight="600">Required Columns:</Text> {file.required_columns || getLayerMetadata(file.base_name).reqCols}
                        </Text>
                        <Text color={textColor} whiteSpace="normal" wordBreak="break-word">
                          <Text as="span" fontWeight="600">Affects:</Text> {file.affects || getLayerMetadata(file.base_name).affects}
                          {file.is_custom_metadata && (
                            <Text as="span" color="purple.500" fontStyle="italic"> (user-defined)</Text>
                          )}
                        </Text>
                      </Box>
                    </Box>
                  );
                })}
              </div>
              );
            })()}
          </Box>
        </Box>

        {/* Right Side: Map */}
        <Box
          flex="1"
          bg={mapContainerBg}
          borderRadius={cardRadius}
          boxShadow={cardShadow}
          borderWidth="1px"
          borderColor={borderColor}
          overflow="hidden"
          position="relative"
        >
          {matchMapState(selectedLayer, mapLoading, mapError, mapFeatures, mapOverlayBg, mapOverlayTextColor)}
          <MapContainer
            center={initialCenter.current}
            zoom={12}
            style={{ width: "100%", height: "100%" }}
            scrollWheelZoom
          >
            <ThemeAwareTileLayer />

            {mapFeatures?.bounds && (
              <FitBounds bounds={mapFeatures.bounds} />
            )}

            {/* Render Polygons */}
            {mapFeatures?.polygons.map((poly, i) => (
              <LeafletPolygon
                key={`poly-${i}`}
                positions={poly.positions}
                pathOptions={{
                  color: GIS_VIEWER_GEOMETRY_COLORS.polygon,
                  weight: 2,
                  opacity: 0.8,
                  fillColor: GIS_VIEWER_GEOMETRY_COLORS.polygon,
                  fillOpacity: 0.2
                }}
              >
                {renderTooltip(poly.props)}
              </LeafletPolygon>
            ))}

            {/* Render Lines */}
            {mapFeatures?.lines.map((line, i) => (
              <Polyline
                key={`line-${i}`}
                positions={line.positions}
                pathOptions={{
                  color: GIS_VIEWER_GEOMETRY_COLORS.line,
                  weight: 3,
                  opacity: 0.8
                }}
              >
                {renderTooltip(line.props)}
              </Polyline>
            ))}

            {/* Render Points */}
            {mapFeatures?.points.map((pt, i) => (
              <CircleMarker
                key={`pt-${i}`}
                center={pt.latlng}
                radius={5}
                pathOptions={{
                  color: GIS_VIEWER_GEOMETRY_COLORS.pointStroke,
                  weight: 1,
                  opacity: 0.9,
                  fillOpacity: 0.7,
                  fillColor: GIS_VIEWER_GEOMETRY_COLORS.pointFill
                }}
              >
                {renderTooltip(pt.props)}
              </CircleMarker>
            ))}

          </MapContainer>
        </Box>
      </Flex>

      <ShapefileModal
        open={shapefileModalOpen}
        onClose={() => {
          setShapefileModalOpen(false);
          loadLayers();
        }}
      />

      <EditParametersModal
        file={editingParamsFile}
        onClose={() => setEditingParamsFile(null)}
        onSaved={() => {
          setEditingParamsFile(null);
          loadLayers();
        }}
      />
    </Box>
  );
}

function matchMapState(selectedLayer: any, loading: boolean, error: string | null, features: any, mapOverlayBg: string, mapOverlayTextColor: string) {
    if (!selectedLayer) {
      return (
        <Flex position="absolute" inset="0" zIndex="1000" bg={mapOverlayBg} justify="center" align="center">
           <Text color={mapOverlayTextColor} fontWeight="medium">Select a layer from the list to view it on the map</Text>
        </Flex>
      );
    }
    if (loading) {
        return (
          <Flex position="absolute" inset="0" zIndex="1000" bg={mapOverlayBg} justify="center" align="center" direction="column" gap={3}>
             <Spinner size="xl" color="blue.500" />
             <Text color={mapOverlayTextColor} fontWeight="medium">Loading layer: {selectedLayer.name}...</Text>
          </Flex>
        );
    }
    if (error) {
       return (
          <Flex position="absolute" inset="0" zIndex="1000" bg={mapOverlayBg} justify="center" align="center">
             <Text color="red.500" fontWeight="medium">Failed to render layer: {error}</Text>
          </Flex>
        );
    }
    
    if (features && features.totalCount === 0) {
      return (
         <Flex position="absolute" inset="0" zIndex="1000" bg="transparent" justify="center" align="flex-end" pb={10} pointerEvents="none">
             <Box bg={useColorModeValue("white", "gray.800")} px={4} py={2} borderRadius="md" boxShadow="md">
               <Text color="orange.500" fontWeight="medium">Layer loaded but contains no renderable geometries.</Text>
             </Box>
         </Flex>
       );
    }
    return null;
}
