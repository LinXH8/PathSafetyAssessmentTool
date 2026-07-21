import { useState } from "react";
import { Box, Text, Flex, Button, Tabs, Badge } from "@chakra-ui/react";
import { Switch } from "../../../components/ui/switch";
import { FaFilter, FaChevronDown, FaChevronUp } from "react-icons/fa";
import { ATTRIBUTE_LABELS, CYCLERAP_ATTRIBUTE_CONFIGS, SUBCATEGORY_CHILD_ATTRS, SUBCATEGORY_MAP, safetyScoreAttributes } from "./AttributesDropdown";
import { FONT, COLOR } from "../../../features/ui/designTokens";
import { V2_GROUP_TAB_LABELS } from "../../../constants/autocodeAttributes";
import { V2Switch, v2TabStyle, v2TabRowStyle } from "./paV2Primitives";

const GROUP_ORDER = [
  "Risk Level",
  "Facility configuration",
  "Facility clear width",
  "Facility surface conditions",
  "Intersection",
  "Flow & Speed",
] as const;

const MAX_ACTIVE = 5;

const getMasterToggleLabel = (attrName: string, fallbackLabel?: string): string => {
  const label = ATTRIBUTE_LABELS[attrName] ?? fallbackLabel ?? attrName;
  return SUBCATEGORY_MAP[attrName] ? `${label}*` : label;
};

interface FilterPanelProps {
  activeFilters: string[];
  onActiveFiltersChange: (filters: string[]) => void;
  /** "v2" renders the comp's "Toggle Attributes" panel (no collapsible header). */
  variant?: "v1" | "v2";
}

