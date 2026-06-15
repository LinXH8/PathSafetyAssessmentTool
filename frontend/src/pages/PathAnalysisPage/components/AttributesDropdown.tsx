import { useState } from "react";
import {
  Box,
  Text,
  createListCollection,
  Button,
  Flex,
  Combobox,
  Portal,
} from "@chakra-ui/react";
import "./AttributesDropdown.css";

// Helper function to render grouped attributes with headers
function renderGroupedAttributes(items: any[]) {
  const groupedItems: Record<string, any[]> = {
    "Not Selected": [],
    "Project": [],
    "Safety Risk Level": [],
    "Facility configuration": [],
    "Facility clear width": [],
    "Facility surface conditions": [],
    "Intersection": [],
    "Flow & Speed": [],
  };

  // Group items - only include valid items
  items.forEach((item) => {
    if (!item || !item.value) return; // Skip invalid items

    if (item.value === "Not Selected" || item.value === "Project") {
      groupedItems[item.value].push(item);
    } else if (item.group) {
      if (!groupedItems[item.group]) {
        groupedItems[item.group] = [];
      }
      groupedItems[item.group].push(item);
    }
  });

  const groupOrder = [
    "Not Selected",
    "Project",
    "Safety Risk Level",
    "Facility configuration",
    "Facility clear width",
    "Facility surface conditions",
    "Intersection",
    "Flow & Speed",
  ];

  return (
    <>
      {groupOrder.map((groupName, groupIndex) => {
        const groupItems = groupedItems[groupName] || [];
        if (groupItems.length === 0) return null;

        return (
          <Box key={`group-${groupName}-${groupIndex}`}>
            {/* Divider before group header (except for first group) */}
            {groupIndex > 0 && (
              <Box
                borderTop="1px solid"
                borderColor="gray.200"
                _dark={{ borderColor: "gray.700" }}
                my="1"
              />
            )}

            {/* Group header - only show for non-special items */}
            {groupName !== "Not Selected" && groupName !== "Project" && (
              <Text
                px="3"
                py="2"
                fontSize="xs"
                fontWeight="bold"
                color="gray.700"
                textTransform="uppercase"
                letterSpacing="1px"
                bg="gray.100"
                _dark={{ color: "gray.200", bg: "gray.700" }}
              >
                {groupName}
              </Text>
            )}
            {/* Group items */}
            {groupItems.map((item: any) => {
              if (!item || !item.value) return null;
              return (
                <Combobox.Item item={item} key={item.value}>
                  <Flex align="center" gap="2" width="100%">
                    <Text flex="1">{item.label}</Text>
                  </Flex>
                  <Combobox.ItemIndicator />
                </Combobox.Item>
              );
            })}
          </Box>
        );
      })}
    </>
  );
}

// CycleRAP Attributes with their specific possible values
interface AttributeConfig {
  name: string;       // exact backend field name — used as data lookup key
  label?: string;     // display name — shown in UI if different from name
  options: string[];
  group: string;
  type?: "numeric";
}

/** Attribute names that store raw numeric values and use range-slider filtering. */
export const NUMERIC_FILTER_ATTRIBUTES = new Set<string>([
  "Road AADT",
  "Road operating speed (mean)",
]);

/**
 * Display labels for attributes whose field name differs from the desired display name.
 * Keys are exact backend field names; values are the desired UI labels.
 */
export const ATTRIBUTE_LABELS: Record<string, string> = {
  "Area type":                "Area Type",
  "Facility access":          "Facility Access",
  "Loose or slippery surface": "Loose or Slippery Surface",
  "Tram or Train Rails":       "Tram or Train Rails",
  "FO Type":                   "Fixed Obstacle Type",
  "NFO Type":                  "Non-Fixed Obstacle Type",
  "Crossing Type":             "Crossing Type",
  "Facility Width per Direction": "Facility Width",
};

/**
 * All selectable option values per attribute (excluding "Not Selected").
 * Used so the filter panel always shows all possible options, even if the
 * current dataset doesn't contain every value.
 * Built lazily after cyclerapAttributes is defined — see bottom of file.
 */
export let ATTRIBUTE_OPTIONS: Record<string, string[]> = {};

// Safety Risk Level Crash Types
interface SafetyScoreConfig {
  name: string;
  displayName?: string;
  options: string[];
  group: string;
}

