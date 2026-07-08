/**
 * SegmentsTableTab.tsx — the "Table View" tab of the Path Analysis map view
 * (`PathAnalysisMapView.tsx`).
 *
 * Single responsibility: purely presentational table tab extracted from the
 * map-view monolith [S2.1]. Renders the per-project jump buttons, the active
 * sort-order chips + clear control, and the sortable/filterable segments
 * table (v2: sticky Project / Segment No. columns; v1 chrome unchanged).
 * Must be mounted inside the map view's `<Tabs.Root>` (it renders the
 * `<Tabs.Content value="table">`).
 *
 * All data derivation (filtering, sorting, cell text via `getColumnValue`)
 * stays in the map view — this component only receives the results plus the
 * sort/filter setters. No fetching, no storage access.
 */

import { useRef } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { Box, Button, Flex, Input, Tabs, Text } from "@chakra-ui/react";
import { LuChevronsUpDown, LuChevronUp, LuChevronDown } from "react-icons/lu";
import { FONT } from "../../../../features/ui/designTokens";
import type { MapPoint, TablePoint, TableSortConfig } from "./mapViewUtils";

interface SegmentsTableTabProps {
  /** v2 chrome flag (sticky columns, design-guide typography). */
  isV2: boolean;
  selectedProjects: string[];
  /** Project name → pill colour for the jump buttons. */
  projectColors: Record<string, string>;
  /** Total visible (filtered) segment count — gates the empty state. */
  allPointsCount: number;
  /** Rows after global search + column filters + sorting. */
  sortedData: MapPoint[];
  /** Ordered column definitions (v1/v2 order differs — built in the parent). */
  tableColumns: { key: string; label: string }[];
  /** Resolves a cell's display text for a row/column. */
  getColumnValue: (point: TablePoint, columnKey: string) => string;
  sortConfig: TableSortConfig;
  setSortConfig: Dispatch<SetStateAction<TableSortConfig>>;
  columnFilters: Record<string, string>;
  setColumnFilters: Dispatch<SetStateAction<Record<string, string>>>;
  setGlobalSearch: Dispatch<SetStateAction<string>>;
}

/**
 * Pure function of its props; owns only the table-container DOM ref used by
 * the "Jump to Project" scroll behaviour.
 */
