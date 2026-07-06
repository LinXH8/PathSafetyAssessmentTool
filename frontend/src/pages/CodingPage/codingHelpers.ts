import type { AttributeRow } from "../../api";

/**
 * Pure, side-effect-free helpers for the Coding page (`/coding/:projectNames`).
 *
 * Extracted verbatim from codingPage.tsx during the S2.3 container decomposition.
 * Everything here is a pure function or a static constant — no React, no
 * sessionStorage, no network. Shared by the container and its extracted hooks
 * (useProjectDataCache, useAutocode, useAttributeEditing).
 */

// ── Attribute-value suggestion lists (finer-attribute multi-select options) ──
export const DELINEATION_PRESENT_SUGGESTIONS = [
  "Cycling Path",
  "Red Stripe",
  "Signalised Crossing",
  "Zebra Crossing",
];

export const SLIPPERY_ISSUE_TYPE_SUGGESTIONS = ["Algae", "Leaves", "Soil", "Sand"];

// ── Legacy FO/NFO Type label migration ──
// Renamed FO Type finer-attribute labels. Applied to every project's rows as they
// load from the backend so existing data — including projects created on other
// devices that still store the old labels — displays the new names. FO Type is a
// comma-separated multi-select, so each token is migrated independently.
const FO_TYPE_RENAMES: Record<string, string> = {
  "Pillar": "Covered Linkway Pole",
  "Fence": "Railing",
  "Bollards": "Bollard",
  "Billboards": "Billboard",
  "Sign Poles": "Sign Pole",
  "Sign pole": "Sign Pole",
};

const NFO_TYPE_RENAMES: Record<string, string> = {
  "Bins": "Bin",
};

function migrateFoTypeValue(value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return value;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => FO_TYPE_RENAMES[tok] ?? tok)
    .join(", ");
}

function migrateNfoTypeValue(value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return value;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => NFO_TYPE_RENAMES[tok] ?? tok)
    .join(", ");
}

/** Rewrite legacy FO/NFO Type labels in a set of attribute rows (idempotent). */
export function migrateAttrRows(rows: AttributeRow[]): AttributeRow[] {
  return rows.map((row) => {
    let updated = row;
    if ("FO Type" in row) {
      const migrated = migrateFoTypeValue(row["FO Type"]);
      if (migrated !== row["FO Type"]) updated = { ...updated, "FO Type": migrated as AttributeRow[string] };
    }
    if ("NFO Type" in row) {
      const migrated = migrateNfoTypeValue(row["NFO Type"]);
      if (migrated !== row["NFO Type"]) updated = { ...updated, "NFO Type": migrated as AttributeRow[string] };
    }
    return updated;
  });
}

/**
 * Normalize attribute values to consistent types (convert numeric strings to
 * numbers). Used before persisting autocode baselines so stored values are
 * numerically comparable.
 */
export const normalizeAttributeValues = (attrs: AttributeRow[]): AttributeRow[] => {
  return attrs.map(row => {
    const normalized: AttributeRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) {
        normalized[key] = value;
      } else if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
        // Convert numeric strings to numbers
        normalized[key] = Number(value);
      } else {
        normalized[key] = value;
      }
    }
    return normalized;
  });
};

export type LogicCheckNotif = { description: string; isWarning: boolean };

/**
 * Apply CycleRAP attribute-coding logic rules when a single field changes.
 *
 * Given the edited `field`, its new `value`, and the row's current state,
 * returns any cascaded numeric field updates (`extraUpdates`) plus a list of
 * user-facing info/warning notifications. Pure — does not mutate `currentRow`.
 */
