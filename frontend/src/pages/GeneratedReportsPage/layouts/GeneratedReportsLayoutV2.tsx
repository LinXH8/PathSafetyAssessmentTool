import type { CSSProperties } from "react";
import { Spinner } from "@chakra-ui/react";
import { FONT, COLOR, RADIUS } from "../../../features/ui/designTokens";
import { v2CardStyle } from "../../PathAnalysisPage/components/paV2Primitives";
import { formatBytes, formatDate } from "../generatedReportsConstants";
import RenameReportModalV2 from "../components/RenameReportModalV2";
import ConfirmDialogV2 from "../../../components/common/ConfirmDialogV2";
import type { GeneratedReportInfo } from "../../../api";
import type { GeneratedReportsViewModel } from "./GeneratedReportsViewModel";

/**
 * v2 Generated Reports shell — a fresh Milestone-B translation of the page to the
 * v2 design system (no comp exists; this follows temp/psat-design/DESIGN_GUIDE.md
 * and mirrors GisLayersLayoutV2). Fluid, forced-light, tokenised.
 *
 * Layout intent (see temp/GENERATED_REPORTS_V2_PLAN.md §5):
 *  - Title on the canvas, no card, no button.
 *  - Left card: "Reports" header (label + filter) and a scrollable list of report
 *    cards. Each card carries inline Edit / Delete actions (the GisLayers idiom);
 *    Edit opens the RenameReportModalV2 (Home > Edit pattern), Delete confirms
 *    inline.
 *  - Right card: the selected report's PDF embed only — no header. Users download
 *    via the browser's built-in PDF viewer controls.
 */

// 400px panel → 25rem (density catalog). Fixed rem, never raw vw.
const LEFT_W = "25rem";

const labelStyle: CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: "1rem", color: COLOR.text };
const captionStyle: CSSProperties = { fontFamily: FONT, fontWeight: 400, fontSize: "0.75rem", color: COLOR.gray500 };
const inputStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: "2.5rem",
  padding: "0.5rem 0.75rem",
  border: `1px solid ${COLOR.borderInput}`,
  borderRadius: RADIUS,
  fontFamily: FONT,
  fontSize: "1rem",
  outline: "none",
  background: COLOR.white,
  color: COLOR.text,
};

