import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LuCheck } from "react-icons/lu";
import { FONT, COLOR } from "../../../features/ui/designTokens";
import type { ProfileSummary } from "../../../api";

/**
 * v2 Share / Export modal for the Projects page. Built as a plain portal overlay
 * (same pattern as EditProjectModalV2) to sidestep the Zag/Chakra pointer-events
 * freeze bug and stay in the v2 design language.
 *
 * Two modes, chosen by a segmented control (mirrors Create Project's
 * "Create by: Folder | Map"):
 *   - Profile → copy the projects into another profile (optionally keeping tags).
 *   - Export  → download the projects as a re-importable .psat.zip bundle
 *     (optionally keeping tags and/or the raw source images).
 *
 * The modal owns all of its own UI state; the container only provides the busy
 * flag and the two async callbacks.
 */

type ShareMode = "profile" | "export";

interface ShareProjectModalV2Props {
  open: boolean;
  onClose: () => void;
  /** Names of the selected projects (for the summary list + count). */
  projectNames: string[];
  /** Profiles the projects can be shared into (everyone but the active one). */
  shareTargets: ProfileSummary[];
  /** True while a share OR export request is in flight. */
  busy: boolean;
  onShare: (targetProfileId: string, includeTags: boolean) => void;
  onExport: (includeTags: boolean, includeSourceFolder: boolean) => void;
}

