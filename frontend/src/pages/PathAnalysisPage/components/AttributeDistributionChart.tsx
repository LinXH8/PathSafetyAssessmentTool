import { useMemo, useState } from "react";
import {
  Box,
  Flex,
  Text,
} from "@chakra-ui/react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { ChartTypeToggle } from "../../../components/ui/ChartTypeToggle";
import { FONT } from "../../../features/ui/designTokens";
import { V2Segmented, DistTooltipBox } from "./paV2Primitives";

interface CategoryItem {
  category: string;
  isActive: boolean;
  color: string;
  subcategories?: { name: string; isActive: boolean; color: string }[];
}

interface AttributeStatus {
  attribute: string;
  categories: CategoryItem[];
  rangeFilter?: { min: number; max: number; currentMin: number; currentMax: number };
}

interface AttributeDistributionChartProps {
  categoryData: { category: string; count: number; color: string }[];
  selectedAttribute: string | null;
  categoryStatus?: AttributeStatus[];
  totalSegmentsLoaded?: number;
  totalSegmentsViewed?: number;
  /** "v2" swaps the Pie/Bar toggle for the §5 segmented control + slims the title. */
  variant?: "v1" | "v2";
}

export default function AttributeDistributionChart({
  categoryData,
  selectedAttribute,
  totalSegmentsLoaded,
  totalSegmentsViewed,
  variant = "v1",
}: AttributeDistributionChartProps) {
  const isV2 = variant === "v2";
  const [chartTypeState, setChartTypeState] = useState<"pie" | "bar">("pie");

  const activeChartType = chartTypeState;
  const showToggle = true;

  // Calculate total for percentage
  const total = useMemo(() => {
    return categoryData.reduce((sum, item) => sum + item.count, 0);
  }, [categoryData]);

  // Prepare data with percentages
  const chartData = useMemo(() => {
    return categoryData.map((item) => ({
      ...item,
      percentage: total > 0 ? ((item.count / total) * 100).toFixed(1) : "0",
    }));
  }, [categoryData, total]);

  if (!selectedAttribute || categoryData.length === 0) {
    return (
      <Box p="6" textAlign="center">
        <Text color="gray.500">
          {!selectedAttribute
            ? "Select an attribute to view distribution chart"
            : "No data available for the selected categories"}
        </Text>
      </Box>
    );
  }

  // Custom label for pie chart
  const renderCustomLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
  }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (percent < 0.03) return null; // Don't show label for small slices

    return (
      <text
        x={x}
        y={y}
        fill="black"
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontSize: "14px", fontWeight: 700 }}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <Box>
      {/* Header with Toggle */}
      <Flex justify="space-between" align="center" mb="4" flexWrap="wrap" gap="4">
        <Box>
          <Text fontSize={isV2 ? "16px" : "lg"} fontWeight="bold" style={isV2 ? { fontFamily: FONT } : undefined}>
            Distribution of {selectedAttribute}
          </Text>
          <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.300" }}>
            Total Segments: {totalSegmentsLoaded ?? total}
          </Text>
          {totalSegmentsViewed !== undefined && totalSegmentsLoaded !== undefined && (
            <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
              Currently Viewing: {totalSegmentsViewed} out of {totalSegmentsLoaded} ({totalSegmentsLoaded > 0 ? ((totalSegmentsViewed / totalSegmentsLoaded) * 100).toFixed(0) : "0"}%)
            </Text>
          )}
          {/* The "Active Filters" pill/accordion was removed in v2 — the active
              filter set is already visible in the map's filter chips. The chart
              below keeps its fixed height, so the card height is unaffected. */}
        </Box>
        {showToggle && (
          isV2 ? (
            <V2Segmented
              options={[{ value: "pie", label: "Pie" }, { value: "bar", label: "Bar" }]}
              value={chartTypeState}
              onChange={setChartTypeState}
              height={34}
            />
          ) : (
            <ChartTypeToggle chartType={chartTypeState} onToggle={setChartTypeState} />
          )
        )}
      </Flex>

      {/* Chart Container */}
      <Box h="500px" w="100%" minH="500px" position="relative">
        <ResponsiveContainer width="100%" height="100%">
          {activeChartType === "pie" ? (
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="40%"
                labelLine={false}
                label={renderCustomLabel}
                outerRadius={145}
                innerRadius={60}
                fill="#8884d8"
                dataKey="count"
                animationDuration={1000}
                animationBegin={0}
                paddingAngle={0}
              >
                {chartData.map((_entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={_entry.color}
                    stroke="none"
                  />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    if (isV2) {
                      return <DistTooltipBox title={data.category} detail={`Count: ${data.count} (${data.percentage}%)`} />;
                    }
                    return (
                      <Box
                        bg="white"
                        _dark={{ bg: "gray.800" }}
                        p="4"
                        borderRadius="lg"
                        boxShadow="0 8px 20px rgba(0, 0, 0, 0.15)"
                        style={{ borderWidth: "2px", borderColor: data.color }}
                      >
                        <Text fontSize="md" fontWeight="bold" mb="2" style={{ color: data.color }}>
                          {data.category}
                        </Text>
                        <Flex direction="column" gap="1">
                          <Text fontSize="sm" fontWeight="semibold" color="gray.700" _dark={{ color: "gray.200" }}>
                            Count: {data.count}
                          </Text>
                          <Text fontSize="lg" fontWeight="bold" style={{ color: data.color }}>
                            {data.percentage}%
                          </Text>
                        </Flex>
                      </Box>
                    );
                  }
                  return null;
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={100}
                content={() => (
                  <Flex justify="center" gap="3" flexWrap="wrap" mt="2">
                    {chartData.map((item, index) => (
                      <Flex
                        key={`legend-${index}`}
                        align="center"
                        gap="2"
                        bg="white"
                        _dark={{ bg: "gray.700" }}
                        px="3"
                        py="1.5"
                        borderRadius="full"
                        boxShadow="0 2px 8px rgba(0, 0, 0, 0.1)"
                        style={{ borderColor: item.color, borderWidth: "2px" }}
                      >
                        <Box
                          w="10px"
                          h="10px"
                          borderRadius="full"
                          style={{ backgroundColor: item.color, boxShadow: `0 0 8px ${item.color}` }}
                        />
                        <Text fontSize="sm" fontWeight="semibold">
                          {item.category}
                        </Text>
                        <Text fontSize="xs" fontWeight="bold" style={{ color: item.color }}>
                          {item.percentage}%
                        </Text>
                      </Flex>
                    ))}
                  </Flex>
                )}
              />
            </PieChart>
          ) : (
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 20, right: 60, left: 20, bottom: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                type="number"
                tick={{ fontSize: 13, fontWeight: 500, fill: "#6B7280" }}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={{ stroke: "#e5e7eb" }}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="category"
                tick={{ fontSize: 13, fontWeight: 600, fill: "#374151" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(59, 130, 246, 0.08)' }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    if (isV2) {
                      return <DistTooltipBox title={data.category} detail={`Count: ${data.count} (${data.percentage}%)`} />;
                    }
                    return (
                      <Box
                        bg="white"
                        _dark={{ bg: "gray.800" }}
                        p="4"
                        borderRadius="lg"
                        boxShadow="0 8px 20px rgba(0, 0, 0, 0.15)"
                        style={{ borderWidth: "2px", borderColor: data.color }}
                      >
                        <Text fontSize="md" fontWeight="bold" mb="2" style={{ color: data.color }}>
                          {data.category}
                        </Text>
                        <Flex direction="column" gap="1">
                          <Text fontSize="sm" fontWeight="semibold" color="gray.700" _dark={{ color: "gray.200" }}>
                            Count: {data.count}
                          </Text>
                          <Text fontSize="lg" fontWeight="bold" style={{ color: data.color }}>
                            {data.percentage}%
                          </Text>
                        </Flex>
                      </Box>
                    );
                  }
                  return null;
                }}
              />
              <Bar
                dataKey="count"
                radius={[0, 8, 8, 0]}
                animationDuration={1000}
                animationBegin={0}
                maxBarSize={50}
              >
                {chartData.map((_entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={_entry.color}
                    stroke="none"
                  />
                ))}
              </Bar>
              <Legend
                verticalAlign="bottom"
                height={100}
                content={() => (
                  <Flex justify="center" gap="3" flexWrap="wrap" mt="2">
                    {chartData.map((item, index) => (
                      <Flex
                        key={`legend-${index}`}
                        align="center"
                        gap="2"
                        bg="white"
                        _dark={{ bg: "gray.700" }}
                        px="3"
                        py="1.5"
                        borderRadius="full"
                        boxShadow="0 2px 8px rgba(0, 0, 0, 0.1)"
                        style={{ borderColor: item.color, borderWidth: "2px" }}
                      >
                        <Box
                          w="10px"
                          h="10px"
                          borderRadius="full"
                          style={{ backgroundColor: item.color, boxShadow: `0 0 8px ${item.color}` }}
                        />
                        <Text fontSize="sm" fontWeight="semibold">
                          {item.category}
                        </Text>
                        <Text fontSize="xs" fontWeight="bold" style={{ color: item.color }}>
                          {item.percentage}%
                        </Text>
                      </Flex>
                    ))}
                  </Flex>
                )}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
