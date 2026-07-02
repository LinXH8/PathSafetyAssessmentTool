import { useState, useMemo } from "react";
import type { CSSProperties } from "react";
import { Box, Flex, Text, Spinner, Portal, Progress, Card, CardBody } from "@chakra-ui/react";

import ImagePanel from "../components/ImagePanel";
import AttributesPanel from "../components/AttributesPanel";
import GeoDataPanel from "../components/GeoDataPanel";
import AutocodeValidation from "../../PathAnalysisPage/components/AutocodeValidation";
import ExitConfirmationDialog from "../../sidebar/components/ExitConfirmationDialog";
import ConfirmDialogV2 from "../../../components/common/ConfirmDialogV2";
import CodingAttributeModals from "./CodingAttributeModals";
import { RISK_BAND_COLORS, getSegmentRiskBandColor } from "../../../components/visualization/scoreband/colorConstants";
import { GROUP_ORDER, GROUP_RULES, KEY_ALIASES } from "../../../constants/autocodeAttributes";
import { FONT, COLOR, RADIUS, CONTENT_PADDING, CARD_GAP } from "../../../features/ui/designTokens";
import type { CodingViewModel } from "./CodingViewModel";
import iconBB from "../../../../CycleRAP Assets/BB.png";
import iconBP from "../../../../CycleRAP Assets/BP.png";
import iconSB from "../../../../CycleRAP Assets/SB.png";
import iconVB from "../../../../CycleRAP Assets/VB.png";

const CRASH_ICONS: Record<string, string> = { BB: iconBB, BP: iconBP, SB: iconSB, VB: iconVB };

/**
 * v2 Coding layout — translation of `Home.dc.html` FRAME 4 ("04 — Coding") to
 * Chakra/React + the DESIGN_GUIDE tokens. Route-specific controls (Auto-code,
 * Save, segment counters) live on-canvas per the redesign. The heavy interactive
 * components are reused (ImagePanel, AttributesPanel, GeoDataPanel,
 * AutocodeValidation); the lighter readout chrome (tabs, segment navigator,
 * Crash Type Scores row, TRC chips, attribute-select checklist, Save dock) is
 * reproduced from the comp. Pure function of the CodingViewModel.
 */

const dispatch = (name: string, detail?: unknown) =>
  window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));

// Per-crash-type RSB band color (mirrors SegmentScoresCard thresholds — guide §11/§3).
function bandColor(score: number, type: string): string {
  if (type === "VB") {
    if (score < 10) return RISK_BAND_COLORS.LOW;
    if (score <= 25) return RISK_BAND_COLORS.MEDIUM;
    if (score <= 60) return RISK_BAND_COLORS.HIGH;
    return RISK_BAND_COLORS.EXTREME;
  }
  if (score < 5) return RISK_BAND_COLORS.LOW;
  if (score <= 10) return RISK_BAND_COLORS.MEDIUM;
  if (score <= 20) return RISK_BAND_COLORS.HIGH;
  return RISK_BAND_COLORS.EXTREME;
}

const RSB_LEGEND: Array<[string, string]> = [
  ["Low", RISK_BAND_COLORS.LOW],
  ["Medium", RISK_BAND_COLORS.MEDIUM],
  ["High", RISK_BAND_COLORS.HIGH],
  ["Extreme", RISK_BAND_COLORS.EXTREME],
];

// ── shared style fragments ──
const card: CSSProperties = { background: COLOR.white, border: `1px solid ${COLOR.border}`, borderRadius: RADIUS };
const sectionTitle: CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text };
const caption: CSSProperties = { fontFamily: FONT, fontSize: 12, color: COLOR.gray500 };
const btnBase: CSSProperties = { height: 40, boxSizing: "border-box", padding: 0, border: "none", borderRadius: RADIUS, fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.white, cursor: "pointer" };

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 16,
    cursor: "pointer",
    borderRadius: "6px 6px 0 0",
    border: `1px solid ${COLOR.border}`,
    borderBottom: active ? "none" : `1px solid ${COLOR.border}`,
    marginBottom: active ? -1 : 0,
    background: active ? COLOR.white : COLOR.gray100,
    color: active ? COLOR.text : COLOR.gray500,
    whiteSpace: "nowrap",
  };
}

