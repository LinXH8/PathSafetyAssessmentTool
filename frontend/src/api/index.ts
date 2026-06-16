import type { FeatureCollection } from "geojson";

// Health
export async function ping(): Promise<{ status: string }> {
  const res = await fetch('/api/ping')
  if (!res.ok) throw new Error('Failed /api/ping')
  return res.json()
}

// Project list
export interface ProjectListItem {
  name: string;
  tags: string[];
  dataset?: string | null;
  source_folders?: string[];
  date_created?: string;
  last_updated?: string;
  verified?: boolean;
  verified_segment_count?: number;
  autocoded_segment_count?: number;
  total_segments?: number;
}

export interface FileResponse {
  projects: ProjectListItem[];
}

export async function fetchProjectList(): Promise<FileResponse> {
  const res = await fetch('/api/projects')
  if (!res.ok) throw new Error('Failed /api/projects')
  return res.json()
}

// Project detail
export type ProjectDetail = {
  name: string
  versions: string[]
  latest: string
}

export async function fetchProjectDetail(projectName: string): Promise<ProjectDetail> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}`)
  if (!res.ok) throw new Error(`Failed GET /api/projects/${projectName}`)
  return res.json()
}

// Fetch project metadata including verified status
export async function fetchProjectMetadata(projectName: string): Promise<ProjectListItem> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/metadata`)
  if (!res.ok) throw new Error(`Failed to fetch metadata for ${projectName}`)
  return res.json()
}

// Project attributes
export type AttributeRow = Record<string, string | number | boolean | null>;
export type AttributesResponse = { rows: AttributeRow[] };

// Filter context passed from Path Analysis → Coding page
export type FilteredSegmentPoint = {
  latlng: [number, number];
  color: string; // risk-band hex color (per-crash-type thresholds)
  idx: number;   // 0-based segment index within the project
};

export type FilteredProjectData = {
  projectName: string;
  filteredIndices: number[];       // 0-based indices used to gate the current-project map
  points: FilteredSegmentPoint[];  // one entry per filtered segment (for map rendering + click nav)
};

// All filtered projects share the same context object so navigating across projects
// preserves the full filter picture without re-deriving it.
export type CodingFilterContext = {
  projects: FilteredProjectData[];
};

export const CODING_FILTER_CONTEXT_KEY = 'codingFilterContext';

export async function fetchProjectAttributes(projectName: string): Promise<AttributesResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/versions/latest/attributes`)

  if (!res.ok) throw new Error(`Failed GET /api/projects/${projectName}/versions/latest/attributes`)

  return res.json()
}


// Project GEO data
export async function fetchProjectGeoJSON(projectName: string): Promise<FeatureCollection> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/geodata`)
  if (!res.ok) {
    throw new Error(`Failed GET /api/projects/${projectName}/geodata`)
  }
  return res.json()
}

// ===== types =====
export type AttrMappings = Record<string, Record<string, string>>; // 字段名 -> { "1": "Suburban", ... }

// ===== fetch mappings (数字 -> 文本) =====
export async function fetchAttributeMappings(): Promise<AttrMappings> {
  const r = await fetch("/api/projects/attribute-mappings");
  if (!r.ok) throw new Error("Failed to load attribute mappings");
  return r.json();
}

export async function fetchCustomAttrOptions(): Promise<Record<string, string[]>> {
  const r = await fetch("/api/projects/custom-attribute-options");
  if (!r.ok) throw new Error("Failed to load custom attribute options");
  return r.json();
}

export async function updateCustomAttrOptions(field: string, options: string[]): Promise<void> {
  const r = await fetch("/api/projects/custom-attribute-options", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field, options }),
  });
  if (!r.ok) throw new Error(await r.text().catch(() => r.statusText));
}