export default function ShareProjectModalV2({
  open,
  onClose,
  projectNames,
  shareTargets,
  busy,
  onShare,
  onExport,
}: ShareProjectModalV2Props) {
  const hasTargets = shareTargets.length > 0;

  const [mode, setMode] = useState<ShareMode>(hasTargets ? "profile" : "export");
  const [targetId, setTargetId] = useState<string>(shareTargets[0]?.id ?? "");
  const [includeTags, setIncludeTags] = useState(true);
  const [includeSourceFolder, setIncludeSourceFolder] = useState(true);

  // Re-seed whenever the modal (re)opens.
  useEffect(() => {
    if (open) {
      setMode(hasTargets ? "profile" : "export");
      setTargetId(shareTargets[0]?.id ?? "");
      setIncludeTags(true);
      setIncludeSourceFolder(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const count = projectNames.length;
  const canShare = mode === "profile" && hasTargets && !!targetId;

  const handlePrimary = () => {
    if (busy) return;
    if (mode === "profile") {
      if (!canShare) return;
      onShare(targetId, includeTags);
    } else {
      onExport(includeTags, includeSourceFolder);
    }
  };

  const primaryLabel = mode === "profile"
    ? (busy ? "Sharing…" : "Share")
    : (busy ? "Preparing…" : "Export");
  const primaryDisabled = busy || (mode === "profile" && !canShare);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Share ${count} project${count === 1 ? "" : "s"}`}
      onMouseDown={() => {
        if (!busy) onClose();
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
          <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: COLOR.text }}>
            Share {count} project{count === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={() => !busy && onClose()}
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
          {/* Project summary */}
          <div
            style={{
              background: COLOR.gray100,
              border: `1px solid ${COLOR.border}`,
              borderRadius: 6,
              padding: "10px 12px",
              maxHeight: 108,
              overflowY: "auto",
            }}
          >
            <ul style={{ margin: 0, paddingLeft: 18, listStyle: "disc" }}>
              {projectNames.map((name) => (
                <li
                  key={name}
                  style={{ fontFamily: FONT, fontSize: 13, color: COLOR.text, lineHeight: 1.7 }}
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>

          {/* Share to: segmented control */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={labelStyle}>Share to:</span>
            <div style={{ display: "flex", height: 36, border: `1px solid ${COLOR.border}`, borderRadius: 6, overflow: "hidden" }}>
              <div
                onClick={() => hasTargets && setMode("profile")}
                style={segStyle(mode === "profile", !hasTargets)}
                title={hasTargets ? undefined : "No other profiles to share to"}
              >
                Profile
              </div>
              <div onClick={() => setMode("export")} style={segStyle(mode === "export", false)}>
                Export
              </div>
            </div>
          </div>

          {mode === "profile" ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="shareTargetProfile" style={labelStyle}>
                  Destination profile
                </label>
                <select
                  id="shareTargetProfile"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  disabled={!hasTargets}
                  style={{
                    boxSizing: "border-box",
                    width: "100%",
                    height: 40,
                    padding: "0 12px",
                    border: `1px solid ${COLOR.borderInput}`,
                    borderRadius: 6,
                    fontFamily: FONT,
                    fontSize: 15,
                    background: COLOR.white,
                    color: COLOR.text,
                    cursor: hasTargets ? "pointer" : "not-allowed",
                  }}
                >
                  {hasTargets ? (
                    shareTargets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))
                  ) : (
                    <option value="">No other profiles available</option>
                  )}
                </select>
              </div>

              <CheckRow
                checked={includeTags}
                onToggle={() => setIncludeTags((v) => !v)}
                label="Include tags"
                hint="Copy the projects' tags into the destination profile."
              />
            </>
          ) : (
            <>
              <CheckRow
                checked={includeTags}
                onToggle={() => setIncludeTags((v) => !v)}
                label="Include tags"
                hint="Keep the projects' tags in the exported bundle."
              />
              <CheckRow
                checked={includeSourceFolder}
                onToggle={() => setIncludeSourceFolder((v) => !v)}
                label="Include source folder"
                hint="Bundle the raw survey images. Leave off for a much smaller file."
              />
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 12,
                  color: COLOR.gray500,
                  lineHeight: 1.5,
                }}
              >
                Downloads a <strong style={{ color: COLOR.text }}>.psat.zip</strong> bundle you can
                re-import from the Create Project page.
              </div>
            </>
          )}
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
            onClick={() => !busy && onClose()}
            disabled={busy}
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
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handlePrimary}
            disabled={primaryDisabled}
            style={{
              height: 40,
              padding: "0 18px",
              background: primaryDisabled ? COLOR.gray400 : (mode === "export" ? COLOR.teal : COLOR.blue),
              border: "none",
              borderRadius: 6,
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 16,
              color: COLOR.white,
              cursor: primaryDisabled ? "not-allowed" : "pointer",
            }}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const labelStyle: React.CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: 14, color: COLOR.text };

// Segmented-control segment (matches Create Project's segStyle, §5).
function segStyle(selected: boolean, disabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    padding: "0 18px",
    fontFamily: FONT,
    fontSize: 15,
    cursor: disabled ? "not-allowed" : "pointer",
    userSelect: "none",
    opacity: disabled ? 0.5 : 1,
    ...(selected
      ? { background: COLOR.white, color: COLOR.gray800, fontWeight: 700 }
      : { background: COLOR.gray100, color: COLOR.gray500, fontWeight: 400 }),
  };
}

// A labelled checkbox row using the shared 16×16 v2 checkbox glyph.
function CheckRow({
  checked,
  onToggle,
  label,
  hint,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <div
      onClick={onToggle}
      style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}
    >
      <div style={{ marginTop: 2, ...checkboxBox(checked) }}>{checked && checkSvg}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: COLOR.text }}>{label}</span>
        {hint && (
          <span style={{ fontFamily: FONT, fontSize: 12, color: COLOR.gray500, lineHeight: 1.4 }}>{hint}</span>
        )}
      </div>
    </div>
  );
}

function checkboxBox(checked: boolean): React.CSSProperties {
  return checked
    ? { width: 16, height: 16, background: COLOR.blue, border: `1px solid ${COLOR.blue}`, borderRadius: 2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }
    : { width: 16, height: 16, border: `1px solid ${COLOR.borderInput}`, borderRadius: 2, flexShrink: 0, background: COLOR.white, display: "flex" };
}

const checkSvg = <LuCheck size={10} color="#fff" strokeWidth={3} />;
