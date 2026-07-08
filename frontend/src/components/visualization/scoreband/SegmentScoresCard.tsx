import { useMemo } from "react";
import React from "react";
import { Box, Flex, Grid, GridItem, Text, Image } from "@chakra-ui/react";
import { RISK_BAND_COLORS } from "./colorConstants";
import { Tooltip } from "../../ui/tooltip";

// Import Crash Type Icons
import iconBB from "../../../../CycleRAP Assets/BB.png";
import iconBP from "../../../../CycleRAP Assets/BP.png";
import iconSB from "../../../../CycleRAP Assets/SB.png";
import iconVB from "../../../../CycleRAP Assets/VB.png";


interface SegmentScoresCardProps {
  scores: {
    VB: number;
    BB: number;
    SB: number;
    BP: number;
    "Overall Risk Level"?: number;
    "CycleRAP score"?: number; // Backward compatibility for existing projects
    "Top 1 Contributor"?: string;
    "Top 1 Contribution"?: number;
    "Top 2 Contributor"?: string;
    "Top 2 Contribution"?: number;
    "Top 3 Contributor"?: string;
    "Top 3 Contribution"?: number;
    "Top 4 Contributor"?: string;
    "Top 4 Contribution"?: number;
    "Top 5 Contributor"?: string;
    "Top 5 Contribution"?: number;
    "Top Contributing Attributes"?: Array<{name: string, contribution: number}> | string;
  } | null;
  beforeScores?: {
    VB: number;
    BB: number;
    SB: number;
    BP: number;
    "Overall Risk Level"?: number;
    "CycleRAP score"?: number;
  } | null; // Optional scores for before/after comparison
  showPreviewBackground?: boolean; // If true, show light gray background for preview scores
  projectContributors?: {
    projectName: string;
    contributors: Array<{ name: string; contribution: number }>;
  } | null;
  onContributorClick?: (name: string) => void;
}

const CRASH_TYPES = [
  {
    key: "BB",
    label: "Bicycle-Bicycle",
    icon: iconBB,
    shortLabel: "BB",
  },
  {
    key: "BP",
    label: "Bicycle-Pedestrian",
    icon: iconBP,
    shortLabel: "BP",
  },
  {
    key: "SB",
    label: "Single-Bicycle",
    icon: iconSB,
    shortLabel: "SB",
  },
  {
    key: "VB",
    label: "Vehicle-Bicycle",
    icon: iconVB,
    shortLabel: "VB",
  },
];

const BB_BP_SB_TOOLTIP = (
  <Box fontSize="xs" lineHeight="1.6">
    <Text fontWeight="bold" mb="1">Risk Banding</Text>
    <Text>• Low: &le; 5</Text>
    <Text>• Medium: &gt; 5 – 10</Text>
    <Text>• High: &gt; 10 – 20</Text>
    <Text>• Extreme: &gt; 20</Text>
  </Box>
);

const VB_TOOLTIP = (
  <Box fontSize="xs" lineHeight="1.6">
    <Text fontWeight="bold" mb="1">Risk Banding</Text>
    <Text>• Low: &le; 10</Text>
    <Text>• Medium: &gt; 10 – 25</Text>
    <Text>• High: &gt; 25 – 60</Text>
    <Text>• Extreme: &gt; 60</Text>
  </Box>
);

const RISK_SCORE_TOOLTIP = (
  <Box fontSize="xs" lineHeight="1.6" minW="380px">
    <Text fontWeight="bold" mb="1">Risk Score</Text>
    <Text mb="1">Sum of all crash type scores. Banding colour takes the worst case across crash types.</Text>
    <Text fontWeight="semibold" mt="1">BB / BP / SB:</Text>
    <Text whiteSpace="nowrap">• Low: &le; 5 · Medium: &gt;5–10 · High: &gt;10–20 · Extreme: &gt; 20</Text>
    <Text fontWeight="semibold" mt="1">VB:</Text>
    <Text whiteSpace="nowrap">• Low: &le; 10 · Medium: &gt;10–25 · High: &gt;25–60 · Extreme: &gt; 60</Text>
  </Box>
);

const CRASH_TYPE_TOOLTIPS: Record<string, React.ReactNode> = {
  BB: BB_BP_SB_TOOLTIP,
  BP: BB_BP_SB_TOOLTIP,
  SB: BB_BP_SB_TOOLTIP,
  VB: VB_TOOLTIP,
};

