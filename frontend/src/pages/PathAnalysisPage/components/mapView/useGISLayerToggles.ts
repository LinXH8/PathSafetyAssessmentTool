/**
 * useGISLayerToggles.ts — GIS overlay layer toggle state + data fetching for
 * the Path Analysis map view (`PathAnalysisMapView.tsx`).
 *
 * Single responsibility: owns the 16 per-layer visibility flags, the GIS
 * sidebar open state, and the two debounced/abortable fetches that load
 * overlay geometry — extracted from the map-view monolith [S2.1]:
 *  - POST /api/projects/gis/near-segments — every enabled layer within
 *    GIS_SEGMENT_RADIUS_M of the loaded segments (data-driven, not
 *    viewport-driven, so overlays stay put while panning).
 *  - POST /api/defects/nearby — path defects around the current viewport
 *    center (viewport-driven, refetches after pan/zoom).
 *
 * Side effects: network requests (debounced 150 ms / 500 ms, aborted on
 * re-fire). No sessionStorage. Called from the map-view component (container
 * level per UI_V2_REDESIGN_GUIDE §0 — never from a layout shell).
 */

import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import { GIS_SEGMENT_RADIUS_M } from "./mapViewUtils";

/** Fetched GIS layer geometry keyed by layer id. */
export type GISLayersData = Record<string, any[]>;

/** A single path-defect point returned by /api/defects/nearby. */
export type PathDefect = { lat: number; lon: number; type_of_defect?: string; location?: string; date_of_inspection?: string };

/**
 * GIS overlay layer state for the Path Analysis map.
 *
 * @param gisQueryPoints  Unique, thinned segment coordinates ([lon, lat]) used
 *                        as centres for the near-segments proximity query.
 * @param mapViewportBounds  Live map viewport (from `<ViewportWatcher>`); the
 *                        defects fetch derives its centre + radius from it.
 * @returns all layer flags with setters, the fetched `gisLayers` /
 *          `pathDefects` payloads, and the GIS sidebar open state.
 */
