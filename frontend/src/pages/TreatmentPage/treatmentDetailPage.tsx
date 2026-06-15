import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Flex,
  Grid,
  GridItem,
  Text,
  Spinner,
  NumberInput,
  Button,
  Dialog,
  Portal,
  CloseButton,
  Menu,
} from "@chakra-ui/react";
import { LuCheck, LuCopy, LuImage, LuChevronDown } from "react-icons/lu";
import { Switch } from "../../components/ui/switch";
import { toaster } from "../../components/ui/toaster";
import { Tooltip } from "../../components/ui/tooltip";

import type { Feature, FeatureCollection, LineString } from "geojson";

import {
  fetchProjectDetail,
  fetchProjectAttributes,
  fetchProjectGeoJSON,
  applyTreatments,
  getSegmentTreatments,
  getAllTreatments,
  fetchAttributeMappings,
  previewTreatments,
  applySpecificTreatment,
  getTreatmentEffectiveness,
  getTreatmentSegmentEffectiveness,
  calculateScore,
} from "../../api";

import type { AttributeRow } from "../../api";
import ImagePanel from "../CodingPage/components/ImagePanel";
import PostTreatmentImageUpload from "./components/PostTreatmentImageUpload";
import AttributesPanel, { resolveContributorTabGroup } from "../CodingPage/components/AttributesPanel";
import GeoDataPanel from "../CodingPage/components/GeoDataPanel";
import SegmentScoresCard from "../../components/visualization/scoreband/SegmentScoresCard";
import { aggregateTopContributors } from "../../utils/aggregateTopContributors";
import OverallTreatmentAnalysis from "../../components/visualization/scoreband/OverallTreatmentAnalysis";

type ProjectDetail = { name: string; versions: string[]; latest: string };
type AttributesResponse = { rows: AttributeRow[] };
type ScoreType = {
  BB: number;
  BP: number;
  SB: number;
  VB: number;
  total: number;
};

type CopyButtonState = "idle" | "copying" | "copied" | "error";
type ImageCopyButtonState = "idle" | "copying" | "copied" | "error";

const PANEL_HEIGHT = 400;
const CONTROLS_H = 32;
const MAP_HEIGHT = 500;

// Treatment definitions using application's native attribute names
type Treatment = {
  id: number;
  name: string;
  description?: string;
  // Attributes to check if treatment is applicable
  triggers: Record<string, number[]>[];
  // Attribute changes to apply when treatment is selected
  effects: Record<string, number>;
};

const TREATMENTS: Treatment[] = [
  {
    id: 1,
    name: "Upgrade to on-road bicycle lane with light segregation",
    triggers: [
      { "Facility Type": [5], "Light Segregation": [2] },
      { "Facility Type": [6], "Light Segregation": [2] },
      { "Facility Type": [1, 2], "Number of lanes – adjacent road": [1], "Peak pedestrian flow along or across facility": [3] },
      { "Facility Type": [1, 2], "Number of lanes – adjacent road": [1] },
    ],
    effects: { "Facility Type": 4, "Light Segregation": 1, "Facility access": 1 },
  },
  {
    id: 2,
    name: "Safety barrier (Adjacent road 0-1m)",
    triggers: [
      { "Facility Type": [4, 5, 6], "Adjacent Road Lane 0-1m": [1], "Intersection or Road Crossing": [2] },
      { "Facility Type": [4, 5, 6], "Adjacent Road Lane 0-1m": [1], "Curvature": [1], "Intersection or Road Crossing": [2] },
      { "Facility Type": [3, 4, 5, 6], "Adjacent Road Lane 0-1m": [1], "Intersection or Road Crossing": [2] },
    ],
    effects: { "Adjacent Road Lane 0-1m": 2, "Facility access": 1 },
  },
  {
    id: 3,
    name: "Safety barrier (Adjacent road 1-3m)",
    triggers: [
      { "Facility Type": [4, 5, 6], "Adjacent Road Lane 1-3m": [1], "Intersection or Road Crossing": [2] },
      { "Facility Type": [3, 4, 5, 6], "Adjacent Road Lane 1-3m": [1], "Intersection or Road Crossing": [2] },
    ],
    effects: { "Adjacent Road Lane 1-3m": 2, "Facility access": 1 },
  },
  {
    id: 4,
    name: "Upgrade to cycling-priority street",
    triggers: [
      { "Facility Type": [1, 2, 5, 6], "Property Access": [1] },
    ],
    effects: { "Facility access": 1 },
  },
  {
    id: 5,
    name: "Upgrade to multi-use path",
    triggers: [
      { "Facility Type": [1, 2, 5, 6], "Property Access": [1] },
    ],
    effects: { "Facility Type": 2, "Facility Width per Direction": 3, "Facility access": 1 },
  },
  {
    id: 6,
    name: "Upgrade to off-road bicycle path",
    triggers: [
      { "Facility Type": [1, 2, 5, 6], "Property Access": [1] },
    ],
    effects: { "Facility Type": 3, "Facility access": 1 },
  },
  {
    id: 7,
    name: "Convert to one-way facility",
    triggers: [
      { "Facility Type": [4, 5, 6], "Flow Direction": [2] },
    ],
    effects: { "Flow Direction": 1, "Facility access": 1 },
  },
  {
    id: 8,
    name: "Improve surface conditions",
    triggers: [
      { "Loose or slippery surface": [1] },
    ],
    effects: { "Loose or slippery surface": 2, "Major Surface Deformation or Drain Opening": 2 },
  },
  {
    id: 9,
    name: "Install light segregation",
    triggers: [
      { "Light Segregation": [2] },
    ],
    effects: { "Light Segregation": 1 },
  },
  {
    id: 10,
    name: "Install street lighting",
    triggers: [
      { "Street Lighting": [2] },
    ],
    effects: { "Street Lighting": 1 },
  },
  {
    id: 11,
    name: "Remove fixed obstacles",
    triggers: [
      { "Fixed Obstacle on Facility": [1] },
    ],
    effects: { "Fixed Obstacle on Facility": 2 },
  },
  {
    id: 12,
    name: "Remove non-fixed obstacles",
    triggers: [
      { "Non-Fixed Obstacle on Facility": [1] },
    ],
    effects: { "Non-Fixed Obstacle on Facility": 2 },
  },
  {
    id: 13,
    name: "Remove width restriction",
    triggers: [
      { "Width Restriction": [1] },
    ],
    effects: { "Width Restriction": 2 },
  },
  {
    id: 14,
    name: "Improve facility access",
    triggers: [
      { "Facility access": [2] },
    ],
    effects: { "Facility access": 1 },
  },
  {
    id: 15,
    name: "Redesign sharp curves",
    triggers: [
      { "Curvature": [1] },
    ],
    effects: { "Curvature": 2 },
  },
  {
    id: 16,
    name: "Widen the facility",
    triggers: [
      { "Facility Width per Direction": [1, 2] },
    ],
    effects: { "Facility Width per Direction": 3 },
  },
  {
    id: 17,
    name: "Install protective barrier",
    triggers: [
      { "Adjacent Severe Hazard 0-1m": [1] },
    ],
    effects: { "Adjacent Severe Hazard 0-1m": 2 },
  },
  {
    id: 18,
    name: "Improve delineation",
    triggers: [
      { "Delineation": [2] },
    ],
    effects: { "Delineation": 1 },
  },
  {
    id: 19,
    name: "Review intersection approach",
    triggers: [
      { "Intersection Approach": [1] },
    ],
    effects: { "Intersection Approach": 2 },
  },
  {
    id: 20,
    name: "Improve crossing facility",
    triggers: [
      { "Crossing Facility": [2] },
      { "Property Access": [1], "Crossing Facility": [2] },
    ],
    effects: { "Crossing Facility": 1 },
  },
  {
    id: 21,
    name: "Evaluate grade separation",
    triggers: [
      { "Intersection or Road Crossing": [1] },
    ],
    effects: { "Intersection or Road Crossing": 2 },
  },
  {
    id: 22,
    name: "Reconfigure/remove parking",
    triggers: [
      { "Adjacent Vehicle Parking 0-1m": [1] },
    ],
    effects: { "Adjacent Vehicle Parking 0-1m": 2 },
  },
  {
    id: 23,
    name: "Review tram/train rails",
    triggers: [
      { "Tram or Train Rails": [1] },
    ],
    effects: { "Tram or Train Rails": 2 },
  },
  {
    id: 24,
    name: "Install traffic calming",
    triggers: [
      { "Facility Type": [4], "Intersection or Road Crossing": [2], "Adjacent Road Lane 0-1m": [1] },
    ],
    effects: {},
  },
  {
    id: 25,
    name: "Bicycle speed control",
    triggers: [
      { "Bicycle/LV speed – average": [2] },
    ],
    effects: { "Bicycle/LV speed – average": 1 },
  },
];

const TREATMENT_COPY_BASE_PROMPT =
  "Using this image, create an image with the following recommendations to improve the cycling or pedestrian facility shown, but do not change the original structure of the facility, such that renovations can be done quickly and efficiently. Important markings and delineation marks on the pathways and roads should be preserved:";

