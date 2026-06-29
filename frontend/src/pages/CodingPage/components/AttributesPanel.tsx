import { useEffect, useMemo, useRef } from "react";
import type { AttributeRow, AttrMappings } from "../../../api";
import {
  Card,
  Heading,
  Box,
  Text,
  NativeSelect,
  Input,
  SimpleGrid,
  Separator,
  Tabs,
  Button,
  Flex,
} from "@chakra-ui/react";
import { FaSyncAlt } from "react-icons/fa";
import { LuPencil, LuInfo } from "react-icons/lu";
import { Tooltip } from "../../../components/ui/tooltip";
import { useState } from "react";
import { toaster } from "../../../components/ui/toaster";
import { FONT, COLOR } from "../../../features/ui/designTokens";
import { V2_GROUP_TAB_LABELS } from "../../../constants/autocodeAttributes";
import "./AttributesPanel.css";

/** Maps real parent key → child field name whose options are editable */
const PARENT_TO_CHILD_FIELD: Record<string, string> = {
  "Fixed Obstacle on Facility": "FO Type",
  "Non-Fixed Obstacle on Facility": "NFO Type",
  "Loose or slippery surface": "Issue Type (Slippery)",
  "Facility Width per Direction": "Facility Width Sub-category",
  "Crossing Facility": "Crossing Type",
  "Delineation": "Delineation Type",
  "Curvature": "Curvature Sub-category",
};

/**
 * For these child fields, the pencil only appears when the parent is Present (value 1).
 */
const CHILD_REQUIRES_PARENT_PRESENT: Record<string, string> = {
  "FO Type": "Fixed Obstacle on Facility",
  "NFO Type": "Non-Fixed Obstacle on Facility",
  "Issue Type (Slippery)": "Loose or slippery surface",
  "Crossing Type": "Crossing Facility",
};

