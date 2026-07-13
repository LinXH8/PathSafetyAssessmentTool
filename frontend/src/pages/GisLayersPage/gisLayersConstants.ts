/**
 * Pure helpers, types and shared map utilities for the GIS Layers page.
 *
 * Extracted from the original monolithic `GisLayersPage.tsx` so the container
 * and BOTH layout shells (V1 verbatim, V2 redesigned) can share them without a
 * container↔layout circular import (same pattern as `codingHelpers.ts` /
 * `reportBuilderConstants.ts`). Nothing here holds state or fetches.
 */
import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";

export type FilterMode = "all" | "autocoding" | "project" | "analysis";

export type ParsedLine = { positions: [number, number][]; props: any };
export type ParsedPoint = { latlng: [number, number]; props: any };
export type ParsedPolygon = { positions: [number, number][][]; props: any };

export type MapFeatures = {
  lines: ParsedLine[];
  points: ParsedPoint[];
  polygons: ParsedPolygon[];
  bounds: L.LatLngBounds | null;
  totalCount: number;
};

export const INITIAL_CENTER: [number, number] = [1.3521, 103.8198];

export const FILTER_OPTIONS: { value: FilterMode; label: string; desc: string }[] = [
  { value: "all", label: "All Layers", desc: "Shows every available GIS shapefile in this project across all categories." },
  { value: "autocoding", label: "Auto-coding", desc: "Layers that feed directly into the scoring calculations. Includes area type polygons (urban/rural/recreational), land use classifications, speed limit lines, and the road link network file." },
  { value: "project", label: "Area Based Reporting", desc: "Layers used to report and organise results by area. Includes planning area boundaries, the road name network (to match paths to roads), and the road network node file for intersection referencing." },
  { value: "analysis", label: "Analysis", desc: "All layers displayed as overlays in the Analysis page. Includes path centrelines (footpath, cycling, shared), road and bicycle crossings, MRT exits, bus stops, bus lanes, parking lots, kerb lines, path defects, land type categories, and AMG pedestrian/cyclist count data." },
];

/** Infer required-columns / affected-parameters metadata from a shapefile's base name. */
export const getLayerMetadata = (fileName: string) => {
  const name = fileName.toLowerCase();

  // Paths
  if (name.includes("footpath")) return { reqCols: "WIDTH", affects: "Facility Width, Curvature" };
  if (name.includes("cycling")) return { reqCols: "WIDTH", affects: "Facility Width, Curvature" };
  if (name.includes("shared")) return { reqCols: "WIDTH", affects: "Facility Width, Curvature" };

  // Crossings
  if (name.includes("bicyclecrossing") || (name.includes("bicycle") && name.includes("crossing"))) return { reqCols: "None (Proximity)", affects: "Crossing Facility, Crossing Type" };
  if (name.includes("roadcrossing") || (name.includes("road") && name.includes("crossing"))) return { reqCols: "None (Proximity)", affects: "Pedestrian Crossing" };

  // Speed / Links
  if (name.includes("speedlimit") || name.includes("speed_limit")) return { reqCols: "SPEEDLIMIT", affects: "Road speed limit" };
  if (name.includes("link")) return { reqCols: "LK_ID_NUM", affects: "Road operating speed" };

  // Public Transport
  if (name.includes("mrt")) return { reqCols: "None (Proximity)", affects: "Pedestrian Crossing, Peak Flow" };
  if (name.includes("busstop") || name.includes("bus_stop") || name.includes("bus stop")) return { reqCols: "None (Proximity)", affects: "Pedestrian Crossing" };
  if (name.includes("busshelter") || name.includes("bus_shelter") || name.includes("bus shelter")) return { reqCols: "None (Proximity)", affects: "Peak Pedestrian Flow" };
  if (name.includes("bus") && name.includes("lane")) return { reqCols: "None (Proximity)", affects: "Heavy vehicle flow" };

  // Area Types
  if (name.includes("industrial")) return { reqCols: "None (Containment)", affects: "Area type (Industrial)" };
  if (name.includes("rural")) return { reqCols: "None (Containment)", affects: "Area type (Rural)" };
  if (name.includes("recreation")) return { reqCols: "None (Containment)", affects: "Area type (Recreational)" };
  if (name.includes("central") || name.includes("inner")) return { reqCols: "None (Containment)", affects: "Area type (Urban)" };

  // Other infrastructure
  if (name.includes("parking")) return { reqCols: "None (Proximity)", affects: "Adjacent Vehicle Parking" };
  if (name.includes("kerb")) return { reqCols: "None (Proximity)", affects: "Lanes – adjacent road" };
  if (name.includes("count")) return { reqCols: "DataType, DateTime, Count_Data", affects: "User Counts" };

  return { reqCols: "Unknown", affects: "Unknown" };
};

