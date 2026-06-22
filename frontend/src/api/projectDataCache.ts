import type { FeatureCollection } from "geojson";
import {
  fetchProjectGeoJSON,
  fetchProjectAttributes,
  fetchProjectResults,
  type AttributesResponse,
  type CalculateScoreResult,
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
