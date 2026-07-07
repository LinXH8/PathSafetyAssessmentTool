/**
 * Autocode API — CV (vision model) and GIS inference endpoints that predict
 * segment attributes automatically. Includes a streaming variant for bulk
 * operations that reports per-segment progress via SSE.
 *
 * Used by: CodingPage (CodingSidebar), single-segment autocode flow.
 * See CLAUDE.md §"Autocode Per-Attribute" for skip-flag behaviour and benchmarks.
 */

import type { AttributeRow } from "./projects";

// ── Constants ─────────────────────────────────────────────────────────────────

const AUTOCODE_NETWORK_ERROR =
  "Cannot reach the backend autocode service. Make sure the backend is running on " +
  "http://127.0.0.1:8000, preferably via Run-PSAT.bat or the psat conda environment.";

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Wrapper around `fetch` that converts a TypeError (network failure) into the
 * descriptive autocode-specific message so the user knows to start the backend.
 */
async function fetchAutocode(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError) throw new Error(AUTOCODE_NETWORK_ERROR);
    throw error;
  }
}

// ── Request / response types ──────────────────────────────────────────────────

/** Auto-code a single image by reference. */
export type AutoCodeSinglePayload = {
  imageRef: string;
  coords: number[][];
  index?: number;
};

/** Auto-code all rows in a project. */
export type AutoCodeBulkAllPayload = {
  all: true;
  save?: boolean;
  fields?: string[];
};

/** Auto-code specific rows by index. */
export type AutoCodeBulkIndicesPayload = {
  indices: number[];
  save?: boolean;
  fields?: string[];
};

export type AutoCodeSingleResult = {
  updates: Record<string, number | string>;
  saved?: boolean;
  changed_fields?: string[];
  field_sources?: Record<string, string>;
};

export type AutoCodeBulkResult = {
  saved: boolean;
  total: number;
  ok: number;
  fail: number;
  errors: { index: number; reason: string }[];
  changed_by_row?: Record<number, string[]>;
  sources_by_row?: Record<number, Record<string, string>>;
  updated_attributes?: AttributeRow[];
};

type AutoCodeAllPayload =
  | AutoCodeSinglePayload
  | AutoCodeBulkAllPayload
  | AutoCodeBulkIndicesPayload;

type AutoCodeAllResult = AutoCodeSingleResult | AutoCodeBulkResult;

// ── API functions ─────────────────────────────────────────────────────────────

/**
 * POST /api/projects/:name/autocode/image — run the CV model on a single image.
 * @param project  - Project name
 * @param imageRef - Image filename in the project's source folder
 */
export async function autocodeImage(project: string, imageRef: string) {
  const res = await fetchAutocode(
    `/api/projects/${encodeURIComponent(project)}/autocode/image`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageRef }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as {
    updates: AttributeRow;
    changed_fields: string[];
    field_sources?: Record<string, string>;
    gradient_pct?: number;
  };
  if (data.gradient_pct !== undefined) {
    console.log(
      `[Gradient] ${imageRef}: ${data.gradient_pct >= 0 ? "+" : ""}${data.gradient_pct.toFixed(2)}%`
    );
  }
  return data;
}

/**
 * POST /api/projects/:name/autocode/gis — run GIS-based attribute inference for
 * a segment defined by its coordinate array.
 * @param project - Project name
 * @param coords  - LineString coordinates [[lon, lat], ...]
 */
export async function autocodeGIS(project: string, coords: number[][]) {
  const res = await fetchAutocode(
    `/api/projects/${encodeURIComponent(project)}/autocode/gis`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coords }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as {
    updates: AttributeRow;
    changed_fields: string[];
    field_sources?: Record<string, string>;
    gradient_pct?: number;
  };
  if (data.gradient_pct !== undefined) {
    console.log(
      `[Gradient] GIS result: ${data.gradient_pct >= 0 ? "+" : ""}${data.gradient_pct.toFixed(2)}%`
    );
  }
  return data;
}

/**
 * POST /api/projects/:name/autocode/all — auto-code attributes using CV and GIS
 * models. Supports three modes:
 *  1. Single image: `{ imageRef, coords, index? }`
 *  2. All images:   `{ all: true, save?: false }`
 *  3. Specific rows: `{ indices: [0,2,5], save?: false }`
 *
 * When `save: false` (recommended for bulk), results are kept in memory only
 * and returned in `updated_attributes`. The user must explicitly save to persist.
 *
 * @param project - Project name
 * @param payload - One of the three payload shapes above
 */
export async function autocodeAll(
  project: string,
  payload: AutoCodeAllPayload
): Promise<AutoCodeAllResult> {
  const res = await fetchAutocode(
    `/api/projects/${encodeURIComponent(project)}/autocode/all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as AutoCodeAllResult;
}

/**
 * Streaming variant of `autocodeAll` — uses SSE to report per-segment progress
 * so the UI counter can tick up in real time (1/412, 2/412, …).
 *
 * @param project    - Project name
 * @param payload    - Same payload as `autocodeAll` (`stream: true` is injected)
 * @param onProgress - Called after each segment: (processed, total, errorCount)
 * @returns          - Final `AutoCodeBulkResult` (same shape as bulk response)
 */
export async function autocodeAllStream(
  project: string,
  payload: AutoCodeAllPayload,
  onProgress: (processed: number, total: number, errors: number) => void
): Promise<AutoCodeBulkResult> {
  const res = await fetchAutocode(
    `/api/projects/${encodeURIComponent(project)}/autocode/all`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, stream: true }),
    }
  );
  if (!res.ok) throw new Error(await res.text());

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by double newlines.
      const parts = buffer.split("\n\n");
      buffer = parts.pop()!;

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
    if (error instanceof TypeError) throw new Error(AUTOCODE_NETWORK_ERROR);
    throw error;
  }
  throw new Error("SSE stream ended without a 'done' event");
}