export async function saveAttributes(project: string, rows: AttributeRow[]) {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/attributes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

export async function listSourceFolders(opts?: { signal?: AbortSignal }) {
  const res = await fetch("/api/projects/folders", { signal: opts?.signal });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const data = await res.json();
  return (data?.items ?? []) as string[];
}

export interface SourceFolderSuggestion {
  name: string;
  exists: boolean;
}

export interface SourceFolderPreview {
  folder_name: string;
  image_count: number;
  geotagged_image_count: number;
  segment_count: number;
  segment_error: string | null;
  earliest_modified_at: string | null;
  latest_modified_at: string | null;
  survey_quarter: string | null;
  survey_quarters: string[];
  cached: boolean;
  mixed_quarters: boolean;
  renamed_from: string | null;
}

export async function listSourceFolderSuggestions(opts?: { signal?: AbortSignal }) {
  const res = await fetch("/api/projects/folders/suggestions", { signal: opts?.signal });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return (data?.items ?? []) as SourceFolderSuggestion[];
}

export async function fetchSourceFolderPreview(folderName: string, opts?: { signal?: AbortSignal }) {
  const params = new URLSearchParams({ folder_name: folderName });
  const res = await fetch(`/api/projects/folders/preview?${params.toString()}`, { signal: opts?.signal });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as SourceFolderPreview;
}

export interface ProfileSummary {
  id: string;
  name: string;
  slug: string;
  division: string;
  created_at: string;
  last_active_at: string | null;
  project_count: number;
  has_pin: boolean;
}

export interface ProfilesOverview {
  profiles: ProfileSummary[];
  active_profile: ProfileSummary | null;
  legacy_projects: string[];
}

export interface CreateProfileResult {
  profile: ProfileSummary;
  overview: ProfilesOverview;
}

export interface LoginProfileResult {
  active_profile: ProfileSummary;
  overview: ProfilesOverview;
}

export interface LogoutProfileResult {
  ok: boolean;
  overview: ProfilesOverview;
}

export interface UpdateProfileResult {
  profile: ProfileSummary;
  overview: ProfilesOverview;
}

export interface ResetProfilePinResult {
  profile: ProfileSummary;
  overview: ProfilesOverview;
}

export interface RecordProfileActivityResult {
  ok: boolean;
  recorded: boolean;
}

export interface DeleteProfileResult {
  ok: boolean;
  overview: ProfilesOverview;
}

export interface MigrateLegacyProjectsResult {
  moved: string[];
  skipped: Array<{ name: string; reason: string }>;
  missing: string[];
  overview: ProfilesOverview;
}

export interface ShareProjectsResult {
  shared: string[];
  skipped: Array<{ name: string; reason: string }>;
  missing: string[];
  overview: ProfilesOverview;
}

export async function fetchProfilesOverview(): Promise<ProfilesOverview> {
  const res = await fetch("/api/profiles");
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ProfilesOverview;
}

export async function createProfile(name: string, pin: string, division: string): Promise<CreateProfileResult> {
  const res = await fetch("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, pin, division }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as CreateProfileResult;
}

export async function loginProfile(profileId: string, pin: string): Promise<LoginProfileResult> {
  const res = await fetch("/api/profiles/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id: profileId, pin }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as LoginProfileResult;
}

export async function logoutProfile(): Promise<LogoutProfileResult> {
  const res = await fetch("/api/profiles/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as LogoutProfileResult;
}

export async function updateProfile(
  profileId: string,
  currentPin: string,
  name: string,
  division: string,
): Promise<UpdateProfileResult> {
  const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_pin: currentPin, name, division }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as UpdateProfileResult;
}

export async function resetProfilePin(
  profileId: string,
  currentPin: string,
  newPin: string,
): Promise<ResetProfilePinResult> {
  const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/reset-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ResetProfilePinResult;
}

export async function recordProfileActivity(
  eventType: string,
  payload?: Record<string, unknown>,
  projectName?: string,
): Promise<RecordProfileActivityResult> {
  const res = await fetch("/api/profiles/activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: eventType, payload, project_name: projectName }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as RecordProfileActivityResult;
}

export async function deleteProfile(profileId: string, pin: string): Promise<DeleteProfileResult> {
  const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as DeleteProfileResult;
}

export async function migrateLegacyProjects(projectNames?: string[]): Promise<MigrateLegacyProjectsResult> {
  const res = await fetch("/api/profiles/migrate-legacy-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_names: projectNames }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as MigrateLegacyProjectsResult;
}

export async function shareProjects(
  targetProfileId: string,
  projectNames: string[],
): Promise<ShareProjectsResult> {
  const res = await fetch("/api/profiles/share-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_profile_id: targetProfileId, project_names: projectNames }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ShareProjectsResult;
}

export async function pickLocalSourceFolder() {
  const res = await fetch("/api/projects/folders/pick-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as {
    path: string | null;
    suggested_folder_name: string | null;
  };
}

export interface CopyLocalImagesResult {
  count: number;
  errors: string[];
  folder_name: string;
  renamed_from: string | null;
  preview: SourceFolderPreview;
}

export async function copyLocalImagesToSourceFolder(
  sourcePath: string,
  folderName: string,
): Promise<CopyLocalImagesResult> {
  const res = await fetch("/api/projects/folders/copy-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: sourcePath, folder_name: folderName }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export interface RoadInPolygon {
  name: string;
  points: number;
  exists: boolean;
}

export interface RoadsInPolygonResult {
  roads: RoadInPolygon[];
  fallback: boolean;
}

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

export async function queryRoadsInSelection(selectionGeometry: ProjectSelectionGeometry): Promise<RoadsInPolygonResult> {
  const res = await fetch("/api/projects/roads-in-polygon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selection_geometry: selectionGeometry }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const data = await res.json();
  return { roads: (data?.roads ?? []) as RoadInPolygon[], fallback: data?.fallback ?? false };
}

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

export async function queryRoadsByName(name: string): Promise<RoadInBounds[]> {
  const params = new URLSearchParams({ name });
  const res = await fetch(`/api/projects/roads-by-name?${params.toString()}`);
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const data = await res.json();
  return (data?.roads ?? []) as RoadInBounds[];
}

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

export async function createProjectFromFolder(
  project_name: string,
  folder_name: string | string[],
  tags: string[] = [],
  selectionGeometry?: ProjectSelectionGeometry
) {
  const folder_names = Array.isArray(folder_name) ? folder_name : undefined;
  const single_folder_name = Array.isArray(folder_name) ? undefined : folder_name;
  const res = await fetch("/api/projects/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_name,
      folder_name: single_folder_name,
      folder_names,
      tags,
      selection_geometry: selectionGeometry,
    }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  // 返回形如 { ok: true, name: "<project>" }
  return (await res.json()) as { ok?: boolean; name?: string };
}

// Delete Project
export async function deleteProject(projectName: string) {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    // 尝试输出后端的错误信息
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg || "Delete failed");
  }
  // 预计返回 { ok: true, name: string }
  return (await res.json()) as { ok?: boolean; name?: string };
}

// Update Project Metadata (name, tags, verified status, and/or verified segment count)
export async function updateProject(
  projectName: string,
  updates: { new_name?: string; tags?: string[]; verified?: boolean; verified_segment_count?: number; autocoded_segment_count?: number }
) {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg || "Update failed");
  }
  return (await res.json()) as { ok?: boolean; name?: string; tags?: string[]; verified?: boolean; verified_segment_count?: number; autocoded_segment_count?: number };
}

// Delete single segment
export async function deleteSegment(project: string, index: number) {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/segments/${index}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// Batch delete segments
export async function deleteSegmentsBatch(project: string, indices: number[]) {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/segments/delete-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ indices }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// Check for segment collisions in target project
export async function checkCollisions(
  sourceProject: string,
  targetProject: string,
  indices: number[]
): Promise<{ ok: boolean; collisions: string[] }> {
  const res = await fetch("/api/projects/check-collisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceProject, targetProject, indices }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// Copy segments to another project
export async function copySegments(
  sourceProject: string,
  targetProject: string,
  indices: number[],
  createTarget: boolean,
  replace: boolean = false,
  tags: string[] = []
): Promise<{ ok: boolean; message: string; count: number; targetProject: string }> {
  const res = await fetch("/api/projects/copy-segments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceProject, targetProject, indices, createTarget, replace, tags }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function autocodeImage(project: string, imageRef: string) {
  const res = await fetchAutocode(`/api/projects/${encodeURIComponent(project)}/autocode/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageRef }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as {
    updates: AttributeRow;
    changed_fields: string[];
    field_sources?: Record<string, string>;
    gradient_pct?: number;
  };
  if (data.gradient_pct !== undefined) {
    console.log(`[Gradient] ${imageRef}: ${data.gradient_pct >= 0 ? "+" : ""}${data.gradient_pct.toFixed(2)}%`);
  }
  return data;
}

export async function autocodeGIS(project: string, coords: number[][]) {
  const res = await fetchAutocode(`/api/projects/${encodeURIComponent(project)}/autocode/gis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coords }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as {
    updates: AttributeRow;
    changed_fields: string[];
    field_sources?: Record<string, string>;
    gradient_pct?: number;
  };
  if (data.gradient_pct !== undefined) {
    console.log(`[Gradient] GIS result: ${data.gradient_pct >= 0 ? "+" : ""}${data.gradient_pct.toFixed(2)}%`);
  }
  return data;
}

// ========================================================================
// AUTO-CODE ALL API TYPES
// ========================================================================
// Types for the /autocode/all endpoint that supports both single and bulk modes

// ---------- Request Payloads ----------

// Single mode: Auto-code one image
export type AutoCodeSinglePayload = {
  imageRef: string;        // Image filename
  coords: number[][];      // LineString coordinates [[lon, lat], ...]
  index?: number;          // Row index in attributes table (optional)
};

// Bulk mode (all rows): Auto-code all images in project
export type AutoCodeBulkAllPayload = {
  all: true;               // Flag to process all rows
  save?: boolean;          // Whether to save to disk (default: false for temp changes)
  fields?: string[];       // Optional: only update these specific field names (real keys)
};

// Bulk mode (selected rows): Auto-code specific images
export type AutoCodeBulkIndicesPayload = {
  indices: number[];       // Row indices to process
  save?: boolean;          // Whether to save to disk (default: false for temp changes)
  fields?: string[];       // Optional: only update these specific field names (real keys)
};

// ---------- Response Types ----------

// Single mode response
export type AutoCodeSingleResult = {
  updates: Record<string, number | string>;     // Field updates: {field_name: code}
  saved?: boolean;                               // Whether changes were saved to disk
  changed_fields?: string[];                     // List of fields that actually changed
  field_sources?: Record<string, string>;        // Source per field: {field_name: "CV"|"GIS"}
};

// Bulk mode response
export type AutoCodeBulkResult = {
  saved: boolean;                                      // Whether changes were saved to disk
  total: number;                                       // Total rows attempted
  ok: number;                                          // Number of rows successfully processed
  fail: number;                                        // Number of rows that failed
  errors: { index: number; reason: string }[];         // Detailed error info per failed row
  changed_by_row?: Record<number, string[]>;          // {row_idx: [field_names]} for UI highlighting
  sources_by_row?: Record<number, Record<string, string>>;  // {row_idx: {field: "CV"|"GIS"}} for badges
  updated_attributes?: AttributeRow[];                 // Complete updated attributes table (in-memory)
};

type AutoCodeAllPayload =
  | AutoCodeSinglePayload
  | AutoCodeBulkAllPayload
  | AutoCodeBulkIndicesPayload;

type AutoCodeAllResult = AutoCodeSingleResult | AutoCodeBulkResult;

const AUTOCODE_NETWORK_ERROR =
  "Cannot reach the backend autocode service. Make sure the backend is running on http://127.0.0.1:8000, preferably via Run-PSAT.bat or the psat conda environment.";

// ---------- Helper Functions ----------

// Extract error message from response (handles both JSON and text errors)
async function readError(res: Response) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return j?.error || text;
  } catch {
    return text;
  }
}

async function fetchAutocode(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(AUTOCODE_NETWORK_ERROR);
    }
    throw error;
  }
}

// ---------- API Functions ----------

/**
 * Auto-code attributes using CV and GIS models
 *
 * Supports three modes:
 * 1. Single image: { imageRef, coords, index? }
 * 2. All images: { all: true, save?: false }
 * 3. Selected images: { indices: [0,2,5], save?: false }
 *
 * Key behavior:
 * - When save=false (recommended for bulk), changes are kept in memory only
 * - Returns updated_attributes so UI can display changes without persisting
 * - User must click Save button to persist changes to disk
 *
 * @param project - Project name
 * @param payload - Request payload (see AutoCodeAllPayload types)
 * @returns Response with updates and tracking data (see AutoCodeAllResult types)
 */
export async function autocodeAll(project: string, payload: AutoCodeAllPayload): Promise<AutoCodeAllResult> {
  const res = await fetchAutocode(`/api/projects/${encodeURIComponent(project)}/autocode/all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as AutoCodeAllResult;
}

/**
 * Streaming variant of autocodeAll — uses SSE to report per-row progress.
 *
 * The backend yields one SSE event per processed segment so the UI counter
 * can tick up in real time (1/412, 2/412, …).
 *
 * @param project    - Project name
 * @param payload    - Same payload as autocodeAll (stream:true is injected automatically)
 * @param onProgress - Called after each segment: (processed, total, errorCount)
 * @returns          - The final AutoCodeBulkResult (same shape as autocodeAll bulk response)
 */
export async function autocodeAllStream(
  project: string,
  payload: AutoCodeAllPayload,
  onProgress: (processed: number, total: number, errors: number) => void,
): Promise<AutoCodeBulkResult> {
  const res = await fetchAutocode(`/api/projects/${encodeURIComponent(project)}/autocode/all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, stream: true }),
  });
  if (!res.ok) throw new Error(await readError(res));

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by double newlines
      const parts = buffer.split("\n\n");
      buffer = parts.pop()!; // keep incomplete trailing chunk

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const event = JSON.parse(line.slice(5).trim());
        if (event.type === "progress") {
          onProgress(event.processed, event.total, event.errors ?? 0);
        } else if (event.type === "done") {
          const { type: _type, ...result } = event;
          return result as AutoCodeBulkResult;
        }
      }
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(AUTOCODE_NETWORK_ERROR);
    }
    throw error;
  }
  throw new Error("SSE stream ended without a 'done' event");
}

