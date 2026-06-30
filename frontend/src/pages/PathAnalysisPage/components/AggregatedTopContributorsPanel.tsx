import { useState, useEffect, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import { aggregateTopContributors } from "../../../utils/aggregateTopContributors";
import { getCachedResults, invalidateAllOfNamespace } from "../../../api/projectDataCache";
import { FONT, COLOR } from "../../../features/ui/designTokens";
import "../../../components/visualization/scoreband/ScoreBandDistributionPanel.css";
import "./AggregatedScoreBandPanel.css";

type ResultRow = Record<string, unknown>;

interface AggregatedTopContributorsPanelProps {
  selectedProjects: string[];
  // Per-project visible (filtered) segment indices reported by the map view. When
  // provided, contributors are aggregated only over the surviving segments. `null`
  // (before the map first reports) falls back to aggregating all segments.
  visibleSegmentsByProject?: Record<string, number[]> | null;
  /** "v2" renders the comp's accordion-body chip groups (no internal header). */
  variant?: "v1" | "v2";
}

export function AggregatedTopContributorsPanel({
  selectedProjects,
  visibleSegmentsByProject,
  variant = "v1",
}: AggregatedTopContributorsPanelProps) {
  // Raw /results rows per project, fetched once per project set. Aggregation (and
  // filter-driven narrowing) happens reactively in the memos below — so toggling a
  // filter re-aggregates instantly without re-fetching or flashing the spinner.
  const [rawResultsByProject, setRawResultsByProject] = useState<Record<string, ResultRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"combined" | "byProject">("combined");

  const fetchResults = useCallback(async (force = false) => {
    if (selectedProjects.length === 0) {
      setRawResultsByProject({});
      setErrors([]);
      setLoading(false);
      return;
    }

    // A manual refresh bypasses the cache by evicting the results namespace first.
    if (force) invalidateAllOfNamespace("results");

    try {
      setLoading(true);
      setErrors([]);

      const allResults = await Promise.all(
        selectedProjects.map(async (name) => {
          try {
            const data = await getCachedResults(name);
            if (!data.ok || !Array.isArray(data.result_rows)) {
              throw new Error("Invalid response format");
            }
            return { project: name, data: data.result_rows as ResultRow[], error: null as string | null };
          } catch (e: any) {
            return {
              project: name,
              data: null as ResultRow[] | null,
              error: e?.message ?? "Unknown error",
            };
          }
        })
      );

      const byProject: Record<string, ResultRow[]> = {};
      const errorMessages: string[] = [];
      let successCount = 0;

      allResults.forEach(({ project, data, error }) => {
        if (error) {
          errorMessages.push(`${project}: ${error}`);
        } else if (data && Array.isArray(data)) {
          byProject[project] = data;
          successCount++;
        }
      });

      setRawResultsByProject(byProject);

      if (successCount === 0) {
        setErrors([
          "No score data available. Make sure scores are calculated for at least one project.",
        ]);
      } else if (errorMessages.length > 0) {
        setErrors(errorMessages);
      }
    } catch (e: any) {
      setErrors([e?.message ?? "Failed to load contributors"]);
      setRawResultsByProject({});
    } finally {
      setLoading(false);
    }
  }, [selectedProjects]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  useEffect(() => {
    const handleScoresUpdated = () => fetchResults();
    window.addEventListener("psat:scores:updated", handleScoresUpdated);
    return () =>
      window.removeEventListener("psat:scores:updated", handleScoresUpdated);
  }, [fetchResults]);

  // Narrow a project's rows to its visible (filtered) segments. When the map hasn't
  // reported yet (`null`), aggregate all rows; once it has, a missing key means the
  // project has zero surviving segments.
  const filterRows = useCallback(
    (name: string, rows: ResultRow[]): ResultRow[] => {
      if (!visibleSegmentsByProject) return rows;
      const indices = visibleSegmentsByProject[name];
      if (!indices) return [];
      return indices.map((i) => rows[i]).filter(Boolean) as ResultRow[];
    },
    [visibleSegmentsByProject],
  );

  const perProjectContributors = useMemo(
    () =>
      selectedProjects
        .filter((name) => rawResultsByProject[name])
        .map((name) => ({
          projectName: name,
          contributors: aggregateTopContributors(filterRows(name, rawResultsByProject[name])),
        })),
    [selectedProjects, rawResultsByProject, filterRows],
  );

  const combinedContributors = useMemo(() => {
    const allRows: ResultRow[] = [];
    selectedProjects.forEach((name) => {
      const rows = rawResultsByProject[name];
      if (rows) allRows.push(...filterRows(name, rows));
    });
    return aggregateTopContributors(allRows);
  }, [selectedProjects, rawResultsByProject, filterRows]);

  const totalContribCount = combinedContributors.length;

  // ── v2: the comp's "Top Risk Contributors" accordion body — per-project ──
  // groups of scope-coloured chips (By Project = grey #718096, §10). No internal
  // collapsible header; the layout's accordion owns open/close.
  if (variant === "v2") {
    const chipStyle: CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      background: COLOR.gray500,
      color: COLOR.white,
      borderRadius: 4,
      padding: "4px 9px",
      fontFamily: FONT,
      fontSize: 16,
      fontWeight: 400,
      whiteSpace: "nowrap",
    };
    if (loading) {
      return <div style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500, padding: "8px 2px" }}>Loading contributors…</div>;
    }
    if (perProjectContributors.length === 0) {
      return <div style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500, padding: "8px 2px" }}>No contributor data available.</div>;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingRight: 2 }}>
        {perProjectContributors.map((p) => (
          <div key={p.projectName}>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, marginBottom: 7, color: COLOR.gray600 }}>
              {p.projectName}
            </div>
            {p.contributors.length === 0 ? (
              <div style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500 }}>No contributors.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {p.contributors.map((attr, idx) => (
                  <div key={idx} style={chipStyle}>
                    {attr.name}
                    <strong style={{ marginLeft: 3 }}>+{attr.contribution.toFixed(1)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="score-band-panel">
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
            Top Risk Contributors {isExpanded ? "▼" : "▶"}
          </h3>
          {!isExpanded && totalContribCount > 0 && (
            <span
              style={{
                fontSize: "14px",
                color: "#666",
                fontWeight: "normal",
              }}
            >
              Top {totalContribCount} across {selectedProjects.length} project
              {selectedProjects.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="score-band-content">
          {loading && (
            <div className="score-band-loading">
              <div className="spinner"></div>
              <p>Loading contributors...</p>
            </div>
          )}

          {!loading && errors.length > 0 && totalContribCount === 0 && (
            <div className="score-band-error">
              <p>⚠️ {errors[0]}</p>
              <button
                onClick={() => fetchResults(true)}
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

          {!loading && perProjectContributors.length > 0 && (
            <Box>
              <Flex
                align="center"
                justify="flex-end"
                mb="3"
                gap="3"
                wrap="wrap"
              >
                <Flex
                  borderWidth="1px"
                  borderColor="gray.300"
                  _dark={{ borderColor: "gray.600" }}
                  borderRadius="md"
                  overflow="hidden"
                  role="group"
                  aria-label="Top contributors view mode"
                >
                  {(["combined", "byProject"] as const).map((mode) => {
                    const active = viewMode === mode;
                    const label = mode === "combined" ? "All Projects" : "By Project";
                    return (
                      <Box
                        key={mode}
                        as="button"
                        onClick={() => setViewMode(mode)}
                        px="3"
                        py="1"
                        fontSize="xs"
                        fontWeight="semibold"
                        cursor="pointer"
                        bg={active ? "blue.500" : "transparent"}
                        color={active ? "white" : "gray.700"}
                        _dark={{ color: active ? "white" : "gray.200" }}
                        aria-pressed={active}
                      >
                        {label}
                      </Box>
                    );
                  })}
                </Flex>
              </Flex>

              {viewMode === "combined" ? (
                <Box
                  borderWidth="1px"
                  borderColor="gray.200"
                  _dark={{ borderColor: "gray.700" }}
                  borderRadius="md"
                  p="3"
                >
                  <Text
                    fontSize="sm"
                    fontWeight="semibold"
                    color="gray.700"
                    _dark={{ color: "gray.300" }}
                    mb="2"
                  >
                    Top Risk Contributors (All Projects)
                  </Text>
                  {combinedContributors.length === 0 ? (
                    <Text fontSize="xs" color="gray.500">
                      No contributor data available.
                    </Text>
                  ) : (
                    <Flex wrap="wrap" gap="2">
                      {combinedContributors.map((attr, idx) => (
                        <Flex
                          key={idx}
                          align="center"
                          bg="gray.50"
                          px="2.5"
                          py="1"
                          borderRadius="md"
                          borderWidth="1px"
                          borderColor="gray.200"
                          _dark={{ bg: "gray.700", borderColor: "gray.600" }}
                        >
                          <Text
                            fontSize="xs"
                            fontWeight="medium"
                            color="gray.800"
                            _dark={{ color: "gray.50" }}
                          >
                            {attr.name}
                          </Text>
                          <Text
                            fontSize="xs"
                            fontWeight="bold"
                            ml="1.5"
                            color="red.600"
                            _dark={{ color: "red.300" }}
                          >
                            +{attr.contribution.toFixed(1)}
                          </Text>
                        </Flex>
                      ))}
                    </Flex>
                  )}
                </Box>
              ) : (
                <Flex direction="column" gap="4">
                  {perProjectContributors.map((p) => (
                    <Box
                      key={p.projectName}
                      borderWidth="1px"
                      borderColor="gray.200"
                      _dark={{ borderColor: "gray.700" }}
                      borderRadius="md"
                      p="3"
                    >
                      <Text
                        fontSize="sm"
                        fontWeight="semibold"
                        color="gray.700"
                        _dark={{ color: "gray.300" }}
                        mb="2"
                      >
                        Top Risk Contributors ({p.projectName})
                      </Text>
                      {p.contributors.length === 0 ? (
                        <Text fontSize="xs" color="gray.500">
                          No contributor data available.
                        </Text>
                      ) : (
                        <Flex wrap="wrap" gap="2">
                          {p.contributors.map((attr, idx) => (
                            <Flex
                              key={idx}
                              align="center"
                              bg="gray.50"
                              px="2.5"
                              py="1"
                              borderRadius="md"
                              borderWidth="1px"
                              borderColor="gray.200"
                              _dark={{ bg: "gray.700", borderColor: "gray.600" }}
                            >
                              <Text
                                fontSize="xs"
                                fontWeight="medium"
                                color="gray.800"
                                _dark={{ color: "gray.50" }}
                              >
                                {attr.name}
                              </Text>
                              <Text
                                fontSize="xs"
                                fontWeight="bold"
                                ml="1.5"
                                color="red.600"
                                _dark={{ color: "red.300" }}
                              >
                                +{attr.contribution.toFixed(1)}
                              </Text>
                            </Flex>
                          ))}
                        </Flex>
                      )}
                    </Box>
                  ))}
                </Flex>
              )}
            </Box>
          )}
        </div>
      )}
    </div>
  );
}

export default AggregatedTopContributorsPanel;
