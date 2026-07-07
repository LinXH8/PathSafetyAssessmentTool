/**
 * leafletHelpers.tsx — small react-leaflet child components used by the Path
 * Analysis map view (`PathAnalysisMapView.tsx`).
 *
 * Single responsibility: map-event side-effect components extracted from the
 * map-view monolith [S2.1]. Each renders `null` and only interacts with the
 * Leaflet map instance (pan / fit / viewport reporting / viewport persistence /
 * size invalidation), plus the `MaybePortal` render helper used by the v2
 * layout to relocate controls. This file exports components only (fast-refresh
 * rule); the viewport-restore hook lives in `useViewportPersistence.ts`.
 */

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { SESSION_KEYS } from "../../../../constants/sessionKeys";

// Shape of the persisted map viewport (center + zoom).
// Key: SESSION_KEYS.PA_MAP_VIEWPORT ("pathAnalysisMap_viewport").
export type SavedViewport = { center: [number, number]; zoom: number };

/** Pans/fits the map to `bounds` whenever a non-null bounds value is provided. */
export function PanToBounds({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [bounds, map]);
  return null;
}

/** Auto-fits the map to `points` — only while `shouldFit` is true (initial load). */
export function FitBounds({ points, shouldFit }: { points: [number, number][]; shouldFit: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length || !shouldFit) return;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [points, map, shouldFit]);
  return null;
}

/**
 * Reports live viewport bounds after pan/zoom so the parent can cull off-screen
 * markers. Uses a ref-stable callback so React batches marker mount/unmount
 * after the gesture ends.
 */
export function ViewportWatcher({ onBoundsChange }: { onBoundsChange: (b: L.LatLngBounds) => void }) {
  const map = useMap();
  const cbRef = useRef(onBoundsChange);
  cbRef.current = onBoundsChange;

  useEffect(() => { cbRef.current(map.getBounds()); }, [map]);

  useMapEvents({
    moveend: (e) => cbRef.current(e.target.getBounds()),
    zoomend: (e) => cbRef.current(e.target.getBounds()),
  });
  return null;
}

/**
 * Persists the live map center/zoom to sessionStorage
 * (SESSION_KEYS.PA_MAP_VIEWPORT) on every pan/zoom so returning from the
 * Coding page lands on the exact view the user left (rather than re-fitting to
 * all points). Cleared on a deliberate Projects-page reselect.
 * Side effect: sessionStorage write on moveend/zoomend.
 */
export function ViewportPersister() {
  const map = useMap();
  const save = () => {
    try {
      const c = map.getCenter();
      sessionStorage.setItem(
        SESSION_KEYS.PA_MAP_VIEWPORT,
        JSON.stringify({ center: [c.lat, c.lng], zoom: map.getZoom() } as SavedViewport)
      );
    } catch { /* sessionStorage unavailable — ignore */ }
  };
  useMapEvents({ moveend: save, zoomend: save });
  return null;
}

/**
 * Forces Leaflet to recalculate the container size after mount.
 * Necessary when the map is inside a flex/scroll container that applies
 * its final height after Leaflet has already initialised.
 */
export function MapInvalidateSize() {
  const map = useMap();
  useEffect(() => {
    // Initial pass (fires moveend so marker culling re-runs).
    const id = setTimeout(() => { map.invalidateSize(); map.fire('moveend'); }, 0);
    // Second pass once the v2 card height has settled + observe container resizes,
    // mirroring the Coding / Create-Project fix for the half-grey-tiles bug.
    const settle = window.setTimeout(() => map.invalidateSize(), 200);
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(map.getContainer());
    } catch { /* ResizeObserver unsupported — the timeouts still cover mount */ }
    return () => { clearTimeout(id); clearTimeout(settle); ro?.disconnect(); };
  }, [map]);
  return null;
}

/**
 * Renders `children` inline (`to === undefined`, the v1 default), into a portal
 * (`to` is a DOM node, v2 with the host mounted), or nothing (`to === null`, v2
 * before the host mounts). Lets the v2 layout relocate the project / category
 * toggle UI into the left "Current Filters" accordion while the map view keeps
 * owning all of its state — no state lift required.
 */
export function MaybePortal({
  to,
  children,
}: {
  to?: HTMLElement | null;
  children: ReactNode;
}) {
  if (to === undefined) return <>{children}</>;
  if (to === null) return null;
  return createPortal(children, to);
}
