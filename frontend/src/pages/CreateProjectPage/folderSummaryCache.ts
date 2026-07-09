import type { SourceFolderSummary } from "../../api";

/**
 * Persistent (localStorage) cache for the Create Project folder-table summary
 * stats (segment count / survey quarter / distance). Source folders are static
 * inputs, so once a folder's stats have been computed there is no need to
 * re-fetch them on every visit to the Create page — the previously-resolved
 * rows render instantly instead of flashing spinners while they re-resolve.
 *
 * The cache lives in localStorage (survives full page reloads, unlike the
 * in-memory session caches) and only ever stores fully-resolved (`cached: true`)
 * summaries. A background refresh still runs on the Create page to pick up new
 * folders; already-cached folders are skipped so they don't re-fetch.
 */

// v2: bumped from v1 to flush client caches that may hold segment counts recorded
// before the pruning-recompute fix (a folder pruned after project creation could
// have persisted an under-counted value). Bumping forces a one-time re-pull of the
// now-authoritative backend summaries.
const KEY = "psat:create:folderSummaries:v2";
const LEGACY_KEYS = ["psat:create:folderSummaries:v1"];

type Store = Record<string, SourceFolderSummary>;

export function loadFolderSummaryCache(): Store {
  try {
    // Drop superseded cache versions so stale (possibly under-counted) rows can't linger.
    for (const legacy of LEGACY_KEYS) localStorage.removeItem(legacy);
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Store;
  } catch {
    /* corrupt / unavailable — degrade to empty */
  }
  return {};
}

/** Merge newly-resolved summaries into the persisted store (only `cached` ones). */
export function saveFolderSummaries(summaries: Record<string, SourceFolderSummary>): void {
  try {
    const existing = loadFolderSummaryCache();
    let changed = false;
    for (const [name, summary] of Object.entries(summaries)) {
      if (summary && summary.cached) {
        existing[name] = summary;
        changed = true;
      }
    }
    if (changed) localStorage.setItem(KEY, JSON.stringify(existing));
  } catch {
    /* quota / unavailable — cache is best-effort */
  }
}

export function clearFolderSummaryCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
