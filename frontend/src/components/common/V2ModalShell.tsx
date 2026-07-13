import { useEffect } from "react";
import { createPortal } from "react-dom";
import { FONT, COLOR } from "../../features/ui/designTokens";

/**
 * Shared v2 modal shell — a plain portal overlay (no Chakra Dialog, so it
 * sidesteps the Zag pointer-events freeze bug documented in CLAUDE.md) with the
 * standard v2 chrome: darkened backdrop, white rounded card, header row with a
 * title + close ×, a padded body, and an optional right-aligned footer.
 *
 * Used by the Create Project import modals (Import Project / Import Source) so
 * they share one look. EditProjectModalV2 / ShareProjectModalV2 predate this and
 * inline the same structure.
 */

interface V2ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Card width in px (default 480). */
  width?: number;
  /** While true, backdrop-click / Escape / × are disabled (request in flight). */
  busy?: boolean;
  children: React.ReactNode;
  /** Right-aligned footer content (usually the action buttons). */
  footer?: React.ReactNode;
}

export default function V2ModalShell({
  open,
  onClose,
  title,
  width = 480,
  busy = false,
  children,
  footer,
}: V2ModalShellProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
          width,
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
          <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: COLOR.text }}>{title}</span>
          <button
            type="button"
            aria-label="Close"
            onClick={() => !busy && onClose()}
            style={{
              background: "transparent",
              border: "none",
              cursor: busy ? "not-allowed" : "pointer",
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
        <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: 22 }}>{children}</div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 12,
              padding: "16px 22px",
              borderTop: `1px solid ${COLOR.border}`,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Shared v2 modal button styles ──────────────────────────────────────────────

export const modalLabelStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 14,
  color: COLOR.text,
};

export const modalInputStyle: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: 40,
  padding: "8px 12px",
  border: `1px solid ${COLOR.borderInput}`,
  borderRadius: 6,
  fontFamily: FONT,
  fontSize: 15,
  outline: "none",
  background: COLOR.white,
  color: COLOR.text,
};

export function modalPrimaryBtn(
  disabled: boolean,
  tone: "blue" | "teal" | "danger" = "blue"
): React.CSSProperties {
  const bg = tone === "teal" ? COLOR.teal : tone === "danger" ? COLOR.danger : COLOR.blue;
  return {
    height: 40,
    padding: "0 18px",
    background: disabled ? COLOR.gray400 : bg,
    border: "none",
    borderRadius: 6,
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 16,
    color: COLOR.white,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

export function modalGhostBtn(disabled = false): React.CSSProperties {
  return {
    height: 40,
    padding: "0 18px",
    background: COLOR.white,
    border: `1px solid ${COLOR.borderInput}`,
    borderRadius: 6,
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 16,
    color: COLOR.text,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
