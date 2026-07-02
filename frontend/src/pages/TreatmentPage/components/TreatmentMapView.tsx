import ThemeAwareTileLayer from "../../../components/common/ThemeAwareTileLayer";
import { useState, useEffect, useMemo, useRef } from "react";
import { Box, Text, Tabs } from "@chakra-ui/react";

import { MapContainer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import proj4 from "proj4";
import type { Feature, FeatureCollection, LineString, Position } from "geojson";
import { MAP_MISSING_SCORE_COLOR } from "../../../constants/mapColors";

type GJ = FeatureCollection<LineString, any>;

// --- EPSG:3414 (SVY21 / Singapore TM) definition -> EPSG:4326 ---
proj4.defs(
  "EPSG:3414",
  "+proj=tmerc +lat_0=1.366666666666667 +lon_0=103.8333333333333 +k=1 +x_0=28001.642 +y_0=38744.572 +ellps=WGS84 +units=m +no_defs"
);

const to4326 = (p: Position): [number, number] => {
  const [lon, lat] = proj4("EPSG:3414", "EPSG:4326", p as [number, number]) as [number, number];
  return [lat, lon];
};

// Component to auto-fit bounds based on points
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [points, map]);
  return null;
}

export default function TreatmentMapView() {
  const [activeTab, setActiveTab] = useState<string>("map");
  const [fc] = useState<GJ | null>(null);
  const [loading, setLoading] = useState(false);
  const [err] = useState<string | null>(null);

  // Load geodata - you can modify this to load your specific project data
  useEffect(() => {
    // Placeholder: In real implementation, fetch geodata from your API
    // For now, we'll just set loading to false
    setLoading(false);
  }, []);

  // Extract first point from each LineString and convert to EPSG:4326
  const points = useMemo(() => {
    if (!fc) return [] as { idx: number; latlng: [number, number]; f: Feature<LineString, any> }[];
    const arr: { idx: number; latlng: [number, number]; f: Feature<LineString, any> }[] = [];
    fc.features.forEach((f, i) => {
      const g = f.geometry;
      if (g?.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length > 0) {
        arr.push({ idx: i, latlng: to4326(g.coordinates[0]), f });
      }
    });
    return arr;
  }, [fc]);

  const allLatLngs = useMemo(() => points.map(p => p.latlng), [points]);

  // Default center (Singapore)
  const initialCenter = useRef<[number, number]>([1.3521, 103.8198]);

  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      overflow="hidden"
      bg="white"
      _dark={{ bg: "gray.800" }}
    >
      {/* Tabs */}
      <Tabs.Root value={activeTab} onValueChange={(e) => setActiveTab(e.value)}>
        <Tabs.List>
          <Tabs.Trigger value="map">Map View</Tabs.Trigger>
          <Tabs.Trigger value="table">Table View</Tabs.Trigger>
        </Tabs.List>

        {/* Map Tab Content */}
        <Tabs.Content value="map">
          <Box h="650px">
            {loading && (
              <Box p="6">
                <Text color="gray.500">Loading map…</Text>
              </Box>
            )}
            {err && (
              <Box p="6">
                <Text color="red.600">Failed: {err}</Text>
              </Box>
            )}

            {!loading && !err && (
              <MapContainer
                center={initialCenter.current}
                zoom={12}
                style={{ width: "100%", height: "100%" }}
                scrollWheelZoom
              >

                {/* Tile Layer */}
                <ThemeAwareTileLayer />

                {/* Auto-fit bounds if data is available */}
                {allLatLngs.length > 0 && <FitBounds points={allLatLngs} />}

                {/* Render all points as markers */}
                {points.map(({ idx, latlng, f }) => {
                  const color = MAP_MISSING_SCORE_COLOR;
                  const radius = 5;
                  const label = `#${idx} ${f.properties?.["Image Reference"] ?? ""}`;

                  return (
                    <CircleMarker
                      key={idx}
                      center={latlng}
                      radius={radius}
                      pathOptions={{ color, weight: 1, opacity: 0.9, fillOpacity: 0.8 }}
                    >
                      <Tooltip>{label}</Tooltip>
                    </CircleMarker>
                  );
                })}
              </MapContainer>
            )}
          </Box>
        </Tabs.Content>

        {/* Table Tab Content */}
        <Tabs.Content value="table">
          <Box p="6" h="650px" overflowY="auto">
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                border: "1px solid #e2e8f0",
              }}
            >
              <thead>
                <tr style={{ backgroundColor: "#f7fafc" }}>
                  <th
                    style={{
                      padding: "12px",
                      textAlign: "left",
                      borderBottom: "2px solid #e2e8f0",
                      fontWeight: "600",
                    }}
                  >
                    Column 1
                  </th>
                  <th
                    style={{
                      padding: "12px",
                      textAlign: "left",
                      borderBottom: "2px solid #e2e8f0",
                      fontWeight: "600",
                    }}
                  >
                    Column 2
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0" }}>
                    Row 1, Cell 1
                  </td>
                  <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0" }}>
                    Row 1, Cell 2
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0" }}>
                    Row 2, Cell 1
                  </td>
                  <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0" }}>
                    Row 2, Cell 2
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0" }}>
                    Row 3, Cell 1
                  </td>
                  <td style={{ padding: "12px", borderBottom: "1px solid #e2e8f0" }}>
                    Row 3, Cell 2
                  </td>
                </tr>
              </tbody>
            </table>
          </Box>
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  );
}
