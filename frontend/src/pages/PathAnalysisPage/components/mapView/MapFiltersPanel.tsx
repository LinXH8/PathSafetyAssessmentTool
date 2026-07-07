/**
 * MapFiltersPanel.tsx — the filter-attribute tab row + per-category /
 * per-subcategory toggle chips of the Path Analysis map view
 * (`PathAnalysisMapView.tsx`).
 *
 * Single responsibility: purely presentational panel extracted from the
 * map-view monolith [S2.1]. Renders the always-present "Projects" tab
 * (show/hide pills per loaded project), one tab per active filter attribute
 * with Layer-2 category chips, nested Layer-3 subcategory chips, and the
 * numeric range slider for numeric filter attributes. Both v1 (Chakra tabs)
 * and v2 (design-guide tab row) chromes are preserved via `isV2`.
 *
 * All state stays in the map view (via `useFilterState`); this component only
 * receives values + setters. In v2 the map view portals it into the left
 * "Current Filters" accordion via `MaybePortal` — the portal wrapper stays in
 * the parent. No fetching, no storage access (rule: shells stay pure).
 *
 * Named `MapFiltersPanel` (not `FilterPanel`) because `FilterPanel.tsx` — the
 * attribute *selection* panel — already exists beside the map view.
 */

import type { Dispatch, SetStateAction } from "react";
import { Box, Button, Flex, Tabs, Text } from "@chakra-ui/react";
import { Slider } from "../../../../components/ui/slider";
import { v2TabRowStyle, v2TabStyle } from "../paV2Primitives";
import {
  ATTRIBUTE_LABELS,
  ATTRIBUTE_OPTIONS,
  NUMERIC_FILTER_ATTRIBUTES,
  SUBCATEGORY_MAP,
  getCategoryColor,
} from "../AttributesDropdown";

interface MapFiltersPanelProps {
  /** v2 chrome flag (design-guide tab row instead of Chakra Tabs.List). */
  isV2: boolean;
  /** Attributes selected in the FilterPanel (drives one tab per attribute). */
  selectedAttributes: string[];
  /** Same list as `selectedAttributes` (the map view's activeFilters memo). */
  activeFilters: string[];
  /** Attribute whose categories are shown ("Project" for the Projects tab). */
  categoryFilterAttribute: string | undefined;
  /** Selected tab index; -1 is the Projects tab. */
  categoryFilterAttributeIndex: number;
  setCategoryFilterAttributeIndex: Dispatch<SetStateAction<number>>;
  setPrimaryFocusAttribute: Dispatch<SetStateAction<string | null>>;
  loadedProjects: string[];
  hiddenProjects: string[];
  onHiddenProjectsChange: (hidden: string[]) => void;
  /** Project name → pill colour. */
  projectColors: Record<string, string>;
  /** Categories present in the loaded data for the current tab attribute. */
  availableCategories: string[];
  categoryToggles: Record<string, Record<string, boolean>>;
  setCategoryToggles: Dispatch<SetStateAction<Record<string, Record<string, boolean>>>>;
  subcategoryToggles: Record<string, Record<string, boolean>>;
  setSubcategoryToggles: Dispatch<SetStateAction<Record<string, Record<string, boolean>>>>;
  rangeFilters: Record<string, [number, number]>;
  setRangeFilters: Dispatch<SetStateAction<Record<string, [number, number]>>>;
  /** Data-derived slider bounds per numeric attribute. */
  dataRangeBounds: Record<string, { min: number; max: number }>;
}

/**
 * Pure function of its props — all toggle mutations go through the passed
 * setters, so the map view keeps owning the (sessionStorage-persisted) state.
 */
export function MapFiltersPanel({
  isV2,
  selectedAttributes,
  activeFilters,
  categoryFilterAttribute,
  categoryFilterAttributeIndex,
  setCategoryFilterAttributeIndex,
  setPrimaryFocusAttribute,
  loadedProjects,
  hiddenProjects,
  onHiddenProjectsChange,
  projectColors,
  availableCategories,
  categoryToggles,
  setCategoryToggles,
  subcategoryToggles,
  setSubcategoryToggles,
  rangeFilters,
  setRangeFilters,
  dataRangeBounds,
}: MapFiltersPanelProps) {
  return (
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
        {isV2 ? (
          // v2: design-guide tab style (§6), single row + horizontal scroll.
          <div style={{ ...v2TabRowStyle, padding: "0 4px" }}>
            <div
              onClick={() => { setCategoryFilterAttributeIndex(-1); setPrimaryFocusAttribute("Project"); }}
              style={v2TabStyle(categoryFilterAttributeIndex === -1)}
            >
              Projects
            </div>
            {selectedAttributes.map((attr, idx) => (
              <div
                key={attr}
                onClick={() => { setCategoryFilterAttributeIndex(idx); setPrimaryFocusAttribute(activeFilters[idx]); }}
                style={v2TabStyle(categoryFilterAttributeIndex === idx)}
              >
                {(ATTRIBUTE_LABELS[attr] ?? attr).slice(0, 22)}
              </div>
            ))}
          </div>
        ) : (
          <Box>
            <Tabs.List px="4" flexWrap="wrap">
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
        )}

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
  );
}