export function useGISLayerToggles({
  gisQueryPoints,
  mapViewportBounds,
}: {
  gisQueryPoints: [number, number][];
  mapViewportBounds: L.LatLngBounds | null;
}) {
  const [isGisSidebarOpen, setIsGisSidebarOpen] = useState(false);
  const [gisLayers, setGisLayers] = useState<GISLayersData | null>(null);
  const [pathDefects, setPathDefects] = useState<PathDefect[] | null>(null);
  const [showFootpath, setShowFootpath] = useState(false);
  const [showCycling, setShowCycling] = useState(false);
  const [showShared, setShowShared] = useState(false);
  const [showRoadcrossing, setShowRoadcrossing] = useState(false);
  const [showMrtExit, setShowMrtExit] = useState(false);
  const [showBusStop, setShowBusStop] = useState(false);
  const [showBusLane, setShowBusLane] = useState(false);
  const [showParkingLot, setShowParkingLot] = useState(false);
  const [showKerbLine, setShowKerbLine] = useState(false);
  const [showBicycleCrossing, setShowBicycleCrossing] = useState(false);
  const [showPathDefects, setShowPathDefects] = useState(false);
  const [showStateLand, setShowStateLand] = useState(false);
  const [showStatBoard, setShowStatBoard] = useState(false);
  const [showLandPrivate, setShowLandPrivate] = useState(false);
  const [showLandMinistry, setShowLandMinistry] = useState(false);
  const gisAbortRef = useRef<AbortController | null>(null);
  const gisTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defectsAbortRef = useRef<AbortController | null>(null);
  const defectsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Viewport-center-based path defects fetch
  useEffect(() => {
    if (!showPathDefects || !mapViewportBounds) {
      setPathDefects(null);
      return;
    }

    if (defectsTimerRef.current) clearTimeout(defectsTimerRef.current);
    defectsTimerRef.current = setTimeout(async () => {
      if (defectsAbortRef.current) defectsAbortRef.current.abort();
      const controller = new AbortController();
      defectsAbortRef.current = controller;

      try {
        const sw = mapViewportBounds.getSouthWest();
        const ne = mapViewportBounds.getNorthEast();
        const centerLat = (sw.lat + ne.lat) / 2;
        const centerLon = (sw.lng + ne.lng) / 2;
        // Radius: half the viewport diagonal in metres (rough WGS84 → metres)
        const diagDeg = Math.sqrt((ne.lat - sw.lat) ** 2 + (ne.lng - sw.lng) ** 2);
        const radius = Math.min(Math.round((diagDeg / 2) * 111_000), 3000);

        const res = await fetch('/api/defects/nearby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ point: [centerLon, centerLat], radius }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        const data = await res.json();
        if (data.ok) setPathDefects(data.defects ?? []);
      } catch (e: any) {
        if (e.name !== 'AbortError') console.error('[Defects Viewport] Fetch error:', e);
      }
    }, 500);

    return () => { if (defectsTimerRef.current) clearTimeout(defectsTimerRef.current); };
  }, [mapViewportBounds, showPathDefects]);

  // Data-driven GIS overlay fetch: one request pulls every enabled layer within
  // GIS_SEGMENT_RADIUS_M of any loaded segment. Because it doesn't depend on the
  // viewport, the overlays are fetched once per layer/project change and stay put while
  // panning and zooming — Leaflet's canvas renderer culls off-screen geometry for free.
  useEffect(() => {
    const layers: string[] = [];
    if (showCycling) layers.push('cycling');
    if (showShared) layers.push('shared');
    if (showFootpath) layers.push('footpath');
    if (showRoadcrossing) layers.push('roadcrossing');
    if (showMrtExit) layers.push('mrt_exit');
    if (showBicycleCrossing) layers.push('bicycle_crossing');
    if (showBusStop) layers.push('bus_stop');
    if (showBusLane) layers.push('bus_lane');
    if (showParkingLot) layers.push('parking_lot');
    if (showKerbLine) layers.push('kerb_line');
    if (showStateLand) layers.push('state_land');
    if (showStatBoard) layers.push('stat_board');
    if (showLandPrivate) layers.push('land_private');
    if (showLandMinistry) layers.push('land_ministry');

    if (layers.length === 0 || gisQueryPoints.length === 0) {
      setGisLayers(null);
      return;
    }

    if (gisTimerRef.current) clearTimeout(gisTimerRef.current);
    gisTimerRef.current = setTimeout(async () => {
      if (gisAbortRef.current) gisAbortRef.current.abort();
      const controller = new AbortController();
      gisAbortRef.current = controller;
      try {
        const res = await fetch('/api/projects/gis/near-segments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            points: gisQueryPoints,
            radius: GIS_SEGMENT_RADIUS_M,
            layers,
            simplify_tol: 1.0,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        const data = await res.json();
        if (data.ok) setGisLayers(data.layers);
      } catch (e: any) {
        if (e.name !== 'AbortError') console.error('[GIS NearSegments] Fetch error:', e);
      }
    }, 150);

    return () => { if (gisTimerRef.current) clearTimeout(gisTimerRef.current); };
  }, [gisQueryPoints, showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop, showBusLane, showParkingLot, showKerbLine, showBicycleCrossing, showStateLand, showStatBoard, showLandPrivate, showLandMinistry]);

  return {
    isGisSidebarOpen, setIsGisSidebarOpen,
    gisLayers,
    pathDefects,
    showFootpath, setShowFootpath,
    showCycling, setShowCycling,
    showShared, setShowShared,
    showRoadcrossing, setShowRoadcrossing,
    showMrtExit, setShowMrtExit,
    showBusStop, setShowBusStop,
    showBusLane, setShowBusLane,
    showParkingLot, setShowParkingLot,
    showKerbLine, setShowKerbLine,
    showBicycleCrossing, setShowBicycleCrossing,
    showPathDefects, setShowPathDefects,
    showStateLand, setShowStateLand,
    showStatBoard, setShowStatBoard,
    showLandPrivate, setShowLandPrivate,
    showLandMinistry, setShowLandMinistry,
  };
}
