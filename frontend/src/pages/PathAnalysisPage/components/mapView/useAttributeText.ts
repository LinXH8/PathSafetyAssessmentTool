/**
 * useAttributeText.ts — attribute value → display/filter text derivation for
 * the Path Analysis map view (`PathAnalysisMapView.tsx`).
 *
 * Single responsibility: pure derivation callbacks extracted from the map-view
 * monolith [S2.1] that convert raw attribute codes / score rows into the text
 * labels the category toggles, colour maps and table cells are keyed by:
 *  - `getAttrText` — generic code→label via `attrMappings`, mirroring backend
 *    defaults (blank adequacy attrs → "Adequate", blank presence attrs →
 *    "Not Present") so default-valued segments aren't dropped from the map,
 *  - safety band / grade / crossing-type specialisations,
 *  - `getFilterAttributeText` / `getFocusedAttributeValue` — the entry points
 *    used by filtering, focus colouring and the coding filter context.
 *
 * No side effects (no network/storage) — inputs come in via arguments.
 */

import { useCallback } from "react";
import type { AttributeRow } from "../../../../api";
import { ATTRIBUTE_OPTIONS, MULTI_VALUE_ATTRS, SUBCATEGORY_CHILD_ATTRS } from "../AttributesDropdown";
import {
  ADEQUACY_DEFAULT_ATTRS,
  CROSSING_TYPE_FILTER_OPTIONS,
  SAFETY_FOCUS_ATTRIBUTES,
  getGradeBucketFromPercent,
  normalizeCrossingTypeLabel,
  normalizeGradeLabel,
  type VisibleSegment,
} from "./mapViewUtils";

/**
 * @param attrMappings        Numeric attribute code → text label mappings
 *                            (from `useFilterState`).
 * @param subcategoryToggles  Per-child-attribute toggle state — used by
 *                            `getFocusedAttributeValue` to pick the first
 *                            enabled part of a multi-value attribute.
 * @returns the derivation callbacks, memoised so downstream `useMemo`s can
 *          depend on them directly.
 */
