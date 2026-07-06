/**
 * useFilterState.ts — filter / focus / toggle state for the Path Analysis map
 * view (`PathAnalysisMapView.tsx`).
 *
 * Single responsibility: owns the sessionStorage-backed filter UI state
 * extracted from the map-view monolith [S2.1] —
 *  - `attrMappings` (numeric attribute code → text label; sync-initialised
 *    from the shared cache to avoid the "all segments then filtered" flash,
 *    see CLAUDE.md),
 *  - per-attribute category toggles, per-child-attribute subcategory toggles,
 *    numeric range filters,
 *  - the sidebar tab index (`categoryFilterAttributeIndex`, -1 = Projects tab)
 *    and the colouring focus (`primaryFocusAttribute`),
 * plus the effects that keep them coherent (persistence, auto-focus of newly
 * added filters, out-of-bounds reset, revert-to-project on empty filters).
 *
 * Side effects: sessionStorage reads at mount + writes on every state change
 * (keys SESSION_KEYS.PA_MAP_CATEGORY_TOGGLES / PA_MAP_SUBCATEGORY_TOGGLES /
 * PA_MAP_RANGE_FILTERS / PA_MAP_CATEGORY_FILTER_INDEX / PA_MAP_PRIMARY_FOCUS —
 * exact key strings preserved); one network-backed cache read for attribute
 * mappings. Called from the map-view component (container level), never a
 * layout shell.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { getCachedAttributeMappings, getCachedAttributeMappingsSync } from "../../../../api/projectDataCache";
import { SESSION_KEYS } from "../../../../constants/sessionKeys";

/**
 * @param selectedAttributes  The attributes selected via the FilterPanel
 *                            (prop of the map view). Drives `activeFilters`.
 * @returns all filter states with setters, plus the derived `activeFilters`
 *          and `categoryFilterAttribute` ("Project" when the Projects tab is
 *          selected).
 */
