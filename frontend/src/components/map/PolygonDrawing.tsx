/**
 * PolygonDrawing — shared interactive polygon drawing overlay for Leaflet maps.
 *
 * Exports: PolygonDrawingTool (component) + PolygonDrawingToolProps (type).
 * Geometric utilities (isPointInPolygon) live in polygonUtils.ts to satisfy
 * the react-refresh/only-export-components rule (mixed component+function
 * exports break HMR fast-refresh).
 *
 * Used by PathAnalysisMapView (segment polygon select / add-to-polygon mode)
 * and GeoDataPanel (segment region select). Both callers share the same API:
 *   PathAnalysisMapView — computes active/color from its mode flags before passing.
 *   GeoDataPanel        — passes active/color/points directly.
 */

import { useEffect, useRef, useMemo, useCallback } from "react";
import { Polyline, Polygon, useMapEvents } from "react-leaflet";
import L, { divIcon } from "leaflet";
import { DraggableMarker } from "./DraggableMarker";

/** Creates a circular DivIcon for polygon vertex drag handles. */
function createPolygonVertexIcon(color: string): L.DivIcon {
  return divIcon({
    className: "custom-polygon-marker",
    html: `<div style="
      background-color: ${color};
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 2px solid white;
      box-shadow: 0 0 4px rgba(0,0,0,0.4);
      cursor: grab;
    "></div>`,
    iconSize: [20, 20],   // hit-box size
    iconAnchor: [10, 10], // centred (half of 20)
  });
}

export interface PolygonDrawingToolProps {
  /** Whether polygon drawing mode is active; map clicks add vertices when true. */
  active: boolean;
  /** Stroke and fill colour for the polygon overlay. */
  color: string;
  /** Current vertex positions as [lat, lng] tuples. */
  points: [number, number][];
  /** Called with [lat, lng] when the user clicks the map to add a vertex. */
  onAddPoint: (latlng: [number, number]) => void;
  /** Called with the new [lat, lng] after the user finishes dragging a vertex. */
  onPointUpdate: (index: number, latlng: [number, number]) => void;
}

/**
 * Interactive polygon drawing overlay for react-leaflet maps.
 *
 * Must be rendered as a child of `<MapContainer>`. When `active`, map clicks
 * append new vertices via `onAddPoint`. Existing vertices can be dragged to new
 * positions; `onPointUpdate` is called on drag-end so callers can commit the
 * change to state. During drag, the Leaflet layers are updated imperatively (no
 * React re-render per mousemove) for smooth performance.
 *
 * Renders nothing when `!active` or `points.length === 0`.
 */
export function PolygonDrawingTool({
  active,
  color,
  points,
  onAddPoint,
  onPointUpdate,
}: PolygonDrawingToolProps) {
  const activeRef = useRef(active);
  const polygonRef = useRef<L.Polygon>(null);
  const polylineRef = useRef<L.Polyline>(null);
  // Keep latest points in a ref for the drag handler — avoids rebinding on every render.
  const pointsRef = useRef(points);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { pointsRef.current = points; }, [points]);

  const icon = useMemo(() => createPolygonVertexIcon(color), [color]);

  useMapEvents({
    click(e) {
      if (activeRef.current) {
        onAddPoint([e.latlng.lat, e.latlng.lng]);
      }
    },
  });

  const handleDrag = useCallback((index: number, latlng: L.LatLng) => {
    // Imperatively update Leaflet layers during drag for smooth performance;
    // React state is only updated on drag-end via handleDragEnd.
    const current = pointsRef.current;
    if (!current) return;
    const updated = [...current];
    updated[index] = [latlng.lat, latlng.lng];
    const latLngs = updated.map(p => L.latLng(p[0], p[1]));
    polygonRef.current?.setLatLngs(latLngs);
    polylineRef.current?.setLatLngs(latLngs);
  }, []);

  const handleDragEnd = useCallback((index: number, latlng: L.LatLng) => {
    onPointUpdate(index, [latlng.lat, latlng.lng]);
  }, [onPointUpdate]);

  if (!active || points.length === 0) return null;

  return (
    <>
      {points.map((p, i) => (
        <DraggableMarker
          key={`poly-point-${i}`}
          position={p}
          index={i}
          icon={icon}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
        />
      ))}
      <Polyline
        ref={polylineRef}
        positions={points}
        pathOptions={{ color, dashArray: "5, 5" }}
      />
      {points.length >= 3 && (
        <Polygon
          ref={polygonRef}
          positions={points}
          // stroke: false — the dashed Polyline above already draws the outline.
          pathOptions={{ color, fillOpacity: 0.2, stroke: false }}
        />
      )}
    </>
  );
}
