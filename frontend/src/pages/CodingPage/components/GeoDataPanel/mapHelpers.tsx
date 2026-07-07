/**
 * mapHelpers.tsx — Leaflet map behaviour helpers for GeoDataPanel.
 *
 * Single responsibility: small render-null react-leaflet child components that
 * drive map viewport behaviour (fit / pan / zoom / resize) plus the StatPill
 * metric readout used by GeoDataPanel's v1 header. Extracted verbatim from
 * GeoDataPanel.tsx in S2.2; consumed only by GeoDataPanel (Coding page map and
 * the Treatment page's Before/After map panels).
 *
 * NOTE: `MapAutoCenter` deliberately does NOT live here — it is declared inside
 * the GeoDataPanel component body (a nested component that remounts every
 * render, resetting its suppression refs). Hoisting it would change behaviour.
 */
import { Flex, Text } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/**
 * Auto-fit the map bounds to a set of points — first load only.
 *
 * @param points [lat, lng] pairs to fit; no-op when empty or already fitted.
 * Side effects: calls `map.fitBounds` once per mount.
 */
export function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const hasFitRef = useRef(false);
  useEffect(() => {
    if (!points.length || hasFitRef.current) return;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [24, 24] });
    hasFitRef.current = true;
  }, [points, map]);
  return null;
}

/**
 * Flies map to given bounds whenever bounds/panKey change (not null).
 * panKey is a monotonic counter that forces React to re-fire the effect even when the
 * bounds reference hasn't changed (e.g. clicking the same project tab twice).
 * The fitBounds call is deferred by one tick (setTimeout 0) so that ALL other React
 * effects from the same render commit (MapAutoCenter, ZoomToGIS, etc.) have already
 * completed — preventing any animation race conditions.
 *
 * @param bounds target bounds, or null to do nothing.
 * @param panKey monotonic counter forcing the effect to re-fire.
 * Side effects: `map.invalidateSize()`, `map.stop()`, `map.fitBounds()`.
 */
export function PanToBounds({ bounds, panKey }: { bounds: L.LatLngBounds | null; panKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds) return;
    const timerId = setTimeout(() => {
      // Re-measure the container size — critical for small / side-by-side panels
      // where the layout may have shifted between renders.
      map.invalidateSize();
      // Cancel any in-flight Leaflet animation (setView / flyTo) so fitBounds wins.
      map.stop();
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 18 });
    }, 0);
    return () => clearTimeout(timerId);
  }, [bounds, panKey, map]);
  return null;
}

/**
 * Refits the map to a set of latlngs whenever `fitKey` changes (e.g. project tab
 * switch). Unlike FitBounds (which only fires once on initial load), this re-fires
 * on every token bump. Deferred by a tick so other effects from the same commit settle.
 *
 * @param latlngs [lat, lng] pairs to fit.
 * @param fitKey token; the effect intentionally re-fires ONLY when this changes.
 * Side effects: `map.invalidateSize()`, `map.stop()`, `map.fitBounds()`.
 */
export function FitToFeatures({ latlngs, fitKey }: { latlngs: [number, number][]; fitKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (!latlngs.length) return;
    const timerId = setTimeout(() => {
      map.invalidateSize();
      map.stop();
      map.fitBounds(L.latLngBounds(latlngs.map(([lat, lng]) => L.latLng(lat, lng))), { padding: [20, 20], maxZoom: 18 });
    }, 0);
    return () => clearTimeout(timerId);
    // Intentionally only re-fire on fitKey change, not when latlngs reference updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

/**
 * Zoom to the current query point when a GIS layer is first turned on
 * (off→on transition). Turning all layers off leaves the viewport alone.
 *
 * @param center the active query point ([lat, lng]) or null.
 * @param anyLayerOn whether at least one GIS layer toggle is enabled.
 * Side effects: `map.setView(center, 17)` on the off→on transition.
 */
export function ZoomToGIS({ center, anyLayerOn }: { center: [number, number] | null; anyLayerOn: boolean }) {
  const map = useMap();
  const prevLayerOnRef = useRef(false);
  useEffect(() => {
    // Zoom in when a layer is turned on (transition from off->on)
    if (anyLayerOn && !prevLayerOnRef.current && center) {
      map.setView(center, 17, { animate: true });
    }
    // When all layers turned off, fit the full route again
    if (!anyLayerOn && prevLayerOnRef.current && center) {
      // Don't force re-fit — just let user navigate freely
    }
    prevLayerOnRef.current = anyLayerOn;
  }, [anyLayerOn, center, map]);
  return null;
}

/**
 * Leaflet caches the container size at init; if the map mounts before the
 * surrounding flex/page layout has settled to its final height it paints a
 * half-grey tile area. Re-measure once layout settles and on any container
 * resize. (Same root cause seen on the Create-project v2 map.)
 *
 * Side effects: `map.invalidateSize()` on a 200ms timer and on every
 * container resize (via ResizeObserver when supported).
 */
export function MapAutosize() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    const t = window.setTimeout(fix, 200);
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(map.getContainer());
    } catch { /* ResizeObserver unsupported — the timeout still covers mount */ }
    return () => { clearTimeout(t); ro?.disconnect(); };
  }, [map]);
  return null;
}

/**
 * Tiny labelled metric readout (label above value) used in GeoDataPanel's v1
 * header for the Curv/Width/Grade pills. Pure presentational.
 */
export function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <Flex direction="column" align="center" lineHeight="1.1">
      <Text fontSize="9px" color="gray.400" fontWeight="medium" letterSpacing="wide" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="xs" fontWeight="semibold" color="gray.700" _dark={{ color: "gray.200" }}>
        {value}
      </Text>
    </Flex>
  );
}