export const safetyScoreAttributes: SafetyScoreConfig[] = [
  {
    name: "Overall Risk Level",
    displayName: "Overall Risk Level",
    group: "Safety Risk Level",
    options: ["Not Selected", "Low", "Medium", "High", "Extreme"],
  },
  {
    name: "VB Band",
    displayName: "Vehicle-Bicycle (VB)",
    group: "Safety Risk Level",
    options: ["Not Selected", "Low", "Medium", "High", "Extreme"],
  },
  {
    name: "BB Band",
    displayName: "Bicycle-Bicycle (BB)",
    group: "Safety Risk Level",
    options: ["Not Selected", "Low", "Medium", "High", "Extreme"],
  },
  {
    name: "SB Band",
    displayName: "Single-Bicycle (SB)",
    group: "Safety Risk Level",
    options: ["Not Selected", "Low", "Medium", "High", "Extreme"],
  },
  {
    name: "BP Band",
    displayName: "Bicycle-Pedestrian (BP)",
    group: "Safety Risk Level",
    options: ["Not Selected", "Low", "Medium", "High", "Extreme"],
  },
];

const cyclerapAttributes: AttributeConfig[] = [
  // Facility configuration group
  {
    name: "Area type",
    label: "Area Type",
    group: "Facility configuration",
    options: ["Not Selected", "Urban", "Suburban", "Rural", "Industrial", "Recreational"],
  },
  {
    name: "Facility Type",
    group: "Facility configuration",
    options: ["Not Selected", "Sidewalk", "Multi-Use Path", "Off-Road Bicycle Path", "On-road Bicycle Lane", "Road Shoulder", "Mixed Traffic Road Lane"]
  },
  {
    name: "Facility access",
    label: "Facility Access",
    group: "Facility configuration",
    options: ["Not Selected", "Adequate", "Inadequate"]
  },
  {
    name: "Adjacent Sidewalk 0-1m",
    group: "Facility configuration",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Adjacent Road Lane 0-1m",
    group: "Facility configuration",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Adjacent Vehicle Parking 0-1m",
    group: "Facility configuration",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Adjacent Severe Hazard 0-1m",
    group: "Facility configuration",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Adjacent object or level change 0-1m",
    group: "Facility configuration",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Adjacent Road Lane 1-3m",
    group: "Facility configuration",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Adjacent Vehicle Parking 1-3m",
    group: "Facility configuration",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Adjacent Severe Hazard 1-3m",
    group: "Facility configuration",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Adjacent object or level change 1-3m",
    group: "Facility configuration",
    options: ["Not Selected", "Present", "Not Present"]
  },

  // Flow & Speed group
  {
    name: "Flow Direction",
    group: "Flow & Speed",
    options: ["Not Selected", "One Way", "Two Way"]
  },
  {
    name: "Peak pedestrian flow along or across facility",
    group: "Flow & Speed",
    options: ["Not Selected", "None", "Low", "Moderate to high"]
  },
  {
    name: "Peak bicycle/LV traffic flow",
    group: "Flow & Speed",
    options: ["Not Selected", "Low", "Moderate to high"]
  },
  {
    name: "Observed proportion of cargo bikes and mopeds",
    group: "Flow & Speed",
    options: ["Not Selected", "Low", "Moderate to high"]
  },
  {
    name: "Heavy vehicle flow",
    group: "Flow & Speed",
    options: ["Not Selected", "Low", "Moderate to high"]
  },
  {
    name: "Bicycle/LV speed – average",
    group: "Flow & Speed",
    options: ["Not Selected", "< 20km/h", "=/> 20km/h"]
  },
  {
    name: "Bicycle/LV speed differential",
    group: "Flow & Speed",
    options: ["Not Selected", "< 10km/h", "=/> 10km/h"]
  },
  {
    name: "Road speed limit",
    group: "Flow & Speed",
    options: ["Not Selected", "NA", "30 km/h", "40 km/h", "50 km/h", "60 km/h", "70 km/h", "80 km/h", "90 km/h"],
  },
  {
    name: "Road AADT",
    group: "Flow & Speed",
    options: [],
    type: "numeric",
  },
  {
    name: "Road operating speed (mean)",
    group: "Flow & Speed",
    options: [],
    type: "numeric",
  },

  // Facility clear width group
  {
    name: "Line of Sight",
    group: "Facility clear width",
    options: ["Not Selected", "Adequate", "Inadequate"]
  },
  {
    name: "Facility Width per Direction",
    group: "Facility clear width",
    options: ["Not Selected", "Very Narrow", "Narrow", "Wide"]
  },
  {
    name: "Fixed Obstacle on Facility",
    group: "Facility clear width",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "FO Type",
    label: "Fixed Obstacle Type",
    group: "Facility clear width",
    options: ["Not Selected", "Lamp Post", "Traffic Light", "Pillar", "Bollards", "Billboards", "Sign Poles", "Fence", "Vegetation", "Others"],
  },
  {
    name: "Non-Fixed Obstacle on Facility",
    group: "Facility clear width",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "NFO Type",
    label: "Non-Fixed Obstacle Type",
    group: "Facility clear width",
    options: ["Not Selected", "Barrier", "Bins", "Bicycle", "Cone", "Others"],
  },
  {
    name: "Width Restriction",
    group: "Facility clear width",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Light Segregation",
    group: "Facility clear width",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Facility Width Sub-category",
    label: "Facility Width Sub-category",
    group: "Facility clear width",
    options: ["Not Selected", "\u22641.5m", ">1.5\u20131.8m", ">1.8\u2013<2m", "2\u2013<3.5m", "3.5\u20134m", ">4m"],
  },

  // Facility surface conditions group
  {
    name: "Delineation",
    group: "Facility surface conditions",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Delineation Type",
    label: "Delineation Type",
    group: "Facility surface conditions",
    options: ["Not Selected", "Cycling Path", "Red Stripe", "Signalised Crossing", "Zebra Crossing"],
  },
  {
    name: "Loose or slippery surface",
    label: "Loose or Slippery Surface",
    group: "Facility surface conditions",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Tram or Train Rails",
    group: "Facility surface conditions",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Major Surface Deformation or Drain Opening",
    group: "Facility surface conditions",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Grade",
    group: "Facility surface conditions",
    options: ["Not Selected", "<=2% (1:25)", "2.9% (1:20)", "3.8% (1:15)", "4.7% (1:12)", ">=5%"]
  },
  {
    name: "Curvature",
    group: "Facility surface conditions",
    options: ["Not Selected", "Sharp Turn Present", "No Sharp Turn Present"]
  },
  {
    name: "Curvature Sub-category",
    label: "Curvature Sub-category",
    group: "Facility surface conditions",
    options: ["Not Selected", "<6.5m", "6.5\u2013<10m", "10\u201318m", ">18m"],
  },
  {
    name: "Street Lighting",
    group: "Facility surface conditions",
    options: ["Not Selected", "Present", "Not Present"]
  },

  // Intersection group
  {
    name: "Intersection Approach",
    group: "Intersection",
    options: ["Not Selected", "Shared", "Separate/NA"]
  },
  {
    name: "Intersection or Road Crossing",
    group: "Intersection",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Crossing Facility",
    group: "Intersection",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Crossing Type",
    label: "Crossing Type",
    group: "Intersection",
    options: ["Not Selected", "Zebra Crossing", "Signalised PC", "Bicycle Crossing", "Unsignalised Junction", "Development Access"],
  },
  {
    name: "Pedestrian Crossing",
    group: "Intersection",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Intersecting Bicycle Facility",
    group: "Intersection",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Property Access",
    group: "Intersection",
    options: ["Not Selected", "Present", "Not Present"]
  },
  {
    name: "Number of lanes – adjacent road",
    group: "Intersection",
    options: ["Not Selected", "1 per Direction/NA", "> 1 per Direction"]
  },
  {
    name: "Number of lanes – intersecting road",
    group: "Intersection",
    options: ["Not Selected", "1 per Direction/NA", "> 1 per Direction"]
  },
];