const getBandColor = (score: number, type: string): string => {
  // BB, BP, SB use stricter thresholds
  if (['BB', 'BP', 'SB'].includes(type)) {
    if (score <= 5) return RISK_BAND_COLORS.LOW;
    if (score <= 10) return RISK_BAND_COLORS.MEDIUM;
    if (score <= 20) return RISK_BAND_COLORS.HIGH;
    return RISK_BAND_COLORS.EXTREME;
  }

  // VB and others (default)
  if (score <= 10) return RISK_BAND_COLORS.LOW;
  if (score <= 25) return RISK_BAND_COLORS.MEDIUM;
  if (score <= 60) return RISK_BAND_COLORS.HIGH;
  return RISK_BAND_COLORS.EXTREME;
};

const getLightBgColor = (score: number, type: string): string => {
  if (['BB', 'BP', 'SB'].includes(type)) {
    if (score <= 5) return RISK_BAND_COLORS.LOW;
    if (score <= 10) return RISK_BAND_COLORS.MEDIUM;
    if (score <= 20) return RISK_BAND_COLORS.HIGH;
    return RISK_BAND_COLORS.EXTREME;
  }

  if (score <= 10) return RISK_BAND_COLORS.LOW;
  if (score <= 25) return RISK_BAND_COLORS.MEDIUM;
  if (score <= 60) return RISK_BAND_COLORS.HIGH;
  return RISK_BAND_COLORS.EXTREME;
};

const getDarkBgColor = (score: number, type: string): string => {
  if (['BB', 'BP', 'SB'].includes(type)) {
    if (score <= 5) return RISK_BAND_COLORS.LOW;
    if (score <= 10) return RISK_BAND_COLORS.MEDIUM;
    if (score <= 20) return RISK_BAND_COLORS.HIGH;
    return RISK_BAND_COLORS.EXTREME;
  }

  if (score <= 10) return RISK_BAND_COLORS.LOW;
  if (score <= 25) return RISK_BAND_COLORS.MEDIUM;
  if (score <= 60) return RISK_BAND_COLORS.HIGH;
  return RISK_BAND_COLORS.EXTREME;
};

const getBandLabel = (score: number, type: string): string => {
  if (['BB', 'BP', 'SB'].includes(type)) {
    if (score <= 5) return "Low";
    if (score <= 10) return "Medium";
    if (score <= 20) return "High";
    return "Extreme";
  }

  if (score <= 10) return "Low";
  if (score <= 25) return "Medium";
  if (score <= 60) return "High";
  return "Extreme";
};

