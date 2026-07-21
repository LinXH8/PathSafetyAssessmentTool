import type { Dispatch, SetStateAction } from "react";
import type { AttributeRow, CodingFilterContext } from "../../../api";
import type { WidthVisualizationResponse } from "../../../api/widthVisualization";
import type { CurvatureVisualizationResponse } from "../../../api/curvatureVisualization";
import type { ProjectDetail, AttrMappings, ProjectDataState } from "../codingConstants";

/**
 * The seam between the Coding container (codingPage.tsx — data fetch, hooks,
 * sessionStorage/cache contracts, all callbacks) and its layout shells
 * (CodingLayoutV1 / CodingLayoutV2). The container assembles ONE of these and
 * passes it to whichever shell is active. Both shells consume the identical
 * props. Nothing component-internal lives here — no fetch, no server state, no
 * sessionStorage. See temp/UI_V2_REDESIGN_GUIDE.md §3.
 */

export type PendingFacilityWidthParentChange = {
  categoryLabel: string;
  subCategories: string[];
  originalParentCode: string | number | null;
  originalSubCategory: string | null;
};

export type EditingOptions = {
  field: string;
  currentValue: string | null;
  delineationNotPresent?: boolean;
};

export interface CodingViewModel {
  // ── tabs / project list ──
  projectList: string[];
  projectData: Record<string, ProjectDataState>;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isShowingCodingGuide: boolean;
  currentProjectName: string | null;

  // ── load / error gating ──
  loading: boolean;
  error: string | null;
  imagesLoaded: boolean;
  imageLoadingProgress: number;

  // ── auto-coding overlay ──
  autoCoding: boolean;
  progress: number;
  autoCodeMsg: string;
  projectProgress: Record<string, { processed: number; total: number }>;

  // ── current segment / project data ──
  detail: ProjectDetail | null;
  currentData: ProjectDataState;
  attrs: AttributeRow[];
  scores: any[];
  geoFeatures: import("geojson").Feature[];
  currentIndex: number;
  currentPage: number;
  len: number;
  currentAttr: AttributeRow | null;
  originalCurrentAttr: AttributeRow | null;
  imgRef: string | undefined;
  changedFieldsByRow: Record<number, string[]>;
  fieldSourcesByRow: Record<number, Record<string, string>>;
  attrMappings: AttrMappings;

  // ── segment / autocoded count inputs ──
  segmentInput: string;
  setSegmentInput: (value: string) => void;
  commitSegment: (valStr: string, isBlur?: boolean) => void;
  autocodedSegmentInput: string;
  setAutocodedSegmentInput: (value: string) => void;
  commitAutocodedSegment: (valStr: string, isBlur?: boolean) => void;

  // ── pagination ──
  pageInput: string;
  setPageInput: (value: string) => void;
  commitPage: (valStr: string, isBlur?: boolean) => void;
  gotoPage: (page: number) => void;

  // ── scores card ──
  projectContributors: { projectName: string; contributors: any } | null;
  handleContributorClick: (name: string) => void;
  activeAttributeGroupTab: string | null;

  // ── path-analysis review flow ──
  cameFromPathAnalysis: boolean;
  currentSegmentVerified: boolean;
  toggleCurrentSegmentVerified: () => void;
  verifiedByProject: Record<string, number[]>;
  filterContext: CodingFilterContext | null;
  returnToAnalysis: boolean;
  onBackToAnalysis: () => void;
  onDiscardAndExit: () => void;
  onSaveAndExit: () => Promise<void>;
  isSaveDialogOpen: boolean;
  setIsSaveDialogOpen: (open: boolean) => void;
  isSaving: boolean;

  // ── attribute editing ──
  onAttrChange: (key: string, value: string | number | boolean | null) => void;
  onEdit: (field: string, value: string | number | boolean | null) => void;
  editCurrentAttr: (field: string, value: string | number | boolean | null) => void;
  editCurrentAttrMany: (updates: Record<string, string | number | boolean | null>) => void;

  // ── analysis overlays (width / curvature) ──
  widthData: WidthVisualizationResponse | null;
  curvData: CurvatureVisualizationResponse | null;
  showCurvatureOverlay: boolean;
  setShowCurvatureOverlay: Dispatch<SetStateAction<boolean>>;
  refreshCurrentProject: () => Promise<void>;

  // ── attribute-options dialog ──
  editingOptions: EditingOptions | null;
  setEditingOptions: (value: EditingOptions | null) => void;
  handleSaveOptions: (field: string, options: string[]) => void;

  // ── forced multi-tag selection modals ──
  presentDelineationTypeOptions: string[];
  foTypeOptions: string[];
  nfoTypeOptions: string[];
  slipperyIssueTypeOptions: string[];
  defectTypeOptions: string[];
  pendingPresentDelineationChange: boolean;
  setPendingPresentDelineationChange: (value: boolean) => void;
  pendingNotPresentDelineationChange: boolean;
  setPendingNotPresentDelineationChange: (value: boolean) => void;
  pendingPresentFOChange: boolean;
  setPendingPresentFOChange: (value: boolean) => void;
  pendingPresentNFOChange: boolean;
  setPendingPresentNFOChange: (value: boolean) => void;
  pendingPresentSlipperyChange: boolean;
  setPendingPresentSlipperyChange: (value: boolean) => void;
  pendingPresentDefectChange: boolean;
  setPendingPresentDefectChange: (value: boolean) => void;
  pendingFacilityWidthParentChange: PendingFacilityWidthParentChange | null;
  setPendingFacilityWidthParentChange: (value: PendingFacilityWidthParentChange | null) => void;
}
