import { useRef } from 'react';
import { Box, Button, IconButton, Text, Flex } from '@chakra-ui/react';
import { FiChevronsLeft, FiChevronsRight } from 'react-icons/fi';
import { FaFileImport, FaTrash } from 'react-icons/fa';
import { Switch } from '../ui/switch';
import { FONT, COLOR } from '../../features/ui/designTokens';
import { GIS_LAYER_COLORS } from '../../constants/mapColors';
import './AnalysisPanel.css';

interface GISLayerToggle {
  key: string;
  label: string;
  color: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colorPalette: string;
}

interface AnalysisSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  showFootpath: boolean;
  setShowFootpath: (v: boolean) => void;
  showCycling: boolean;
  setShowCycling: (v: boolean) => void;
  showShared: boolean;
  setShowShared: (v: boolean) => void;
  showRoadcrossing: boolean;
  setShowRoadcrossing: (v: boolean) => void;
  showMrtExit: boolean;
  setShowMrtExit: (v: boolean) => void;
  showBusStop: boolean;
  setShowBusStop: (v: boolean) => void;
  showBusLane: boolean;
  setShowBusLane: (v: boolean) => void;
  showParkingLot: boolean;
  setShowParkingLot: (v: boolean) => void;
  showKerbLine: boolean;
  setShowKerbLine: (v: boolean) => void;
  showBicycleCrossing: boolean;
  setShowBicycleCrossing: (v: boolean) => void;
  showPathDefects: boolean;
  setShowPathDefects: (v: boolean) => void;
  showStateLand: boolean;
  setShowStateLand: (v: boolean) => void;
  showStatBoard: boolean;
  setShowStatBoard: (v: boolean) => void;
  showLandPrivate: boolean;
  setShowLandPrivate: (v: boolean) => void;
  showLandMinistry: boolean;
  setShowLandMinistry: (v: boolean) => void;
  // Import-shapefile props are optional: PathAnalysisMapView wires them; GeoDataPanel
  // (Coding) does not use the import feature and omits them.
  onFilesSelected?: (files: File[]) => void;
  importedShapefileHasData?: boolean;
  importedShapefileLoading?: boolean;
  importedShapefileError?: string | null;
  importedShapefileName?: string | null;
  onClearImportedShapefile?: () => void;
  /** Curvature "Analysis Overlay" toggle — Coding page only. When provided, renders an
   *  Analysis Overlay switch at the top of the v2 Layer View panel (Home.dc.html FRAME 4:
   *  the overlay toggle lives with the layer toggles, not in the map header). */
  showCurvatureOverlay?: boolean;
  onToggleCurvatureOverlay?: () => void;
  /** "v1" (default) = slide-in overlay panel; "v2" = static 340px Layer View panel (Home.dc.html FRAME 4 / DESIGN_GUIDE §13). */
  variant?: "v1" | "v2";
}