// Populate ATTRIBUTE_OPTIONS from cyclerapAttributes (all non-"Not Selected" options, skip numeric)
ATTRIBUTE_OPTIONS = Object.fromEntries(
  cyclerapAttributes
    .filter(a => a.type !== "numeric" && a.options.length > 1)
    .map(a => [a.name, a.options.filter(o => o !== "Not Selected")])
);

// Add safety score attributes to ATTRIBUTE_OPTIONS
safetyScoreAttributes.forEach(a => {
  ATTRIBUTE_OPTIONS[a.name] = a.options.filter(o => o !== "Not Selected");
});

/** All CycleRAP attribute configs (exported for FilterPanel and other consumers). */
export const CYCLERAP_ATTRIBUTE_CONFIGS: readonly AttributeConfig[] = cyclerapAttributes;

/**
 * Maps a parent attribute to its child (subcategory) attribute and
 * the specific child options that belong under each parent category value.
 * Used for the 3-layer conditional filter UI.
 */
export const SUBCATEGORY_MAP: Record<
  string,
  { childAttr: string; parentCategories: Record<string, string[]> }
> = {
  "Fixed Obstacle on Facility": {
    childAttr: "FO Type",
    parentCategories: {
      "Present": ["Lamp Post", "Traffic Light", "Pillar", "Bollards", "Billboards", "Sign Poles", "Fence", "Vegetation", "Others"],
    },
  },
  "Non-Fixed Obstacle on Facility": {
    childAttr: "NFO Type",
    parentCategories: {
      "Present": ["Barrier", "Bins", "Bicycle", "Cone", "Others"],
    },
  },
  "Facility Width per Direction": {
    childAttr: "Facility Width Sub-category",
    parentCategories: {
      "Very Narrow": ["≤1.5m", ">1.5–1.8m", ">1.8–<2m"],
      "Narrow": ["2–<3.5m", "3.5–4m"],
      "Wide": [">4m"],
    },
  },
  "Curvature": {
    childAttr: "Curvature Sub-category",
    parentCategories: {
      "Sharp Turn Present": ["<6.5m", "<10m", "Path Junction"],
      "No Sharp Turn Present": ["10–18m", ">18m"],
    },
  },
  "Crossing Facility": {
    childAttr: "Crossing Type",
    parentCategories: {
      "Present": ["Zebra Crossing", "Signalised PC", "Bicycle Crossing", "Unsignalised Junction", "Development Access"],
    },
  },
  "Delineation": {
    childAttr: "Delineation Type",
    parentCategories: {
      "Present": ["Cycling Path", "Red Stripe", "Signalised Crossing", "Zebra Crossing"],
    },
  },
};

