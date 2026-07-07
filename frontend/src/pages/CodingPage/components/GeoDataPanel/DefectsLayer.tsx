/**
 * DefectsLayer.tsx — "Path Defects" map overlay for GeoDataPanel.
 *
 * Single responsibility: render the ⚠️ defect markers (xlsx-backed inspection
 * records fetched by `useGISLayerData.ts::usePathDefects`) within the 200 m
 * search radius. Pure presentational. Extracted verbatim from GeoDataPanel.tsx
 * in S2.2.
 */
import { Marker, Tooltip } from "react-leaflet";
import { divIcon } from "leaflet";
import type { PathDefect } from "./useGISLayerData";

// Path Defect marker — ⚠️ emoji used in the "Path Defects" overlay.
const defectIcon = divIcon({
  className: "path-defect-marker",
  html: `<div style="font-size:20px;line-height:20px;text-align:center;opacity:0.5;filter:drop-shadow(0 0 2px rgba(0,0,0,0.5));pointer-events:auto;">⚠️</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

/**
 * Renders the path-defect ⚠️ markers inside a `<MapContainer>`.
 *
 * @param defects fetched defect records (null → renders nothing).
 * Pure presentational — no side effects.
 */
export function DefectsLayer({ defects }: { defects: PathDefect[] | null }) {
  return (
    <>
      {defects?.map((d, i) => (
        <Marker
          key={`defect-${i}`}
          position={[d.lat, d.lon]}
          icon={defectIcon}
        >
          <Tooltip>{`${d.type_of_defect || "Defect"} — ${d.location || "Unknown"}${d.date_of_inspection ? ` (${d.date_of_inspection})` : ""}`}</Tooltip>
        </Marker>
      ))}
    </>
  );
}