export function AnalysisSidebar({
  isOpen,
  onToggle,
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
  onFilesSelected,
  importedShapefileHasData,
  importedShapefileLoading,
  importedShapefileError,
  importedShapefileName,
  onClearImportedShapefile,
  showCurvatureOverlay,
  onToggleCurvatureOverlay,
  variant = "v1",
}: AnalysisSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const layers: GISLayerToggle[] = [
    { key: 'footpath',          label: 'Footpath',          color: GIS_LAYER_COLORS.footpath,         colorPalette: 'blue',   value: showFootpath,          onChange: setShowFootpath },
    { key: 'cycling',           label: 'Cycling Path',      color: GIS_LAYER_COLORS.cycling,          colorPalette: 'red',    value: showCycling,           onChange: setShowCycling },
    { key: 'shared',            label: 'Shared Path',       color: GIS_LAYER_COLORS.shared,           colorPalette: 'purple', value: showShared,            onChange: setShowShared },
    { key: 'roadcrossing',      label: 'Road Crossing',     color: GIS_LAYER_COLORS.roadcrossing,     colorPalette: 'green',  value: showRoadcrossing,      onChange: setShowRoadcrossing },
    { key: 'bicycle_crossing',  label: 'Bicycle Crossing',  color: GIS_LAYER_COLORS.bicycle_crossing, colorPalette: 'orange', value: showBicycleCrossing,   onChange: setShowBicycleCrossing },
    { key: 'mrt_exit',          label: 'MRT Exit',          color: GIS_LAYER_COLORS.mrt_exit,         colorPalette: 'cyan',   value: showMrtExit,           onChange: setShowMrtExit },
    { key: 'bus_stop',          label: 'Bus Stop',          color: GIS_LAYER_COLORS.bus_stop,         colorPalette: 'purple', value: showBusStop,           onChange: setShowBusStop },
    { key: 'bus_lane',          label: 'Bus Lane',          color: GIS_LAYER_COLORS.bus_lane,         colorPalette: 'yellow', value: showBusLane,           onChange: setShowBusLane },
    { key: 'parking_lot',       label: 'Parking Lot',       color: GIS_LAYER_COLORS.parking_lot,      colorPalette: 'orange', value: showParkingLot,        onChange: setShowParkingLot },
    { key: 'kerb_line',         label: 'Kerb Line',         color: GIS_LAYER_COLORS.kerb_line,        colorPalette: 'pink',   value: showKerbLine,          onChange: setShowKerbLine },
    { key: 'path_defects',      label: 'Path Defects',      color: GIS_LAYER_COLORS.path_defects,     colorPalette: 'red',    value: showPathDefects,       onChange: setShowPathDefects },
    { key: 'state_land',        label: 'State Land',         color: GIS_LAYER_COLORS.state_land,       colorPalette: 'teal',   value: showStateLand,         onChange: setShowStateLand },
    { key: 'stat_board',        label: 'Stat Board',         color: GIS_LAYER_COLORS.stat_board,       colorPalette: 'yellow', value: showStatBoard,         onChange: setShowStatBoard },
    { key: 'land_private',      label: 'Private Land',       color: GIS_LAYER_COLORS.land_private,     colorPalette: 'purple', value: showLandPrivate,       onChange: setShowLandPrivate },
    { key: 'land_ministry',     label: 'Ministry Land',      color: GIS_LAYER_COLORS.land_ministry,    colorPalette: 'pink',   value: showLandMinistry,      onChange: setShowLandMinistry },
  ];

  // ── v2 render — 340px Layer View panel (Home.dc.html FRAME 4 / DESIGN_GUIDE §13).
  // Collapsible via the edge rail (uses the same isOpen/onToggle as v1). Carries the
  // full v1 contents: GIS-layer switches + the Import Shapefile section. ──
  if (variant === "v2") {
    return (
      <>
        <Box
          position="absolute"
          top="0"
          left="0"
          bottom="0"
          w={isOpen ? "340px" : "0"}
          overflow="hidden"
          zIndex={900}
          bg="white"
          transition="width 0.2s ease"
          style={{ borderRight: isOpen ? `1px solid ${COLOR.rowDivider}` : "none" }}
        >
          <div style={{ width: 340, height: "100%", overflowY: "auto", padding: "10px 14px", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text, marginBottom: 16 }}>Layer View</div>
            {/* Analysis Overlay (curvature) toggle — Coding page. Grouped with the layer
                toggles per Home.dc.html FRAME 4; separated by a divider from the GIS layers. */}
            {onToggleCurvatureOverlay && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", paddingBottom: 12, marginBottom: 4, borderBottom: `1px solid ${COLOR.rowDivider}` }}>
                <span style={{ fontFamily: FONT, fontSize: 16, color: COLOR.text }}>Analysis Overlay</span>
                <div
                  onClick={onToggleCurvatureOverlay}
                  style={{ width: 30, height: 16, borderRadius: 999, background: showCurvatureOverlay ? COLOR.text : COLOR.borderInput, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s" }}
                >
                  <div style={{ position: "absolute", top: 2, left: 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", transform: showCurvatureOverlay ? "translateX(14px)" : "none", transition: "transform .15s" }} />
                </div>
              </div>
            )}
            {layers.map((layer) => (
              <div key={layer.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: layer.color, flexShrink: 0 }} />
                  <span style={{ fontFamily: FONT, fontSize: 16, color: COLOR.text }}>{layer.label}</span>
                </div>
                <div
                  onClick={() => layer.onChange(!layer.value)}
                  style={{ width: 30, height: 16, borderRadius: 999, background: layer.value ? layer.color : COLOR.borderInput, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .15s" }}
                >
                  <div style={{ position: "absolute", top: 2, left: 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", transform: layer.value ? "translateX(14px)" : "none", transition: "transform .15s" }} />
                </div>
              </div>
            ))}
            {/* Import GIS Layer — always shown, matching v1. */}
            <div style={{ marginTop: 20, fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text, marginBottom: 7 }}>Import</div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importedShapefileLoading}
              style={{ flexShrink: 0, height: 40, width: "100%", boxSizing: "border-box", padding: 0, background: COLOR.gray800, border: "none", borderRadius: 6, fontFamily: FONT, fontWeight: 700, fontSize: 16, color: "#fff", cursor: "pointer" }}
            >
              {importedShapefileHasData ? "Replace Shapefile" : "Import Shapefile"}
            </button>
            {importedShapefileHasData && (
              <button
                onClick={onClearImportedShapefile}
                style={{ flexShrink: 0, marginTop: 8, height: 40, width: "100%", boxSizing: "border-box", padding: 0, background: "transparent", border: `1px solid ${COLOR.borderInput}`, borderRadius: 6, fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text, cursor: "pointer" }}
              >
                Clear Imported
              </button>
            )}
            {!importedShapefileLoading && importedShapefileError && (
              <div style={{ fontFamily: FONT, fontSize: 12, color: COLOR.danger, marginTop: 6 }}>{importedShapefileError}</div>
            )}
            {!importedShapefileLoading && !importedShapefileError && importedShapefileName && (
              <div style={{ fontFamily: FONT, fontSize: 12, color: COLOR.blue, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Imported: {importedShapefileName}</div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.shp,.shx,.dbf,.prj,.cpg,.sbn,.sbx"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length > 0) onFilesSelected?.(files);
              }}
              style={{ display: "none" }}
            />
          </div>
        </Box>
        {/* Collapse / expand tab — small rounded handle (same as v1). */}
        <IconButton
          aria-label="Toggle GIS Layers Panel"
          size="xs"
          position="absolute"
          top="50%"
          left={isOpen ? "340px" : "0"}
          transform="translateY(-50%)"
          transition="left 0.2s ease"
          zIndex={901}
          onClick={onToggle}
          bg="white"
          color="gray.600"
          borderWidth="1px"
          borderColor="gray.200"
          boxShadow="md"
          borderLeftRadius="0"
          borderRightRadius="md"
          w="24px"
          minW="24px"
          h="40px"
          css={{ "& svg": { width: "14px", height: "14px" } }}
        >
          {isOpen ? <FiChevronsLeft /> : <FiChevronsRight />}
        </IconButton>
      </>
    );
  }

  return (
    <>
      {/* Overlay panel — slides in from the left over the map */}
      <Box
        position="absolute"
        top="0"
        left="0"
        bottom="0"
        w={isOpen ? "220px" : "0"}
        overflow="hidden"
        transition="width 0.25s ease"
        zIndex={1000}
        bg="white"
        _dark={{ bg: "gray.800", borderColor: "gray.700" }}
        borderRight={isOpen ? "1px solid" : "none"}
        borderColor="gray.200"
        boxShadow={isOpen ? "lg" : "none"}
      >
        <Box w="220px" h="100%" overflowY="auto" p="3">
          <Text
            fontWeight="semibold"
            mb={3}
            fontSize="xs"
            color="gray.500"
            _dark={{ color: "gray.400" }}
            textTransform="uppercase"
            letterSpacing="wider"
          >
            GIS Layers
          </Text>
          <Box borderBottom="1px solid" borderColor="gray.100" _dark={{ borderColor: "gray.700" }} mb={3} />
          {layers.map((layer) => (
            <Flex
              key={layer.key}
              align="center"
              justify="space-between"
              py="1.5"
              px="1"
              borderRadius="md"
              _hover={{ bg: "gray.50", _dark: { bg: "gray.750" } }}
            >
              <Flex align="center" gap="2" flex="1" minW="0">
                <Box
                  w="10px"
                  h="10px"
                  borderRadius="full"
                  bg={layer.color}
                  flexShrink={0}
                />
                <Text
                  fontSize="sm"
                  fontWeight="medium"
                  color={layer.value ? "gray.800" : "gray.500"}
                  _dark={{ color: layer.value ? "gray.100" : "gray.500" }}
                  truncate
                >
                  {layer.label}
                </Text>
              </Flex>
              <Switch
                colorPalette={layer.colorPalette}
                size="sm"
                checked={layer.value}
                onCheckedChange={(e) => layer.onChange(e.checked)}
                flexShrink={0}
              />
            </Flex>
          ))}

          {/* Import Shapefile */}
          <Box mt={3}>
            <Box borderBottom="1px solid" borderColor="gray.100" _dark={{ borderColor: "gray.700" }} mb={3} />
            <Text
              fontWeight="semibold"
              mb={2}
              fontSize="xs"
              color="gray.500"
              _dark={{ color: "gray.400" }}
              textTransform="uppercase"
              letterSpacing="wider"
            >
              Import
            </Text>
            <Button
              size="xs"
              variant={importedShapefileHasData ? "solid" : "outline"}
              colorPalette={importedShapefileHasData ? "orange" : "gray"}
              loading={importedShapefileLoading}
              w="full"
              mb={importedShapefileHasData ? 1 : 0}
              onClick={() => fileInputRef.current?.click()}
            >
              <FaFileImport />
              <Text ml={1}>{importedShapefileHasData ? "Replace Shapefile" : "Import Shapefile"}</Text>
            </Button>
            {importedShapefileHasData && (
              <Button size="xs" variant="outline" colorPalette="orange" w="full" mb={2} onClick={onClearImportedShapefile}>
                <FaTrash />
                <Text ml={1}>Clear Imported</Text>
              </Button>
            )}
            {!importedShapefileLoading && importedShapefileError && (
              <Text fontSize="xs" color="red.500" mt={1}>{importedShapefileError}</Text>
            )}
            {!importedShapefileLoading && !importedShapefileError && importedShapefileName && (
              <Text fontSize="xs" color="blue.600" mt={1} truncate>Imported: {importedShapefileName}</Text>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.shp,.shx,.dbf,.prj,.cpg,.sbn,.sbx"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length > 0) onFilesSelected?.(files);
              }}
              style={{ display: "none" }}
            />
          </Box>
        </Box>
      </Box>

      {/* Toggle button — always visible at the left edge of the map */}
      <IconButton
        aria-label="Toggle GIS Layers Panel"
        size="xs"
        position="absolute"
        top="50%"
        left={isOpen ? "220px" : "0"}
        transform="translateY(-50%)"
        transition="left 0.25s ease"
        zIndex={1001}
        onClick={onToggle}
        bg="white"
        color="gray.600"
        _dark={{ bg: "gray.700", color: "gray.200", borderColor: "gray.600" }}
        borderWidth="1px"
        borderColor="gray.200"
        boxShadow="md"
        borderLeftRadius="0"
        borderRightRadius="md"
        w="24px"
        minW="24px"
        h="40px"
        css={{ "& svg": { width: "14px", height: "14px" } }}
      >
        {isOpen ? <FiChevronsLeft /> : <FiChevronsRight />}
      </IconButton>
    </>
  );
}