export function applyLogicChecks(
  field: string,
  value: string | number | boolean | null,
  currentRow: AttributeRow
): { extraUpdates: Record<string, number>; notifications: LogicCheckNotif[] } {
  const extraUpdates: Record<string, number> = {};
  const notifications: LogicCheckNotif[] = [];
  const projected = { ...currentRow, [field]: value };

  const isPresent = (v: unknown) => Number(v) === 1;
  const isZeroOrNull = (v: unknown) => {
    if (v === null || v === undefined || v === "") return true;
    const n = Number(v);
    return isNaN(n) || n === 0;
  };

  const autoDisable = (target: string, msg: string) => {
    if (isPresent(projected[target])) {
      extraUpdates[target] = 2;
      notifications.push({ description: msg, isWarning: false });
    }
  };

  const autoEnable = (target: string, msg: string) => {
    if (!isPresent(projected[target])) {
      extraUpdates[target] = 1;
      notifications.push({ description: msg, isWarning: false });
    }
  };

  const warn = (msg: string) => notifications.push({ description: msg, isWarning: true });

  // Rules 1-5: mutual exclusion between 0-1m and 1-3m adjacent fields
  const mutualPairs: Array<[string, string, string]> = [
    ["Adjacent Road Lane 0-1m", "Adjacent Road Lane 1-3m", "Adjacent Road Lane"],
    ["Adjacent Vehicle Parking 0-1m", "Adjacent Vehicle Parking 1-3m", "Adjacent Vehicle Parking"],
    ["Adjacent Severe Hazard 0-1m", "Adjacent Severe Hazard 1-3m", "Adjacent Severe Hazard"],
    ["Adjacent object or level change 0-1m", "Adjacent object or level change 1-3m", "Adjacent object or level change"],
    ["Adjacent Sidewalk 0-1m", "Adjacent Sidewalk 1-3m", "Adjacent Sidewalk"],
  ];
  for (const [near, far, label] of mutualPairs) {
    if (field === near && isPresent(value)) {
      autoDisable(far, `"${label} 1-3m" cleared (mutually exclusive with 0-1m)`);
    } else if (field === far && isPresent(value)) {
      autoDisable(near, `"${label} 0-1m" cleared (mutually exclusive with 1-3m)`);
    }
  }

  // Rule 6: Facility Type = Sidewalk → Adjacent Sidewalk 0-1m = Not Present
  if (field === "Facility Type" && Number(value) === 1) {
    autoDisable("Adjacent Sidewalk 0-1m", '"Adjacent Sidewalk 0-1m" cleared (facility is already a Sidewalk)');
  }

  // Rule 7: Facility Type = Mixed Traffic Road Lane → Adjacent Road Lane 0-1m = Present, 1-3m = Not Present
  if (field === "Facility Type" && Number(value) === 6) {
    autoEnable("Adjacent Road Lane 0-1m", '"Adjacent Road Lane 0-1m" set to Present (Mixed Traffic Road Lane)');
    autoDisable("Adjacent Road Lane 1-3m", '"Adjacent Road Lane 1-3m" cleared (Mixed Traffic Road Lane)');
  }

  // Rule 9: Width Restriction = Present → FO or NFO must be Present (warning only)
  if (field === "Width Restriction" && isPresent(value)) {
    if (!isPresent(projected["Fixed Obstacle on Facility"]) && !isPresent(projected["Non-Fixed Obstacle on Facility"])) {
      warn('"Width Restriction" is Present — set "Fixed Obstacle on Facility" or "Non-Fixed Obstacle on Facility" to Present');
    }
  }

  // Rule 10: Facility Type = Sidewalk/Multi-use/Off-road → Light Segregation = Present
  if (field === "Facility Type" && [1, 2, 3].includes(Number(value))) {
    autoEnable("Light Segregation", '"Light Segregation" set to Present');
  }

  // Rule 11: Property Access = Present → Intersection or Road Crossing = Present
  if (field === "Property Access" && isPresent(value)) {
    autoEnable("Intersection or Road Crossing", '"Intersection or Road Crossing" set to Present (Property Access implies road crossing)');
  }

  // Rule 12: Facility Type = On-road Bicycle Lane → Adjacent Road Lane 0-1m = Present
  if (field === "Facility Type" && Number(value) === 4) {
    autoEnable("Adjacent Road Lane 0-1m", '"Adjacent Road Lane 0-1m" set to Present (On-road Bicycle Lane)');
  }

  // Rules 13-14: Adjacent Road Lane 0-1m = Present → AADT and speed non-zero
  if (field === "Adjacent Road Lane 0-1m" && isPresent(value)) {
    if (isZeroOrNull(projected["Road AADT"]))
      warn('"Road AADT" should not be 0 when "Adjacent Road Lane 0-1m" is Present');
    if (isZeroOrNull(projected["Road operating speed (mean)"]))
      warn('"Road Operating Speed (mean)" should not be 0 when "Adjacent Road Lane 0-1m" is Present');
  }

  // Rules 15-16: Adjacent Road Lane 1-3m = Present → AADT and speed non-zero
  if (field === "Adjacent Road Lane 1-3m" && isPresent(value)) {
    if (isZeroOrNull(projected["Road AADT"]))
      warn('"Road AADT" should not be 0 when "Adjacent Road Lane 1-3m" is Present');
    if (isZeroOrNull(projected["Road operating speed (mean)"]))
      warn('"Road Operating Speed (mean)" should not be 0 when "Adjacent Road Lane 1-3m" is Present');
  }

  // Rules 17-18: Intersection or Road Crossing = Present → AADT and speed non-zero
  if (field === "Intersection or Road Crossing" && isPresent(value)) {
    if (isZeroOrNull(projected["Road AADT"]))
      warn('"Road AADT" should not be 0 when "Intersection or Road Crossing" is Present');
    if (isZeroOrNull(projected["Road operating speed (mean)"]))
      warn('"Road Operating Speed (mean)" should not be 0 when "Intersection or Road Crossing" is Present');
  }

  // Rules 19-20: Facility Type = Mixed Traffic Road Lane → AADT and speed non-zero
  if (field === "Facility Type" && Number(value) === 6) {
    if (isZeroOrNull(projected["Road AADT"]))
      warn('"Road AADT" should not be 0 for Mixed Traffic Road Lane');
    if (isZeroOrNull(projected["Road operating speed (mean)"]))
      warn('"Road Operating Speed (mean)" should not be 0 for Mixed Traffic Road Lane');
  }

  // Rule 21: Facility Type = Road Shoulder → Adjacent Road Lane 0-1m = Present
  if (field === "Facility Type" && Number(value) === 5) {
    autoEnable("Adjacent Road Lane 0-1m", '"Adjacent Road Lane 0-1m" set to Present (Road Shoulder)');
  }

  return { extraUpdates, notifications };
}
