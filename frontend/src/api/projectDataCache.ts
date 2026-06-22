import type { FeatureCollection } from "geojson";
import {
  fetchProjectGeoJSON,
  fetchProjectAttributes,
  fetchProjectResults,
  fetchAttributeMappings,
  type AttributesResponse,
  type CalculateScoreResult,
  type AttrMappings,
} from "./index";

/**
 * Module-level in-memory cache for the per-project read endpoints used by the
 * Path Analysis page (geodata, attributes, results).
 *
 * Why: the Path Analysis route is unmounted when the user clicks into a segment
 * (navigating to the Coding page) and remounted on return, re-running every
 * data fetch from scratch. Three sibling components also each fetch `/results`
 * independently. This cache makes back-navigation a pure cache hit and collapses
 * the duplicate `/results` fetches into one request per project.
 *
 * The cache stores the *promise* (not just the resolved value) so concurrent
 * callers de-duplicate an in-flight request. A rejected promise is evicted so a
 * later mount can retry.
 *
 * Invalidation is automatic on the events that change data:
 *  - segment edits (delete/add)  -> invalidateProject(name)
 *  - score recompute             -> psat:scores:updated -> evicts the results namespace
 *  - Projects-page reselect      -> invalidateAll() (deliberate "start over")
 *  - hard browser reload (F5)    -> clears everything for free (module reloads)
 */

type Namespace = "geodata" | "attributes" | "results";

const cache = new Map<string, Promise<unknown>>();

const keyFor = (ns: Namespace, project: string) => `${ns}:${project}`;

function getOrFetch<T>(ns: Namespace, project: string, loader: () => Promise<T>): Promise<T> {
  const key = keyFor(ns, project);
  const existing = cache.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = loader().catch((err) => {
    // Evict on failure so a later call can retry instead of replaying the error.
    if (cache.get(key) === promise) cache.delete(key);
    throw err;
  });
  cache.set(key, promise);
  return promise;
}

export function getCachedGeoJSON(project: string): Promise<FeatureCollection> {
  return getOrFetch("geodata", project, () => fetchProjectGeoJSON(project));
}

export function getCachedAttributes(project: string): Promise<AttributesResponse> {
  return getOrFetch("attributes", project, () => fetchProjectAttributes(project));
}

export function getCachedResults(project: string): Promise<CalculateScoreResult> {
  return getOrFetch("results", project, () => fetchProjectResults(project));
}

/** Drop a single namespace for a single project (e.g. before a forced refresh). */
export function invalidateNamespace(ns: Namespace, project: string): void {
  cache.delete(keyFor(ns, project));
}

/** Drop every cached namespace for one project (e.g. after editing its segments). */
export function invalidateProject(project: string): void {
  cache.delete(keyFor("geodata", project));
  cache.delete(keyFor("attributes", project));
  cache.delete(keyFor("results", project));
}

/** Drop one namespace across all projects (e.g. results after a score recompute). */
export function invalidateAllOfNamespace(ns: Namespace): void {
  const prefix = `${ns}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Clear the entire cache — the explicit "start over" reset point. */
export function invalidateAll(): void {
  cache.clear();
}

// A score recompute anywhere in the app fires this event; the persisted results
// then differ from what we cached, so evict the results namespace globally.
if (typeof window !== "undefined") {
  window.addEventListener("psat:scores:updated", () => invalidateAllOfNamespace("results"));
}

// ── Attribute mappings (global, not per-project) ──────────────────────────────
// Path Analysis needs these to turn numeric attribute codes into the text labels
// its category filters match against. Fetched async on every mount, they start
// empty and let every segment pass the filter until they resolve — the "all
// segments then filtered" flash on back-navigation. Caching the resolved value
// in a module variable lets the page initialise its state synchronously on
// remount, so filtering is correct from the first render.

let resolvedMappings: AttrMappings | null = null;
let mappingsPromise: Promise<AttrMappings> | null = null;

// Backend may omit the adequacy-coded attributes; mirror the augmentation the
// Path Analysis page previously did inline so the cached value is complete.
function augmentMappings(m: AttrMappings): AttrMappings {
  const adequacyMap: Record<string, string> = { "1": "Adequate", "2": "Inadequate" };
  if (!m["Line of Sight"]) m["Line of Sight"] = adequacyMap;
  if (!m["Facility access"]) m["Facility access"] = adequacyMap;
  return m;
}

/** Last resolved (augmented) attribute mappings, or null if never fetched. */
export function getCachedAttributeMappingsSync(): AttrMappings | null {
  return resolvedMappings;
}

/** Promise-deduped fetch of the augmented attribute mappings. */
export function getCachedAttributeMappings(): Promise<AttrMappings> {
  if (mappingsPromise) return mappingsPromise;
  mappingsPromise = fetchAttributeMappings()
    .then((m) => {
      resolvedMappings = augmentMappings(m);
      return resolvedMappings;
    })
    .catch((err) => {
      mappingsPromise = null; // allow a later mount to retry
      throw err;
    });
  return mappingsPromise;
}
