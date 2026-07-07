/**
 * ReportBuilderLayoutV1.tsx — the v1 presentational shell for the Report
 * Builder.
 *
 * Pure function of the `ReportBuilderViewModel` (S2.5 container/shell seam). It
 * renders the toolbar, save/restore banners, the left "Sections" reorder panel,
 * the paged report canvas, and the project-picker overlay — wiring every control
 * to a view-model callback. It owns no state, does no fetching, and never
 * touches sessionStorage; section bodies come from the container-owned
 * `vm.renderContent` / `vm.renderViewToggle` / `vm.renderMapColorToggle`.
 *
 * The JSX below is byte-identical to the pre-decomposition container return; the
 * only change is that its inputs are destructured from `vm` at the top (so a
 * future `ReportBuilderLayoutV2` can present the same view-model differently).
 *
 * Side effects: none.
 */
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import { CANVAS_W, FILTERED_SECTIONS_ENABLED, PAGE_GAP, PAGE_H } from "../reportBuilderConstants";
import { ReportSection, SortableSectionRow } from "../components/ReportSection";
import type { ReportBuilderViewModel } from "./ReportBuilderViewModel";

/** Render the Report Builder v1 chrome around a container-supplied view-model. */
export function ReportBuilderLayoutV1({ vm }: { vm: ReportBuilderViewModel }) {
  const {
    isV2, accent, navigate,
    canvasRef, canvasContainerRef, postTreatmentUploadRef, handlePostTreatmentFileChange,
    autoFitElements, saveLayout, resetLayout, restoreLayout, hasSaved,
    goToPage, currentPage, totalPages,
    handleDownloadPDF, handleDownloadWord, exporting,
    saveToastVisible, setSaveToastVisible, restoreBannerVisible, setRestoreBannerVisible,
    hasFilter, includeFiltered, toggleIncludeFiltered,
    sensors, handleDragEnd, sectionChecklist, elements, hideElement, showElement, scrollToSection,
    renderViewToggle, renderMapColorToggle,
    handleCanvasScroll, canvasH, visibleElements, layout, computeIdealHeight, renderContent,
    showProjectPicker, pickerLoading, availableProjects, pickerSelected, setPickerSelected, loadSelectedProjects,
  } = vm;

  return (
    <div className={isV2 ? "rb-page rb-page--v2" : "rb-page"}>
      <input
        ref={postTreatmentUploadRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handlePostTreatmentFileChange}
      />
      <div className="rb-toolbar">
        <button className="rb-btn rb-btn-secondary" onClick={() => navigate(-1)}>← Back</button>
        <button className="rb-btn rb-btn-secondary" onClick={() => navigate("/analysis/path")} title="Go to Path Analysis to download table or image exports">↗ Path Analysis</button>

        <button className="rb-btn rb-btn-secondary" onClick={autoFitElements} title="Auto-resize all sections to fit their content and remove gaps">
          ⇅ Auto-fit
        </button>

        <button className="rb-btn rb-btn-secondary" onClick={saveLayout} title="Save your report layout, section arrangement, and text to this browser. The layout will be automatically restored the next time you open the Report Builder.">
          Save layout
        </button>
        <button className="rb-btn rb-btn-secondary" onClick={resetLayout} title="Reset all sections and text to their default values">
          Reset layout
        </button>
        {hasSaved && (
          <button className="rb-btn rb-btn-secondary" onClick={restoreLayout} title="Revert to the last manually saved layout (does not affect live project data)">
            ↩ Restore saved
          </button>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
          <button className="rb-btn rb-btn-secondary" onClick={() => goToPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} style={{ padding: "6px 10px" }}>◀</button>
          <span style={{ fontSize: 12, color: "#555", whiteSpace: "nowrap", minWidth: 64, textAlign: "center" }}>Page {currentPage + 1} / {totalPages}</span>
          <button className="rb-btn rb-btn-secondary" onClick={() => goToPage(Math.min(totalPages - 1, currentPage + 1))} disabled={currentPage >= totalPages - 1} style={{ padding: "6px 10px" }}>▶</button>
        </div>

        <div className="rb-export-group">
          <button className="rb-btn" onClick={handleDownloadPDF} disabled={!!exporting}>
            {exporting === "pdf" ? "Generating…" : "↓ PDF"}
          </button>
          <button className="rb-btn rb-btn-primary" onClick={handleDownloadWord} disabled={!!exporting}>
            {exporting === "word" ? "Generating…" : "↓ Word"}
          </button>
        </div>
      </div>

      {/* ── Save confirmation toast ─────────────────────────────────────── */}
      {saveToastVisible && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", background: "#e8f8e8", borderBottom: "1px solid #b8e0b8", fontSize: 13, color: "#1a5a1a", flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>✓</span>
          <span style={{ flex: 1 }}>
            <strong>Layout saved</strong> — your section arrangement, titles, and settings have been saved to this browser.
            {" "}This layout will be <strong>automatically restored</strong> the next time you open the Report Builder.
            {" "}Use <strong>↩ Restore saved</strong> in the toolbar to revert to this state at any time.
          </span>
          <button
            onClick={() => setSaveToastVisible(false)}
            style={{ padding: "3px 8px", borderRadius: 8, border: "1px solid #90c890", background: "transparent", color: "#2a7a2a", fontSize: 12, cursor: "pointer" }}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Restore banner ──────────────────────────────────────────────── */}
      {restoreBannerVisible && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", background: "#f0e8fc", borderBottom: "1px solid #d8c4f4", fontSize: 13, color: "#5a2a8a", flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>↩</span>
          <span style={{ flex: 1 }}>
            <strong>Layout restored</strong> — your previously saved report layout has been applied automatically.
            {" "}New data from the current session will be loaded into the existing sections.
          </span>
          <button
            onClick={autoFitElements}
            style={{ padding: "3px 10px", borderRadius: 8, border: "1px solid #b090d8", background: "#fff", color: "#7030b8", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            ⇅ Re-fit
          </button>
          <button
            onClick={() => setRestoreBannerVisible(false)}
            style={{ padding: "3px 8px", borderRadius: 8, border: "1px solid #d0c0e8", background: "transparent", color: "#a080c0", fontSize: 12, cursor: "pointer" }}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="rb-main">
        <aside className="rb-sections-sidebar">
          <div className="rb-reorder-header">
            <span style={{ fontWeight: 700, color: accent }}>Report Sections</span>
            <span className="rb-reorder-hint">
              Drag <GripVertical size={11} style={{ verticalAlign: "-2px" }} /> to reorder · check to show / hide
            </span>
          </div>

          {/* ── Master toggle: include Path-Analysis-filtered duplicates ─────── */}
          {/* TEMPORARILY HIDDEN — gated by FILTERED_SECTIONS_ENABLED. */}
          {FILTERED_SECTIONS_ENABLED && (
            <>
              <label
                title={hasFilter
                  ? "Add a filtered copy of every section (except the title) reflecting the segments you filtered in Path Analysis"
                  : "Apply a filter in Path Analysis first"}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                  margin: "0 0 4px", borderBottom: "1px solid #ede8f5",
                  cursor: hasFilter ? "pointer" : "not-allowed", opacity: hasFilter ? 1 : 0.5,
                }}
              >
                <input
                  type="checkbox"
                  checked={includeFiltered && hasFilter}
                  disabled={!hasFilter}
                  onChange={toggleIncludeFiltered}
                  style={{ accentColor: "#a020d0", cursor: hasFilter ? "pointer" : "not-allowed", flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#5a2a8a" }}>Include filtered sections</span>
              </label>
              {!hasFilter && (
                <div style={{ fontSize: 10, color: "#aa8", padding: "0 10px 8px", lineHeight: 1.4 }}>
                  Apply a filter on the Path Analysis page to enable a filtered copy of the report.
                </div>
              )}
            </>
          )}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sectionChecklist.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="rb-reorder-list">
                {sectionChecklist.map((sec, idx) => {
                  const elState = elements.find((e) => e.id === sec.id);
                  // Insert a group header before the first "(Filtered)" row.
                  const showFilteredHeader = sec.filtered && (idx === 0 || !sectionChecklist[idx - 1].filtered);
                  return (
                    <div key={sec.id}>
                      {showFilteredHeader && (
                        <div style={{ padding: "8px 10px 4px", fontSize: 10, fontWeight: 700, color: "#a020d0", textTransform: "uppercase", letterSpacing: 0.5, borderTop: "1px dashed #d8c4f0", marginTop: 4 }}>
                          Filtered sections
                        </div>
                      )}
                      <SortableSectionRow
                        id={sec.id}
                        label={sec.label}
                        visible={sec.visible}
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
          {/* Floating page nav arrows on the right side */}
          <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, zIndex: 100, pointerEvents: "none" }}>
            <button
              onClick={() => goToPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              style={{ width: 36, height: 36, borderRadius: "50%", border: `1px solid ${isV2 ? "#E2E8F0" : "#d0c0e8"}`, background: currentPage === 0 ? "#f0f0f0" : "#fff", cursor: currentPage === 0 ? "not-allowed" : "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", opacity: currentPage === 0 ? 0.35 : 1, pointerEvents: "auto", color: accent }}
            >▲</button>
            <div style={{ background: "#fff", border: `1px solid ${isV2 ? "#E2E8F0" : "#e0d0f0"}`, borderRadius: 14, padding: "4px 10px", fontSize: 11, color: accent, fontWeight: 700, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.1)", whiteSpace: "nowrap" }}>
              {currentPage + 1} / {totalPages}
            </div>
            <button
              onClick={() => goToPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage >= totalPages - 1}
              style={{ width: 36, height: 36, borderRadius: "50%", border: `1px solid ${isV2 ? "#E2E8F0" : "#d0c0e8"}`, background: currentPage >= totalPages - 1 ? "#f0f0f0" : "#fff", cursor: currentPage >= totalPages - 1 ? "not-allowed" : "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", opacity: currentPage >= totalPages - 1 ? 0.35 : 1, pointerEvents: "auto", color: accent }}
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

      {/* ── Project picker overlay ─────────────────────────────────────── */}
      {showProjectPicker && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, width: 480, maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 16px 48px rgba(0,0,0,0.22)" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#2d1a4a" }}>Select Projects for Report</div>
            <div style={{ fontSize: 13, color: "#666", lineHeight: 1.5 }}>
              No projects were carried over from Path Analysis. Select one or more projects below, or go to Path Analysis to load and filter data first.
            </div>
            {pickerLoading ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#888", fontSize: 14 }}>Loading projects…</div>
            ) : availableProjects.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#888", fontSize: 14 }}>No projects found on this profile.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="rb-btn rb-btn-secondary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setPickerSelected(new Set(availableProjects))}>Select All</button>
                  <button className="rb-btn rb-btn-secondary" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setPickerSelected(new Set())}>Clear</button>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "#aaa" }}>{pickerSelected.size} / {availableProjects.length} selected</span>
                </div>
                <div style={{ overflowY: "auto", flex: 1, maxHeight: 300, display: "flex", flexDirection: "column", gap: 4, border: "1px solid #e8e0f0", borderRadius: 10, padding: "10px 12px" }}>
                  {availableProjects.map((name) => {
                    const checked = pickerSelected.has(name);
                    return (
                      <label key={name} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "7px 8px", borderRadius: 8, background: checked ? "#f2e8fc" : "transparent" }}>
                        <input type="checkbox" checked={checked} onChange={() => setPickerSelected((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; })} style={{ accentColor: "#a020d0", width: 16, height: 16, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: "#333" }}>{name}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="rb-btn rb-btn-secondary" onClick={() => navigate("/analysis/path")} style={{ fontSize: 13 }}>← Path Analysis</button>
              <button className="rb-btn" disabled={pickerSelected.size === 0} onClick={loadSelectedProjects} style={{ fontSize: 13 }}>
                Load {pickerSelected.size > 0 ? `${pickerSelected.size} Project${pickerSelected.size > 1 ? "s" : ""}` : "Projects"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