const TREATMENT_COPY_PRIORITY = [16, 22, 18, 15, 7, 5, 11, 21, 1, 4, 6, 9, 12, 13, 20];

const TREATMENT_COPY_LINES: Partial<Record<number, string>> = {
  1: "* Upgrade to on-road bicycle lane with light segregation - Convert the roadside space into a dedicated on-road bicycle lane, separated from moving traffic using light segregation measures. In the Singapore context, this includes flexible delineator posts, painted buffers, or low-profile rubber kerbs as seen in LTA cycling lane pilots.",
  4: "* Upgrade to cycling-priority street - Redesign the road to give cyclists primary right of way, with motor vehicles as guests. Apply surface treatments, signage, and traffic calming measures consistent with a cycling-priority or bicycle street layout, referencing LTA's low-traffic neighbourhood concepts.",
  5: "* Upgrade to multi-use path - Convert the existing facility into a clearly designated shared path for both cyclists and pedestrians. Apply shared path markings, the standard cyclist-and-pedestrian dual-symbol signage used on Singapore park connectors, and appropriate surface treatments.",
  6: "* Upgrade to off-road bicycle path - Physically separate the cycling facility from motor traffic by constructing a dedicated off-road path. This may involve a new alignment set back from the road, kerb separation, or a fully independent corridor consistent with Singapore's Park Connector Network or Cycling Path Network standards.",
  7: "* Convert to one-way facility - Redesign the facility to carry traffic or cyclists in a single direction only. Apply appropriate one-way signage, directional road markings, and physical channelling consistent with LTA standards for one-way cycling paths or pedestrian flows.",
  9: "* Install light segregation - Add low-profile physical separators between the cycling facility and adjacent motor traffic or pedestrian zones. In the Singapore context, this includes flexible delineator posts, painted islands, rubber kerb segments, or cat's eye studs as used in LTA on-road cycling infrastructure trials.",
  11: "* Remove fixed obstacles - Remove permanently installed objects that obstruct or reduce the usable width of the path or road. In the Singapore context, this includes lamp posts, traffic signal poles, bollards, fire hydrant boxes, bus shelter pillars, sheltered walkway columns, utility cabinets, and permanently anchored signage poles.",
  12: "* Remove non-fixed obstacles - Clear temporary or moveable objects that are obstructing the path or road. This includes traffic cones, water-filled modular barriers, A-frame signs, bicycles or PMDs parked across the path, food cart trolleys, or construction equipment that has not been permanently installed.",
  13: "* Remove width restrictions - Eliminate physical pinch points that artificially narrow the usable width of the facility. In the Singapore context, this includes anti-motorcyclist A-frames, swing gates, narrow cattle-grid barriers at park connector entry points, and overgrown vegetation or signage encroaching on path edges.",
  15: "* Redesign sharp curves - Smooth out tight bends or acute-angle turns in the path or road. In the Singapore context, this applies to park connector junctions, underpass entry/exit curves, and footpath corners near road crossings that create blind spots or force cyclists to slow sharply.",
  16: "* Widen the facility - Increase the width of the existing path, track, or road shown in this image. In the Singapore context, this may involve extending footpath edges, expanding shared paths along park connectors or void decks, or widening cycling strips adjacent to roads. However, all path types are strictly fixed. This means you must not append or extend a cycling path with a footpath, vice versa, or add a new type of path that is not already present in the image. Instead, you should only widen the existing facility within its current alignment and structure.",
  18: "* Improve delineation - Add or refresh visual markings that separate cyclists from pedestrians or vehicles. This includes painted centrelines, shared path symbols, directional arrows, colour-differentiated surfaces (e.g. red or green asphalt), and tactile guidance strips commonly found on Singapore park connectors and footpaths.",
  20: "* Improve crossing facility - Upgrade the provision for cyclists or pedestrians to cross a road or junction. In the Singapore context, this includes adding or improving toucan crossings, extending crossing times at signalised junctions, adding kerb ramps, or introducing a dedicated cycling crossing box at signalised intersections.",
  21: "* Evaluate grade separation - Assess the feasibility of introducing an overpass or underpass to eliminate at-grade conflicts between cyclists/pedestrians and motor vehicles. Reference existing Singapore examples such as PCN underpasses, overhead bridges, and cycling tunnels.",
  22: "* Reconfigure/remove parking - Remove or relocate on-street parking lots, motorcycle bays, or loading/unloading zones that encroach on or are adjacent to the cycling or pedestrian facility. This includes HDB estate carpark aprons, street-side parking lots marked with yellow kerb lines, and illegally parked vehicles.",
};

const getTreatmentDescription = (t: Treatment): string => {
  if (t.description) return t.description;
  const copyLine = TREATMENT_COPY_LINES[t.id];
  if (copyLine) {
    const parts = copyLine.split(' - ');
    if (parts.length > 1) {
      return parts.slice(1).join(' - ');
    }
  }
  return `Apply this intervention in a way that improves the safety and usability of the cycling or pedestrian facility shown.`;
};

const buildTreatmentCopyMessage = (treatmentIds: number[]): string => {
  const uniqueIds = Array.from(new Set(treatmentIds));
  const priorityIndex = new Map(TREATMENT_COPY_PRIORITY.map((id, index) => [id, index]));
  const treatmentIndex = new Map(TREATMENTS.map((treatment, index) => [treatment.id, index]));

  const sortedIds = uniqueIds.sort((left, right) => {
    const leftRank = priorityIndex.has(left)
      ? priorityIndex.get(left)!
      : TREATMENT_COPY_PRIORITY.length + (treatmentIndex.get(left) ?? Number.MAX_SAFE_INTEGER);
    const rightRank = priorityIndex.has(right)
      ? priorityIndex.get(right)!
      : TREATMENT_COPY_PRIORITY.length + (treatmentIndex.get(right) ?? Number.MAX_SAFE_INTEGER);
    return leftRank - rightRank;
  });

  const lines = sortedIds.map((id) => {
    const predefinedLine = TREATMENT_COPY_LINES[id];
    if (predefinedLine) {
      return predefinedLine;
    }

    const treatment = TREATMENTS.find((item) => item.id === id);
    if (!treatment) {
      return `* Treatment ${id} - Apply this intervention in a way that improves the safety and usability of the facility shown.`;
    }

    return `* ${treatment.name} - Apply this intervention in a way that improves the safety and usability of the cycling or pedestrian facility shown.`;
  });

  if (lines.length === 0) {
    return TREATMENT_COPY_BASE_PROMPT;
  }

  return [TREATMENT_COPY_BASE_PROMPT, "", ...lines].join("\n");
};

const buildProjectImageUrl = (projectName: string, imageRef: string): string =>
  `/api/projects/${encodeURIComponent(projectName)}/images/${encodeURIComponent(imageRef)}`;

const copyTextToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
};

const convertImageBlobToPng = async (blob: Blob): Promise<Blob> => {
  if (blob.type === "image/png") {
    return blob;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Failed to decode the current image."));
      element.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to prepare the current image for clipboard copy.");
    }

    context.drawImage(image, 0, 0);

    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });

    if (!pngBlob) {
      throw new Error("Failed to convert the current image for clipboard copy.");
    }

    return pngBlob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const fetchClipboardImageBlob = async (imageUrl: string): Promise<Blob> => {
  const response = await fetch(imageUrl, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error("Failed to load the current image.");
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("The current file is not an image.");
  }

  return convertImageBlobToPng(blob);
};

const copyRichContentToClipboard = async ({
  text,
  imageUrl,
  imageOnly = false,
}: {
  text?: string;
  imageUrl?: string | null;
  imageOnly?: boolean;
}): Promise<"both" | "image" | "text"> => {
  const trimmedText = text?.trim() ?? "";

  if (imageUrl && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    const imageBlob = await fetchClipboardImageBlob(imageUrl);
    const clipboardItemData: Record<string, Blob> = {
      "image/png": imageBlob,
    };

    if (!imageOnly && trimmedText) {
      clipboardItemData["text/plain"] = new Blob([trimmedText], { type: "text/plain" });
    }

    await navigator.clipboard.write([new ClipboardItem(clipboardItemData)]);
    return imageOnly ? "image" : trimmedText ? "both" : "image";
  }

  if (imageOnly) {
    throw new Error("Image copy is not supported in this browser.");
  }

  if (trimmedText) {
    await copyTextToClipboard(trimmedText);
    return "text";
  }

  throw new Error("Nothing to copy.");
};

// Helper to check if treatment is applicable based on current attributes
const isTreatmentApplicable = (treatment: Treatment, attrs: Record<string, any>): boolean => {
  if (!treatment.triggers || treatment.triggers.length === 0) return false;
  // OR between trigger sets: at least one set must match
  return treatment.triggers.some(set =>
    // AND within a set: all attributes in the set must match
    Object.entries(set).every(([attrName, validValues]) => {
      const attrValue = attrs[attrName];
      // Convert to number if it's a string
      const numValue = typeof attrValue === 'string' ? parseInt(attrValue, 10) : attrValue;
      return validValues.includes(numValue);
    })
  );
};

