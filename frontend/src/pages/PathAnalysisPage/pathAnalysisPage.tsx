import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { fetchProjectList } from "../../api";
import { useUiVersion } from "../../features/ui/useUiVersion";
import PathAnalysisLayoutV1 from "./layouts/PathAnalysisLayoutV1";
import PathAnalysisLayoutV2 from "./layouts/PathAnalysisLayoutV2";
import type { PathAnalysisChartData, PathAnalysisViewModel } from "./layouts/PathAnalysisViewModel";

const SESSION_KEY_PREFIX = "pathAnalysis_";


const loadState = <T,>(key: string, defaultVal: T): T => {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY_PREFIX + key);
    return stored ? JSON.parse(stored) : defaultVal;
  } catch {
    return defaultVal;
  }
};

const getStoredLoadedProjects = (): string[] => {
  const loaded = loadState<string[]>("loadedProjects", []);
  if (loaded.length > 0) return loaded;
  return loadState<string[]>("selectedProjects", []);
};

/**
 * Path Analysis container. Owns all server state, sessionStorage keys and the
 * `projectDataCache` contracts, assembles a single `PathAnalysisViewModel`, and
 * renders the v1 or v2 shell (see temp/UI_V2_REDESIGN_GUIDE.md §3). No layout/
 * presentation logic lives here.
 */
export default function PathAnalysisPage() {
  const ui = useUiVersion();
  const location = useLocation();

  const [loadedProjects, setLoadedProjects] = useState<string[]>(() =>
    getStoredLoadedProjects()
  );

  const [activeFilters, setActiveFilters] = useState<string[]>(() =>
    loadState("activeFilters", [])
  );

  const [hiddenProjects, setHiddenProjects] = useState<string[]>(() =>
    loadState("hiddenProjects", [])
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

  useEffect(() => {
    if (loadedProjects.length > 0) return;
    fetchProjectList()
      .then((data) => {
        if (data?.projects) {
          const availableProjects = data.projects.map((project) => project.name);
          setLoadedProjects((prev) => {
            const restoredProjects = (prev.length > 0 ? prev : getStoredLoadedProjects())
              .filter((name) => availableProjects.includes(name));

            return restoredProjects.length > 0 ? restoredProjects : availableProjects;
          });
        }
      })
      .catch(() => {});
  }, [loadedProjects.length]);

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY_PREFIX + "loadedProjects", JSON.stringify(loadedProjects));
    sessionStorage.setItem(SESSION_KEY_PREFIX + "activeFilters", JSON.stringify(activeFilters));
    sessionStorage.setItem(SESSION_KEY_PREFIX + "hiddenProjects", JSON.stringify(hiddenProjects));
  }, [activeFilters, loadedProjects, hiddenProjects]);

  useEffect(() => {
    if (chartData.categoryStatus.length > 0) {
      sessionStorage.setItem(SESSION_KEY_PREFIX + "categoryStatus", JSON.stringify(chartData.categoryStatus));
    }
  }, [chartData.categoryStatus]);

  useEffect(() => {
    setHiddenProjects((prev) => prev.filter((projectName) => loadedProjects.includes(projectName)));
  }, [loadedProjects]);

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
