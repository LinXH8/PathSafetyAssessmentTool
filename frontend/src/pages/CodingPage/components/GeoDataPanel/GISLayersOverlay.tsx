/**
 * GISLayersOverlay.tsx — GIS layer feature rendering for GeoDataPanel's map.
 *
 * Single responsibility: turn the fetched `GISLayers` features into Leaflet
 * polylines / circle markers / polygons for every enabled layer toggle
 * (paths, road/bicycle crossings, MRT exits, bus stops/lanes, parking, kerb
 * lines and the four land-ownership polygon layers). Pure presentational —
 * fetch/state live in `useGISLayerData.ts` / `useGISToggleState.ts`.
 * Extracted verbatim from GeoDataPanel.tsx in S2.2. Colours come from the
 * shared `constants/mapColors.ts` (single source with PathAnalysisMapView +
 * AnalysisSidebar).
 */
import { CircleMarker, Polygon, Polyline, Tooltip } from "react-leaflet";
import { GIS_LAYER_COLORS as layerColors } from "../../../../constants/mapColors";
import type { GISLayers } from "./useGISLayerData";
import type { GISToggleState } from "./useGISToggleState";

/**
 * Renders all enabled GIS layers inside a `<MapContainer>`.
 *
 * @param gisLayers fetched layer features (null → renders nothing).
 * @param toggles per-layer visibility from `useGISToggleState`.
 * Pure presentational — no side effects.
 */
