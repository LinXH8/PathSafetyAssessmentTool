/**
 * ReportBuilderLayoutV2.tsx — the v2 presentational shell for the Report Builder.
 *
 * Pure function of the same `ReportBuilderViewModel` the v1 shell consumes
 * (S2.5 container/shell seam). Renders ONLY the chrome — toolbar, left "Sections"
 * reorder panel, the paged report canvas, and the project-picker overlay — wiring
 * every control to a view-model callback. It owns no server state, does no
 * fetching, and never touches sessionStorage. The report canvas and every section
 * body come verbatim from container-owned closures (`vm.renderContent` /
 * `vm.renderViewToggle` / `vm.renderMapColorToggle`).
 *
 * Chrome follows the shared v2 vocabulary used by the Treatment / Projects pages:
 *  - `V2Btn` (DESIGN_GUIDE §4): every button is 40px / 16px·700 / radius 6, kinds
 *    blue·teal·dark·danger·ghost — identical to `TreatmentDetailLayoutV2`.
 *  - Toolbar mirrors Treatment's action row: nav on the left; the page `Stepper`,
 *    the dark `Download ▾` dropdown, and the **danger Reset Layout on the far
 *    right**.
 *  - `V2Checkbox` (DESIGN_GUIDE §7) — the same blue custom box the Home table uses.
 *  - No manual Save / Restore: the layout auto-saves continuously in
 *    `useReportLayout`, so leaving the page (Back / any nav) always persists.
 *
 * Purple INSIDE the rendered report (section bodies) is intentionally untouched.
 * Side effects: none (a transient page-input buffer is local UI state only).
 */
import { useState, useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Menu, Spinner } from "@chakra-ui/react";
import { FaChevronDown } from "react-icons/fa";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import { FONT, COLOR, RADIUS } from "../../../features/ui/designTokens";
import { V2Checkbox } from "../../../components/common/V2Checkbox";
import { CANVAS_W, FILTERED_SECTIONS_ENABLED, PAGE_GAP, PAGE_H } from "../reportBuilderConstants";
import { ReportSection, SortableSectionRow } from "../components/ReportSection";
import type { ReportBuilderViewModel } from "./ReportBuilderViewModel";

// ── Button (DESIGN_GUIDE §4) — same component TreatmentDetailLayoutV2 uses ──
type BtnKind = "blue" | "teal" | "dark" | "danger" | "ghost";
function V2Btn({ kind, children, onClick, disabled, loading, flex, width }: {
  kind: BtnKind; children: ReactNode; onClick?: () => void;
  disabled?: boolean; loading?: boolean; flex?: string | number; width?: string | number;
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
      type="button"
      onClick={onClick}
      disabled={isOff}
      style={{
        height: "2.5rem", padding: "0 1rem", flex, width,
        background: isOff ? COLOR.gray100 : p.bg,
        color: isOff ? COLOR.gray400 : p.fg,
        border: isOff ? `1px solid ${COLOR.border}` : p.border ? `1px solid ${p.border}` : "none",
        borderRadius: RADIUS, fontFamily: FONT, fontWeight: 700, fontSize: "1rem",
        cursor: isOff ? "not-allowed" : "pointer", whiteSpace: "nowrap",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.375rem",
      }}
    >
      {loading && <Spinner size="xs" />}
      {children}
    </button>
  );
}

// Dark dropdown-trigger style (a V2Btn "dark" that Chakra Menu can clone onto).
const dropdownTrigger = (off: boolean): CSSProperties => ({
  height: "2.5rem", padding: "0 1rem",
  background: off ? COLOR.gray100 : COLOR.gray800,
  color: off ? COLOR.gray400 : COLOR.white,
  border: off ? `1px solid ${COLOR.border}` : "none",
  borderRadius: RADIUS, fontFamily: FONT, fontWeight: 700, fontSize: "1rem",
  cursor: off ? "not-allowed" : "pointer", whiteSpace: "nowrap",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.375rem",
});