export default function FilterPanel({ activeFilters, onActiveFiltersChange, variant = "v1" }: FilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [v2Group, setV2Group] = useState<string>(GROUP_ORDER[0]);

  const toggle = (attrName: string) => {
    if (activeFilters.includes(attrName)) {
      onActiveFiltersChange(activeFilters.filter(f => f !== attrName));
    } else if (activeFilters.length < MAX_ACTIVE) {
      onActiveFiltersChange([...activeFilters, attrName]);
    }
  };

  const attrsByGroup = CYCLERAP_ATTRIBUTE_CONFIGS.reduce<
    Record<string, { name: string; label?: string }[]>
  >((acc, attr) => {
    if (SUBCATEGORY_CHILD_ATTRS.has(attr.name)) return acc; // hidden — nested under parent
    if (!acc[attr.group]) acc[attr.group] = [];
    acc[attr.group].push(attr);
    return acc;
  }, {});

  // Inject safety score attributes into the "Risk Level" group
  attrsByGroup["Risk Level"] = safetyScoreAttributes.map(a => ({
    name: a.name,
    label: a.displayName,
  }));

  // ── v2: the comp's "Toggle Attributes" panel (DESIGN_GUIDE §6 tabs + §7 ──
  // switches). No collapsible header — the accordion in the layout owns that.
  if (variant === "v2") {
    const groupAttrs = attrsByGroup[v2Group] ?? [];
    return (
      // width/minWidth/overflow bound the panel to its column so the tab row's
      // own horizontal scroll engages instead of stretching the whole section.
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", width: "100%", minWidth: 0, maxWidth: "100%", overflow: "hidden" }}>
        <div style={v2TabRowStyle}>
          {GROUP_ORDER.map(group => {
            const activeInGroup = (attrsByGroup[group] ?? []).filter(a => activeFilters.includes(a.name)).length;
            return (
              <div key={group} onClick={() => setV2Group(group)} style={v2TabStyle(group === v2Group)}>
                {V2_GROUP_TAB_LABELS[group] ?? group}
                {activeInGroup > 0 ? ` (${activeInGroup})` : ""}
              </div>
            );
          })}
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            border: `1px solid ${COLOR.border}`,
            borderRadius: "0 6px 6px 6px",
            marginTop: -1,
            background: COLOR.white,
            padding: 12,
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {/* Header row: group label + reset — mirrors the "Current Filters" panel */}
          <Flex align="center" justify="space-between" mb="2">
            <Text fontSize="xs" fontWeight="semibold" color="gray.500" _dark={{ color: "gray.400" }}>
              {v2Group}
            </Text>
            <Button
              size="xs"
              variant="ghost"
              colorPalette="gray"
              disabled={activeFilters.length === 0}
              onClick={() => onActiveFiltersChange([])}
            >
              Reset
            </Button>
          </Flex>
          {activeFilters.length >= MAX_ACTIVE && (
            <div style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500, marginBottom: 10 }}>
              Maximum of {MAX_ACTIVE} filters reached. Disable one to add another.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 40px", alignContent: "start" }}>
            {groupAttrs.map(attr => {
              const label = getMasterToggleLabel(attr.name, attr.label);
              const isActive = activeFilters.includes(attr.name);
              const isDisabled = activeFilters.length >= MAX_ACTIVE && !isActive;
              return (
                <div key={attr.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, opacity: isDisabled ? 0.5 : 1 }}>
                  <span title={label} style={{ fontFamily: FONT, fontWeight: 400, fontSize: 16, color: COLOR.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {label}
                  </span>
                  <V2Switch
                    on={isActive}
                    onColor={COLOR.blue}
                    onClick={isDisabled ? undefined : () => toggle(attr.name)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Box borderWidth="1px" borderRadius="lg" bg="bg.panel" overflow="hidden">
      {/* Collapsible header */}
      <Flex
        justify="space-between"
        align="center"
        px="6"
        py="4"
        cursor="pointer"
        onClick={() => setIsExpanded(!isExpanded)}
        _hover={{ bg: "gray.50", _dark: { bg: "gray.700" } }}
        userSelect="none"
      >
        <Flex align="center" gap="3">
          <FaFilter size={14} color="#4A5568" />
          <Text fontWeight="bold" fontSize="md">Filter Segments</Text>
          {activeFilters.length > 0 && (
            <Badge colorPalette="blue" variant="solid" borderRadius="full" px="2">
              {activeFilters.length}/{MAX_ACTIVE} active
            </Badge>
          )}
        </Flex>
        <Flex align="center" gap="3">
          {activeFilters.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              colorPalette="red"
              onClick={(e) => { e.stopPropagation(); onActiveFiltersChange([]); }}
            >
              Reset All
            </Button>
          )}
          {isExpanded ? <FaChevronUp size={14} /> : <FaChevronDown size={14} />}
        </Flex>
      </Flex>

      {isExpanded && (
        <Box borderTop="1px solid" borderColor="gray.200" _dark={{ borderColor: "gray.700" }}>
          {activeFilters.length >= MAX_ACTIVE && (
            <Box px="6" py="2" bg="orange.50" _dark={{ bg: "orange.900" }}>
              <Text fontSize="xs" color="orange.700" _dark={{ color: "orange.200" }}>
                Maximum of {MAX_ACTIVE} filters reached. Disable one to add another.
              </Text>
            </Box>
          )}

          <Tabs.Root defaultValue={GROUP_ORDER[0]} variant="line">
            <Box>
              <Tabs.List px="4" flexWrap="wrap">
                {GROUP_ORDER.map(group => {
                  const activeInGroup = (attrsByGroup[group] ?? []).filter(a => activeFilters.includes(a.name)).length;
                  return (
                    <Tabs.Trigger key={group} value={group} fontSize="sm" whiteSpace="nowrap">
                      {group}
                      {activeInGroup > 0 && (
                        <Badge ml="1.5" colorPalette="blue" variant="solid" size="sm">
                          {activeInGroup}
                        </Badge>
                      )}
                    </Tabs.Trigger>
                  );
                })}
              </Tabs.List>
            </Box>

            {GROUP_ORDER.map(group => (
              <Tabs.Content key={group} value={group} p="4">
                <Flex flexWrap="wrap" gap="3">
                  {(attrsByGroup[group] ?? []).map(attr => {
                    const label = getMasterToggleLabel(attr.name, attr.label);
                    const isActive = activeFilters.includes(attr.name);
                    const isDisabled = activeFilters.length >= MAX_ACTIVE && !isActive;

                    return (
                      <Flex
                        key={attr.name}
                        align="center"
                        gap="2"
                        px="3"
                        py="2"
                        borderWidth="1px"
                        borderRadius="md"
                        bg={isActive ? "blue.50" : "bg.subtle"}
                        borderColor={isActive ? "blue.300" : "gray.200"}
                        _dark={{
                          bg: isActive ? "blue.900" : "gray.800",
                          borderColor: isActive ? "blue.500" : "gray.600",
                        }}
                        opacity={isDisabled ? 0.5 : 1}
                        cursor={isDisabled ? "not-allowed" : "default"}
                      >
                        <Text
                          fontSize="sm"
                          fontWeight={isActive ? "semibold" : "normal"}
                          color={isActive ? "blue.700" : "gray.700"}
                          _dark={{ color: isActive ? "blue.200" : "gray.200" }}
                        >
                          {label}
                        </Text>
                        <Switch
                          colorPalette="blue"
                          size="sm"
                          checked={isActive}
                          disabled={isDisabled}
                          onCheckedChange={() => toggle(attr.name)}
                        />
                      </Flex>
                    );
                  })}
                </Flex>
              </Tabs.Content>
            ))}
          </Tabs.Root>
        </Box>
      )}
    </Box>
  );
}
