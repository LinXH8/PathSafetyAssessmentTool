import { useEffect, useState } from "react";
import type { CodingFilterContext } from "../../../api";
import { CODING_FILTER_CONTEXT_KEY } from "../../../constants/sessionKeys";

/**
 * useFilterContext — resolves the Path-Analysis → Coding filter handshake for the
 * Coding page (`/coding/:projectNames`).
 *
 * The filter context tells the Coding page which segments were being reviewed (and
 * with what filter-derived colours) when the user drilled in from Path Analysis. It
 * is persisted to sessionStorage under `CODING_FILTER_CONTEXT_KEY` so it survives a
 * hard reload, and re-evaluated on every in-app navigation (the component is not
 * remounted between navigations).
 *
 * @param locationState — `useLocation().state` from react-router. May carry an
 *   explicit `filterContext` handshake set by the caller (PathAnalysisMapView /
 *   projects.tsx::loadProject).
 * @returns the resolved `CodingFilterContext` (or `null` when not in a filtered flow).
 *
 * Side effects: reads AND writes `sessionStorage[CODING_FILTER_CONTEXT_KEY]`.
 *
 * IMPORTANT — priority logic (see root CLAUDE.md "CodingPage: Filter Colors Leak"):
 *   1. If `location.state.filterContext` is DEFINED (even `null`) → it authoritatively
 *      sets/removes the sessionStorage key and returns that value. A `null` handshake
 *      (Projects → Coding direct load) therefore CLEARS any stale filter colours.
 *   2. If `location.state.filterContext` is `undefined` → fall back to the stored key.
 *   Preserve this ordering byte-for-byte; inverting it re-introduces the colour leak.
 */
export function useFilterContext(locationState: unknown): CodingFilterContext | null {
  const resolveFilterContext = (state: unknown): CodingFilterContext | null => {
    const fromState = (state as any)?.filterContext as CodingFilterContext | null | undefined;
    if (fromState !== undefined) {
      if (fromState) sessionStorage.setItem(CODING_FILTER_CONTEXT_KEY, JSON.stringify(fromState));
      else sessionStorage.removeItem(CODING_FILTER_CONTEXT_KEY);
      return fromState ?? null;
    }
    try {
      const stored = sessionStorage.getItem(CODING_FILTER_CONTEXT_KEY);
      return stored ? (JSON.parse(stored) as CodingFilterContext) : null;
    } catch {
      return null;
    }
  };

  const [filterContext, setFilterContext] = useState<CodingFilterContext | null>(() =>
    resolveFilterContext(locationState)
  );

  useEffect(() => {
    setFilterContext(resolveFilterContext(locationState));
  // locationState reference changes on each navigation, which is exactly when we want to re-run
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationState]);

  return filterContext;
}
