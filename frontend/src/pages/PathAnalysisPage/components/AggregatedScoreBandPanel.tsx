import { useState, useEffect, useCallback } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import { getCachedResults, invalidateAllOfNamespace } from "../../../api/projectDataCache";
import ScoreBandPieChart from "../../../components/visualization/scoreband/ScoreBandPieChart";
import { RISK_BAND_COLORS } from "../../../components/visualization/scoreband/colorConstants";
import "../../../components/visualization/scoreband/ScoreBandDistributionPanel.css";
import "./AggregatedScoreBandPanel.css";

interface AggregatedScoreBandPanelProps {
  selectedProjects: string[];
}

type BandDistribution = Record<number, number>;

interface CrashTypeDistributions {
  VB: BandDistribution;
  BB: BandDistribution;
  SB: BandDistribution;
  BP: BandDistribution;
  Overall: BandDistribution;
}

interface ScoreResultRow {
  "BB": number;
  "BB Band": number;
  "BP": number;
  "BP Band": number;
  "SB": number;
  "SB Band": number;
  "VB": number;
  "VB Band": number;
  "Overall Risk Level"?: number;
  "Overall Risk Level Band"?: number;
  "CycleRAP score"?: number; // Backward compatibility for existing projects
  "CycleRAP score Band"?: number; // Backward compatibility for existing projects
}

const CRASH_TYPE_LABELS: Record<string, string> = {
  VB: "Vehicle-Bicycle (VB)",
  BB: "Bicycle-Bicycle (BB)",
  SB: "Single-Bicycle (SB)",
  BP: "Bicycle-Pedestrian (BP)",
  Overall: "Overall Risk Level",
};

