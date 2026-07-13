/**
 * MapViewToolbar.tsx — the header toolbar of the Path Analysis map view
 * (`PathAnalysisMapView.tsx`).
 *
 * Single responsibility: purely presentational toolbar extracted from the
 * map-view monolith [S2.1]. Renders the Map/Table tab switcher (v1 Chakra
 * tabs / v2 segmented control), the single-point + polygon tool menus with
 * their "Delete/Copy Selected (N)" action buttons, and the right-side actions
 * (Open in Treatment, v2 Generate Report + Download dropdown, v1 download
 * buttons). Must be mounted inside the map view's `<Tabs.Root>`.
 *
 * In v2 the tool cluster is portalled into the floating overlay over the map
 * via `MaybePortal` (`toolsHost`). All mode state stays in the map view and
 * is driven through the passed setters/callbacks — no fetching, no storage
 * access here (the Generate Report side effect lives in the parent's
 * `onGenerateReport`).
 */

import type { Dispatch, SetStateAction } from "react";
import { Button, Flex, HStack, IconButton, Menu, Tabs } from "@chakra-ui/react";
import { FaDrawPolygon, FaMousePointer, FaPlus, FaTrash, FaChevronDown } from "react-icons/fa";
import { COLOR, FONT } from "../../../../features/ui/designTokens";
import { V2Segmented } from "../paV2Primitives";
import { MaybePortal } from "./leafletHelpers";

interface MapViewToolbarProps {
  /** v2 chrome flag (segmented control + floating tool cluster + dropdown). */
  isV2: boolean;
  activeTab: string;
  setActiveTab: Dispatch<SetStateAction<string>>;
  /** Visible (filtered) segment count — gates tools and action buttons. */
  allPointsCount: number;
  /** Active filter count — switches the Treatment button label. */
  activeFiltersCount: number;
  /** v2 floating tool-cluster host (null until mounted; undefined in v1). */
  toolsHost: HTMLElement | null;
  isDeleteMode: boolean;
  setIsDeleteMode: Dispatch<SetStateAction<boolean>>;
  isPointAddMode: boolean;
  setIsPointAddMode: Dispatch<SetStateAction<boolean>>;
  isPolygonMode: boolean;
  setIsPolygonMode: Dispatch<SetStateAction<boolean>>;
  isPolygonAddMode: boolean;
  setIsPolygonAddMode: Dispatch<SetStateAction<boolean>>;
  /** Current polygon vertex count — gates the finish buttons (>= 3). */
  polygonPointsCount: number;
  clearPolygonPoints: () => void;
  closeDeleteConfirmation: () => void;
  /** Live count of segments inside the drawn polygon (button preview). */
  polygonSelectionCount: number;
  finishPolygonSelection: () => void;
  finishAddSegmentsSelection: () => void;
  handleOpenInTreatment: () => void;
  /** Clears the Treatment session key and navigates to the Report Builder. */
  onGenerateReport: () => void;
  handleDownloadCSV: () => void;
  handleDownloadImages: () => void;
  handleDownloadShapefile: () => void;
}

