import ThemeAwareTileLayer from "../../../components/common/ThemeAwareTileLayer";
import { Spinner, Text, Badge, Box, Flex, HStack, Button } from "@chakra-ui/react";
import ShapefileModal from "../../sidebar/components/ShapefileModal";
import EditParametersModal from "../EditParametersModal";
import { MapContainer, Polyline, CircleMarker, Polygon as LeafletPolygon, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useColorModeValue } from "../../../components/ui/color-mode";
import { GIS_VIEWER_GEOMETRY_COLORS } from "../../../constants/mapColors";
import { FitBounds, getLayerMetadata, getLayerPurpose, formatBytes, FILTER_OPTIONS } from "../gisLayersConstants";
import type { GisLayersViewModel } from "./GisLayersViewModel";

/**
 * v1 GIS Layers layout — the original page body extracted verbatim and made
 * props-driven from the GisLayersViewModel. Byte-identical under `?ui=v1`.
 */
export default function GisLayersLayoutV1(vm: GisLayersViewModel) {
  const {
    shapefiles, loading, error,
    filterMode, setFilterMode, filterText, setFilterText,
    dropdownOpen, setDropdownOpen, hoveredFilter, setHoveredFilter, tooltipPos, setTooltipPos, filterDropdownRef,
    selectedLayer, onSelectLayer, mapLoading, mapError, mapFeatures, initialCenter,
    editingPath, editName, setEditName, onStartEdit, onCancelEdit, onSaveEdit,
    confirmDeletePath, onDeleteClick, onCancelDelete, onConfirmDelete,
    confirmRevertPath, onRevertClick, onCancelRevert, onConfirmRevert,
    actionLoading, actionError, onClearActionError,
    shapefileModalOpen, onOpenUpdateModal, onCloseUpdateModal,
    editingParamsFile, onEditParams, onCloseParams, onParamsSaved,
  } = vm;

  // Color Mode Values
  const rootBg = useColorModeValue("gray.50", "gray.900");
  const titleColor = useColorModeValue("gray.900", "white");
  const subtitleColor = useColorModeValue("gray.600", "gray.400");
  const panelBg = useColorModeValue("white", "gray.800");
  const panelHeaderBg = useColorModeValue("gray.50", "gray.850");
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
    <Box display="flex" flexDirection="column" h="100%" p={6} bg={rootBg} overflowY="auto">
      <Flex mb={6} justify="space-between" align="flex-start">
        <Box>
          <Text fontSize="2xl" fontWeight="600" color={titleColor} mb={2}>GIS Layers Mapping</Text>
          <Text fontSize="sm" color={subtitleColor}>
            View all the shapefiles currently available in the system on the interactive map below.
          </Text>
        </Box>
        <Button onClick={onOpenUpdateModal} colorPalette="blue" size="sm">
          Update GIS Layer
        </Button>
      </Flex>

      <Flex h="calc(100vh - 180px)" gap="4">
        {/* Left Side: Table of Layers */}
        <Box
          flex="0 0 400px"
          bg={panelBg}
          borderRadius="lg"
          boxShadow="sm"
          overflow="hidden"
          display="flex"
          flexDirection="column"
          borderWidth="1px"
          borderColor={borderColor}
        >
          <Box p={4} borderBottom="1px solid" borderColor={panelHeaderBorder} bg={panelHeaderBg}>
            <Flex align="center" justify="space-between" gap="3" mb={2}>
              <Text fontWeight="600" color={titleColor} whiteSpace="nowrap">Layers</Text>
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
                  <span>{FILTER_OPTIONS.find(o => o.value === filterMode)?.label}</span>
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
                    {FILTER_OPTIONS.map(opt => (
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
                        <Text fontSize="13px" fontWeight={filterMode === opt.value ? "600" : "400"} color={textColor}>
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
                    <Text fontSize="12px" fontWeight="600" color="white" mb="4px">
                      {FILTER_OPTIONS.find(o => o.value === hoveredFilter)?.label}
                    </Text>
                    <Text fontSize="11px" color="gray.300" lineHeight="1.6">
                      {FILTER_OPTIONS.find(o => o.value === hoveredFilter)?.desc}
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
                <Button size="xs" variant="ghost" colorPalette="red" onClick={onClearActionError}>✕</Button>
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
                      onClick={() => onSelectLayer(isSelected ? null : file)}
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
                                if (e.key === "Enter") onSaveEdit(file);
                                if (e.key === "Escape") onCancelEdit();
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
                            <Button size="xs" colorPalette="blue" variant="solid" onClick={() => onSaveEdit(file)} disabled={actionLoading}>Save</Button>
                            <Button size="xs" variant="ghost" onClick={onCancelEdit} disabled={actionLoading}>Cancel</Button>
                          </Flex>
                        ) : (
                          <>
                            <Text fontWeight="600" fontSize="sm" truncate title={file.name} color={titleColor} flex="1">
                              {file.name}
                            </Text>
                            <HStack gap="1" flexShrink={0} onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="blue"
                                onClick={(e) => { e.stopPropagation(); onStartEdit(file); }}
                                title="Rename shapefile"
                              >
                                Edit
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="purple"
                                onClick={(e) => { e.stopPropagation(); onEditParams(file); }}
                                title="Edit required columns / affected parameters"
                              >
                                Params
                              </Button>
                              {file.is_renamed && (
                                <Button
                                  size="xs"
                                  variant={confirmRevertPath === file.path ? "solid" : "ghost"}
                                  colorPalette="purple"
                                  onClick={(e) => { e.stopPropagation(); onRevertClick(file); }}
                                  title="Revert to original name"
                                >
                                  Revert
                                </Button>
                              )}
                              <Button
                                size="xs"
                                variant={confirmDeletePath === file.path ? "solid" : "ghost"}
                                colorPalette="red"
                                onClick={(e) => { e.stopPropagation(); onDeleteClick(file); }}
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
                          <Button size="xs" colorPalette="red" variant="solid" onClick={() => onConfirmDelete(file)} disabled={actionLoading}>Confirm</Button>
                          <Button size="xs" variant="ghost" onClick={onCancelDelete} disabled={actionLoading}>Cancel</Button>
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
                          <Button size="xs" colorPalette="purple" variant="solid" onClick={() => onConfirmRevert(file)} disabled={actionLoading}>Confirm</Button>
                          <Button size="xs" variant="ghost" onClick={onCancelRevert} disabled={actionLoading}>Cancel</Button>
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
                      <HStack mt={1} fontSize="xs" color={mutedTextColor} gap="3">
                        <Text><strong>Year:</strong> {file.year}</Text>
                        <Text truncate title={file.source}><strong>Source:</strong> {file.source}</Text>
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
          borderRadius="lg"
          boxShadow="sm"
          borderWidth="1px"
          borderColor={borderColor}
          overflow="hidden"
          position="relative"
        >
          {matchMapState(selectedLayer, mapLoading, mapError, mapFeatures, mapOverlayBg, mapOverlayTextColor)}
          <MapContainer
            center={initialCenter}
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
        onClose={onCloseUpdateModal}
      />

      <EditParametersModal
        file={editingParamsFile}
        onClose={onCloseParams}
        onSaved={onParamsSaved}
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
             <Box bg="white" _dark={{ bg: "gray.800" }} px={4} py={2} borderRadius="md" boxShadow="md">
               <Text color="orange.500" fontWeight="medium">Layer loaded but contains no renderable geometries.</Text>
             </Box>
         </Flex>
       );
    }
    return null;
}