export function AggregatedScoreBandPanel({
  selectedProjects,
}: AggregatedScoreBandPanelProps) {
  const [distributions, setDistributions] = useState<CrashTypeDistributions | null>(null);
  const [totalSegments, setTotalSegments] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  // Process band distributions from API responses
  const processBandDistributions = useCallback(
    (allResultRows: ScoreResultRow[]): CrashTypeDistributions => {
      // Initialize all 4 bands to 0
      const distributions: CrashTypeDistributions = {
        VB: { 1: 0, 2: 0, 3: 0, 4: 0 },
        BB: { 1: 0, 2: 0, 3: 0, 4: 0 },
        SB: { 1: 0, 2: 0, 3: 0, 4: 0 },
        BP: { 1: 0, 2: 0, 3: 0, 4: 0 },
        Overall: { 1: 0, 2: 0, 3: 0, 4: 0 },
      };

      // Count occurrences of each band across all projects
      allResultRows.forEach((row) => {
        const vbBand = row["VB Band"];
        const bbBand = row["BB Band"];
        const sbBand = row["SB Band"];
        const bpBand = row["BP Band"];

        // Count valid bands (1-4), skip 0 and other invalid values
        if (vbBand >= 1 && vbBand <= 4) distributions.VB[vbBand]++;
        if (bbBand >= 1 && bbBand <= 4) distributions.BB[bbBand]++;
        if (sbBand >= 1 && sbBand <= 4) distributions.SB[sbBand]++;
        if (bpBand >= 1 && bpBand <= 4) distributions.BP[bpBand]++;

        // Overall band = max of the four individual bands (matches backend logic)
        const overallBand = row["Overall Risk Level Band"] ??
          Math.max(vbBand || 0, bbBand || 0, sbBand || 0, bpBand || 0);
        if (overallBand >= 1 && overallBand <= 4) distributions.Overall[overallBand]++;
      });

      return distributions;
    },
    []
  );

  // Fetch results from all projects and aggregate
  const fetchAndAggregateResults = useCallback(async (force = false) => {
    if (selectedProjects.length === 0) {
      setDistributions(null);
      setTotalSegments(0);
      setLoading(false);
      return;
    }

    // A manual refresh bypasses the cache by evicting the results namespace first.
    if (force) invalidateAllOfNamespace("results");

    try {
      setLoading(true);
      setErrors([]);

      // Fetch all projects in parallel (served from the shared session cache)
      const allResults = await Promise.all(
        selectedProjects.map(async (name) => {
          try {
            const data = await getCachedResults(name);
            if (!data.ok || !Array.isArray(data.result_rows)) {
              throw new Error("Invalid response format");
            }
            return { project: name, data: data.result_rows as ScoreResultRow[], error: null };
          } catch (e: any) {
            return {
              project: name,
              data: null,
              error: e?.message ?? "Unknown error",
            };
          }
        })
      );

      // Aggregate results from all projects
      const allRows: ScoreResultRow[] = [];
      const errorMessages: string[] = [];
      let successCount = 0;

      allResults.forEach(({ project, data, error }) => {
        if (error) {
          errorMessages.push(`${project}: ${error}`);
        } else if (data && Array.isArray(data)) {
          allRows.push(...data);
          successCount++;
        }
      });

      // If no successful projects, show error
      if (successCount === 0) {
        setDistributions(null);
        setTotalSegments(0);
        setErrors([
          "No score data available. Make sure scores are calculated for at least one project.",
        ]);
      } else {
        // Process aggregated data
        const dist = processBandDistributions(allRows);
        setDistributions(dist);
        setTotalSegments(allRows.length);

        // Show warnings for failed projects
        if (errorMessages.length > 0) {
          setErrors(errorMessages);
        }
      }
    } catch (e: any) {
      setErrors([e?.message ?? "Failed to load score distributions"]);
      setDistributions(null);
      setTotalSegments(0);
    } finally {
      setLoading(false);
    }
  }, [selectedProjects, processBandDistributions]);

  // Initial fetch on mount
  useEffect(() => {
    fetchAndAggregateResults();
  }, [fetchAndAggregateResults]);

  // Listen for score updates
  useEffect(() => {
    const handleScoresUpdated = () => {
      fetchAndAggregateResults();
    };

    window.addEventListener("psat:scores:updated", handleScoresUpdated);
    return () =>
      window.removeEventListener("psat:scores:updated", handleScoresUpdated);
  }, [fetchAndAggregateResults]);

  return (
    <div className="score-band-panel">
      {/* Collapsible Header */}
      <div
        className="score-band-header"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "bold" }}>
            Overall Risk Level {isExpanded ? "▼" : "▶"}
          </h3>
          {/* Quick summary when collapsed */}
          {!isExpanded && totalSegments > 0 && (
            <span
              style={{
                fontSize: "14px",
                color: "#666",
                fontWeight: "normal",
              }}
            >
              {totalSegments} segments across {selectedProjects.length} projects
            </span>
          )}
        </div>
      </div>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="score-band-content">
          {/* Loading State */}
          {loading && (
            <div className="score-band-loading">
              <div className="spinner"></div>
              <p>Loading score distributions...</p>
            </div>
          )}

          {/* Error State */}
          {!loading && errors.length > 0 && (
            <div className="score-band-error">
              <p>⚠️ {errors[0]}</p>
              {errors.length > 1 && (
                <div
                  style={{
                    marginTop: "8px",
                    fontSize: "12px",
                    textAlign: "left",
                    display: "inline-block",
                  }}
                >
                  {errors.slice(1).map((err, idx) => (
                    <p key={idx} style={{ margin: "4px 0" }}>
                      • {err}
                    </p>
                  ))}
                </div>
              )}
              <button
                onClick={() => fetchAndAggregateResults(true)}
                style={{
                  marginTop: "12px",
                  padding: "6px 12px",
                  backgroundColor: "#3498db",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: "600",
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty State */}
          {!loading && errors.length === 0 && totalSegments === 0 && (
            <div className="score-band-empty">
              <p>
                No score data available. Make sure scores are calculated for at
                least one project.
              </p>
            </div>
          )}

          {/* Charts Grid */}
          {!loading &&
            errors.length === 0 &&
            distributions &&
            totalSegments > 0 && (
              <div className="score-band-charts-container">
                {/* Overall Risk Level - Full Width at Top */}
                <div className="score-band-overall">
                  <ScoreBandPieChart
                    crashType={CRASH_TYPE_LABELS.Overall}
                    bandCounts={distributions.Overall}
                  >
                    <p style={{
                      fontSize: "12px",
                      color: "var(--chakra-colors-gray-500)",
                      textAlign: "center",
                      marginTop: "4px",
                      maxWidth: "400px"
                    }}>
                      *The overall risk score is the sum of the crash type scores. The risk level assigned is the
                      highest of the individual crash types.
                    </p>
                  </ScoreBandPieChart>
                </div>

                {/* 4 Crash Types in Grid (Single Row) */}
                <div style={{ marginTop: "40px", marginBottom: "20px", textAlign: "center" }}>
                  <h3 style={{ fontSize: "18px", fontWeight: "bold" }}>
                    Risk Level by Crash Type
                  </h3>

                  {/* Risk Level Legend */}
                  <Flex justify="center" gap="8" mt="4" fontSize="sm" textAlign="left">
                    {/* VB Legend */}
                    <Box>
                      <Text fontWeight="bold" mb="1">VB crashes:</Text>
                      <Flex align="center" gap="2"><Box w="12px" h="12px" bg={RISK_BAND_COLORS.LOW} borderRadius="sm" /> Low Risk: &lt;10</Flex>
                      <Flex align="center" gap="2"><Box w="12px" h="12px" bg={RISK_BAND_COLORS.MEDIUM} borderRadius="sm" /> Medium Risk: 10-25</Flex>
                      <Flex align="center" gap="2"><Box w="12px" h="12px" bg={RISK_BAND_COLORS.HIGH} borderRadius="sm" /> High Risk: 25-60</Flex>
                      <Flex align="center" gap="2"><Box w="12px" h="12px" bg={RISK_BAND_COLORS.EXTREME} borderRadius="sm" /> Extreme Risk: &gt;60</Flex>
                    </Box>
                    {/* Others Legend */}
                    <Box>
                      <Text fontWeight="bold" mb="1">BB, BP, SB crashes:</Text>
                      <Flex align="center" gap="2"><Box w="12px" h="12px" bg={RISK_BAND_COLORS.LOW} borderRadius="sm" /> Low Risk: &lt;5</Flex>
                      <Flex align="center" gap="2"><Box w="12px" h="12px" bg={RISK_BAND_COLORS.MEDIUM} borderRadius="sm" /> Medium Risk: 5-10</Flex>
                      <Flex align="center" gap="2"><Box w="12px" h="12px" bg={RISK_BAND_COLORS.HIGH} borderRadius="sm" /> High Risk: 10-20</Flex>
                      <Flex align="center" gap="2"><Box w="12px" h="12px" bg={RISK_BAND_COLORS.EXTREME} borderRadius="sm" /> Extreme Risk: &gt;20</Flex>
                    </Box>
                  </Flex>
                </div>

                <div className="aggregated-score-band-grid">
                  <div className="aggregated-score-band-grid-item">
                    <ScoreBandPieChart crashType={CRASH_TYPE_LABELS.VB} bandCounts={distributions.VB} />
                  </div>
                  <div className="aggregated-score-band-grid-item">
                    <ScoreBandPieChart crashType={CRASH_TYPE_LABELS.BB} bandCounts={distributions.BB} />
                  </div>
                  <div className="aggregated-score-band-grid-item">
                    <ScoreBandPieChart crashType={CRASH_TYPE_LABELS.SB} bandCounts={distributions.SB} />
                  </div>
                  <div className="aggregated-score-band-grid-item">
                    <ScoreBandPieChart crashType={CRASH_TYPE_LABELS.BP} bandCounts={distributions.BP} />
                  </div>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

export default AggregatedScoreBandPanel;