/** Small inline row action (Edit / Delete) — the GisLayers idiom. */
function RowBtn({ label, color, onClick }: { label: string; color: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        padding: "0.125rem 0.25rem",
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: "0.75rem",
        color,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

export default function GeneratedReportsLayoutV2(vm: GeneratedReportsViewModel) {
  const {
    reports, filtered, loading, error,
    filterText, setFilterText,
    selected, onSelect, previewUrl,
    editingReport, onEditClick, onCloseEdit, onRenamed,
    confirmDelete, onDeleteClick, onCancelDelete, onConfirmDelete,
    actionLoading, actionError, onClearActionError,
  } = vm;

  const listPadded = !(loading || error || filtered.length === 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        padding: "2rem",
        boxSizing: "border-box",
        height: "100vh",
        overflow: "hidden",
        background: COLOR.canvas,
        fontFamily: FONT,
      }}
    >
      {/* ── Title (on canvas, no card, no button) ── */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1.25rem", color: COLOR.text }}>
          Generated Reports
        </div>
        <div style={{ ...captionStyle, marginTop: "0.25rem" }}>
          PDF reports exported from the Report Builder are saved here automatically.
        </div>
      </div>

      {/* ── Content: reports panel + preview ── */}
      <div style={{ display: "flex", gap: "1rem", flex: 1, minHeight: 0 }}>
        {/* Left: Reports panel */}
        <div
          style={{
            ...v2CardStyle(),
            flex: `0 0 ${LEFT_W}`,
            width: LEFT_W,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header: label + filter */}
          <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem", flexShrink: 0 }}>
            <span style={labelStyle}>Reports</span>
            <input
              type="text"
              placeholder="Filter reports…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Action error banner */}
          {actionError && (
            <div
              style={{
                margin: "0 1rem 0.5rem",
                padding: "0.5rem 0.75rem",
                background: COLOR.dangerBg,
                border: `1px solid ${COLOR.danger}`,
                borderRadius: RADIUS,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
              }}
            >
              <span style={{ fontFamily: FONT, fontSize: "0.75rem", color: COLOR.danger }}>{actionError}</span>
              <button
                onClick={onClearActionError}
                style={{ background: "transparent", border: "none", color: COLOR.danger, cursor: "pointer", fontSize: "0.875rem", lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Scrollable report list — each report is its own v2 card */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              borderTop: `1px solid ${COLOR.border}`,
              background: COLOR.canvas,
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              padding: listPadded ? "0.75rem" : 0,
            }}
          >
            {loading ? (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "center", padding: "2rem", fontFamily: FONT, fontSize: "1rem", color: COLOR.gray500 }}>
                <Spinner size="sm" /> Loading reports…
              </div>
            ) : error ? (
              <div style={{ padding: "1rem", fontFamily: FONT, fontSize: "1rem", color: COLOR.danger }}>{error}</div>
            ) : reports.length === 0 ? (
              <div style={{ padding: "1rem", ...captionStyle }}>
                No reports found. Download a PDF from the Report Builder to save one here.
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "1rem", ...captionStyle }}>
                No reports match “{filterText}”.
              </div>
            ) : (
              filtered.map((report) => (
                <ReportItem
                  key={report.name}
                  report={report}
                  selected={selected?.name === report.name}
                  onSelect={onSelect}
                  onEditClick={onEditClick}
                  onDeleteClick={onDeleteClick}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: PDF embed only (no header — download via the built-in viewer) */}
        <div style={{ ...v2CardStyle(), flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {selected && previewUrl ? (
            <iframe
              key={previewUrl}
              src={previewUrl}
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
              title={selected.name}
            />
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
              <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1rem", color: COLOR.gray600 }}>No report selected</span>
              <span style={captionStyle}>Select a report from the list to preview it here.</span>
            </div>
          )}
        </div>
      </div>

      {/* Rename modal (Home > Edit pattern) */}
      <RenameReportModalV2
        open={editingReport != null}
        report={editingReport}
        onClose={onCloseEdit}
        onSuccess={onRenamed}
      />

      {/* Delete confirmation (canonical v2 ConfirmDialogV2, tone=danger) */}
      <ConfirmDialogV2
        open={confirmDelete != null}
        title="Delete report?"
        message={
          <>
            Delete <strong style={{ color: COLOR.text }}>{confirmDelete}</strong>? This cannot be undone.
          </>
        }
        tone="danger"
        confirmLabel="Delete"
        busyLabel="Deleting…"
        loading={actionLoading}
        onConfirm={() => { if (confirmDelete) onConfirmDelete(confirmDelete); }}
        onCancel={onCancelDelete}
      />
    </div>
  );
}

// ── A single report card in the list — selector + inline Edit / Delete ──
function ReportItem({
  report, selected,
  onSelect, onEditClick, onDeleteClick,
}: {
  report: GeneratedReportInfo;
  selected: boolean;
  onSelect: (r: GeneratedReportInfo | null) => void;
  onEditClick: (r: GeneratedReportInfo) => void;
  onDeleteClick: (name: string) => void;
}) {
  return (
    <div
      onClick={() => onSelect(selected ? null : report)}
      style={{
        ...v2CardStyle(),
        padding: "0.75rem",
        cursor: "pointer",
        border: `1px solid ${selected ? COLOR.blue : COLOR.border}`,
        boxShadow: selected ? `0 0 0 1px ${COLOR.blue}` : "none",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {/* Name row + actions */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <span
          title={report.name}
          style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1rem", color: COLOR.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}
        >
          {report.name}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.125rem", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          <RowBtn label="Edit" color={COLOR.blue} onClick={(e) => { e.stopPropagation(); onEditClick(report); }} />
          <RowBtn label="Delete" color={COLOR.danger} onClick={(e) => { e.stopPropagation(); onDeleteClick(report.name); }} />
        </div>
      </div>

      {/* Metadata row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
        <span style={captionStyle}>{formatBytes(report.size)}</span>
        <span style={captionStyle}>·</span>
        <span style={captionStyle}>{formatDate(report.created)}</span>
      </div>
    </div>
  );
}
