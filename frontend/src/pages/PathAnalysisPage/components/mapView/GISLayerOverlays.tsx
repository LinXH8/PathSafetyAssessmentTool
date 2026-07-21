/**
 * GISLayerOverlays.tsx — react-leaflet rendering of the GIS overlay layers on
 * the Path Analysis map (`PathAnalysisMapView.tsx`).
 *
 * Single responsibility: purely presentational fragment extracted from the
 * map-view monolith [S2.1]. Renders the fetched near-segment GIS features
 * (paths, crossings, transit, land lots) and viewport path defects as Leaflet
 * polylines / polygons / circle markers. Must be mounted inside a
 * `<MapContainer>`. No state, no fetching — data and visibility flags come
 * from `useGISLayerToggles` via props.
 *
 * Note: the plan's `<GISLayerControls>` seam does not exist inline in this
 * file — the toggle *controls* already live in the shared `AnalysisSidebar`;
 * what was inline (and is extracted here) is the overlay *rendering*.
 */

import { CircleMarker, Marker, Polygon as LeafletPolygon, Polyline as LeafletPolyline, Tooltip } from "react-leaflet";
import type L from "leaflet";
import { GIS_LAYER_COLORS as gisLayerColors } from "../../../../constants/mapColors";
import { makeDefectIcon } from "../../../../components/map/defectMarker";
import type { GISLayersData, PathDefect } from "./useGISLayerToggles";

// Canonical warning-triangle marker, shared with the Coding map (DefectsLayer)
// and the Layer View legend glyph. Built once — divIcon instances are reusable.
const defectIcon = makeDefectIcon();

interface GISLayerOverlaysProps {
  /** Fetched layer geometry keyed by layer id (null until a fetch resolves). */
  gisLayers: GISLayersData | null;
  /** Viewport path defects (null while hidden / loading). */
  pathDefects: PathDefect[] | null;
  /** Canvas renderer SHARED with the segment CircleMarkers in
   *  `PathAnalysisMapView.tsx`. Must be the same instance — two separate
   *  canvases covering the same map area would each capture ALL clicks/hover
   *  in their own DOM <canvas> element with no fallback to the layer
   *  underneath, so whichever canvas mounted last would permanently swallow
   *  every pointer event map-wide (this was the cause of segments becoming
   *  totally unclickable once any GIS layer was toggled on). Sharing one
   *  renderer lets Leaflet's own per-layer hit-test correctly resolve
   *  segment vs. GIS-feature clicks. 50% padding keeps lines near the
   *  viewport edge visible during pan/zoom without flickering. */
  canvasRenderer: L.Renderer;
  showFootpath: boolean;
  showCycling: boolean;
  showShared: boolean;
  showRoadcrossing: boolean;
  showMrtExit: boolean;
  showBusStop: boolean;
  showBusLane: boolean;
  showParkingLot: boolean;
  showKerbLine: boolean;
  showBicycleCrossing: boolean;
  showPathDefects: boolean;
  showStateLand: boolean;
  showStatBoard: boolean;
  showLandPrivate: boolean;
  showLandMinistry: boolean;
}

/**
 * GIS overlay layers. Rendered by the caller BEFORE the segment CircleMarkers
 * so segments are added last to the shared canvas (wins add-order hit-test
 * ties and paints on top visually). Path Defect markers are real DOM pins
 * (not canvas-drawn) placed in the low-zIndex `pathDefectsPane` so they stay
 * below segments too. Pure function of its props; safe to re-render freely.
 */
