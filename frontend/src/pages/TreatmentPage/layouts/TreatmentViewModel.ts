/**
 * Typed seam between the Treatment container (`treatmentDetailPage.tsx`) and the
 * V1 / V2 layout shells. The container assembles ONE of these objects and passes
 * it to whichever shell `useUiVersion()` selects; both shells consume the
 * identical contract. The shell is a pure function of this object — it never
 * fetches, owns server state, or touches sessionStorage.
 */
import type { Feature } from "geojson";
import type { AttributeRow, CodingFilterContext } from "../../../api";
import type { Treatment, ScoreType, CopyButtonState } from "../treatmentConstants";
import type { CurvatureVisualizationResponse } from "../../../api/curvatureVisualization";

export interface TreatmentViewModel {
  // ── load / error gating ──
  projectNames: string[];
  loading: boolean;
  error: string | null;

  // ── aggregated data ──
  attrs: AttributeRow[];
  geoFeatures: Feature[];
  scores: Record<string, any>[];
  afterTreatmentScores: Record<string, any>[];
  len: number;

  // ── project scope / tabs ──
  activeProject: string;
  isAllScope: boolean;
  scope: { start: number; count: number };
  panKey: number;
  currentCtx: { name: string; localIndex: number } | null;
  // ── current-segment map metrics (Curv./Width/Grade readouts) ──
  curvData: CurvatureVisualizationResponse | null;
  widthM: number | null;
  grade: number | null;
  gradientPct: number | null;
  gradientStatus: string | null;
  onSelectAllProjects(): void;
  onSelectProject(name: string): void;
  getProjectSegmentCount(name: string): number;

  // ── pagination (scope-relative display) ──
  currentIndex: number;
  currentPage: number;
  scopePage: number;
  scopeTotal: number;
  pageIndices: number[];
  pageInput: string;
  setPageInput(v: string): void;
  commitPage(v: string): void;
  gotoPage(page: number): void;

  // ── current segment image ──
  imgRef?: string;
  currentImageUrl: string | null;

  // ── treatment options list ──
  accordionView: "segment" | "treatment";
  setAccordionView(v: "segment" | "treatment"): void;
  effectivenessLoading: boolean;
  allApplicableTreatments: Treatment[];
  effectivenessCounts: Record<number, number>;
  applicableCounts: Record<number, number>;
  segmentScoreDrops: Record<number, number>;
  fullyAppliedTreatments: Set<number>;

  // ── selection / apply ──
  selectedTreatments: Set<number>;
  setSelectedTreatments(s: Set<number>): void;
  treatmentState: Record<number, { applied: boolean; treatment_ids: number[]; after_scores: ScoreType | null }>;
  applyLoading: boolean;
  hasApplied: boolean;
  hasSelected: boolean;
  appliedTreatmentIds: number[];
  onApplyTreatments(): void;
  onResetTreatments(): void;

  // ── auto-save (segment view) ──
  autoSaveStatus: "idle" | "saving" | "saved";
  scheduleSegmentSave(ids: number[]): void;

  // ── copy actions ──
  copyButtonState: CopyButtonState;
  copyButtonLabel: string;
  imageCopyButtonState: CopyButtonState;
  imageCopyButtonLabel: string;
  onCopyTreatmentPrompt(ids: number[]): void;
  onCopyCurrentImage(): void;

  // ── attributes panel ──
  showPostTreatment: boolean;
  setShowPostTreatment(v: boolean): void;
  segmentHasTreatments: boolean;
  modifiedAttrs: AttributeRow | null;
  changedAttributes: Set<string>;
  changedFieldSources: Record<string, string>;
  attrMappings: Record<string, Record<string, string>>;
  activeAttributeGroupTab: string | null;
  onContributorClick(name: string): void;

  // ── crash-type scores card ──
  // true only in the bulk "by treatment" view's staged (unsaved) selection
  isStagingPreview: boolean;
  previewScores: ScoreType | null;
  previewLoading: boolean;
  projectContributors: { projectName: string; contributors: Array<{ name: string; contribution: number }> } | null;

  // ── filter context (for before/after maps in filter mode) ──
  mapFilterContext: CodingFilterContext | null;
  filterMode: boolean;

  // ── overall analysis (bottom) ──
  beforeBandCounts: {
    VB: Record<number, number>; BB: Record<number, number>; SB: Record<number, number>;
    BP: Record<number, number>; Overall: Record<number, number>;
  };
  afterBandCounts: {
    VB: Record<number, number>; BB: Record<number, number>; SB: Record<number, number>;
    BP: Record<number, number>; Overall: Record<number, number>;
  };

  // ── apply-to-all confirm dialog (By Treatment) ──
  openConfirmAlert: boolean;
  setOpenConfirmAlert(v: boolean): void;
  onConfirmApplyToAll(): void;

  // ── navigation ──
  onBack(): void;
  // True when the page was opened from Path Analysis (shows the "← Back to Path
  // Analysis" link, which returns to the prior Path Analysis view with its
  // filters/viewport preserved via browser history).
  cameFromPathAnalysis: boolean;
  onBackToAnalysis(): void;

  // ════════ v2-only page actions (on-canvas; v1 has these in the sidebar) ════════
  effectivenessLabel: string;          // e.g. "28%"
  improvedSegmentCount: number;        // # of in-scope segments improved
  onResetAll(): void;                  // opens the reset-all confirm
  onSaveAll(): void;
  onGenerateReport(): void;
  hasSavedReport: boolean;
  isSavingAll: boolean;
  // reset-all confirm dialog
  resetAllConfirmOpen: boolean;
  onConfirmResetAll(): void;
  onCancelResetAll(): void;
  isResettingAll: boolean;
}
