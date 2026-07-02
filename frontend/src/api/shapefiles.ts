/**
 * Shapefile management API — upload, replace, validate, rename, and delete the
 * GIS shapefiles used by the autocode GIS inference pipeline.
 *
 * Used by: GisLayersPage (ShapefileModal).
 */

import type { FeatureCollection } from "geojson";
import { readError } from "./_client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ShapefileMetadata = {
  feature_count: number;
  crs: string;
  bounds: { minx: number; miny: number; maxx: number; maxy: number };
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
  uploaded: Array<{ name: string; category: string; path: string }>;
  errors: string[];
  count: number;
};

export type ReplaceResult = {
  replaced: Array<{ target: string; status: string; backup: string }>;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info: Record<string, any>;
  column_mapping: Record<string, string>;
};

// ── API functions ─────────────────────────────────────────────────────────────

/** GET /api/shapefiles — list all available shapefiles with metadata. */
export async function listShapefiles(): Promise<ShapefileInfo[]> {
  const res = await fetch("/api/shapefiles");
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/shapefiles/upload — upload new shapefiles (ZIP or individual files).
 * @param files    - Files to upload
 * @param category - Optional destination category/subdirectory
 */
export async function uploadShapefiles(files: File[], category?: string): Promise<UploadResult> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  if (category) formData.append("category", category);
  const res = await fetch("/api/shapefiles/upload", { method: "POST", body: formData });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/shapefiles/preview-upload — temporarily upload shapefile files and
 * return a GeoJSON preview. Files are NOT saved permanently.
 */
export async function previewUploadedShapefiles(files: File[]): Promise<FeatureCollection> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  let res: Response;
  try {
    res = await fetch("/api/shapefiles/preview-upload", { method: "POST", body: formData });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Cannot reach the backend to import the shapefile. Make sure the backend is running (e.g. via Run-PSAT.bat) and try again."
      );
    }
    throw error;
  }
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * PUT /api/shapefiles/replace — replace existing shapefiles with uploaded ones.
 * @param replacements - Array of `{ uploaded_path, target_path }` pairs
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
 * DELETE /api/shapefiles/:path — delete a shapefile and all companion files.
 * @param shapefilePath - Relative path, e.g. "area_type/Central.shp"
 */
export async function deleteShapefile(
  shapefilePath: string
): Promise<{ message: string; deleted_files: string[] }> {
  const res = await fetch(`/api/shapefiles/${shapefilePath}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/shapefiles/rename — rename a shapefile (all companion files updated).
 * @param shapefilePath - Relative path to the existing shapefile
 * @param newName       - New stem name (no extension)
 */
export async function renameShapefile(
  shapefilePath: string,
  newName: string
): Promise<{ message: string; new_path: string }> {
  const res = await fetch("/api/shapefiles/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: shapefilePath, new_name: newName }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/shapefiles/revert — revert a renamed shapefile back to its original name.
 * @param shapefilePath - Relative path to the renamed shapefile
 */
export async function revertShapefile(
  shapefilePath: string
): Promise<{ message: string; new_path: string }> {
  const res = await fetch("/api/shapefiles/revert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: shapefilePath }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/shapefiles/validate — validate a shapefile ZIP for required files and CRS.
 * @param file - File to validate (must be .zip)
 */
export async function validateShapefile(file: File): Promise<ValidationResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/shapefiles/validate", { method: "POST", body: formData });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/shapefiles/validate-replacement — validate that a new shapefile is
 * compatible with the one it will replace (column mapping check).
 * @param newFilePath    - Path to the uploaded replacement shapefile
 * @param targetFilePath - Path to the existing shapefile being replaced
 * @param layerName      - Optional layer identifier (e.g. "cycling_path")
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

/** GET /api/shapefiles/categories — list all shapefile categories (subdirectories). */
export async function listShapefileCategories(): Promise<ShapefileCategoryInfo[]> {
  const res = await fetch("/api/shapefiles/categories");
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