// Helper to get all applicable treatments for current segment
const getApplicableTreatments = (attrs: Record<string, any>): Treatment[] => {
  return TREATMENTS.filter(t => isTreatmentApplicable(t, attrs));
};

// Apply treatment effects to attributes
const applyTreatmentEffects = (
  attrs: Record<string, any>,
  treatmentIds: number[]
): { modifiedRow: Record<string, any>; changedAttributes: Set<string> } => {
  const modified = { ...attrs };
  const changed = new Set<string>();

  treatmentIds.forEach((treatmentId) => {
    const treatment = TREATMENTS.find((t) => t.id === treatmentId);
    if (treatment) {
      Object.entries(treatment.effects).forEach(([attrName, newValue]) => {
        if (modified[attrName] !== newValue) {
          modified[attrName] = newValue;
          changed.add(attrName);
        }
      });
    }
  });

  return { modifiedRow: modified, changedAttributes: changed };
};

// extractScores REMOVED - unused

// calculatePreviewScores REMOVED - using backend previewTreatments API instead

// Convert score to band (1-4) based on crash type
const calculateBandFromScore = (score: number, type: 'BB' | 'BP' | 'SB' | 'VB' = 'VB'): number => {
  // BB, BP, SB thresholds: 5, 10, 20
  if (type === 'BB' || type === 'BP' || type === 'SB') {
    if (score < 5) return 1;
    if (score <= 10) return 2;
    if (score <= 20) return 3;
    return 4;
  }

  // VB and default thresholds: 10, 25, 60
  if (score < 10) return 1;
  if (score <= 25) return 2;
  if (score <= 60) return 3;
  return 4;
};

// Calculate band distributions for pie charts
const calculateBandDistributions = (scoreRows: any[]) => {
  const distributions = {
    VB: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    BB: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    SB: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    BP: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    Overall: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };

  scoreRows.forEach((row) => {
    const vbBand = row["VB Band"];
    const bbBand = row["BB Band"];
    const sbBand = row["SB Band"];
    const bpBand = row["BP Band"];

    // Overall might be stored as "Overall Risk Level Band" or calculated from "Overall Risk Level"
    let overallBand = row["Overall Risk Level Band"];
    if (!overallBand && row["Overall Risk Level"] !== undefined) {
      // Fallback if band is missing (should verify if this fallback logic is even needed or correct usually)
      // Actually, if we lack bands, we can't reliably calculate Overall Band without recalculating all components.
      // But assuming row usually has bands.
      // If we strictly need to recalc:
      const bb = calculateBandFromScore(row["BB"], 'BB');
      const bp = calculateBandFromScore(row["BP"], 'BP');
      const sb = calculateBandFromScore(row["SB"], 'SB');
      const vb = calculateBandFromScore(row["VB"], 'VB');
      overallBand = Math.max(bb, bp, sb, vb);
    }

    if (vbBand >= 1 && vbBand <= 4) distributions.VB[vbBand as keyof typeof distributions.VB]++;
    if (bbBand >= 1 && bbBand <= 4) distributions.BB[bbBand as keyof typeof distributions.BB]++;
    if (sbBand >= 1 && sbBand <= 4) distributions.SB[sbBand as keyof typeof distributions.SB]++;
    if (bpBand >= 1 && bpBand <= 4) distributions.BP[bpBand as keyof typeof distributions.BP]++;
    if (overallBand >= 1 && overallBand <= 4) distributions.Overall[overallBand as keyof typeof distributions.Overall]++;
  });

  return distributions;
};

// Sentinel for the "All Projects" tab — scopes the page to every loaded project.
const ALL_PROJECTS = "__ALL__";