/** Set of attribute names that are subcategory children — hidden from the FilterPanel. */
export const SUBCATEGORY_CHILD_ATTRS = new Set(
  Object.values(SUBCATEGORY_MAP).map(v => v.childAttr)
);

/** Multi-value attributes whose CSV cells can contain comma-separated values. */
export const MULTI_VALUE_ATTRS = new Set(["FO Type", "NFO Type", "Delineation Type", "Crossing Type"]);

/**
 * Subcategory descriptions per attribute option.
 * Keys are attribute names → option value → descriptive sub-text shown in the sidebar.
 * Only attributes/options that have a meaningful sub-description are included.
 */
export const ATTRIBUTE_SUBCATEGORIES: Record<string, Record<string, string>> = {
  "Facility Type": {
    "Sidewalk": "Standalone or beside cycling path (GIS)",
    "Off-Road Bicycle Path": "Side by side footpath (adj. sidewalk 0–1 m) or split path (adj. sidewalk 1–3 m)",
    "Mixed Traffic Road Lane": "Shared space, side road, development access, signalised pedestrian crossing, pedestrian cum bicycle crossing, zebra crossing, kerb cut ramp",
  },
  "Loose or slippery surface": {
    "Present": "Type: leaves, sand/soil, others",
  },
  "Major Surface Deformation or Drain Opening": {
    "Present": "Type: potholes/cracks, drain opening/grating, no kerb cut ramps, uneven surface, others",
  },
  "Fixed Obstacle on Facility": {
    "Present": "Type: lamp post, traffic light pole, covered linkway pole, bollards, VIG posts, vegetation, others",
  },
  "Non-Fixed Obstacle on Facility": {
    "Present": "Type: water filled barricade, dustbin, parked bicycles/motorcycles, advertisement panels, others",
  },
  "Line of Sight": {
    "Inadequate": "Location: corner, development entrance/exit, bend, driveway/sideroad, crossing — Object: vegetation, column, boundary wall/fence, structure",
  },
  "Delineation": {
    "Not Present": "Faded or not present",
  },
  "Facility Width per Direction": {
    "Very Narrow": "≤1.5 m · >1.5–1.8 m · >1.8–<2 m",
    "Narrow": "2 m · >2–<3.5 m · 3.5–4 m",
  },
  "Width Restriction": {
    "Present": "Type: bus stop, obstacle on path, construction, vegetation, others",
  },
  "Grade": {
    "<=2% (1:25)": "Up to 2% gradient (1:25)",
    "2.9% (1:20)": "Up to 2.9% gradient (1:20)",
    "3.8% (1:15)": "Up to 3.8% gradient (1:15)",
    "4.7% (1:12)": "Up to 4.7% gradient (1:12)",
    ">=5%": "5% gradient or steeper",
  },
  "Curvature": {
    "Sharp Turn Present": "<6.5 m · <10 m · Path Junction",
    "No Sharp Turn Present": "10–18 m · >18 m",
  },
  "Pedestrian Crossing": {
    "Present": "Location: MRT station, bus stop/PUDO/taxi stand, crossings (GIS)",
  },
  "Intersection or Road Crossing": {
    "Present": "Type: side road, development access, signalised pedestrian crossing, pedestrian cum bicycle crossing, zebra crossing, kerb cut ramp",
  },
  "Crossing Facility": {
    "Present": "Type: zebra crossing, signalised PC, bicycle crossing, unsignalised junction, development access",
  },
  "Bicycle/LV speed – average": {
    "=/> 20km/h": "20 · >20–25 · >25 km/h",
  },
};