export function useFilterState(selectedAttributes: string[]) {
  const [attrMappings, setAttrMappings] = useState<Record<string, Record<string, string>>>(
    () => getCachedAttributeMappingsSync() ?? {}
  );

  // Category toggle states — tracks per-attribute per-value visibility
  const [categoryToggles, setCategoryToggles] = useState<Record<string, Record<string, boolean>>>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEYS.PA_MAP_CATEGORY_TOGGLES);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  // Subcategory toggle states — tracks per-child-attr per-value visibility (Layer 3)
  const [subcategoryToggles, setSubcategoryToggles] = useState<Record<string, Record<string, boolean>>>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEYS.PA_MAP_SUBCATEGORY_TOGGLES);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  // Range filter states for numeric attributes
  const [rangeFilters, setRangeFilters] = useState<Record<string, [number, number]>>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEYS.PA_MAP_RANGE_FILTERS);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  // Track which attribute to show categories for in the sidebar.
  // Index -1 is reserved for the always-present "Projects" tab (colors by project).
  const [categoryFilterAttributeIndex, setCategoryFilterAttributeIndex] = useState<number>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEYS.PA_MAP_CATEGORY_FILTER_INDEX);
      return stored !== null ? Number(stored) : -1;
    } catch { return -1; }
  });

  // Track which attribute is the primary focus for coloring
  const [primaryFocusAttribute, setPrimaryFocusAttribute] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(SESSION_KEYS.PA_MAP_PRIMARY_FOCUS) || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEYS.PA_MAP_CATEGORY_TOGGLES, JSON.stringify(categoryToggles));
  }, [categoryToggles]);

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEYS.PA_MAP_SUBCATEGORY_TOGGLES, JSON.stringify(subcategoryToggles));
  }, [subcategoryToggles]);

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEYS.PA_MAP_RANGE_FILTERS, JSON.stringify(rangeFilters));
  }, [rangeFilters]);

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEYS.PA_MAP_CATEGORY_FILTER_INDEX, String(categoryFilterAttributeIndex));
  }, [categoryFilterAttributeIndex]);

  useEffect(() => {
    if (primaryFocusAttribute) {
      sessionStorage.setItem(SESSION_KEYS.PA_MAP_PRIMARY_FOCUS, primaryFocusAttribute);
    } else {
      sessionStorage.removeItem(SESSION_KEYS.PA_MAP_PRIMARY_FOCUS);
    }
  }, [primaryFocusAttribute]);

  // When all filters are reset, revert coloring to by-project
  useEffect(() => {
    if (selectedAttributes.length === 0) {
      setCategoryFilterAttributeIndex(-1);
      setPrimaryFocusAttribute("Project");
    }
  }, [selectedAttributes]);

  // Active filters = the attributes selected via FilterPanel (passed as prop)
  const activeFilters = useMemo(() => selectedAttributes, [selectedAttributes]);

  // Auto-focus the newest filter when one is added; revert coloring when the focused
  // filter is removed (otherwise primaryFocusAttribute goes stale and the map keeps
  // coloring by a filter that is no longer active).
  // Seed with the mount-time filters (restored from sessionStorage) so a remount
  // does not treat already-active filters as "newly added" and snap focus to the
  // first one — that would clobber the restored primaryFocusAttribute/index.
  const prevFiltersRef = useRef<string[]>(selectedAttributes);
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const added = activeFilters.find(f => !prev.includes(f));
    if (added) {
      const idx = activeFilters.indexOf(added);
      setCategoryFilterAttributeIndex(idx);
      setPrimaryFocusAttribute(added);
    } else if (
      primaryFocusAttribute &&
      primaryFocusAttribute !== "Project" &&
      !activeFilters.includes(primaryFocusAttribute)
    ) {
      // The focused attribute was removed — revert to project-colour mode so that
      // the tab (-1) and primaryFocusAttribute ("Project") always agree. Jumping to
      // the first remaining filter here races with the out-of-bounds reset below,
      // which forces the index to -1 and leaves primaryFocusAttribute stale.
      setCategoryFilterAttributeIndex(-1);
      setPrimaryFocusAttribute("Project");
    }
    prevFiltersRef.current = activeFilters;
  }, [activeFilters, primaryFocusAttribute]);

  // Reset sidebar index if out of bounds (fall back to the Projects tab at -1)
  useEffect(() => {
    if (categoryFilterAttributeIndex >= activeFilters.length) {
      setCategoryFilterAttributeIndex(-1);
    }
  }, [activeFilters.length, categoryFilterAttributeIndex]);

  // Load attribute mappings on mount. Served from the shared cache (adequacy
  // augmentation applied inside the loader) so a remount initialises the state
  // synchronously above and avoids the "all segments then filtered" flash.
  useEffect(() => {
    getCachedAttributeMappings()
      .then(mappings => {
        setAttrMappings(mappings);
      })
      .catch(() => {
        // Minimal fallback so at least adequacy attributes work offline
        setAttrMappings({
          "Line of Sight": { "1": "Adequate", "2": "Inadequate" },
          "Facility access": { "1": "Adequate", "2": "Inadequate" },
        });
      });
  }, []);

  // Initialize default toggles for all active filters when they change
  useEffect(() => {
    setCategoryToggles(prev => {
      const updated = { ...prev };
      for (const filterAttr of activeFilters) {
        if (!updated[filterAttr]) updated[filterAttr] = {};
      }
      return updated;
    });
  }, [activeFilters]);

  // The attribute whose categories are currently shown in the sidebar.
  // Index -1 represents the always-present "Projects" tab (colour by project).
  const categoryFilterAttribute = categoryFilterAttributeIndex === -1
    ? "Project"
    : activeFilters[categoryFilterAttributeIndex];

  return {
    attrMappings,
    categoryToggles, setCategoryToggles,
    subcategoryToggles, setSubcategoryToggles,
    rangeFilters, setRangeFilters,
    categoryFilterAttributeIndex, setCategoryFilterAttributeIndex,
    primaryFocusAttribute, setPrimaryFocusAttribute,
    activeFilters,
    categoryFilterAttribute,
  };
}
