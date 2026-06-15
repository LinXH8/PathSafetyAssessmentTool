import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useLocation } from "react-router-dom";
import {
  Box,
  Dialog,
  Flex,
  Grid,
  GridItem,
  Text,
  Spinner,
  NumberInput,
  Button,
  Input,
  Portal,
  Progress,
  Card,
  CardBody,
} from "@chakra-ui/react";

import type { Feature, FeatureCollection, LineString } from "geojson";
import { toaster } from "../../components/ui/toaster";
import ExitConfirmationDialog from "../sidebar/components/ExitConfirmationDialog";


import {
  fetchProjectDetail,
  fetchProjectAttributes,
  fetchProjectGeoJSON,
  fetchAttributeMappings,
  fetchCustomAttrOptions,
  calculateScore,
  calculateScoreForRow,
  fetchProjectMetadata,
  updateProject,
} from "../../api";

import type { AttributeRow, CodingFilterContext } from "../../api";
import { autocodeImage, autocodeGIS, autocodeAllStream, CODING_FILTER_CONTEXT_KEY } from "../../api";

import ImagePanel from "./components/ImagePanel";
import AttributesPanel, { resolveContributorTabGroup } from "./components/AttributesPanel";
import AttributeOptionsDialog from "./components/AttributeOptionsDialog";
import GeoDataPanel from "./components/GeoDataPanel";
import { saveAttributes } from "../../api";
import "../../components/visualization/AnalysisPanel.css";
import { fetchWidthVisualization } from "../../api/widthVisualization";
import type { WidthVisualizationResponse } from "../../api/widthVisualization";
import { fetchCurvatureVisualization } from "../../api/curvatureVisualization";
import type { CurvatureVisualizationResponse } from "../../api/curvatureVisualization";
import SegmentScoresCard from "../../components/visualization/scoreband/SegmentScoresCard";
import { aggregateTopContributors } from "../../utils/aggregateTopContributors";
import AutocodeValidation from "../PathAnalysisPage/components/AutocodeValidation";


type ProjectDetail = { name: string; versions: string[]; latest: string };
type AttributesResponse = { rows: AttributeRow[] };
type AttrMappings = Record<string, Record<string, string>>;

const PANEL_HEIGHT = 550;

// Type for project data
type ProjectDataState = {
  detail: ProjectDetail | null;
  attrs: AttributeRow[];
  geoFeatures: Feature[];
  scores: any[];
  currentPage: number;
  changedFieldsByRow: Record<number, string[]>;
  fieldSourcesByRow: Record<number, Record<string, string>>;
  loading: boolean;
  error: string | null;
  editedRow: AttributeRow | null;
  verified?: boolean;
  verifiedSegmentCount?: number;
  autocodedSegmentCount?: number;
  isDirty?: boolean;
};

const defaultProjectData: ProjectDataState = {
  detail: null,
  attrs: [],
  geoFeatures: [],
  scores: [],
  currentPage: 1,
  changedFieldsByRow: {},
  fieldSourcesByRow: {},
  loading: true,
  error: null,
  editedRow: null,
  isDirty: false,
};

// Global cache for project data to prevent reloading when navigating away and back (e.g. to Help page)
const projectDataCache: Record<string, ProjectDataState> = {};

// Snapshot of attrs as last loaded/saved from backend — used to detect real changes vs. isDirty flag
const savedAttrsSnapshot: Record<string, AttributeRow[]> = {};

const DELINEATION_PRESENT_SUGGESTIONS = ["Cycling Path", "Red Stripe", "Signalised Crossing", "Zebra Crossing"];
const FO_TYPE_SUGGESTIONS = ["Lamp Post", "Traffic Light", "Pillar", "Bollards", "Fence", "Vegetation"];
const NFO_TYPE_SUGGESTIONS = ["Barrier", "Bins", "Bicycle", "Cone"];
const SLIPPERY_ISSUE_TYPE_SUGGESTIONS = ["Algae", "Leaves", "Soil", "Sand"];

const FACILITY_WIDTH_SUBCATEGORY_MAP: Record<string, string[]> = {
  "Very Narrow": ["≤1.5m", ">1.5–1.8m", ">1.8–<2m"],
  "Narrow": ["2–<3.5m", "3.5–4m"],
  "Wide": [">4m"],
};

function getParentCategoryForSubcat(subCat: string | null | undefined): string | null {
  if (!subCat) return null;
  for (const [parent, children] of Object.entries(FACILITY_WIDTH_SUBCATEGORY_MAP)) {
    if (children.includes(subCat)) return parent;
  }
  return null;
}

type LogicCheckNotif = { description: string; isWarning: boolean };

function applyLogicChecks(
  field: string,
  value: string | number | boolean | null,
  currentRow: AttributeRow
): { extraUpdates: Record<string, number>; notifications: LogicCheckNotif[] } {
  const extraUpdates: Record<string, number> = {};
  const notifications: LogicCheckNotif[] = [];
  const projected = { ...currentRow, [field]: value };

  const isPresent = (v: unknown) => Number(v) === 1;
  const isZeroOrNull = (v: unknown) => {
    if (v === null || v === undefined || v === "") return true;
    const n = Number(v);
    return isNaN(n) || n === 0;
  };

  const autoDisable = (target: string, msg: string) => {
    if (isPresent(projected[target])) {
      extraUpdates[target] = 2;
      notifications.push({ description: msg, isWarning: false });
    }
  };

  const autoEnable = (target: string, msg: string) => {
    if (!isPresent(projected[target])) {
      extraUpdates[target] = 1;
      notifications.push({ description: msg, isWarning: false });
    }
  };

  const warn = (msg: string) => notifications.push({ description: msg, isWarning: true });

  // Rules 1-5: mutual exclusion between 0-1m and 1-3m adjacent fields
  const mutualPairs: Array<[string, string, string]> = [
    ["Adjacent Road Lane 0-1m", "Adjacent Road Lane 1-3m", "Adjacent Road Lane"],
    ["Adjacent Vehicle Parking 0-1m", "Adjacent Vehicle Parking 1-3m", "Adjacent Vehicle Parking"],
    ["Adjacent Severe Hazard 0-1m", "Adjacent Severe Hazard 1-3m", "Adjacent Severe Hazard"],
    ["Adjacent object or level change 0-1m", "Adjacent object or level change 1-3m", "Adjacent object or level change"],
    ["Adjacent Sidewalk 0-1m", "Adjacent Sidewalk 1-3m", "Adjacent Sidewalk"],
  ];
  for (const [near, far, label] of mutualPairs) {
    if (field === near && isPresent(value)) {
      autoDisable(far, `"${label} 1-3m" cleared (mutually exclusive with 0-1m)`);
    } else if (field === far && isPresent(value)) {
      autoDisable(near, `"${label} 0-1m" cleared (mutually exclusive with 1-3m)`);
    }
  }

  // Rule 6: Facility Type = Sidewalk → Adjacent Sidewalk 0-1m = Not Present
  if (field === "Facility Type" && Number(value) === 1) {
    autoDisable("Adjacent Sidewalk 0-1m", '"Adjacent Sidewalk 0-1m" cleared (facility is already a Sidewalk)');
  }

  // Rule 7: Facility Type = Mixed Traffic Road Lane → Adjacent Road Lane 0-1m = Present, 1-3m = Not Present
  if (field === "Facility Type" && Number(value) === 6) {
    autoEnable("Adjacent Road Lane 0-1m", '"Adjacent Road Lane 0-1m" set to Present (Mixed Traffic Road Lane)');
    autoDisable("Adjacent Road Lane 1-3m", '"Adjacent Road Lane 1-3m" cleared (Mixed Traffic Road Lane)');
  }

  // Rule 9: Width Restriction = Present → FO or NFO must be Present (warning only)
  if (field === "Width Restriction" && isPresent(value)) {
    if (!isPresent(projected["Fixed Obstacle on Facility"]) && !isPresent(projected["Non-Fixed Obstacle on Facility"])) {
      warn('"Width Restriction" is Present — set "Fixed Obstacle on Facility" or "Non-Fixed Obstacle on Facility" to Present');
    }
  }

  // Rule 10: Facility Type = Sidewalk/Multi-use/Off-road → Light Segregation = Present
  if (field === "Facility Type" && [1, 2, 3].includes(Number(value))) {
    autoEnable("Light Segregation", '"Light Segregation" set to Present');
  }

  // Rule 11: Property Access = Present → Intersection or Road Crossing = Present
  if (field === "Property Access" && isPresent(value)) {
    autoEnable("Intersection or Road Crossing", '"Intersection or Road Crossing" set to Present (Property Access implies road crossing)');
  }

  // Rule 12: Facility Type = On-road Bicycle Lane → Adjacent Road Lane 0-1m = Present
  if (field === "Facility Type" && Number(value) === 4) {
    autoEnable("Adjacent Road Lane 0-1m", '"Adjacent Road Lane 0-1m" set to Present (On-road Bicycle Lane)');
  }

  // Rules 13-14: Adjacent Road Lane 0-1m = Present → AADT and speed non-zero
  if (field === "Adjacent Road Lane 0-1m" && isPresent(value)) {
    if (isZeroOrNull(projected["Road AADT"]))
      warn('"Road AADT" should not be 0 when "Adjacent Road Lane 0-1m" is Present');
    if (isZeroOrNull(projected["Road operating speed (mean)"]))
      warn('"Road Operating Speed (mean)" should not be 0 when "Adjacent Road Lane 0-1m" is Present');
  }

  // Rules 15-16: Adjacent Road Lane 1-3m = Present → AADT and speed non-zero
  if (field === "Adjacent Road Lane 1-3m" && isPresent(value)) {
    if (isZeroOrNull(projected["Road AADT"]))
      warn('"Road AADT" should not be 0 when "Adjacent Road Lane 1-3m" is Present');
    if (isZeroOrNull(projected["Road operating speed (mean)"]))
      warn('"Road Operating Speed (mean)" should not be 0 when "Adjacent Road Lane 1-3m" is Present');
  }

  // Rules 17-18: Intersection or Road Crossing = Present → AADT and speed non-zero
  if (field === "Intersection or Road Crossing" && isPresent(value)) {
    if (isZeroOrNull(projected["Road AADT"]))
      warn('"Road AADT" should not be 0 when "Intersection or Road Crossing" is Present');
    if (isZeroOrNull(projected["Road operating speed (mean)"]))
      warn('"Road Operating Speed (mean)" should not be 0 when "Intersection or Road Crossing" is Present');
  }

  // Rules 19-20: Facility Type = Mixed Traffic Road Lane → AADT and speed non-zero
  if (field === "Facility Type" && Number(value) === 6) {
    if (isZeroOrNull(projected["Road AADT"]))
      warn('"Road AADT" should not be 0 for Mixed Traffic Road Lane');
    if (isZeroOrNull(projected["Road operating speed (mean)"]))
      warn('"Road Operating Speed (mean)" should not be 0 for Mixed Traffic Road Lane');
  }

  // Rule 21: Facility Type = Road Shoulder → Adjacent Road Lane 0-1m = Present
  if (field === "Facility Type" && Number(value) === 5) {
    autoEnable("Adjacent Road Lane 0-1m", '"Adjacent Road Lane 0-1m" set to Present (Road Shoulder)');
  }

  return { extraUpdates, notifications };
}