/** Hover tooltips keyed by real row key (what `k` is in the render loop). */
const ATTRIBUTE_TOOLTIPS: Record<string, string> = {
  // Facility configuration
  "Area type": "Classify the surrounding land use. Singapore paths are mostly Suburban (HDB/residential). Use Urban for city area and dense commercial zones, Industrial for business parks and logistics areas, Recreational for parks. Not scored directly but provides environmental context.",
  "Facility Type": "The type of cycling facility at this segment. Off-Road Bicycle Path (dedicated red tarmac) carries the lowest risk; Mixed Traffic Road Lane the highest. Most Singapore cycling facility segments are Multi-Use Path or Off-Road Bicycle Path. Drives VB and BP scores significantly.",
  "Adjacent Sidewalk 0-1m": "Is there a footpath or pedestrian walkway within arm's reach of the cycling path? Common in Singapore where footpath/ covered linkways run immediately beside cycling tracks. Increases BP (cyclist–pedestrian conflict) risk.",
  "Adjacent Sidewalk 1-3m": "Pedestrian footpath further away but still within the risk zone. Contributes to BP score when pedestrians are likely to stray into the cycling lane at lower severity.",
  "Adjacent Road Lane 0-1m": "Is there a motor vehicle lane essentially directly beside the path? Look for road surface, kerb edge, or live traffic in the image. A primary VB trigger. CV auto-codes this for most segments — verify when ambiguous.",
  "Adjacent Road Lane 1-3m": "A motor vehicle lane nearby but separated by a small buffer. Still a VB risk factor. CV auto-codes; confirm when traffic is visible in the mid-ground of the image.",
  "Adjacent Vehicle Parking 0-1m": "Is there a car park bay or on-street parking directly beside the path? Door-opening hazard and sight-line obstruction. Common along HDB estate perimeter roads and neighbourhood carparks.",
  "Adjacent Vehicle Parking 1-3m": "Parked vehicles slightly further out from the cycling facility. Still contributes to SB departure risk at lower severity.",
  "Adjacent object or level change 0-1m": "A non-vehicle edge hazard <= 60cm high immediately beside the path without safety barrier: concrete drain, kerb drop, retaining wall, or steep embankment. CV mirrors the Adjacent Road Lane 0–1m result. Affects SB score.",
  "Adjacent object or level change 1-3m": "Same class of edge hazard at 1–3m distance. Contributes to SB departure risk at lower severity.",

  // Facility clear width
  "Facility access": "Can cyclists enter and exit this segment without obstruction? Code Inadequate if there are bollard gates, anti-cyclist/motorcycle chicanes, narrow entry posts, non barrier free access or raised kerb lips at the segment boundary.",
  "Light Segregation": "Is there a physical separator between the cycling path and motor vehicle traffic? Covers kerbs, railings, and flexible post delineators. Default is Present when a path is detected. A protective factor — reduces VB risk when present.",
  "Fixed Obstacle on Facility": "A permanent physical object on the cycling path: lamp post, utility pillar, bollard, fence, or large vegetation. Check the image carefully for anything cyclists must steer around. Use FO Type sub-field to record the type of fixed obstacle.",
  "Non-Fixed Obstacle on Facility": "A movable or temporary object blocking or narrowing the path: litter bin, traffic cone, construction barrier, or parked bicycle/motorcycle. Use NFO Type sub-field to choose the type of non fixed obstacle.",
  "Facility Width per Direction": "Usable cycling width in the direction of travel. Very Narrow paths carry the highest risk multiplier; Wide paths are neutral. GIS auto-codes from path width data based on Dec 2024 LIDAR survey. Use the Facility Width Sub-category to record the approximate width range.",
  "Width Restriction": "Is there a local pinch point mid-segment that narrows the path below its general width by at least 20% — e.g. a signpost, tree stump, or irregular bollard arrangement? Adds risk even when the overall width is adequate.",
  "Adjacent Severe Hazard 0-1m": "A high-consequence hazard immediately beside the path that would cause serious injury if struck: deep open drain, bridge parapet gap, or unguarded steep drop. Increases SB severity substantially. Common at elevated cycling facility sections and waterway paths.",
  "Adjacent Severe Hazard 1-3m": "Same class of severe hazard at 1–3m distance. Still a significant SB severity factor but at lower severity.",
  "Line of Sight": "Whether cyclists have clear forward visibility at curves or obstructions. Code if clearly observable; otherwise leave as-is.",

  // Facility surface conditions
  "Delineation": "Is there visible marking separating cycling space from pedestrian space or centreline separating the directions of cyclist travel? In Singapore: red tarmac, red-and-white painted lines, shared-path arrows, or \"Cyclists\" / \"Pedestrians\" signage. CV model auto-codes this — verify when markings are faded or absent.",
  "Major Surface Deformation or Drain Opening": "Is there a significant structural surface defect: deep pothole, cracked and raised joint, exposed drain grating with a wheel-trapping gap, or severely buckled surface?",
  "Loose or slippery surface": "Is there loose material, wet algae, fallen leaves, sand, or a slippery coating that makes the surface slippery? Use the Issue Type sub-field to specify the material.",
  "Grade": "Is this segment on a slope steep enough to affect cycling control? Most Singapore paths are flat — flag ramp sections, hillside paths. Check the gradient profile in the GIS context panel if available.",
  "Curvature": "Does this segment include a tight bend that forces sudden steering or cuts forward visibility? Use the Curvature Sub-category to record the approximate bend radius or path intersection.",
  "Tram or Train Rails": "Are there rail tracks crossing or embedded in the cycling path at a shallow angle? Rail grooves are a well-known bicycle-wheel trap. Rare in Singapore, check near LRT or KTM level crossings.",
  "Street Lighting": "Is the segment illuminated at night by street lamps or dedicated path lighting? Most Singapore urban and suburban paths have lighting. Default is Present.",

  // Intersection
  "Intersection Approach": "How is the cycling approach to a road crossing arranged? Shared means the cyclist merges with or crosses through motor vehicle flow without a dedicated cycling route. Separate/NA means a clearly marked dedicated cyclist approach exists, or there is no crossing at this segment. Most signalised Singapore crossings with a bicycle waiting box qualify as Separate.",
  "Intersection or Road Crossing": "Is there a road junction or formal road crossing within this segment. GIS auto-codes from the road crossing layer.",
  "Crossing Facility": "Is there a formal aid to help cyclists cross the road: zebra crossing, signalised pedestrian crossing, or a cycle-specific signal phase? Not Present raises VB risk. Use the Crossing Type sub-field to specify what is present.",
  "Property Access": "Does a driveway, carpark entrance, or building service access cut across the cycling path within this segment? Reversing or turning vehicles create unpredictable conflicts. Very common at HDB multi-storey carparks, shopping centres, schools and industrial units.",
  "Pedestrian Crossing": "Is there a potential pedestrian crossing across this segment that cyclists must also navigate through? Often co-located with MRT exits, bus stops, activity generating nodes, and near to formal crossings.",
  "Intersecting Bicycle Facility": "Does another cycling path or PCN route cross or join the current segment? Look for bicycle route merge points and junctions visible on the map.",
  "Number of lanes – adjacent road": "How many lanes in each direction does the road running beside this segment have? Multi-lane roads increase VB risk. GIS auto-codes from the kerb layer; manually verify for complex or split-road arrangements.",
  "Number of lanes – intersecting road": "How many lanes does the road being crossed at this segment's intersection have? More lanes mean a longer, more exposed crossing. Increases VB risk. At development accesses and crossings.",

  // Flow & Speed
  "Flow Direction": "Is cycling occurring or permitted in both directions on this path? Two-way flow introduces head-on conflict risk. Most Singapore off road cycling facility are bi-directional by convention even where no physical barrier exists. Check for directional arrow markings on cycling facilities.",
  "Peak pedestrian flow along or across facility": "How busy is this path or crossing with pedestrians at peak hours? GIS auto-codes from sensor and count data where available. Higher pedestrian activity directly increases BP (cyclist–pedestrian) risk.",
  "Peak bicycle/LV traffic flow": "How busy is the cycling path at peak hour? GIS auto-codes from count sensors. Consider paths near MRT stations, schools, or cycling rental hubs.",
  "Observed proportion of cargo bikes and mopeds": "What proportion of cyclists use cargo bikes, delivery e-bikes, or large LPMs? Low is the default. Moderate-to-high increases BB (cyclist–cyclist) severity. Consider proximity to delivery hubs, industrial clusters, or food court corridors.",
  "Heavy vehicle flow": "How much heavy vehicle traffic (lorries, buses, prime movers) uses the adjacent road? Moderate-to-high increases VB risk. GIS auto-codes using bus lane proximity as a proxy.",
  "Bicycle/LV speed – average": "Estimated average cycling speed on this segment. Higher speed increases severity for fall, speed-related, and vehicle-conflict scenarios. Most Singapore shared paths are designed for lower speeds; flag where e-bikes are common or where path geometry encourages faster riding.",
  "Bicycle/LV speed differential": "How much does cycling speed vary between faster and slower users on this path? High differential (e.g. speed e-bikes overtaking pedestrian-pace cyclists) increases BB severity. Common on wide shared paths near rental bike stations.",
  "Road AADT": "Annual Average Daily Traffic: total vehicles using the adjacent road per day. Obtained from LTA ERP2 data. Higher AADT increases VB score via a stepped lookup.",
  "Road operating speed (mean)": "Observed average vehicle speed on the adjacent road. GIS auto-codes from the ERP2 LinkID layer. Higher speed increases multiplier for vehicle-bicycle conflict severity.",
  "Road operating speed (unit)": "Select the unit for Road Operating Speed (mean). Singapore roads use km/h.",
  "Road speed limit": "The posted legal speed limit of the adjacent road. GIS auto-codes from the speed limit layer. Displayed for context only, does not feed directly into CycleRAP scoring formulas.",
};

