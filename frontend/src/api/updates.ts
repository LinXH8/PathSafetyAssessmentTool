/**
 * Remote update endpoints (backend/app/api/updates.py).
 *
 * Users have no Git and never visit a release page; the app tells them when an
 * update is ready. Nothing is applied while the app runs — downloads are staged
 * and installed by the launcher on the next start.
 */

import { fetchWithTimeout, readError } from "./_client";

export interface UpdateStatus {
  currentVersion: string;
  availableVersion: string | null;
  updateAvailable: boolean;
  /** An update is downloaded and waiting for a restart. */
  pending: boolean;
  notes: string;
  components: string[];
  downloadBytes: number;
  /** Set when the update server was unreachable — offline is normal, not fatal. */
  error: string | null;
}

export interface UpdateProgress {
  running: boolean;
  component: string | null;
  /** Bytes downloaded so far across ALL components. */
  done: number;
  /** Total bytes to download (sum of all changed components' sizes). */
  total: number;
  pending: boolean;
}

/**
 * Check for an update. Never throws for the offline case — the backend reports
 * unreachability in `error` so the caller can simply stay quiet.
 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  const res = await fetchWithTimeout("/api/updates/check", {}, 20000);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function getUpdateProgress(): Promise<UpdateProgress> {
  const res = await fetchWithTimeout("/api/updates/status", {}, 10000);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/**
 * Start downloading in the background. Returns as soon as the download starts —
 * poll `getUpdateProgress` for progress. No timeout wrapper: a shapefile refresh
 * is gigabytes and must not be aborted mid-flight.
 */
export async function startUpdateDownload(): Promise<void> {
  const res = await fetch("/api/updates/download", { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
}

export async function discardUpdate(): Promise<void> {
  const res = await fetchWithTimeout("/api/updates/discard", { method: "POST" }, 10000);
  if (!res.ok) throw new Error(await readError(res));
}

/** Human-readable byte size for the download prompt. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / 1_000_000;
  if (mb < 1) return "<1 MB";
  if (mb < 1000) return `${Math.round(mb)} MB`;
  return `${(mb / 1000).toFixed(1)} GB`;
}