export default function SegmentScoresCard({ scores, beforeScores, showPreviewBackground, projectContributors, onContributorClick }: SegmentScoresCardProps) {
  const crashTypeScores = useMemo(() => {
    if (!scores) return [];
    return CRASH_TYPES.map((type) => {
      const score = (scores[type.key as keyof typeof scores] as number) || 0;
      return {
        ...type,
        score,
        color: getBandColor(score, type.key),
        band: getBandLabel(score, type.key),
      };
    });
  }, [scores]);

  // Handle both new and old column names for backward compatibility
  const totalScore = scores?.["Overall Risk Level"] ?? scores?.["CycleRAP score"] ?? 0;

  // Determine Overall Risk Level color based on the crash type with the highest score
  const getCycleRAPScoreColor = useMemo(() => {
    if (!scores) return RISK_BAND_COLORS.LOW;

    let maxRiskLevel = 0; // 0: Low, 1: Med, 2: High, 3: Extreme

    CRASH_TYPES.forEach((type) => {
      const score = (scores[type.key as keyof typeof scores] as number) || 0;
      let riskLevel = 0;

      // Determine risk level based on crash type thresholds
      if (['BB', 'BP', 'SB'].includes(type.key)) {
        if (score > 20) riskLevel = 3;       // Extreme
        else if (score > 10) riskLevel = 2;  // High
        else if (score > 5) riskLevel = 1;  // Medium
        else riskLevel = 0;                  // Low
      } else {
        // VB and others (default)
        if (score > 60) riskLevel = 3;       // Extreme
        else if (score > 25) riskLevel = 2;  // High
        else if (score > 10) riskLevel = 1; // Medium
        else riskLevel = 0;                  // Low
      }

      if (riskLevel > maxRiskLevel) {
        maxRiskLevel = riskLevel;
      }
    });

    switch (maxRiskLevel) {
      case 3: return RISK_BAND_COLORS.EXTREME;
      case 2: return RISK_BAND_COLORS.HIGH;
      case 1: return RISK_BAND_COLORS.MEDIUM;
      default: return RISK_BAND_COLORS.LOW;
    }
  }, [scores]);

  if (!scores) {
    return (
      <Box p="6" textAlign="center" bg="gray.50" _dark={{ bg: "gray.700" }} borderRadius="md">
        <Text color="gray.500" _dark={{ color: "gray.400" }}>
          No score data available
        </Text>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column">
      <Box flex="1" />
      <Box flex="0 0 auto">
        <Flex gap="4" justify="space-between" mb="1" align="center">
          <Text fontSize="sm" fontWeight="bold" color="gray.900" _dark={{ color: "white" }}>
            Crash Type Scores
          </Text>
          <Flex gap="2" align="center">
            <Flex align="center" gap="1">
              <Box w="12px" h="12px" borderRadius="sm" bg={RISK_BAND_COLORS.LOW} flexShrink={0} />
              <Text fontSize="2xs" color="gray.700" _dark={{ color: "gray.300" }}>
                Low
              </Text>
            </Flex>
            <Flex align="center" gap="1">
              <Box w="12px" h="12px" borderRadius="sm" bg={RISK_BAND_COLORS.MEDIUM} flexShrink={0} />
              <Text fontSize="2xs" color="gray.700" _dark={{ color: "gray.300" }}>
                Medium
              </Text>
            </Flex>
            <Flex align="center" gap="1">
              <Box w="12px" h="12px" borderRadius="sm" bg={RISK_BAND_COLORS.HIGH} flexShrink={0} />
              <Text fontSize="2xs" color="gray.700" _dark={{ color: "gray.300" }}>
                High
              </Text>
            </Flex>
            <Flex align="center" gap="1">
              <Box w="12px" h="12px" borderRadius="sm" bg={RISK_BAND_COLORS.EXTREME} flexShrink={0} />
              <Text fontSize="2xs" color="gray.700" _dark={{ color: "gray.300" }}>
                Extreme
              </Text>
            </Flex>
          </Flex>
        </Flex>

        <Flex gap="2" align="flex-end">
          {/* 5-column grid with crash type scores + total */}
          <Box flex="1">
            <Grid
              templateColumns="repeat(5, 1fr)"
              gap="1"
            >
              {crashTypeScores.map((type) => {
                const beforeScore = beforeScores ? ((beforeScores[type.key as keyof typeof beforeScores] as number) || 0) : null;
                const reduction = beforeScore !== null ? beforeScore - type.score : null;
                const improved = reduction !== null && reduction > 0;

                return (
                  <GridItem key={type.key}>
                    <Tooltip content={CRASH_TYPE_TOOLTIPS[type.key]} showArrow portalled openDelay={0} closeOnClick={false}>
                    <Flex
                      direction="row"
                      align="center"
                      justify="center"
                      bg={getLightBgColor(type.score, type.key)}
                      _dark={{ bg: getDarkBgColor(type.score, type.key) }}
                      borderRadius="sm"
                      p="1"
                      gap="4" // Controls spacing between logo and crash type scores
                      textAlign="center"
                      h={reduction !== null ? "80px" : "60px"}
                      color="black"
                      cursor="default"
                    >
                      {/* Icon */}
                      <Image
                        src={type.icon}
                        alt={type.shortLabel}
                        h="32px"
                        objectFit="contain"
                      />

                      <Flex direction="column" align="center" justify="center">
                        {/* Label */}
                        <Text fontSize="md" fontWeight="bold" lineHeight="1">
                          {type.shortLabel}
                        </Text>

                        {/* Score Value */}
                        <Text
                          fontSize="xl"
                          fontWeight="bold"
                          lineHeight="1.2"
                        >
                          {type.score.toFixed(1)}
                        </Text>

                        {/* Reduction indicator */}
                        {reduction !== null && improved && (
                          <Text fontSize="xs" color="inherit" _dark={{ color: "inherit" }} lineHeight="1">
                            ↓ {reduction.toFixed(2)}
                          </Text>
                        )}
                      </Flex>
                    </Flex>
                    </Tooltip>
                  </GridItem>
                );
              })}

              {/* Total Score */}
              <GridItem>
                {(() => {
                  const beforeTotal = beforeScores ? (beforeScores["Overall Risk Level"] ?? beforeScores["CycleRAP score"] ?? 0) : null;
                  const totalReduction = beforeTotal !== null ? beforeTotal - totalScore : null;
                  const totalImproved = totalReduction !== null && totalReduction > 0;

                  return (
                    <Tooltip content={RISK_SCORE_TOOLTIP} showArrow portalled openDelay={0} closeOnClick={false} contentProps={{ maxW: "420px" }}>
                    <Flex
                      direction="column"
                      align="center"
                      justify="center"
                      bg={getCycleRAPScoreColor}
                      borderRadius="sm"
                      p="1"
                      gap="0"
                      textAlign="center"
                      h={totalReduction !== null ? "80px" : "60px"}
                      color="black"
                      cursor="default"
                    >
                      {/* Total label */}
                      <Text fontSize="md" fontWeight="bold" lineHeight="1">
                        Risk Score
                      </Text>

                      {/* Total score value */}
                      <Text
                        fontSize="xl"
                        fontWeight="bold"
                        lineHeight="1.2"
                      >
                        {totalScore.toFixed(1)}
                      </Text>

                      {/* Reduction indicator */}
                      {totalReduction !== null && totalImproved && (
                        <Text fontSize="xs" color="inherit" _dark={{ color: "inherit" }} lineHeight="1">
                          ↓ {totalReduction.toFixed(2)}
                        </Text>
                      )}
                    </Flex>
                    </Tooltip>
                  );
                })()}
              </GridItem>
            </Grid>
          </Box>
        </Flex>

        {/* Top Contributing Attributes Section */}
        {(() => {
          if (!scores) return null;
          
          const topContributors: Array<{name: string, contribution: number}> = [];
          
          // Try new individual columns first
          for (let i = 1; i <= 5; i++) {
            const name = scores[`Top ${i} Contributor` as keyof typeof scores] as string | undefined;
            const contrib = scores[`Top ${i} Contribution` as keyof typeof scores] as number | undefined;
            if (name && contrib !== undefined && contrib !== null) {
              topContributors.push({ name, contribution: contrib });
            }
          }

          // Fallback to old property for backward compatibility
          if (topContributors.length === 0 && scores["Top Contributing Attributes"]) {
            let oldAttr = scores["Top Contributing Attributes"];
            if (typeof oldAttr === 'string') {
              try {
                // python ast literal_eval format is slightly different but usually JSON-like if double quoted
                // Alternatively, it's safer to just rely on the backend recalculation which we fixed.
                // But we'll try parsing just in case it's valid JSON
                oldAttr = JSON.parse(oldAttr.replace(/'/g, '"'));
              } catch (e) {}
            }
            if (Array.isArray(oldAttr)) {
              topContributors.push(...oldAttr);
            }
          }

          if (topContributors.length === 0) return null;

          return (
            <Box mt={4} pt={3} borderTopWidth={1} borderColor="gray.200" _dark={{ borderColor: "gray.700" }}>
              <Text fontSize="sm" fontWeight="semibold" color="gray.700" _dark={{ color: "gray.300" }} mb={2}>
                Top Risk Contributors
              </Text>
              <Flex wrap="wrap" gap={2}>
                {topContributors.map((attr, idx) => (
                  <Flex 
                    key={idx} 
                    align="center" 
                    bg="gray.50" 
                    px={2.5} 
                    py={1} 
                    borderRadius="md"
                    borderWidth={1}
                    borderColor="gray.200"
                    _dark={{ bg: "gray.700", borderColor: "gray.600" }}
                    cursor={onContributorClick ? "pointer" : "default"}
                    onClick={() => onContributorClick?.(attr.name)}
                  >
                    <Text fontSize="xs" fontWeight="medium" color="gray.800" _dark={{ color: "gray.50" }}>
                      {attr.name}
                    </Text>
                    <Text fontSize="xs" fontWeight="bold" ml={1.5} color="red.600" _dark={{ color: "red.300" }}>
                      +{attr.contribution.toFixed(1)}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </Box>
          );
        })()}

        {/* Project-level Top Contributing Attributes Section */}
        {projectContributors && projectContributors.contributors.length > 0 && (
          <Box mt={4} pt={3} borderTopWidth={1} borderColor="gray.200" _dark={{ borderColor: "gray.700" }}>
            <Text fontSize="sm" fontWeight="semibold" color="gray.700" _dark={{ color: "gray.300" }} mb={2}>
              Top Risk Contributors ({projectContributors.projectName})
            </Text>
            <Flex wrap="wrap" gap={2}>
              {projectContributors.contributors.map((attr, idx) => (
                <Flex
                  key={idx}
                  align="center"
                  bg="gray.50"
                  px={2.5}
                  py={1}
                  borderRadius="md"
                  borderWidth={1}
                  borderColor="gray.200"
                  _dark={{ bg: "gray.700", borderColor: "gray.600" }}
                  cursor={onContributorClick ? "pointer" : "default"}
                  onClick={() => onContributorClick?.(attr.name)}
                >
                  <Text fontSize="xs" fontWeight="medium" color="gray.800" _dark={{ color: "gray.50" }}>
                    {attr.name}
                  </Text>
                  <Text fontSize="xs" fontWeight="bold" ml={1.5} color="red.600" _dark={{ color: "red.300" }}>
                    +{attr.contribution.toFixed(1)}
                  </Text>
                </Flex>
              ))}
            </Flex>
          </Box>
        )}
      </Box>
    </Box>
  );
}

