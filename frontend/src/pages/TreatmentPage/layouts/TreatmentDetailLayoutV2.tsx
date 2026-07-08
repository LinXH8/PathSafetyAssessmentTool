/**
 * Treatment Application — V2 layout shell. Translated from
 * `temp/psat-design/Treatment Application.dc.html` (+ the `ta-final` screenshot)
 * to Chakra/React + DESIGN_GUIDE.md, made fluid. Route-specific page actions
 * (Treat All / Reset All / Save / Generate Report / Exit) live on-canvas here per
 * the redesign's core idea — the v1 sidebar TreatmentSidebar is dropped in v2.
 *
 * Pure presentation: a function of `TreatmentViewModel`. No fetch / server state.
 */
import { type CSSProperties, type ReactNode, useState } from "react";
import { Box, Flex, Spinner, Text, Dialog, Portal, Button, CloseButton } from "@chakra-ui/react";
import { LuCheck } from "react-icons/lu";
import type { Feature, LineString } from "geojson";

import ImagePanel from "../../CodingPage/components/ImagePanel";
import GeoDataPanel from "../../CodingPage/components/GeoDataPanel";
import AttributesPanel from "../../CodingPage/components/AttributesPanel";
import PostTreatmentImageUpload from "../components/PostTreatmentImageUpload";
import ResetConfirmationDialog from "../../sidebar/components/ResetConfirmationDialog";
import { RISK_BAND_COLORS } from "../../../components/visualization/scoreband/colorConstants";
import { FONT, COLOR, RADIUS } from "../../../features/ui/designTokens";
import { V2Segmented, V2Switch, v2TabStyle, v2TabRowStyle, DistTooltipBox } from "../../PathAnalysisPage/components/paV2Primitives";

import iconBB from "../../../../CycleRAP Assets/BB.png";
import iconBP from "../../../../CycleRAP Assets/BP.png";
import iconSB from "../../../../CycleRAP Assets/SB.png";
import iconVB from "../../../../CycleRAP Assets/VB.png";

import {
  TREATMENTS,
  getApplicableTreatments,
  type Treatment,
} from "../treatmentConstants";
import type { TreatmentViewModel } from "./TreatmentViewModel";

// Fluid map height: 30.7vh = 280px at the 911px reference viewport, clamped so the
// well stays usable on very short/tall screens. GeoDataPanel accepts CSS strings.
const MAP_H = "clamp(11.25rem, 30.7vh, 20rem)";

// ───────────────────────── small presentational helpers ─────────────────────────

type BtnKind = "blue" | "teal" | "dark" | "danger" | "ghost";

function V2Btn({
  kind,
  children,
  onClick,
  disabled,
  loading,
  flex,
  width,
}: {
  kind: BtnKind;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  flex?: string | number;
  width?: string | number;
}) {
  const palette: Record<BtnKind, { bg: string; fg: string; border?: string }> = {
    blue: { bg: COLOR.blue, fg: COLOR.white },
    teal: { bg: COLOR.teal, fg: COLOR.white },
    dark: { bg: COLOR.gray800, fg: COLOR.white },
    danger: { bg: COLOR.danger, fg: COLOR.white },
    ghost: { bg: "transparent", fg: COLOR.text, border: COLOR.borderInput },
  };
  const p = palette[kind];
  const isOff = disabled || loading;
  return (
    <button
      onClick={onClick}
      disabled={isOff}
      style={{
        height: "2.5rem",
        padding: "0 1rem",
        flex,
        width,
        background: isOff ? COLOR.gray100 : p.bg,
        color: isOff ? COLOR.gray400 : p.fg,
        border: isOff
          ? `1px solid ${COLOR.border}`
          : p.border
            ? `1px solid ${p.border}`
            : "none",
        borderRadius: RADIUS,
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: "1rem",
        cursor: isOff ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.375rem",
      }}
    >
      {loading && <Spinner size="xs" />}
      {children}
    </button>
  );
}

