import { useState, useEffect, useCallback } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import {
  aggregateTopContributors,
  type TopContributor,
} from "../../../utils/aggregateTopContributors";
import { getCachedResults, invalidateAllOfNamespace } from "../../../api/projectDataCache";
import "../../../components/visualization/scoreband/ScoreBandDistributionPanel.css";
import "./AggregatedScoreBandPanel.css";

interface AggregatedTopContributorsPanelProps {
  selectedProjects: string[];
}

export function AggregatedTopContributorsPanel({
  selectedProjects,
}: AggregatedTopContributorsPanelProps) {
  const [combinedContributors, setCombinedContributors] = useState<TopContributor[]>([]);
  const [perProjectContributors, setPerProjectContributors] = useState<
    Array<{ projectName: string; contributors: TopContributor[] }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"combined" | "byProject">("combined");

  const fetchAndAggregate = useCallback(async (force = false) => {
    if (selectedProjects.length === 0) {
      setCombinedContributors([]);
      setPerProjectContributors([]);
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
            return { project: name, data: data.result_rows, error: null as string | null };
          } catch (e: any) {
            return {
              project: name,
              data: null as Array<Record<string, unknown>> | null,
              error: e?.message ?? "Unknown error",
            };
          }
        })
      );

      const allRows: Array<Record<string, unknown>> = [];
      const projectContribs: Array<{ projectName: string; contributors: TopContributor[] }> = [];
      const errorMessages: string[] = [];
      let successCount = 0;

      allResults.forEach(({ project, data, error }) => {
        if (error) {
          errorMessages.push(`${project}: ${error}`);
        } else if (data && Array.isArray(data)) {
          allRows.push(...data);
          successCount++;
          projectContribs.push({
            projectName: project,
            contributors: aggregateTopContributors(data),
          });
        }
      });

      setPerProjectContributors(projectContribs);
      setCombinedContributors(aggregateTopContributors(allRows));

      if (successCount === 0) {
        setErrors([
          "No score data available. Make sure scores are calculated for at least one project.",
        ]);
      } else if (errorMessages.length > 0) {
        setErrors(errorMessages);
      }
    } catch (e: any) {
      setErrors([e?.message ?? "Failed to load contributors"]);
      setCombinedContributors([]);
      setPerProjectContributors([]);
    } finally {
      setLoading(false);
    }
  }, [selectedProjects]);

  useEffect(() => {
    fetchAndAggregate();
  }, [fetchAndAggregate]);

  useEffect(() => {
    const handleScoresUpdated = () => fetchAndAggregate();
    window.addEventListener("psat:scores:updated", handleScoresUpdated);
    return () =>
      window.removeEventListener("psat:scores:updated", handleScoresUpdated);
  }, [fetchAndAggregate]);

  const totalContribCount = combinedContributors.length;

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
                onClick={() => fetchAndAggregate(true)}
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
