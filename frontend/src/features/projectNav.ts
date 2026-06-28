import type { NavigateFunction } from "react-router-dom";
import { invalidateAll } from "../api/projectDataCache";

/**
 * Single source of truth for the cross-page "open these projects in <tool>"
 * navigation handshakes (sessionStorage keys, cache invalidation, route shape).
 * Mirrors the loaders in pages/Projects/projects.tsx so the v2 sidebar's Quick
 * Select and the Projects page can never drift. See CLAUDE.md (cross-page contracts).
 */

export function openCoding(navigate: NavigateFunction, names: string[]) {
  if (names.length === 0) return;
  const encoded = names.map((name) => encodeURIComponent(name));
  // Clear any stale Path Analysis filter context so direct loads show normal
  // risk-band colors instead of leftover filter colors.
  navigate(`/coding/${encoded.join(",")}`, { state: { filterContext: null } });
}

export function openTreatment(navigate: NavigateFunction, names: string[]) {
  if (names.length === 0) return;
  const encoded = names.map((name) => encodeURIComponent(name));
  navigate(`/treatment/${encoded.join(",")}`);
}

export function openPathAnalysis(navigate: NavigateFunction, names: string[]) {
  if (names.length === 0) return;
  sessionStorage.setItem("pathAnalysis_selectedProjects", JSON.stringify(names));
  sessionStorage.setItem("pathAnalysis_loadedProjects", JSON.stringify(names));
  // Deliberate "start over" reset point: always fetch fresh data and re-fit the
  // map to the new set rather than restoring the old viewport.
  invalidateAll();
  sessionStorage.removeItem("pathAnalysisMap_viewport");
  navigate("/analysis/path");
}
