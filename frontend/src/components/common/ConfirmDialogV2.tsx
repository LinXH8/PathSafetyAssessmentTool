import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LuX } from "react-icons/lu";
import { FONT, COLOR } from "../../features/ui/designTokens";

/**
 * v2 Confirm dialog — the canonical confirmation popup for the v2 UI.
 *
 * Styled to match EditProjectModalV2 (the first native v2 popup): a plain
 * portal overlay instead of Chakra's <Dialog>, which sidesteps the Zag/Chakra
 * pointer-events freeze bug documented in CLAUDE.md entirely.
 *
 * Use this for every confirm/leave/overwrite prompt in v2. Pass `tone="danger"`
 * for destructive actions (red primary button), otherwise the default blue
 * primary is used.
 */

export type ConfirmTone = "primary" | "danger";

interface ConfirmDialogV2Props {
  open: boolean;
  title: string;
  /** Body content — a string, or arbitrary nodes for richer messaging. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional third button, e.g. "Discard" in a save/discard/cancel flow. */
  tertiaryLabel?: string;
  tone?: ConfirmTone;
  /** Shows a busy state on the confirm button and blocks dismissal. */
  loading?: boolean;
  /** Label shown on the confirm button while `loading`. Defaults to "Working…". */
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onTertiary?: () => void;
}

export default function ConfirmDialogV2({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tertiaryLabel,
  tone = "primary",
  loading = false,
  busyLabel = "Working…",
  onConfirm,
  onCancel,
  onTertiary,
}: ConfirmDialogV2Props) {
  // Escape cancels (unless a request is in flight).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const confirmBg = tone === "danger" ? COLOR.danger : COLOR.blue;

  const btnBase: React.CSSProperties = {
    height: 40,
    padding: "0 18px",
    borderRadius: 6,
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 16,
    lineHeight: 1,
    whiteSpace: "nowrap",
    flexShrink: 0,
    cursor: loading ? "not-allowed" : "pointer",
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={() => {
        if (!loading) onCancel();
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
          width: 440,
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
            onClick={() => !loading && onCancel()}
            style={{
              background: "transparent",
              border: "none",
              cursor: loading ? "not-allowed" : "pointer",
              display: "inline-flex",
              lineHeight: 1,
              color: COLOR.gray500,
              padding: 0,
            }}
          >
            <LuX size={20} />
          </button>
        </div>

        {/* Body */}
        {message != null && (
          <div
            style={{
              padding: 22,
              fontFamily: FONT,
              fontSize: 15,
              lineHeight: 1.55,
              color: COLOR.gray600,
            }}
          >
            {message}
          </div>
        )}

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
            onClick={() => !loading && onCancel()}
            disabled={loading}
            style={{
              ...btnBase,
              background: COLOR.white,
              border: `1px solid ${COLOR.borderInput}`,
              color: COLOR.text,
            }}
          >
            {cancelLabel}
          </button>
          {tertiaryLabel && onTertiary && (
            <button
              type="button"
              onClick={() => !loading && onTertiary()}
              disabled={loading}
              style={{
                ...btnBase,
                background: COLOR.gray800,
                border: "none",
                color: COLOR.white,
              }}
            >
              {tertiaryLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            style={{
              ...btnBase,
              background: loading ? COLOR.gray400 : confirmBg,
              border: "none",
              color: COLOR.white,
            }}
          >
            {loading ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