function legendRow(items: Array<[string, string]>) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      {items.map(([label, color]) => (
        <span key={label} style={{ display: "flex", gap: 4, alignItems: "center", fontFamily: FONT, fontSize: 12, color: COLOR.gray600 }}>
          <span style={{ width: 9, height: 9, background: color, borderRadius: 2, display: "inline-block", flexShrink: 0 }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function Stepper({ value, onChange, onCommit, onStep, width = 54 }: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onStep: (delta: number) => void;
  width?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", border: `1px solid ${COLOR.border}`, borderRadius: RADIUS, overflow: "hidden", height: 30 }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
        style={{ width, padding: "0 10px", fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text, border: "none", outline: "none", background: "transparent", borderRight: `1px solid ${COLOR.border}` }}
      />
      <div style={{ display: "flex", flexDirection: "column", width: 18 }}>
        <button onClick={() => onStep(1)} style={{ flex: 1, borderBottom: `1px solid ${COLOR.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: COLOR.gray500, cursor: "pointer", background: "transparent", border: "none", borderRadius: 0 }}>▲</button>
        <button onClick={() => onStep(-1)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: COLOR.gray500, cursor: "pointer", background: "transparent", border: "none", borderRadius: 0 }}>▼</button>
      </div>
    </div>
  );
}

export default function CodingLayoutV2(vm: CodingViewModel) {
  const {
    projectList, projectData, activeTab, setActiveTab, isShowingCodingGuide, currentProjectName,
    loading, error, imagesLoaded, imageLoadingProgress,
    autoCoding, progress, autoCodeMsg, projectProgress,
    currentData, attrs, scores, geoFeatures, currentIndex, currentPage, len,
    currentAttr, originalCurrentAttr, imgRef, changedFieldsByRow, fieldSourcesByRow, attrMappings,
    segmentInput, setSegmentInput, commitSegment, autocodedSegmentInput, setAutocodedSegmentInput, commitAutocodedSegment,
    pageInput, setPageInput, commitPage, gotoPage,
    projectContributors, handleContributorClick, activeAttributeGroupTab,
    cameFromPathAnalysis, currentSegmentVerified, toggleCurrentSegmentVerified, verifiedByProject, filterContext,
    returnToAnalysis, onBackToAnalysis, onDiscardAndExit, onSaveAndExit, isSaveDialogOpen, setIsSaveDialogOpen, isSaving,
    onAttrChange, onEdit, setEditingOptions,
    widthData, curvData, showCurvatureOverlay, setShowCurvatureOverlay, refreshCurrentProject,
  } = vm;

  // Auto-code-by-attribute selection. Selection now happens IN the attribute
  // panel: the user clicks attribute cells (which highlight green) instead of a
  // separate checklist. Selected values are the real backend attribute keys.
  const [attrCoding, setAttrCoding] = useState(false);
  const [selectedAttrKeys, setSelectedAttrKeys] = useState<Set<string>>(new Set());
  // The autocodeable real keys — only these cells are selectable in the panel.
  const allAttrKeys = useMemo(
    () => new Set(GROUP_ORDER.flatMap((g) => GROUP_RULES[g]).map((n) => KEY_ALIASES[n] ?? n)),
    []
  );

  // Autocode confirmation — every autocode overwrites attributes, so gate it
  // behind the shared v2 confirm popup. `null` = closed.
  const [autocodeConfirm, setAutocodeConfirm] = useState<
    | { kind: "one" }
    | { kind: "byAttribute"; fields: string[]; count: number }
    | null
  >(null);

  const toggleAttrKey = (key: string) =>
    setSelectedAttrKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const runAutocodeByAttributes = () => {
    const fields = [...selectedAttrKeys];
    if (fields.length === 0) return;
    setAutocodeConfirm({ kind: "byAttribute", fields, count: fields.length });
  };

  const confirmAutocode = () => {
    if (!autocodeConfirm) return;
    if (autocodeConfirm.kind === "one") {
      dispatch("psat:autocode:one");
    } else {
      dispatch("psat:autocode:by-field", { fields: autocodeConfirm.fields });
      setAttrCoding(false);
      setSelectedAttrKeys(new Set());
    }
    setAutocodeConfirm(null);
  };

  const renderTabs = () => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexShrink: 0, gap: 8 }}>
      {/* Project tabs — scroll horizontally when many projects are open. */}
      <div style={{ display: "flex", alignItems: "flex-end", overflowX: "auto", flexShrink: 1, minWidth: 0, scrollbarWidth: "none" }}>
        {projectList.map((name) => (
          <div key={name} onClick={() => setActiveTab(name)} style={tabStyle(activeTab === name)}>
            {name} ({projectData[name]?.attrs.length ?? 0})
          </div>
        ))}
      </div>
      {/* Sticky right cluster: Coding Guide stays reachable from any project without
          horizontal scrolling (safety: jump to the guide from e.g. project #20). */}
      <div style={{ display: "flex", alignItems: "flex-end", flexShrink: 0, gap: 4 }}>
        {returnToAnalysis && (
          <button onClick={onBackToAnalysis} style={{ ...btnBase, height: 32, padding: "0 12px", marginBottom: 4, background: "transparent", border: `1px solid ${COLOR.borderInput}`, color: COLOR.blue }}>
            ← Back to Path Analysis
          </button>
        )}
        <div onClick={() => setActiveTab("coding-guide")} style={tabStyle(isShowingCodingGuide)}>Coding Guide</div>
        <div onClick={() => window.open("https://irap.org/cyclerap/", "_blank", "noopener,noreferrer")} style={{ padding: "8px 16px", fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.text, cursor: "pointer", whiteSpace: "nowrap" }}>CycleRAP ↗</div>
      </div>
    </div>
  );

  // ── gating states (functional, not part of the comp's main design) ──
  if (projectList.length === 0) {
    return <Box p="8"><Text color={COLOR.danger}>No projects selected.</Text></Box>;
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
              <Progress.Track><Progress.Range /></Progress.Track>
              <Progress.ValueText>{imageLoadingProgress}%</Progress.ValueText>
            </Progress.Root>
            <Text fontSize="sm" color="gray.500">Please wait while we cache images for smooth navigation.</Text>
          </>
        )}
      </Flex>
    );
  }

  if (!isShowingCodingGuide && error) {
    return <Box p="8"><Text color={COLOR.danger}>Error: {error}</Text></Box>;
  }

  if (isShowingCodingGuide) {
    return (
      <Box style={{ padding: CONTENT_PADDING, display: "flex", flexDirection: "column", gap: CARD_GAP, minHeight: "100vh" }}>
        {renderTabs()}
        <div
          style={{
            ...card,
            borderRadius: "0 6px 6px 6px",
            marginTop: -1,
            height: "calc(100vh - 180px)",
            display: "flex",
            flexDirection: "column",
            padding: 16,
            boxSizing: "border-box",
            colorScheme: "light",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexShrink: 0 }}>
            <span style={sectionTitle}>CycleRAP Coding Guide</span>
            <a
              href="/PSAT coding sheetMay26.pdf"
              target="_blank"
              rel="noreferrer"
              style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, color: COLOR.blue, textDecoration: "none" }}
            >
              Open in new tab ↗
            </a>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              border: `1px solid ${COLOR.border}`,
              borderRadius: RADIUS,
              overflow: "hidden",
              background: COLOR.white,
              colorScheme: "light",
            }}
          >
            <iframe
              src="/PSAT coding sheetMay26.pdf#view=FitH"
              style={{ width: "100%", height: "100%", border: "none", background: COLOR.white, colorScheme: "light" }}
              title="Coding Guide PDF"
            />
          </div>
        </div>
      </Box>
    );
  }

  // ── score readout for the current segment ──
  const scoreRow = (scores[currentIndex] as Record<string, any>) || null;
  const crashCards: Array<{ key: string; value: number; color: string }> = ["BB", "BP", "SB", "VB"].map((k) => {
    const v = Number(scoreRow?.[k]) || 0;
    return { key: k, value: v, color: bandColor(v, k) };
  });
  const riskScore = Number(scoreRow?.["Overall Risk Level"] ?? scoreRow?.["CycleRAP score"] ?? 0);
  const riskColor = getSegmentRiskBandColor(scoreRow);

  // ── TRC chips: segment-level (pink) + project-level (grey) ──
  const segChips: Array<{ name: string; val: number }> = [];
  for (let i = 1; i <= 5; i++) {
    const name = scoreRow?.[`Top ${i} Contributor`] as string | undefined;
    const contrib = scoreRow?.[`Top ${i} Contribution`] as number | undefined;
    if (name && contrib != null) segChips.push({ name, val: contrib });
  }
  const projChips = projectContributors?.contributors ?? [];

  const verifiedPct = len > 0 ? `${(((currentData.verifiedSegmentCount ?? 0) / len) * 100).toFixed(2)}%` : "0%";
  const autocodedPct = len > 0 ? `${(((currentData.autocodedSegmentCount ?? 0) / len) * 100).toFixed(2)}%` : "0%";

  return (
    <Box style={{ padding: CONTENT_PADDING, display: "flex", flexDirection: "column", gap: CARD_GAP, minHeight: "100vh", position: "relative" }}>
      {autoCoding && (
        <Portal>
          <Box position="fixed" inset={0} bg="blackAlpha.400" backdropFilter="blur(2px)" zIndex={1000} aria-busy="true">
            <Progress.Root value={progress} min={0} max={100} orientation="horizontal" colorPalette="blue" variant="subtle" size="sm" position="absolute" top={0} left={0} right={0} zIndex={1001}>
              <Progress.Track><Progress.Range /></Progress.Track>
            </Progress.Root>
            <Flex minH="100vh" align="center" justify="center" p="4">
              <Card.Root shadow="lg" borderRadius="2xl" maxW="md" w="full">
                <CardBody>
                  <Flex direction="column" gap="4">
                    <Flex align="center" gap="3">
                      <Spinner />
                      <Box>
                        <Text fontWeight="bold">Auto-coding…</Text>
                        <Text fontSize="sm" color="gray.600">{autoCodeMsg || "Please wait while models run."}</Text>
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
                            <Progress.Root value={total > 0 ? (processed / total) * 100 : 0} min={0} max={100} colorPalette="blue" size="sm">
                              <Progress.Track><Progress.Range /></Progress.Track>
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

      {/* Tabs + main coding card */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {renderTabs()}
        <div style={{ ...card, borderRadius: "0 6px 6px 6px", display: "flex", flexDirection: "column", overflow: "hidden", marginTop: -1 }}>

          {/* Segment Navigator Bar */}
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={sectionTitle}>Segments Verified</div>
                  <div style={caption}>{verifiedPct}</div>
                </div>
                <Stepper
                  value={segmentInput}
                  onChange={setSegmentInput}
                  onCommit={() => commitSegment(segmentInput, true)}
                  onStep={(d) => commitSegment(String((currentData.verifiedSegmentCount ?? 0) + d), true)}
                />
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={sectionTitle}>Segments Autocoded</div>
                  <div style={caption}>{autocodedPct}</div>
                </div>
                <Stepper
                  value={autocodedSegmentInput}
                  onChange={setAutocodedSegmentInput}
                  onCommit={() => commitAutocodedSegment(autocodedSegmentInput, true)}
                  onStep={(d) => commitAutocodedSegment(String((currentData.autocodedSegmentCount ?? 0) + d), true)}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Stepper
                value={pageInput}
                onChange={(v) => setPageInput(v.replace(/^0+/, ""))}
                onCommit={() => commitPage(pageInput, true)}
                onStep={(d) => commitPage(String(currentPage + d), true)}
              />
              <span style={{ ...sectionTitle }}>/{len || 0}</span>
              <button onClick={() => dispatch("psat:save")} style={{ ...btnBase, padding: "0 16px", marginLeft: 8, background: COLOR.blue }}>Save</button>
            </div>
          </div>

          {/* Two-column body */}
          <div style={{ display: "flex", overflow: "hidden", flexWrap: "wrap" }}>

            {/* LEFT: Risk block */}
            <div style={{ flex: "1 1 420px", minWidth: 360, display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", boxSizing: "border-box" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 8, flexWrap: "wrap" }}>
                <span style={sectionTitle}>Crash Type Scores</span>
                {legendRow(RSB_LEGEND)}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {crashCards.map((c) => (
                  <div key={c.key} style={{ flex: 1, borderRadius: RADIUS, display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 10px", gap: 8, minHeight: 58, background: c.color }}>
                    <img src={CRASH_ICONS[c.key]} alt={c.key} style={{ width: 30, height: 30, objectFit: "contain", flexShrink: 0 }} />
                    <div>
                      <div style={{ fontFamily: FONT, fontSize: 16, fontWeight: 500, color: COLOR.white }}>{c.key}</div>
                      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.white, lineHeight: 1 }}>{c.value.toFixed(1)}</div>
                    </div>
                  </div>
                ))}
                <div style={{ flex: 1, borderRadius: RADIUS, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 8, minHeight: 58, background: riskColor }}>
                  <div style={{ fontFamily: FONT, fontWeight: 500, fontSize: 16, color: COLOR.white, textAlign: "center" }}>Risk Score</div>
                  <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: COLOR.white, lineHeight: 1 }}>{riskScore.toFixed(1)}</div>
                </div>
              </div>

              {/* Street View Photo + brightness (reused ImagePanel). flex:1 lets the
                  image fill all space the left column gains by stretching to match the
                  right (attributes) column height; fit="cover" fills the box (no
                  letterbox bars). minHeight keeps it usable when columns stack narrow. */}
              <div style={{ flex: 1, minHeight: 300, display: "flex", flexDirection: "column" }}>
                <ImagePanel projectName={currentProjectName!} imageRef={imgRef} panelHeight={undefined} fit="cover" />
              </div>

              <button onClick={() => setAutocodeConfirm({ kind: "one" })} style={{ ...btnBase, width: "100%", background: COLOR.blue, flexShrink: 0 }}>
                Auto-code by Segment
              </button>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => gotoPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  style={{ ...btnBase, flex: 1, background: COLOR.gray800, opacity: currentPage <= 1 ? 0.5 : 1, cursor: currentPage <= 1 ? "not-allowed" : "pointer" }}
                >
                  Previous
                </button>
                {cameFromPathAnalysis && (
                  <button
                    onClick={toggleCurrentSegmentVerified}
                    title={currentSegmentVerified ? "Click to unmark this segment" : "Mark this segment as reviewed"}
                    style={{ ...btnBase, flex: 1, background: currentSegmentVerified ? "#38A169" : "transparent", color: currentSegmentVerified ? COLOR.white : COLOR.text, border: currentSegmentVerified ? "none" : `1px solid ${COLOR.borderInput}` }}
                  >
                    {currentSegmentVerified ? "✓ Verified" : "Mark Verified"}
                  </button>
                )}
                <button
                  onClick={() => gotoPage(currentPage + 1)}
                  disabled={currentPage >= len}
                  style={{ ...btnBase, flex: 1, background: COLOR.gray800, opacity: currentPage >= len ? 0.5 : 1, cursor: currentPage >= len ? "not-allowed" : "pointer" }}
                >
                  Next
                </button>
              </div>
            </div>

            {/* RIGHT: TRC + Attributes */}
            <div style={{ flex: "1 1 420px", minWidth: 360, display: "flex", flexDirection: "column", gap: 14, padding: "14px 16px", boxSizing: "border-box" }}>
              {/* Top Risk Contributors. The chip area is a FIXED ~3-row height with
                  internal scroll so the panel below it doesn't jump as the chip count
                  changes segment-to-segment. */}
              <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 8, flexWrap: "wrap" }}>
                  <span style={sectionTitle}>Top Risk Contributors</span>
                  {legendRow([["By Project", "#2B6CB0"], ["By Segment", "#DD6B20"]])}
                </div>
                <div style={{ display: "flex", alignContent: "flex-start", flexWrap: "wrap", gap: 6, overflowY: "auto", height: 112 }}>
                  {segChips.map((c, i) => (
                    <div key={`s${i}`} onClick={() => handleContributorClick(c.name)} style={{ background: "#DD6B20", color: COLOR.white, borderRadius: 4, padding: "4px 9px", fontFamily: FONT, fontSize: 16, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {c.name}<strong style={{ marginLeft: 3 }}>{c.val.toFixed(1)}</strong>
                    </div>
                  ))}
                  {projChips.map((c: { name: string; contribution: number }, i: number) => (
                    <div key={`p${i}`} onClick={() => handleContributorClick(c.name)} style={{ background: "#2B6CB0", color: COLOR.white, borderRadius: 4, padding: "4px 9px", fontFamily: FONT, fontSize: 16, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {c.name}<strong style={{ marginLeft: 3 }}>{c.contribution.toFixed(1)}</strong>
                    </div>
                  ))}
                  {segChips.length === 0 && projChips.length === 0 && (
                    <span style={caption}>No contributor data</span>
                  )}
                </div>
              </div>

              {/* Attribute area. The panel is identical whether idle or in
                  autocode-select mode — in select mode the cells become
                  click-to-select (green highlight) and only the control buttons
                  below change (a 2×2 grid, per the v2 design). */}
              <>
                <div style={{ flex: 1, minHeight: 480, display: "flex", flexDirection: "column" }}>
                  <AttributesPanel
                    variant="v2"
                    row={currentAttr}
                    originalRow={originalCurrentAttr}
                    mappings={attrMappings}
                    panelHeight={undefined}
                    flex={1}
                    onChange={onAttrChange}
                    onEdit={onEdit}
                    changedFields={changedFieldsByRow[currentIndex] || []}
                    fieldSources={fieldSourcesByRow[currentIndex] || {}}
                    highlightColor="yellow"
                    activeGroupTab={activeAttributeGroupTab}
                    selectionMode={attrCoding}
                    selectedKeys={selectedAttrKeys}
                    selectableKeys={allAttrKeys}
                    onToggleSelect={toggleAttrKey}
                    onEditOptions={(field) => {
                      const raw = currentAttr?.[field];
                      let currentValue = raw != null ? String(raw) : null;
                      if (field === "Issue Type (Slippery)" && !currentValue) currentValue = "Algae";
                      const delineationVal = currentAttr?.["Delineation"];
                      const delineationNotPresent = field === "Delineation Type" && (delineationVal === 2 || delineationVal === "2");
                      setEditingOptions({ field, currentValue, delineationNotPresent });
                    }}
                  />
                </div>
                {attrCoding ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setSelectedAttrKeys(new Set())} style={{ ...btnBase, flex: 1, background: COLOR.gray800 }}>Select None</button>
                      <button onClick={() => setSelectedAttrKeys(new Set(allAttrKeys))} style={{ ...btnBase, flex: 1, background: COLOR.gray800 }}>Select All</button>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => { setAttrCoding(false); setSelectedAttrKeys(new Set()); }} style={{ ...btnBase, flex: 1, background: "transparent", border: `1px solid ${COLOR.borderInput}`, color: COLOR.text }}>Cancel</button>
                      <button onClick={runAutocodeByAttributes} disabled={selectedAttrKeys.size === 0} style={{ ...btnBase, flex: 1, background: COLOR.teal, opacity: selectedAttrKeys.size === 0 ? 0.5 : 1, cursor: selectedAttrKeys.size === 0 ? "not-allowed" : "pointer" }}>Auto-code by Attributes</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setSelectedAttrKeys(new Set()); setAttrCoding(true); }} style={{ ...btnBase, width: "100%", background: COLOR.teal, flexShrink: 0 }}>
                    Auto-code by Attributes
                  </button>
                )}
              </>
            </div>
          </div>
        </div>
      </div>

      {/* Map Preview & Analysis (reused GeoDataPanel) */}
      <GeoDataPanel
        variant="v2"
        projectName={currentProjectName!}
        feature={geoFeatures[currentIndex]?.geometry?.type === "LineString" ? (geoFeatures[currentIndex] as any) : null}
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
        onToggleCurvatureOverlay={() => setShowCurvatureOverlay((v) => !v)}
      />

      {filterContext?.legend && (
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", flexWrap: "wrap" }}>
          <span style={{ ...caption, fontWeight: 700, color: COLOR.gray500 }}>Filter:</span>
          <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: COLOR.text }}>{filterContext.legend.attribute}</span>
          {filterContext.legend.entries.map(({ category, color }) => (
            <span key={category} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray600 }}>{category}</span>
            </span>
          ))}
        </div>
      )}

      {/* Auto-code Validation (reused) */}
      <AutocodeValidation variant="v2" projectName={currentProjectName!} attributes={attrs} panelHeight={350} />

      <ExitConfirmationDialog
        open={isSaveDialogOpen}
        onCancel={() => setIsSaveDialogOpen(false)}
        onDiscardAndExit={onDiscardAndExit}
        onSaveAndExit={onSaveAndExit}
        isSaving={isSaving}
      />

      <ConfirmDialogV2
        open={autocodeConfirm !== null}
        title="Start Autocoding?"
        message={
          autocodeConfirm?.kind === "byAttribute"
            ? `Autocoding will overwrite the ${autocodeConfirm.count} selected attribute${autocodeConfirm.count === 1 ? "" : "s"} on every segment in this project, including any manually verified values. Are you sure you want to proceed?`
            : "Autocoding will overwrite the attributes on this segment, including any manually verified values. Are you sure you want to proceed?"
        }
        confirmLabel="Start Autocoding"
        cancelLabel="Cancel"
        onConfirm={confirmAutocode}
        onCancel={() => setAutocodeConfirm(null)}
      />

      <CodingAttributeModals {...vm} />
    </Box>
  );
}
