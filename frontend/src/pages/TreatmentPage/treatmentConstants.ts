/**
 * Shared, pure (no-React) constants, types and helpers for the Treatment
 * Application page. Extracted to a third module so the container
 * (`treatmentDetailPage.tsx`) and the layout shells (`layouts/*`) can both import
 * them without a container↔layout circular import (same pattern as
 * `CodingPage/codingConstants.ts`).
 */

// Re-export canonical shared types (single source of truth in api/projects).
export type { ProjectDetail, AttributesResponse } from "../../api/projects";

export type ScoreType = {
  BB: number;
  BP: number;
  SB: number;
  VB: number;
  total: number;
};

export type CopyButtonState = "idle" | "copying" | "copied" | "error";

export const PANEL_HEIGHT = 400;
export const CONTROLS_H = 32;
export const MAP_HEIGHT = 500;

// Sentinel for the "All Projects" tab — scopes the page to every loaded project.
export const ALL_PROJECTS = "__ALL__";

// ---------------------------------------------------------------------------
// Treatment catalog (CycleRAP v2.14 STM)
//
// The catalog is no longer hardcoded here: the backend is the single source
// of truth (`backend/app/services/data/stm_v214_treatments.json`, served via
// `GET /api/projects/:name/treatments/catalog`). Call `loadTreatmentCatalog`
// once per session (the Treatment page container does this on mount); the
// module-level `TREATMENTS` array is filled in place so the existing pure
// helpers keep working.
// ---------------------------------------------------------------------------

export type TriggerRange = { ge?: number; gt?: number; lt?: number; le?: number };

export type TriggerSet = {
  // AND across attributes; OR across the listed category codes per attribute
  attrs: Record<string, number[]>;
  aadt?: TriggerRange;   // Road AADT range bounds
  speed?: TriggerRange;  // Road operating speed (mean) range bounds
};

export type Treatment = {
  id: number;
  name: string;
  description?: string;
  unit_scope?: "kmh" | "mph" | null;
  requires_manual_value?: boolean;
  // Applicable when ANY trigger set fully matches
  trigger_sets: TriggerSet[];
  // Attribute overrides applied when the treatment is selected
  effects: Record<string, number>;
};

/** Filled by `loadTreatmentCatalog()`; empty until the catalog has loaded. */
export const TREATMENTS: Treatment[] = [];

let catalogPromise: Promise<Treatment[]> | null = null;

/**
 * Fetch the v2.14 treatment catalog from the backend (once per SPA session)
 * and populate the module-level `TREATMENTS` array in place.
 */
export const loadTreatmentCatalog = (project: string): Promise<Treatment[]> => {
  if (!catalogPromise) {
    catalogPromise = fetch(
      `/api/projects/${encodeURIComponent(project)}/treatments/catalog`
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        TREATMENTS.length = 0;
        TREATMENTS.push(...(data.treatments as Treatment[]));
        return TREATMENTS;
      })
      .catch((err) => {
        catalogPromise = null; // allow retry
        throw err;
      });
  }
  return catalogPromise;
};

const SPEED_UNIT_ATTR = "Road operating speed (unit)";
const ROAD_AADT_ATTR = "Road AADT";
const ROAD_SPEED_ATTR = "Road operating speed (mean)";

const rangeHolds = (value: number, r: TriggerRange): boolean =>
  !(
    (r.ge !== undefined && !(value >= r.ge)) ||
    (r.gt !== undefined && !(value > r.gt)) ||
    (r.lt !== undefined && !(value < r.lt)) ||
    (r.le !== undefined && !(value <= r.le))
  );

const asNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
};

export const TREATMENT_COPY_BASE_PROMPT =
  "Using this image, create an image with the following recommendations to improve the cycling or pedestrian facility shown, but do not change the original structure of the facility, such that renovations can be done quickly and efficiently. Important markings and delineation marks on the pathways and roads should be preserved. Use Singapore context of cycling path red markings and shared path dashed red lines where appropriate:";

