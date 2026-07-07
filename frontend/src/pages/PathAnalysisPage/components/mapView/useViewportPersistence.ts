/**
 * useViewportPersistence.ts — mount-time restore of the persisted Path
 * Analysis map viewport.
 *
 * Single responsibility: read the viewport saved by `<ViewportPersister>`
 * (leafletHelpers.tsx) exactly once at mount and expose stable refs the map
 * view uses to (a) seed `<MapContainer center/zoom>` and (b) skip the
 * auto-fit when a saved viewport exists (returning from the Coding page must
 * land on the exact view the user left — see CLAUDE.md "Slow Reload + Flash +
 * Lost View"). Extracted from PathAnalysisMapView.tsx [S2.1].
 */

import { useRef } from "react";
import { SESSION_KEYS } from "../../../../constants/sessionKeys";
import type { SavedViewport } from "./leafletHelpers";

/**
 * Reads SESSION_KEYS.PA_MAP_VIEWPORT ("pathAnalysisMap_viewport") once at
 * mount.
 *
 * @returns stable refs:
 *  - `savedViewport` — the parsed viewport, or null when absent/unreadable.
 *    The data-load effect checks this to decide whether to auto-fit.
 *  - `initialCenter` / `initialZoom` — saved values, falling back to the
 *    Singapore default center [1.3521, 103.8198] / zoom 13.
 *
 * Side effects: one sessionStorage read at mount (never writes — writing is
 * `<ViewportPersister>`'s job; clearing is the Projects page's job).
 */
export function useViewportPersistence() {
  // Default center (Singapore)
  // Read the persisted viewport once at mount. When present (returning from the
  // Coding page) the map opens there and skips the auto-fit; when absent (fresh
  // Projects-page load) it falls back to the Singapore default and auto-fits.
  const savedViewport = useRef<SavedViewport | null>(
    (() => {
      try {
        const s = sessionStorage.getItem(SESSION_KEYS.PA_MAP_VIEWPORT);
        return s ? (JSON.parse(s) as SavedViewport) : null;
      } catch { return null; }
    })()
  );
  const initialCenter = useRef<[number, number]>(savedViewport.current?.center ?? [1.3521, 103.8198]);
  const initialZoom = useRef<number>(savedViewport.current?.zoom ?? 13);

  return { savedViewport, initialCenter, initialZoom };
}