export function useAttributeText(
  attrMappings: Record<string, Record<string, string>>,
  subcategoryToggles: Record<string, Record<string, boolean>>,
) {
  // Helper function to convert numeric attribute value to text using mappings
  const getAttrText = useCallback((attrName: string, attrValue: any): string => {
    // Subcategory child attrs: null/empty/undefined → "None"
    if (SUBCATEGORY_CHILD_ATTRS.has(attrName)) {
      if (attrValue === null || attrValue === undefined || attrValue === "" || attrValue === "null") {
        return "None";
      }
    }

    // Generic null/empty handling. The backend treats a missing attribute as its
    // default code (backend/src/CycleRAP/defaults.json) rather than "unset", so we
    // mirror those defaults here: adequacy attributes default to "Adequate" (1),
    // and most presence attributes default to "Not Present" (2). Without this,
    // default-valued segments are silently dropped from the map and filters.
    if (attrValue === null || attrValue === undefined || attrValue === "" || String(attrValue).toLowerCase() === "null") {
      if (ADEQUACY_DEFAULT_ATTRS.has(attrName)) return "Adequate";
      const opts = ATTRIBUTE_OPTIONS[attrName];
      if (opts && opts.includes("Not Present")) return "Not Present";
      return ""; // no valid category — exclude this segment from toggle counts
    }

    // Handle safety score band values (VB Band, BB Band, SB Band, BP Band)
    // These map to exactly 4 categories based on score thresholds:
    // Low: <10, Medium: 10-25, High: 25-60, Extreme: >60
    if (["VB Band", "BB Band", "SB Band", "BP Band"].includes(attrName)) {
      const numValue = Number(attrValue);
      if (isNaN(numValue)) {
        return "Low"; // Default to Low if invalid
      }

      // Map backend bands to frontend categories: Low, Medium, High, Extreme
      // Note: Band 5 may still exist in old data, map it to Extreme
      const riskCategoryMap: Record<number, string> = {
        1: "Low",      // Band 1: score <10
        2: "Medium",   // Band 2: score 10-25
        3: "High",     // Band 3: score 25-60
        4: "Extreme",  // Band 4: score >60
        5: "Extreme",  // Band 5 (legacy): score >60 - treat same as Band 4
      };

      return riskCategoryMap[numValue] || "Low"; // Default to Low if unknown
    }

    // Special handling for Overall Risk Level - calculated from actual score, not a band index
    if (attrName === "Overall Risk Level") {
      // This shouldn't happen as Overall Risk Level is calculated in the filter logic,
      // but handle it gracefully just in case
      const scoreValue = Number(attrValue);
      if (isNaN(scoreValue)) return "Low";
      if (scoreValue < 10) return "Low";
      if (scoreValue <= 25) return "Medium";
      if (scoreValue <= 60) return "High";
      return "Extreme";
    }

    // If we have a mapping for this attribute, apply it (handles both string and number values from CSV)
    if (attrMappings[attrName]) {
      const key = String(attrValue);
      if (attrMappings[attrName][key]) {
        return attrMappings[attrName][key];
      }
      // Try numeric key if string key didn't work
      const numKey = Number(attrValue);
      if (!isNaN(numKey) && attrMappings[attrName][String(numKey)]) {
        return attrMappings[attrName][String(numKey)];
      }
      // Fall through to return raw value
    }

    return String(attrValue);
  }, [attrMappings]);

  /** Maps a crash-type band / Overall Risk Level score row to Low/Medium/High/Extreme. */
  const getSafetyAttributeText = useCallback((attributeName: string, segmentScores: Record<string, any> | null | undefined): string => {
    if (!segmentScores) {
      return "Low";
    }

    if (attributeName === "Overall Risk Level") {
      let maxRiskLevel = 0;

      if (segmentScores["Overall Risk Level Band"] !== undefined) {
        maxRiskLevel = (segmentScores["Overall Risk Level Band"] as number) - 1;
      } else {
        ["BB", "BP", "SB", "VB"].forEach((type) => {
          const scoreValue = Number(segmentScores[type] ?? 0);
          let riskLevel = 0;

          if (["BB", "BP", "SB"].includes(type)) {
            if (scoreValue > 20) riskLevel = 3;
            else if (scoreValue > 10) riskLevel = 2;
            else if (scoreValue >= 5) riskLevel = 1;
          } else {
            if (scoreValue > 60) riskLevel = 3;
            else if (scoreValue > 25) riskLevel = 2;
            else if (scoreValue >= 10) riskLevel = 1;
          }

          if (riskLevel > maxRiskLevel) {
            maxRiskLevel = riskLevel;
          }
        });
      }

      if (maxRiskLevel === 3) return "Extreme";
      if (maxRiskLevel === 2) return "High";
      if (maxRiskLevel === 1) return "Medium";
      return "Low";
    }

    const crashTypeKey = attributeName.replace(" Band", "");
    const scoreValue = Number(segmentScores[crashTypeKey] ?? 0);

    if (["BB", "BP", "SB"].includes(crashTypeKey)) {
      if (scoreValue < 5) return "Low";
      if (scoreValue <= 10) return "Medium";
      if (scoreValue <= 20) return "High";
      return "Extreme";
    }

    if (scoreValue < 10) return "Low";
    if (scoreValue <= 25) return "Medium";
    if (scoreValue <= 60) return "High";
    return "Extreme";
  }, []);

  /** Grade filter label — prefers the raw Gradient % bucket, falls back to the coded Grade value. */
  const getGradeFilterText = useCallback((attributes: AttributeRow): string => {
    const gradientPct = Number(attributes["Gradient %"]);
    if (!Number.isNaN(gradientPct)) {
      return getGradeBucketFromPercent(gradientPct);
    }

    const fallbackGrade = getAttrText("Grade", attributes["Grade"]);
    return normalizeGradeLabel(fallbackGrade);
  }, [getAttrText]);

  /** Canonical Crossing Type labels derived from the raw value + presence attributes. */
  const getDerivedCrossingTypes = useCallback((attributes: AttributeRow): string[] => {
    const derivedTypes = new Set<string>();
    const rawCrossingType = attributes["Crossing Type"];

    if (rawCrossingType !== null && rawCrossingType !== undefined && String(rawCrossingType).trim() !== "") {
      String(rawCrossingType)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          const normalizedType = normalizeCrossingTypeLabel(part);
          if (normalizedType) {
            derivedTypes.add(normalizedType);
          }
        });
    }

    const hasIntersectionOrRoadCrossing = getAttrText("Intersection or Road Crossing", attributes["Intersection or Road Crossing"]) === "Present";
    const hasPropertyAccess = getAttrText("Property Access", attributes["Property Access"]) === "Present";

    if (hasPropertyAccess) {
      derivedTypes.add("Development Access");
    } else if (hasIntersectionOrRoadCrossing && derivedTypes.size === 0) {
      derivedTypes.add("Unsignalised Junction");
    }

    return CROSSING_TYPE_FILTER_OPTIONS.filter((option) => derivedTypes.has(option));
  }, [getAttrText]);

  /** "Present" when a crossing facility is coded or any crossing type is derivable. */
  const getCrossingFacilityFilterText = useCallback((attributes: AttributeRow): string => {
    const rawCrossingFacility = getAttrText("Crossing Facility", attributes["Crossing Facility"]);
    if (rawCrossingFacility === "Present") {
      return "Present";
    }
    return getDerivedCrossingTypes(attributes).length > 0 ? "Present" : rawCrossingFacility;
  }, [getAttrText, getDerivedCrossingTypes]);

  /**
   * The filter-facing text for any attribute of a segment: project name,
   * safety band, grade bucket, crossing derivations, or the generic mapping.
   */
  const getFilterAttributeText = useCallback((
    attributeName: string,
    projectName: string,
    attributes: AttributeRow,
    segmentScores: Record<string, any> | null,
  ): string => {
    if (attributeName === "Project") {
      return projectName;
    }

    if (SAFETY_FOCUS_ATTRIBUTES.has(attributeName)) {
      return getSafetyAttributeText(attributeName, segmentScores);
    }

    if (attributeName === "Grade") {
      return getGradeFilterText(attributes);
    }

    if (attributeName === "Crossing Type") {
      return getDerivedCrossingTypes(attributes).join(", ");
    }

    if (attributeName === "Crossing Facility") {
      return getCrossingFacilityFilterText(attributes);
    }

    if (attributeName === "Delineation Type") {
      const delineationType = getAttrText("Delineation Type", attributes["Delineation Type"]);
      return delineationType === "None" ? "" : delineationType;
    }

    return getAttrText(attributeName, attributes[attributeName]);
  }, [getAttrText, getCrossingFacilityFilterText, getDerivedCrossingTypes, getGradeFilterText, getSafetyAttributeText]);

  /**
   * The single focus value used to colour a segment: for multi-value
   * attributes, the first part whose subcategory toggle is enabled (unknown
   * values proxy through the "Others" toggle).
   */
  const getFocusedAttributeValue = useCallback((attributeName: string, segment: VisibleSegment): string => {
    const valueText = getFilterAttributeText(attributeName, segment.projectName, segment.attributes, segment.scores);
    if (!valueText) {
      return "";
    }

    if (MULTI_VALUE_ATTRS.has(attributeName) && valueText.includes(", ")) {
      const parts = valueText.split(", ").map((part) => part.trim()).filter(Boolean);
      const toggles = subcategoryToggles[attributeName];
      return parts.find((part) => {
        // Unknown values (not in the predefined toggle set) proxy through "Others"
        const effectiveVal = (toggles && part in toggles) ? toggles[part] : toggles?.["Others"];
        return effectiveVal !== false;
      }) ?? parts[0] ?? "";
    }

    return valueText;
  }, [getFilterAttributeText, subcategoryToggles]);

  return {
    getAttrText,
    getSafetyAttributeText,
    getGradeFilterText,
    getDerivedCrossingTypes,
    getCrossingFacilityFilterText,
    getFilterAttributeText,
    getFocusedAttributeValue,
  };
}