// NOTE: keyed by CycleRAP v2.14 STM treatment IDs.
export const TREATMENT_COPY_PRIORITY = [19, 25, 21, 17, 8, 6, 13, 24, 1, 4, 7, 11, 14, 15, 23];

export const TREATMENT_COPY_LINES: Partial<Record<number, string>> = {
  1: "* Upgrade to on-road bicycle lane with light segregation - Convert one lane of the road space into a dedicated on-road bicycle lane, separated from moving traffic using light segregation measures. In the Singapore context, this includes flexible delineator posts, kerb or low-profile armadillo kerbs.",
  4: "* Upgrade to cycling-priority street - Redesign the road to give cyclists primary right of way, with motor vehicles as guests. Apply surface treatments, signage, and traffic calming measures consistent with a cycling-priority or bicycle street layout, referencing overseas's low-traffic, low speed neighbourhood concepts e.g. in Netherlands, UK.",
  6: "* Upgrade to multi-use path - Convert the existing facility into a clearly designated shared path for both cyclists and pedestrians. Apply shared path markings, the standard cyclist-and-pedestrian dual-symbol signage used on Singapore LTA cycling shared paths, and appropriate surface treatments.",
  7: "* Upgrade to off-road bicycle path - Physically separate the cycling facility from motor traffic by constructing a dedicated off-road path. This may involve a new alignment set back from the road, kerb separation, or a fully independent corridor consistent with Singapore's Park Connector Network or Cycling Path Network standards.",
  8: "* Convert to one-way facility - Redesign the facility to carry cyclists in a single direction only. Apply appropriate one-way signage, directional road markings, and physical channelling for one-way cycling paths.",
  11: "* Install light segregation - Add low-profile physical separators between the cycling facility and adjacent motor traffic or pedestrian zones. In the Singapore context, this includes flexible delineator posts, painted islands, kerb segments, vegetation planting.",
  13: "* Remove fixed obstacles - Remove permanently installed objects that obstruct or reduce the usable width of the path or road. In the Singapore context, this includes lamp posts, traffic signal poles, bollards, fire hydrant boxes, bus shelter pillars, sheltered walkway columns, utility cabinets, and permanently anchored signage poles.",
  14: "* Remove non-fixed obstacles - Clear temporary or moveable objects that are obstructing the path or road. This includes traffic cones, water-filled barriers, bicycles, PMDs or motorcycles parked across the path, food cart trolleys, potted plants, rubbish bins, construction hoarding or construction equipment that has not been permanently installed.",
  15: "* Remove width restrictions - Eliminate physical pinch points that artificially narrow the usable width of the facility. In the Singapore context, this includes swing gates, narrow cattle-grid barriers at park connector entry points, and overgrown vegetation or signage encroaching on path edges. At bus stop, bypass path can be created behind the bus stops for cyclists to pass by instead of cycling in front of the bus stop.",
  17: "* Redesign sharp curves - Smooth out tight bends or acute-angle turns in the path or road. In the Singapore context, this applies to 90 degree path connections, underpass entry/exit curves, and path corners near road crossings that create blind spots or force cyclists to slow sharply.",
  19: "* Widen the facility - Increase the width of the existing path, track, or road shown in this image. In the Singapore context, this may involve extending footpath edges, expanding shared paths along LTA cycling paths or park connectors, or widening cycling strips adjacent to roads.",
  21: "* Improve delineation - Add or refresh visual markings that separate cyclists from pedestrians or vehicles. This includes painted centrelines, shared path symbols, directional arrows, colour-differentiated surfaces (e.g. red), zebra crossing markings, dashed white lines for signalised crossings and tactile guidance strips commonly found on Singapore cycling paths and footpaths.",
  23: "* Improve crossing facility - Upgrade the provision for cyclists or pedestrians to cross a road or junction. In the Singapore context, this includes adding demarcated crossings, extending crossing times at signalised junctions, adding kerb cut ramps, or introducing a dedicated cycling crossing at signalised intersections. Can consider more advance feature like adaptive signals for pedestrian/cyclist crossing, or scramble walk crossing, if there is already existing crossing.",
  24: "* Evaluate grade separation - Assess the feasibility of introducing a dedicated cycling overpass or underpass to eliminate at-grade conflicts between cyclists/pedestrians and motor vehicles. Reference existing Singapore examples such as underpasses, overhead cycling bridges.",
  25: "* Reconfigure/remove parking - Remove or relocate on-street parking lots, motorcycle bays, or loading/unloading zones that encroach on or are adjacent to the cycling or pedestrian facility. This includes HDB estate carpark aprons, street-side parking lots marked with yellow kerb lines, and illegally parked vehicles.",
};

