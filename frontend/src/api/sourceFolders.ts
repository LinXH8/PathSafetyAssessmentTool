/**
 * Source folder API — import, preview, and manage the `/in` image source folders
 * that back project creation.
 *
 * Used by: Projects page (CreateProjectModal), source-folder import flows.
 */

import { readError } from "./_client";
import type { ProjectSelectionGeometry } from "./geo";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SourceFolderSuggestion {
  name: string;
  exists: boolean;
}

export interface SourceFolderPreview {
  folder_name: string;
  image_count: number;
  geotagged_image_count: number;
  segment_count: number;
  total_distance_km?: number | null;
  segment_error: string | null;
  earliest_modified_at: string | null;
  latest_modified_at: string | null;
  survey_quarter: string | null;
  survey_quarters: string[];
  /** Majority-vote quarter (EXIF-first, tolerant of a few outlier images), as
   * opposed to survey_quarter which requires every image to agree. */
  majority_quarter: string | null;
  cached: boolean;
  mixed_quarters: boolean;
  renamed_from: string | null;
}

/**
 * Cache-only bulk summary for every source folder. `cached: false` rows carry
 * null statistics and should be lazily filled via {@link fetchSourceFolderPreview}.
 * Cheap (no EXIF/geo work) so it can auto-populate the Create table on mount.
 */
export interface SourceFolderSummary {
  folder_name: string;
  image_count: number | null;
  geotagged_image_count: number | null;
  segment_count: number | null;
  total_distance_km: number | null;
  segment_error: string | null;
  earliest_modified_at: string | null;
  latest_modified_at: string | null;
  survey_quarter: string | null;
  survey_quarters: string[];
  /** Majority-vote quarter (EXIF-first, tolerant of a few outlier images), as
   * opposed to survey_quarter which requires every image to agree. */
  majority_quarter: string | null;
  mixed_quarters: boolean;
  cached: boolean;
  renamed_from: string | null;
}

export interface CopyLocalImagesResult {
  count: number;
  errors: string[];
  folder_name: string;
  renamed_from: string | null;
  preview: SourceFolderPreview;
}

// ── API functions ─────────────────────────────────────────────────────────────

/**
 * GET /api/projects/folders — list names of all existing source folders in /in.
 */
export async function listSourceFolders(opts?: { signal?: AbortSignal }) {
  const res = await fetch("/api/projects/folders", { signal: opts?.signal });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const data = await res.json();
  return (data?.items ?? []) as string[];
}

/**
 * GET /api/projects/folders/suggestions — source folders not yet linked to a project.
 */
export async function listSourceFolderSuggestions(opts?: { signal?: AbortSignal }) {
  const res = await fetch("/api/projects/folders/suggestions", { signal: opts?.signal });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return (data?.items ?? []) as SourceFolderSuggestion[];
}

/**
 * GET /api/projects/folders/preview — detailed preview for a single folder
 * (parses EXIF geotags, counts segments). Expensive; use summaries for the list.
 * @param folderName  - Source folder name
 * @param skipRename  - Skip the auto-rename heuristic (use raw name as-is)
 */
export async function fetchSourceFolderPreview(
  folderName: string,
  opts?: { signal?: AbortSignal; skipRename?: boolean }
) {
  const params = new URLSearchParams({ folder_name: folderName });
  if (opts?.skipRename) params.set("skip_rename", "1");
  const res = await fetch(`/api/projects/folders/preview?${params.toString()}`, {
    signal: opts?.signal,
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as SourceFolderPreview;
}

/**
 * GET /api/projects/folders/summaries — cheap bulk summary for all source folders.
 * Null fields on `cached: false` rows must be lazily filled via `fetchSourceFolderPreview`.
 */
export async function fetchSourceFolderSummaries(opts?: { signal?: AbortSignal }) {
  const res = await fetch("/api/projects/folders/summaries", { signal: opts?.signal });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return (data?.items ?? []) as SourceFolderSummary[];
}

/**
 * POST /api/projects/folders/pick-local — open the OS file picker on the server
 * host (desktop mode only) and return the chosen local path and a suggested name.
 */
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

/**
 * POST /api/projects/folders/copy-local — copy images from a local path into the
 * /in source folder and return a preview of the resulting folder.
 * @param sourcePath - Absolute local path to the image folder
 * @param folderName - Name to use for the created source folder
 */
export async function copyLocalImagesToSourceFolder(
  sourcePath: string,
  folderName: string
): Promise<CopyLocalImagesResult> {
  const res = await fetch("/api/projects/folders/copy-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: sourcePath, folder_name: folderName }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/projects/folders — create a project from one or more source folders.
 * @param project_name       - Desired project name
 * @param folder_name        - Single folder name or array of folder names
 * @param tags               - Optional tags to apply to the new project
 * @param selectionGeometry  - Optional GeoJSON geometry to clip segments on creation
 */
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
  return (await res.json()) as { ok?: boolean; name?: string };
}

/**
 * POST /api/projects/folders/upload-images — upload image files into a named
 * source folder in /in. Supports folder-drop (preserves `webkitRelativePath`).
 * @param folderName - Destination source folder name
 * @param files      - Array of image File objects to upload
 */
export async function uploadImagesToSourceFolder(
  folderName: string,
  files: File[]
): Promise<{ count: number; errors: string[] }> {
  const formData = new FormData();
  formData.append("folder_name", folderName);
  files.forEach((file) => {
    // webkitRelativePath preserves subdirectory structure when a folder is dropped.
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