function PresentMultiTagModal({
  open,
  options,
  onConfirm,
  onCancel,
  title,
  description,
  singleSelect = false,
}: {
  open: boolean;
  options: string[];
  onConfirm: (val: string) => void;
  onCancel?: () => void;
  title: string;
  description: string;
  singleSelect?: boolean;
}) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showOthersInput, setShowOthersInput] = useState(false);
  const [othersText, setOthersText] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedTags([]);
      setShowOthersInput(false);
      setOthersText("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        document.body.style.pointerEvents = "auto";
        document.documentElement.style.pointerEvents = "auto";
        document.body.style.overflow = "";
        document.documentElement.style.overflow = "";
        document.body.removeAttribute("data-scroll-locked");
        document.documentElement.removeAttribute("data-scroll-locked");
      }, 400);
      return () => clearTimeout(t);
    }
  }, [open]);

  function toggleTag(tag: string) {
    if (singleSelect) {
      setSelectedTags([tag]);
    } else {
      setSelectedTags((prev) =>
        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
      );
    }
  }

  function handleAddOthers() {
    const trimmed = othersText.trim();
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags((prev) => [...prev, trimmed]);
    }
    setOthersText("");
    setShowOthersInput(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={() => { }} unmountOnExit>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content maxW="420px" w="full">
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Text fontSize="sm" mb="3">
                {description}
              </Text>
              <Box display="flex" flexWrap="wrap" gap="2">
                {options.map((opt) => {
                  const selected = selectedTags.includes(opt);
                  return (
                    <Box
                      key={opt}
                      as="button"
                      px="3"
                      py="1.5"
                      borderRadius="full"
                      borderWidth="2px"
                      borderColor={selected ? "blue.500" : "gray.200"}
                      bg={selected ? "blue.50" : "white"}
                      color={selected ? "blue.800" : "gray.700"}
                      fontWeight={selected ? "semibold" : "normal"}
                      fontSize="sm"
                      cursor="pointer"
                      _hover={{ borderColor: "blue.400", bg: "blue.50" }}
                      _dark={{
                        bg: selected ? "blue.900" : "gray.800",
                        borderColor: selected ? "blue.400" : "gray.600",
                        color: selected ? "blue.200" : "gray.300",
                      }}
                      transition="all 0.15s"
                      onClick={() => toggleTag(opt)}
                    >
                      {opt}
                    </Box>
                  );
                })}
                {!singleSelect && (
                  <Box
                    as="button"
                    px="3"
                    py="1.5"
                    borderRadius="full"
                    borderWidth="2px"
                    borderColor="gray.300"
                    bg="white"
                    color="gray.600"
                    fontSize="sm"
                    cursor="pointer"
                    _hover={{ borderColor: "blue.400", bg: "blue.50" }}
                    _dark={{ bg: "gray.800", borderColor: "gray.500", color: "gray.300" }}
                    transition="all 0.15s"
                    onClick={() => setShowOthersInput(true)}
                  >
                    + Others
                  </Box>
                )}
              </Box>
              {showOthersInput && (
                <Box display="flex" gap="2" mt="3">
                  <Input
                    size="sm"
                    placeholder="Enter custom value..."
                    value={othersText}
                    onChange={(e) => setOthersText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleAddOthers(); }
                    }}
                    autoFocus
                  />
                  <Button size="sm" variant="outline" onClick={handleAddOthers} disabled={!othersText.trim()}>
                    Add
                  </Button>
                </Box>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              {onCancel && (
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              <Button
                colorPalette="blue"
                disabled={selectedTags.length === 0}
                onClick={() => onConfirm(selectedTags.join(", "))}
              >
                Confirm
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}



export default function CodingPage() {
  const { projectNames } = useParams<{ projectNames: string }>();

  // Parse multiple project names from URL
  const projectList = useMemo(() => {
    if (!projectNames) return [];
    try {
      return projectNames.split(',').map(name => {
        try {
          return decodeURIComponent(name);
        } catch {
          return name;
        }
      });
    } catch {
      return [];
    }
  }, [projectNames]);

  // When the URL params change (e.g. cross-project navigation from GeoDataPanel),
  // sync activeTab to the first project in the new list if the current tab is gone.
  useEffect(() => {
    if (projectList.length > 0 && !projectList.includes(activeTab) && activeTab !== "coding-guide") {
      setActiveTab(projectList[0]);
    }
  // activeTab intentionally excluded — we only want to react to projectList changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectList]);

  // Current active tab (project name or "coding-guide")
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (projectNames) {
      try {
        const names = projectNames.split(',').map(name => {
          try {
            return decodeURIComponent(name);
          } catch {
            return name;
          }
        });
        return names[0] ?? "coding-guide";
      } catch {
        return "coding-guide";
      }
    }
    return "coding-guide";
  });
  const currentProjectName = activeTab === "coding-guide" ? null : activeTab;
  const isShowingCodingGuide = activeTab === "coding-guide";

  // State for each project: keyed by project name
  const [projectData, setProjectData] = useState<Record<string, ProjectDataState>>(projectDataCache);

  // Global state
  const [autoCoding, setAutoCoding] = useState(false);
  const [autoCodeMsg, setAutoCodeMsg] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [projectProgress, setProjectProgress] = useState<Record<string, { processed: number; total: number }>>({});
  const [attrMappings, setAttrMappings] = useState<AttrMappings>({});
  const [customAttrOptions, setCustomAttrOptions] = useState<Record<string, string[]>>({});
  const [editingOptions, setEditingOptions] = useState<{ field: string; currentValue: string | null; delineationNotPresent?: boolean } | null>(null);
  const [pendingPresentDelineationChange, setPendingPresentDelineationChange] = useState(false);
  const [pendingNotPresentDelineationChange, setPendingNotPresentDelineationChange] = useState(false);
  const [pendingPresentFOChange, setPendingPresentFOChange] = useState(false);
  const [pendingPresentNFOChange, setPendingPresentNFOChange] = useState(false);
  const [pendingPresentSlipperyChange, setPendingPresentSlipperyChange] = useState(false);
  const [pendingFacilityWidthParentChange, setPendingFacilityWidthParentChange] = useState<{
    categoryLabel: string;
    subCategories: string[];
    originalParentCode: string | number | null;
    originalSubCategory: string | null;
  } | null>(null);
  const [activeAttributeGroupTab, setActiveAttributeGroupTab] = useState<string | null>(null);

  // Image preloading state
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [imageLoadingProgress, setImageLoadingProgress] = useState(0);


  // Refs for cleanup
  const cleanupTimeoutRef = useRef<number | null>(null);
  const scoreDebounceRef = useRef<Record<number, number>>({});
  const autoCodingRef = useRef(false);

  // Handle query params for deep linking (e.g. ?segment=5)
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const initialSegment = queryParams.get("segment");
  const hasInitializedSegmentRef = useRef(false);

  // Filter context from Path Analysis — persisted in sessionStorage for reload survival.
  // Uses useState+useEffect so it re-evaluates on every in-app navigation (no remount).
  const resolveFilterContext = (state: unknown): CodingFilterContext | null => {
    const fromState = (state as any)?.filterContext as CodingFilterContext | null | undefined;
    if (fromState !== undefined) {
      if (fromState) sessionStorage.setItem(CODING_FILTER_CONTEXT_KEY, JSON.stringify(fromState));
      else sessionStorage.removeItem(CODING_FILTER_CONTEXT_KEY);
      return fromState ?? null;
    }
    try {
      const stored = sessionStorage.getItem(CODING_FILTER_CONTEXT_KEY);
      return stored ? (JSON.parse(stored) as CodingFilterContext) : null;
    } catch {
      return null;
    }
  };

  const [filterContext, setFilterContext] = useState<CodingFilterContext | null>(() =>
    resolveFilterContext(location.state)
  );

  useEffect(() => {
    setFilterContext(resolveFilterContext(location.state));
  // location.state reference changes on each navigation, which is exactly when we want to re-run
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Save confirmation dialog state
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Analysis sidebar state (lifted from AnalysisPanel)
  const [widthData, setWidthData] = useState<WidthVisualizationResponse | null>(null);
  const [curvData, setCurvData] = useState<CurvatureVisualizationResponse | null>(null);
  const [showCurvatureOverlay, setShowCurvatureOverlay] = useState(false);

  const handleContributorClick = useCallback((name: string) => {
    const targetGroup = resolveContributorTabGroup(name);
    if (targetGroup) {
      setActiveAttributeGroupTab(targetGroup);
    }
  }, []);

  // Reset the segment-init guard whenever the active project changes so that
  // cross-project navigation (which reuses the same component instance) can
  // apply the new ?segment= query param for the incoming project.
  useEffect(() => {
    hasInitializedSegmentRef.current = false;
  }, [currentProjectName]);

  useEffect(() => {
    if (!initialSegment || !currentProjectName || hasInitializedSegmentRef.current) return;

    const segmentIdx = parseInt(initialSegment, 10);
    if (!isNaN(segmentIdx) && segmentIdx > 0) {
      // We can only set the page if we know the total length, or at least we trust the input.
      // The actual clamping happens in updateProjectData or valid rendering,
      // but here we just blindly set the currentPage if it seems valid.
      // We'll trust the component to clamp it if it's out of bounds once data is loaded.
      updateProjectData(currentProjectName, { currentPage: segmentIdx });
      hasInitializedSegmentRef.current = true;
    }
  }, [initialSegment, currentProjectName]);

  // Get current project data with defaults
  const currentData = useMemo<ProjectDataState>(() => {
    if (!currentProjectName) return defaultProjectData;
    return projectData[currentProjectName] || defaultProjectData;
  }, [projectData, currentProjectName]);

  // Shorthand accessors
  const {
    detail,
    attrs,
    geoFeatures,
    scores,
    currentPage,
    changedFieldsByRow,
    fieldSourcesByRow,
    loading,
    error,
    editedRow,
  } = currentData;

  // Helper to update a specific project's data
  const updateProjectData = (projectName: string, updates: Partial<ProjectDataState>) => {
    setProjectData(prev => {
      const newState = {
        ...prev,
        [projectName]: {
          ...prev[projectName] || defaultProjectData,
          ...updates,
        },
      };
      projectDataCache[projectName] = newState[projectName];
      return newState;
    });
  };

  const refreshCurrentProject = useCallback(async () => {
    if (!currentProjectName) return;

    updateProjectData(currentProjectName, { loading: true, error: null });

    try {
      const [d, a, gjson, metadata, autoMeta] = await Promise.all([
        fetchProjectDetail(currentProjectName),
        fetchProjectAttributes(currentProjectName) as Promise<AttributesResponse>,
        fetchProjectGeoJSON(currentProjectName) as Promise<FeatureCollection>,
        fetchProjectMetadata(currentProjectName).catch(() => null),
        fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/autocode-metadata`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      const attributes = a?.rows ?? [];

      savedAttrsSnapshot[currentProjectName] = attributes;
      updateProjectData(currentProjectName, {
        detail: d ?? null,
        attrs: attributes,
        geoFeatures: gjson?.features ?? [],
        editedRow: null,
        verified: metadata?.verified ?? false,
        verifiedSegmentCount: metadata?.verified_segment_count ?? 0,
        autocodedSegmentCount: metadata?.autocoded_segment_count ?? 0,
        changedFieldsByRow: autoMeta?.changedFieldsByRow || {},
        fieldSourcesByRow: autoMeta?.fieldSourcesByRow || {},
        loading: false,
        isDirty: false,
      });

    } catch (e: any) {
      updateProjectData(currentProjectName, {
        error: e?.message ?? "Unknown error",
        loading: false,
      });
    }
  }, [currentProjectName]);


  // Update verified segment count for a project
  const updateVerifiedSegmentCount = async (projectName: string | null, count: number) => {
    if (!projectName) return;
    try {
      const totalSegments = projectData[projectName]?.attrs?.length ?? 0;
      // Clamp the count to be between 0 and total segments
      const clampedCount = Math.max(0, Math.min(count, totalSegments));

      await updateProject(projectName, { verified_segment_count: clampedCount });
      updateProjectData(projectName, { verifiedSegmentCount: clampedCount });
      // Notify other pages of the change with segment count
      window.dispatchEvent(new CustomEvent("psat:verified:updated", {
        detail: { projectName, verifiedSegmentCount: clampedCount }
      }));
    } catch (e: any) {
      toaster.create({
        title: "Failed to update",
        description: e?.message ?? "Failed to update verified segment count",
        type: "error",
      });
    }
  };

  // Update autocoded segment count for a project
  const updateAutocodedSegmentCount = async (projectName: string | null, count: number) => {
    if (!projectName) return;
    try {
      const totalSegments = projectData[projectName]?.attrs?.length ?? 0;
      // Clamp the count to be between 0 and total segments
      const clampedCount = Math.max(0, Math.min(count, totalSegments));

      await updateProject(projectName, { autocoded_segment_count: clampedCount });
      updateProjectData(projectName, { autocodedSegmentCount: clampedCount });
      // Notify other pages of the change with segment count
      window.dispatchEvent(new CustomEvent("psat:autocoded:updated", {
        detail: { projectName, autocodedSegmentCount: clampedCount }
      }));
    } catch (e: any) {
      toaster.create({
        title: "Failed to update",
        description: e?.message ?? "Failed to update autocoded segment count",
        type: "error",
      });
    }
  };

  // Helper function to clear auto-coding state
  const clearAutoCodingState = useCallback(() => {
    setAutoCoding(false);
    setAutoCodeMsg("");
    setProgress(0);
    setProjectProgress({});
    if (cleanupTimeoutRef.current !== null) {
      clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (cleanupTimeoutRef.current !== null) {
        clearTimeout(cleanupTimeoutRef.current);
        cleanupTimeoutRef.current = null;
      }
      Object.values(scoreDebounceRef.current).forEach(timeout => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      });
      scoreDebounceRef.current = {};
    };
  }, []);

  // Keep autoCodingRef in sync with autoCoding state
  useEffect(() => {
    autoCodingRef.current = autoCoding;
  }, [autoCoding]);

  const len = attrs.length;
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [segmentInput, setSegmentInput] = useState(String(currentData.verifiedSegmentCount ?? 0));
  const [autocodedSegmentInput, setAutocodedSegmentInput] = useState(String(currentData.autocodedSegmentCount ?? 0));

  const currentIndex = useMemo(
    () => Math.max(0, Math.min(len - 1, currentPage - 1)),
    [currentPage, len]
  );

  const projectContributors = useMemo(() => {
    if (!currentProjectName) return null;
    const slice = scores as unknown as Array<Record<string, unknown>>;
    return {
      projectName: currentProjectName,
      contributors: aggregateTopContributors(slice),
    };
  }, [scores, currentProjectName]);

  const currentAttr = useMemo<AttributeRow | null>(
    () => (len > 0 ? attrs[currentIndex] : null),
    [attrs, currentIndex]
  );

  const currentFeature = useMemo<Feature | null>(() => {
    return geoFeatures[currentIndex] ?? null;
  }, [geoFeatures, currentIndex]);

  const imgRef = useMemo<string | undefined>(() => {
    const fromAttr =
      (attrs?.[currentIndex] as any)?.["Image Reference"] ??
      (attrs?.[currentIndex] as any)?.["image"] ??
      (attrs?.[currentIndex] as any)?.["img"];

    const p = (currentFeature?.properties as any) || {};
    const fromFeature =
      p?.["Image Reference"] ??
      p?.["Image_Reference"] ??
      p?.["image"] ??
      p?.["img"];

    return (fromAttr ?? fromFeature) || undefined;
  }, [attrs, currentIndex, currentFeature]);

  // Per-segment verification for the Path Analysis review flow. Held in memory only
  // (deliberately NOT persisted to the backend) and keyed by project name → segment
  // index. A single shared store means verified state survives switching between the
  // open projects, and resets when the reviewer leaves and re-enters the page. Only
  // surfaced when entered from Path Analysis (i.e. a filter context is present).
  const cameFromPathAnalysis = filterContext != null;
  const [verifiedByProject, setVerifiedByProject] = useState<Record<string, number[]>>({});

  const currentSegmentVerified = useMemo(
    () => !!currentProjectName && (verifiedByProject[currentProjectName] ?? []).includes(currentIndex),
    [verifiedByProject, currentProjectName, currentIndex]
  );

  const toggleCurrentSegmentVerified = useCallback(() => {
    if (!currentProjectName) return;
    setVerifiedByProject(prev => {
      const existing = prev[currentProjectName] ?? [];
      const isVerified = existing.includes(currentIndex);
      const next = isVerified
        ? existing.filter(i => i !== currentIndex)
        : [...existing, currentIndex];
      return { ...prev, [currentProjectName]: next };
    });
  }, [currentProjectName, currentIndex]);

  // Preload next images to improve user experience
  useEffect(() => {
    if (!currentProjectName || !attrs.length) return;

    const PRELOAD_COUNT = 5;
    const indicesToPreload = [];
    for (let i = 1; i <= PRELOAD_COUNT; i++) {
      if (currentIndex + i < attrs.length) {
        indicesToPreload.push(currentIndex + i);
      }
    }

    indicesToPreload.forEach(idx => {
      const row = attrs[idx];
      const feat = geoFeatures[idx] ?? null;

      const fromAttr =
        (row as any)?.["Image Reference"] ??
        (row as any)?.["image"] ??
        (row as any)?.["img"];

      const p = (feat?.properties as any) || {};
      const fromFeature =
        p?.["Image Reference"] ??
        p?.["Image_Reference"] ??
        p?.["image"] ??
        p?.["img"];

      const nextImgRef = (fromAttr ?? fromFeature) || undefined;

      if (nextImgRef) {
        const url = `/api/projects/${encodeURIComponent(currentProjectName)}/images/${encodeURIComponent(nextImgRef)}`;
        const img = new Image();
        img.src = url;
      }
    });
  }, [currentIndex, currentProjectName, attrs, geoFeatures]);

  const applyUpdatesToCurrentRow = useCallback(
    (updates: Record<string, number | string | boolean | null>) => {
      if (!updates || Object.keys(updates).length === 0) return;
      if (!currentProjectName) return;
      setProjectData(prev => {
        const projName = currentProjectName;
        return {
          ...prev,
          [projName]: {
            ...prev[projName] || defaultProjectData,
            isDirty: true,
            attrs: (prev[projName]?.attrs || []).map((row, i) =>
              i === currentIndex ? { ...row, ...updates } : row
            ),
          },
        };
      });
    },
    [currentIndex, currentProjectName]
  );

  /** Atomically update multiple fields on the current row, then debounce score recalculation. */
  const editCurrentAttrMany = useCallback(
    (updates: Record<string, string | number | boolean | null>) => {
      if (!currentProjectName || !attrs?.[currentIndex]) return;
      const updatedRow = { ...attrs[currentIndex], ...updates };
      updateProjectData(currentProjectName, {
        attrs: attrs.map((row, i) => (i === currentIndex ? updatedRow : row)),
        isDirty: true,
      });
      // Dispatch for the first changed field (sufficient for validation listener)
      const firstField = Object.keys(updates)[0];
      if (firstField !== undefined) {
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field: firstField, value: updates[firstField] }
        }));
      }
      const currentIdx = currentIndex;
      if (scoreDebounceRef.current[currentIdx] !== undefined) {
        clearTimeout(scoreDebounceRef.current[currentIdx]);
      }
      scoreDebounceRef.current[currentIdx] = window.setTimeout(async () => {
        if (!currentProjectName) return;
        try {
          const newScore = await calculateScoreForRow(currentProjectName, updatedRow);
          updateProjectData(currentProjectName, {
            scores: scores.map((score, i) =>
              i === currentIdx ? { ...score, ...newScore } : score
            ),
          });
          window.dispatchEvent(new CustomEvent("psat:scores:updated"));
        } catch {}
      }, 500);
    },
    [currentIndex, currentProjectName, attrs, scores]
  );

  // Normalize attribute values to consistent types (convert numeric strings to numbers)
  const normalizeAttributeValues = (attrs: AttributeRow[]): AttributeRow[] => {
    return attrs.map(row => {
      const normalized: AttributeRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (value === null || value === undefined) {
          normalized[key] = value;
        } else if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
          // Convert numeric strings to numbers
          normalized[key] = Number(value);
        } else {
          normalized[key] = value;
        }
      }
      return normalized;
    });
  };

  // Update the autocode baseline after autocode runs.
  // Pass fieldsToUpdate to do a selective column-only merge (preserves manual edits
  // to previously-autocoded attributes). Omit it for a full baseline replacement
  // (e.g. "autocode all" where every field is overwritten).
  const updateAutocodeBaseline = useCallback(
    (updatedAttrs: AttributeRow[], fieldsToUpdate?: string[]) => {
      if (!currentProjectName) return;
      try {
        let rowsToSave: AttributeRow[];
        if (fieldsToUpdate && fieldsToUpdate.length > 0 && baselineRowsRef.current.length > 0) {
          // Only patch the autocoded columns into the existing baseline so that
          // manual edits to other attributes are not baked into the reference values.
          rowsToSave = baselineRowsRef.current.map((baselineRow, i) => {
            const updatedRow = updatedAttrs[i];
            if (!updatedRow) return baselineRow;
            const patch: Record<string, unknown> = {};
            for (const field of fieldsToUpdate) {
              if (field in updatedRow) patch[field] = updatedRow[field];
              // Mirror alias pairs that the patchedAttrs builder also applies
              if (field === "Grade" && "Gradient %" in updatedRow) patch["Gradient %"] = updatedRow["Gradient %"];
              if (field === "Delineation" && "Delineation Type" in updatedRow) patch["Delineation Type"] = updatedRow["Delineation Type"];
            }
            return { ...baselineRow, ...patch };
          });
        } else {
          rowsToSave = updatedAttrs;
        }
        const normalized = normalizeAttributeValues(rowsToSave);
        fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/baseline`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: normalized })
        }).then(() => {
          window.dispatchEvent(new CustomEvent("psat:baseline:updated", {
            detail: { projectName: currentProjectName }
          }));
        });
      } catch (e) {
      }
    },
    [currentProjectName]
  );

  // Helper to save autocode metadata
  const saveAutocodeMetadata = useCallback((projName: string, changedFields: any, fieldSources: any) => {
    fetch(`/api/projects/${encodeURIComponent(projName)}/autocode-metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changedFieldsByRow: changedFields, fieldSourcesByRow: fieldSources })
    }).catch(e => console.error("Failed to save autocode metadata", e));
  }, []);

  // Auto-code one segment
  useEffect(() => {
    if (!currentProjectName) return;

    const handler = async () => {
      if (autoCodingRef.current) return;

      try {
        setAutoCoding(true);
        autoCodingRef.current = true;
        setAutoCodeMsg("Starting…");
        setProgress(5);

        if (!imgRef) throw new Error("Missing imageRef");
        if (!currentFeature || currentFeature.geometry?.type !== "LineString") {
          throw new Error("Missing LineString geometry");
        }
        const line = (currentFeature.geometry as LineString).coordinates;

        setAutoCodeMsg("Running Computer Vision…");
        setProgress(35);
        const cvPromise = autocodeImage(currentProjectName, imgRef);

        setAutoCodeMsg("Running GIS rules…");
        setProgress(65);
        const gisPromise = autocodeGIS(currentProjectName, line);

        const [cv, g] = await Promise.all([cvPromise, gisPromise]);

        setAutoCodeMsg("Merging updates…");
        setProgress(85);
        const merged = { ...(cv?.updates ?? {}), ...(g?.updates ?? {}) };

        const cvChanged = cv?.changed_fields ?? [];
        const gisChanged = g?.changed_fields ?? [];
        const allChanged = [...new Set([...cvChanged, ...gisChanged])];

        const fieldSources: Record<string, string> = {
          ...(cv?.field_sources ?? {}),
          ...(g?.field_sources ?? {}),
        };
        cvChanged.forEach(field => { if (!fieldSources[field]) fieldSources[field] = "CV"; });
        gisChanged.forEach(field => { if (!fieldSources[field]) fieldSources[field] = "GIS"; });

        updateProjectData(currentProjectName, {
          changedFieldsByRow: {
            ...changedFieldsByRow,
            [currentIndex]: allChanged
          },
          fieldSourcesByRow: {
            ...fieldSourcesByRow,
            [currentIndex]: fieldSources
          }
        });

        // Save metadata immediately
        saveAutocodeMetadata(currentProjectName, {
          ...changedFieldsByRow,
          [currentIndex]: allChanged
        }, {
          ...fieldSourcesByRow,
          [currentIndex]: fieldSources
        });

        applyUpdatesToCurrentRow(merged);

        // Update autocode baseline with new values
        const updatedAttrs = attrs.map((row, i) =>
          i === currentIndex ? { ...row, ...merged } : row
        );
        updateAutocodeBaseline(updatedAttrs);

        setProgress(95);
        if (currentProjectName && currentIndex !== undefined && attrs[currentIndex]) {
          try {
            const updatedRow = { ...attrs[currentIndex], ...merged };
            const newScore = await calculateScoreForRow(currentProjectName, updatedRow);

            updateProjectData(currentProjectName, {
              scores: scores.map((score, i) =>
                i === currentIndex ? { ...score, ...newScore } : score
              )
            });
          } catch (e: any) {
          }
        }

        setProgress(100);
        setAutoCodeMsg("Done");
        toaster.create({
          title: "Auto-code (current) done",
          description: `CV + GIS updates applied. ${allChanged.length} fields changed.`,
          type: "success",
        });
      } catch (e: any) {
        toaster.create({
          title: "Auto-code failed",
          description: String(e?.message ?? e),
          type: "error",
        });
      } finally {
        if (cleanupTimeoutRef.current !== null) {
          clearTimeout(cleanupTimeoutRef.current);
        }
        cleanupTimeoutRef.current = window.setTimeout(() => {
          clearAutoCodingState();
        }, 300);
      }
    };

    window.addEventListener("psat:autocode:one", handler);
    return () => window.removeEventListener("psat:autocode:one", handler);
  }, [currentProjectName, imgRef, currentFeature, applyUpdatesToCurrentRow, updateAutocodeBaseline, currentIndex, attrs, scores, changedFieldsByRow, fieldSourcesByRow]);

  // Auto-code all segments
  useEffect(() => {
    if (!currentProjectName) return;

    const handler = async () => {
      if (autoCodingRef.current) return;
      try {
        setAutoCoding(true);
        autoCodingRef.current = true;
        setAutoCodeMsg("CV + GIS for all records…");
        setProgress(10);
        const attrLength = attrs.length;
        setProjectProgress({ [currentProjectName]: { processed: 0, total: attrLength } });

        const r = await autocodeAllStream(
          currentProjectName,
          { all: true, save: false },
          (processed, total, _errors) => {
            setProjectProgress({ [currentProjectName]: { processed, total } });
            setProgress(10 + Math.round((processed / total) * 75));
          },
        );

        const allChangedFieldsByRow: Record<number, string[]> =
          ("changed_by_row" in r && r.changed_by_row) ? r.changed_by_row : {};
        const allSourcesByRow: Record<number, Record<string, string>> =
          ("sources_by_row" in r && r.sources_by_row) ? r.sources_by_row : {};
        const totalOk = ("ok" in r ? r.ok : 0) || 0;
        const totalFail = ("fail" in r ? r.fail : 0) || 0;

        // After all segments processed, fetch updated attributes and recalculate scores
        setProgress(85);
        try {
          const rows = ("updated_attributes" in r && r.updated_attributes) ? r.updated_attributes : null;
          if (rows) {
            const prevChanged = projectDataCache[currentProjectName]?.changedFieldsByRow ?? {};
            const prevSources = projectDataCache[currentProjectName]?.fieldSourcesByRow ?? {};
            const mergedChanged: Record<number, string[]> = { ...prevChanged };
            for (const [k, v] of Object.entries(allChangedFieldsByRow)) {
              const n = Number(k);
              mergedChanged[n] = [...new Set([...(mergedChanged[n] ?? []), ...(v as string[])])];
            }
            const mergedSources: Record<number, Record<string, string>> = { ...prevSources };
            for (const [k, v] of Object.entries(allSourcesByRow)) {
              const n = Number(k);
              mergedSources[n] = { ...(mergedSources[n] ?? {}), ...(v as Record<string, string>) };
            }
            updateProjectData(currentProjectName, {
              attrs: rows,
              changedFieldsByRow: mergedChanged,
              fieldSourcesByRow: mergedSources,
              isDirty: true,
            });

            // Save metadata
            saveAutocodeMetadata(currentProjectName, mergedChanged, mergedSources);

            // Update autocode baseline with new values from all segments
            updateAutocodeBaseline(rows);

            // Recalculate scores
            const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/score`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ attributes: rows }),
            });

            if (res.ok) {
              const result = await res.json();
              if (result.ok && Array.isArray(result.result_rows)) {
                updateProjectData(currentProjectName, {
                  scores: result.result_rows,
                });
              }
            }
          }
        } catch (e: any) {
        }

        setProgress(100);
        setAutoCodeMsg("Completed");

        // Update autocoded segment count to total segments when autocode all completes
        if (totalOk > 0 && totalFail === 0) {
          // Only set to 100% if all segments were successfully autocoded
          const totalSegments = attrs.length;
          updateAutocodedSegmentCount(currentProjectName, totalSegments);
        }

        const totalProcessed = totalOk + totalFail;
        toaster.create({
          title: "Auto-code (all) done",
          description: `Total: ${totalProcessed}, OK: ${totalOk}, Failed: ${totalFail}${totalFail > 0 ? " (check console for details)" : ""}`,
          type: totalFail > 0 ? "warning" : "success",
        });

      } catch (e: any) {
        toaster.create({
          title: "Auto-code failed",
          description: String(e?.message ?? e),
          type: "error",
        });
      } finally {
        if (cleanupTimeoutRef.current !== null) {
          clearTimeout(cleanupTimeoutRef.current);
        }
        cleanupTimeoutRef.current = window.setTimeout(() => {
          clearAutoCodingState();
        }, 300);
      }
    };

    window.addEventListener("psat:autocode:all", handler);
    return () => window.removeEventListener("psat:autocode:all", handler);
  }, [currentProjectName, attrs.length, updateAutocodeBaseline, updateAutocodedSegmentCount]);

  // Auto-code all segments for selected attributes only
  useEffect(() => {
    if (!currentProjectName) return;

    const handler = async (e: Event) => {
      const fields: string[] = (e as CustomEvent).detail?.fields ?? [];
      if (fields.length === 0) return;
      if (autoCodingRef.current) return;
      try {
        setAutoCoding(true);
        autoCodingRef.current = true;
        setAutoCodeMsg(`Autocoding ${fields.length} attribute(s) for all records…`);
        setProgress(10);
        const attrLength = attrs.length;
        setProjectProgress({ [currentProjectName]: { processed: 0, total: attrLength } });

        // Streaming call — progress counter updates as each segment completes
        const r = await autocodeAllStream(
          currentProjectName,
          { all: true, fields, save: false },
          (processed, total, _errors) => {
            setProjectProgress({ [currentProjectName]: { processed, total } });
            setProgress(10 + Math.round((processed / total) * 75)); // 10% → 85%
          },
        );

        const allChangedFieldsByRow: Record<number, string[]> =
          ("changed_by_row" in r && r.changed_by_row) ? r.changed_by_row : {};
        const allSourcesByRow: Record<number, Record<string, string>> =
          ("sources_by_row" in r && r.sources_by_row) ? r.sources_by_row : {};
        const totalOk = ("ok" in r ? r.ok : 0) || 0;
        const totalFail = ("fail" in r ? r.fail : 0) || 0;

        setProgress(85);
        try {
          // Use updated_attributes returned by the batch call — avoids an extra fetchProjectAttributes round trip
          const rows = ("updated_attributes" in r && r.updated_attributes) ? r.updated_attributes : null;
          if (rows) {
            const prevChanged = projectDataCache[currentProjectName]?.changedFieldsByRow ?? {};
            const prevSources = projectDataCache[currentProjectName]?.fieldSourcesByRow ?? {};
            const mergedChanged: Record<number, string[]> = { ...prevChanged };
            for (const [k, v] of Object.entries(allChangedFieldsByRow)) {
              const n = Number(k);
              mergedChanged[n] = [...new Set([...(mergedChanged[n] ?? []), ...(v as string[])])];
            }
            const mergedSources: Record<number, Record<string, string>> = { ...prevSources };
            for (const [k, v] of Object.entries(allSourcesByRow)) {
              const n = Number(k);
              mergedSources[n] = { ...(mergedSources[n] ?? {}), ...(v as Record<string, string>) };
            }
            // Selective patch: only overwrite the requested fields so that a
            // previous by-attribute run's un-saved changes are not clobbered.
            const currentAttrs = projectDataCache[currentProjectName]?.attrs ?? attrs;
            const patchedAttrs = currentAttrs.map((oldRow, idx) => {
              const newRow = rows[idx];
              if (!newRow) return oldRow;
              const patch: Record<string, unknown> = {};
              for (const field of fields) {
                if (field in newRow) patch[field] = newRow[field];
                // Mirror the alias pairs the backend's _bulk_gen filter uses
                if (field === "Grade" && "Gradient %" in newRow) patch["Gradient %"] = newRow["Gradient %"];
                if (field === "Delineation" && "Delineation Type" in newRow) patch["Delineation Type"] = newRow["Delineation Type"];
              }
              return { ...oldRow, ...patch };
            });

            updateProjectData(currentProjectName, {
              attrs: patchedAttrs,
              changedFieldsByRow: mergedChanged,
              fieldSourcesByRow: mergedSources,
              isDirty: true,
            });

            saveAutocodeMetadata(currentProjectName, mergedChanged, mergedSources);
            updateAutocodeBaseline(patchedAttrs, fields);

            const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/score`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ attributes: patchedAttrs }),
            });

            if (res.ok) {
              const result = await res.json();
              if (result.ok && Array.isArray(result.result_rows)) {
                updateProjectData(currentProjectName, { scores: result.result_rows });
              }
            }
          }
        } catch {
          // score recalculation failure is non-fatal
        }

        setProgress(100);
        setAutoCodeMsg("Completed");

        const totalProcessed = totalOk + totalFail;
        toaster.create({
          title: "Auto-code (by attribute) done",
          description: `Total: ${totalProcessed}, OK: ${totalOk}, Failed: ${totalFail}${totalFail > 0 ? " (check console for details)" : ""}`,
          type: totalFail > 0 ? "warning" : "success",
        });

      } catch (e: any) {
        toaster.create({
          title: "Auto-code failed",
          description: String(e?.message ?? e),
          type: "error",
        });
      } finally {
        if (cleanupTimeoutRef.current !== null) {
          clearTimeout(cleanupTimeoutRef.current);
        }
        cleanupTimeoutRef.current = window.setTimeout(() => {
          clearAutoCodingState();
        }, 300);
      }
    };

    window.addEventListener("psat:autocode:by-field", handler);
    return () => window.removeEventListener("psat:autocode:by-field", handler);
  }, [currentProjectName, attrs.length, updateAutocodeBaseline]);

  // Auto-code all segments in all loaded projects
  useEffect(() => {
    const handler = async () => {
      if (autoCodingRef.current) return;
      try {
        setAutoCoding(true);
        autoCodingRef.current = true;
        setAutoCodeMsg("CV + GIS for all segments in all projects…");
        setProgress(10);

        // Auto-code all projects sequentially
        const projectsToAutocode = projectList;
        let totalProcessed = 0;
        let totalSuccessful = 0;
        let totalFailed = 0;
        const errors: any[] = [];

        // Initialize project progress with correct totals
        const initialProgress: Record<string, { processed: number; total: number }> = {};
        projectsToAutocode.forEach(name => {
          const projDataSnapshot = projectData[name];
          let total = 0;
          if (projDataSnapshot?.attrs && Array.isArray(projDataSnapshot.attrs)) {
            total = projDataSnapshot.attrs.length;
          }
          initialProgress[name] = { processed: 0, total };
        });
        setProjectProgress(initialProgress);

        for (let i = 0; i < projectsToAutocode.length; i++) {
          const projectName = projectsToAutocode[i];
          // Get the actual attrs length for this project from the current state
          let projectAttrsLength = 0;
          const projectDataSnapshot = projectData[projectName];
          if (projectDataSnapshot?.attrs && Array.isArray(projectDataSnapshot.attrs)) {
            projectAttrsLength = projectDataSnapshot.attrs.length;
          }

          setAutoCodeMsg(`Auto-coding project ${i + 1}/${projectsToAutocode.length}: ${projectName}…`);
          setProgress(10 + (i / projectsToAutocode.length) * 80);

          // Mark project as started with correct total
          setProjectProgress(prev => ({
            ...prev,
            [projectName]: { processed: 0, total: projectAttrsLength }
          }));

          try {
            const r = await autocodeAllStream(
              projectName,
              { all: true, save: false },
              (processed, total, _errors) => {
                setProjectProgress(prev => ({
                  ...prev,
                  [projectName]: { processed, total }
                }));
              },
            );

            const projectChangedFieldsByRow: Record<number, string[]> =
              ("changed_by_row" in r && r.changed_by_row) ? r.changed_by_row : {};
            const projectSourcesByRow: Record<number, Record<string, string>> =
              ("sources_by_row" in r && r.sources_by_row) ? r.sources_by_row : {};
            const projectOk = ("ok" in r ? r.ok : 0) || 0;
            const projectFail = ("fail" in r ? r.fail : 0) || 0;
            if ("errors" in r && r.errors && r.errors.length > 0) {
              errors.push(...r.errors);
            }

            // After all segments of this project are processed, use the returned in-memory rows
            try {
              const rows = ("updated_attributes" in r && r.updated_attributes) ? r.updated_attributes : null;
              if (rows) {
                const prevChanged = projectDataCache[projectName]?.changedFieldsByRow ?? {};
                const prevSources = projectDataCache[projectName]?.fieldSourcesByRow ?? {};
                const mergedChanged: Record<number, string[]> = { ...prevChanged };
                for (const [k, v] of Object.entries(projectChangedFieldsByRow)) {
                  const n = Number(k);
                  mergedChanged[n] = [...new Set([...(mergedChanged[n] ?? []), ...(v as string[])])];
                }
                const mergedSources: Record<number, Record<string, string>> = { ...prevSources };
                for (const [k, v] of Object.entries(projectSourcesByRow)) {
                  const n = Number(k);
                  mergedSources[n] = { ...(mergedSources[n] ?? {}), ...(v as Record<string, string>) };
                }
                updateProjectData(projectName, {
                  attrs: rows,
                  changedFieldsByRow: mergedChanged,
                  fieldSourcesByRow: mergedSources,
                  isDirty: true,
                });

                // Save metadata
                saveAutocodeMetadata(projectName, mergedChanged, mergedSources);


                // Update autocode baseline for this project
                try {
                  fetch(`/api/projects/${encodeURIComponent(projectName)}/baseline`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ rows })
                  });
                } catch (e) {
                }

                // Recalculate scores
                const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/score`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ attributes: rows }),
                });

                if (res.ok) {
                  const result = await res.json();
                  if (result.ok && Array.isArray(result.result_rows)) {
                    updateProjectData(projectName, {
                      scores: result.result_rows,
                    });
                  }
                }
              }
            } catch (e: any) {
            }

            // Update autocoded segment count for this project if autocode was successful
            if (projectOk > 0 && projectFail === 0) {
              updateAutocodedSegmentCount(projectName, projectAttrsLength);
            }

            totalProcessed += projectAttrsLength;
            totalSuccessful += projectOk;
            totalFailed += projectFail;
          } catch (e: any) {
            totalFailed += projectAttrsLength;
            errors.push({ projectName, reason: e?.message });
          }
        }

        setProgress(95);

        // Notify map of score updates
        window.dispatchEvent(new CustomEvent("psat:scores:updated"));

        setProgress(100);
        setAutoCodeMsg("Completed");

        // Show summary
        if (totalProcessed > 0) {
          toaster.create({
            title: "Auto-code (all projects) done",
            description: `Total: ${totalProcessed}, OK: ${totalSuccessful}, Failed: ${totalFailed}${totalFailed > 0 ? " (check console for details)" : ""}`,
            type: totalFailed > 0 ? "warning" : "success",
          });
        }
      } catch (e: any) {
        toaster.create({
          title: "Auto-code failed",
          description: String(e?.message ?? e),
          type: "error",
        });
      } finally {
        if (cleanupTimeoutRef.current !== null) {
          clearTimeout(cleanupTimeoutRef.current);
        }
        cleanupTimeoutRef.current = window.setTimeout(() => {
          clearAutoCodingState();
        }, 300);
      }
    };

    window.addEventListener("psat:autocode:all-projects", handler);
    return () => window.removeEventListener("psat:autocode:all-projects", handler);
  }, [projectList, projectData, updateAutocodedSegmentCount]);

  // Load project data
  useEffect(() => {
    if (!currentProjectName) return;

    // If already loaded, don't reload
    if (projectData[currentProjectName] && !projectData[currentProjectName].loading) {
      setImagesLoaded(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        updateProjectData(currentProjectName, { loading: true, error: null });

        const [d, a, gjson, metadata, autoMeta] = await Promise.all([
          fetchProjectDetail(currentProjectName),
          fetchProjectAttributes(currentProjectName) as Promise<AttributesResponse>,
          fetchProjectGeoJSON(currentProjectName) as Promise<FeatureCollection>,
          fetchProjectMetadata(currentProjectName).catch(() => null),
          fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/autocode-metadata`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        if (cancelled) return;


        const attributes = a?.rows ?? [];

        // Store original autocode values (baseline) for validation tracking
        // This is version 0 of the baseline - created when project is first loaded
        // IMPORTANT: Only create baseline if it doesn't exist - don't overwrite on subsequent loads
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/baseline`);
          const baselineData = await res.json();
          const baselineExists = baselineData?.rows && baselineData.rows.length > 0;

          // Only save baseline if it doesn't already exist
          if (!baselineExists) {
            const normalized = attributes.map(row => {
              const normalizedRow: AttributeRow = {};
              for (const [key, value] of Object.entries(row)) {
                if (value === null || value === undefined) {
                  normalizedRow[key] = value;
                } else if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
                  normalizedRow[key] = Number(value);
                } else {
                  normalizedRow[key] = value;
                }
              }
              return normalizedRow;
            });

            // Save baseline to server (version 0 - default values) only on first load
            fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/baseline`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rows: normalized })
            });
          }
        } catch {
        }

        // Start image preloading
        const uniqueRefs = new Set<string>();
        attributes.forEach(row => {
          const r = row as any;
          const ref = r["Image Reference"] ?? r["image"] ?? r["img"];
          if (ref) uniqueRefs.add(ref);
        });

        // Also check geoFeatures for image refs if not in attributes
        const features = gjson?.features || [];
        features.forEach((f: any) => {
          const p = f.properties || {};
          const ref = p["Image Reference"] ?? p["Image_Reference"] ?? p["image"] ?? p["img"];
          if (ref) uniqueRefs.add(ref);
        });

        const refList = Array.from(uniqueRefs);

        if (refList.length === 0) {
          setImagesLoaded(true);
        } else {
          let loadedCount = 0;
          // Cap concurrent requests if needed, but browser handles queueing.
          // Loop and fetch
          refList.forEach(ref => {
            const img = new Image();
            img.src = `/api/projects/${encodeURIComponent(currentProjectName)}/images/${encodeURIComponent(ref)}`;

            const onFinish = () => {
              loadedCount++;
              const pct = Math.round((loadedCount / refList.length) * 100);
              setImageLoadingProgress(pct);
              if (loadedCount >= refList.length) {
                setImagesLoaded(true);
              }
            };

            img.onload = onFinish;
            img.onerror = onFinish; // Don't block on error
          });
        }

        savedAttrsSnapshot[currentProjectName] = attributes;
        updateProjectData(currentProjectName, {
          detail: d ?? null,
          attrs: attributes,
          geoFeatures: gjson?.features ?? [],
          editedRow: null,
          verified: metadata?.verified ?? false,
          verifiedSegmentCount: metadata?.verified_segment_count ?? 0,
          autocodedSegmentCount: metadata?.autocoded_segment_count ?? 0,
          changedFieldsByRow: autoMeta?.changedFieldsByRow || {},
          fieldSourcesByRow: autoMeta?.fieldSourcesByRow || {},
          loading: false,
          isDirty: false,
        });
      } catch (e: any) {
        if (!cancelled) {
          updateProjectData(currentProjectName, {
            error: e?.message ?? "Unknown error",
            loading: false,
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [currentProjectName]);

  // Store baseline rows fetched from server
  const [baselineRows, setBaselineRows] = useState<AttributeRow[]>([]);
  const baselineRowsRef = useRef<AttributeRow[]>([]);

  // Fetch baseline from server when project changes
  useEffect(() => {
    if (!currentProjectName) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/baseline`);
        if (!res.ok) {
          setBaselineRows([]);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setBaselineRows(data.rows || []);
        }
      } catch (e) {
        setBaselineRows([]);
      }
    })();

    return () => { cancelled = true; };
  }, [currentProjectName]);

  // Keep ref in sync so async handlers can read the current baseline without stale closures
  useEffect(() => {
    baselineRowsRef.current = baselineRows;
  }, [baselineRows]);

  // Listen for baseline updates from autocode operations and refetch
  useEffect(() => {
    const handleBaselineUpdate = async () => {
      if (!currentProjectName) return;

      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/baseline`);
        if (!res.ok) {
          setBaselineRows([]);
          return;
        }
        const data = await res.json();
        setBaselineRows(data.rows || []);
      } catch (e) {
      }
    };

    window.addEventListener("psat:baseline:updated", handleBaselineUpdate);
    return () => {
      window.removeEventListener("psat:baseline:updated", handleBaselineUpdate);
    };
  }, [currentProjectName]);

  // Get original autocode values for current row
  const originalCurrentAttr = useMemo<AttributeRow | null>(() => {
    if (currentIndex < 0 || currentIndex >= baselineRows.length) return null;
    return baselineRows[currentIndex] || null;
  }, [currentIndex, baselineRows]);

  const presentDelineationTypeOptions = useMemo(() => {
    const projectValues = Array.from(new Set(
      Object.values(projectData)
        .flatMap((pd) => pd?.attrs ?? [])
        .flatMap((row) => {
          const v = row["Delineation Type"];
          if (!v) return [];
          return String(v).split(",").map((s) => s.trim()).filter(Boolean);
        })
    )).filter((v) => v !== "Absent" && v !== "In Poor Condition");
    return Array.from(new Set([...DELINEATION_PRESENT_SUGGESTIONS, ...projectValues])).sort();
  }, [projectData]);

  const foTypeOptions = useMemo(() => {
    const projectValues = Array.from(new Set(
      Object.values(projectData).flatMap((pd) => pd?.attrs ?? [])
        .flatMap((row) => {
          const v = row["FO Type"];
          if (!v) return [];
          return String(v).split(",").map((s) => s.trim()).filter(Boolean);
        })
    ));
    return Array.from(new Set([...FO_TYPE_SUGGESTIONS, ...projectValues])).sort();
  }, [projectData]);

  const nfoTypeOptions = useMemo(() => {
    const projectValues = Array.from(new Set(
      Object.values(projectData).flatMap((pd) => pd?.attrs ?? [])
        .flatMap((row) => {
          const v = row["NFO Type"];
          if (!v) return [];
          return String(v).split(",").map((s) => s.trim()).filter(Boolean);
        })
    ));
    return Array.from(new Set([...NFO_TYPE_SUGGESTIONS, ...projectValues])).sort();
  }, [projectData]);

  const slipperyIssueTypeOptions = useMemo(() => {
    const projectValues = Array.from(new Set(
      Object.values(projectData).flatMap((pd) => pd?.attrs ?? [])
        .flatMap((row) => {
          const v = row["Issue Type (Slippery)"];
          if (!v) return [];
          return String(v).split(",").map((s) => s.trim()).filter(Boolean);
        })
    ));
    return Array.from(new Set([...SLIPPERY_ISSUE_TYPE_SUGGESTIONS, ...projectValues])).sort();
  }, [projectData]);

  // Fetch width and curvature data when project or segment changes
  useEffect(() => {
    if (!currentProjectName || !currentFeature || currentFeature.geometry?.type !== "LineString") {
      setWidthData(null);
      setCurvData(null);
      return;
    }
    const coords = (currentFeature.geometry as LineString).coordinates as [number, number][];

    const widthController = new AbortController();
    const curvController = new AbortController();

    setWidthData(null);
    setCurvData(null);

    fetchWidthVisualization(currentProjectName, coords, currentIndex, widthController.signal)
      .then((data) => {
        if (!widthController.signal.aborted) setWidthData(data);
      })
      .catch((e) => {
        if (widthController.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      });

    fetchCurvatureVisualization(currentProjectName, coords, currentIndex, curvController.signal)
      .then((data) => {
        if (!curvController.signal.aborted) setCurvData(data);
      })
      .catch((e) => {
        if (curvController.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      });

    return () => {
      widthController.abort();
      curvController.abort();
    };
  }, [currentProjectName, currentIndex, currentFeature]);

  // Auto-calculate scores on project load
  useEffect(() => {
    if (!currentProjectName || attrs.length === 0) return;

    let isMounted = true;

    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectName)}/results`);
        if (!res.ok) {
          throw new Error("Failed to fetch results");
        }

        const data = await res.json();

        if (!data.ok || !Array.isArray(data.result_rows) || data.result_rows.length === 0) {
          let loadingToastId: string | undefined;

          if (isMounted) {
            loadingToastId = toaster.create({
              description: "Auto-calculating scores for all segments...",
              type: "loading",
            });
          }

          const result = await calculateScore(currentProjectName);

          if (isMounted && result.ok && Array.isArray(result.result_rows)) {
            if (loadingToastId) {
              toaster.dismiss(loadingToastId);
            }

            updateProjectData(currentProjectName, {
              scores: result.result_rows as any,
            });
            toaster.create({
              title: "Scores calculated",
              description: `Auto-calculated scores for ${result.result_rows.length} segments`,
              type: "success",
            });

            window.dispatchEvent(new CustomEvent("psat:scores:updated"));
          } else if (isMounted && loadingToastId) {
            toaster.dismiss(loadingToastId);
          }
        } else if (isMounted) {
          updateProjectData(currentProjectName, {
            scores: data.result_rows as any,
          });
        }
      } catch (e: any) {
      }
    })();

    return () => { isMounted = false; };
  }, [currentProjectName, attrs.length]);

  // Fetch attribute mappings (global, not per-project)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [map, customOpts] = await Promise.all([
          fetchAttributeMappings(),
          fetchCustomAttrOptions().catch(() => ({} as Record<string, string[]>)),
        ]);
        // Ensure "Line of Sight" always has a dropdown even if the backend hasn't been restarted
        if (!map["Line of Sight"]) {
          map["Line of Sight"] = { "1": "Adequate", "2": "Inadequate" };
        }
        // Merge custom sub-category options into mappings (identity key→label)
        for (const [field, opts] of Object.entries(customOpts)) {
          map[field] = Object.fromEntries(opts.map((o) => [o, o]));
        }
        if (!cancelled) {
          setCustomAttrOptions(customOpts);
          setAttrMappings(map);
        }
      } catch {
        if (!cancelled) setAttrMappings({ "Line of Sight": { "1": "Adequate", "2": "Inadequate" } });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleSaveOptions(field: string, options: string[]) {
    const updatedCustom = { ...customAttrOptions, [field]: options };
    setCustomAttrOptions(updatedCustom);
    setAttrMappings((prev) => ({
      ...prev,
      [field]: Object.fromEntries(options.map((o) => [o, o])),
    }));
  }

  // Reusable save function
  const saveAllProjects = useCallback(async (): Promise<boolean> => {
    if (projectList.length === 0) return true;

    try {
      // Only save projects that actually have unsaved changes
      const dirtyProjects = projectList.filter(projName => projectData[projName]?.isDirty);

      if (dirtyProjects.length > 0) {
        const savePromises = dirtyProjects.map(projName => {
          const projData = projectData[projName];
          if (!projData?.attrs) return Promise.resolve();

          const attrsAtSaveTime = projData.attrs;
          return Promise.all([
            saveAttributes(projName, attrsAtSaveTime),
            updateProject(projName, {
              autocoded_segment_count: projData.autocodedSegmentCount ?? 0,
              verified_segment_count: projData.verifiedSegmentCount ?? 0
            })
          ]).then(() => {
            savedAttrsSnapshot[projName] = attrsAtSaveTime;
          });
        });

        await Promise.all(savePromises);

        // Mark saved projects as clean
        dirtyProjects.forEach(projName => {
          updateProjectData(projName, { isDirty: false });
        });

        // Re-fetch scores for saved projects to reflect backend updates
        for (const projName of dirtyProjects) {
          try {
            const res = await fetch(`/api/projects/${encodeURIComponent(projName)}/results`);
            if (res.ok) {
              const result = await res.json();
              if (result.ok && result.result_rows) {
                updateProjectData(projName, { scores: result.result_rows });
              }
            }
          } catch (e) {
            // Ignore fetch error, user just won't see updated scores immediately
          }
        }
      }

      // Dispatch events to update Projects page for all projects (counts may have changed)
      projectList.forEach(projName => {
        const projData = projectData[projName];
        if (projData) {
          window.dispatchEvent(new CustomEvent("psat:verified:updated", {
            detail: { projectName: projName, verifiedSegmentCount: projData.verifiedSegmentCount ?? 0 }
          }));
          window.dispatchEvent(new CustomEvent("psat:autocoded:updated", {
            detail: { projectName: projName, autocodedSegmentCount: projData.autocodedSegmentCount ?? 0 }
          }));
        }
      });

      toaster.create({
        title: "Saved",
        description: dirtyProjects.length > 0
          ? `${dirtyProjects.length} project(s) saved successfully.`
          : "Nothing to save.",
        type: "success"
      });
      return true;

    } catch (e: any) {
      toaster.create({
        title: "Save failed",
        description: String(e?.message ?? e),
        type: "error"
      });
      return false;
    }
  }, [projectList, projectData]);

  // Save handler - saves all loaded projects (attributes + metadata)
  useEffect(() => {
    function handleSaveEvent() {
      saveAllProjects();
    }

    window.addEventListener("psat:save", handleSaveEvent);
    return () => window.removeEventListener("psat:save", handleSaveEvent);
  }, [saveAllProjects]);

  // Keep window.psat_hasUnsavedChanges in sync so Sidebar can skip the dialog when there are no real changes
  useEffect(() => {
    (window as any).psat_hasUnsavedChanges = projectList.some(projName => {
      const current = projectData[projName]?.attrs;
      const snapshot = savedAttrsSnapshot[projName];
      if (!current || !snapshot) return false;
      return JSON.stringify(current) !== JSON.stringify(snapshot);
    });
  }, [projectData, projectList]);

  // Revert all projects to their last-saved snapshot when the sidebar dispatches psat:discard
  useEffect(() => {
    function handleDiscard() {
      projectList.forEach(projName => {
        const snapshot = savedAttrsSnapshot[projName];
        if (snapshot) updateProjectData(projName, { attrs: snapshot, isDirty: false });
      });
    }
    window.addEventListener("psat:discard", handleDiscard);
    return () => window.removeEventListener("psat:discard", handleDiscard);
  }, [projectList]);

  // Update edited row when current row changes
  useEffect(() => {
    if (!currentProjectName) return;
    updateProjectData(currentProjectName, {
      editedRow: currentAttr ? { ...currentAttr } : null,
    });
  }, [currentAttr, currentProjectName]);

  // Handlers for attribute editing
  const onAttrChange = useCallback(
    (key: string, value: string | number | boolean | null) => {
      if (!currentProjectName) return;
      updateProjectData(currentProjectName, {
        editedRow: editedRow ? { ...editedRow, [key]: value } : null,
      });
    },
    [editedRow, currentProjectName]
  );

  const editCurrentAttr = (field: string, value: string | number | boolean | null) => {
    if (!currentProjectName || !attrs || !attrs[currentIndex]) return;

    const updatedRow = { ...attrs[currentIndex], [field]: value };

    updateProjectData(currentProjectName, {
      attrs: attrs.map((row, i) =>
        i === currentIndex ? updatedRow : row
      ),
      isDirty: true,
    });

    // Dispatch event to notify validation component of attribute change
    window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
      detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
    }));

    const currentIdx = currentIndex;

    if (scoreDebounceRef.current[currentIdx] !== undefined) {
      clearTimeout(scoreDebounceRef.current[currentIdx]);
    }

    scoreDebounceRef.current[currentIdx] = window.setTimeout(async () => {
      if (!currentProjectName) return;

      try {
        const newScore = await calculateScoreForRow(currentProjectName, updatedRow);

        updateProjectData(currentProjectName, {
          scores: scores.map((score, i) =>
            i === currentIdx
              ? { ...score, ...newScore }
              : score
          ),
        });

        window.dispatchEvent(new CustomEvent("psat:scores:updated"));
      } catch (e: any) {
      }
    }, 500);
  };

  // Intercept "Delineation" transitions to force Delineation Type selection
  const onEdit = useCallback((field: string, value: string | number | boolean | null) => {
    if (field === "Delineation") {
      const prevVal = attrs[currentIndex]?.["Delineation"];
      if (value === 2 && Number(prevVal) === 1) {
        // Present → Not Present: clear Delineation Type, then prompt for Absent/In Poor Condition
        if (!currentProjectName || !attrs || !attrs[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Delineation": value, "Delineation Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field: "Delineation", value }
        }));
        setPendingNotPresentDelineationChange(true);
        return;
      }
      if (value === 1 && Number(prevVal) === 2) {
        // Not Present → Present: atomically set Delineation=Present and clear Delineation Type,
        // then force category selection. Two separate editCurrentAttr calls would race on the
        // same stale attrs snapshot, causing the second write to overwrite the first.
        if (!currentProjectName || !attrs || !attrs[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Delineation": value, "Delineation Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field: "Delineation", value }
        }));
        setPendingPresentDelineationChange(true);
        return;
      }
    }
    // --- Fixed Obstacle on Facility ---
    if (field === "Fixed Obstacle on Facility") {
      const prevVal = attrs[currentIndex]?.["Fixed Obstacle on Facility"];
      if (value === 2 && Number(prevVal) === 1) {
        // Present → Not Present: null out FO Type atomically
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Fixed Obstacle on Facility": value, "FO Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        const currentIdx = currentIndex;
        if (scoreDebounceRef.current[currentIdx] !== undefined) clearTimeout(scoreDebounceRef.current[currentIdx]);
        scoreDebounceRef.current[currentIdx] = window.setTimeout(async () => {
          if (!currentProjectName) return;
          try {
            const newScore = await calculateScoreForRow(currentProjectName, updatedRow);
            updateProjectData(currentProjectName, {
              scores: scores.map((score, i) => i === currentIdx ? { ...score, ...newScore } : score),
            });
            window.dispatchEvent(new CustomEvent("psat:scores:updated"));
          } catch {}
        }, 500);
        return;
      }
      if (value === 1 && Number(prevVal) === 2) {
        // Not Present → Present: clear FO Type, force selection
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Fixed Obstacle on Facility": value, "FO Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        setPendingPresentFOChange(true);
        return;
      }
    }

    // --- Non-Fixed Obstacle on Facility ---
    if (field === "Non-Fixed Obstacle on Facility") {
      const prevVal = attrs[currentIndex]?.["Non-Fixed Obstacle on Facility"];
      if (value === 2 && Number(prevVal) === 1) {
        // Present → Not Present: null out NFO Type atomically
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Non-Fixed Obstacle on Facility": value, "NFO Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        const currentIdx = currentIndex;
        if (scoreDebounceRef.current[currentIdx] !== undefined) clearTimeout(scoreDebounceRef.current[currentIdx]);
        scoreDebounceRef.current[currentIdx] = window.setTimeout(async () => {
          if (!currentProjectName) return;
          try {
            const newScore = await calculateScoreForRow(currentProjectName, updatedRow);
            updateProjectData(currentProjectName, {
              scores: scores.map((score, i) => i === currentIdx ? { ...score, ...newScore } : score),
            });
            window.dispatchEvent(new CustomEvent("psat:scores:updated"));
          } catch {}
        }, 500);
        return;
      }
      if (value === 1 && Number(prevVal) === 2) {
        // Not Present → Present: clear NFO Type, force selection
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Non-Fixed Obstacle on Facility": value, "NFO Type": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        setPendingPresentNFOChange(true);
        return;
      }
    }

    // --- Loose or slippery surface ---
    if (field === "Loose or slippery surface") {
      const prevVal = attrs[currentIndex]?.["Loose or slippery surface"];
      if (value === 2 && Number(prevVal) === 1) {
        // Present → Not Present: null out Issue Type (Slippery) atomically
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Loose or slippery surface": value, "Issue Type (Slippery)": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        const currentIdx = currentIndex;
        if (scoreDebounceRef.current[currentIdx] !== undefined) clearTimeout(scoreDebounceRef.current[currentIdx]);
        scoreDebounceRef.current[currentIdx] = window.setTimeout(async () => {
          if (!currentProjectName) return;
          try {
            const newScore = await calculateScoreForRow(currentProjectName, updatedRow);
            updateProjectData(currentProjectName, {
              scores: scores.map((score, i) => i === currentIdx ? { ...score, ...newScore } : score),
            });
            window.dispatchEvent(new CustomEvent("psat:scores:updated"));
          } catch {}
        }, 500);
        return;
      }
      if (value === 1 && Number(prevVal) === 2) {
        // Not Present → Present: clear Issue Type (Slippery), force selection
        if (!currentProjectName || !attrs?.[currentIndex]) return;
        const updatedRow = { ...attrs[currentIndex], "Loose or slippery surface": value, "Issue Type (Slippery)": null };
        updateProjectData(currentProjectName, {
          attrs: attrs.map((row, i) => i === currentIndex ? updatedRow : row),
          isDirty: true,
        });
        window.dispatchEvent(new CustomEvent("psat:attribute:changed", {
          detail: { projectName: currentProjectName, rowIndex: currentIndex, field, value }
        }));
        setPendingPresentSlipperyChange(true);
        return;
      }
    }

    // --- Facility Width per Direction ---
    if (field === "Facility Width per Direction") {
      const codeStr = String(value);
      const dict = attrMappings["Facility Width per Direction"];
      const newCategoryLabel = dict?.[codeStr] ?? null;
      const subCategories = newCategoryLabel ? FACILITY_WIDTH_SUBCATEGORY_MAP[newCategoryLabel] : null;

      if (newCategoryLabel && subCategories) {
        const currentSubCat = (attrs[currentIndex]?.["Facility Width Sub-category"] as string | null) ?? null;
        const isCompatible = !!currentSubCat && subCategories.includes(currentSubCat);

        if (isCompatible) {
          editCurrentAttr(field, value);
          return;
        }

        const originalParentCode = (attrs[currentIndex]?.["Facility Width per Direction"] as string | number | null) ?? null;
        editCurrentAttrMany({
          "Facility Width per Direction": value,
          "Facility Width Sub-category": null,
        });
        setPendingFacilityWidthParentChange({
          categoryLabel: newCategoryLabel,
          subCategories,
          originalParentCode,
          originalSubCategory: currentSubCat,
        });
        return;
      }
    }

    const row = attrs[currentIndex];
    const { extraUpdates, notifications: logicNotifs } = applyLogicChecks(field, value, row ?? {});
    if (Object.keys(extraUpdates).length > 0) {
      editCurrentAttrMany({ [field]: value, ...extraUpdates });
    } else {
      editCurrentAttr(field, value);
    }
    const infoNotifs = logicNotifs.filter(n => !n.isWarning);
    const warnNotifs = logicNotifs.filter(n => n.isWarning);
    if (infoNotifs.length > 0) {
      toaster.create({
        title: "Logic check",
        description: infoNotifs.map(n => n.description).join(" · "),
        type: "info",
      });
    }
    for (const w of warnNotifs) {
      toaster.create({
        title: "Logic check warning",
        description: w.description,
        type: "warning",
      });
    }
  }, [attrs, currentIndex, editCurrentAttr, editCurrentAttrMany, attrMappings, currentProjectName, updateProjectData]);

  // Pagination
  const gotoPage = useCallback((page: number) => {
    if (len === 0 || !currentProjectName) return;
    const clamped = Math.min(Math.max(1, page), len);
    updateProjectData(currentProjectName, { currentPage: clamped });
  }, [len, currentProjectName]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    setSegmentInput(String(currentData.verifiedSegmentCount ?? 0));
  }, [currentData.verifiedSegmentCount]);

  useEffect(() => {
    setAutocodedSegmentInput(String(currentData.autocodedSegmentCount ?? 0));
  }, [currentData.autocodedSegmentCount]);

  const commitPage = useCallback(
    (valStr: string, isBlur = false) => {
      if (valStr.trim() === "" && !isBlur) return;
      const raw = valStr.trim() === "" ? 1 : Number(valStr);
      if (!Number.isFinite(raw)) return;
      const clamped = Math.min(Math.max(1, raw), len || 1);
      gotoPage(clamped);
      if (isBlur) setPageInput(String(clamped));
    },
    [gotoPage, len]
  );

  const commitSegment = useCallback(
    (valStr: string, isBlur = false) => {
      if (valStr.trim() === "" && !isBlur) return;
      const raw = valStr.trim() === "" ? 0 : Number(valStr);
      if (!Number.isFinite(raw)) return;
      const clamped = Math.max(0, Math.min(len || 0, raw));
      // Guard against infinite loop if value hasn't changed
      if (clamped === (currentData.verifiedSegmentCount ?? 0)) {
        if (isBlur) setSegmentInput(String(clamped));
        return;
      }
      updateVerifiedSegmentCount(currentProjectName!, clamped);
    },
    [currentProjectName, len, updateVerifiedSegmentCount, currentData.verifiedSegmentCount]
  );

  const commitAutocodedSegment = useCallback(
    (valStr: string, isBlur = false) => {
      if (valStr.trim() === "" && !isBlur) return;
      const raw = valStr.trim() === "" ? 0 : Number(valStr);
      if (!Number.isFinite(raw)) return;
      const clamped = Math.max(0, Math.min(len || 0, raw));
      // Guard against infinite loop if value hasn't changed
      if (clamped === (currentData.autocodedSegmentCount ?? 0)) {
        if (isBlur) setAutocodedSegmentInput(String(clamped));
        return;
      }
      updateAutocodedSegmentCount(currentProjectName!, clamped);
    },
    [currentProjectName, len, updateAutocodedSegmentCount, currentData.autocodedSegmentCount]
  );

  // Warn user before leaving the page (browser close, refresh, etc.)
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  if (projectList.length === 0) {
    return <Box p="4"><Text color="red.500">No projects selected.</Text></Box>;
  }

  if (!isShowingCodingGuide && (loading || !imagesLoaded)) {
    return (
      <Flex align="center" justify="center" h="60vh" direction="column" gap={4}>
        {loading ? (
          <>
            <Spinner size="lg" />
            <Text>Loading project data...</Text>
          </>
        ) : (
          <>
            <Text fontWeight="bold">Preloading Images...</Text>
            <Progress.Root value={imageLoadingProgress} maxW="300px" w="100%" colorPalette="blue">
              <Progress.Track>
                <Progress.Range />
              </Progress.Track>
              <Progress.ValueText>{imageLoadingProgress}%</Progress.ValueText>
            </Progress.Root>
            <Text fontSize="sm" color="gray.500">
              Please wait while we cache images for smooth navigation.
            </Text>
          </>
        )}
      </Flex>
    );
  }

  if (!isShowingCodingGuide && error) {
    return (
      <Box p="4">
        <Text color="red.500">Error: {error}</Text>
      </Box>
    );
  }

  // Show Coding Guide
  if (isShowingCodingGuide) {
    return (
      <Box p="4">
        <Flex gap="2" mb="4" wrap="wrap">
          {projectList.map((projectName) => {
            const projData = projectData[projectName];
            const projSegmentCount = projData?.attrs.length ?? 0;
            const isActive = activeTab === projectName;
            return (
              <Button
                key={projectName}
                onClick={() => setActiveTab(projectName)}
                variant={isActive ? "solid" : "outline"}
                colorPalette={isActive ? "blue" : "gray"}
                size="md"
              >
                {projectName} ({projSegmentCount})
              </Button>
            );
          })}
          <Button
            onClick={() => setActiveTab("coding-guide")}
            variant={isShowingCodingGuide ? "solid" : "outline"}
            colorPalette={isShowingCodingGuide ? "blue" : "gray"}
            size="md"
          >
            Coding Guide
          </Button>
          <Button
            onClick={() => window.open("https://irap.org/cyclerap/", "_blank", "noopener,noreferrer")}
            variant="outline"
            colorPalette="gray"
            size="md"
          >
            CycleRAP
          </Button>
        </Flex>
        <Box
          borderWidth="1px"
          borderColor="gray.200"
          borderRadius="md"
          overflow="hidden"
          h="calc(100vh - 150px)"
        >
          <iframe
            src="/PSAT coding sheetMay26.pdf"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
            }}
            title="Coding Guide PDF"
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box p="4">
      {autoCoding && (
        <Portal>
          <Box
            position="fixed"
            inset={0}
            bg="blackAlpha.400"
            backdropFilter="blur(2px)"
            zIndex={1000}
            aria-busy="true"
          >
            <Progress.Root
              value={progress}
              min={0}
              max={100}
              orientation="horizontal"
              colorPalette="blue"
              variant="subtle"
              size="sm"
              position="absolute"
              top={0}
              left={0}
              right={0}
              zIndex={1001}
            >
              <Progress.Track>
                <Progress.Range />
              </Progress.Track>
            </Progress.Root>

            <Flex minH="100vh" align="center" justify="center" p="4">
              <Card.Root shadow="lg" borderRadius="2xl" maxW="md" w="full">
                <CardBody>
                  <Flex direction="column" gap="4">
                    <Flex align="center" gap="3">
                      <Spinner />
                      <Box>
                        <Text fontWeight="bold">Auto-coding…</Text>
                        <Text fontSize="sm" color="gray.600">
                          {autoCodeMsg || "Please wait while models run."}
                        </Text>
                      </Box>
                    </Flex>

                    {Object.entries(projectProgress).length > 0 && (
                      <Flex direction="column" gap="3">
                        {Object.entries(projectProgress).map(([projectName, { processed, total }]) => (
                          <Box key={projectName}>
                            <Flex justify="space-between" mb="2" align="center">
                              <Text fontSize="sm" fontWeight="medium">{projectName}</Text>
                              <Text fontSize="xs" color="gray.600">{processed}/{total}</Text>
                            </Flex>
                            <Progress.Root
                              value={total > 0 ? (processed / total) * 100 : 0}
                              min={0}
                              max={100}
                              colorPalette="blue"
                              size="sm"
                            >
                              <Progress.Track>
                                <Progress.Range />
                              </Progress.Track>
                            </Progress.Root>
                          </Box>
                        ))}
                      </Flex>
                    )}
                  </Flex>
                </CardBody>
              </Card.Root>
            </Flex>
          </Box>
        </Portal>
      )}

      <Flex gap="2" mb="4" wrap="wrap">
        {projectList.map((projectName) => {
          const projData = projectData[projectName];
          const projSegmentCount = projData?.attrs.length ?? 0;
          const isActive = activeTab === projectName;
          return (
            <Button
              key={projectName}
              onClick={() => setActiveTab(projectName)}
              variant={isActive ? "solid" : "outline"}
              colorPalette={isActive ? "blue" : "gray"}
              size="md"
            >
              {projectName} ({projSegmentCount})
            </Button>
          );
        })}
        <Button
          onClick={() => setActiveTab("coding-guide")}
          variant={isShowingCodingGuide ? "solid" : "outline"}
          colorPalette={isShowingCodingGuide ? "blue" : "gray"}
          size="md"
        >
          Coding Guide
        </Button>
        <Button
          onClick={() => window.open("https://irap.org/cyclerap/", "_blank", "noopener,noreferrer")}
          variant="outline"
          colorPalette="gray"
          size="md"
        >
          CycleRAP
        </Button>

        {location.state?.returnToAnalysis && (
          <Button
            ml="auto"
            variant="ghost"
            colorPalette="blue"
            size="sm"
            onClick={() => {
              const anyChanges = projectList.some(projName => {
                const current = projectData[projName]?.attrs;
                const snapshot = savedAttrsSnapshot[projName];
                if (!current || !snapshot) return false;
                return JSON.stringify(current) !== JSON.stringify(snapshot);
              });
              if (anyChanges) {
                setIsSaveDialogOpen(true);
              } else {
                toaster.create({ title: "No changes to save.", type: "info" });
                window.history.back();
              }
            }}
          >
            ← Back to Path Analysis
          </Button>
        )}

        <ExitConfirmationDialog
          open={isSaveDialogOpen}
          onCancel={() => setIsSaveDialogOpen(false)}
          onDiscardAndExit={() => {
            setIsSaveDialogOpen(false);
            // Revert each project's attrs back to the last-saved snapshot so that
            // if the user navigates back to CodingPage the stale edits are gone.
            projectList.forEach(projName => {
              const snapshot = savedAttrsSnapshot[projName];
              if (snapshot) {
                updateProjectData(projName, { attrs: snapshot, isDirty: false });
              }
            });
            toaster.create({ title: "Changes discarded.", type: "info" });
            window.history.back();
          }}
          onSaveAndExit={async () => {
            setIsSaving(true);
            const success = await saveAllProjects();
            setIsSaving(false);
            if (success) {
              setIsSaveDialogOpen(false);
              window.history.back();
            }
          }}
          isSaving={isSaving}
        />
      </Flex>

      <Flex justify="space-between" align="center" mb="3">
        <Flex align="center" gap="3">
          <Box>
            <Text fontSize="lg" fontWeight="bold">{detail?.name ?? currentProjectName}</Text>
            {detail?.latest && (
              <Text fontSize="sm" color="gray.600">Latest version: {detail.latest}</Text>
            )}
          </Box>
          <Flex align="center" gap="2">
            <Text fontSize="sm" fontWeight="bold">Segments Verified:</Text>
            <NumberInput.Root
              maxW="80px"
              min={0}
              max={len || 0}
              value={segmentInput}
              onValueChange={(e) => setSegmentInput(e.value)}
            >
              <NumberInput.Control />
              <NumberInput.Input
                placeholder="0"
                onBlur={() => commitSegment(segmentInput, true)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.currentTarget.blur();
                  }
                }}
              />
            </NumberInput.Root>
            <span style={{ fontSize: "18px", minWidth: "50px" }}>
              {len > 0
                ? `${((currentData.verifiedSegmentCount ?? 0) / len * 100).toFixed(1)}%`
                : "0%"}
            </span>
          </Flex>

          <Flex align="center" gap="2">
            <Text fontSize="sm" fontWeight="bold">Segments Autocoded:</Text>
            <NumberInput.Root
              maxW="80px"
              min={0}
              max={len || 0}
              value={autocodedSegmentInput}
              onValueChange={(e) => setAutocodedSegmentInput(e.value)}
            >
              <NumberInput.Control />
              <NumberInput.Input
                placeholder="0"
                onBlur={() => commitAutocodedSegment(autocodedSegmentInput, true)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.currentTarget.blur();
                  }
                }}
              />
            </NumberInput.Root>
            <span style={{ fontSize: "18px", minWidth: "50px" }}>
              {len > 0
                ? `${((currentData.autocodedSegmentCount ?? 0) / len * 100).toFixed(1)}%`
                : "0%"}
            </span>
          </Flex>
        </Flex>

        <Flex align="center" gap="3">
          <Text fontSize="sm" color="gray.600">
            {len > 0 ? `${currentPage} / ${len}` : "0 / 0"}
          </Text>

          <NumberInput.Root
            maxW="120px"
            min={1}
            max={len || 1}
            value={pageInput}
            onValueChange={(e) => {
              const val = e.value.replace(/^0+/, "");
              setPageInput(val);
            }}
          >
            <NumberInput.Control />
            <NumberInput.Input
              onBlur={() => commitPage(pageInput, true)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.currentTarget.blur();
                }
              }}
            />
          </NumberInput.Root>
        </Flex>
      </Flex>

      <Grid
        templateColumns={{ base: "1fr", md: "2fr 1fr" }}
        gap="16px"
      >
        <GridItem
          display="flex"
          flexDirection="column"
          minH={`${PANEL_HEIGHT}px`}
          gap="4"
        >
          <Box
            bg="white"
            borderRadius="md"
            p="1"
            borderWidth="1px"
            borderColor="gray.200"
            _dark={{ bg: "gray.800", borderColor: "gray.600" }}
            flexShrink={0}
          >
            <SegmentScoresCard
              scores={scores[currentIndex] || null}
              projectContributors={projectContributors}
              onContributorClick={handleContributorClick}
            />
          </Box>

          <Box flex="1" minH={0}>
            <ImagePanel
              projectName={currentProjectName!}
              imageRef={imgRef}
              panelHeight={PANEL_HEIGHT}
            />
          </Box>

          <Flex
            flex="0 0 auto"
            h="56px"
            w="100%"
            minW={0}
            align="center"
            gap="4"
            pt="0"
            position="relative"
            zIndex={1}
            bg="bg"
          >
            <Button
              flex="1"
              minW={0}
              size="sm"
              variant="outline"
              onClick={() => gotoPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              Previous
            </Button>

            {cameFromPathAnalysis && (
              <Button
                flex="1"
                minW={0}
                size="sm"
                colorPalette="green"
                variant={currentSegmentVerified ? "solid" : "outline"}
                onClick={toggleCurrentSegmentVerified}
                title={currentSegmentVerified ? "Click to unmark this segment" : "Mark this segment as reviewed"}
              >
                {currentSegmentVerified ? "✓ Verified" : "Mark Verified"}
              </Button>
            )}

            <Button
              flex="1"
              minW={0}
              size="sm"
              variant="solid"
              onClick={() => gotoPage(currentPage + 1)}
              disabled={currentPage >= len}
            >
              Next
            </Button>
          </Flex>
        </GridItem>

        <GridItem
          display="flex"
          flexDirection="column"
          gap="4"
        >
          <Box flex="1" minH={0} display="flex" flexDirection="column">
            <AttributesPanel
              row={currentAttr}
              originalRow={originalCurrentAttr}
              mappings={attrMappings}
              panelHeight={undefined} // Let it fill the parent
              flex={1}
              onChange={onAttrChange}
              onEdit={onEdit}
              changedFields={changedFieldsByRow[currentIndex] || []}
              fieldSources={fieldSourcesByRow[currentIndex] || {}}
              highlightColor="yellow"
              activeGroupTab={activeAttributeGroupTab}
              onEditOptions={(field) => {
                const raw = currentAttr?.[field];
                let currentValue = raw != null ? String(raw) : null;
                if (field === "Issue Type (Slippery)" && !currentValue) {
                  currentValue = "Algae";
                }
                const delineationVal = currentAttr?.["Delineation"];
                const delineationNotPresent = field === "Delineation Type"
                  && (delineationVal === 2 || delineationVal === "2");
                setEditingOptions({ field, currentValue, delineationNotPresent });
              }}
            />
          </Box>
        </GridItem>

        <GridItem colSpan={{ base: 1, md: 2 }}>
          <GeoDataPanel
            projectName={currentProjectName!}
            feature={
              geoFeatures[currentIndex]?.geometry?.type === "LineString"
                ? (geoFeatures[currentIndex] as any)
                : null
            }
            index={currentIndex}
            onJump={(i) => gotoPage(i + 1)}
            scores={scores}
            filterContext={filterContext}
            verifiedByProject={cameFromPathAnalysis ? verifiedByProject : undefined}
            onDataChange={refreshCurrentProject}
            curvData={curvData}
            widthM={widthData?.width ?? null}
            grade={(currentAttr?.["Grade"] as number | null) ?? null}
            gradientPct={(currentAttr?.["Gradient %"] as number | null) ?? null}
            gradientStatus={(currentAttr?.["Gradient Status"] as string | null) ?? null}
            showCurvatureOverlay={showCurvatureOverlay}
            onToggleCurvatureOverlay={() => setShowCurvatureOverlay(v => !v)}
          />
        </GridItem>

        <GridItem colSpan={{ base: 1, md: 2 }}>
          <AutocodeValidation
            projectName={currentProjectName!}
            attributes={attrs}
            panelHeight={350}
          />
        </GridItem>
      </Grid>

      <AttributeOptionsDialog
        open={editingOptions !== null}
        onClose={() => setEditingOptions(null)}
        fieldName={editingOptions?.field ?? ""}
        currentValue={editingOptions?.currentValue ?? null}
        delineationNotPresent={editingOptions?.delineationNotPresent}
        singleSelect={
          editingOptions?.field === "Facility Width Sub-category" ||
          editingOptions?.field === "Crossing Type" ||
          editingOptions?.field === "Curvature Sub-category"
        }
        facilityWidthConfirm={
          editingOptions?.field === "Facility Width Sub-category"
            ? {
                oldSubCategory: editingOptions.currentValue ?? null,
                oldCategory: getParentCategoryForSubcat(editingOptions.currentValue),
                getNewCategory: (tag) => getParentCategoryForSubcat(tag),
              }
            : undefined
        }
        onSetValue={(val) => {
          if (!editingOptions) return;
          if (editingOptions.field === "Facility Width Sub-category" && val) {
            const newParent = getParentCategoryForSubcat(val);
            if (newParent) {
              const dict = attrMappings["Facility Width per Direction"] ?? {};
              const entry = Object.entries(dict).find(([, label]) => label === newParent);
              const rawCode = entry?.[0];
              const code = rawCode !== undefined
                ? (isNaN(Number(rawCode)) ? rawCode : Number(rawCode))
                : null;
              editCurrentAttrMany({
                "Facility Width Sub-category": val,
                ...(code !== null ? { "Facility Width per Direction": code } : {}),
              });
              return;
            }
          }
          editCurrentAttr(editingOptions.field, val);
        }}
        options={editingOptions
          ? Array.from(
            new Set(
              Object.values(projectData)
                .flatMap((pd) => pd?.attrs ?? [])
                .flatMap((row) => {
                  const v = row[editingOptions.field];
                  if (v == null || String(v).trim() === "") return [];
                  // Split by comma to get individual values, not combined permutations
                  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
                })
            )
          ).sort()
          : []}
        onSave={handleSaveOptions}
        onSetParentNotPresent={
          editingOptions?.field === "FO Type"
            ? () => onEdit("Fixed Obstacle on Facility", 2)
            : editingOptions?.field === "NFO Type"
            ? () => onEdit("Non-Fixed Obstacle on Facility", 2)
            : editingOptions?.field === "Delineation Type" && !editingOptions?.delineationNotPresent
            ? () => onEdit("Delineation", 2)
            : editingOptions?.field === "Issue Type (Slippery)"
            ? () => onEdit("Loose or slippery surface", 2)
            : editingOptions?.field === "Crossing Type"
            ? () => onEdit("Crossing Facility", 2)
            : undefined
        }
      />


      {/* Forced delineation type selection — shown when user switches Delineation Not Present→Present */}
      <PresentMultiTagModal
        open={pendingPresentDelineationChange}
        title="Select Delineation Type"
        description='Delineation was set to "Present". Please select the type(s) that apply:'
        options={presentDelineationTypeOptions}
        onConfirm={(val) => {
          editCurrentAttr("Delineation Type", val);
          setPendingPresentDelineationChange(false);
        }}
      />
      <PresentMultiTagModal
        open={pendingNotPresentDelineationChange}
        singleSelect
        title="Set Delineation Condition"
        description='Delineation was set to "Not Present". Is it Absent or In Poor Condition?'
        options={["Absent", "In Poor Condition"]}
        onConfirm={(val) => {
          editCurrentAttr("Delineation Type", val);
          setPendingNotPresentDelineationChange(false);
        }}
      />
      <PresentMultiTagModal
        open={pendingPresentFOChange}
        title="Select FO Type"
        description='Fixed Obstacle was set to "Present". Please select the type(s) that apply:'
        options={foTypeOptions}
        onConfirm={(val) => {
          editCurrentAttr("FO Type", val);
          setPendingPresentFOChange(false);
        }}
      />
      <PresentMultiTagModal
        open={pendingPresentNFOChange}
        title="Select NFO Type"
        description='Non-Fixed Obstacle was set to "Present". Please select the type(s) that apply:'
        options={nfoTypeOptions}
        onConfirm={(val) => {
          editCurrentAttr("NFO Type", val);
          setPendingPresentNFOChange(false);
        }}
      />
      <PresentMultiTagModal
        open={pendingPresentSlipperyChange}
        title="Select Issue Type (Slippery)"
        description='"Loose or slippery surface" was set to "Present". Please select the issue type(s) that apply:'
        options={slipperyIssueTypeOptions}
        onConfirm={(val) => {
          editCurrentAttr("Issue Type (Slippery)", val);
          setPendingPresentSlipperyChange(false);
        }}
      />
      <PresentMultiTagModal
        open={pendingFacilityWidthParentChange !== null}
        singleSelect
        title="Select Facility Width Sub-category"
        description={`Facility Width was set to "${pendingFacilityWidthParentChange?.categoryLabel}". Please select the specific sub-category:`}
        options={pendingFacilityWidthParentChange?.subCategories ?? []}
        onConfirm={(val) => {
          editCurrentAttrMany({ "Facility Width Sub-category": val });
          setPendingFacilityWidthParentChange(null);
        }}
        onCancel={() => {
          if (pendingFacilityWidthParentChange) {
            editCurrentAttrMany({
              "Facility Width per Direction": pendingFacilityWidthParentChange.originalParentCode,
              "Facility Width Sub-category": pendingFacilityWidthParentChange.originalSubCategory,
            });
          }
          setPendingFacilityWidthParentChange(null);
        }}
      />
    </Box>
  );
}
