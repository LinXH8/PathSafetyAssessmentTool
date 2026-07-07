/**
 * useGISLayerData.ts — server data hooks for GeoDataPanel's map overlays.
 *
 * Single responsibility: fetching the GIS layer features
 * (`POST /api/projects/<name>/gis/layers`) and the path-defect records
 * (`POST /api/defects/nearby`) around the active query point, and the shared
 * types for both. Extracted verbatim from GeoDataPanel.tsx in S2.2.
 *
 * NOTE (S2.2): the original inline `GISLayers` type was missing the four
 * land-ownership keys (`state_land`, `stat_board`, `land_private`,
 * `land_ministry`) that the render code already used — a pre-existing
 * `tsc -b` error baseline. They are declared here properly (type-only fix,
 * no behaviour change).
 */
import { useEffect, useState } from "react";
import type { GISToggleState } from "./useGISToggleState";

/** One feature returned by the GIS layers endpoint. */
export type GISLayerFeature = {
  coordinates: [number, number][];
  properties: { width?: number; OWNRSHP_CL?: string };
  geometry_type?: "line" | "point" | "polygon";
};

/** Feature lists per GIS layer, keyed by the backend layer names. */
export type GISLayers = {
  footpath: GISLayerFeature[];
  cycling: GISLayerFeature[];
  shared: GISLayerFeature[];
  roadcrossing: GISLayerFeature[];
  mrt_exit: GISLayerFeature[];
  bicycle_crossing: GISLayerFeature[];
  bus_stop: GISLayerFeature[];
  bus_lane: GISLayerFeature[];
  parking_lot: GISLayerFeature[];
  kerb_line: GISLayerFeature[];
  state_land: GISLayerFeature[];
  stat_board: GISLayerFeature[];
  land_private: GISLayerFeature[];
  land_ministry: GISLayerFeature[];
};

/** One xlsx-backed path-defect inspection record. */
export type PathDefect = {
  lat: number;
  lon: number;
  type_of_defect: string;
  location: string;
  date_of_inspection: string;
};

/**
 * Fetch GIS layer features near the active query point whenever any layer
 * toggle is on. Aborts in-flight requests on dependency change; clears the
 * layers when every toggle is off.
 *
 * @param decodedName decoded project name (null → no fetch).
 * @param activeGisLat / activeGisLon active query point (WGS84), null → no fetch.
 * @param toggles GIS layer toggle state (from `useGISToggleState`).
 * @param hasExternalGeoFeatures kept in the effect deps for parity with the
 *   pre-extraction behaviour (a commented-out multi-project skip).
 * @returns the fetched layers, or null when no layer is enabled / not yet loaded.
 * Side effects: network POST to `/api/projects/<name>/gis/layers`.
 */
export function useGISLayers(
  decodedName: string | null,
  activeGisLat: number | null,
  activeGisLon: number | null,
  toggles: GISToggleState,
  hasExternalGeoFeatures: boolean,
): GISLayers | null {
  const [gisLayers, setGisLayers] = useState<GISLayers | null>(null);
  const {
    showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop,
    showBusLane, showParkingLot, showKerbLine, showBicycleCrossing,
    showStateLand, showStatBoard, showLandPrivate, showLandMinistry,
  } = toggles;

  // Fetch GIS layers when any toggle is turned on and we have a current point
  // Skip GIS layers when using external geofeatures from multiple projects
  useEffect(() => {
    // Don't fetch GIS layers for multi-project display
    // if (hasExternalGeoFeatures) {
    //   setGisLayers(null);
    //   return;
    // }

    if (!decodedName || activeGisLat === null || activeGisLon === null) return;

    const anyLayerEnabled = showFootpath || showCycling || showShared || showRoadcrossing || showMrtExit || showBusStop || showBusLane || showParkingLot || showKerbLine || showBicycleCrossing || showStateLand || showStatBoard || showLandPrivate || showLandMinistry;
    if (!anyLayerEnabled) {
      setGisLayers(null);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const lat = activeGisLat;
        const lon = activeGisLon;

        const layers = [];
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

        // Fetch GIS layers near the active query point
        const res = await fetch(`/api/projects/${encodeURIComponent(decodedName)}/gis/layers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            point: [lon, lat],  // API expects [lon, lat]
            radius: 200,
            layers: layers
          }),
          signal: controller.signal
        });

        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        const data = await res.json();

        if (data.ok) {
          setGisLayers(data.layers);
        }
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') {
          console.error("[GIS] Fetch error:", e);
        }
      }
    })();

    return () => { controller.abort(); };
  }, [decodedName, activeGisLat, activeGisLon, showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop, showBusLane, showParkingLot, showKerbLine, showBicycleCrossing, showStateLand, showStatBoard, showLandPrivate, showLandMinistry, hasExternalGeoFeatures]);

  return gisLayers;
}

/**
 * Fetch Path Defects within the search radius around the active query point.
 * Kept separate from the GIS layers fetch so toggling defects doesn't refetch
 * every GIS layer (and vice versa).
 *
 * @param activeGisLat / activeGisLon active query point (WGS84), null → no fetch.
 * @param showPathDefects toggle; when off the defect list is cleared.
 * @returns fetched defects, or null when disabled / not yet loaded.
 * Side effects: network POST to `/api/defects/nearby`.
 */
export function usePathDefects(
  activeGisLat: number | null,
  activeGisLon: number | null,
  showPathDefects: boolean,
): PathDefect[] | null {
  const [pathDefects, setPathDefects] = useState<PathDefect[] | null>(null);

  useEffect(() => {
    if (activeGisLat === null || activeGisLon === null) return;
    if (!showPathDefects) {
      setPathDefects(null);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/defects/nearby`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            point: [activeGisLon, activeGisLat],
            radius: 200,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        const data = await res.json();
        if (data.ok) setPathDefects(data.defects ?? []);
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') {
          console.error("[Defects] Fetch error:", e);
        }
      }
    })();

    return () => { controller.abort(); };
  }, [activeGisLat, activeGisLon, showPathDefects]);

  return pathDefects;
}