/** Coding/Treatment-style numeric stepper: text input + stacked ▲/▼. */
function Stepper({ value, onChange, onCommit, onStep, width = 54 }: {
  value: string; onChange: (v: string) => void; onCommit: () => void; onStep: (delta: number) => void; width?: number;
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

/** Render the Report Builder v2 chrome around a container-supplied view-model. */
export function ReportBuilderLayoutV2({ vm }: { vm: ReportBuilderViewModel }) {
  const {
    navigate,
    canvasRef, canvasContainerRef, postTreatmentUploadRef, handlePostTreatmentFileChange,
    autoFitElements, resetLayout,
    goToPage, currentPage, totalPages,
    handleDownloadPDF, handleDownloadWord, exporting,
    hasFilter, includeOverall, toggleIncludeOverall,
    sensors, handleDragEnd, sectionChecklist, elements, hideElement, showElement, scrollToSection,
    renderViewToggle, renderMapColorToggle,
    handleCanvasScroll, canvasH, visibleElements, layout, computeIdealHeight, renderContent,
    showProjectPicker, pickerLoading, availableProjects, pickerSelected, setPickerSelected, loadSelectedProjects,
  } = vm;

  // Transient page-number input buffer (1-based display; goToPage is 0-based).
  const [pageBuf, setPageBuf] = useState(String(currentPage + 1));
  useEffect(() => setPageBuf(String(currentPage + 1)), [currentPage]);
  const commitPage = () => {
    const n = Math.min(totalPages, Math.max(1, parseInt(pageBuf, 10) || 1));
    goToPage(n - 1);
    setPageBuf(String(n));
  };
  const stepPage = (d: number) => goToPage(Math.min(totalPages - 1, Math.max(0, currentPage + d)));

  return (
    <div className="rb-page rb-page--v2">
      <input
        ref={postTreatmentUploadRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handlePostTreatmentFileChange}
      />

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1rem", background: COLOR.white, borderBottom: `1px solid ${COLOR.border}`, flexShrink: 0, fontFamily: FONT }}>
        {/* Left: navigation + layout tidy */}
        <V2Btn kind="ghost" onClick={() => navigate(-1)}>Back</V2Btn>
        <V2Btn kind="ghost" onClick={() => navigate("/analysis/path")}>Path Analysis</V2Btn>
        <V2Btn kind="ghost" onClick={autoFitElements}>Auto-fit</V2Btn>

        {/* Right cluster: page stepper · Download · Reset (danger, far right) */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: "0.75rem", color: COLOR.gray500, textTransform: "uppercase", letterSpacing: 0.4 }}>Page</span>
          <Stepper value={pageBuf} onChange={setPageBuf} onCommit={commitPage} onStep={stepPage} />
          <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1rem", color: COLOR.gray600 }}>/ {totalPages}</span>

          <Menu.Root positioning={{ placement: "bottom-end", strategy: "fixed" }}>
            <Menu.Trigger asChild>
              <button type="button" disabled={!!exporting} style={dropdownTrigger(!!exporting)}>
                {exporting ? "Generating…" : <>Download <FaChevronDown size={10} /></>}
              </button>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content zIndex={2000}>
                <Menu.Item value="pdf" onClick={handleDownloadPDF}>Download PDF</Menu.Item>
                <Menu.Item value="word" onClick={handleDownloadWord}>Download Word</Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>

          <V2Btn kind="danger" onClick={resetLayout}>Reset Layout</V2Btn>
        </div>
      </div>

      {/* ── Main: sections sidebar + report canvas ──────────────────────── */}
      <div className="rb-main">
        <aside className="rb-sections-sidebar">
          <div className="rb-reorder-header">
            <span style={{ fontWeight: 700, color: COLOR.text }}>Report Sections</span>
            <span className="rb-reorder-hint">
              Drag <GripVertical size={11} style={{ verticalAlign: "-2px" }} /> to reorder · check to show / hide
            </span>
          </div>

          {/* Master toggle: append the all-segments "(Overall)" stack (only     */}
          {/* meaningful when a filter is active — report defaults to filtered).  */}
          {FILTERED_SECTIONS_ENABLED && (
            <>
              <label
                title={hasFilter
                  ? "The report shows the segments you filtered in Path Analysis. Check this to also append the overall all-segments sections below."
                  : "Apply a filter in Path Analysis first"}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                  margin: "0 0 4px", borderBottom: `1px solid ${COLOR.border}`,
                  cursor: hasFilter ? "pointer" : "not-allowed", opacity: hasFilter ? 1 : 0.5,
                }}
              >
                <V2Checkbox
                  checked={includeOverall && hasFilter}
                  disabled={!hasFilter}
                  onToggle={toggleIncludeOverall}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: COLOR.text }}>Include overall sections (all segments)</span>
              </label>
              {!hasFilter && (
                <div style={{ fontSize: 10, color: COLOR.gray500, padding: "0 10px 8px", lineHeight: 1.4 }}>
                  Apply a filter on the Path Analysis page to show a filtered report; you can then also append the overall all-segments sections.
                </div>
              )}
            </>
          )}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sectionChecklist.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="rb-reorder-list">
                {sectionChecklist.map((sec, idx) => {
                  const elState = elements.find((e) => e.id === sec.id);
                  const showFilteredHeader = sec.filtered && (idx === 0 || !sectionChecklist[idx - 1].filtered);
                  const isOverallRow = hasFilter && !sec.filtered && sec.id !== "title";
                  const prev = sectionChecklist[idx - 1];
                  const showOverallHeader = isOverallRow && (idx === 0 || !(hasFilter && !prev.filtered && prev.id !== "title"));
                  return (
                    <div key={sec.id}>
                      {showFilteredHeader && (
                        <div style={{ padding: "8px 10px 4px", fontSize: 10, fontWeight: 700, color: COLOR.gray500, textTransform: "uppercase", letterSpacing: 0.5, borderTop: `1px dashed ${COLOR.border}`, marginTop: 4 }}>
                          Filtered sections
                        </div>
                      )}
                      {showOverallHeader && (
                        <div style={{ padding: "8px 10px 4px", fontSize: 10, fontWeight: 700, color: COLOR.gray500, textTransform: "uppercase", letterSpacing: 0.5, borderTop: `1px dashed ${COLOR.border}`, marginTop: 4 }}>
                          Overall sections (all segments)
                        </div>
                      )}
                      <SortableSectionRow
                        id={sec.id}
                        label={sec.label}
                        visible={sec.visible}
                        variant="v2"
                        onToggle={() => (sec.visible ? hideElement(sec.id) : showElement(sec.id))}
                        onSelect={() => scrollToSection(sec.id)}
                      >
                        {elState && sec.visible
                          ? sec.id === "topRisk"
                            ? renderViewToggle(elState)
                            : (elState.type === "map" && elState.filtered)
                              ? renderMapColorToggle(elState)
                              : null
                          : null}
                      </SortableSectionRow>
                    </div>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </aside>

        <div style={{ position: "relative", flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Floating page-nav arrows (right of canvas) */}
          <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, zIndex: 100, pointerEvents: "none" }}>
            <button
              onClick={() => goToPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              style={{ width: 36, height: 36, borderRadius: "50%", border: `1px solid ${COLOR.border}`, background: currentPage === 0 ? COLOR.gray100 : COLOR.white, cursor: currentPage === 0 ? "not-allowed" : "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", opacity: currentPage === 0 ? 0.35 : 1, pointerEvents: "auto", color: COLOR.blue }}
            >▲</button>
            <div style={{ background: COLOR.white, border: `1px solid ${COLOR.border}`, borderRadius: 14, padding: "4px 10px", fontSize: 11, color: COLOR.blue, fontWeight: 700, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", whiteSpace: "nowrap" }}>
              {currentPage + 1} / {totalPages}
            </div>
            <button
              onClick={() => goToPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage >= totalPages - 1}
              style={{ width: 36, height: 36, borderRadius: "50%", border: `1px solid ${COLOR.border}`, background: currentPage >= totalPages - 1 ? COLOR.gray100 : COLOR.white, cursor: currentPage >= totalPages - 1 ? "not-allowed" : "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", opacity: currentPage >= totalPages - 1 ? 0.35 : 1, pointerEvents: "auto", color: COLOR.blue }}
            >▼</button>
          </div>

          <div className="rb-canvas-container" ref={canvasContainerRef} onScroll={handleCanvasScroll}>
            <div className="rb-canvas-hint">
              Reorder &amp; show / hide sections from the left panel · Auto-fit to tidy spacing · Export when ready
            </div>
            <div ref={canvasRef} className="rb-canvas" style={{ width: CANVAS_W, height: canvasH, background: "transparent", boxShadow: "none" }}>
              {Array.from({ length: totalPages }).map((_, i) => (
                <div key={`page-bg-${i}`} style={{ position: "absolute", top: i * PAGE_H, left: 0, width: CANVAS_W, height: PAGE_H, zIndex: 0, pointerEvents: "none" }}>
                  <div style={{
                    width: CANVAS_W,
                    height: PAGE_H - PAGE_GAP,
                    background: "#fff",
                    boxShadow: "0 4px 28px rgba(0, 0, 0, 0.18)",
                  }} />
                  {i < totalPages - 1 && (
                    <div className="rb-page-label" style={{ position: "absolute", bottom: PAGE_GAP / 2 - 5, right: 12, fontSize: 10, color: "#777", fontWeight: 500 }}>
                      Page {i + 1}
                    </div>
                  )}
                </div>
              ))}

              {visibleElements.map((el, orderIndex) => {
                const lay = layout.map.get(el.id);
                return (
                  <ReportSection
                    key={el.id}
                    id={el.id}
                    label={el.label}
                    height={lay?.height ?? computeIdealHeight(el)}
                    marginTop={lay?.marginTop ?? 0}
                    onHide={() => hideElement(el.id)}
                  >
                    {renderContent(el, orderIndex)}
                  </ReportSection>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Project picker overlay ──────────────────────────────────────── */}
      {showProjectPicker && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: COLOR.white, borderRadius: 16, padding: 28, width: 480, maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 16px 48px rgba(0,0,0,0.22)", fontFamily: FONT }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: COLOR.text }}>Select Projects for Report</div>
            <div style={{ fontSize: 13, color: COLOR.gray600, lineHeight: 1.5 }}>
              No projects were carried over from Path Analysis. Select one or more projects below, or go to Path Analysis to load and filter data first.
            </div>
            {pickerLoading ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: COLOR.gray500, fontSize: 14 }}>Loading projects…</div>
            ) : availableProjects.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: COLOR.gray500, fontSize: 14 }}>No projects found on this profile.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <V2Btn kind="ghost" onClick={() => setPickerSelected(new Set(availableProjects))}>Select All</V2Btn>
                  <V2Btn kind="ghost" onClick={() => setPickerSelected(new Set())}>Clear</V2Btn>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: COLOR.gray400 }}>{pickerSelected.size} / {availableProjects.length} selected</span>
                </div>
                <div style={{ overflowY: "auto", flex: 1, maxHeight: 300, display: "flex", flexDirection: "column", gap: 4, border: `1px solid ${COLOR.border}`, borderRadius: 10, padding: "10px 12px" }}>
                  {availableProjects.map((name) => {
                    const checked = pickerSelected.has(name);
                    return (
                      <label key={name} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "7px 8px", borderRadius: 8, background: checked ? "#EBF8FF" : "transparent" }}>
                        <V2Checkbox
                          checked={checked}
                          onToggle={() => setPickerSelected((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; })}
                        />
                        <span style={{ fontSize: 13, color: COLOR.text }}>{name}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <V2Btn kind="ghost" onClick={() => navigate("/analysis/path")}>Path Analysis</V2Btn>
              <V2Btn kind="blue" disabled={pickerSelected.size === 0} onClick={loadSelectedProjects}>
                Load {pickerSelected.size > 0 ? `${pickerSelected.size} Project${pickerSelected.size > 1 ? "s" : ""}` : "Projects"}
              </V2Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
