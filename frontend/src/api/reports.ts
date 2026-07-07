/**
 * Generated reports API — list, save, and delete PDF reports that have been
 * produced by the Report Builder and stored on the server.
 *
 * Used by: ReportBuilderPage (save/load generated reports panel).
 */

import { readError } from "./_client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GeneratedReportInfo {
  name: string;
  size: number;
  created: string;
}

// ── API functions ─────────────────────────────────────────────────────────────

/** GET /api/generated-reports/ — list all previously saved report files. */
export async function listGeneratedReports(): Promise<GeneratedReportInfo[]> {
  const res = await fetch("/api/generated-reports/");
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/generated-reports/save — upload and save a report PDF blob to the server.
 * @param blob     - PDF blob produced by the Report Builder
 * @param filename - Filename to store it under
 */
export async function saveGeneratedReport(blob: Blob, filename: string): Promise<void> {
  const formData = new FormData();
  formData.append("file", blob, filename);
  formData.append("filename", filename);
  const res = await fetch("/api/generated-reports/save", { method: "POST", body: formData });
  if (!res.ok) throw new Error(await readError(res));
}

/**
 * DELETE /api/generated-reports/:filename — delete a saved report file.
 * @param filename - Exact filename as returned by `listGeneratedReports`
 */
export async function deleteGeneratedReport(filename: string): Promise<void> {
  const res = await fetch(`/api/generated-reports/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await readError(res));
}