export const getTreatmentDescription = (t: Treatment): string => {
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

export const buildTreatmentCopyMessage = (treatmentIds: number[]): string => {
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

export const buildProjectImageUrl = (projectName: string, imageRef: string): string =>
  `/api/projects/${encodeURIComponent(projectName)}/images/${encodeURIComponent(imageRef)}`;

export const copyTextToClipboard = async (text: string): Promise<void> => {
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

export const copyRichContentToClipboard = async ({
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

// Helper to check if treatment is applicable based on current attributes.
// Mirrors backend `treatment_catalog.is_treatment_applicable` (STM rows
// 5/6/7/8/9): missing values fail the set, except the speed unit which
// defaults to 1 (km/h).
export const isTreatmentApplicable = (treatment: Treatment, attrs: Record<string, any>): boolean => {
  if (!treatment.trigger_sets || treatment.trigger_sets.length === 0) return false;
  return treatment.trigger_sets.some((set) => {
    for (const [attrName, validValues] of Object.entries(set.attrs)) {
      let value = asNumber(attrs[attrName]);
      if (value === null && attrName === SPEED_UNIT_ATTR) value = 1;
      if (value === null || !validValues.includes(Math.trunc(value))) return false;
    }
    if (set.aadt) {
      const aadt = asNumber(attrs[ROAD_AADT_ATTR]);
      if (aadt === null || !rangeHolds(aadt, set.aadt)) return false;
    }
    if (set.speed) {
      const speed = asNumber(attrs[ROAD_SPEED_ATTR]);
      if (speed === null || !rangeHolds(speed, set.speed)) return false;
    }
    return true;
  });
};

// Helper to get all applicable treatments for current segment. Treatments
// whose outcome needs a manually chosen value (e.g. "Vehicles speed control")
// are hidden; mph variants are inert on km/h data via their unit trigger.
export const getApplicableTreatments = (attrs: Record<string, any>): Treatment[] => {
  return TREATMENTS.filter(
    (t) => !t.requires_manual_value && isTreatmentApplicable(t, attrs)
  );
};

// Apply treatment effects to attributes
export const applyTreatmentEffects = (
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

// Convert score to band (1-4) based on crash type.
// v2.14 thresholds are INCLUSIVE upper bounds (must match the backend
// `calculate_risk_band_for_type`).
export const calculateBandFromScore = (score: number, type: 'BB' | 'BP' | 'SB' | 'VB' = 'VB'): number => {
  // BB, BP, SB thresholds: <=5, <=10, <=20
  if (type === 'BB' || type === 'BP' || type === 'SB') {
    if (score <= 5) return 1;
    if (score <= 10) return 2;
    if (score <= 20) return 3;
    return 4;
  }

  // VB and default thresholds: <=10, <=25, <=60
  if (score <= 10) return 1;
  if (score <= 25) return 2;
  if (score <= 60) return 3;
  return 4;
};

// Calculate band distributions for pie charts
export const calculateBandDistributions = (scoreRows: any[]) => {
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
