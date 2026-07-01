/**
 * Small presentational primitives shared by the Path Analysis v2 shell and its
 * v2-variant components (FilterPanel, the TRC / Overall-Risk panels). Translated
 * from `temp/psat-design/PSAT Path Analysis.html` Frame 3 + DESIGN_GUIDE.md.
 * Pure presentation — no data, no fetch.
 */
import type { CSSProperties, ReactNode } from "react";
import { FONT, COLOR, RADIUS } from "../../../features/ui/designTokens";

/**
 * Design-guide on/off switch (§7): track 30×16, thumb 12, slides 14px when on.
 * `onColor` defaults to neutral slate; pass a context hue for semantic switches.
 */
export function V2Switch({
  on,
  onClick,
  onColor = COLOR.text,
  size = "md",
}: {
  on: boolean;
  onClick?: () => void;
  onColor?: string;
  size?: "md" | "sm";
}) {
  const trackW = size === "sm" ? 26 : 30;
  const trackH = size === "sm" ? 14 : 16;
  const thumb = size === "sm" ? 10 : 12;
  const travel = trackW - thumb - 4;
  return (
    <div
      onClick={onClick}
      style={{
        width: `${trackW / 16}rem`,
        height: `${trackH / 16}rem`,
        background: on ? onColor : COLOR.borderInput,
        borderRadius: 999,
        flexShrink: 0,
        position: "relative",
        cursor: onClick ? "pointer" : "default",
        transition: "background .15s",
      }}
    >
      <div
        style={{
          width: `${thumb / 16}rem`,
          height: `${thumb / 16}rem`,
          background: COLOR.white,
          borderRadius: "50%",
          position: "absolute",
          top: "0.125rem",
          left: on ? `${(2 + travel) / 16}rem` : "0.125rem",
          boxShadow: "0 1px 2px rgba(0,0,0,.25)",
          transition: "left .15s",
        }}
      />
    </div>
  );
}

/**
 * Segmented control (§5) — view toggle, no accent colour. Container 40px with a
 * 1px border; selected segment white + #1A202C/700, unselected #EDF2F7 + #718096/400.
 */
export function V2Segmented<T extends string>({
  options,
  value,
  onChange,
  height = "2.5rem",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  height?: number | string;
}) {
  return (
    <div
      style={{
        display: "flex",
        height,
        border: `1px solid ${COLOR.border}`,
        borderRadius: RADIUS,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <div
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: "0 1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONT,
              fontSize: "1rem",
              fontWeight: active ? 700 : 400,
              background: active ? COLOR.white : COLOR.gray100,
              color: active ? COLOR.gray800 : COLOR.gray500,
              cursor: "pointer",
              userSelect: "none",
              whiteSpace: "nowrap",
            }}
          >
            {opt.label}
          </div>
        );
      })}
    </div>
  );
}

/**
 * **Standard distribution-hover tooltip** for v2 (the simpler treatment the user
 * preferred over recharts' default outlined card). Use this for EVERY distribution
 * readout — Pie/Bar charts AND stacked-band bars — so they reveal the same numbers
 * the same way: a bold title line + a plain detail line (count + %), thin border,
 * no heavy shadow. See `feedback_distribution_hover_parity.md`.
 */
export function DistTooltipBox({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        background: COLOR.white,
        border: `1px solid ${COLOR.border}`,
        borderRadius: "0.25rem",
        padding: "0.25rem 0.5rem",
        fontFamily: FONT,
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: COLOR.text }}>{title}</div>
      <div style={{ fontSize: "0.75rem", color: COLOR.gray600 }}>{detail}</div>
    </div>
  );
}

/** Tab chip (§6) — joins the card below when active. */
export function v2TabStyle(active: boolean): CSSProperties {
  return {
    padding: "0.5rem 0.8125rem",
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: "1rem",
    lineHeight: 1,
    boxSizing: "border-box",
    cursor: "pointer",
    userSelect: "none",
    borderRadius: "0.375rem 0.375rem 0 0",
    border: `1px solid ${COLOR.border}`,
    borderBottom: active ? "none" : `1px solid ${COLOR.border}`,
    marginBottom: active ? -1 : 0,
    background: active ? COLOR.white : COLOR.gray100,
    color: active ? COLOR.text : COLOR.gray500,
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
}

/**
 * Container for a single-row tab strip (§6): keeps tabs on ONE row and scrolls
 * horizontally rather than wrapping to a second row. Hides the scrollbar chrome.
 */
export const v2TabRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  flexWrap: "nowrap",
  overflowX: "auto",
  overflowY: "hidden",
  flexShrink: 0,
  scrollbarWidth: "none",
};

/** Standard v2 card chrome (§2). */
export function v2CardStyle(extra?: CSSProperties): CSSProperties {
  return {
    background: COLOR.white,
    border: `1px solid ${COLOR.border}`,
    borderRadius: RADIUS,
    boxSizing: "border-box",
    ...extra,
  };
}

/** Accordion item (§14): bordered header + chevron, collapsible body. */
export function AccordionSection({
  title,
  open,
  onToggle,
  children,
  bodyStyle,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  bodyStyle?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        flex: open ? 1 : "0 0 auto",
        overflow: "hidden",
      }}
    >
      <div
        onClick={onToggle}
        style={{
          flexShrink: 0,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          border: `1px solid ${COLOR.border}`,
          padding: "0.625rem 0.875rem",
          borderRadius: RADIUS,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: "1rem", color: COLOR.text }}>
          {title}
        </span>
        <svg
          width="0.875rem"
          height="0.875rem"
          viewBox="0 0 24 24"
          fill="none"
          stroke={COLOR.gray600}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      {open && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            paddingTop: "0.625rem",
            ...bodyStyle,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
