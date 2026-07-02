/**
 * Media export API — bulk download of filtered segment images and shapefile export.
 *
 * Used by: PathAnalysisPage (download-images button, export-shapefile button).
 */

import { readError } from "./_client";

/**
 * POST /api/projects/download-images — download a ZIP of images for the given
 * project/segment selections. Returns a Blob for the browser to save.
 * @param payload - Map of project names to lists of image references
 */
export async function downloadFilteredImages(
  payload: { projects: Record<string, string[]> }
): Promise<Blob> {
  const res = await fetch("/api/projects/download-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await readError(res)) || "Download failed");
  return res.blob();
}

/**
 * POST /api/projects/export-shapefile — export filtered segments as a zipped
 * Shapefile. Returns a Blob for the browser to save.
 * @param payload - Map of project names to lists of image references (current filtered view)
 */
export async function exportShapefile(
  payload: { projects: Record<string, string[]> }
): Promise<Blob> {
  const res = await fetch("/api/projects/export-shapefile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await readError(res)) || "Shapefile export failed");
  return res.blob();
}