// ---------- Calculate Score ----------

export type CalculateScoreResult = {
  ok: boolean;
  result_rows: Record<string, any>[];
};

/**
 * Calculate cycleRAP scores for the entire project
 *
 * @param project - Project name
 * @returns Score calculation results
 */
export async function calculateScore(project: string): Promise<CalculateScoreResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as CalculateScoreResult;
}

/**
 * Fetch previously-calculated cycleRAP scores for the entire project.
 *
 * This is a read-only GET that returns the persisted results WITHOUT
 * recomputing or writing to disk (unlike calculateScore's POST /score).
 * Use this for read paths like Path Analysis; fall back to calculateScore
 * only when no persisted results exist yet.
 *
 * @param project - Project name
 * @returns Persisted score results (result_rows may be empty if never scored)
 */
export async function fetchProjectResults(project: string): Promise<CalculateScoreResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/results`, {
    method: "GET",
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  return (await res.json()) as CalculateScoreResult;
}

/**
 * Calculate cycleRAP scores for a single row
 *
 * @param project - Project name
 * @param attributes - Single attribute row
 * @returns Score for the single row
 */
export async function calculateScoreForRow(project: string, attributes: AttributeRow): Promise<Record<string, any>> {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attributes: [attributes] }),
  });
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  const result = (await res.json()) as CalculateScoreResult;
  return result.result_rows[0] || {};
}

// ========================================================================
// SHAPEFILE MANAGEMENT API
// ========================================================================

export type ShapefileMetadata = {
  feature_count: number;
  crs: string;
  bounds: {
    minx: number;
    miny: number;
    maxx: number;
    maxy: number;
  };
  columns: string[];
  geometry_type: string[];
};

export type ShapefileInfo = {
  name: string;
  filename: string;
  base_name: string;
  path: string;
  category: string;
  size: number;
  type: string;
  year: string;
  source: string;
  metadata?: ShapefileMetadata;
  files?: string[];
  required_columns?: string;
  affects?: string;
  geom_type?: string;
  original_name?: string;
  is_renamed?: boolean;
};

export type ShapefileCategoryInfo = {
  name: string;
  shapefile_count: number;
  path: string;
};

export type UploadResult = {
  uploaded: Array<{
    name: string;
    category: string;
    path: string;
  }>;
  errors: string[];
  count: number;
};

export type ReplaceResult = {
  replaced: Array<{
    target: string;
    status: string;
    backup: string;
  }>;
  errors: string[];
  count: number;
};

export type ValidationResult = {
  valid: boolean;
  error?: string;
  shapefiles?: Array<{
    name: string;
    valid: boolean;
    missing_files: string[];
    present_files: string[];
    metadata: ShapefileMetadata;
  }>;
};

export type ReplacementValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  info: Record<string, any>;
  column_mapping: Record<string, string>;
};

/**
 * List all available shapefiles with metadata
 */
export async function listShapefiles(): Promise<ShapefileInfo[]> {
  const res = await fetch("/api/shapefiles");
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Upload new shapefiles (ZIP or individual files)
 * @param files - Array of File objects to upload
 * @param category - Optional category/subdirectory name
 */
export async function uploadShapefiles(files: File[], category?: string): Promise<UploadResult> {
  const formData = new FormData();
  files.forEach(file => formData.append("files", file));
  if (category) {
    formData.append("category", category);
  }

  const res = await fetch("/api/shapefiles/upload", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Temporarily upload shapefile files and return GeoJSON preview (not saved permanently)
 */
export async function previewUploadedShapefiles(files: File[]): Promise<FeatureCollection> {
  const formData = new FormData();
  files.forEach(file => formData.append("files", file));
  const res = await fetch("/api/shapefiles/preview-upload", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Replace existing shapefiles with uploaded ones
 * @param replacements - Array of {uploaded_path, target_path} pairs
 */
export async function replaceShapefiles(
  replacements: Array<{ uploaded_path: string; target_path: string }>
): Promise<ReplaceResult> {
  const res = await fetch("/api/shapefiles/replace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ replacements }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Delete a shapefile and all companion files
 * @param shapefilePath - Relative path to shapefile (e.g., "area_type/Central.shp")
 */
export async function deleteShapefile(shapefilePath: string): Promise<{ message: string; deleted_files: string[] }> {
  const res = await fetch(`/api/shapefiles/${shapefilePath}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Rename a shapefile and all companion files to a new stem
 */