export function SegmentsTableTab({
  isV2,
  selectedProjects,
  projectColors,
  allPointsCount,
  sortedData,
  tableColumns,
  getColumnValue,
  sortConfig,
  setSortConfig,
  columnFilters,
  setColumnFilters,
  setGlobalSearch,
}: SegmentsTableTabProps) {
  const tableContainerRef = useRef<HTMLDivElement>(null);

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

  const handleTableProjectJump = (projectName: string) => {
    const container = tableContainerRef.current;
    if (!container) return;
    const row = container.querySelector<HTMLTableRowElement>(`tr[data-project="${CSS.escape(projectName)}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  // v2 table: Project Name + Segment No. are frozen (sticky) while side-scrolling.
  const V2_COL_W: Record<string, number> = { "Project": 200, "Segment #": 130 };
  const v2StickyStyle = (key: string, isHeader: boolean): CSSProperties => {
    if (!isV2) return {};
    if (key !== "Project" && key !== "Segment #") return {};
    const left = key === "Segment #" ? V2_COL_W["Project"] : 0;
    const w = V2_COL_W[key];
    return {
      position: "sticky",
      left,
      width: w,
      minWidth: w,
      maxWidth: w,
      background: "#fff",
      // header sticky-corner sits above both the other headers and the body sticky cells
      zIndex: isHeader ? 5 : 3,
    };
  };

  return (
    <Tabs.Content value="table" {...(isV2 ? { p: 0, flex: "1", minH: 0, minW: 0, maxW: "100%", display: "flex", flexDirection: "column", overflow: "hidden" } : {})}>
      <Box {...(isV2 ? { flex: "1", minH: 0, minW: 0, maxW: "100%", w: "100%", display: "flex", flexDirection: "column", overflow: "hidden" } : {})}>
        {selectedProjects.length > 0 && allPointsCount > 0 && (
          <Box p="4" borderBottom="1px solid" borderColor="gray.200">
            <Text fontSize="sm" fontWeight="semibold" mb="2">
              Jump to Project:
            </Text>
            <Flex gap="2" flexWrap="wrap">
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
                  onClick={() => handleTableProjectJump(proj)}
                >
                  {proj}
                </Button>
              ))}
            </Flex>
          </Box>
        )}
        {allPointsCount === 0 ? (
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
                  Showing {sortedData.length} of {allPointsCount} segments
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
            <Box ref={tableContainerRef} overflowX="auto" overflowY="auto" maxH={isV2 ? undefined : "650px"} {...(isV2 ? { flex: "1", minH: 0, minW: 0, maxW: "100%", w: "100%" } : {})}>
              <table
                style={{
                  width: "100%",
                  // Sticky cells render reliably with separate borders (collapse glitches).
                  borderCollapse: isV2 ? "separate" : "collapse",
                  borderSpacing: 0,
                  border: isV2 ? "none" : "1px solid #e2e8f0",
                  fontFamily: isV2 ? FONT : undefined,
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
                            borderBottom: isV2 ? "1px solid #E2E8F0" : "2px solid var(--chakra-colors-border-subtle)",
                            cursor: "pointer",
                            userSelect: "none",
                            position: "sticky",
                            top: 0,
                            zIndex: isV2 ? 2 : 1,
                            backgroundColor: isV2 ? "#fff" : "var(--chakra-colors-bg-subtle)",
                            whiteSpace: isV2 ? "nowrap" : undefined,
                            ...v2StickyStyle(col.key, true),
                          }}
                          onClick={() => handleHeaderClick(col.key)}
                        >
                          <Flex align="center" gap="2" mb="1" flexWrap="nowrap">
                            <Text fontWeight={isV2 ? "700" : "600"} fontSize={isV2 ? "16px" : "sm"} fontFamily={isV2 ? FONT : undefined} whiteSpace={isV2 ? "nowrap" : undefined}>
                              {col.label}
                            </Text>
                            {isV2 ? (
                              // Home/Create-style sort glyph: stacked chevrons when unsorted, single chevron (+priority) when sorted.
                              sortDirection ? (
                                <span style={{ color: "#4A5568", display: "inline-flex", alignItems: "center", gap: 2 }}>
                                  {sortDirection === "asc"
                                    ? <LuChevronUp size={13} strokeWidth={2.5} style={{ flexShrink: 0 }} />
                                    : <LuChevronDown size={13} strokeWidth={2.5} style={{ flexShrink: 0 }} />}
                                  {sortConfig.length > 1 && <span style={{ fontSize: 10, fontWeight: 700 }}>{sortIndex + 1}</span>}
                                </span>
                              ) : (
                                <LuChevronsUpDown size={13} color="#A0AEC0" style={{ flexShrink: 0 }} />
                              )
                            ) : (
                              sortDirection && (
                                <Text fontSize="xs" color="blue.600">
                                  {sortDirection === 'asc' ? '↑' : '↓'}
                                  {sortIndex > 0 && <sup>{sortIndex + 1}</sup>}
                                </Text>
                              )
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
                            <td
                              key={col.key}
                              style={{
                                padding: isV2 ? "8px 12px" : "12px",
                                borderBottom: isV2 ? "1px solid #EDF2F7" : "1px solid #e2e8f0",
                                ...v2StickyStyle(col.key, false),
                              }}
                            >
                              {col.key === "Project" ? (
                                <Flex align="center" gap="2">
                                  <Box w="8px" h="8px" borderRadius="full" bg={color} />
                                  <Text fontSize={isV2 ? "16px" : "sm"}>{value}</Text>
                                </Flex>
                              ) : col.key === "Coordinates" ? (
                                <Text fontSize="xs" fontFamily="mono">{value}</Text>
                              ) : col.key === "Overall Risk Score" ? (
                                <Text fontSize={isV2 ? "16px" : "sm"} fontWeight={isV2 ? "700" : "600"}>{value}</Text>
                              ) : (
                                <Text fontSize={isV2 ? "16px" : "sm"}>{value}</Text>
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
  );
}