/** Pure function of its props — all mutations go through the passed setters. */
export function MapViewToolbar({
  isV2,
  activeTab,
  setActiveTab,
  allPointsCount,
  activeFiltersCount,
  toolsHost,
  isDeleteMode,
  setIsDeleteMode,
  isPointAddMode,
  setIsPointAddMode,
  isPolygonMode,
  setIsPolygonMode,
  isPolygonAddMode,
  setIsPolygonAddMode,
  polygonPointsCount,
  clearPolygonPoints,
  closeDeleteConfirmation,
  polygonSelectionCount,
  finishPolygonSelection,
  finishAddSegmentsSelection,
  handleOpenInTreatment,
  onGenerateReport,
  handleDownloadCSV,
  handleDownloadImages,
  handleDownloadShapefile,
}: MapViewToolbarProps) {
  return (
    <Flex justify="space-between" align="center" borderBottom="1px solid" borderColor="gray.200" bg="white" _dark={{ bg: "gray.800" }} py="3" px="4" flexShrink={0}>
      <HStack gap="4">
        {isV2 ? (
          <V2Segmented
            options={[{ value: "map", label: "Map" }, { value: "table", label: "Table" }]}
            value={activeTab === "table" ? "table" : "map"}
            onChange={setActiveTab}
          />
        ) : (
          <Tabs.List>
            <Tabs.Trigger value="map">Map View</Tabs.Trigger>
            <Tabs.Trigger value="table">Table View</Tabs.Trigger>
          </Tabs.List>
        )}

        {allPointsCount > 0 && (
          <MaybePortal to={isV2 ? (toolsHost ?? null) : undefined}>
          <>
            <HStack gap="1.5">
              <Menu.Root positioning={{ placement: "bottom-end", strategy: "fixed" }}>
                <Menu.Trigger asChild>
                  <IconButton
                    aria-label="Single Point Tools"
                    size="sm"
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
                        clearPolygonPoints();
                      }
                    }}
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
                        clearPolygonPoints();
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
                        clearPolygonPoints();
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
                    variant={(isPolygonMode || isPolygonAddMode) ? "solid" : "ghost"}
                    colorPalette={(isPolygonMode || isPolygonAddMode) ? (isPolygonMode ? "red" : "blue") : "gray"}
                    onClick={(e) => {
                      if (isPolygonMode || isPolygonAddMode) {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsPolygonMode(false);
                        setIsPolygonAddMode(false);
                        setIsDeleteMode(false);
                        setIsPointAddMode(false);
                        clearPolygonPoints();
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
                        clearPolygonPoints();
                        closeDeleteConfirmation();
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
                        clearPolygonPoints();
                        closeDeleteConfirmation();
                      }}
                    >
                      <FaPlus /> Copy/Add Segments
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Menu.Root>
            </HStack>

            {polygonPointsCount >= 3 && isPolygonMode && (
              <Button
                size="sm"
                colorPalette="red"
                onClick={finishPolygonSelection}
              >
                Delete Selected ({
                  // Preview count
                  polygonSelectionCount
                } segments)
              </Button>
            )}

            {polygonPointsCount >= 3 && isPolygonAddMode && (
              <Button
                size="sm"
                colorPalette="blue"
                onClick={finishAddSegmentsSelection}
              >
                Copy Selected ({
                  polygonSelectionCount
                } segments)
              </Button>
            )}
          </>
          </MaybePortal>
        )}
      </HStack>

      {allPointsCount > 0 && (
        <HStack gap="2">
          <Button
            size="sm"
            onClick={handleOpenInTreatment}
            {...(isV2
              ? { style: { background: COLOR.blue, color: COLOR.white, fontFamily: FONT, fontWeight: 700, borderRadius: 6 } }
              : { colorPalette: "green" as const })}
          >
            {activeFiltersCount > 0 ? "Treat Filtered Segments" : "Open in Treatment"}
          </Button>
          {isV2 ? (
            // v2: a teal "Generate Report" button (global scope, §4) beside a single
            // dark "Download" dropdown (DESIGN_GUIDE §4 dropdown button).
            <HStack gap="2">
              <Button
                size="sm"
                onClick={onGenerateReport}
                style={{ background: COLOR.teal, color: COLOR.white, fontFamily: FONT, fontWeight: 700, borderRadius: 6 }}
              >
                {"Generate Report"}
              </Button>
              <Menu.Root positioning={{ placement: "bottom-end", strategy: "fixed" }}>
                <Menu.Trigger asChild>
                  <Button
                    size="sm"
                    style={{ background: COLOR.gray800, color: COLOR.white, fontFamily: FONT, fontWeight: 700, borderRadius: 6 }}
                  >
                    Download <FaChevronDown style={{ marginLeft: 6 }} size={10} />
                  </Button>
                </Menu.Trigger>
                <Menu.Positioner>
                  <Menu.Content zIndex={2000}>
                    <Menu.Item value="table" onClick={handleDownloadCSV}>Download Table</Menu.Item>
                    <Menu.Item value="images" onClick={handleDownloadImages}>Download Images</Menu.Item>
                    <Menu.Item value="shapefile" onClick={handleDownloadShapefile}>Download Shapefile</Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Menu.Root>
            </HStack>
          ) : (
            <>
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
            </>
          )}
        </HStack>
      )}
    </Flex>
  );
}
