import { useMemo, useState } from "react";
import {
  Box,
  Flex,
  Text,
  Accordion,
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
}

export default function AttributeDistributionChart({
  categoryData,
  selectedAttribute,
  categoryStatus = [],
  totalSegmentsLoaded,
  totalSegmentsViewed,
}: AttributeDistributionChartProps) {
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

  const totalActiveCount = categoryStatus.reduce((acc, group) => {
    if (group.rangeFilter !== undefined) return acc + 1;
    return acc + group.categories.filter(c => c.isActive).length;
  }, 0);

  const totalCount = categoryStatus.reduce((acc, group) => {
    if (group.rangeFilter !== undefined) return acc + 1;
    return acc + group.categories.length;
  }, 0);

  return (
    <Box>
      {/* Header with Toggle */}
      <Flex justify="space-between" align="center" mb="4" flexWrap="wrap" gap="4">
        <Box>
          <Text fontSize="lg" fontWeight="bold">
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

          {/* Category Status Accordion */}
          {categoryStatus && categoryStatus.length > 0 && (
            <Box mt="3" position="relative" zIndex={10}>
              <Accordion.Root collapsible>
                <Accordion.Item value="filters" border="none">
                  <Accordion.ItemTrigger 
                    py="1.5" 
                    px="4"
                    fontSize="sm" 
                    fontWeight="semibold"
                    color="white"
                    bg="blue.500"
                    _hover={{ bg: "blue.600" }}
                    borderRadius="full"
                    display="inline-flex"
                    width="fit-content"
                    boxShadow="sm"
                  >
                    Active Filters ({totalActiveCount}/{totalCount})
                  </Accordion.ItemTrigger>
                  <Accordion.ItemContent
                    position="absolute"
                    bg="white"
                    _dark={{ bg: "gray.800" }}
                    boxShadow="xl"
                    borderRadius="md"
                    p="4"
                    mt="1"
                    minW="320px"
                    maxH="400px"
                    overflowY="auto"
                    borderWidth="1px"
                  >
                    <Flex direction="column" gap="3">
                      {categoryStatus.map((group, groupIndex) => (
                        <Box key={groupIndex}>
                          <Text fontSize="xs" fontWeight="bold" color="gray.500" mb="1" textTransform="uppercase">
                            {group.attribute}
                          </Text>
                          {group.rangeFilter !== undefined ? (
                            /* Numeric range filter: show current bounds */
                            <Box
                              px="2"
                              py="0.5"
                              borderRadius="md"
                              bg="blue.subtle"
                              _dark={{ bg: "blue.subtle" }}
                              fontSize="xs"
                              fontWeight="semibold"
                              color="blue.fg"
                              borderWidth="1px"
                              borderColor="blue.300"
                              display="inline-block"
                            >
                              {group.rangeFilter.currentMin} – {group.rangeFilter.currentMax}
                              {group.rangeFilter.currentMin === group.rangeFilter.min &&
                               group.rangeFilter.currentMax === group.rangeFilter.max
                                ? " (all)"
                                : ""}
                            </Box>
                          ) : (
                            /* Categorical filter: chips with optional subcategory chips */
                            <Flex direction="column" gap="1.5">
                              {group.categories.map((item, index) => (
                                <Box key={index}>
                                  <Box
                                    px="2"
                                    py="0.5"
                                    borderRadius="full"
                                    bg={item.isActive ? "blue.subtle" : "gray.100"}
                                    _dark={{ bg: item.isActive ? "blue.subtle" : "gray.700" }}
                                    fontSize="xs"
                                    fontWeight={item.isActive ? "semibold" : "normal"}
                                    color={item.isActive ? "blue.fg" : "gray.500"}
                                    borderWidth="1px"
                                    borderColor={item.isActive ? item.color : "transparent"}
                                    opacity={item.isActive ? 1 : 0.7}
                                    textDecoration={item.isActive ? "none" : "line-through"}
                                    display="inline-block"
                                  >
                                    {item.category}
                                  </Box>
                                  {/* Subcategory chips (Layer 3) — only shown when parent is active */}
                                  {item.isActive && item.subcategories && item.subcategories.length > 0 && (
                                    <Flex
                                      gap="1.5"
                                      flexWrap="wrap"
                                      mt="1"
                                      ml="3"
                                      pl="2"
                                      borderLeftWidth="2px"
                                      borderColor="gray.200"
                                      _dark={{ borderColor: "gray.600" }}
                                    >
                                      {item.subcategories.map((sub, si) => (
                                        <Box
                                          key={si}
                                          px="1.5"
                                          py="0.5"
                                          borderRadius="full"
                                          bg={sub.isActive ? "green.subtle" : "gray.100"}
                                          _dark={{ bg: sub.isActive ? "green.subtle" : "gray.700" }}
                                          fontSize="xs"
                                          fontWeight={sub.isActive ? "semibold" : "normal"}
                                          color={sub.isActive ? "green.fg" : "gray.400"}
                                          borderWidth="1px"
                                          borderColor={sub.isActive ? sub.color : "transparent"}
                                          opacity={sub.isActive ? 1 : 0.5}
                                          textDecoration={sub.isActive ? "none" : "line-through"}
                                        >
                                          {sub.name}
                                        </Box>
                                      ))}
                                    </Flex>
                                  )}
                                </Box>
                              ))}
                            </Flex>
                          )}
                        </Box>
                      ))}
                    </Flex>
                  </Accordion.ItemContent>
                </Accordion.Item>
              </Accordion.Root>
            </Box>
          )}
        </Box>
        {showToggle && <ChartTypeToggle chartType={chartTypeState} onToggle={setChartTypeState} />}
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
