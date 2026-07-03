/**
 * DraggableMarker — shared draggable Leaflet marker for polygon vertex handles.
 *
 * Used by PolygonDrawingTool (PolygonDrawing.tsx) to render individual polygon
 * vertices that the user can reposition by dragging. Stops click propagation so
 * vertex clicks do not bubble up to the map and accidentally add new polygon points.
 *
 * Must be rendered as a descendant of a react-leaflet <MapContainer>.
 */

import { useMemo } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";

export interface DraggableMarkerProps {
  /** Vertex position as [lat, lng]. */
  position: [number, number];
  /** Index of this vertex in the polygon points array — forwarded to callbacks. */
  index: number;
  /** DivIcon used to render the vertex handle (typically from createPolygonVertexIcon). */
  icon: L.DivIcon;
  /** Called on every mousemove while dragging — use for imperative Leaflet updates only. */
  onDrag: (index: number, latlng: L.LatLng) => void;
  /** Called when the drag ends — commit the new position to state here. */
  onDragEnd: (index: number, latlng: L.LatLng) => void;
}

/** Draggable Leaflet marker used as a polygon vertex handle. */
export function DraggableMarker({ position, index, icon, onDrag, onDragEnd }: DraggableMarkerProps) {
  const eventHandlers = useMemo(
    () => ({
      drag: (e: L.LeafletEvent) => {
        onDrag(index, (e.target as L.Marker).getLatLng());
      },
      dragend: (e: L.LeafletEvent) => {
        onDragEnd(index, (e.target as L.Marker).getLatLng());
      },
      click: (e: L.LeafletEvent) => {
        // Prevent vertex clicks from bubbling to the map and adding new points.
        L.DomEvent.stopPropagation(e as L.LeafletMouseEvent);
      },
    }),
    [index, onDrag, onDragEnd]
  );

  return (
    <Marker
      position={position}
      draggable={true}
      icon={icon}
      eventHandlers={eventHandlers}
    />
  );
}
