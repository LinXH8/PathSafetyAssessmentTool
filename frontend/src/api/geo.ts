/**
 * Geographic query API — road and planning-area lookups used by the map-based
 * project creation flow (polygon/selection drawing on the Projects page).
 *
 * Used by: Projects page (CreateProjectModal / map selection).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** A road segment that can become a source-folder project. */
export interface RoadInPolygon {
  /** The real, createable source-folder name (carries quarter suffix when downloaded). */
  name: string;
  /** Human-friendly display label, e.g. "TPY Lor 4 (1Q2026)". Falls back to `name`. */
  label?: string;
  points: number;
  exists: boolean;
}

export interface RoadsInPolygonResult {
  roads: RoadInPolygon[];
  fallback: boolean;
}

/** GeoJSON geometry accepted by the roads-in-polygon endpoint. */
export type ProjectSelectionGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] };

export interface RoadInBounds {
  name: string;
  exists: boolean;
  coords: [number, number][];
}

export interface PlanningAreaInBounds {
  name: string;
  region?: string | null;
  partIndex: number;
  coords: [number, number][];
}

// ── API functions ─────────────────────────────────────────────────────────────

/**
 * POST /api/projects/roads-in-polygon — find roads within a drawn polygon.
 * @param polygon - Array of [lat, lng] pairs forming the polygon ring
 */
export async function queryRoadsInPolygon(polygon: [number, number][]): Promise<RoadsInPolygonResult> {
  const res = await fetch("/api/projects/roads-in-polygon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ polygon }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const data = await res.json();
  return { roads: (data?.roads ?? []) as RoadInPolygon[], fallback: data?.fallback ?? false };
}

/**
 * POST /api/projects/roads-in-polygon — find roads within an arbitrary
 * GeoJSON selection geometry (polygon, multipolygon, linestring, etc.).
 * @param selectionGeometry - GeoJSON geometry for the selection area
 */
export async function queryRoadsInSelection(
  selectionGeometry: ProjectSelectionGeometry
): Promise<RoadsInPolygonResult> {
  const res = await fetch("/api/projects/roads-in-polygon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selection_geometry: selectionGeometry }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const data = await res.json();
  return { roads: (data?.roads ?? []) as RoadInPolygon[], fallback: data?.fallback ?? false };
}

/**
 * GET /api/projects/roads-in-bounds — list road segments visible in a map viewport.
 * @param bounds - Bounding box (WGS-84 decimal degrees)
 * @param limit  - Maximum roads to return (default 2000)
 */
export async function queryRoadsInBounds(
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  limit = 2000
): Promise<RoadInBounds[]> {
  const params = new URLSearchParams({
    minLat: String(bounds.minLat),
    minLng: String(bounds.minLng),
    maxLat: String(bounds.maxLat),
    maxLng: String(bounds.maxLng),
    limit: String(limit),
  });
  const res = await fetch(`/api/projects/roads-in-bounds?${params.toString()}`);
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const data = await res.json();
  return (data?.roads ?? []) as RoadInBounds[];
}

/**
 * GET /api/projects/roads-by-name — search for roads by name string.
 * @param name - Road name search term
 */
export async function queryRoadsByName(name: string): Promise<RoadInBounds[]> {
  const params = new URLSearchParams({ name });
  const res = await fetch(`/api/projects/roads-by-name?${params.toString()}`);
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const data = await res.json();
  return (data?.roads ?? []) as RoadInBounds[];
}

/**
 * GET /api/projects/planning-areas-in-bounds — list planning area polygons in a viewport.
 * @param bounds - Bounding box (WGS-84 decimal degrees)
 * @param limit  - Maximum areas to return (default 500)
 */
export async function queryPlanningAreasInBounds(
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  limit = 500
): Promise<PlanningAreaInBounds[]> {
  const params = new URLSearchParams({
    minLat: String(bounds.minLat),
    minLng: String(bounds.minLng),
    maxLat: String(bounds.maxLat),
    maxLng: String(bounds.maxLng),
    limit: String(limit),
  });
  const res = await fetch(`/api/projects/planning-areas-in-bounds?${params.toString()}`);
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const data = await res.json();
  return (data?.areas ?? []) as PlanningAreaInBounds[];
}