/** ====== Props ====== */
type Props = {
  row: AttributeRow | null;
  originalRow?: AttributeRow | null; // Original autocode values for comparison
  mappings?: AttrMappings;
  panelHeight?: number; // px
  onChange?: (key: string, value: string | number | boolean | null) => void;
  onEdit?: (field: string, value: string | number | boolean | null) => void;
  changedFields?: string[]; // Fields that were changed by auto-coding
  fieldSources?: Record<string, string>; // Field name -> "CV" | "GIS"
  readOnly?: boolean; // If true, disable editing (display-only mode)
  headerAction?: React.ReactNode; // Optional action/toggle to display next to "Attributes" heading
  highlightMessage?: string; // Custom message for changed attributes
  highlightColor?: "green" | "yellow";
  flex?: number | string;
  onEditOptions?: (fieldName: string) => void;
  activeGroupTab?: string | null;
  /** "v1" (default) = current Chakra layout; "v2" = Home.dc.html FRAME 4 attribute design. */
  variant?: "v1" | "v2";
};

/** ====== Group ordering (tab order) ====== */
const GROUP_ORDER = [
  "Facility configuration",
  "Facility clear width",
  "Facility surface conditions",
  "Intersection",
  "Flow & Speed",
] as const;

const OPTIONAL_FIELDS_HIDE_WHEN_EMPTY = new Set(["Gradient Status"]);

const normalizeLookupToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** ====== Display fields under each group (keep your original order) ====== */
const GROUP_RULES: Record<(typeof GROUP_ORDER)[number], string[]> = {
  "Facility configuration": [
    "Area type",
    "Facility type",
    "Adjacent sidewalk 0-1m",
    "Adjacent sidewalk 1-3m",
    "Adjacent road lane 0-1m",
    "Adjacent road lane 1-3m",
    "Adjacent vehicle parking 0-1m",
    "Adjacent vehicle parking 1-3m",
    "Adjacent object or level change 0-1m",
    "Adjacent object or level change 1-3m",
  ],
  "Flow & Speed": [
    "Flow direction",
    "Peak pedestrian flow along or across",
    "Peak bicycle/LV traffic flow",
    "Obs proportion of cargo bikes",
    "Heavy vehicle flow",
    "Bicycle/LV speed average",
    "Bicycle/LV speed differential",
    "Road AADT",
    "Road Operating speed (mean)",
    "Road Operating speed (unit)",
    "Road speed limit",
  ],
  "Facility clear width": [
    "Facility Access",
    "Light segregation",
    "Fixed obstacle on facility",
    "Non-fixed obstacle on facility",
    "Facility width",
    "Width restrictions",
    "Adjacent severe hazard 0-1m",
    "Adjacent severe hazard 1-3m",
    "Line of Sight",
  ],
  "Facility surface conditions": [
    "Delineation",
    "Major surface road deformation",
    "Loose or slippery surface",
    "Grade",
    "Gradient status",
    "Curvature",
    "Tram or train rails",
    "Street lighting",
  ],
  "Intersection": [
    "Intersection approach",
    "Intersection or road crossing",
    "Crossing facility",
    "Property access",
    "Pedestrian crossing",
    "Intersecting bicycle facility",
    "Number of lanes – adjacent road",
    "Number of lanes – intersecting road",
  ],
};