/** Segment counter (§15) — mirrors the Coding page's top-right selector. */
function Stepper({ value, onChange, onCommit, onStep, width = 54 }: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onStep: (delta: number) => void;
  width?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", border: `1px solid ${COLOR.border}`, borderRadius: RADIUS, overflow: "hidden", height: "2.5rem" }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
        style={{ width, padding: "0 0.625rem", fontFamily: FONT, fontWeight: 700, fontSize: "1rem", color: COLOR.text, border: "none", outline: "none", background: "transparent", borderRight: `1px solid ${COLOR.border}`, textAlign: "center", boxSizing: "border-box" }}
      />
      <div style={{ display: "flex", flexDirection: "column", width: "1.125rem" }}>
        <button onClick={() => onStep(1)} style={{ flex: 1, borderBottom: `1px solid ${COLOR.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.5rem", color: COLOR.gray500, cursor: "pointer", background: "transparent", border: "none", borderRadius: 0 }}>▲</button>
        <button onClick={() => onStep(-1)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.5rem", color: COLOR.gray500, cursor: "pointer", background: "transparent", border: "none", borderRadius: 0 }}>▼</button>
      </div>
    </div>
  );
}

// Per-crash-type band colour (RSB hues from colorConstants; thresholds mirror SegmentScoresCard).
function bandColor(score: number, key: string): string {
  if (key === "BB" || key === "BP" || key === "SB") {
    if (score <= 5) return RISK_BAND_COLORS.LOW;
    if (score <= 10) return RISK_BAND_COLORS.MEDIUM;
    if (score <= 20) return RISK_BAND_COLORS.HIGH;
    return RISK_BAND_COLORS.EXTREME;
  }
  if (score <= 10) return RISK_BAND_COLORS.LOW;
  if (score <= 25) return RISK_BAND_COLORS.MEDIUM;
  if (score <= 60) return RISK_BAND_COLORS.HIGH;
  return RISK_BAND_COLORS.EXTREME;
}

const CRASH_ICONS: Record<string, string> = { BB: iconBB, BP: iconBP, SB: iconSB, VB: iconVB };

function topContributorsFromRow(row: Record<string, any> | null | undefined): Array<{ name: string; contribution: number }> {
  if (!row) return [];
  const out: Array<{ name: string; contribution: number }> = [];
  for (let i = 1; i <= 5; i++) {
    const name = row[`Top ${i} Contributor`];
    const contrib = row[`Top ${i} Contribution`];
    if (name && contrib !== undefined && contrib !== null) out.push({ name, contribution: contrib });
  }
  return out;
}

const RSB_LEGEND: Array<{ c: string; label: string }> = [
  { c: RISK_BAND_COLORS.LOW, label: "Low" },
  { c: RISK_BAND_COLORS.MEDIUM, label: "Medium" },
  { c: RISK_BAND_COLORS.HIGH, label: "High" },
  { c: RISK_BAND_COLORS.EXTREME, label: "Extreme" },
];

// Bottom Before/After Overall Risk Level cards: per-crash-type stacked bars.
const DIST_ROWS: Array<{ key: "Overall" | "VB" | "BB" | "SB" | "BP"; label: string }> = [
  { key: "Overall", label: "Overall" },
  { key: "VB", label: "Vehicle-Bicycle (VB)" },
  { key: "BB", label: "Bicycle-Bicycle (BB)" },
  { key: "SB", label: "Single-Bicycle (SB)" },
  { key: "BP", label: "Bicycle-Pedestrian (BP)" },
];
const BAND_HUES = [RISK_BAND_COLORS.LOW, RISK_BAND_COLORS.MEDIUM, RISK_BAND_COLORS.HIGH, RISK_BAND_COLORS.EXTREME];
const BAND_NAMES = ["Low", "Medium", "High", "Extreme"];

const CAPTION: CSSProperties = { fontSize: "0.75rem", color: COLOR.gray500, fontFamily: FONT };

// ───────────────────────────────── layout ─────────────────────────────────

export default function TreatmentDetailLayoutV2(vm: TreatmentViewModel) {
  const {
    projectNames, loading, error, isAllScope, activeProject, len,
    scope, panKey, currentCtx, scopeTotal, scopePage, pageInput, pageIndices,
    geoFeatures, currentIndex, scores, afterTreatmentScores,
    accordionView, attrs, effectivenessLoading, allApplicableTreatments,
    effectivenessCounts, applicableCounts, segmentScoreDrops, treatmentState,
    fullyAppliedTreatments, selectedTreatments, applyLoading,
    hasApplied, hasSelected, appliedTreatmentIds, copyButtonState, copyButtonLabel,
    currentImageUrl, imageCopyButtonState, imageCopyButtonLabel,
    currentPage, imgRef, showPostTreatment, segmentHasTreatments,
    modifiedAttrs, changedAttributes, changedFieldSources, attrMappings,
    activeAttributeGroupTab, previewScores, previewLoading,
    beforeBandCounts, afterBandCounts, openConfirmAlert,
    autoSaveStatus, isStagingPreview, mapFilterContext,
  } = vm;

  // ── gating (mirror V1) ──
  if (projectNames.length === 0) {
    return <Box p="2rem"><Text color="red.500">Invalid project name.</Text></Box>;
  }
  if (loading) {
    return <Flex align="center" justify="center" h="60vh"><Spinner size="lg" /></Flex>;
  }
  if (error) {
    return <Box p="2rem"><Text color="red.500">Error: {error}</Text></Box>;
  }

  const hasTabs = projectNames.length > 1;

  // ── displayed crash-type scores (before/preview/applied) — mirrors V1 IIFE ──
  const originalScores = (scores[currentIndex] as any) || null;
  const appliedAfter = treatmentState[currentIndex]?.after_scores;
  const appliedScoreRow = appliedAfter
    ? { ...scores[currentIndex], BB: appliedAfter.BB, BP: appliedAfter.BP, SB: appliedAfter.SB, VB: appliedAfter.VB, "Overall Risk Level": appliedAfter.total }
    : originalScores;

  let displayScoreRow: any = originalScores;
  if (isStagingPreview) {
    displayScoreRow = (previewLoading || !previewScores)
      ? appliedScoreRow
      : { ...scores[currentIndex], BB: previewScores.BB, BP: previewScores.BP, SB: previewScores.SB, VB: previewScores.VB, "Overall Risk Level": previewScores.total };
  } else if (!showPostTreatment) {
    displayScoreRow = originalScores;
  } else {
    displayScoreRow = appliedAfter ? appliedScoreRow : originalScores;
  }

  const showDelta = isStagingPreview || (showPostTreatment && treatmentState[currentIndex]?.applied);
  const beforeForDelta = showDelta ? originalScores : null;

  const crashCards: Array<{ key: string; label: string; value: number; delta: number | null; icon?: string }> = [
    { key: "VB", label: "VB", icon: CRASH_ICONS.VB, value: displayScoreRow?.["VB"] ?? 0, delta: null },
    { key: "BB", label: "BB", icon: CRASH_ICONS.BB, value: displayScoreRow?.["BB"] ?? 0, delta: null },
    { key: "SB", label: "SB", icon: CRASH_ICONS.SB, value: displayScoreRow?.["SB"] ?? 0, delta: null },
    { key: "BP", label: "BP", icon: CRASH_ICONS.BP, value: displayScoreRow?.["BP"] ?? 0, delta: null },
    { key: "Overall", label: "Overall", value: displayScoreRow?.["Overall Risk Level"] ?? 0, delta: null },
  ].map((c) => {
    if (!beforeForDelta) return c;
    const beforeVal = c.key === "Overall" ? (beforeForDelta["Overall Risk Level"] ?? 0) : (beforeForDelta[c.key] ?? 0);
    const d = beforeVal - c.value;
    return { ...c, delta: d > 0 ? d : null };
  });

  // status pill
  let pillText = "No treatments applied";
  let pillBg: string = COLOR.gray100;
  let pillFg: string = COLOR.gray500;
  if (isStagingPreview) {
    pillText = "Preview"; pillBg = "#EBF8FF"; pillFg = COLOR.blue;
  } else if (treatmentState[currentIndex]?.applied) {
    pillText = "Applied"; pillBg = "#F0FFF4"; pillFg = "#38A169";
  }

  const segmentTRC = topContributorsFromRow(displayScoreRow);

  // ── treatment options list (mirror V1 selection logic) ──
  const currentAttr = attrs[currentIndex] as any;
  let displayTreatments: Treatment[] = [];
  let listEmptyLabel = "";
  if (accordionView === "segment") {
    if (currentAttr) {
      displayTreatments = getApplicableTreatments(currentAttr)
        .sort((a, b) => (segmentScoreDrops[b.id] ?? 0) - (segmentScoreDrops[a.id] ?? 0));
    }
    listEmptyLabel = "No treatments applicable to this segment";
  } else {
    displayTreatments = allApplicableTreatments.filter((t) => (effectivenessCounts[t.id] ?? 0) > 0);
    listEmptyLabel = "No treatments applicable in whole project";
  }

  // Fixed height for the treatment list so the card never shifts — neither
  // between segments (short lists show whitespace, long lists scroll) nor between
  // the two view modes. "By Segment" autosaves (no Apply button) so the list gets
  // the full 4-item height (16rem). "By Treatment" adds the Apply-to-All button
  // (2.5rem + 0.5rem button-group gap = 3rem), so the list is shortened by exactly
  // that (13rem) to keep the total block height identical between modes.
  const treatListH = accordionView === "treatment" ? "13rem" : "16rem";

  // All/Clear: build set of applicable-unapplied ids for current scope/mode
  const allClearDisabled = (() => {
    if (accordionView === "segment") {
      if (!currentAttr) return true;
      const applicable = getApplicableTreatments(currentAttr);
      const appliedIds = treatmentState[currentIndex]?.treatment_ids ?? [];
      return applicable.every((t) => appliedIds.includes(t.id));
    }
    return allApplicableTreatments.length === 0;
  })();
  const onAllClear = () => {
    let next: Set<number>;
    if (selectedTreatments.size > 0) {
      next = new Set();
    } else if (accordionView === "segment") {
      if (!currentAttr) return;
      next = new Set(getApplicableTreatments(currentAttr).map((t) => t.id));
    } else {
      next = new Set(allApplicableTreatments.map((t) => t.id));
    }
    vm.setSelectedTreatments(next);
    if (accordionView === "segment") {
      vm.scheduleSegmentSave(Array.from(next).sort((a, b) => a - b));
    }
  };
  const resetAvailable = accordionView === "segment" && !!treatmentState[currentIndex]?.applied;

  const onApplyClick = () => {
    if (selectedTreatments.size === 0 || !currentCtx) return;
    vm.setOpenConfirmAlert(true);
  };

  const toggleTreatment = (id: number, disabled: boolean) => {
    if (disabled) return;
    const next = new Set(selectedTreatments);
    if (next.has(id)) next.delete(id); else next.add(id);
    vm.setSelectedTreatments(next);
    if (accordionView === "segment") {
      vm.scheduleSegmentSave(Array.from(next).sort((a, b) => a - b));
    }
  };

  return (
    <div style={{ fontFamily: FONT, color: COLOR.text, padding: "2rem", boxSizing: "border-box", minHeight: "100vh" }}>
      {/* TITLE */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", marginBottom: "1rem" }}>
        <span style={{ fontSize: "1.25rem", fontWeight: 700 }}>Treatment Application</span>
        <span style={CAPTION}>
          Loaded: {projectNames.length} project{projectNames.length > 1 ? "s" : ""}
          {currentCtx ? ` · ${currentCtx.name}` : ""}
        </span>
      </div>

      {/* PROJECT TABS */}
      {hasTabs && (
        <div style={{ ...v2TabRowStyle, gap: "0.25rem", marginBottom: "-0.0625rem", position: "relative", zIndex: 2 }}>
          <div onClick={vm.onSelectAllProjects} style={v2TabStyle(isAllScope)}>
            All Projects ({len})
          </div>
          {projectNames.map((proj) => {
            const count = vm.getProjectSegmentCount(proj);
            if (count === 0) return null;
            return (
              <div key={proj} onClick={() => vm.onSelectProject(proj)} style={v2TabStyle(activeProject === proj)}>
                {proj} ({count})
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════ SINGLE MERGED CARD ═══════ */}
      <div
        style={{
          background: COLOR.white,
          border: `1px solid ${COLOR.border}`,
          borderRadius: hasTabs ? "0 0.375rem 0.375rem 0.375rem" : RADIUS,
          padding: "1.25rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.125rem",
          boxSizing: "border-box",
        }}
      >
        {/* top row: segment selector + page actions (right) */}
        <Flex align="center" justify="flex-end" gap="1rem" wrap="wrap">
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Stepper
                value={pageInput}
                onChange={vm.setPageInput}
                onCommit={() => vm.commitPage(pageInput)}
                onStep={(d) => vm.commitPage(String(scopePage + d))}
              />
              <span style={{ fontSize: "1rem", fontWeight: 700, color: COLOR.text }}>/ {scopeTotal || 0}</span>
            </div>
            <V2Btn kind="blue" onClick={vm.onSaveAll} loading={vm.isSavingAll}>Save</V2Btn>
            <V2Btn kind="dark" onClick={vm.onGenerateReport}>Generate Report</V2Btn>
            <V2Btn kind="danger" onClick={vm.onResetAll}>Reset All</V2Btn>
          </div>
        </Flex>

        {/* maps */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div style={{ minWidth: 0 }}>
            <GeoDataPanel
              variant="v2"
              projectName={currentCtx ? currentCtx.name : ""}
              feature={geoFeatures[currentIndex]?.geometry?.type === "LineString" ? (geoFeatures[currentIndex] as any) : null}
              index={currentIndex}
              onJump={(i) => vm.gotoPage(i + 1)}
              containerHeight={MAP_H}
              subtitle="Before Treatment"
              curvData={vm.curvData}
              widthM={vm.widthM}
              grade={vm.grade}
              gradientPct={vm.gradientPct}
              gradientStatus={vm.gradientStatus}
              geoFeatures={geoFeatures as Feature<LineString, any>[]}
              startIndex={0}
              scores={scores as any}
              scopeRange={isAllScope ? null : scope}
              filterContext={mapFilterContext}
              autoFitKey={panKey}
              panKey={panKey}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <GeoDataPanel
              variant="v2"
              projectName={currentCtx ? currentCtx.name : ""}
              feature={geoFeatures[currentIndex]?.geometry?.type === "LineString" ? (geoFeatures[currentIndex] as any) : null}
              index={currentIndex}
              onJump={(i) => vm.gotoPage(i + 1)}
              containerHeight={MAP_H}
              subtitle="After Treatment"
              curvData={vm.curvData}
              widthM={vm.widthM}
              grade={vm.grade}
              gradientPct={vm.gradientPct}
              gradientStatus={vm.gradientStatus}
              geoFeatures={geoFeatures as Feature<LineString, any>[]}
              startIndex={0}
              scores={afterTreatmentScores as any}
              scopeRange={isAllScope ? null : scope}
              filterContext={mapFilterContext}
              autoFitKey={panKey}
              panKey={panKey}
            />
          </div>
        </div>

        {/* body: photos | controls */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "1rem", alignItems: "stretch" }}>
          {/* COL 1: photos — fills the card height set by COL 2; the two image
              boxes flex to share the space, the Prev/Next buttons stay fixed. */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <span style={{ fontSize: "1rem", fontWeight: 700, flexShrink: 0 }}>Segment Photo</span>
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", border: `1px solid ${COLOR.border}`, borderRadius: "0.375rem", overflow: "hidden" }}>
                <ImagePanel projectName={currentCtx?.name} imageRef={imgRef} fit="cover" />
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
              <V2Btn kind="dark" flex={1} onClick={() => { const p = pageIndices[scopePage - 2]; if (p !== undefined) vm.gotoPage(p + 1); }} disabled={scopePage <= 1}>Previous</V2Btn>
              <V2Btn kind="dark" flex={1} onClick={() => { const p = pageIndices[scopePage]; if (p !== undefined) vm.gotoPage(p + 1); }} disabled={scopePage >= scopeTotal}>Next</V2Btn>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <span style={{ fontSize: "1rem", fontWeight: 700, flexShrink: 0 }}>Post-Treatment Artistic Impression</span>
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <PostTreatmentImageUpload
                  projectName={currentCtx?.name || ""}
                  segmentIndex={(currentCtx?.localIndex ?? currentIndex) + 1}
                  hideHeader
                />
              </div>
            </div>
          </div>

          {/* COL 2: controls + attributes */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.125rem" }}>
            {/* Treatment Options */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <Flex align="center" justify="space-between" gap="0.75rem" wrap="wrap">
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "1rem", fontWeight: 700 }}>Treatment Options</span>
                  <V2Segmented
                    options={[{ value: "segment", label: "By Segment" }, { value: "treatment", label: "By Treatment" }]}
                    value={accordionView}
                    onChange={(v) => { vm.setAccordionView(v); vm.setSelectedTreatments(new Set()); }}
                  />
                </div>
                <V2Btn kind="danger" onClick={vm.onResetTreatments} disabled={!resetAvailable}>Reset</V2Btn>
              </Flex>

              {accordionView === "treatment" && effectivenessLoading ? (
                <Flex direction="column" align="center" justify="center" gap="3" h={treatListH}>
                  <Spinner size="sm" color="blue.500" />
                  <span style={CAPTION}>Ranking Treatment Options...</span>
                </Flex>
              ) : displayTreatments.length === 0 ? (
                <div style={{ height: treatListH, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: COLOR.gray500, fontSize: "1rem" }}>{listEmptyLabel}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", height: treatListH, overflowY: "auto", paddingRight: "0.125rem" }}>
                  {displayTreatments.map((t) => {
                    const isApplied = accordionView === "segment"
                      ? !!(treatmentState[currentIndex]?.applied && treatmentState[currentIndex]?.treatment_ids.includes(t.id))
                      : fullyAppliedTreatments.has(t.id);
                    // Segment view: always toggleable (auto-saves); treatment view: lock applied rows
                    const isDisabledItem = accordionView === "segment" ? false : isApplied;
                    const showAppliedStyle = accordionView === "segment" ? false : isApplied;
                    const isSel = selectedTreatments.has(t.id);
                    const cbBg = showAppliedStyle ? "#38A169" : isSel ? COLOR.blue : COLOR.white;
                    const cbBorder = showAppliedStyle ? "#38A169" : isSel ? COLOR.blue : COLOR.borderInput;

                    let metric = "";
                    if (accordionView === "treatment") {
                      const count = effectivenessCounts[t.id] ?? 0;
                      const applicable = applicableCounts[t.id] ?? 0;
                      const denom = applicable > 0 ? applicable : attrs.length;
                      const pct = (denom > 0 && count > 0) ? (count / denom) * 100 : 0;
                      const disp = count > 0 ? Math.max(0.1, pct).toFixed(1) : "0.0";
                      metric = `Improves ${disp}% of ${applicable > 0 ? "applicable segments" : "segments"}`;
                    } else if (segmentScoreDrops[t.id] !== undefined) {
                      metric = `Score drop: ${segmentScoreDrops[t.id].toFixed(1)}`;
                    }

                    return (
                      <div
                        key={t.id}
                        onClick={() => toggleTreatment(t.id, isDisabledItem)}
                        style={{
                          display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.625rem 0.75rem", borderRadius: RADIUS, boxSizing: "border-box",
                          cursor: isDisabledItem ? "default" : "pointer",
                          background: showAppliedStyle ? "#F0FFF4" : isSel ? "#EBF8FF" : COLOR.white,
                          border: `1px solid ${showAppliedStyle ? "#9AE6B4" : isSel ? "#90CDF4" : COLOR.border}`,
                        }}
                      >
                        <div style={{ width: "1.125rem", height: "1.125rem", borderRadius: "0.125rem", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: cbBg, border: `1px solid ${cbBorder}` }}>
                          {(showAppliedStyle || isSel) && (
                            <LuCheck size={10} color="#fff" strokeWidth={3} />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                          <span style={{ fontSize: "1rem", fontWeight: 700, color: COLOR.text }}>{t.name}</span>
                          {metric && <span style={CAPTION}>{metric}</span>}
                        </div>
                        {showAppliedStyle && <LuCheck size={14} color="#38A169" strokeWidth={3} style={{ flexShrink: 0 }} />}
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <V2Btn kind="ghost" flex={1} onClick={onAllClear} disabled={selectedTreatments.size === 0 && allClearDisabled}>
                    {selectedTreatments.size > 0 ? "Clear" : "All"}
                  </V2Btn>
                  {accordionView === "segment" && autoSaveStatus !== "idle" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8125rem", color: autoSaveStatus === "saving" ? "#6B7280" : "#16A34A" }}>
                      {autoSaveStatus === "saving" ? (
                        <><Spinner size="xs" /><span>Saving…</span></>
                      ) : (
                        <span>Saved ✓</span>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <V2Btn
                    kind="dark"
                    flex={1}
                    disabled={!hasApplied && !hasSelected}
                    loading={copyButtonState === "copying"}
                    onClick={() => vm.onCopyTreatmentPrompt(hasApplied ? appliedTreatmentIds : Array.from(selectedTreatments))}
                  >
                    {copyButtonLabel}
                  </V2Btn>
                  <V2Btn
                    kind="ghost"
                    flex={1}
                    disabled={!currentImageUrl}
                    loading={imageCopyButtonState === "copying"}
                    onClick={vm.onCopyCurrentImage}
                  >
                    {imageCopyButtonLabel}
                  </V2Btn>
                </div>
                {accordionView === "treatment" && (
                  <V2Btn
                    kind="teal"
                    width="100%"
                    disabled={selectedTreatments.size === 0}
                    loading={applyLoading}
                    onClick={onApplyClick}
                  >
                    {`Apply to All (${selectedTreatments.size})`}
                  </V2Btn>
                )}
              </div>
            </div>

            {/* Crash Type Scores */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <Flex align="center" justify="space-between" gap="0.75rem" wrap="wrap">
                <span style={{ fontSize: "1rem", fontWeight: 700 }}>Crash Type Scores</span>
                <div style={{ display: "flex", gap: "0.625rem", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: pillFg, background: pillBg, borderRadius: RADIUS, padding: "0.1875rem 0.625rem", whiteSpace: "nowrap" }}>{pillText}</span>
                  {RSB_LEGEND.map((lg) => (
                    <div key={lg.label} style={{ display: "flex", alignItems: "center", gap: "0.1875rem" }}>
                      <span style={{ width: "0.5625rem", height: "0.5625rem", borderRadius: "0.125rem", background: lg.c, display: "inline-block", flexShrink: 0 }} />
                      <span style={{ fontSize: "0.75rem", color: COLOR.gray600 }}>{lg.label}</span>
                    </div>
                  ))}
                </div>
              </Flex>
              <div style={{ display: "flex", gap: "0.375rem" }}>
                {crashCards.map((c) => {
                  const color = bandColor(c.value, c.key);
                  const isScore = c.key === "Overall";
                  return (
                    <div
                      key={c.key}
                      style={{ flex: 1, minHeight: "3.625rem", background: color, borderRadius: RADIUS, padding: "0.5rem 0.625rem", gap: "0.5rem", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}
                    >
                      {!isScore && c.icon && (
                        <img src={c.icon} alt={c.label} style={{ height: "1.75rem", objectFit: "contain", flexShrink: 0 }} />
                      )}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ fontSize: "1rem", fontWeight: 500, color: "#fff", lineHeight: 1.1 }}>{isScore ? "Risk Score" : c.label}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: "0.3125rem" }}>
                          <div style={{ fontSize: "1rem", fontWeight: 700, color: "#fff", lineHeight: 1 }}>{Number(c.value).toFixed(1)}</div>
                          {c.delta !== null && (
                            <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "rgba(255,255,255,.9)" }}>↓ {c.delta.toFixed(1)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {(() => {
                const projTRC = vm.projectContributors?.contributors ?? [];
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "1rem", fontWeight: 700 }}>Top Risk Contributors</span>
                      {/* Colour legend — matches the Coding page. */}
                      <div style={{ display: "flex", gap: "0.75rem" }}>
                        {[["By Project", "#2B6CB0"], ["By Segment", "#DD6B20"]].map(([label, color]) => (
                          <span key={label} style={{ display: "flex", gap: "0.25rem", alignItems: "center", fontFamily: FONT, fontSize: "0.75rem", color: COLOR.gray600 }}>
                            <span style={{ width: "0.625rem", height: "0.625rem", borderRadius: "0.125rem", background: color, display: "inline-block" }} />
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", alignContent: "flex-start", overflowY: "auto", height: "6rem" }}>
                      {/* By-segment contributors (orange) with their contribution value. */}
                      {segmentTRC.map((c, i) => (
                        <div
                          key={`s${c.name}-${i}`}
                          onClick={() => vm.onContributorClick(c.name)}
                          style={{ display: "inline-flex", alignItems: "center", height: "1.75rem", boxSizing: "border-box", background: "#DD6B20", color: "#fff", borderRadius: "0.25rem", padding: "0 0.5625rem", fontFamily: FONT, fontSize: "1rem", cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          {c.name}<strong style={{ marginLeft: "0.1875rem" }}>{c.contribution.toFixed(1)}</strong>
                        </div>
                      ))}
                      {/* By-project contributors (blue) with their contribution value. */}
                      {projTRC.map((c, i) => (
                        <div
                          key={`p${c.name}-${i}`}
                          onClick={() => vm.onContributorClick(c.name)}
                          style={{ display: "inline-flex", alignItems: "center", height: "1.75rem", boxSizing: "border-box", background: "#2B6CB0", color: "#fff", borderRadius: "0.25rem", padding: "0 0.5625rem", fontFamily: FONT, fontSize: "1rem", cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          {c.name}<strong style={{ marginLeft: "0.1875rem" }}>{c.contribution.toFixed(1)}</strong>
                        </div>
                      ))}
                      {segmentTRC.length === 0 && projTRC.length === 0 && (
                        <span style={{ fontFamily: FONT, fontSize: "0.75rem", color: COLOR.gray500 }}>No contributor data</span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Attributes */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <Flex align="center" justify="space-between" gap="0.75rem">
                <span style={{ fontSize: "1rem", fontWeight: 700 }}>Attributes</span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "1rem", color: segmentHasTreatments ? COLOR.gray500 : COLOR.gray400 }}>Show Pre-Treatment</span>
                  <V2Switch
                    on={!showPostTreatment && segmentHasTreatments}
                    onColor={COLOR.teal}
                    onClick={segmentHasTreatments ? () => vm.setShowPostTreatment(!showPostTreatment) : undefined}
                  />
                </div>
              </Flex>
              <AttributesPanel
                variant="v2"
                row={
                  !showPostTreatment
                    ? attrs[currentIndex]
                    : (isStagingPreview || treatmentState[currentIndex]?.applied)
                      ? modifiedAttrs
                      : attrs[currentIndex]
                }
                mappings={attrMappings}
                changedFields={showPostTreatment ? Array.from(changedAttributes) : []}
                fieldSources={showPostTreatment ? changedFieldSources : {}}
                highlightMessage="Modified by treatment"
                highlightColor="green"
                activeGroupTab={activeAttributeGroupTab}
                readOnly={true}
              />
            </div>
          </div>
        </div>
      </div>

      {/* BEFORE / AFTER OVERALL RISK LEVEL CARDS */}
      <div style={{ display: "flex", gap: "1rem", marginTop: "1rem", alignItems: "stretch" }}>
        {([
          { title: "Before Treatment", counts: beforeBandCounts },
          { title: "After Treatment", counts: afterBandCounts },
        ] as const).map((card) => (
          <RiskLevelCard key={card.title} title={card.title} counts={card.counts} scopeCount={scope.count} />
        ))}
      </div>

      {/* Confirm Apply All Dialog */}
      <Dialog.Root open={openConfirmAlert} onOpenChange={(d) => vm.setOpenConfirmAlert(d.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Apply Treatments to {isAllScope ? "All Projects" : activeProject}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <p>Are you sure you want to apply the following treatments to all eligible segments in {isAllScope ? "all loaded projects" : activeProject}?</p>
                <ul style={{ marginTop: "0.5rem", paddingLeft: "1.25rem" }}>
                  {Array.from(selectedTreatments).map((id) => {
                    const t = TREATMENTS.find((tr) => tr.id === id);
                    return <li key={id}><strong>{t ? t.name : `Treatment ${id}`}</strong></li>;
                  })}
                </ul>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" disabled={applyLoading}>Cancel</Button>
                </Dialog.ActionTrigger>
                <Button colorPalette="blue" onClick={vm.onConfirmApplyToAll} loading={applyLoading}>Confirm</Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Reset All confirm */}
      <ResetConfirmationDialog
        open={vm.resetAllConfirmOpen}
        onConfirm={vm.onConfirmResetAll}
        onCancel={vm.onCancelResetAll}
        isResetting={vm.isResettingAll}
      />
    </div>
  );
}

// ── Before/After Overall Risk Level card (stacked bars + threshold legend) ──
function RiskLevelCard({
  title,
  counts,
  scopeCount,
}: {
  title: string;
  counts: { VB: Record<number, number>; BB: Record<number, number>; SB: Record<number, number>; BP: Record<number, number>; Overall: Record<number, number> };
  scopeCount: number;
}) {
  const [barHover, setBarHover] = useState<{ x: number; y: number; row: string; band: string; count: number; pct: number } | null>(null);

  return (
    <div style={{ flex: 1, minWidth: 0, background: COLOR.white, border: `1px solid ${COLOR.border}`, borderRadius: RADIUS, display: "flex", flexDirection: "column", padding: "1.125rem 1.25rem", boxSizing: "border-box" }}>
      <span style={{ fontWeight: 700, fontSize: "1rem", color: COLOR.text, marginBottom: "1.125rem" }}>{title}</span>
      <div
        data-risk-bars
        style={{ display: "flex", flexDirection: "column", gap: "0.875rem", position: "relative" }}
        onMouseLeave={() => setBarHover(null)}
      >
        {DIST_ROWS.map((row) => {
          const dist = counts[row.key];
          const total = [1, 2, 3, 4].reduce((a, b) => a + (dist[b] ?? 0), 0);
          return (
            <div key={row.key} style={{ display: "flex", alignItems: "center", gap: "0.875rem" }}>
              <span style={{ width: "9.375rem", textAlign: "right", fontSize: "1rem", color: COLOR.text, flexShrink: 0 }}>{row.label}</span>
              <div style={{ flex: 1, display: "flex", height: "1.375rem", borderRadius: "0.25rem", overflow: "hidden", background: COLOR.gray100 }}>
                {[1, 2, 3, 4].map((band) => {
                  const v = dist[band] ?? 0;
                  if (v <= 0) return null;
                  const pct = total > 0 ? (v / total) * 100 : 0;
                  return (
                    <div
                      key={band}
                      style={{ flexGrow: v, flexBasis: 0, background: BAND_HUES[band - 1], cursor: "pointer" }}
                      onMouseMove={(e) => {
                        const host = e.currentTarget.closest("[data-risk-bars]") as HTMLElement | null;
                        const r = host?.getBoundingClientRect();
                        setBarHover({ x: r ? e.clientX - r.left : 0, y: r ? e.clientY - r.top : 0, row: row.label, band: BAND_NAMES[band - 1], count: v, pct });
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        {barHover && (
          <div style={{ position: "absolute", left: barHover.x + 12, top: barHover.y + 12, zIndex: 20, pointerEvents: "none" }}>
            <DistTooltipBox title={`${barHover.row} · ${barHover.band}`} detail={`Count: ${barHover.count} (${barHover.pct.toFixed(1)}%)`} />
          </div>
        )}
      </div>
      <div style={{ marginTop: "1.125rem" }}>
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: "1rem", color: COLOR.text, marginBottom: "0.75rem" }}>Risk Level by Crash Type</div>
        <div style={{ display: "flex", justifyContent: "center", gap: "2.5rem", flexWrap: "wrap" }}>
          <ThresholdLegend heading="VB Crashes:" rows={["Low Risk: <10", "Medium Risk: 10-25", "High Risk: 25-60", "Extreme Risk: >60"]} />
          <ThresholdLegend heading="BB, BP, SB crashes:" rows={["Low Risk: <5", "Medium Risk: 5-10", "High Risk: 10-20", "Extreme Risk: >20"]} />
        </div>
      </div>
      <span style={{ ...CAPTION, marginTop: "0.625rem" }}>{scopeCount} segments in scope</span>
    </div>
  );
}

function ThresholdLegend({ heading, rows }: { heading: string; rows: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <div style={{ fontWeight: 700, fontSize: "0.75rem", color: COLOR.text }}>{heading}</div>
      {rows.map((r, i) => (
        <div key={r} style={{ display: "flex", alignItems: "center", gap: "0.4375rem", fontSize: "0.75rem", color: COLOR.gray600 }}>
          <span style={{ width: "0.5625rem", height: "0.5625rem", background: BAND_HUES[i], borderRadius: "0.125rem", flexShrink: 0 }} />
          {r}
        </div>
      ))}
    </div>
  );
}
