/**
 * Core project API — project/version CRUD, attribute read/write, scoring,
 * and the filter-context types shared between PathAnalysisPage and CodingPage.
 *
 * Used by: CodingPage, PathAnalysisPage, TreatmentPage, Projects page,
 *          and projectDataCache.ts.
 */

import type { FeatureCollection } from "geojson";
import { readError } from "./_client";

// ── Project list ──────────────────────────────────────────────────────────────

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

/** GET /api/ping — health check. */
export async function ping(): Promise<{ status: string }> {
  const res = await fetch("/api/ping");
  if (!res.ok) throw new Error("Failed /api/ping");
  return res.json();
}

/** GET /api/projects — list all projects in the active profile. */
export async function fetchProjectList(): Promise<FileResponse> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed /api/projects");
  return res.json();
}

/**
 * POST /api/projects/export — download one or more projects as a single ZIP
 * bundle and trigger a browser download. The bundle is re-importable via the
 * Create Project page.
 *
 * @param projectNames        - Projects to bundle
 * @param options.includeTags - Keep project tags in the bundle (default true)
 * @param options.includeSourceFolder - Bundle the raw survey images (default true)
 * @returns the number of projects exported
 */
export async function exportProjects(
  projectNames: string[],
  options?: { includeTags?: boolean; includeSourceFolder?: boolean }
): Promise<void> {
  const res = await fetch("/api/projects/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_names: projectNames,
      include_tags: options?.includeTags ?? true,
      include_source_folder: options?.includeSourceFolder ?? true,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));

  // Derive the filename from the Content-Disposition header when present.
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^\";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : "projects_export.psat.zip";

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface ImportProjectsResult {
  imported: string[];
  skipped: Array<{ name: string; reason: string }>;
  errors: Array<{ name: string; reason: string }>;
}

/**
 * POST /api/projects/import — import projects from an uploaded .psat.zip bundle
 * (produced by {@link exportProjects}). The projects are unpacked into the active
 * profile; existing names are skipped, never overwritten.
 */
export async function importProjects(file: File): Promise<ImportProjectsResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/projects/import", { method: "POST", body: formData });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ImportProjectsResult;
}

// ── Project detail ────────────────────────────────────────────────────────────

export type ProjectDetail = {
  name: string;
  versions: string[];
  latest: string;
};

/** GET /api/projects/:name — project version list. */
export async function fetchProjectDetail(projectName: string): Promise<ProjectDetail> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}`);
  if (!res.ok) throw new Error(`Failed GET /api/projects/${projectName}`);
  return res.json();
}

/** GET /api/projects/:name/metadata — full project metadata including verified status. */
export async function fetchProjectMetadata(projectName: string): Promise<ProjectListItem> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/metadata`);
  if (!res.ok) throw new Error(`Failed to fetch metadata for ${projectName}`);
  return res.json();
}

// ── Attributes ────────────────────────────────────────────────────────────────

export type AttributeRow = Record<string, string | number | boolean | null>;
export type AttributesResponse = { rows: AttributeRow[] };

/**
 * Filter context passed from PathAnalysisPage → CodingPage via navigation
 * state and sessionStorage (`codingFilterContext` key).
 *
 * See CLAUDE.md §"CodingPage: Filter Colors Leak" for the full lifecycle.
 */
export type FilteredSegmentPoint = {
  latlng: [number, number];
  color: string;
  idx: number;
};

export type FilteredProjectData = {
  projectName: string;
  filteredIndices: number[];
  points: FilteredSegmentPoint[];
};

export type FilterLegendEntry = {
  category: string;
  color: string;
};

export type CodingFilterContext = {
  projects: FilteredProjectData[];
  legend?: {
    attribute: string;
    entries: FilterLegendEntry[];
  };
};

/**
 * sessionStorage key for the coding filter context.
 * Defined in and re-exported from `constants/sessionKeys.ts`; imported here
 * so the api barrel (`api/index.ts`) continues to expose it without change.
 */
export { CODING_FILTER_CONTEXT_KEY } from "../constants/sessionKeys";

/** Numeric attribute code → display label mappings, keyed by field name. */
export type AttrMappings = Record<string, Record<string, string>>;

/** GET /api/projects/:name/versions/latest/attributes — full attribute table. */
export async function fetchProjectAttributes(projectName: string): Promise<AttributesResponse> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectName)}/versions/latest/attributes`
  );
  if (!res.ok)
    throw new Error(`Failed GET /api/projects/${projectName}/versions/latest/attributes`);
  return res.json();
}

/** GET /api/projects/:name/geodata — GeoJSON FeatureCollection for the project. */
export async function fetchProjectGeoJSON(projectName: string): Promise<FeatureCollection> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/geodata`);
  if (!res.ok) throw new Error(`Failed GET /api/projects/${projectName}/geodata`);
  return res.json();
}

