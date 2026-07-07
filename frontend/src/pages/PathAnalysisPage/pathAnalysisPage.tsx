import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { fetchProjectList } from "../../api";
import { useUiVersion } from "../../features/ui/useUiVersion";
import { SESSION_KEYS } from "../../constants/sessionKeys";
import { useSessionState } from "../../hooks/useSessionState";
import PathAnalysisLayoutV1 from "./layouts/PathAnalysisLayoutV1";
import PathAnalysisLayoutV2 from "./layouts/PathAnalysisLayoutV2";
import type { PathAnalysisChartData, PathAnalysisViewModel } from "./layouts/PathAnalysisViewModel";

/**
 * Reads the initial set of projects to load. Prefers the `loadedProjects` key
 * (set on each visit) and falls back to `selectedProjects` (set when the user
 * picks projects on the Home page) so a fresh navigation always opens the right
 * set even if the loadedProjects key hasn't been written yet.
 */
function getInitialLoadedProjects(): string[] {
  try {
    const loaded = sessionStorage.getItem(SESSION_KEYS.PA_LOADED_PROJECTS);
    if (loaded) {
      const arr = JSON.parse(loaded) as string[];
      if (arr.length > 0) return arr;
    }
    const selected = sessionStorage.getItem(SESSION_KEYS.PA_SELECTED_PROJECTS);
    return selected ? (JSON.parse(selected) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Path Analysis container. Owns all server state, sessionStorage keys and the
 * `projectDataCache` contracts, assembles a single `PathAnalysisViewModel`, and
 * renders the v1 or v2 shell (see temp/UI_V2_REDESIGN_GUIDE.md §3). No layout/
 * presentation logic lives here.
 */
export default function PathAnalysisPage() {
  const ui = useUiVersion();
  const location = useLocation();

  // `loadedProjects` uses a custom init (fallback from selectedProjects) so it
  // stays as plain useState; the write-back is handled by an explicit useEffect.
  const [loadedProjects, setLoadedProjects] = useState<string[]>(
    getInitialLoadedProjects
  );

  // `activeFilters` and `hiddenProjects` follow the simple read-init/write-on-update
  // pattern that useSessionState handles — no extra useEffect needed.
  const [activeFilters, setActiveFilters] = useSessionState<string[]>(
    SESSION_KEYS.PA_ACTIVE_FILTERS, []
  );
  const [hiddenProjects, setHiddenProjects] = useSessionState<string[]>(
    SESSION_KEYS.PA_HIDDEN_PROJECTS, []
  );

  // Per-project visible (filtered) segment indices, reported by the map view so the
  // Top Risk Contributors panel can react to the active filters. `null` until the map
  // first reports (panel then falls back to aggregating all segments).
  const [visibleSegmentsByProject, setVisibleSegmentsByProject] = useState<
    Record<string, number[]> | null
  >(null);

  const visibleProjects = useMemo(
    () => loadedProjects.filter((projectName) => !hiddenProjects.includes(projectName)),
    [loadedProjects, hiddenProjects]
  );

  const [chartData, setChartData] = useState<PathAnalysisChartData>({
    categoryDistributionData: [],
    primaryFocusAttribute: null,
    categoryStatus: [],
    totalSegmentsLoaded: 0,
    totalSegmentsViewed: 0,
  });

  // Fallback: when no projects have been loaded yet (e.g. the user navigates
  // directly to /analysis/path), fetch the full list from the backend.
  useEffect(() => {
    if (loadedProjects.length > 0) return;
    fetchProjectList()
      .then((data) => {
        if (data?.projects) {
          const availableProjects = data.projects.map((project) => project.name);
          setLoadedProjects((prev) => {
            const restoredProjects = (prev.length > 0 ? prev : getInitialLoadedProjects())
              .filter((name) => availableProjects.includes(name));

            return restoredProjects.length > 0 ? restoredProjects : availableProjects;
          });
        }
      })
      .catch(() => {});
  }, [loadedProjects.length]);

  // Persist loadedProjects whenever it changes so back-navigation restores it.
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEYS.PA_LOADED_PROJECTS, JSON.stringify(loadedProjects));
  }, [loadedProjects]);

  // Persist categoryStatus for the Report Builder (only when non-empty so a
  // stale value doesn't persist from a previous session).
  useEffect(() => {
    if (chartData.categoryStatus.length > 0) {
      sessionStorage.setItem(SESSION_KEYS.PA_CATEGORY_STATUS, JSON.stringify(chartData.categoryStatus));
    }
  }, [chartData.categoryStatus]);

  // Drop any hidden project that is no longer loaded.
  useEffect(() => {
    setHiddenProjects((prev) => prev.filter((projectName) => loadedProjects.includes(projectName)));
  }, [loadedProjects, setHiddenProjects]);

  // Keep `?ui=<version>` pinned on the URL so the toggle is always visible in the
  // address bar (mirrors the Projects / Create Project pilots). Path Analysis does
  // not rely on `location.state`, so the replaceState is safe here.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("ui") !== ui) {
      params.set("ui", ui);
      window.history.replaceState(
        window.history.state,
        "",
        `${location.pathname}?${params.toString()}`
      );
    }
  }, [ui, location.pathname, location.search]);

  const vm: PathAnalysisViewModel = {
    loadedProjects,
    visibleProjects,
    activeFilters,
    hiddenProjects,
    visibleSegmentsByProject,
    chartData,
    onActiveFiltersChange: setActiveFilters,
    onHiddenProjectsChange: setHiddenProjects,
    onVisibleSegmentsChange: setVisibleSegmentsByProject,
    onChartDataUpdate: setChartData,
  };

  return ui === "v2" ? <PathAnalysisLayoutV2 {...vm} /> : <PathAnalysisLayoutV1 {...vm} />;
}