export default function TreatmentDetailPage() {
  const { projectName } = useParams<{ projectName: string }>();

  // Parse project names
  const projectNames = useMemo(() => {
    if (!projectName) return [];
    try {
      return projectName.split(',').map(name => {
        try {
          return decodeURIComponent(name);
        } catch {
          return name;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }, [projectName]);

  const [projectMap, setProjectMap] = useState<Array<{
    name: string;
    startIndex: number;
    count: number;
    detail: ProjectDetail;
  }>>([]);

  const [attrs, setAttrs] = useState<AttributeRow[]>([]);
  const [accordionView, setAccordionView] = useState<"segment" | "treatment">("segment");

  // Active tab — either a project name or ALL_PROJECTS. Drives the page-wide focus scope.
  const [activeProject, setActiveProject] = useState<string>(ALL_PROJECTS);
  // Monotonic counter bumped on tab switch to force the maps to recenter on the scope.
  const [panKey, setPanKey] = useState<number>(0);

  // Focus scope derived from the active tab. ALL_PROJECTS spans every segment;
  // a project tab narrows to that project's global-index window. Every consumer
  // (maps, treatment list, counts, donuts) reads from this.
  const isAllScope = activeProject === ALL_PROJECTS;
  const scope = useMemo(() => {
    if (isAllScope) return { start: 0, count: attrs.length };
    const p = projectMap.find((p) => p.name === activeProject);
    return p ? { start: p.startIndex, count: p.count } : { start: 0, count: attrs.length };
  }, [isAllScope, activeProject, projectMap, attrs.length]);

  // Effectiveness = # of segments whose Overall Risk Level Band improves when the
  // treatment is applied in isolation. Raw per-project counts are fetched once per
  // project set; effectivenessCounts/applicableCounts below aggregate them per the
  // active scope (all projects, or just the selected tab).
  const [perProjectEff, setPerProjectEff] = useState<Record<string, { counts: Record<number, number>; applicable: Record<number, number> }>>({});
  const [effectivenessLoading, setEffectivenessLoading] = useState<boolean>(false);

  const { effectivenessCounts, applicableCounts } = useMemo(() => {
    const names = isAllScope ? Object.keys(perProjectEff) : [activeProject];
    const counts: Record<number, number> = {};
    const applicable: Record<number, number> = {};
    for (const name of names) {
      const r = perProjectEff[name];
      if (!r) continue;
      for (const [tidStr, c] of Object.entries(r.counts)) counts[+tidStr] = (counts[+tidStr] ?? 0) + (c ?? 0);
      for (const [tidStr, c] of Object.entries(r.applicable)) applicable[+tidStr] = (applicable[+tidStr] ?? 0) + (c ?? 0);
    }
    return { effectivenessCounts: counts, applicableCounts: applicable };
  }, [perProjectEff, isAllScope, activeProject]);

  // Score drop for each treatment applied in isolation on the currently viewed segment.
  // Keyed by treatment id; populated when accordionView === "segment" and currentIndex changes.
  const [segmentScoreDrops, setSegmentScoreDrops] = useState<Record<number, number>>({});

  const allApplicableTreatments = useMemo(() => {
    if (!attrs || attrs.length === 0) return [];

    const uniqueMap = new Map<number, Treatment>();
    // Only consider segments within the active focus scope.
    for (let i = scope.start; i < scope.start + scope.count; i++) {
      const row = attrs[i];
      if (!row) continue;
      // getApplicableTreatments expects a dict. It's safe to cast row.
      const applicable = getApplicableTreatments(row as any);
      applicable.forEach(t => {
        if (!uniqueMap.has(t.id)) {
          uniqueMap.set(t.id, t);
        }
      });
    }

    return Array.from(uniqueMap.values()).sort((a, b) => {
      const ea = effectivenessCounts[a.id] ?? 0;
      const eb = effectivenessCounts[b.id] ?? 0;
      if (eb !== ea) return eb - ea;
      return a.id - b.id;
    });
  }, [attrs, effectivenessCounts, scope]);

  const [geoFeatures, setGeoFeatures] = useState<Feature[]>([]);
  const [scores, setScores] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTreatments, setSelectedTreatments] = useState<Set<number>>(new Set());

  const [attrMappings, setAttrMappings] = useState<Record<string, Record<string, string>>>({});
  const [showPostTreatment, setShowPostTreatment] = useState<boolean>(false);
  const [activeAttributeGroupTab, setActiveAttributeGroupTab] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Treatment application state
  const [treatmentState, setTreatmentState] = useState<Record<number, {
    applied: boolean;
    treatment_ids: number[];
    after_scores: ScoreType | null;
  }>>({});

  const fullyAppliedTreatments = useMemo(() => {
    const fullyApplied = new Set<number>();
    
    allApplicableTreatments.forEach(t => {
      let applicableCount = 0;
      let appliedCount = 0;
      
      for (let i = scope.start; i < scope.start + scope.count; i++) {
         const attr = attrs[i] as any;
         if (!attr) continue;
         const applicable = getApplicableTreatments(attr);
         if (applicable.some(x => x.id === t.id)) {
            applicableCount++;
            if (treatmentState[i]?.applied && treatmentState[i]?.treatment_ids?.includes(t.id)) {
               appliedCount++;
            }
         }
      }

      if (applicableCount > 0 && applicableCount === appliedCount) {
         fullyApplied.add(t.id);
      }
    });

    return fullyApplied;
  }, [allApplicableTreatments, attrs, treatmentState, scope]);
  const [applyLoading, setApplyLoading] = useState(false);
  const [openConfirmAlert, setOpenConfirmAlert] = useState(false);
  const [copyButtonState, setCopyButtonState] = useState<CopyButtonState>("idle");
  const [imageCopyButtonState, setImageCopyButtonState] = useState<ImageCopyButtonState>("idle");

  // Preview state
  const [previewScores, setPreviewScores] = useState<ScoreType | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const len = attrs.length;
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState(String(currentPage));

  const currentIndex = useMemo(
    () => Math.max(0, Math.min(len - 1, currentPage - 1)),
    [currentPage, len]
  );

  // Safety net: if the current segment drifts outside the active scope window
  // (e.g. projectMap resolves after navigation), snap back to the scope's first segment.
  useEffect(() => {
    if (isAllScope || scope.count === 0) return;
    if (currentIndex < scope.start || currentIndex >= scope.start + scope.count) {
      setCurrentPage(scope.start + 1);
      setPageInput("1"); // scope-relative first page
    }
  }, [isAllScope, scope, currentIndex]);

  const handleContributorClick = useCallback((name: string) => {
    const targetGroup = resolveContributorTabGroup(name);
    if (targetGroup) {
      setActiveAttributeGroupTab(targetGroup);
    }
  }, []);

  const appliedTreatmentIds = useMemo(() => {
    return treatmentState[currentIndex]?.treatment_ids ?? [];
  }, [currentIndex, treatmentState]);

  const combinedTreatmentIds = useMemo(() => {
    return [...new Set([...appliedTreatmentIds, ...Array.from(selectedTreatments)])];
  }, [appliedTreatmentIds, selectedTreatments]);

  // Helper to resolve index
  const resolveIndex = useCallback((globalIndex: number) => {
    for (const p of projectMap) {
      if (globalIndex >= p.startIndex && globalIndex < p.startIndex + p.count) {
        return { name: p.name, localIndex: globalIndex - p.startIndex };
      }
    }
    return null;
  }, [projectMap]);

  // Get segment count for a specific project
  const getProjectSegmentCount = useCallback((projectName: string): number => {
    const project = projectMap.find(p => p.name === projectName);
    return project?.count ?? 0;
  }, [projectMap]);

  // Get the first segment index for a specific project
  const getProjectFirstSegmentIndex = useCallback((projectName: string): number => {
    const project = projectMap.find(p => p.name === projectName);
    return project?.startIndex ?? 0;
  }, [projectMap]);

  // Calculate before treatment band distributions (segments within the active scope)
  const beforeBandCounts = useMemo(() => {
    return calculateBandDistributions(scores.slice(scope.start, scope.start + scope.count));
  }, [scores, scope]);

  // Calculate after treatment band distributions (segments within the active scope)
  const afterBandCounts = useMemo(() => {
    const treatedSegments = scores.slice(scope.start, scope.start + scope.count).map((scoreRow, i) => {
      const index = scope.start + i;
      const state = treatmentState[index];
      if (!state?.applied || !state.after_scores) {
        return scoreRow; // Not treated, return original
      }

      const bbBand = calculateBandFromScore(state.after_scores.BB, 'BB');
      const bpBand = calculateBandFromScore(state.after_scores.BP, 'BP');
      const sbBand = calculateBandFromScore(state.after_scores.SB, 'SB');
      const vbBand = calculateBandFromScore(state.after_scores.VB, 'VB');
      const overallBand = Math.max(bbBand, bpBand, sbBand, vbBand);

      // Create new row with after-treatment scores
      return {
        ...scoreRow,
        "BB": state.after_scores.BB,
        "BB Band": bbBand,
        "BP": state.after_scores.BP,
        "BP Band": bpBand,
        "SB": state.after_scores.SB,
        "SB Band": sbBand,
        "VB": state.after_scores.VB,
        "VB Band": vbBand,
        "Overall Risk Level": state.after_scores.total,
        "Overall Risk Level Band": overallBand,
      };
    });
    return calculateBandDistributions(treatedSegments);
  }, [scores, treatmentState, scope]);

  // Create after-treatment scores for map visualization
  const afterTreatmentScores = useMemo(() => {
    return scores.map((scoreRow, index) => {
      const state = treatmentState[index];
      if (!state?.applied || !state.after_scores) {
        return scoreRow; // Not treated, return original
      }
      // Create new row with after-treatment scores
      return {
        ...scoreRow,
        "BB": state.after_scores.BB,
        "BP": state.after_scores.BP,
        "SB": state.after_scores.SB,
        "VB": state.after_scores.VB,
        "Overall Risk Level": state.after_scores.total,
      };
    });
  }, [scores, treatmentState]);

  // Compute modified attributes and changed attributes for the current segment
  // using both applied treatments and any pending selections.
  const { modifiedAttrs, changedAttributes, changedFieldSources } = useMemo(() => {
    const currentAttrs = attrs[currentIndex] || null;
    if (!currentAttrs || combinedTreatmentIds.length === 0) {
      return { modifiedAttrs: currentAttrs, changedAttributes: new Set<string>(), changedFieldSources: {} };
    }
    const { modifiedRow, changedAttributes: changed } = applyTreatmentEffects(
      currentAttrs,
      combinedTreatmentIds
    );
    const sources: Record<string, string> = {};
    changed.forEach((attr) => {
      sources[attr] = "Treatment";
    });
    return { modifiedAttrs: modifiedRow, changedAttributes: changed, changedFieldSources: sources };
  }, [attrs, combinedTreatmentIds, currentIndex]);

  const currentFeature = useMemo<Feature | null>(() => {
    return geoFeatures[currentIndex] ?? null;
  }, [geoFeatures, currentIndex]);

  const imgRef = useMemo<string | undefined>(() => {
    const fromAttr =
      (attrs?.[currentIndex] as any)?.["Image Reference"] ??
      (attrs?.[currentIndex] as any)?.["image"] ??
      (attrs?.[currentIndex] as any)?.["img"];

    const p = (currentFeature?.properties as any) || {};
    const fromFeature =
      p?.["Image Reference"] ??
      p?.["Image_Reference"] ??
      p?.["image"] ??
      p?.["img"];

    return (fromAttr ?? fromFeature) || undefined;
  }, [attrs, currentIndex, currentFeature]);

  // Fetch project data
  const fetchData = useCallback(async () => {
    if (projectNames.length === 0) return;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const results = await Promise.all(projectNames.map(async (name) => {
        const sig = controller.signal;
        const [d, a, gjson, resultsRes] = await Promise.all([
          fetchProjectDetail(name),
          fetchProjectAttributes(name) as Promise<AttributesResponse>,
          fetchProjectGeoJSON(name) as Promise<FeatureCollection>,
          fetch(`/api/projects/${encodeURIComponent(name)}/results`, { signal: sig })
            .then(async res => {
              const data = res.ok ? await res.json() : { result_rows: [] };
              if (!data.result_rows || data.result_rows.length === 0) {
                const calc = await calculateScore(name);
                return calc.ok ? calc : { result_rows: [] };
              }
              return data;
            })
            .catch(() => ({ result_rows: [] })),
        ]);
        return { name, detail: d ?? null, attrs: a?.rows ?? [], geo: gjson?.features ?? [], scores: resultsRes?.result_rows ?? [] };
      }));

      // Aggregate
      const newMap: any[] = [];
      const newAttrs: any[] = [];
      const newGeo: any[] = [];
      const newScores: any[] = [];

      let start = 0;
      for (const res of results) {
        // Cap to min(geo, scores) to prevent index misalignment when a project
        // has no attributes (e.g. TPYLor63Q25: 208 geo features, 0 scores).
        const geoCount = Math.min(res.geo.length, res.scores.length);
        newMap.push({ name: res.name, startIndex: start, count: geoCount, detail: res.detail });
        newAttrs.push(...res.attrs.slice(0, geoCount));
        newGeo.push(...res.geo.slice(0, geoCount));
        newScores.push(...res.scores.slice(0, geoCount));
        start += geoCount;
      }

      setProjectMap(newMap);
      setAttrs(newAttrs);
      setGeoFeatures(newGeo);
      setScores(newScores);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, [projectNames]);

  // Load treatment state in background AFTER page is already visible
  useEffect(() => {
    if (projectNames.length === 0 || projectMap.length === 0) return;

    let cancelled = false;
    (async () => {
      const newTreatmentState: Record<number, any> = {};
      await Promise.all(projectNames.map(async (name) => {
        const projectInfo = projectMap.find(p => p.name === name);
        if (!projectInfo) return;
        try {
          const { segments } = await getAllTreatments(name);
          for (const [localIdxStr, seg] of Object.entries(segments)) {
            if (seg.has_treatments) {
              const globalIndex = projectInfo.startIndex + parseInt(localIdxStr, 10);
              newTreatmentState[globalIndex] = {
                applied: true,
                treatment_ids: seg.treatments_applied,
                after_scores: seg.after_scores ? {
                  BB: seg.after_scores.BB,
                  BP: seg.after_scores.BP,
                  SB: seg.after_scores.SB,
                  VB: seg.after_scores.VB,
                  total: seg.after_scores["Overall Risk Level"],
                } : null,
              };
            }
          }
        } catch (e) {
          console.error(`Failed to load treatments for ${name}:`, e);
        }
      }));
      if (!cancelled && Object.keys(newTreatmentState).length > 0) {
        setTreatmentState(newTreatmentState);
      }
    })();

    return () => { cancelled = true; };
  }, [projectNames, projectMap]);

  // Fetch per-treatment effectiveness counts per project, stored raw so the
  // active scope can aggregate them (all projects, or just the selected tab).
  useEffect(() => {
    if (projectMap.length === 0) return;

    let cancelled = false;
    setEffectivenessLoading(true);
    (async () => {
      try {
        const results = await Promise.all(
          projectMap.map(p => getTreatmentEffectiveness(p.name).catch(() => null))
        );
        if (cancelled) return;

        const byProject: Record<string, { counts: Record<number, number>; applicable: Record<number, number> }> = {};
        results.forEach((r, i) => {
          const name = projectMap[i]?.name;
          if (!name || !r || !r.ok) return;
          const counts: Record<number, number> = {};
          const applicable: Record<number, number> = {};
          for (const [tidStr, count] of Object.entries(r.counts)) {
            const tid = parseInt(tidStr, 10);
            if (Number.isFinite(tid)) counts[tid] = count ?? 0;
          }
          for (const [tidStr, count] of Object.entries(r.applicable_counts ?? {})) {
            const tid = parseInt(tidStr, 10);
            if (Number.isFinite(tid)) applicable[tid] = count ?? 0;
          }
          byProject[name] = { counts, applicable };
        });
        setPerProjectEff(byProject);
      } finally {
        if (!cancelled) setEffectivenessLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [projectMap]);

  // Fetch per-treatment score drops for the current segment to rank the "By Segment" list.
  useEffect(() => {
    if (accordionView !== "segment") return;
    const ctx = resolveIndex(currentIndex);
    if (!ctx) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await getTreatmentSegmentEffectiveness(ctx.name, ctx.localIndex);
        if (cancelled || !result.ok) return;
        const drops: Record<number, number> = {};
        for (const [tidStr, drop] of Object.entries(result.score_drops)) {
          const tid = parseInt(tidStr, 10);
          if (Number.isFinite(tid)) drops[tid] = drop;
        }
        setSegmentScoreDrops(drops);
      } catch {
        // non-fatal: list will remain in default order
      }
    })();

    return () => { cancelled = true; };
  }, [accordionView, currentIndex, resolveIndex]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for Treat All completion event
  useEffect(() => {
    const handleTreatAllCompleted = (event: Event) => {
      const customEvent = event as CustomEvent;
      const details = customEvent.detail; // Array of treatment details (now with projectName)

      if (details && Array.isArray(details)) {
        // Map treatment details to global indices based on projectMap
        setTreatmentState((prevState) => {
          const newState = { ...prevState };

          details.forEach((detail: any) => {
            const projectName = detail.projectName;
            const localIndex = detail.segment_index;
            const afterScores = detail.after_scores;

            // Find the project in projectMap to get the start index
            const project = projectMap.find(p => p.name === projectName);
            if (project) {
              const globalIndex = project.startIndex + localIndex;
              newState[globalIndex] = {
                applied: true,
                treatment_ids: detail.treatments_applied || detail.treatment_ids || [],
                after_scores: afterScores ? {
                  BB: afterScores.BB,
                  BP: afterScores.BP,
                  SB: afterScores.SB,
                  VB: afterScores.VB,
                  total: afterScores["Overall Risk Level"],
                } : null,
              };
            }
          });

          return newState;
        });

        setRefreshTrigger(prev => prev + 1);
      } else {
        setRefreshTrigger(prev => prev + 1);
        setTreatmentState({});
      }
    };

    const handleResetAllCompleted = () => {
      fetchData();
      setRefreshTrigger(prev => prev + 1);
      setTreatmentState({}); // Clear all local treatment states
      setSelectedTreatments(new Set()); // Clear selection
      setPreviewScores(null); // Clear preview
    };

    window.addEventListener("psat:treat:all:completed", handleTreatAllCompleted);
    window.addEventListener("psat:reset:all:completed", handleResetAllCompleted);

    return () => {
      window.removeEventListener("psat:treat:all:completed", handleTreatAllCompleted);
      window.removeEventListener("psat:reset:all:completed", handleResetAllCompleted);
    };
  }, [projectMap]);

  // Fetch attribute mappings (global, not per-project)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const map = await fetchAttributeMappings();
        if (!cancelled) setAttrMappings(map);
      } catch {
        if (!cancelled) setAttrMappings({});
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load treatment state when segment changes
  useEffect(() => {
    const ctx = resolveIndex(currentIndex);
    if (!ctx) return;

    let cancelled = false;

    (async () => {
      try {
        const state = await getSegmentTreatments(ctx.name, ctx.localIndex);
        if (cancelled) return;

        if (state.has_treatments) {
          setTreatmentState((prev) => ({
            ...prev,
            [currentIndex]: {
              applied: true,
              treatment_ids: state.treatments_applied,
              after_scores: state.after_scores
                ? {
                  BB: state.after_scores.BB,
                  BP: state.after_scores.BP,
                  SB: state.after_scores.SB,
                  VB: state.after_scores.VB,
                  total: state.after_scores["Overall Risk Level"],
                }
                : null,
            },
          }));
          // Pre-select treatments that were applied
          setSelectedTreatments(new Set());
        } else {
          // Clear selection for segments without treatments
          setSelectedTreatments(new Set());
        }
      } catch (e) {

      }
    })();

    return () => {
      cancelled = true;
    };
  }, [resolveIndex, currentIndex, refreshTrigger]);

  // Handle applying treatments
  const handleApplyTreatments = useCallback(async () => {
    const ctx = resolveIndex(currentIndex);
    if (!ctx || selectedTreatments.size === 0) return;

    setApplyLoading(true);

    try {
      const result = await applyTreatments(ctx.name, {
        segment_index: ctx.localIndex,
        treatment_ids: [...new Set([...(treatmentState[currentIndex]?.treatment_ids ?? []), ...Array.from(selectedTreatments)])],
        image_ref: imgRef,
      });

      // Update local state
      setTreatmentState((prev) => ({
        ...prev,
        [currentIndex]: {
          applied: true,
          treatment_ids: result.treatments_applied.split(",").map((x) => Number(x.trim())).filter((x) => !isNaN(x)),
          after_scores: {
            BB: result.after_scores.BB,
            BP: result.after_scores.BP,
            SB: result.after_scores.SB,
            VB: result.after_scores.VB,
            total: result.after_scores["Overall Risk Level"],
          },
        },
      }));

      setSelectedTreatments(new Set());
      setPreviewScores(null);
      setPreviewLoading(false);

    } catch (e: any) {
    } finally {
      setApplyLoading(false);
    }
  }, [resolveIndex, currentIndex, selectedTreatments, imgRef, treatmentState]);

  const handleConfirmApplyToAll = async () => {
    if (selectedTreatments.size === 0 || !currentCtx) return;
    setApplyLoading(true);
    setOpenConfirmAlert(false);
    try {
        const allDetails: any[] = [];
        // Apply across every project (All Projects) or only the active tab's project.
        const targets = isAllScope ? projectMap : projectMap.filter(p => p.name === activeProject);
        for (const id of Array.from(selectedTreatments)) {
            for (const proj of targets) {
                const res = await applySpecificTreatment(proj.name, id);
                if (res.details) {
                    res.details.forEach((d: any) => d.projectName = proj.name);
                    allDetails.push(...res.details);
                }
            }
        }
        window.dispatchEvent(new CustomEvent("psat:treat:all:completed", { detail: allDetails }));
        setSelectedTreatments(new Set());
    } catch (e: any) {
        console.error("Apply specific failed:", e);
        alert(e.message || "Failed to apply treatment");
    } finally {
        setApplyLoading(false);
    }
  };

  // Fetch preview scores when selection changes
  useEffect(() => {
    const ctx = resolveIndex(currentIndex);
    if (!ctx || currentIndex < 0 || selectedTreatments.size === 0) {
      setPreviewScores(null);
      setPreviewLoading(false);
      return;
    }

    setPreviewScores(null);
    let cancelled = false;

    // Debounce to avoid too many requests
    const timeoutId = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const result = await previewTreatments(ctx.name, {
          segment_index: ctx.localIndex,
          treatment_ids: combinedTreatmentIds,
        });

        if (cancelled || !result.ok) {
          return;
        }

        setPreviewScores({
          BB: result.after_scores.BB,
          BP: result.after_scores.BP,
          SB: result.after_scores.SB,
          VB: result.after_scores.VB,
          total: result.after_scores["Overall Risk Level"],
        });
      } catch (e) {

      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }, 300); // 300ms debounce

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [combinedTreatmentIds, currentIndex, resolveIndex, selectedTreatments]);

  // Handle resetting treatments
  const handleResetTreatments = useCallback(async () => {
    const ctx = resolveIndex(currentIndex);
    if (!ctx) return;

    setApplyLoading(true);

    try {
      // Apply with empty treatment list to reset
      await applyTreatments(ctx.name, {
        segment_index: ctx.localIndex,
        treatment_ids: [],
        image_ref: imgRef,
      });

      // Clear local state
      setTreatmentState((prev) => {
        const next = { ...prev };
        delete next[currentIndex];
        return next;
      });

      setSelectedTreatments(new Set());
      setPreviewScores(null); // Clear preview
      setPreviewLoading(false);
    } catch (e: any) {
    } finally {
      setApplyLoading(false);
    }
  }, [resolveIndex, currentIndex, imgRef]);

  // Pagination
  const gotoPage = useCallback(
    (page: number) => {
      if (len === 0) return;
      const clamped = Math.min(Math.max(1, page), len);
      setCurrentPage(clamped);
      // Reset selected treatments and preview when navigating to a new segment
      setSelectedTreatments(new Set());
      setPreviewScores(null);
      setPreviewLoading(false);
      setSegmentScoreDrops({});
    },
    [len]
  );

  // Page number shown to the user — scope-relative (1..scope.count) when a project
  // tab is active, global otherwise. currentPage/currentIndex stay global internally.
  const scopePage = isAllScope ? currentPage : currentIndex - scope.start + 1;
  const scopeTotal = isAllScope ? len : scope.count;

  useEffect(() => {
    setPageInput(String(scopePage));
  }, [scopePage]);

  const commitPage = useCallback(
    (valStr: string) => {
      const raw = Number(valStr);
      if (!Number.isFinite(raw)) return;
      // valStr is scope-relative; map back to a global page within the scope window.
      const relClamped = Math.min(Math.max(1, raw), scope.count || 1);
      const globalPage = isAllScope ? relClamped : scope.start + relClamped;
      gotoPage(globalPage);
    },
    [gotoPage, isAllScope, scope]
  );

  useEffect(() => {
    const t = setTimeout(() => commitPage(pageInput), 300);
    return () => clearTimeout(t);
  }, [pageInput, commitPage]);

  // Resolve current project name for UI display
  const currentCtx = resolveIndex(currentIndex);

  const projectContributors = useMemo(() => {
    if (!currentCtx?.name) return null;
    const entry = projectMap.find((p) => p.name === currentCtx.name);
    if (!entry) return null;
    const slice = scores.slice(entry.startIndex, entry.startIndex + entry.count) as Array<Record<string, unknown>>;
    return {
      projectName: currentCtx.name,
      contributors: aggregateTopContributors(slice),
    };
  }, [scores, projectMap, currentCtx?.name]);
  const currentImageUrl = useMemo(() => {
    if (!currentCtx?.name || !imgRef) {
      return null;
    }

    return buildProjectImageUrl(currentCtx.name, imgRef);
  }, [currentCtx, imgRef]);

  const handleCopyTreatmentPrompt = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    const message = buildTreatmentCopyMessage(ids);
    setCopyButtonState("copying");

    try {
      await copyTextToClipboard(message);
      setCopyButtonState("copied");
      toaster.create({
        title: "Prompt copied",
        description: "The current treatment prompt is ready to paste.",
        type: "success",
      });
    } catch (error) {
      setCopyButtonState("error");
      toaster.create({
        title: "Copy failed",
        description: error instanceof Error ? error.message : "Failed to copy the current treatment prompt.",
        type: "error",
      });
    }
  }, []);

  const handleCopyCurrentImage = useCallback(async () => {
    if (!currentImageUrl) return;
    setImageCopyButtonState("copying");

    try {
      await copyRichContentToClipboard({ imageUrl: currentImageUrl, imageOnly: true });
      setImageCopyButtonState("copied");
      toaster.create({
        title: "Image copied",
        description: "The current segment image is ready to paste.",
        type: "success",
      });
    } catch (error) {
      setImageCopyButtonState("error");
      toaster.create({
        title: "Image copy failed",
        description: error instanceof Error ? error.message : "Failed to copy the current image.",
        type: "error",
      });
    }
  }, [currentImageUrl]);

  useEffect(() => {
    const hasTransientCopyState =
      copyButtonState === "copied" ||
      copyButtonState === "error" ||
      imageCopyButtonState === "copied" ||
      imageCopyButtonState === "error";

    if (!hasTransientCopyState) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopyButtonState("idle");
      setImageCopyButtonState("idle");
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [copyButtonState, imageCopyButtonState]);

  const copyButtonLabel =
    copyButtonState === "copying"
      ? "Copying..."
      : copyButtonState === "copied"
        ? "Copied!"
        : copyButtonState === "error"
          ? "Copy failed"
          : "Copy prompt";

  const hasApplied = appliedTreatmentIds.length > 0;
  const hasSelected = selectedTreatments.size > 0;

  const imageCopyButtonLabel =
    imageCopyButtonState === "copying"
      ? "Copying..."
      : imageCopyButtonState === "copied"
        ? "Image copied!"
        : imageCopyButtonState === "error"
          ? "Copy failed"
          : "Copy image";

  if (projectNames.length === 0) {
    return (
      <Box p="4">
        <Text color="red.500">Invalid project name.</Text>
      </Box>
    );
  }

  if (loading) {
    return (
      <Flex align="center" justify="center" h="60vh">
        <Spinner size="lg" />
      </Flex>
    );
  }

  if (error) {
    return (
      <Box p="4">
        <Text color="red.500">Error: {error}</Text>
      </Box>
    );
  }

  return (
    <Box p="4">
      {/* DEBUG INFO */}


      {/* Project Tabs - scope the whole page to one project (or All Projects) */}
      {projectNames.length > 1 && (
        <Flex gap="2" mb="4" wrap="wrap">
          {/* All Projects tab — aggregate view across every loaded project */}
          <Button
            onClick={() => {
              setActiveProject(ALL_PROJECTS);
              setCurrentPage(1);
              setPageInput("1");
              setPanKey((k) => k + 1);
            }}
            variant={isAllScope ? "solid" : "outline"}
            colorPalette={isAllScope ? "blue" : "gray"}
            size="md"
          >
            All Projects ({len})
          </Button>
          {projectNames.map((proj) => {
            const isActive = activeProject === proj;
            const segmentCount = getProjectSegmentCount(proj);
            if (segmentCount === 0) return null;
            return (
              <Button
                key={proj}
                onClick={() => {
                  setActiveProject(proj);
                  // Narrow focus and jump to this project's first segment
                  const firstSegmentPage = getProjectFirstSegmentIndex(proj) + 1;
                  setCurrentPage(firstSegmentPage);
                  setPageInput("1"); // scope-relative first page
                  setPanKey((k) => k + 1);
                }}
                variant={isActive ? "solid" : "outline"}
                colorPalette={isActive ? "blue" : "gray"}
                size="md"
              >
                {proj} ({segmentCount})
              </Button>
            );
          })}
        </Flex>
      )}

      {/* Header with project info and pagination */}
      <Flex justify="space-between" align="center" mb="3">
        <Box>
          <Text fontSize="lg" fontWeight="bold" color="gray.900" _dark={{ color: "white" }}>
            {currentCtx ? currentCtx.name : "Unknown Project"}
          </Text>
          <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
            Loaded: {projectNames.length} project{projectNames.length > 1 ? 's' : ''}
          </Text>
        </Box>

        <Flex align="center" gap="3">
          <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
            {scopeTotal > 0 ? `${scopePage} / ${scopeTotal}` : "0 / 0"}
          </Text>

          <NumberInput.Root
            maxW="120px"
            min={1}
            max={scopeTotal || 1}
            defaultValue={String(scopePage)}
            value={pageInput}
            onValueChange={(e) => setPageInput(e.value)}
          >
            <NumberInput.Control />
            <NumberInput.Input
              onBlur={() => commitPage(pageInput)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.currentTarget.blur();
                }
              }}
            />
          </NumberInput.Root>
        </Flex>
      </Flex>

      {/* Map Previews: Before and After Treatment - Side by Side */}
      <Grid templateColumns={{ base: "1fr", lg: "repeat(2, minmax(0, 1fr))" }} gap="16px" mb="6" w="100%">
        {/* Before Treatment Map */}
        <GridItem minW="0" w="100%">
          <GeoDataPanel
            projectName={currentCtx ? currentCtx.name : ""}
            feature={
              geoFeatures[currentIndex]?.geometry?.type === "LineString"
                ? (geoFeatures[currentIndex] as any)
                : null
            }
            index={currentIndex}
            onJump={(i) => setCurrentPage(i + 1)}
            containerHeight={MAP_HEIGHT}
            subtitle="Before Treatment"
            geoFeatures={geoFeatures as Feature<LineString, any>[]}
            startIndex={0}
            scores={scores as any}
            scopeRange={isAllScope ? null : scope}
            autoFitKey={panKey}
            panKey={panKey}
          />
        </GridItem>

        {/* After Treatment Map */}
        <GridItem minW="0" w="100%">
          <GeoDataPanel
            projectName={currentCtx ? currentCtx.name : ""}
            feature={
              geoFeatures[currentIndex]?.geometry?.type === "LineString"
                ? (geoFeatures[currentIndex] as any)
                : null
            }
            index={currentIndex}
            onJump={(i) => setCurrentPage(i + 1)}
            containerHeight={MAP_HEIGHT}
            scores={afterTreatmentScores as any}
            subtitle="After Treatment"
            geoFeatures={geoFeatures as Feature<LineString, any>[]}
            startIndex={0}
            scopeRange={isAllScope ? null : scope}
            autoFitKey={panKey}
            panKey={panKey}
          />
        </GridItem>
      </Grid>

      {/* Main layout: 3 Columns - Image | Treatments | Scores+Attributes */}
      <Grid templateColumns={{ base: "1fr", lg: "0.5fr 1.5fr 1.5fr" }} gap="16px" mb="6">
        {/* Left: Recommended Treatments (Vertical, Scrollable) */}
        <GridItem position="relative" minH={{ base: "400px", lg: "0" }}>
          <Box
            position={{ base: "relative", lg: "absolute" }}
            top="0" bottom="0" left="0" right="0"
            display="flex"
            flexDirection="column"
            bg="gray.50"
            _dark={{ bg: "gray.800" }}
            borderWidth="1px"
            borderColor="gray.200"
            borderRadius="md"
            overflow="hidden"
          >
          <Box p="3" borderBottomWidth="1px" borderColor="gray.200" _dark={{ borderColor: "gray.700" }}>
            <Text fontSize="sm" fontWeight="bold" color="gray.700" _dark={{ color: "gray.200" }}>
              Treatment Options
            </Text>
            <Tooltip
              content={
                accordionView === "segment" ? (
                  <Text>
                    <b>By Segment:</b> View and apply treatments for the current segment only.
                  </Text>
                ) : (
                  <Text>
                    <b>By Treatment:</b> View and apply a single treatment across all applicable segments.
                  </Text>
                )
              }
              showArrow
              openDelay={400}
              contentProps={{ maxW: "250px" }}
            >
              <Box mt="2">
                <select
                  value={accordionView}
                  onChange={(e) => {
                    setAccordionView(e.target.value as "segment" | "treatment");
                    setSelectedTreatments(new Set());
                  }}
                  style={{
                    width: "100%",
                    padding: "6px",
                    borderRadius: "6px",
                    border: "1px solid var(--chakra-colors-gray-300)",
                    backgroundColor: "white",
                    color: "inherit",
                    fontSize: "14px",
                    cursor: "pointer",
                  }}
                  className="theme-select"
                >
                  <option value="segment">By Segment</option>
                  <option value="treatment">By Treatment</option>
                </select>
              </Box>
            </Tooltip>
          </Box>

          <Box flex="1" overflowY="auto" p="3">
            {(() => {
              let displayTreatments: Treatment[] = [];
              const currentAttr = attrs[currentIndex] as any;
              
              if (accordionView === "segment") {
                if (!currentAttr) {
                  return <Text fontSize="xs" color="gray.400">No segment data</Text>;
                }
                displayTreatments = getApplicableTreatments(currentAttr)
                  .sort((a, b) => (segmentScoreDrops[b.id] ?? 0) - (segmentScoreDrops[a.id] ?? 0));
              } else {
                if (effectivenessLoading) {
                  return (
                    <Flex direction="column" align="center" justify="center" gap="3" py="8">
                      <Spinner size="sm" color="blue.500" />
                      <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
                        Ranking Treatment Options...
                      </Text>
                    </Flex>
                  );
                }
                displayTreatments = allApplicableTreatments.filter(t =>
                  (effectivenessCounts[t.id] ?? 0) > 0
                );
              }

              if (displayTreatments.length === 0) {
                return (
                  <Text fontSize="xs" color="gray.400" _dark={{ color: "gray.500" }}>
                    {accordionView === "segment" ? "No treatments applicable" : "No treatments applicable in whole project"}
                  </Text>
                );
              }

              return (
                <Flex direction="column" gap="2">
                  {displayTreatments.map((t) => {
                    const isApplied = accordionView === "segment" 
                      ? (treatmentState[currentIndex]?.applied && treatmentState[currentIndex]?.treatment_ids.includes(t.id))
                      : fullyAppliedTreatments.has(t.id);
                      
                    const isDisabled = isApplied;

                    return (
                      <Flex
                        key={t.id}
                        gap="2"
                        align="flex-start"
                        p="2"
                        borderRadius="md"
                        bg={
                          isApplied
                            ? "green.50"
                            : selectedTreatments.has(t.id)
                              ? "blue.50"
                              : "white"
                        }
                        borderWidth="1px"
                        borderColor={
                          isApplied
                            ? "green.200"
                            : selectedTreatments.has(t.id)
                              ? "blue.200"
                              : "gray.200"
                        }
                        cursor={isDisabled ? "not-allowed" : "pointer"}
                        opacity={isDisabled ? 0.6 : 1}
                        transition="all 0.2s"
                        _hover={{
                          borderColor: isDisabled ? undefined : "blue.300",
                          shadow: isDisabled ? undefined : "sm"
                        }}
                        _dark={{
                          bg: isApplied
                            ? "green.900"
                            : selectedTreatments.has(t.id)
                              ? "blue.900"
                              : "gray.700",
                          borderColor: isApplied
                            ? "green.700"
                            : selectedTreatments.has(t.id)
                              ? "blue.700"
                              : "gray.600",
                        }}
                        onClick={() => {
                          if (isDisabled) return;
                          const newSelected = new Set(selectedTreatments);
                          if (newSelected.has(t.id)) {
                            newSelected.delete(t.id);
                          } else {
                            newSelected.add(t.id);
                          }
                          setSelectedTreatments(newSelected);
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isApplied || selectedTreatments.has(t.id)}
                          disabled={isDisabled}
                          onChange={() => { }}
                          style={{ marginTop: '3px', cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                          aria-label={`Select treatment: ${t.name}`}
                        />
                        <Box flex="1">
                          <Text fontSize="xs" fontWeight="medium" color="gray.900" _dark={{ color: "white" }} lineHeight="1.2">
                            {t.name}
                            {isApplied && " ✓"}
                          </Text>
                          {accordionView === "treatment" && (
                            <Text fontSize="2xs" color="blue.600" _dark={{ color: "blue.300" }} mt="1" fontWeight="semibold">
                              {(() => {
                                const count = effectivenessCounts[t.id] ?? 0;
                                const applicable = applicableCounts[t.id] ?? 0;
                                const denominator = applicable > 0 ? applicable : attrs.length;
                                const pct = (denominator > 0 && count > 0) ? count / denominator * 100 : 0;
                                const display = count > 0 ? Math.max(0.1, pct).toFixed(1) : "0.0";
                                const scope = applicable > 0 ? "applicable segments" : "segments";
                                return `Improves ${display}% of ${scope}`;
                              })()}
                            </Text>
                          )}
                          {accordionView === "segment" && segmentScoreDrops[t.id] !== undefined && (
                            <Text fontSize="2xs" color="blue.600" _dark={{ color: "blue.300" }} mt="1" fontWeight="semibold">
                              {`Score drop: ${segmentScoreDrops[t.id].toFixed(1)}`}
                            </Text>
                          )}
                          {t.description && (
                            <Text fontSize="2xs" color="gray.500" _dark={{ color: "gray.400" }} mt="1">
                              {t.description}
                            </Text>
                          )}
                        </Box>
                      </Flex>
                    );
                  })}
                </Flex>
              );
            })()}
          </Box>

          {/* Action Buttons Footer */}
          <Box p="3" borderTopWidth="1px" borderColor="gray.200" bg="white" _dark={{ borderColor: "gray.700", bg: "gray.800" }}>
            <Flex direction="column" gap="2">
              <Flex gap="2">
                <Button
                  flex="1"
                  size="xs"
                  variant="outline"
                  colorScheme={selectedTreatments.size > 0 ? "red" : "blue"}
                  disabled={
                    (() => {
                      if (accordionView === "segment") {
                        const currentAttr = attrs[currentIndex] as any;
                        if (!currentAttr) return true;
                        const applicable = getApplicableTreatments(currentAttr);
                        const appliedIds = treatmentState[currentIndex]?.treatment_ids ?? [];
                        return applicable.every(t => appliedIds.includes(t.id));
                      } else {
                        return allApplicableTreatments.length === 0;
                      }
                    })()
                  }
                  onClick={() => {
                    if (selectedTreatments.size > 0) {
                      setSelectedTreatments(new Set());
                    } else {
                      if (accordionView === "segment") {
                        const currentAttr = attrs[currentIndex] as any;
                        if (!currentAttr) return;
                        const applicable = getApplicableTreatments(currentAttr);
                        const appliedIds = treatmentState[currentIndex]?.treatment_ids ?? [];
                        setSelectedTreatments(new Set(applicable.filter(t => !appliedIds.includes(t.id)).map(t => t.id)));
                      } else {
                        setSelectedTreatments(new Set(allApplicableTreatments.map(t => t.id)));
                      }
                    }
                  }}
                >
                  {selectedTreatments.size > 0 ? "Clear" : "All"}
                </Button>
                {accordionView === "segment" && treatmentState[currentIndex]?.applied && (
                  <Button
                    flex="1"
                    size="xs"
                    variant="ghost"
                    colorScheme="red"
                    loading={applyLoading}
                    onClick={handleResetTreatments}
                  >
                    Reset
                  </Button>
                )}
              </Flex>

              <Flex width="full" gap="2" align="stretch" wrap="wrap">
                <Menu.Root positioning={{ placement: "bottom-start", strategy: "fixed" }}>
                  <Menu.Trigger asChild>
                    <Button
                      size="sm"
                      minW="118px"
                      variant="outline"
                      aria-label="Copy treatment prompt"
                      disabled={!hasApplied && !hasSelected}
                      loading={copyButtonState === "copying"}
                      gap="1"
                    >
                      {copyButtonState === "copied" ? <LuCheck /> : <LuCopy />}
                      <span>{copyButtonLabel}</span>
                      <LuChevronDown />
                    </Button>
                  </Menu.Trigger>
                  <Menu.Positioner>
                    <Menu.Content zIndex={1500}>
                      <Menu.Item
                        value="copy-applied"
                        disabled={!hasApplied}
                        onClick={() => { void handleCopyTreatmentPrompt(appliedTreatmentIds); }}
                      >
                        Copy Applied
                      </Menu.Item>
                      <Menu.Item
                        value="copy-selected"
                        disabled={!hasSelected}
                        onClick={() => { void handleCopyTreatmentPrompt(Array.from(selectedTreatments)); }}
                      >
                        Copy Selected
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Positioner>
                </Menu.Root>
                <Button
                  size="sm"
                  minW="108px"
                  variant="outline"
                  aria-label="Copy current image"
                  title="Copy current image"
                  disabled={!currentImageUrl}
                  loading={imageCopyButtonState === "copying"}
                  gap="1"
                  onClick={() => {
                    void handleCopyCurrentImage();
                  }}
                >
                  {imageCopyButtonState === "copied" ? <LuCheck /> : <LuImage />}
                  <span>{imageCopyButtonLabel}</span>
                </Button>
                <Button
                  size="sm"
                  flex="1"
                  variant="solid"
                  colorScheme={accordionView === "segment" && treatmentState[currentIndex]?.applied && selectedTreatments.size === 0 ? "green" : "blue"}
                  disabled={selectedTreatments.size === 0 || applyLoading}
                  loading={applyLoading}
                  onClick={async () => {
                    if (accordionView === "segment") {
                      handleApplyTreatments();
                    } else {
                       if (selectedTreatments.size === 0 || !currentCtx) return;
                       setOpenConfirmAlert(true);
                    }
                  }}
                >
                  {accordionView === "segment" && treatmentState[currentIndex]?.applied && selectedTreatments.size === 0
                    ? "Applied ✓"
                    : `Apply (${selectedTreatments.size})`}
                </Button>
              </Flex>
            </Flex>
          </Box>
          </Box>
        </GridItem>

        {/* Middle: Image Panel + Navigation Controls */}
        <GridItem
          display="flex"
          flexDirection="column"
          minH={`${PANEL_HEIGHT}px`}
        >
          {/* Navigation Controls */}
          <Flex
            flex="0 0 auto"
            h={`${CONTROLS_H}px`}
            w="100%"
            minW={0}
            align="center"
            gap="2"
            mb="4"
            position="relative"
            zIndex={1}
            bg="bg"
          >
            <Button
              flex="1"
              minW={0}
              size="sm"
              variant="outline"
              onClick={() => gotoPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              Previous
            </Button>

            <Button
              flex="1"
              minW={0}
              size="sm"
              variant="solid"
              onClick={() => gotoPage(currentPage + 1)}
              disabled={currentPage >= len}
            >
              Next
            </Button>
          </Flex>

          <Box flex="1 1 auto" minH={0} display="flex" flexDirection="column">
            <Box flex="1 1 50%" minH={0} display="flex" flexDirection="column">
              <ImagePanel
                projectName={currentCtx?.name}
                imageRef={imgRef}
              />
            </Box>
            <Box flex="1 1 50%" minH={0} display="flex" flexDirection="column">
              <PostTreatmentImageUpload
                projectName={currentCtx?.name || ""}
                segmentIndex={currentIndex + 1}
              />
            </Box>
          </Box>
        </GridItem>

        {/* Right: Crash Type Scores + Attributes Panel */}
        <GridItem
          display="flex"
          flexDirection="column"
          gap="4"
        >
          <Box
            bg="white"
            borderRadius="md"
            p="1"
            borderWidth="1px"
            borderColor="gray.200"
            _dark={{ bg: "gray.800", borderColor: "gray.600" }}
          >
            <SegmentScoresCard
              scores={(() => {
                const originalScores = scores[currentIndex] as any || null;
                const appliedAfterScores = treatmentState[currentIndex]?.after_scores;
                const appliedScoreRow = appliedAfterScores
                  ? {
                    ...scores[currentIndex],
                    BB: appliedAfterScores.BB,
                    BP: appliedAfterScores.BP,
                    SB: appliedAfterScores.SB,
                    VB: appliedAfterScores.VB,
                    "Overall Risk Level": appliedAfterScores.total,
                  } as any
                  : originalScores;

                if (!showPostTreatment) {
                  // Pre-treatment: always show original scores
                  return originalScores;
                }

                if (selectedTreatments.size > 0) {
                  // Treatments are selected: show preview scores once loaded.
                  if (previewLoading || !previewScores) {
                    return appliedScoreRow;
                  }

                  return {
                    ...scores[currentIndex],
                    BB: previewScores.BB,
                    BP: previewScores.BP,
                    SB: previewScores.SB,
                    VB: previewScores.VB,
                    "Overall Risk Level": previewScores.total
                  } as any;
                }

                if (appliedAfterScores) {
                  // Treatments have been applied: show real after-treatment scores.
                  return appliedScoreRow;
                }

                // No treatments selected or applied: show original scores
                return originalScores;
              })()}
              beforeScores={
                showPostTreatment && (treatmentState[currentIndex]?.applied || selectedTreatments.size > 0)
                  ? {
                    BB: scores[currentIndex]?.["BB"] ?? 0,
                    BP: scores[currentIndex]?.["BP"] ?? 0,
                    SB: scores[currentIndex]?.["SB"] ?? 0,
                    VB: scores[currentIndex]?.["VB"] ?? 0,
                    "Overall Risk Level": scores[currentIndex]?.["Overall Risk Level"] ?? 0,
                  }
                  : undefined
              }
              showPreviewBackground={
                showPostTreatment && selectedTreatments.size > 0
              }
              projectContributors={projectContributors}
              onContributorClick={handleContributorClick}
            />
          </Box>

          <Box
            flex="1"
            minH="0"
            overflow="hidden"
            bg="white"
            borderRadius="md"
            borderWidth="1px"
            borderColor="gray.200"
            _dark={{ bg: "gray.800", borderColor: "gray.600" }}
            display="flex"
            flexDirection="column"
          >
            <Flex
              p="2"
              borderBottomWidth="1px"
              borderColor="gray.200"
              _dark={{ borderColor: "gray.700" }}
              align="center"
              justify="space-between"
            >
              <Text fontSize="sm" fontWeight="bold">
                Attributes
              </Text>
              <Flex align="center" gap="2">
                <Text fontSize="xs">Show Post-Treatment</Text>
                <Switch
                  checked={showPostTreatment}
                  onCheckedChange={(e: any) => setShowPostTreatment(e.checked)}
                />
              </Flex>
            </Flex>
            <Box flex="1" minH="0">
              <AttributesPanel
                row={
                  showPostTreatment && (treatmentState[currentIndex]?.applied || selectedTreatments.size > 0)
                    ? modifiedAttrs
                    : attrs[currentIndex]
                }
                mappings={attrMappings}
                changedFields={
                  showPostTreatment ? Array.from(changedAttributes) : []
                }
                // changedFieldSources prop name was redundant? AttributesPanel accepts fieldSources
                fieldSources={
                  showPostTreatment ? changedFieldSources : {}
                }
                highlightMessage="Modified by treatment"
                activeGroupTab={activeAttributeGroupTab}
                readOnly={true}
              />
            </Box>
          </Box>
        </GridItem>
      </Grid>

      {/* Overall Analysis Footer */}
      <Box mt="6">
        <OverallTreatmentAnalysis
          beforeBandCounts={beforeBandCounts}
          afterBandCounts={afterBandCounts}
        />
      </Box>

      {/* Confirm Apply All Dialog */}
      <Dialog.Root open={openConfirmAlert} onOpenChange={(d) => setOpenConfirmAlert(d.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Apply Treatments to {isAllScope ? "All Projects" : activeProject}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <p>Are you sure you want to apply the following treatments to all eligible segments in {isAllScope ? "all loaded projects" : activeProject}?</p>
                <ul style={{ marginTop: "0.5rem", paddingLeft: "1.25rem" }}>
                  {Array.from(selectedTreatments).map(id => {
                    const t = TREATMENTS.find(tr => tr.id === id);
                    return <li key={id}><strong>{t ? t.name : `Treatment ${id}`}</strong></li>;
                  })}
                </ul>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" disabled={applyLoading}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button colorPalette="blue" onClick={handleConfirmApplyToAll} loading={applyLoading}>
                  Confirm
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

    </Box>
  );
}