/** GET /api/projects/attribute-mappings — numeric code → display label map for every field. */
export async function fetchAttributeMappings(): Promise<AttrMappings> {
  const r = await fetch("/api/projects/attribute-mappings");
  if (!r.ok) throw new Error("Failed to load attribute mappings");
  return r.json();
}

/** GET /api/projects/custom-attribute-options — user-defined option lists per field. */
export async function fetchCustomAttrOptions(): Promise<Record<string, string[]>> {
  const r = await fetch("/api/projects/custom-attribute-options");
  if (!r.ok) throw new Error("Failed to load custom attribute options");
  return r.json();
}

/**
 * PUT /api/projects/custom-attribute-options — replace the option list for one field.
 * @param field   - Field name (e.g. "Facility Type")
 * @param options - Full replacement list of option strings
 */
export async function updateCustomAttrOptions(field: string, options: string[]): Promise<void> {
  const r = await fetch("/api/projects/custom-attribute-options", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ field, options }),
  });
  if (!r.ok) throw new Error(await r.text().catch(() => r.statusText));
}

/**
 * PUT /api/projects/:name/attributes — persist the full attribute table.
 * @param project - Project name
 * @param rows    - Complete replacement rows array
 */
export async function saveAttributes(project: string, rows: AttributeRow[]) {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/attributes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export type CalculateScoreResult = {
  ok: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result_rows: Record<string, any>[];
};

/**
 * POST /api/projects/:name/score — (re)compute cycleRAP scores and persist them.
 * Use `fetchProjectResults` for read-only access to already-computed scores.
 */
export async function calculateScore(project: string): Promise<CalculateScoreResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as CalculateScoreResult;
}

/**
 * GET /api/projects/:name/results — fetch persisted cycleRAP scores without
 * recomputing. Use this for read paths (Path Analysis, Treatment page); fall
 * back to `calculateScore` only when no persisted results exist.
 */
export async function fetchProjectResults(project: string): Promise<CalculateScoreResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/results`);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as CalculateScoreResult;
}

/**
 * POST /api/projects/:name/score — compute scores for a single attribute row.
 * @param project    - Project name
 * @param attributes - Single attribute row to score
 * @returns Score record for that row
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function calculateScoreForRow(
  project: string,
  attributes: AttributeRow
): Promise<Record<string, any>> {
  const res = await fetch(`/api/projects/${encodeURIComponent(project)}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attributes: [attributes] }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const result = (await res.json()) as CalculateScoreResult;
  return result.result_rows[0] || {};
}

// ── Project mutations ─────────────────────────────────────────────────────────

/**
 * DELETE /api/projects/:name — permanently delete a project.
 * Returns `{ ok, name }`.
 */
export async function deleteProject(projectName: string) {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg || "Delete failed");
  }
  return (await res.json()) as { ok?: boolean; name?: string };
}

/**
 * PATCH /api/projects/:name — update project metadata (name, tags, verified status).
 * @param projectName - Current project name
 * @param updates     - Fields to update; all optional
 */
export async function updateProject(
  projectName: string,
  updates: {
    new_name?: string;
    tags?: string[];
    verified?: boolean;
    verified_segment_count?: number;
    autocoded_segment_count?: number;
  }
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
  return (await res.json()) as {
    ok?: boolean;
    name?: string;
    tags?: string[];
    verified?: boolean;
    verified_segment_count?: number;
    autocoded_segment_count?: number;
  };
}

// ── Segment mutations ─────────────────────────────────────────────────────────

/**
 * DELETE /api/projects/:name/segments/:index — delete a single segment.
 * @param project - Project name
 * @param index   - 0-based segment index
 */
export async function deleteSegment(project: string, index: number) {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/segments/${index}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/projects/:name/segments/delete-batch — delete multiple segments.
 * @param project - Project name
 * @param indices - 0-based segment indices to delete
 */
export async function deleteSegmentsBatch(project: string, indices: number[]) {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/segments/delete-batch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ indices }),
    }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/projects/check-collisions — check whether segments from one project
 * overlap with existing segments in the target project (by image reference).
 */
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

/**
 * POST /api/projects/copy-segments — copy segments between projects.
 * @param sourceProject - Source project name
 * @param targetProject - Destination project name
 * @param indices       - 0-based segment indices to copy
 * @param createTarget  - Create target project if it doesn't exist
 * @param replace       - Replace colliding segments instead of skipping
 * @param tags          - Tags to apply when creating a new target project
 */
export async function copySegments(
  sourceProject: string,
  targetProject: string,
  indices: number[],
  createTarget: boolean,
  replace = false,
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