/**
 * Returns the display hex color for a given attribute name and category value.
 * Identical logic to the getCategoryColor function in PathAnalysisMapView.
 * Exported here to avoid duplication and circular imports.
 */
export function getCategoryColor(attribute: string, category: string): string {
  const isSafetyScore = ["VB Band", "BB Band", "SB Band", "BP Band", "Overall Risk Level"].includes(attribute);

  const categoryColors: Record<string, string | Record<string, string>> = {
    "Not Selected": "#9CA3AF",
    "Low": "#87C424",
    "Medium": "#FFCC1A",
    "High": "#FF5B1A",
    "Extreme": "#CD1AFF",
    "Adjacent Sidewalk 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Road Lane 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Vehicle Parking 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Severe Hazard 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent object or level change 0-1m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Road Lane 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Vehicle Parking 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent Severe Hazard 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Adjacent object or level change 1-3m": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Line of Sight": { "Adequate": "#16A34A", "Inadequate": "#DC2626" },
    "Fixed Obstacle on Facility": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "FO Type": {
      "Lamp Post": "#DC2626",
      "Traffic Light": "#EA580C",
      "Pillar": "#F59E0B",
      "Bollards": "#CA8A04",
      "Billboards": "#7C3AED",
      "Billboard": "#7C3AED",
      "Sign Poles": "#0284C7",
      "Sign Pole": "#0284C7",
      "Fence": "#0891B2",
      "Vegetation": "#16A34A",
      "Others": "#6B7280",
    },
    "Non-Fixed Obstacle on Facility": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "NFO Type": {
      "Barrier": "#DC2626",
      "Bins": "#EA580C",
      "Bicycle": "#F59E0B",
      "Cone": "#CA8A04",
      "Others": "#6B7280",
    },
    "Width Restriction": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Light Segregation": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Facility access": { "Adequate": "#16A34A", "Inadequate": "#DC2626" },
    "Loose or slippery surface": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Major Surface Deformation or Drain Opening": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Tram or Train Rails": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Delineation": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Delineation Type": {
      "Cycling Path":     "#2563EB",
      "Red Stripe":       "#DC2626",
      "Signalised Crossing": "#EA580C",
      "Zebra Crossing":   "#CA8A04",
    },
    "Street Lighting": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Grade": {
      "<=2% (1:25)": "#16A34A",
      "2.9% (1:20)": "#65A30D",
      "3.8% (1:15)": "#CA8A04",
      "4.7% (1:12)": "#EA580C",
      ">=5%": "#DC2626",
    },
    "Curvature": { "No Sharp Turn Present": "#16A34A", "Sharp Turn Present": "#DC2626" },
    "Facility Width per Direction": { "Wide": "#16A34A", "Narrow": "#FFCC1A", "Very Narrow": "#DC2626" },
    "Peak pedestrian flow along or across facility": { "None": "#6B7280", "Low": "#16A34A", "Moderate to high": "#DC2626" },
    "Peak bicycle/LV traffic flow": { "Low": "#16A34A", "Moderate to high": "#DC2626" },
    "Observed proportion of cargo bikes and mopeds": { "Low": "#16A34A", "Moderate to high": "#DC2626" },
    "Heavy vehicle flow": { "Low": "#16A34A", "Moderate to high": "#DC2626" },
    "Bicycle/LV speed – average": { "< 20km/h": "#16A34A", "=/> 20km/h": "#DC2626" },
    "Bicycle/LV speed differential": { "< 10km/h": "#16A34A", "=/> 10km/h": "#DC2626" },
    "Intersection or Road Crossing": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Crossing Facility": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Crossing Type": {
      "Zebra Crossing": "#CA8A04",
      "Signalised PC": "#2563EB",
      "Bicycle Crossing": "#16A34A",
      "Unsignalised Junction": "#EA580C",
      "Development Access": "#9333EA",
    },
    "Pedestrian Crossing": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Intersecting Bicycle Facility": { "Present": "#16A34A", "Not Present": "#DC2626" },
    "Property Access": { "Present": "#DC2626", "Not Present": "#16A34A" },
    "Intersection Approach": { "Separate/NA": "#16A34A", "Shared": "#DC2626" },
    "Number of lanes – adjacent road": { "1 per Direction/NA": "#16A34A", "> 1 per Direction": "#DC2626" },
    "Number of lanes – intersecting road": { "1 per Direction/NA": "#16A34A", "> 1 per Direction": "#DC2626" },
    "Road speed limit": {
      "NA": "#6B7280",
      "30 km/h": "#16A34A",
      "40 km/h": "#65A30D",
      "50 km/h": "#FFCC1A",
      "60 km/h": "#F59E0B",
      "70 km/h": "#EA580C",
      "80 km/h": "#DC2626",
      "90 km/h": "#991B1B",
    },
    "Flow Direction": { "One Way": "#2563EB", "Two Way": "#9333EA" },
    "Facility Type": {
      "Sidewalk": "#2563EB",
      "Multi-Use Path": "#9333EA",
      "Off-Road Bicycle Path": "#16A34A",
      "On-road Bicycle Lane": "#CA8A04",
      "Road Shoulder": "#F59E0B",
      "Mixed Traffic Road Lane": "#DC2626",
    },
    "Facility Width Sub-category": {
      "\u22641.5m":     "#DC2626",
      ">1.5\u20131.8m": "#EA580C",
      ">1.8\u2013<2m":  "#F59E0B",
      "2\u2013<3.5m":   "#16A34A",
      "3.5\u20134m":    "#0891B2",
      ">4m":            "#2563EB",
    },
    "Curvature Sub-category": {
      "<6.5m":         "#DC2626",
      "<10m":          "#EA580C",
      "Path Junction": "#9333EA",
      "Sharp Bend":    "#EA580C",
      "Both":          "#9333EA",
      "10\u201318m":    "#16A34A",
      ">18m":           "#2563EB",
    },
    "Area type": {
      "Urban":        "#2563EB",
      "Suburban":     "#0891B2",
      "Rural":        "#16A34A",
      "Industrial":   "#EA580C",
      "Recreational": "#9333EA",
    },
  };

  if (isSafetyScore) {
    return (categoryColors[category] as string) || "#6B7280";
  }

  const attributeColors = categoryColors[attribute];
  if (typeof attributeColors === "object" && attributeColors !== null) {
    return (attributeColors as Record<string, string>)[category] || "#6B7280";
  }
  if (typeof attributeColors === "string") return attributeColors;
  return "#6B7280";
}

