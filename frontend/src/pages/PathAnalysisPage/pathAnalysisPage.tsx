import { useState, useEffect, useMemo } from "react";
import {
  Box,
  Text,
} from "@chakra-ui/react";
import { fetchProjectList } from "../../api";
import FilterPanel from "./components/FilterPanel";
import PathAnalysisMapView from "./components/PathAnalysisMapView";
import AttributeDistributionChart from "./components/AttributeDistributionChart";
import AggregatedScoreBandPanel from "./components/AggregatedScoreBandPanel";
import AggregatedTopContributorsPanel from "./components/AggregatedTopContributorsPanel";
import "./pathAnalysisPage.css";

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

export default function PathAnalysisPage() {
  const [loadedProjects, setLoadedProjects] = useState<string[]>(() =>
    getStoredLoadedProjects()
  );

  const [activeFilters, setActiveFilters] = useState<string[]>(() =>
    loadState("activeFilters", [])
  );

  const [hiddenProjects, setHiddenProjects] = useState<string[]>(() =>
    loadState("hiddenProjects", [])
  );

  const visibleProjects = useMemo(
    () => loadedProjects.filter((projectName) => !hiddenProjects.includes(projectName)),
    [loadedProjects, hiddenProjects]
  );

  const [chartData, setChartData] = useState<{
    categoryDistributionData: { category: string; count: number; color: string }[];
    primaryFocusAttribute: string | null;
    categoryStatus: {
      attribute: string;
      categories: {
        category: string;
        isActive: boolean;
        color: string;
        subcategories?: { name: string; isActive: boolean; color: string }[];
      }[];
      rangeFilter?: { min: number; max: number; currentMin: number; currentMax: number };
    }[];
    totalSegmentsLoaded: number;
    totalSegmentsViewed: number;
  }>({
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

  return (
    <Box w="100%" h="100vh" overflowY="auto" p="6" className="path-analysis-container">
      <Box mb="6">
        <Text fontSize="2xl" fontWeight="bold" mb="2">
          Path Analysis
        </Text>
        <Text fontSize="sm" color="fg.muted">
          Analyze projects based on its attributes.
        </Text>
      </Box>

      {loadedProjects.length > 0 && (
        <Box mb="6">
          <AggregatedScoreBandPanel selectedProjects={loadedProjects} />
        </Box>
      )}

      {visibleProjects.length > 0 && (
        <Box mb="6">
          <AggregatedTopContributorsPanel selectedProjects={visibleProjects} />
        </Box>
      )}

      <Box mb="6">
        <FilterPanel
          activeFilters={activeFilters}
          onActiveFiltersChange={setActiveFilters}
        />
      </Box>

      <Box mb="6">
        <PathAnalysisMapView
          selectedProjects={visibleProjects}
          selectedAttributes={activeFilters}
          onChartDataUpdate={setChartData}
          loadedProjects={loadedProjects}
          hiddenProjects={hiddenProjects}
          onHiddenProjectsChange={setHiddenProjects}
        />
      </Box>

      {chartData.primaryFocusAttribute && chartData.categoryDistributionData.length > 0 && (
        <Box
          borderWidth="1px"
          borderRadius="lg"
          p="6"
          bg="white"
          _dark={{ bg: "gray.800" }}
        >
          <AttributeDistributionChart
            categoryData={chartData.categoryDistributionData}
            selectedAttribute={chartData.primaryFocusAttribute}
            categoryStatus={chartData.categoryStatus}
            totalSegmentsLoaded={chartData.totalSegmentsLoaded}
            totalSegmentsViewed={chartData.totalSegmentsViewed}
          />
        </Box>
      )}
    </Box>
  );
}