/** ====== Aliases: display name -> real key in row ====== */
const KEY_ALIASES: Record<string, string> = {
  // Facility configuration
  "Area type": "Area type",
  "Facility type": "Facility Type",
  "Adjacent sidewalk 0-1m": "Adjacent Sidewalk 0-1m",
  "Adjacent sidewalk 1-3m": "Adjacent Sidewalk 1-3m",
  "Adjacent road lane 0-1m": "Adjacent Road Lane 0-1m",
  "Adjacent road lane 1-3m": "Adjacent Road Lane 1-3m",
  "Adjacent vehicle parking 0-1m": "Adjacent Vehicle Parking 0-1m",
  "Adjacent vehicle parking 1-3m": "Adjacent Vehicle Parking 1-3m",
  "Adjacent object or level change 0-1m": "Adjacent object or level change 0-1m",
  "Adjacent object or level change 1-3m": "Adjacent object or level change 1-3m",

  // Flow & Speed
  "Flow direction": "Flow Direction",
  "Peak pedestrian flow along or across": "Peak pedestrian flow along or across facility",
  "Peak bicycle/LV traffic flow": "Peak bicycle/LV traffic flow",
  "Obs proportion of cargo bikes": "Observed proportion of cargo bikes and mopeds",
  "Heavy vehicle flow": "Heavy vehicle flow",
  "Bicycle/LV speed average": "Bicycle/LV speed – average",
  "Bicycle/LV speed differential": "Bicycle/LV speed differential",
  "Road AADT": "Road AADT",
  "Road Operating speed (mean)": "Road operating speed (mean)",
  "Road Operating speed (unit)": "Road operating speed (unit)",
  "Road speed limit": "Road speed limit",

  // Facility clear width
  "Facility Access": "Facility access",
  "Line of Sight": "Line of Sight",
  "Fixed obstacle on facility": "Fixed Obstacle on Facility",
  "Non-fixed obstacle on facility": "Non-Fixed Obstacle on Facility",
  "Facility width": "Facility Width per Direction",
  "Width restrictions": "Width Restriction",
  "Light segregation": "Light Segregation",
  "Adjacent severe hazard 0-1m": "Adjacent Severe Hazard 0-1m",
  "Adjacent severe hazard 1-3m": "Adjacent Severe Hazard 1-3m",

  // Facility surface conditions
  "Delineation": "Delineation",
  "Major surface road deformation": "Major Surface Deformation or Drain Opening",
  "Loose or slippery surface": "Loose or slippery surface",
  "Grade": "Grade",
  "Gradient status": "Gradient Status",
  "Curvature": "Curvature",
  "Tram or train rails": "Tram or Train Rails",
  "Street lighting": "Street Lighting",

  // Intersection
  "Intersection approach": "Intersection Approach",
  "Intersection or road crossing": "Intersection or Road Crossing",
  "Crossing facility": "Crossing Facility",
  "Property access": "Property Access",
  "Pedestrian crossing": "Pedestrian Crossing",
  "Intersecting bicycle facility": "Intersecting Bicycle Facility",
  "Number of lanes – adjacent road": "Number of lanes – adjacent road",
  "Number of lanes – intersecting road": "Number of lanes – intersecting road",
};

const CONTRIBUTOR_GROUP_INDEX: Record<string, (typeof GROUP_ORDER)[number]> = (() => {
  const index: Record<string, (typeof GROUP_ORDER)[number]> = {};
  for (const group of GROUP_ORDER) {
    for (const displayName of GROUP_RULES[group]) {
      const realKey = KEY_ALIASES[displayName] ?? displayName;
      index[normalizeLookupToken(displayName)] = group;
      index[normalizeLookupToken(realKey)] = group;
    }
  }
  return index;
})();

export function resolveContributorTabGroup(contributorName: string): string | null {
  const normalized = normalizeLookupToken(String(contributorName || ""));
  if (!normalized) {
    return null;
  }

  const direct = CONTRIBUTOR_GROUP_INDEX[normalized];
  if (direct) {
    return direct;
  }

  let bestMatch: { group: (typeof GROUP_ORDER)[number]; tokenLength: number } | null = null;
  for (const [token, group] of Object.entries(CONTRIBUTOR_GROUP_INDEX)) {
    if (normalized.includes(token) || token.includes(normalized)) {
      if (!bestMatch || token.length > bestMatch.tokenLength) {
        bestMatch = { group, tokenLength: token.length };
      }
    }
  }
  return bestMatch?.group ?? null;
}

/** ====== Utils ====== */
function groupEntries(row: AttributeRow) {
  // Build a copy of the row that includes any missing fields defined in GROUP_RULES
  // (so new attributes like "Line of Sight" appear even for old project CSVs)
  const rowWithDefaults: AttributeRow = { ...row };
  for (const group of GROUP_ORDER) {
    for (const displayName of GROUP_RULES[group]) {
      const realKey = KEY_ALIASES[displayName] ?? displayName;
      if (!(realKey in rowWithDefaults) && !OPTIONAL_FIELDS_HIDE_WHEN_EMPTY.has(realKey)) {
        rowWithDefaults[realKey] = null;
      }
    }
  }

  const allEntries = Object.entries(rowWithDefaults) as [string, unknown][];

  // reverse index: real key -> group & order
  const keyToGroup: Record<string, { group: string; order: number }> = {};
  for (const group of GROUP_ORDER) {
    const list = GROUP_RULES[group];
    list.forEach((displayName, i) => {
      const key = KEY_ALIASES[displayName] ?? displayName;
      keyToGroup[key] = { group, order: i };
    });
  }

  const grouped: Record<string, Array<[string, unknown]>> = Object.fromEntries(
    GROUP_ORDER.map((g) => [g, []]),
  );

  for (const [k, v] of allEntries) {
    const hit = keyToGroup[k];
    if (hit) {
      if (OPTIONAL_FIELDS_HIDE_WHEN_EMPTY.has(k) && (v === null || v === undefined || v === "")) {
        continue;
      }
      grouped[hit.group].push([k, v]);
    }
  }

  // keep original order as in GROUP_RULES
  for (const g of GROUP_ORDER) {
    grouped[g].sort((a, b) => {
      const oa = keyToGroup[a[0]]?.order ?? 1e9;
      const ob = keyToGroup[b[0]]?.order ?? 1e9;
      return oa - ob;
    });
  }

  return grouped;
}

