import { useEffect, useState } from "react";
import {
  listGeneratedReports,
  deleteGeneratedReport,
  type GeneratedReportInfo,
} from "../../api";
import { Spinner, Text, Badge, Box, Flex, HStack, Button } from "@chakra-ui/react";
import { useColorModeValue } from "../../components/ui/color-mode";
import { useUiVersion } from "../../features/ui/useUiVersion";

function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function GeneratedReportsPage() {
  const [reports, setReports] = useState<GeneratedReportInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<GeneratedReportInfo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");

  // ── v2 design tokens (DESIGN_GUIDE.md): 6px radius, no shadow, gray.200
  // borders, 32px content padding, 700 headers. Matches GisLayersPage.
  const isV2 = useUiVersion() === "v2";
  const cardRadius = isV2 ? "6px" : "lg";
  const cardShadow = isV2 ? "none" : "sm";
  const headWeight = isV2 ? "700" : "600";
  const contentPad = isV2 ? 8 : 6;

  // Color mode values — matches GisLayersPage palette
  const rootBg = useColorModeValue("gray.50", "gray.900");
  const titleColor = useColorModeValue("gray.900", "white");
  const subtitleColor = useColorModeValue("gray.600", "gray.400");
  const panelBg = useColorModeValue("white", "gray.800");
  const panelHeaderBg = useColorModeValue("gray.50", "gray.850");
  const panelHeaderBorder = useColorModeValue("gray.200", "gray.700");
  const borderColor = useColorModeValue("gray.200", "gray.700");
  const itemBorderColor = useColorModeValue("gray.100", "gray.700");
  const itemBg = useColorModeValue("white", "gray.800");
  const itemHoverBg = useColorModeValue("gray.50", "gray.700");
  const selectedItemBg = useColorModeValue("blue.50", "blue.900");
  const selectedItemHoverBg = useColorModeValue("blue.100", "blue.800");
  const textColor = useColorModeValue("gray.700", "gray.200");
  const mutedTextColor = useColorModeValue("gray.500", "gray.400");
  const emptyStateColor = useColorModeValue("gray.500", "gray.400");
  const previewBg = useColorModeValue("gray.100", "gray.800");

  const loadReports = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listGeneratedReports();
      setReports(data);
    } catch (err: any) {
      setError(err.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const handleDeleteClick = (name: string) => {
    setConfirmDelete(name);
    setActionError(null);
  };

  const handleCancelDelete = () => {
    setConfirmDelete(null);
    setActionError(null);
  };

  const handleConfirmDelete = async (name: string) => {
    try {
      setActionLoading(true);
      setActionError(null);
      await deleteGeneratedReport(name);
      if (selected?.name === name) setSelected(null);
      setConfirmDelete(null);
      await loadReports();
    } catch (err: any) {
      setActionError(err.message || "Delete failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownload = (name: string) => {
    const a = document.createElement("a");
    a.href = `/api/generated-reports/${encodeURIComponent(name)}`;
    a.download = name;
    a.click();
  };

  const filtered = reports.filter((r) =>
    r.name.toLowerCase().includes(filterText.toLowerCase())
  );

  const previewUrl = selected
    ? `/api/generated-reports/${encodeURIComponent(selected.name)}`
    : null;

  return (
    <Box display="flex" flexDirection="column" h="100%" p={contentPad} bg={rootBg} overflowY="auto">
      {/* Page header */}
      <Flex mb={6} justify="space-between" align="flex-start">
        <Box>
          <Text fontSize={isV2 ? "xl" : "2xl"} fontWeight={headWeight} color={titleColor} mb={2}>
            Generated Reports
          </Text>
          <Text fontSize="sm" color={subtitleColor}>
            PDF reports exported from the Report Builder are saved here automatically.
          </Text>
        </Box>
        <Button
          onClick={loadReports}
          colorPalette="teal"
          variant="surface"
          size={isV2 ? "md" : "sm"}
          disabled={loading}
        >
          Refresh
        </Button>
      </Flex>

      <Flex h="calc(100vh - 180px)" gap="4">
        {/* ── Left panel: report list ─────────────────────────────────── */}
        <Box
          flex="0 0 400px"
          bg={panelBg}
          borderRadius={cardRadius}
          boxShadow={cardShadow}
          overflow="hidden"
          display="flex"
          flexDirection="column"
          borderWidth="1px"
          borderColor={borderColor}
        >
          {/* Panel header with filter */}
          <Box
            p={4}
            borderBottom="1px solid"
            borderColor={panelHeaderBorder}
            bg={panelHeaderBg}
          >
            <Flex align="center" justify="space-between" gap="3">
              <Text fontWeight={headWeight} color={titleColor} whiteSpace="nowrap">
                Saved Reports
              </Text>
              <input
                type="text"
                placeholder="Filter reports..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "4px 10px",
                  borderRadius: "6px",
                  border: "1px solid var(--chakra-colors-gray-300)",
                  background: "transparent",
                  color: "inherit",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
            </Flex>
          </Box>

          {/* Action error banner */}
          {actionError && (
            <Box
              px={3}
              py={2}
              bg="red.50"
              _dark={{ bg: "red.950", borderColor: "red.700" }}
              borderBottom="1px solid"
              borderColor="red.200"
            >
              <Flex align="center" justify="space-between" gap="2">
                <Text fontSize="xs" color="red.700" _dark={{ color: "red.300" }}>
                  {actionError}
                </Text>
                <Button
                  size="xs"
                  variant="ghost"
                  colorPalette="red"
                  onClick={() => setActionError(null)}
                >
                  ✕
                </Button>
              </Flex>
            </Box>
          )}

          {/* List body */}
          <Box flex="1" overflowY="auto">
            {loading ? (
              <Flex justify="center" align="center" h="100%" p={4}>
                <Spinner />
                <Text ml={3} color={textColor}>
                  Loading reports...
                </Text>
              </Flex>
            ) : error ? (
              <Box p={4} color="red.500">
                {error}
              </Box>
            ) : reports.length === 0 ? (
              <Box p={4} color={emptyStateColor}>
                No reports found. Download a PDF from the Report Builder to save one here.
              </Box>
            ) : filtered.length === 0 ? (
              <Box p={4} color={emptyStateColor}>
                No reports match &ldquo;{filterText}&rdquo;.
              </Box>
            ) : (
              filtered.map((report) => {
                const isSelected = selected?.name === report.name;
                const isPendingDelete = confirmDelete === report.name;
                return (
                  <Box
                    key={report.name}
                    p={3}
                    borderBottom="1px solid"
                    borderColor={itemBorderColor}
                    cursor="pointer"
                    bg={isSelected ? selectedItemBg : itemBg}
                    _hover={{ bg: isSelected ? selectedItemHoverBg : itemHoverBg }}
                    onClick={() => {
                      if (!isPendingDelete) setSelected(isSelected ? null : report);
                    }}
                    transition="background-color 0.2s"
                  >
                    {/* Name + actions row */}
                    <Flex align="center" justify="space-between" gap="2">
                      <Text
                        fontWeight={headWeight}
                        fontSize="sm"
                        color={titleColor}
                        flex="1"
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={report.name}
                      >
                        {report.name}
                      </Text>
                      <HStack gap="1" flexShrink={0} onClick={(e) => e.stopPropagation()}>
                        {!isPendingDelete ? (
                          <>
                            <Button
                              size="xs"
                              variant="ghost"
                              colorPalette="blue"
                              onClick={() => handleDownload(report.name)}
                              title="Download"
                            >
                              ↓
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              colorPalette="red"
                              onClick={() => handleDeleteClick(report.name)}
                              title="Delete"
                            >
                              ✕
                            </Button>
                          </>
                        ) : (
                          <>
                            <Text fontSize="xs" color="red.500" fontWeight="600">
                              Delete?
                            </Text>
                            <Button
                              size="xs"
                              colorPalette="red"
                              variant="solid"
                              onClick={() => handleConfirmDelete(report.name)}
                              disabled={actionLoading}
                            >
                              Yes
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={handleCancelDelete}
                              disabled={actionLoading}
                            >
                              No
                            </Button>
                          </>
                        )}
                      </HStack>
                    </Flex>

                    {/* Metadata row */}
                    <Flex mt={1} gap="2" align="center" wrap="wrap">
                      <Badge colorPalette="teal" size="sm">
                        PDF
                      </Badge>
                      <Text fontSize="xs" color={mutedTextColor}>
                        {formatBytes(report.size)}
                      </Text>
                      <Text fontSize="xs" color={mutedTextColor}>
                        {formatDate(report.created)}
                      </Text>
                    </Flex>
                  </Box>
                );
              })
            )}
          </Box>
        </Box>

        {/* ── Right panel: PDF preview ────────────────────────────────── */}
        <Box
          flex="1"
          bg={panelBg}
          borderRadius={cardRadius}
          boxShadow={cardShadow}
          overflow="hidden"
          display="flex"
          flexDirection="column"
          borderWidth="1px"
          borderColor={borderColor}
        >
          {selected && previewUrl ? (
            <>
              {/* Preview header */}
              <Box
                p={4}
                borderBottom="1px solid"
                borderColor={panelHeaderBorder}
                bg={panelHeaderBg}
              >
                <Flex align="center" justify="space-between" gap="3">
                  <Text
                    fontWeight="600"
                    fontSize="sm"
                    color={titleColor}
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={selected.name}
                  >
                    {selected.name}
                  </Text>
                  <HStack gap="2" flexShrink={0}>
                    <Badge colorPalette="teal" size="sm">
                      {formatBytes(selected.size)}
                    </Badge>
                    <Button
                      size="sm"
                      colorPalette="blue"
                      variant="surface"
                      onClick={() => handleDownload(selected.name)}
                    >
                      Download
                    </Button>
                    <Button
                      size="sm"
                      colorPalette="red"
                      variant="surface"
                      onClick={() => handleDeleteClick(selected.name)}
                    >
                      Delete
                    </Button>
                  </HStack>
                </Flex>
              </Box>

              {/* PDF iframe */}
              <Box flex="1" bg={previewBg}>
                <iframe
                  key={previewUrl}
                  src={previewUrl}
                  style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                  title={selected.name}
                />
              </Box>
            </>
          ) : (
            <Flex
              flex="1"
              justify="center"
              align="center"
              flexDirection="column"
              gap="3"
              color={emptyStateColor}
            >
              <Text fontSize="lg" fontWeight="500">
                No report selected
              </Text>
              <Text fontSize="sm">
                Select a report from the list to preview it here.
              </Text>
            </Flex>
          )}
        </Box>
      </Flex>
    </Box>
  );
}