export function GISLayersOverlay({ gisLayers, toggles }: { gisLayers: GISLayers | null; toggles: GISToggleState }) {
  const {
    showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop,
    showBusLane, showParkingLot, showKerbLine, showBicycleCrossing,
    showStateLand, showStatBoard, showLandPrivate, showLandMinistry,
  } = toggles;
  return (
    <>
      {/* GIS Layers - Render below the segment points */}
      {gisLayers && showFootpath && gisLayers.footpath && (
        gisLayers.footpath.map((feature, i) => (
          <Polyline
            key={`footpath-${i}`}

            positions={feature.coordinates.map(([lon, lat]) => [lat, lon])}
            pathOptions={{
              color: layerColors.footpath,
              weight: 3,
              opacity: 0.8
            }}
          />
        ))
      )}

      {gisLayers && showCycling && gisLayers.cycling && (
        gisLayers.cycling.map((feature, i) => (
          <Polyline
            key={`cycling-${i}`}

            positions={feature.coordinates.map(([lon, lat]) => [lat, lon])}
            pathOptions={{
              color: layerColors.cycling,
              weight: 3,
              opacity: 0.8
            }}
          />
        ))
      )}

      {gisLayers && showShared && gisLayers.shared && (
        gisLayers.shared.map((feature, i) => (
          <Polyline
            key={`shared-${i}`}

            positions={feature.coordinates.map(([lon, lat]) => [lat, lon])}
            pathOptions={{
              color: layerColors.shared,
              weight: 3,
              opacity: 0.8
            }}
          />
        ))
      )}

      {gisLayers && showRoadcrossing && gisLayers.roadcrossing && (
        gisLayers.roadcrossing.map((feature, i) => (
          <Polyline
            key={`roadcrossing-${i}`}

            positions={feature.coordinates.map(([lon, lat]) => [lat, lon])}
            pathOptions={{
              color: layerColors.roadcrossing,
              weight: 3,
              opacity: 0.8
            }}
          />
        ))
      )}

      {/* MRT Exit - Point layer rendered as CircleMarkers */}
      {gisLayers && showMrtExit && gisLayers.mrt_exit && (
        gisLayers.mrt_exit.map((feature, i) => (
          <CircleMarker
            key={`mrt_exit-${i}`}

            center={[feature.coordinates[0][1], feature.coordinates[0][0]]}
            radius={6}
            pathOptions={{
              color: layerColors.mrt_exit,
              weight: 2,
              opacity: 0.9,
              fillOpacity: 0.7
            }}
          >
            <Tooltip>MRT Exit</Tooltip>
          </CircleMarker>
        ))
      )}

      {/* Bus Stop - Point or Line (Shelters) */}
      {gisLayers && showBusStop && gisLayers.bus_stop && (
        gisLayers.bus_stop.map((feature, i) => {
          if (feature.geometry_type === "point") {
            return (
              <CircleMarker
                key={`bus_stop-${i}`}

                center={[feature.coordinates[0][1], feature.coordinates[0][0]]}
                radius={6}
                pathOptions={{
                  color: layerColors.bus_stop,
                  weight: 2,
                  opacity: 0.9,
                  fillOpacity: 0.7
                }}
              >
                <Tooltip>Bus Stop</Tooltip>
              </CircleMarker>
            );
          } else if (feature.geometry_type === "line") {
            return (
              <Polyline
                key={`bus_shelter-${i}`}

                positions={feature.coordinates.map(c => [c[1], c[0]])}
                pathOptions={{
                  color: layerColors.bus_stop,
                  weight: 4,
                  opacity: 0.8
                }}
              >
                <Tooltip>Bus Shelter</Tooltip>
              </Polyline>
            );
          }
          return null;
        })
      )}

      {/* Bus Lane - LineString or MultiLineString layer */}
      {gisLayers && showBusLane && gisLayers.bus_lane && (
        gisLayers.bus_lane.map((feature, i) => {
          const coords = feature.coordinates;
          // If it's a MultiLineString structure (array of arrays of coordinates)
          const isMulti = Array.isArray(coords[0]) && Array.isArray(coords[0][0]);

          if (isMulti) {
            return (coords as unknown as [number, number][][]).map((line, j) => (
              <Polyline
                key={`bus_lane-${i}-${j}`}

                positions={line.map((c) => [c[1], c[0]] as [number, number])}
                pathOptions={{
                  color: layerColors.bus_lane,
                  weight: 4,
                  opacity: 0.8,
                  dashArray: "5, 10"
                }}
              >
                 <Tooltip>Bus Lane</Tooltip>
              </Polyline>
            ));
          }

          return (
            <Polyline
              key={`bus_lane-${i}`}

              positions={coords.map((c) => [c[1], c[0]] as [number, number])}
              pathOptions={{
                color: layerColors.bus_lane,
                weight: 4,
                opacity: 0.8,
                dashArray: "5, 10"
              }}
            >
               <Tooltip>Bus Lane</Tooltip>
            </Polyline>
          );
        })
      )}

      {/* Parking Lot - Polygon layer */}
      {gisLayers && showParkingLot && gisLayers.parking_lot && (
        gisLayers.parking_lot.map((feature, i) => {
          const geomType = feature.geometry_type;
          if (geomType === "polygon") {
            return (
              <Polygon
                key={`parking_lot-${i}`}

                positions={feature.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
                pathOptions={{
                  color: layerColors.parking_lot,
                  weight: 2,
                  opacity: 0.8,
                  fillOpacity: 0.3
                }}
              >
                <Tooltip>Parking Lot</Tooltip>
              </Polygon>
            );
          }
          // Fallback: render as point if geometry_type is "point"
          return (
            <CircleMarker
              key={`parking_lot-${i}`}

              center={[feature.coordinates[0][1], feature.coordinates[0][0]]}
              radius={6}
              pathOptions={{
                color: layerColors.parking_lot,
                weight: 2,
                opacity: 0.9,
                fillOpacity: 0.7
              }}
            >
              <Tooltip>Parking Lot</Tooltip>
            </CircleMarker>
          );
        })
      )}

      {/* Kerb Line - LineString layer */}
      {gisLayers && showKerbLine && gisLayers.kerb_line && (
        gisLayers.kerb_line.map((feature, i) => (
          <Polyline
            key={`kerb_line-${i}`}

            positions={feature.coordinates.map(([lon, lat]) => [lat, lon])}
            pathOptions={{
              color: layerColors.kerb_line,
              weight: 3,
              opacity: 0.8
            }}
          />
        ))
      )}

      {/* Bicycle Crossing - Point layer rendered as CircleMarkers */}
      {gisLayers && showBicycleCrossing && gisLayers.bicycle_crossing && (
        gisLayers.bicycle_crossing.map((feature, i) => (
          <CircleMarker
            key={`bicycle_crossing-${i}`}

            center={[feature.coordinates[0][1], feature.coordinates[0][0]]}
            radius={6}
            pathOptions={{
              color: layerColors.bicycle_crossing,
              weight: 2,
              opacity: 0.9,
              fillOpacity: 0.7
            }}
          >
            <Tooltip>Bicycle Crossing</Tooltip>
          </CircleMarker>
        ))
      )}

      {/* Land Ownership - Polygon layers */}
      {gisLayers && showStateLand && gisLayers.state_land && (
        gisLayers.state_land.map((feature, i) => (
          <Polygon
            key={`state_land-${i}`}

            positions={feature.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
            pathOptions={{ color: layerColors.state_land, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}
          >
            <Tooltip>{feature.properties?.OWNRSHP_CL ?? "State Land"}</Tooltip>
          </Polygon>
        ))
      )}

      {gisLayers && showStatBoard && gisLayers.stat_board && (
        gisLayers.stat_board.map((feature, i) => (
          <Polygon
            key={`stat_board-${i}`}

            positions={feature.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
            pathOptions={{ color: layerColors.stat_board, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}
          >
            <Tooltip>{feature.properties?.OWNRSHP_CL ?? "Stat Board"}</Tooltip>
          </Polygon>
        ))
      )}

      {gisLayers && showLandPrivate && gisLayers.land_private && (
        gisLayers.land_private.map((feature, i) => (
          <Polygon
            key={`land_private-${i}`}

            positions={feature.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
            pathOptions={{ color: layerColors.land_private, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}
          >
            <Tooltip>{feature.properties?.OWNRSHP_CL ?? "Private Land"}</Tooltip>
          </Polygon>
        ))
      )}

      {gisLayers && showLandMinistry && gisLayers.land_ministry && (
        gisLayers.land_ministry.map((feature, i) => (
          <Polygon
            key={`land_ministry-${i}`}

            positions={feature.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])}
            pathOptions={{ color: layerColors.land_ministry, weight: 2, opacity: 0.8, fillOpacity: 0.2 }}
          >
            <Tooltip>{feature.properties?.OWNRSHP_CL ?? "Ministry Land"}</Tooltip>
          </Polygon>
        ))
      )}
    </>
  );
}