const toDisplayString = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
};

/** ====== Component ====== */
export default function AttributesPanel({
  row,
  originalRow,
  mappings = {},
  panelHeight = 420,
  onChange,
  onEdit,
  changedFields = [],
  fieldSources = {},
  readOnly = false,
  headerAction,
  highlightMessage = "*Highlighted attributes have been modified from the original values",
  highlightColor = "green",
  flex,
  activeGroupTab,
  projectName, // Passed from parent
  onEditOptions,
  variant = "v1",
}: Props & { projectName?: string }) {
  const [detecting, setDetecting] = useState(false);

  const isYellow = highlightColor === "yellow";
  const changedBg = isYellow ? "yellow.50" : "green.100";
  const changedBorder = isYellow ? "yellow.500" : "green.500";
  const changedText = isYellow ? { base: "yellow.900", _dark: "black" } : { base: "green.900", _dark: "green.900" };
  const changedInputBg = isYellow ? "#FFFFF0" : "#F0FFF4"; // yellow.50 vs green.50 (approx)
  const changedInputBorder = isYellow ? "#D69E2E" : "#38A169"; // yellow.500 vs green.500

  const grouped = useMemo(() => (row ? groupEntries(row) : null), [row]);

  // Create a Set for fast lookup of changed fields
  const changedFieldsSet = useMemo(() => new Set(changedFields), [changedFields]);

  // Check if a field value differs from the original autocode value
  const isManuallyEdited = (key: string, currentValue: any): boolean => {
    if (!originalRow) return false;
    const originalValue = originalRow[key];

    // Handle null/undefined as equivalent
    if (currentValue === null || currentValue === undefined) {
      return originalValue !== null && originalValue !== undefined;
    }
    if (originalValue === null || originalValue === undefined) {
      return currentValue !== null && currentValue !== undefined;
    }

    // Strict comparison first (same type, same value)
    if (currentValue === originalValue) {
      return false;
    }

    // Type-aware comparison for numeric values
    // If one is a number and one is a string, try numeric comparison
    if (typeof currentValue === 'number' && typeof originalValue === 'string') {
      const parsedOriginal = Number(originalValue);
      if (!Number.isNaN(parsedOriginal) && currentValue === parsedOriginal) {
        return false;
      }
    }
    if (typeof currentValue === 'string' && typeof originalValue === 'number') {
      const parsedCurrent = Number(currentValue);
      if (!Number.isNaN(parsedCurrent) && parsedCurrent === originalValue) {
        return false;
      }
    }

    // If we get here, values are genuinely different
    return true;
  };

  // collect groups with fields (for tabs)
  const groupsWithFields = useMemo(() => {
    if (!grouped) return [];
    return GROUP_ORDER.filter((g) => (grouped[g] ?? []).length > 0);
  }, [grouped]);

  const defaultTab = groupsWithFields[0] ?? "Facility configuration";
  const [selectedTab, setSelectedTab] = useState(defaultTab);

  useEffect(() => {
    if (groupsWithFields.length === 0) {
      return;
    }
    if (!groupsWithFields.includes(selectedTab as any)) {
      setSelectedTab(defaultTab);
    }
  }, [groupsWithFields, selectedTab, defaultTab]);

  // Keep a ref so the effect below can read the latest groupsWithFields without
  // making it a trigger — otherwise every row change (new object reference) would
  // re-apply activeGroupTab and jump the tab on every attribute edit.
  const groupsWithFieldsRef = useRef(groupsWithFields);
  groupsWithFieldsRef.current = groupsWithFields;

  useEffect(() => {
    if (activeGroupTab && groupsWithFieldsRef.current.includes(activeGroupTab as any)) {
      setSelectedTab(activeGroupTab as any);
    }
  }, [activeGroupTab]);

  // Check if any fields have been changed (for showing the info text)
  const hasChangedFields = changedFieldsSet.size > 0;

  // ── v2 render — Home.dc.html FRAME 4 attribute design (tabs §6 + inline
  // value fields §9). Reuses the same grouping/edit logic as v1; only the
  // presentation differs. ──
  if (variant === "v2") {
    const v2Fields = grouped ? (grouped[selectedTab] ?? []) : [];
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, flex: typeof flex === "number" ? flex : undefined }}>
        {/* attribute category tabs (§6) */}
        <div style={{ display: "flex", alignItems: "flex-end", overflowX: "auto", overflowY: "hidden", flexShrink: 0, scrollbarWidth: "none" }}>
          {groupsWithFields.map((g) => {
            const active = selectedTab === g;
            return (
              <div
                key={g}
                onClick={() => setSelectedTab(g as any)}
                style={{ padding: "8px 13px", lineHeight: 1, boxSizing: "border-box", fontFamily: FONT, fontWeight: 700, fontSize: 16, cursor: "pointer", whiteSpace: "nowrap", borderRadius: "6px 6px 0 0", border: `1px solid ${COLOR.border}`, borderBottom: active ? "none" : `1px solid ${COLOR.border}`, marginBottom: active ? -1 : 0, background: active ? COLOR.white : COLOR.gray100, color: active ? COLOR.text : COLOR.gray500 }}
              >
                {V2_GROUP_TAB_LABELS[g] ?? g}
              </div>
            );
          })}
        </div>
        {/* card body */}
        <div style={{ flex: 1, minHeight: 0, border: `1px solid ${COLOR.border}`, borderRadius: "0 6px 6px 6px", background: COLOR.white, padding: 12, marginTop: -1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!row || v2Fields.length === 0 ? (
            <div style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500, padding: 8 }}>No attributes</div>
          ) : (
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 18px", overflowY: "auto", alignContent: "start" }}>
              {v2Fields.map(([k, v]) => {
                const dict = mappings[k];
                const strVal = toDisplayString(v);
                const isChanged = changedFieldsSet.has(k);
                const isEdited = isManuallyEdited(k, v);
                const childField = PARENT_TO_CHILD_FIELD[k];
                const parentKey = childField ? CHILD_REQUIRES_PARENT_PRESENT[childField] : undefined;
                const showPencil = !!childField && !!onEditOptions && !(parentKey && Number(row[parentKey]) !== 1);
                // Whole-cell highlight (rounded), matching the v1 "old style": red =
                // manual edit, yellow = autocoded change (green when highlightColor="green",
                // e.g. Treatment). The inner value box is tinted to match (not left white),
                // and an autocoded field's title is tagged with its source — (CV) or (GIS).
                const hl = isEdited
                  ? { bg: "#FFF5F5", border: "#E53E3E" }
                  : isChanged
                    ? (highlightColor === "green" ? { bg: "#F0FFF4", border: "#38A169" } : { bg: "#FFFFF0", border: "#D69E2E" })
                    : null;
                const boxBg = hl ? hl.bg : COLOR.white;
                const boxBorder = hl ? hl.border : COLOR.border;
                const source = fieldSources[k]; // "CV" | "GIS" | undefined
                // The attribute title is its own tooltip trigger (no separate (i) icon).
                // An autocoded field appends its source tag — (CV)/(GIS) — in regular
                // weight, coloured to match the highlight border (e.g. the deeper yellow).
                const titleNode = (
                  <Box as="span" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: FONT, fontWeight: 700, fontSize: 16, color: isEdited ? "#C53030" : COLOR.text, cursor: ATTRIBUTE_TOOLTIPS[k] ? "help" : "default" }}>
                    {k}
                    {isChanged && source && (
                      <span style={{ fontWeight: 400, color: hl?.border ?? COLOR.gray500 }}> ({source})</span>
                    )}
                  </Box>
                );
                return (
                  <div key={k} style={{ borderWidth: 2, borderStyle: "solid", borderColor: hl ? hl.border : "transparent", background: hl ? hl.bg : "transparent", borderRadius: 6, padding: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 6 }}>
                      <Box minW={0} flex={1}>
                        {ATTRIBUTE_TOOLTIPS[k] ? (
                          <Tooltip content={ATTRIBUTE_TOOLTIPS[k]} showArrow portalled openDelay={100} closeOnClick={false} contentProps={{ maxW: "280px", fontSize: "xs" }}>
                            {titleNode}
                          </Tooltip>
                        ) : titleNode}
                      </Box>
                      {showPencil && (
                        <button className="attr-edit-btn" onClick={(e) => { e.stopPropagation(); onEditOptions!(childField!); }} aria-label={`Edit options for ${childField}`}>
                          <LuPencil className="attr-edit-icon" />
                        </button>
                      )}
                    </div>
                    {dict ? (
                      <div style={{ position: "relative", border: `1px solid ${boxBorder}`, borderRadius: 6, background: boxBg }}>
                        <select
                          value={strVal}
                          disabled={readOnly}
                          onChange={(e) => {
                            let val: string | number | boolean | null = e.target.value === "" ? null : e.target.value;
                            if (val !== null && originalRow) {
                              const ov = originalRow[k];
                              if (typeof ov === "number" && typeof val === "string" && !Number.isNaN(Number(val))) val = Number(val);
                            }
                            onChange?.(k, val);
                            onEdit?.(k, val);
                          }}
                          style={{ width: "100%", appearance: "none", WebkitAppearance: "none", border: "none", outline: "none", background: "transparent", padding: "6px 26px 6px 9px", fontFamily: FONT, fontSize: 16, color: COLOR.text, cursor: readOnly ? "default" : "pointer" }}
                        >
                          {k !== "Road speed limit" && !dict[strVal] && strVal !== "" && (
                            <option value={strVal}>{`(Unknown) ${strVal}`}</option>
                          )}
                          {k === "Road speed limit" && dict
                            ? ["NA", "0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100", "110", "120"]
                                .map((code) => { const label = dict[code]; return label ? <option key={code} value={code}>{label}</option> : null; })
                                .filter(Boolean)
                            : Object.entries(dict || {}).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                        </select>
                        <svg width="9" height="6" viewBox="0 0 10 6" fill="none" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                          <path d="M1 1l4 4 4-4" stroke="#718096" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    ) : (
                      <input
                        value={strVal}
                        disabled={readOnly}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const num = Number(raw);
                          const val = raw !== "" && Number.isFinite(num) && /^\d+(\.\d+)?$/.test(raw) ? num : raw === "" ? null : raw;
                          onChange?.(k, val);
                          onEdit?.(k, val);
                        }}
                        style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${boxBorder}`, borderRadius: 6, background: boxBg, padding: "6px 9px", fontFamily: FONT, fontSize: 16, color: COLOR.text, outline: "none" }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <Card.Root h={`${panelHeight}px`} display="flex" flexDirection="column">
        <Card.Header display="flex" flexDirection="row" justifyContent="space-between" alignItems="center" gap="2">
          <Heading size="sm" flex="0 0 auto">Attributes</Heading>
          {headerAction}
        </Card.Header>
        <Card.Body>
          <Text color="gray.500">No attributes</Text>
        </Card.Body>
      </Card.Root>
    );
  }

  return (
    <Card.Root minH={`${panelHeight}px`} display="flex" flexDirection="column" flex={flex}>
      <Card.Header display="flex" flexDirection="row" justifyContent="space-between" alignItems="center" gap="2">
        <Box display="flex" flexDirection="row" alignItems="center" gap="4">
          <Box display="flex" flexDirection="row" alignItems="baseline" gap="2">
            <Heading size="sm" flex="0 0 auto">Attributes</Heading>
            {hasChangedFields && (
              <Text
                fontSize="xs"
                color="gray.600"
                transition="opacity 0.3s"
              >
                {highlightMessage}
              </Text>
            )}
          </Box>

          {row && row.geometry && projectName && (
            <Button
              size="xs"
              variant="surface"
              colorPalette="blue"
              loading={detecting}
              onClick={async () => {
                try {
                  setDetecting(true);
                  const coords = (row.geometry as any).coordinates[0];
                  const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/gis/detect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ point: coords })
                  });
                  const data = await res.json();
                  if (data.ok) {
                    const r = data.results;
                    let summary = [];
                    if (r.bus_stop.found) summary.push(`Bus Stop is ${r.bus_stop.distance}m away`);
                    if (r.bus_lane.found) summary.push(`Bus Lane is ${r.bus_lane.distance}m away`);

                    if (summary.length > 0) {
                      toaster.create({ title: "Nearby GIS Detected", description: summary.join(". "), type: "success" });
                    } else {
                      toaster.create({ title: "No Infrastructure Found", description: "None within 200m.", type: "info" });
                    }
                  }
                } catch (e) {
                  toaster.create({ title: "Detection Failed", type: "error" });
                } finally {
                  setDetecting(false);
                }
              }}
            >
              <FaSyncAlt /> Detect Nearby GIS
            </Button>
          )}
        </Box>
        {headerAction}
      </Card.Header>

      {/* Tabs occupy the body; content area scrolls independently */}
      <Card.Body display="flex" flexDir="column" minH={0} p="0">
        <Tabs.Root value={selectedTab} onValueChange={(e) => setSelectedTab(e.value as any)}>
          <Tabs.List
            px="2"
            py="2"
            flexWrap="nowrap"
            overflowX="auto"
            whiteSpace="nowrap"
            gap="1"
            css={{
              "&::-webkit-scrollbar": { display: "none" },
              scrollbarWidth: "none",
            }}
          >
            {groupsWithFields.map((g) => (
              <Tabs.Trigger key={g} value={g} flexShrink={0}>
                {g}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {/* A separator under the tab list for subtle structure */}
          <Separator />

          {groupsWithFields.map((groupName, gi) => {
            const fields = grouped![groupName] ?? [];
            return (
              <Tabs.Content key={groupName} value={groupName}>
                {/* Content area expands naturally */}
                <Box px="4" py="3">

                  {/* Responsive grid: 1 col on small, 2 cols on md+ */}
                  <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
                    {fields.map(([k, v]) => {
                      const dict = mappings[k];
                      const strVal: string = toDisplayString(v);
                      const isChanged = changedFieldsSet.has(k);
                      const isEdited = isManuallyEdited(k, v);
                      const source = fieldSources[k]; // "CV" | "GIS" | undefined

                      return (
                        <Box
                          key={k}
                          display="flex"
                          flexDirection="column"
                          gap="1"
                          p="2"
                          borderRadius="md"
                          bg={isEdited ? "red.50" : isChanged ? changedBg : "transparent"}
                          borderWidth={isEdited || isChanged ? "2px" : "0px"}
                          borderColor={isEdited ? "red.200" : isChanged ? changedBorder : "transparent"}
                          transition="all 0.2s"
                        >
                          <Box display="flex" alignItems="center" justifyContent="space-between" gap="1">
                            <Flex align="center" gap={1}>
                              <Text
                                fontSize="xs"
                                color={isEdited ? "red.800" : isChanged ? changedText : "gray.600"}
                                fontWeight={isEdited || isChanged ? "bold" : "semibold"}
                              >
                                {k}
                                {isChanged && source && ` ✨ (${source})`}
                                {isEdited && (
                                  <Text as="span" color="red.600" fontWeight="bold" ml="1">
                                    (Manual Edit Done)
                                  </Text>
                                )}
                              </Text>
                              {ATTRIBUTE_TOOLTIPS[k] && (
                                <Tooltip
                                  content={ATTRIBUTE_TOOLTIPS[k]}
                                  showArrow
                                  portalled
                                  openDelay={100}
                                  closeOnClick={false}
                                  contentProps={{ maxW: "280px", fontSize: "xs" }}
                                >
                                  <Box
                                    as="span"
                                    color="gray.400"
                                    cursor="default"
                                    lineHeight={1}
                                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                  >
                                    <LuInfo size={12} />
                                  </Box>
                                </Tooltip>
                              )}
                            </Flex>
                            {PARENT_TO_CHILD_FIELD[k] && onEditOptions && (() => {
                              const childField = PARENT_TO_CHILD_FIELD[k];
                              const parentKey = CHILD_REQUIRES_PARENT_PRESENT[childField];
                              // Hide pencil for FO/NFO Type when parent is Not Present (value 2)
                              if (parentKey && Number(row[parentKey]) !== 1) return null;
                              return (
                                <button
                                  className="attr-edit-btn"
                                  onClick={(e) => { e.stopPropagation(); onEditOptions(childField); }}
                                  aria-label={`Edit options for ${childField}`}
                                >
                                  <LuPencil className="attr-edit-icon" />
                                </button>
                              );
                            })()}
                          </Box>

                          {dict ? (
                            <NativeSelect.Root size="sm" width="100%" mt="auto" disabled={readOnly}>
                              <NativeSelect.Field
                                value={strVal}
                                onChange={(e) => {
                                  let val: string | number | boolean | null = e.target.value === "" ? null : e.target.value;

                                  // Convert to original value's type if needed
                                  if (val !== null && originalRow) {
                                    const originalValue = originalRow[k];
                                    // If original was a number, convert the string to a number
                                    if (typeof originalValue === 'number' && typeof val === 'string' && !Number.isNaN(Number(val))) {
                                      val = Number(val);
                                    }
                                  }

                                  onChange?.(k, val);
                                  onEdit?.(k, val);
                                }}
                                style={{
                                  borderColor: isEdited ? "#E53E3E" : isChanged ? changedInputBorder : undefined,
                                  borderWidth: isEdited || isChanged ? "2px" : undefined,
                                  backgroundColor: isEdited ? "#FFF5F5" : isChanged ? changedInputBg : undefined,
                                }}
                                color={isEdited || isChanged ? "gray.900" : undefined}
                                _dark={{
                                  color: isEdited || isChanged ? "gray.900" : undefined,
                                }}
                              >
                                {/* Preserve unknown code if present (except for Road speed limit) */}
                                {k !== "Road speed limit" && !dict[strVal] && strVal !== "" && (
                                  <option value={strVal}>{`(Unknown) ${strVal}`}</option>
                                )}
                                {
                                  k === "Road speed limit" && dict
                                    ? ['NA', '0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100', '110', '120']
                                      .map(code => {
                                        const label = dict[code];
                                        return label ? (
                                          <option key={code} value={code}>
                                            {label}
                                          </option>
                                        ) : null;
                                      })
                                      .filter(Boolean)
                                    : Object.entries(dict || {}).map(([code, label]) => (
                                      <option key={code} value={code}>
                                        {label}
                                      </option>
                                    ))
                                }
                              </NativeSelect.Field>
                              <NativeSelect.Indicator />
                            </NativeSelect.Root>
                          ) : (
                            <Input
                              size="sm"
                              value={strVal}
                              disabled={readOnly}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const num = Number(raw);
                                const val =
                                  raw !== "" &&
                                    Number.isFinite(num) &&
                                    /^\d+(\.\d+)?$/.test(raw)
                                    ? num
                                    : raw === ""
                                      ? null
                                      : raw;
                                onChange?.(k, val);
                                onEdit?.(k, val);
                              }}
                              borderColor={isEdited ? "red.500" : isChanged ? changedBorder : undefined}
                              borderWidth={isEdited || isChanged ? "2px" : undefined}
                              bg={isEdited ? "red.50" : isChanged ? changedBg : undefined}
                              color={isEdited || isChanged ? "gray.900" : undefined}
                              _dark={{
                                color: isEdited || isChanged ? "gray.900" : undefined,
                              }}
                              _focus={{
                                borderColor: isEdited ? "red.600" : isChanged ? "yellow.600" : "blue.500",
                                boxShadow: isEdited ? "0 0 0 1px var(--chakra-colors-red-600)" : isChanged ? "0 0 0 1px var(--chakra-colors-yellow-600)" : undefined,
                              }}
                            />
                          )}
                        </Box>
                      );
                    })}
                  </SimpleGrid>

                  {/* Subtle spacing and separator before next tab content */}
                  {gi !== groupsWithFields.length - 1 && <Box h="3" />}
                </Box>
              </Tabs.Content>
            );
          })}
        </Tabs.Root>
      </Card.Body>
    </Card.Root>
  );
}
