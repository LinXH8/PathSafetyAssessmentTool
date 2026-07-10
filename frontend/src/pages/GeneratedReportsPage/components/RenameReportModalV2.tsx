import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toaster } from "../../../components/ui/toaster";
import * as api from "../../../api";
import { FONT, COLOR } from "../../../features/ui/designTokens";
import type { GeneratedReportInfo } from "../../../api";

/**
 * v2 Rename Report modal — a single-field rename dialog built in the same
 * portal-overlay language as `EditProjectModalV2` (Home > Edit), which sidesteps
 * the Zag/Chakra pointer-events freeze bug documented in CLAUDE.md. Self-contained:
 * calls the rename API itself and notifies the container via `onSuccess`.
 */

interface RenameReportModalV2Props {
  open: boolean;
  report: GeneratedReportInfo | null;
  onClose: () => void;
  /** Called after a successful rename with the old and new stored filenames. */
  onSuccess: (oldName: string, newName: string) => void;
}

/** The editable base name (without the `.pdf` extension, re-added server-side). */
const stripPdf = (name: string) => name.replace(/\.pdf$/i, "");

export default function RenameReportModalV2({
  open,
  report,
  onClose,
  onSuccess,
}: RenameReportModalV2Props) {
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed the form whenever the modal (re)opens for a different report.
  useEffect(() => {
    if (open && report) {
      setNewName(stripPdf(report.name));
      window.setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [open, report]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!open || !report) return null;

  async function handleSave() {
    if (!report) return;
    const trimmed = newName.trim();
    if (!trimmed) {
      toaster.create({ title: "Validation Error", description: "Report name cannot be empty", type: "error" });
      return;
    }
    if (trimmed === stripPdf(report.name)) {
      toaster.create({ title: "No Changes", description: "No changes to save", type: "info" });
      onClose();
      return;
    }

    setSaving(true);
    try {
      const result = await api.renameGeneratedReport(report.name, trimmed);
      onSuccess(report.name, result.name || `${trimmed}.pdf`);
      toaster.create({ title: "Success", description: "Report renamed successfully", type: "success" });
      onClose();
    } catch (error: any) {
      toaster.create({
        title: "Rename Failed",
        description: error?.message || "Failed to rename report",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const labelStyle: React.CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: 14, color: COLOR.text };
  const inputStyle: React.CSSProperties = {
    boxSizing: "border-box",
    width: "100%",
    height: 40,
    padding: "8px 12px",
    border: `1px solid ${COLOR.borderInput}`,
    borderRadius: 6,
    fontFamily: FONT,
    fontSize: 16,
    outline: "none",
    background: COLOR.white,
    color: COLOR.text,
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Rename report"
      onMouseDown={() => {
        if (!saving) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 3000,
        background: "rgba(26, 32, 44, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: "100%",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          background: COLOR.white,
          border: `1px solid ${COLOR.border}`,
          borderRadius: 10,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 22px",
            borderBottom: `1px solid ${COLOR.border}`,
          }}
        >
          <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: COLOR.text }}>Rename Report</span>
          <button
            type="button"
            aria-label="Close"
            onClick={() => !saving && onClose()}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 24,
              lineHeight: 1,
              color: COLOR.gray500,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: 22 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={labelStyle}>Report Name</label>
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) handleSave();
              }}
              placeholder="Enter report name"
              style={inputStyle}
            />
            <span style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500 }}>
              The “.pdf” extension is kept automatically.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            padding: "16px 22px",
            borderTop: `1px solid ${COLOR.border}`,
          }}
        >
          <button
            type="button"
            onClick={() => !saving && onClose()}
            disabled={saving}
            style={{
              height: 40,
              padding: "0 18px",
              background: COLOR.white,
              border: `1px solid ${COLOR.borderInput}`,
              borderRadius: 6,
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 16,
              color: COLOR.text,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              height: 40,
              padding: "0 18px",
              background: saving ? COLOR.gray400 : COLOR.blue,
              border: "none",
              borderRadius: 6,
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 16,
              color: COLOR.white,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