export async function renameShapefile(shapefilePath: string, newName: string): Promise<{ message: string; new_path: string }> {
  const res = await fetch(`/api/shapefiles/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: shapefilePath, new_name: newName }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Revert a renamed shapefile back to its original name
 */
export async function revertShapefile(shapefilePath: string): Promise<{ message: string; new_path: string }> {
  const res = await fetch(`/api/shapefiles/revert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: shapefilePath }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Validate a shapefile (check for required files, valid CRS, etc.)
 * @param file - File object to validate (must be .zip)
 */
export async function validateShapefile(file: File): Promise<ValidationResult> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/shapefiles/validate", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Validate that a new shapefile is compatible with one being replaced
 * @param newFilePath - Path to new uploaded shapefile (e.g., "temp_replace/new.shp")
 * @param targetFilePath - Path to existing shapefile being replaced (e.g., "area_type/old.shp")
 * @param layerName - Optional layer identifier (e.g., "cycling_path")
 */
export async function validateShapefileReplacement(
  newFilePath: string,
  targetFilePath: string,
  layerName?: string
): Promise<ReplacementValidationResult> {
  const res = await fetch("/api/shapefiles/validate-replacement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      new_file_path: newFilePath,
      target_file_path: targetFilePath,
      layer_name: layerName,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * List all shapefile categories (subdirectories)
 */
export async function listShapefileCategories(): Promise<ShapefileCategoryInfo[]> {
  const res = await fetch("/api/shapefiles/categories");
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// ========================================================================
// TREATMENT APPLICATION API
// ========================================================================

/**
 * Payload for applying treatments to a segment
 */
export type ApplyTreatmentsPayload = {
  segment_index: number;
  treatment_ids: number[];
  image_ref?: string;
};

/**
 * Result of applying treatments
 */
export type ApplyTreatmentsResult = {
  ok: boolean;
  segment_index: number;
  treatments_applied: string;
  modified_attributes: Record<string, number>;
  before_scores: {
    BB: number;
    BP: number;
    SB: number;
    VB: number;
    "Overall Risk Level": number;
  };
  after_scores: {
    BB: number;
    BP: number;
    SB: number;
    VB: number;
    "Overall Risk Level": number;
  };
};

/**
 * Treatment state for a segment
 */
export type SegmentTreatmentState = {
  ok: boolean;
  segment_index: number;
  has_treatments: boolean;
  treatments_applied: number[];
  modified_attributes?: Record<string, number>;
  after_scores?: {
    BB: number;
    BP: number;
    SB: number;
    VB: number;
    "Overall Risk Level": number;
  };
};

/**
 * Apply treatments to a specific segment
 * @param project - Project name
 * @param payload - Treatment application payload
 * @returns Treatment application result with before/after scores
 */
export async function applyTreatments(
  project: string,
  payload: ApplyTreatmentsPayload
): Promise<ApplyTreatmentsResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/apply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Get treatment state for a specific segment
 * @param project - Project name
 * @param segmentIndex - Segment index
 * @returns Treatment state including applied treatments and after scores
 */
export async function getSegmentTreatments(
  project: string,
  segmentIndex: number
): Promise<SegmentTreatmentState> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/segment/${segmentIndex}`
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type AllTreatmentsSegment = {
  has_treatments: boolean;
  treatments_applied: number[];
  modified_attributes: Record<string, number | null>;
  after_scores?: {
    BB: number;
    BP: number;
    SB: number;
    VB: number;
    "Overall Risk Level": number;
  };
};

/**
 * Fetch treatment state for all segments in one call (no re-scoring).
 * Only returns segments that actually have treatments applied.
 */
export async function getAllTreatments(
  project: string
): Promise<{ ok: boolean; segments: Record<string, AllTreatmentsSegment> }> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/all`
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Export modified attributes CSV after treatment is applied
 * @param project - Project name
 * @param payload - Segment index and treatment IDs
 * @returns Export result with filename and path
 */

/**
 * Payload for previewing treatments on a segment
 */
export type PreviewTreatmentsPayload = {
  segment_index: number;
  treatment_ids: number[];
};

/**
 * Result of previewing treatments
 */
export type PreviewTreatmentsResult = {
  ok: boolean;
  segment_index: number;
  modified_attributes: Record<string, number>;
  before_scores: {
    BB: number;
    BP: number;
    SB: number;
    VB: number;
    "Overall Risk Level": number;
  };
  after_scores: {
    BB: number;
    BP: number;
    SB: number;
    VB: number;
    "Overall Risk Level": number;
  };
};

/**
 * Preview treatments for a specific segment without saving
 * @param project - Project name
 * @param payload - Preview payload
 * @returns Preview result with before/after scores
 */
export async function previewTreatments(
  project: string,
  payload: PreviewTreatmentsPayload
): Promise<PreviewTreatmentsResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Fetch per-treatment effectiveness counts for a project. Effectiveness is the
 * number of segments whose Overall Risk Level Band improves (band decreases)
 * when that treatment is applied in isolation. Used to rank the "By Treatment"
 * list top-down by effectiveness.
 */
export type TreatmentEffectivenessResult = {
  ok: boolean;
  total_segments: number;
  counts: Record<string, number>;
  applicable_counts: Record<string, number>;
};

export async function getTreatmentEffectiveness(
  project: string,
  treatmentIds?: number[]
): Promise<TreatmentEffectivenessResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/effectiveness`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(treatmentIds ? { treatment_ids: treatmentIds } : {}),
    }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type TreatmentSegmentEffectivenessResult = {
  ok: boolean;
  score_drops: Record<string, number>;
};

export async function getTreatmentSegmentEffectiveness(
  project: string,
  segmentIndex: number
): Promise<TreatmentSegmentEffectivenessResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/effectiveness/segment/${segmentIndex}`
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Apply all applicable recommended treatments to all segments in a project
 * @param project - Project name
 * @returns Result with details on how many segments were treated
 */
export type ApplyAllTreatmentsResult = {
  ok: boolean;
  total_segments: number;
  segments_treated: number;
  segments_skipped: number;
  details: Array<{
    segment_index: number;
    treatment_ids: number[];
    before_scores: Record<string, number>;
    after_scores: Record<string, number>;
  }>;
};

export async function applyAllTreatments(
  project: string
): Promise<ApplyAllTreatmentsResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/apply-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Apply a specific treatment to all applicable segments in a project
 * @param project - Project name
 * @param treatmentId - ID of the treatment to apply
 * @returns Result with details on how many segments were treated
 */
export async function applySpecificTreatment(
  project: string,
  treatmentId: number
): Promise<ApplyAllTreatmentsResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/apply-specific`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ treatment_id: treatmentId }),
    }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Reset all applied treatments for all segments in a project
 * @param project - Project name
 * @returns Result with details on how many segments were reset
 */
export type ResetAllTreatmentsResult = {
  ok: boolean;
  total_segments: number;
  segments_reset: number;
  message: string;
};

export async function resetAllTreatments(
  project: string
): Promise<ResetAllTreatmentsResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/reset-all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Save all pending treatment changes to treatment.csv
 * @param project - Project name
 * @returns Result of save operation
 */
export type SaveTreatmentsResult = {
  ok: boolean;
  message: string;
};

export async function saveTreatments(
  project: string
): Promise<SaveTreatmentsResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Upload images to a source folder in the /in directory
 * @param folderName - Name of the folder to create/upload to in /in directory
 * @param files - Array of image files to upload
 */
export async function uploadImagesToSourceFolder(
  folderName: string,
  files: File[]
): Promise<{ count: number; errors: string[] }> {
  const formData = new FormData();
  formData.append("folder_name", folderName);

  files.forEach(file => {
    // If the file was dropped as part of a folder, it will have webkitRelativePath
    // Fallback to name if it's just a regular file selection
    const path = file.webkitRelativePath || file.name;
    formData.append("images", file, path);
  });

  const res = await fetch("/api/projects/folders/upload-images", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Download filtered images as a ZIP file
 * @param payload - Map of project names to list of image references
 */
export async function downloadFilteredImages(payload: { projects: Record<string, string[]> }) {
  const res = await fetch("/api/projects/download-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await readError(res);
    throw new Error(errorText || "Download failed");
  }

  return res.blob();
}

/**
 * Export filtered segments as a zipped shapefile.
 * @param payload - Map of project names to list of image references (current filtered view)
 */
export async function exportShapefile(payload: { projects: Record<string, string[]> }): Promise<Blob> {
  const res = await fetch("/api/projects/export-shapefile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await readError(res);
    throw new Error(errorText || "Shapefile export failed");
  }

  return res.blob();
}