/** Classify a shapefile into the four filter buckets by category + base name. */
export const getLayerPurpose = (file: { category: string; base_name: string }): FilterMode => {
  const cat = file.category.toLowerCase();
  const name = file.base_name.toLowerCase();

  // Area Based Reporting: boundary and road network reference layers
  if (cat === "planning_area" || cat === "road_name") return "project";
  if (cat === "linkid_shape_file" && name.includes("node")) return "project";

  // Auto-coding: layers that feed the scoring engine but are NOT overlays in the Analysis page
  if (
    cat === "area_type" ||
    cat.startsWith("landuse") ||
    cat.startsWith("central") ||
    cat === "speed_limit" ||
    cat === "linkid_shape_file"
  ) return "autocoding";

  // Analysis: everything else — all layers shown as overlays in the Analysis page
  return "analysis";
};

export const formatBytes = (bytes: number, decimals = 2) => {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

/** Parse every geometry type out of a GeoJSON FeatureCollection into flat arrays + bounds. */
export function parseMapFeatures(geojsonData: any | null): MapFeatures | null {
  if (!geojsonData || !geojsonData.features) return null;

  const lines: ParsedLine[] = [];
  const points: ParsedPoint[] = [];
  const polygons: ParsedPolygon[] = [];
  let bounds = L.latLngBounds([]);

  geojsonData.features.forEach((feature: any) => {
    const geom = feature.geometry;
    if (!geom) return;
    const props = feature.properties || {};

    switch (geom.type) {
      case "Point": {
        const [lon, lat] = geom.coordinates;
        const ll: [number, number] = [lat, lon];
        points.push({ latlng: ll, props });
        bounds.extend(ll);
        break;
      }
      case "MultiPoint": {
        geom.coordinates.forEach((c: [number, number]) => {
          const ll: [number, number] = [c[1], c[0]];
          points.push({ latlng: ll, props });
          bounds.extend(ll);
        });
        break;
      }
      case "LineString": {
        const coords = geom.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
        lines.push({ positions: coords, props });
        coords.forEach((c: [number, number]) => bounds.extend(c));
        break;
      }
      case "MultiLineString": {
        geom.coordinates.forEach((line: [number, number][]) => {
          const coords = line.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
          lines.push({ positions: coords, props });
          coords.forEach((c: [number, number]) => bounds.extend(c));
        });
        break;
      }
      case "Polygon": {
        const rings = geom.coordinates.map((ring: [number, number][]) =>
          ring.map((c: [number, number]) => [c[1], c[0]] as [number, number])
        );
        polygons.push({ positions: rings, props });
        rings[0]?.forEach((c: [number, number]) => bounds.extend(c));
        break;
      }
      case "MultiPolygon": {
        geom.coordinates.forEach((poly: [number, number][][]) => {
          const rings = poly.map((ring: [number, number][]) =>
            ring.map((c: [number, number]) => [c[1], c[0]] as [number, number])
          );
          polygons.push({ positions: rings, props });
          rings[0]?.forEach((c: [number, number]) => bounds.extend(c));
        });
        break;
      }
    }
  });

  const totalCount = lines.length + points.length + polygons.length;
  return { lines, points, polygons, bounds: bounds.isValid() ? bounds : null, totalCount };
}

/** react-leaflet child that fits the map to the given bounds when they change. */
export function FitBounds({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24] });
    }
  }, [bounds, map]);
  return null;
}

/**
 * react-leaflet child that re-measures the map after its container settles.
 * v2 mounts the map inside a card whose final height arrives a beat after
 * init; without this the tiles paint half-grey (the documented v2 map bug).
 */
export function MapAutosize() {
  const map = useMap();
  useEffect(() => {
    const t = window.setTimeout(() => map.invalidateSize(), 200);
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => {
      window.clearTimeout(t);
      ro.disconnect();
    };
  }, [map]);
  return null;
}
