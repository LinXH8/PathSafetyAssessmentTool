/**
 * MapToolCluster.tsx — GeoDataPanel's tool row / floating tool cluster.
 *
 * Single responsibility: the segment-editing tool buttons (single-point
 * delete/copy menu, polygon delete/copy menu, the "Delete/Copy Selected"
 * actions) rendered as a bordered toolbar row under the header in v1, or as
 * the floating top-right cluster with the Curv./Width/Grade metric readouts
 * in v2 (Home.dc.html FRAME 4). Purely presentational — all state and actions
 * come from `useSegmentEditTools`. Extracted verbatim from GeoDataPanel.tsx
 * in S2.2.
 */
import { Box, Button, Flex, IconButton, Menu, Text } from "@chakra-ui/react";
import { FaDrawPolygon, FaMousePointer, FaPlus, FaTrash } from "react-icons/fa";
import { isPointInPolygon } from "../../../../components/map/polygonUtils";
import type { SelectablePoint, useSegmentEditTools } from "./useSegmentEditTools";

/**
 * Renders the map tool buttons (and, in v2, the floating metric readouts).
 *
 * @param variant "v1" toolbar row / "v2" floating cluster (same gating as GeoDataPanel).
 * @param edit the full `useSegmentEditTools` return value.
 * @param points segment dots used to count polygon-selected segments.
 * @param curvDisplay / widthDisplay / gradeDisplay pre-formatted metric strings.
 * Pure presentational — no side effects beyond the callbacks it invokes.
 */
export function MapToolCluster({
  variant,
  edit,
  points,
  curvDisplay,
  widthDisplay,
  gradeDisplay,
}: {
  variant: "v1" | "v2";
  edit: ReturnType<typeof useSegmentEditTools>;
  points: SelectablePoint[];
  curvDisplay: string;
  widthDisplay: string;
  gradeDisplay: string;
}) {
  const {
    isDeleteMode, setIsDeleteMode,
    isPointAddMode, setIsPointAddMode,
    isPolygonMode, setIsPolygonMode,
    isPolygonAddMode, setIsPolygonAddMode,
    polygonPoints, setPolygonPoints,
    setDeleteConfirmationOpen,
    finishPolygonSelection,
    finishAddSegmentsSelection,
  } = edit;

  return (
    <Box
      px={variant === "v2" ? "0" : "4"}
      pt={variant === "v2" ? "0" : "2"}
      pb={variant === "v2" ? "0" : "2"}
      borderBottom={variant === "v2" ? undefined : "1px solid"}
      borderColor="gray.200"
      _dark={{ borderColor: "gray.700" }}
      {...(variant === "v2"
        ? { position: "absolute", top: "60px", right: "12px", zIndex: 1000, bg: "white", borderWidth: "1px", borderRadius: "6px", boxShadow: "sm", display: "flex", alignItems: "stretch", overflow: "hidden" }
        : {})}
    >
      {/* v2: floating metric readouts (Curv./Width/Grade) ahead of the tools. */}
      {variant === "v2" && (
        <Flex align="stretch">
          {([["Curv.", curvDisplay], ["Width", widthDisplay], ["Grade", gradeDisplay]] as const).map(([label, value]) => (
            <Flex key={label} direction="column" align="center" justify="center" gap="2px" px="12px" py="5px">
              <Text fontSize="12px" color="#718096" lineHeight="1">{label}</Text>
              <Text fontSize="16px" color="#4A5568" lineHeight="1" whiteSpace="nowrap">{value}</Text>
            </Flex>
          ))}
        </Flex>
      )}
      {/* Tool icon buttons */}
      <Flex
        align="center"
        gap={variant === "v2" ? "1.5" : "2"}
        wrap="wrap"
        mb={variant === "v2" ? "0" : "2"}
        onClick={(e) => e.stopPropagation()}
        {...(variant === "v2"
          ? { px: "6px", borderLeft: "1px solid", borderColor: "gray.200" }
          : {})}
      >
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
  );
}
