import { Box, Text } from "@chakra-ui/react";
import FilterPanel from "../components/FilterPanel";
import PathAnalysisMapView from "../components/PathAnalysisMapView";
import AttributeDistributionChart from "../components/AttributeDistributionChart";
import AggregatedScoreBandPanel from "../components/AggregatedScoreBandPanel";
import AggregatedTopContributorsPanel from "../components/AggregatedTopContributorsPanel";
import type { PathAnalysisViewModel } from "./PathAnalysisViewModel";
import "../pathAnalysisPage.css";

/**
 * v1 Path Analysis layout — the current arrangement, extracted verbatim from
 * `pathAnalysisPage.tsx` and now driven by `PathAnalysisViewModel` props.
 * Behaviour/appearance must stay byte-identical under `?ui=v1`.
 */
export default function PathAnalysisLayoutV1({
  loadedProjects,
  visibleProjects,
  activeFilters,
  hiddenProjects,
  visibleSegmentsByProject,
  chartData,
  onActiveFiltersChange,
  onHiddenProjectsChange,
  onVisibleSegmentsChange,
  onChartDataUpdate,
}: PathAnalysisViewModel) {
  return (
    <Box w="100%" p="6" className="path-analysis-container">
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
          <AggregatedTopContributorsPanel
            selectedProjects={visibleProjects}
            visibleSegmentsByProject={visibleSegmentsByProject}
          />
        </Box>
      )}

      <Box mb="6">
        <FilterPanel
          activeFilters={activeFilters}
          onActiveFiltersChange={onActiveFiltersChange}
        />
      </Box>

      <Box mb="6">
        <PathAnalysisMapView
          selectedProjects={visibleProjects}
          selectedAttributes={activeFilters}
          onChartDataUpdate={onChartDataUpdate}
          onVisibleSegmentsChange={onVisibleSegmentsChange}
          loadedProjects={loadedProjects}
          hiddenProjects={hiddenProjects}
          onHiddenProjectsChange={onHiddenProjectsChange}
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
