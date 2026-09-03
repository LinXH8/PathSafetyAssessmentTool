/**
 * ReportMiniMap.tsx — the Leaflet mini-map rendered inside the report's "Map"
 * section (and its filtered duplicate).
 *
 * Extracted verbatim from `reportBuilderPage.tsx` (S2.5 decomposition). Fetches
 * per-project GeoJSON on mount and plots one CircleMarker per scored segment,
 * coloured via the `colorMap` supplied by the container (risk-band by default,
 * or a filter attribute for the "Map (Filtered)" section). `orderIndex` is
 * folded into the MapContainer key to force a clean Leaflet remount when the
 * section is reordered — see the inline note.
 *
 * Side effects: fetches `/api/projects/<name>/geodata` for each project.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import { to4326 } from "../../../utils/projection";
import type { GeoEntry } from "../reportBuilderTypes";

/** Fit the Leaflet viewport to all plotted points on change. */
function FitAllBounds({ points }: { points: L.LatLngExpression[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    // Invalidate size in case the container dimensions just changed/settled,
    // then defer fitBounds so Leaflet calculates the correct viewport dimensions.
    map.invalidateSize();
    setTimeout(() => {
      map.fitBounds(L.latLngBounds(points), { padding: [20, 20], maxZoom: 18 });
    }, 100);
  }, [points, map]);
  return null;
}

export function ReportMiniMap({ projects, colorMap, orderIndex }: { projects: string[]; colorMap: Map<string, string>; orderIndex: number }) {
  const [geoEntries, setGeoEntries] = useState<GeoEntry[]>([]);
  // The MapContainer key combines a per-mount random base with the section's
  // position in the report (`orderIndex`). react-leaflet 5 creates the Leaflet
  // map in a ref callback guarded by `!mapInstanceRef.current` and only removes
  // it on unmount — so when a section reorder moves the map's subtree, React
  // keeps the same fiber/<div> and Leaflet never re-inits cleanly, eventually
  // throwing "Map container is being reused by another instance". Folding
  // `orderIndex` into the key turns each reorder into a deliberate clean
  // remount: the old MapContainer unmounts (its effect cleanup calls
  // `map.remove()`, clearing `_leaflet_id`) and a brand-new <div> is created.
  // `geoEntries` lives in this component's state (not remounted), so the
  // reorder rebuilds only the Leaflet map — no geodata refetch.
  const mapBase = useRef(`reportmap-${Math.random().toString(36).slice(2)}`);
  const mapKey = `${mapBase.current}-${orderIndex}`;

  useEffect(() => {
    if (projects.length === 0) return;
    setGeoEntries([]);
    Promise.all(
      projects.map(async (name) => {
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(name)}/geodata`);
          return { name, data: await res.json() } as GeoEntry;
        } catch { return null; }
      })
    ).then((r) => setGeoEntries(r.filter(Boolean) as GeoEntry[]));
  }, [projects]);

  // One point per scored segment, placed at the LineString's first coordinate —
  // mirrors PathAnalysisPage's map (CircleMarker points, not lines).
  const points = useMemo(() => {
    const out: { key: string; latlng: [number, number]; color: string }[] = [];
    geoEntries.forEach(({ name, data }) => {
      data.features?.forEach((f, i) => {
        const g = f.geometry;
        if (g?.type !== "LineString" || !Array.isArray(g.coordinates) || g.coordinates.length === 0) return;
        // Use array index (1-based) to look up colour — consistent with how _segIndex is set in score rows
        const color = colorMap.get(`${name}_${i + 1}`);
        // Skip features absent from the colour map — eliminates connector/padding
        // features and (in the filtered map) segments outside the filter.
        if (color === undefined) return;
        out.push({ key: `${name}_${i}`, latlng: to4326(g.coordinates[0]), color });
      });
    });
    return out;
  }, [geoEntries, colorMap]);
  const latlngs = useMemo(() => points.map((p) => p.latlng), [points]);

  return (
    <MapContainer key={mapKey} style={{ width: "100%", height: "100%" }} center={[1.35, 103.82]} zoom={12} scrollWheelZoom zoomControl preferCanvas={true}>
      {/* Served by our backend so exported PDF reports still get a basemap on
          an offline machine (backend/app/api/tiles.py). Do not restore a CDN URL.
          ?v=2 cache-busts browsers holding the old pre-API-key placeholder tiles
          (see ThemeAwareTileLayer.tsx for the full explanation). */}
      <TileLayer
        url="/api/tiles/light/{z}/{x}/{y}.png?v=2"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      {points.map(({ key, latlng, color }) => (
        <CircleMarker
          key={key}
          center={latlng}
          radius={5}
          pathOptions={{ color, weight: 1, opacity: 0.9, fillOpacity: 0.8 }}
        />
      ))}
      <FitAllBounds points={latlngs} />
    </MapContainer>
  );
}