export function GISLayerOverlays({
  gisLayers,
  pathDefects,
  canvasRenderer,
  showFootpath,
  showCycling,
  showShared,
  showRoadcrossing,
  showMrtExit,
  showBusStop,
  showBusLane,
  showParkingLot,
  showKerbLine,
  showBicycleCrossing,
  showPathDefects,
  showStateLand,
  showStatBoard,
  showLandPrivate,
  showLandMinistry,
}: GISLayerOverlaysProps) {
  return (
    <>
      {gisLayers && showFootpath && gisLayers.footpath?.map((f, i) => (
        <LeafletPolyline key={`fp-${i}`} renderer={canvasRenderer} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.footpath, weight: 3, opacity: 0.8 }} />
      ))}
      {gisLayers && showCycling && gisLayers.cycling?.map((f, i) => (
        <LeafletPolyline key={`cy-${i}`} renderer={canvasRenderer} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.cycling, weight: 3, opacity: 0.8 }} />
      ))}
      {gisLayers && showShared && gisLayers.shared?.map((f, i) => (
        <LeafletPolyline key={`sh-${i}`} renderer={canvasRenderer} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.shared, weight: 3, opacity: 0.8 }} />
      ))}
      {gisLayers && showRoadcrossing && gisLayers.roadcrossing?.map((f, i) => (
        <LeafletPolyline key={`rc-${i}`} renderer={canvasRenderer} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.roadcrossing, weight: 3, opacity: 0.8 }} />
      ))}
      {gisLayers && showKerbLine && gisLayers.kerb_line?.map((f, i) => (
        <LeafletPolyline key={`kl-${i}`} renderer={canvasRenderer} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.kerb_line, weight: 2, opacity: 0.8 }} />
      ))}
      {gisLayers && showBusLane && gisLayers.bus_lane?.map((f, i) => {
        const isMulti = Array.isArray(f.coordinates[0]) && Array.isArray(f.coordinates[0][0]);
        if (isMulti) return (f.coordinates as any).map((line: any, j: number) => (
          <LeafletPolyline key={`bl-${i}-${j}`} renderer={canvasRenderer} positions={line.map((c: any) => [c[1], c[0]])} pathOptions={{ color: gisLayerColors.bus_lane, weight: 4, opacity: 0.8, dashArray: "5, 10" }}><Tooltip>Bus Lane</Tooltip></LeafletPolyline>
        ));
        return <LeafletPolyline key={`bl-${i}`} renderer={canvasRenderer} positions={f.coordinates.map((c: any) => [c[1], c[0]])} pathOptions={{ color: gisLayerColors.bus_lane, weight: 4, opacity: 0.8, dashArray: "5, 10" }}><Tooltip>Bus Lane</Tooltip></LeafletPolyline>;
      })}
      {gisLayers && showMrtExit && gisLayers.mrt_exit?.map((f, i) => (
        <CircleMarker key={`mrt-${i}`} renderer={canvasRenderer} center={[f.coordinates[0][1], f.coordinates[0][0]]} radius={6} pathOptions={{ color: gisLayerColors.mrt_exit, weight: 2, opacity: 0.9, fillOpacity: 0.7 }}><Tooltip>MRT Exit</Tooltip></CircleMarker>
      ))}
      {gisLayers && showBicycleCrossing && gisLayers.bicycle_crossing?.map((f, i) => (
        <CircleMarker key={`bc-${i}`} renderer={canvasRenderer} center={[f.coordinates[0][1], f.coordinates[0][0]]} radius={6} pathOptions={{ color: gisLayerColors.bicycle_crossing, weight: 2, opacity: 0.9, fillOpacity: 0.7 }}><Tooltip>Bicycle Crossing</Tooltip></CircleMarker>
      ))}
      {gisLayers && showBusStop && gisLayers.bus_stop?.map((f, i) =>
        f.geometry_type === "point"
          ? <CircleMarker key={`bs-${i}`} renderer={canvasRenderer} center={[f.coordinates[0][1], f.coordinates[0][0]]} radius={6} pathOptions={{ color: gisLayerColors.bus_stop, weight: 2, opacity: 0.9, fillOpacity: 0.7 }}><Tooltip>Bus Stop</Tooltip></CircleMarker>
          : <LeafletPolyline key={`bs-${i}`} renderer={canvasRenderer} positions={f.coordinates.map((c: any) => [c[1], c[0]])} pathOptions={{ color: gisLayerColors.bus_stop, weight: 4, opacity: 0.8 }}><Tooltip>Bus Shelter</Tooltip></LeafletPolyline>
      )}
      {gisLayers && showParkingLot && gisLayers.parking_lot?.map((f, i) =>
        f.geometry_type === "polygon"
          ? <LeafletPolygon key={`pk-${i}`} renderer={canvasRenderer} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.parking_lot, weight: 2, opacity: 0.8, fillOpacity: 0.3 }}><Tooltip>Parking Lot</Tooltip></LeafletPolygon>
          : <CircleMarker key={`pk-${i}`} renderer={canvasRenderer} center={[f.coordinates[0][1], f.coordinates[0][0]]} radius={6} pathOptions={{ color: gisLayerColors.parking_lot, weight: 2, opacity: 0.9, fillOpacity: 0.7 }}><Tooltip>Parking Lot</Tooltip></CircleMarker>
      )}
      {gisLayers && showStateLand && gisLayers.state_land?.map((f, i) => (
        <LeafletPolygon key={`sl-${i}`} renderer={canvasRenderer} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.state_land, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}><Tooltip>{f.properties?.OWNRSHP_CL ?? "State Land"}</Tooltip></LeafletPolygon>
      ))}
      {gisLayers && showStatBoard && gisLayers.stat_board?.map((f, i) => (
        <LeafletPolygon key={`sb-${i}`} renderer={canvasRenderer} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.stat_board, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}><Tooltip>{f.properties?.OWNRSHP_CL ?? "Stat Board"}</Tooltip></LeafletPolygon>
      ))}
      {gisLayers && showLandPrivate && gisLayers.land_private?.map((f, i) => (
        <LeafletPolygon key={`lp-${i}`} renderer={canvasRenderer} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.land_private, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}><Tooltip>{f.properties?.OWNRSHP_CL ?? "Private Land"}</Tooltip></LeafletPolygon>
      ))}
      {gisLayers && showLandMinistry && gisLayers.land_ministry?.map((f, i) => (
        <LeafletPolygon key={`lm-${i}`} renderer={canvasRenderer} positions={f.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])} pathOptions={{ color: gisLayerColors.land_ministry, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}><Tooltip>{f.properties?.OWNRSHP_CL ?? "Ministry Land"}</Tooltip></LeafletPolygon>
      ))}
      {showPathDefects && pathDefects?.map((d, i) => (
        <Marker key={`def-${i}`} position={[d.lat, d.lon]} icon={defectIcon} pane="pathDefectsPane">
          <Tooltip>{`${d.type_of_defect || "Defect"} — ${d.location || "Unknown"}${d.date_of_inspection ? ` (${d.date_of_inspection})` : ""}`}</Tooltip>
        </Marker>
      ))}
    </>
  );
}
