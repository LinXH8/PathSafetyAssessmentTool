import { useEffect, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FONT, COLOR } from "../../features/ui/designTokens";

/**
 * v2 modal shell for the Landing / Profile page dialogs.
 *
 * Built as a plain portal overlay (never Chakra <Dialog>) so it:
 *   - is light-only and self-contained — no `--chakra-colors-*` vars, so it can
 *     never inherit the v1 dark-mode surface the old Dialog-based popups did.
 *   - sidesteps the Zag/Chakra pointer-events freeze bug documented in CLAUDE.md.
 *   - matches EditProjectModalV2 / ConfirmDialogV2 exactly (the canonical v2 popups).
 *
 * The caller supplies body content and a pre-composed `footer` (usually the
 * shared button styles exported below).
 */

interface LandingModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Blocks dismissal (Escape / backdrop / ×) while a request is in flight. */
  busy?: boolean;
  /** Body width in px. Defaults to 460 (form dialogs); Manage uses 560. */
  width?: number;
  children: ReactNode;
  footer: ReactNode;
}

export default function LandingModal({
  open,
  title,
  onClose,
  busy = false,
  width = 460,
  children,
  footer,
}: LandingModalProps) {
  // Escape closes (unless a request is in flight).
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
        zIndex: 3100,
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
          <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: COLOR.text }}>
            {title}
          </span>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 22 }}>
          {children}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            flexWrap: "wrap",
            gap: 10,
            padding: "16px 22px",
            borderTop: `1px solid ${COLOR.border}`,
          }}
        >
          {footer}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Landing accent ───────────────────────────────────────────────────
 * The landing keeps its green identity (solid — no gradients/shadows). Modal
 * primaries are recoloured from the v2 blue to this green so the popups read as
 * the same surface as the page behind them. Keep these in sync with the matching
 * hexes in landingPage.css. */
export const LANDING_GREEN = "#2AA45F";
export const LANDING_GREEN_HOVER = "#23864C";

/* ── Shared field / button styles (v2 tokens) ─────────────────────────── */

export const modalCopyStyle: CSSProperties = {
  fontFamily: FONT,
  fontSize: 16,
  lineHeight: 1.5,
  color: COLOR.gray600,
};

export const modalLabelStyle: CSSProperties = {
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 16,
  color: COLOR.text,
};

export const modalInputStyle: CSSProperties = {
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

export const modalSectionTitleStyle: CSSProperties = {
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 16,
  color: COLOR.text,
};

const btnBase: CSSProperties = {
  height: 40,
  padding: "0 18px",
  borderRadius: 6,
  fontFamily: FONT,
  fontWeight: 700,
  fontSize: 16,
  lineHeight: 1,
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export function ghostBtnStyle(disabled: boolean): CSSProperties {
  return {
    ...btnBase,
    background: COLOR.white,
    border: `1px solid ${COLOR.borderInput}`,
    color: COLOR.text,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

export function primaryBtnStyle(disabled: boolean): CSSProperties {
  return {
    ...btnBase,
    background: disabled ? COLOR.gray100 : LANDING_GREEN,
    border: disabled ? `1px solid ${COLOR.border}` : "none",
    color: disabled ? COLOR.gray400 : COLOR.white,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

export function dangerBtnStyle(disabled: boolean): CSSProperties {
  return {
    ...btnBase,
    background: disabled ? COLOR.gray100 : COLOR.danger,
    border: disabled ? `1px solid ${COLOR.border}` : "none",
    color: disabled ? COLOR.gray400 : COLOR.white,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

/** Ghost variant tinted red — used for the "Delete Profile" action in Manage. */
export function dangerGhostBtnStyle(disabled: boolean): CSSProperties {
  return {
    ...btnBase,
    background: COLOR.white,
    border: `1px solid ${COLOR.danger}`,
    color: COLOR.danger,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
