/**
 * DefectsLayer.tsx — "Path Defects" map overlay for GeoDataPanel.
 *
 * Single responsibility: render the warning-triangle defect markers (xlsx-backed
 * inspection records fetched by `useGISLayerData.ts::usePathDefects`) within the
 * 200 m search radius. Pure presentational. Extracted verbatim from GeoDataPanel.tsx
 * in S2.2.
 */
import { Marker, Tooltip } from "react-leaflet";
import { makeDefectIcon } from "../../../../components/map/defectMarker";
import type { PathDefect } from "./useGISLayerData";

// Path Defect marker — canonical warning triangle shared with the Path Analysis
// map and the Layer View legend glyph (see defectMarker.ts).
const defectIcon = makeDefectIcon();

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
