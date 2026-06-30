import { useCallback, useState } from "react";
import FilterPanel from "../components/FilterPanel";
import PathAnalysisMapView from "../components/PathAnalysisMapView";
import AttributeDistributionChart from "../components/AttributeDistributionChart";
import AggregatedScoreBandPanel from "../components/AggregatedScoreBandPanel";
import AggregatedTopContributorsPanel from "../components/AggregatedTopContributorsPanel";
import { AccordionSection, v2CardStyle } from "../components/paV2Primitives";
import { FONT, COLOR, CONTENT_PADDING, CARD_GAP } from "../../../features/ui/designTokens";
import type { PathAnalysisViewModel } from "./PathAnalysisViewModel";

/**
 * v2 Path Analysis layout — translation of `temp/psat-design/PSAT Path Analysis.html`
 * Frame 3 ("03 — Path Analysis") to Chakra/React + DESIGN_GUIDE.md, made fluid
 * (the comp is a fixed 1920×900 mockup). Pure function of `PathAnalysisViewModel`.
 *
 * Arrangement:
 *   Row 1 — left: an "Analysis" accordion card (Top Risk Contributors / Toggle
 *           Attributes / Current Filters); right: the Map block (PathAnalysisMapView).
 *   Row 2 — left: Distribution of Project; right: Overall Risk Level.
 *
 * The heavy interactive components are reused with a gated `variant="v2"`. The map
 * view keeps owning the project / category-toggle state; its toggle UI is portalled
 * into the "Current Filters" accordion body via `filtersPortalTarget` (no state lift).
 */
export default function PathAnalysisLayoutV2({
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
  // Accordion open state (comp: TRC open, the other two closed).
  const [openTrc, setOpenTrc] = useState(true);
  const [openToggle, setOpenToggle] = useState(false);
  const [openFilters, setOpenFilters] = useState(false);

  // Portal host for the map view's project / category-toggle UI. A callback ref
  // captures the "Current Filters" accordion body when it mounts so the map view
  // re-renders and portals into it; it's null while the accordion is collapsed.
  const [filtersHost, setFiltersHost] = useState<HTMLElement | null>(null);
  const filtersHostRef = useCallback((node: HTMLDivElement | null) => {
    setFiltersHost(node);
  }, []);

  const hasProjects = loadedProjects.length > 0;

  return (
    <div
      style={{
        padding: CONTENT_PADDING,
        boxSizing: "border-box",
        minHeight: "100vh",
        background: COLOR.canvas,
        fontFamily: FONT,
        color: COLOR.text,
        display: "flex",
        flexDirection: "column",
        gap: CARD_GAP,
      }}
    >
      <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, flexShrink: 0 }}>
        Path Analysis
      </span>

      {!hasProjects && (
        <div style={{ ...v2CardStyle({ padding: 20 }), fontSize: 16, color: COLOR.gray500 }}>
          No projects loaded. Select projects from the Projects page to analyse.
        </div>
      )}

      {/* ── Row 1: Analysis accordion (left) + Map block (right) ─────────────
          Fixed height that fits the viewport (so the bottom padding isn't clipped)
          with a true 50-50 split; both cards fill it and scroll internally, so
          opening accordions never grows the card or unbalances the grid. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, height: "clamp(520px, calc(100vh - 152px), 900px)", minHeight: 0 }}>
        {/* Left — Analysis accordion card (50%) */}
        <div
          style={v2CardStyle({
            flex: "1 1 0",
            minWidth: 0,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: 12,
            overflow: "hidden",
          })}
        >
          <AccordionSection title="Top Risk Contributors" open={openTrc} onToggle={() => setOpenTrc((v) => !v)}>
            <AggregatedTopContributorsPanel
              variant="v2"
              selectedProjects={visibleProjects}
              visibleSegmentsByProject={visibleSegmentsByProject}
            />
          </AccordionSection>

          <AccordionSection title="Toggle Attributes" open={openToggle} onToggle={() => setOpenToggle((v) => !v)} bodyStyle={{ display: "flex" }}>
            <FilterPanel
              variant="v2"
              activeFilters={activeFilters}
              onActiveFiltersChange={onActiveFiltersChange}
            />
          </AccordionSection>

          <AccordionSection title="Current Filters" open={openFilters} onToggle={() => setOpenFilters((v) => !v)}>
            {/* Portal host: the map view renders the project / category toggles here. */}
            <div ref={filtersHostRef} />
            {!hasProjects && (
              <div style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500 }}>
                Load projects to adjust filters.
              </div>
            )}
          </AccordionSection>
        </div>

        {/* Right — Map block (50%); the map view's root Box fills this height in v2 */}
        <div style={{ flex: "1 1 0", minWidth: 0, height: "100%" }}>
          <PathAnalysisMapView
            variant="v2"
            filtersPortalTarget={openFilters ? filtersHost : null}
            selectedProjects={visibleProjects}
            selectedAttributes={activeFilters}
            onChartDataUpdate={onChartDataUpdate}
            onVisibleSegmentsChange={onVisibleSegmentsChange}
            loadedProjects={loadedProjects}
            hiddenProjects={hiddenProjects}
            onHiddenProjectsChange={onHiddenProjectsChange}
          />
        </div>
      </div>

      {/* ── Row 2: Distribution of Project (left) + Overall Risk Level (right) ──
          Same grid as Row 1 (1fr 1fr) so all four cards are provably equal halves
          and the two rows align column-for-column. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, minHeight: 0 }}>
        <div
          style={v2CardStyle({
            flex: "1 1 0",
            minWidth: 0,
            minHeight: 420,
            display: "flex",
            flexDirection: "column",
            padding: "18px 20px",
            overflow: "hidden",
          })}
        >
          {chartData.primaryFocusAttribute && chartData.categoryDistributionData.length > 0 ? (
            <AttributeDistributionChart
              variant="v2"
              categoryData={chartData.categoryDistributionData}
              selectedAttribute={chartData.primaryFocusAttribute}
              categoryStatus={chartData.categoryStatus}
              totalSegmentsLoaded={chartData.totalSegmentsLoaded}
              totalSegmentsViewed={chartData.totalSegmentsViewed}
            />
          ) : (
            <>
              <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text, marginBottom: 14, flexShrink: 0 }}>
                Distribution of Project
              </span>
              <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: 12, color: COLOR.gray500, textAlign: "center" }}>
                Select a filter attribute on the map to view its distribution.
              </div>
            </>
          )}
        </div>

        <div
          style={v2CardStyle({
            flex: "1 1 0",
            minWidth: 0,
            minHeight: 420,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          })}
        >
          <AggregatedScoreBandPanel variant="v2" selectedProjects={loadedProjects} />
        </div>
      </div>
    </div>
  );
}