// All attribute names including "Not Selected" and "Project"
const allAttributes = [
  { label: "Not Selected", value: "Not Selected", group: "Not Selected" },
  { label: "Project", value: "Project", group: "Project" },
  ...safetyScoreAttributes.map((attr) => ({
    label: attr.displayName || attr.name,
    value: attr.name,
    group: attr.group,
  })),
  ...cyclerapAttributes.map((attr) => ({
    label: attr.label || attr.name,
    value: attr.name,
    group: attr.group,
  })),
];

interface AttributesDropdownProps {
  selectedAttributes: (string | null)[];
  onAttributeChange: (attributes: (string | null)[]) => void;
}

const getLabelForValue = (value: string | null) => {
  if (!value || value === "Not Selected") return "";
  const attr = allAttributes.find((a) => a.value === value);
  return attr ? attr.label : "";
};

export default function AttributesDropdown({
  selectedAttributes,
  onAttributeChange
}: AttributesDropdownProps) {
  const [inputValues, setInputValues] = useState<string[]>(() =>
    selectedAttributes.map((attr) => getLabelForValue(attr))
  );
  const [openComboboxes, setOpenComboboxes] = useState<boolean[]>(selectedAttributes.map(() => false));
  // Generate stable IDs for each filter slot to use as React keys
  const [filterIds, setFilterIds] = useState<string[]>(() => selectedAttributes.map(() => Math.random().toString(36).substr(2, 9)));

  const getFilterLabel = (index: number): string => {
    const labels = ["1st", "2nd", "3rd", "4th", "5th"];
    return labels[index] || "";
  };

  const handleAttributeChange = (index: number, value: string) => {
    const newAttributes = [...selectedAttributes];

    // If "Not Selected" is chosen, clear that filter
    if (value === "Not Selected") {
      newAttributes[index] = null;
    } else {
      // Check if this attribute is already selected in another filter
      const isDuplicate = selectedAttributes.some(
        (attr, i) => attr === value && i !== index
      );

      if (isDuplicate) {
        return; // Don't allow duplicate
      }

      newAttributes[index] = value;
    }

    onAttributeChange(newAttributes);
  };

  const handleAddFilter = () => {
    if (selectedAttributes.length < 5) {
      onAttributeChange([...selectedAttributes, null]);
      setInputValues([...inputValues, ""]);
      setOpenComboboxes([...openComboboxes, false]);
      setFilterIds([...filterIds, Math.random().toString(36).substr(2, 9)]);
    }
  };

  const handleRemoveFilter = (index: number) => {
    // If there's only one filter and we're removing it, reset it to empty/null state
    if (selectedAttributes.length === 1) {
      onAttributeChange([null]);
      setInputValues([""]);
      setOpenComboboxes([false]);
      // Keep changes minimal, no need to regen ID for the single remaining slot, 
      // but conceptually it's a reset. Let's keep the existing ID or regen? 
      // Existing logic implies clearing value.
      return;
    }

    const newAttributes = selectedAttributes.filter((_, i) => i !== index);
    const newInputValues = inputValues.filter((_, i) => i !== index);
    const newOpenComboboxes = openComboboxes.filter((_, i) => i !== index);
    const newFilterIds = filterIds.filter((_, i) => i !== index);

    onAttributeChange(newAttributes);
    setInputValues(newInputValues);
    setOpenComboboxes(newOpenComboboxes);
    setFilterIds(newFilterIds);
  };

  // Reset all filters
  const handleResetFilters = () => {
    onAttributeChange([null]);
    setInputValues([""]);
    setOpenComboboxes([false]);
    setFilterIds([Math.random().toString(36).substr(2, 9)]);
  };

  // Filter attributes based on input value for each filter
  // Also exclude already-selected attributes to prevent duplicates
  // Fuzzy matching for robust search
  const fuzzyMatch = (query: string, text: string): number => {
    query = query.toLowerCase();
    text = text.toLowerCase();

    let queryIndex = 0;
    let score = 0;

    for (let i = 0; i < text.length && queryIndex < query.length; i++) {
      if (text[i] === query[queryIndex]) {
        score += 1;
        queryIndex++;
      }
    }

    return queryIndex === query.length ? score : -1; // -1 if no match
  };

  const getFilteredAttributes = (inputValue: string, currentIndex: number) => {
    let filtered = allAttributes;

    // Get the currently selected attribute for this filter
    const currentAttribute = selectedAttributes[currentIndex];

    // Exclude attributes already selected in other filters
    const selectedAttributeNames = selectedAttributes
      .filter((_, i) => i !== currentIndex) // Exclude current filter
      .filter((attr) => attr !== null) as string[];

    filtered = filtered.filter(
      (attr) =>
        // Always include the current filter's value
        attr.value === currentAttribute ||
        // Always include "Not Selected"
        attr.value === "Not Selected" ||
        // Exclude attributes selected in other filters
        !selectedAttributeNames.includes(attr.value)
    );

    // Apply search filter with smart sorting
    if (!inputValue) return filtered;

    const lowerInput = inputValue.toLowerCase();

    // Score each attribute for relevance
    const scored = filtered
      .map((attr) => {
        const lowerLabel = attr.label.toLowerCase();

        // Exact match = highest priority
        if (lowerLabel === lowerInput) return { attr, score: 1000 };

        // Starts with input = very high priority
        if (lowerLabel.startsWith(lowerInput)) return { attr, score: 900 };

        // Contains input as a word = high priority
        if (lowerLabel.includes(` ${lowerInput}`) || lowerLabel.includes(`-${lowerInput}`)) {
          return { attr, score: 800 };
        }

        // Contains input substring = medium priority
        if (lowerLabel.includes(lowerInput)) return { attr, score: 700 };

        // Fuzzy match = low priority
        const fuzzyScore = fuzzyMatch(lowerInput, lowerLabel);
        if (fuzzyScore >= 0) return { attr, score: 100 + fuzzyScore };

        // No match
        return { attr, score: -1 };
      })
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.attr);

    return scored;
  };

  // Create collections with filtered attributes for each filter
  const getAttributeCollection = (inputValue: string, currentIndex: number) => {
    const items = getFilteredAttributes(inputValue, currentIndex);
    // Ensure all items are valid objects with value and label
    const validItems = items.filter(item => item && typeof item === 'object' && item.value && item.label);
    return createListCollection({
      items: validItems,
    });
  };

  const hasAnyFilter = selectedAttributes.some(attr => attr !== null);

  // Can only add more filters if we haven't reached 5 AND there are available attributes
  const selectedAttributeNames = selectedAttributes.filter((attr) => attr !== null) as string[];
  const availableAttributeCount = cyclerapAttributes.length + 1; // Total unique attributes + "Project"
  const canAddMoreFilters = selectedAttributes.length < 5 && selectedAttributeNames.length < availableAttributeCount;

  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      p="6"
      bg="bg.panel"
    >
      {/* Header */}
      <Flex justify="space-between" align="center" mb="4">
        <Text fontSize="md" fontWeight="bold">
          Filter Segment
        </Text>
        {hasAnyFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetFilters}
            colorPalette="red"
          >
            Clear All
          </Button>
        )}
      </Flex>

      {/* Multiple Attribute Filters */}
      <Box>
        <Text fontSize="sm" color="fg.muted" mb="4">
          Add up to 5 filters to visualize segments with multiple attributes
        </Text>

        {/* Render all filters horizontally */}
        <Flex gap="4" flexWrap="wrap" align="flex-start" mb="4">
          {selectedAttributes.map((selectedAttribute, index) => {
            const currentValue = selectedAttribute || "Not Selected";
            const inputValue = inputValues[index] || "";
            const attributeCollection = getAttributeCollection(inputValue, index);
            // Use the stable ID as the key
            const key = filterIds[index] || `fallback-${index}`;

            return (
              <Box key={key} minW="280px">
                <Text fontSize="sm" fontWeight="semibold" mb="2">
                  {getFilterLabel(index)} Filter
                </Text>
                <Flex gap="2" align="flex-end">
                  <Box flex="1">
                    <Combobox.Root
                      collection={attributeCollection}
                      value={[currentValue]}
                      open={openComboboxes[index]}
                      onOpenChange={(details) => {
                        // Keep dropdown open if there's text in the field
                        if (inputValue.length > 0) {
                          const newOpenComboboxes = [...openComboboxes];
                          newOpenComboboxes[index] = true;
                          setOpenComboboxes(newOpenComboboxes);
                        } else {
                          const newOpenComboboxes = [...openComboboxes];
                          newOpenComboboxes[index] = details.open;
                          setOpenComboboxes(newOpenComboboxes);
                        }
                      }}
                      onValueChange={(e) => {
                        // Only handle the change if a valid value is selected
                        if (e.value[0]) {
                          handleAttributeChange(index, e.value[0]);
                          // Close dropdown and clear input after selection
                          const newOpenComboboxes = [...openComboboxes];
                          newOpenComboboxes[index] = false;
                          setOpenComboboxes(newOpenComboboxes);
                          setInputValues(inputValues.map((v, i) => i === index ? "" : v));
                        }
                      }}
                      inputValue={inputValue}
                      onInputValueChange={(e) => setInputValues(inputValues.map((v, i) => i === index ? e.inputValue : v))}
                    >
                      <Combobox.Control
                        onClick={() => {
                          const newOpenComboboxes = [...openComboboxes];
                          newOpenComboboxes[index] = true;
                          setOpenComboboxes(newOpenComboboxes);
                        }}
                      >
                        <Combobox.Input
                          placeholder="Select attribute..."
                        />
                        <Combobox.IndicatorGroup>
                          <Combobox.ClearTrigger />
                          <Combobox.Trigger />
                        </Combobox.IndicatorGroup>
                      </Combobox.Control>
                      <Portal>
                        <Combobox.Positioner>
                          <Combobox.Content maxH="400px" overflowY="auto">
                            <Combobox.Empty>No attributes found</Combobox.Empty>
                            {attributeCollection.items.length > 0 ? (
                              renderGroupedAttributes(attributeCollection.items)
                            ) : null}
                          </Combobox.Content>
                        </Combobox.Positioner>
                      </Portal>
                    </Combobox.Root>
                  </Box>

                  {/* Add/Remove Filter Buttons */}
                  {index === selectedAttributes.length - 1 && canAddMoreFilters && (
                    <Button
                      size="md"
                      variant="outline"
                      colorPalette="blue"
                      onClick={handleAddFilter}
                      px="3"
                    >
                      Add Filter
                    </Button>
                  )}
                  {/* Show X button if it's not the first item OR if it is the first item but has a value selected */}
                  {(index > 0 || (index === 0 && selectedAttribute !== null)) && (
                    <Button
                      size="md"
                      variant="outline"
                      colorPalette="red"
                      onClick={() => handleRemoveFilter(index)}
                      px="3"
                    >
                      ✕
                    </Button>
                  )}
                </Flex>
              </Box>
            );
          })}
        </Flex>

        {/* Display selected filters as badges */}
        {hasAnyFilter && (
          <Box mt="4" pt="4" borderTop="1px solid" borderColor="gray.200">
            <Text fontSize="xs" fontWeight="semibold" mb="2" color="gray.600">
              Active Filters:
            </Text>
            <Flex gap="2" flexWrap="wrap">
              {selectedAttributes.map((attr, index) => attr && (
                <Box
                  key={index}
                  px="3"
                  py="1"
                  borderRadius="full"
                  bg="blue.subtle"
                  fontSize="sm"
                  fontWeight="semibold"
                  color="blue.fg"
                >
                  {attr}
                </Box>
              ))}
            </Flex>
          </Box>
        )}
      </Box>
    </Box>
  );
}
