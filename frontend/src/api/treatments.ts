/**
 * Treatment application API — apply, preview, reset, and query treatments for
 * project segments. Treatments modify attribute values to model safety improvements.
 *
 * Used by: TreatmentDetailPage, TreatmentPage (sidebar), ReportBuilderPage.
 */

import { readError } from "./_client";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Payload for applying treatments to a segment. */
export type ApplyTreatmentsPayload = {
  segment_index: number;
  treatment_ids: number[];
  image_ref?: string;
};

/** Result of applying treatments — includes before/after scores. */
export type ApplyTreatmentsResult = {
  ok: boolean;
  segment_index: number;
  treatments_applied: string;
  modified_attributes: Record<string, number>;
  before_scores: { BB: number; BP: number; SB: number; VB: number; "Overall Risk Level": number };
  after_scores:  { BB: number; BP: number; SB: number; VB: number; "Overall Risk Level": number };
};

/** Persisted treatment state for a single segment. */
export type SegmentTreatmentState = {
  ok: boolean;
  segment_index: number;
  has_treatments: boolean;
  treatments_applied: number[];
  modified_attributes?: Record<string, number>;
  after_scores?: { BB: number; BP: number; SB: number; VB: number; "Overall Risk Level": number };
};

/** Treatment state shape returned by the bulk `/treatments/all` endpoint. */
export type AllTreatmentsSegment = {
  has_treatments: boolean;
  treatments_applied: number[];
  modified_attributes: Record<string, number | null>;
  after_scores?: { BB: number; BP: number; SB: number; VB: number; "Overall Risk Level": number };
};

/** Payload for previewing treatments without saving. */
export type PreviewTreatmentsPayload = {
  segment_index: number;
  treatment_ids: number[];
};

/** Result of previewing treatments — before/after scores without persistence. */
export type PreviewTreatmentsResult = {
  ok: boolean;
  segment_index: number;
  modified_attributes: Record<string, number>;
  before_scores: { BB: number; BP: number; SB: number; VB: number; "Overall Risk Level": number };
  after_scores:  { BB: number; BP: number; SB: number; VB: number; "Overall Risk Level": number };
};

/** Per-treatment effectiveness counts across all project segments. */
export type TreatmentEffectivenessResult = {
  ok: boolean;
  total_segments: number;
  counts: Record<string, number>;
  applicable_counts: Record<string, number>;
};

/** Per-treatment score drops for a single segment. */
export type TreatmentSegmentEffectivenessResult = {
  ok: boolean;
  score_drops: Record<string, number>;
};

/** Result of applying all recommended treatments project-wide. */
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

/** Result of resetting all treatments project-wide. */
export type ResetAllTreatmentsResult = {
  ok: boolean;
  total_segments: number;
  segments_reset: number;
  message: string;
};

/** Result of persisting treatment changes to treatment.csv. */
export type SaveTreatmentsResult = {
  ok: boolean;
  message: string;
};

// ── API functions ─────────────────────────────────────────────────────────────

/**
 * POST /api/projects/:name/treatments/apply — apply a treatment set to one segment.
 * Persists the result and returns before/after scores.
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
 * GET /api/projects/:name/treatments/segment/:index — fetch persisted treatment
 * state for a single segment (which treatment IDs are applied, after-scores).
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

/**
 * GET /api/projects/:name/treatments/all — fetch treatment state for every segment
 * in one request (no re-scoring). Only treated segments are returned.
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
 * POST /api/projects/:name/treatments/preview — compute before/after scores for a
 * treatment set WITHOUT persisting. Safe for staging previews.
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
 * POST /api/projects/:name/treatments/effectiveness — fetch per-treatment
 * effectiveness counts (segments improved) across the whole project.
 * Used to rank treatments top-down by impact in the "By Treatment" view.
 * @param treatmentIds - Optional subset of IDs to evaluate; defaults to all
 */
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

/**
 * GET /api/projects/:name/treatments/effectiveness/segment/:index — score drop
 * per treatment for one segment. Used by the "By Segment" view score-drop labels.
 */
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
 * POST /api/projects/:name/treatments/apply-all — apply all recommended treatments
 * to every applicable segment project-wide.
 */
export async function applyAllTreatments(project: string): Promise<ApplyAllTreatmentsResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/apply-all`,
    { method: "POST", headers: { "Content-Type": "application/json" } }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/projects/:name/treatments/apply-specific — apply one treatment to all
 * segments where it is applicable.
 * @param treatmentId - ID of the treatment to apply
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
 * POST /api/projects/:name/treatments/reset-all — remove all applied treatments
 * from every segment in the project.
 */
export async function resetAllTreatments(project: string): Promise<ResetAllTreatmentsResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/reset-all`,
    { method: "POST", headers: { "Content-Type": "application/json" } }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * POST /api/projects/:name/treatments/save — flush pending treatment changes to
 * `treatment.csv` on disk.
 */
export async function saveTreatments(project: string): Promise<SaveTreatmentsResult> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project)}/treatments/save`,
    { method: "POST", headers: { "Content-Type": "application/json" } }
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
