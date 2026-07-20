/**
 * In-Image Path Measurement — Measure mode for the Coding page.
 *
 * A portal modal (NOT a Chakra Dialog — avoids the documented Zag pointer-events
 * freeze) that overlays a metric grid + perpendicular ruler on the current
 * segment's street-level frame. All geometry comes from measureMath.ts, whose
 * math is validated exact; this file is only canvas drawing + controls.
 *
 * Reliable path: click the 4 corners of a known-size flat anchor (drain grating /
 * tactile mat / custom rectangle) -> exact ground solve. Manual dials
 * (pitch/height/roll/yaw/k1) refine or handle anchor-less frames.
 *
 * Chrome follows the v2 design system (ConfirmDialogV2 / ShareProjectModalV2
 * patterns, designTokens COLOR/FONT, light-only). Canvas overlay colours (OV)
 * are content drawn over the photo, not chrome.
 *
 * v1: live read-off only (persistence deferred per the design doc).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuChevronDown, LuX } from "react-icons/lu";
import { COLOR, FONT } from "../../../../features/ui/designTokens";
import {
  makeRig, solveAnchor, pxToGround, groundToPx, band,
  IMG_W, IMG_H, TRUSTED_M, GRATING_SIZES, TACTILE_SIZES,
  type AnchorSize, type Rig, type Vec2,
} from "./measureMath";

type Mode = "ruler" | "anchor" | "none";

type AnchorType = "drain" | "tactile" | "custom";
const ANCHOR_LABEL: Record<AnchorType, string> = {
  drain: "drain grating", tactile: "tactile tile / mat", custom: "custom object",
};
const CORNER_NAMES = ["near-left", "near-right", "far-right", "far-left"];
const defaultStatus = (t: AnchorType) => `Click the 4 corners of the ${ANCHOR_LABEL[t]} to solve exactly.`;

type Props = { projectName: string; imageRef: string; open: boolean; onClose: () => void };

/** Canvas OVERLAY colours only — drawn over the photograph (content, not UI chrome).
 *  Risk-band hues from colorConstants; UI chrome uses the v2 designTokens COLOR set. */
const OV = {
  blue: "#3182CE", green: "#87C424", amber: "#FFCC1A", red: "#FF5B1A", purple: "#CD1AFF",
};

// v2 status colours (chrome)
const GREEN_OK = "#2F855A";   // anchored confirmation text
const AMBER_WARN = "#C05621"; // beyond-trusted-zone warning text

export default function MeasureModal({ projectName, imageRef, open, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);

  const [rig, setRig] = useState<Rig>(() => makeRig());
  const [mode, setMode] = useState<Mode>("anchor");
  const [picks, setPicks] = useState<Vec2[]>([]);
  const [anchorPts, setAnchorPts] = useState<Vec2[]>([]);
  const [anchorType, setAnchorType] = useState<AnchorType>("drain");
  const [sizeIdx, setSizeIdx] = useState(0);       // drain sizes
  const [tactileIdx, setTactileIdx] = useState(0); // tactile sizes
  const [customNear, setCustomNear] = useState(500);
  const [customSide, setCustomSide] = useState(500);
  const [anchored, setAnchored] = useState(false);
  const [statusMsg, setStatusMsg] = useState(defaultStatus("drain"));
  const [calOpen, setCalOpen] = useState(false); // Calibrate accordion (fallback path, collapsed by default)

  const activeSize: AnchorSize = useMemo(() => {
    if (anchorType === "drain") return GRATING_SIZES[sizeIdx];
    if (anchorType === "tactile") return TACTILE_SIZES[tactileIdx];
    return { label: "custom", near: customNear, side: customSide };
  }, [anchorType, sizeIdx, tactileIdx, customNear, customSide]);

  // display scale: fit the 640x457 frame into the viewport, capped
  const S = useMemo(() => {
    if (typeof window === "undefined") return 1.4;
    return Math.max(0.8, Math.min(1.7, (0.66 * window.innerHeight) / IMG_H, (0.62 * window.innerWidth) / IMG_W));
  }, []);

  // load the segment frame (same URL as ImagePanel)
  useEffect(() => {
    if (!open || !imageRef) return;
    setImgReady(false);
    const im = new Image();
    im.onload = () => { imgElRef.current = im; setImgReady(true); };
    im.src = `/api/projects/${encodeURIComponent(projectName)}/images/${encodeURIComponent(imageRef)}`;
    return () => { im.onload = null; };
  }, [open, imageRef, projectName]);

  // reset per-frame state when the frame or the modal opening changes
  // (anchor TYPE is intentionally kept — a street's frames tend to share anchors)
  useEffect(() => {
    if (!open) return;
    setRig(makeRig());
    setMode("anchor"); setPicks([]); setAnchorPts([]); setAnchored(false);
    setStatusMsg(defaultStatus(anchorType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imageRef]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ---- readout (derived, pure). The empty-state sub doubles as the ruler
  // guidance (the separate mode-hint block was cut in the consolidation pass).
  const readout = useMemo(() => {
    if (mode === "ruler" && picks.length >= 1) {
      const o = picks[0];
      if (picks.length < 2) return { main: "—", sub: "now click the obstacle to read the clearance", far: Math.hypot(o[0], o[1]) };
      const t = picks[1];
      const across = t[0] - o[0];
      const b = band(o[0], o[1]) + band(t[0], t[1]);
      return {
        main: `${Math.abs(across).toFixed(2)} m ${across < 0 ? "left" : "right"}`,
        sub: `± ${(b * 100).toFixed(0)} cm · clear width from your mark`, far: Math.hypot(t[0], t[1]),
      };
    }
    if (mode === "ruler") return { main: "—", sub: "click the path edge you're widening from, then the obstacle", far: 0 };
    return { main: "—", sub: "", far: 0 };
  }, [mode, picks]);

  // ---- drawing -------------------------------------------------------------
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (imgElRef.current) ctx.drawImage(imgElRef.current, 0, 0, cv.width, cv.height);
    else { ctx.fillStyle = COLOR.gray100; ctx.fillRect(0, 0, cv.width, cv.height); }

    const g2 = (X: number, Y: number) => groundToPx(rig, X, Y);
    const polyGround = (pts: Vec2[], style: string, width: number, dash: number[] = []) => {
      ctx.save(); ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
      let pen = false;
      for (const [X, Y] of pts) {
        const p = g2(X, Y);
        if (!p) { pen = false; continue; }
        const x = p[0] * S, y = p[1] * S;
        if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.restore();
    };
    const groundLine = (x0: number, y0: number, x1: number, y1: number, style: string, w: number, dash: number[] = [], n = 64) => {
      const pts: Vec2[] = [];
      for (let i = 0; i <= n; i++) { const t = i / n; pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); }
      polyGround(pts, style, w, dash);
    };
    const dot = (X: number, Y: number, style: string) => {
      const p = g2(X, Y); if (!p) return;
      ctx.fillStyle = style; ctx.beginPath(); ctx.arc(p[0] * S, p[1] * S, 5, 0, 7); ctx.fill();
    };

    if (!rig.Hinv) groundLine(-400, 400, 400, 400, OV.amber, 1.5, [7, 5], 160); // horizon (unanchored)

    // anchor overlay
    if (anchorPts.length) {
      if (anchorPts.length === 4) {
        ctx.strokeStyle = OV.red; ctx.lineWidth = 2.5; ctx.setLineDash([]); ctx.beginPath();
        anchorPts.forEach((p, i) => (i ? ctx.lineTo(p[0] * S, p[1] * S) : ctx.moveTo(p[0] * S, p[1] * S)));
        ctx.closePath(); ctx.stroke();
      }
      anchorPts.forEach((p, i) => {
        ctx.fillStyle = OV.red; ctx.beginPath(); ctx.arc(p[0] * S, p[1] * S, 5, 0, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "700 10px Inter,sans-serif"; ctx.fillText(String(i + 1), p[0] * S + 7, p[1] * S - 6);
      });
    }

    const showGrid = mode === "ruler" || (mode === "anchor" && !!rig.Hinv);
    if (showGrid) {
      // Y0 negative: the anchor's origin can sit metres ahead of the camera, so the
      // grid stretches back TOWARD the viewer; behind-camera points are clipped by
      // groundToPx (not wrapped), so the extra extent costs nothing.
      const X0 = -4, X1 = 4, Y0 = -8, Y1 = 8;
      for (let x = X0; x <= X1; x++) {
        const inT = Math.abs(x) <= TRUSTED_M;
        groundLine(x, Y0, x, Y1, x === 0 ? OV.blue : inT ? "rgba(135,196,36,.85)" : "rgba(135,196,36,.30)", x === 0 ? 2 : 1, [], 128);
      }
      for (let y = Math.ceil(Y0); y <= Y1; y++) {
        const inT = y <= TRUSTED_M;
        groundLine(X0, y, X1, y, inT ? "rgba(135,196,36,.85)" : "rgba(135,196,36,.30)", 1);
        if (y >= 0) {
          const p = g2(X1, y);
          if (p) { ctx.fillStyle = inT ? OV.green : "rgba(135,196,36,.45)"; ctx.font = "600 11px Inter,sans-serif"; ctx.fillText(y + " m", p[0] * S + 4, p[1] * S + 4); }
        }
      }
      groundLine(-6, TRUSTED_M, 6, TRUSTED_M, OV.amber, 1.5, [4, 4]);
    }

    if (mode === "ruler" && picks.length) {
      const o = picks[0];
      groundLine(o[0] - 6, o[1], o[0] + 6, o[1], OV.blue, 2);
      for (let d = -6; d <= 6; d += 0.5) {
        const p = g2(o[0] + d, o[1]); if (!p) continue;
        const big = Number.isInteger(d);
        ctx.strokeStyle = OV.blue; ctx.lineWidth = big ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(p[0] * S, p[1] * S - (big ? 7 : 4)); ctx.lineTo(p[0] * S, p[1] * S + (big ? 7 : 4)); ctx.stroke();
        if (big && d !== 0) { ctx.fillStyle = "#9ecbf0"; ctx.font = "600 10px Inter,sans-serif"; ctx.fillText(Math.abs(d) + "m", p[0] * S - 8, p[1] * S + 20); }
      }
      dot(o[0], o[1], OV.red);
      if (picks.length >= 2) { const t = picks[1]; groundLine(o[0], o[1], t[0], o[1], OV.purple, 2.5); dot(t[0], t[1], OV.purple); }
    }
  }, [rig, mode, picks, anchorPts, imgReady, S]);

  useEffect(() => { draw(); }, [draw]);

  // ---- interactions --------------------------------------------------------
  const patchRig = (p: Partial<Rig>, breakAnchor = false) =>
    setRig((r) => {
      const next = { ...r, ...p };
      if (breakAnchor && r.Hinv) { next.H = null; next.Hinv = null; next.anchorYaw = 0; setAnchored(false); setStatusMsg("Manual — started from the anchor's values, now free. Re-anchor to snap back to the exact solve."); }
      return next;
    });

  // sz is passed explicitly by the size/type controls: reading state here would be
  // one render stale, silently re-solving with the PREVIOUS size (the old diagonal-grid bug).
  const doSolveAnchor = (pts: Vec2[], sz: AnchorSize = activeSize) => {
    if (!(sz.near >= 50) || !(sz.side >= 50)) {
      setStatusMsg("Enter the object's real size first — both edges at least 50 mm.");
      return;
    }
    const res = solveAnchor(rig, pts, sz.near, sz.side);
    if (!res) {
      setAnchored(false);
      setStatusMsg("Degenerate — re-click the 4 corners in order (see below).");
      setRig((r) => ({ ...r, H: null, Hinv: null, anchorYaw: 0 }));
      return;
    }
    const d = res.decomp;
    // anchorYaw = d.yaw makes the grid start aligned with the anchor's side edge;
    // the yaw dial then spins it identically in the anchored and manual paths.
    setRig((r) => ({ ...r, H: res.H, Hinv: res.Hinv, height: d.h, pitch: d.pitch, roll: d.roll, yaw: d.yaw, anchorYaw: d.yaw }));
    setAnchored(true);
    setMode("ruler"); setPicks([]); // straight into measuring — ruler is the tool
    setStatusMsg(`Anchored (exact) on ${sz.near} × ${sz.side} mm. Ruler ready.`);
  };

  const switchAnchorType = (t: AnchorType) => {
    setAnchorType(t);
    const sz: AnchorSize =
      t === "drain" ? GRATING_SIZES[sizeIdx]
      : t === "tactile" ? TACTILE_SIZES[tactileIdx]
      : { label: "custom", near: customNear, side: customSide };
    if (anchorPts.length === 4) doSolveAnchor(anchorPts, sz);
    else setStatusMsg(defaultStatus(t));
  };

  const onCustomDim = (which: "near" | "side", raw: string) => {
    const v = Math.max(0, Math.round(parseFloat(raw) || 0));
    if (which === "near") setCustomNear(v); else setCustomSide(v);
    const near = which === "near" ? v : customNear;
    const side = which === "side" ? v : customSide;
    if (anchorPts.length === 4 && near >= 50 && side >= 50)
      doSolveAnchor(anchorPts, { label: "custom", near, side });
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current; if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const px = ((e.clientX - rect.left) * (cv.width / rect.width)) / S;
    const py = ((e.clientY - rect.top) * (cv.height / rect.height)) / S;

    if (mode === "anchor") {
      // computed from the render-time value, not inside the updater — solving is a
      // side effect and must not run inside setState
      const next: Vec2[] = anchorPts.length >= 4 ? [[px, py]] : [...anchorPts, [px, py]];
      setAnchorPts(next);
      if (next.length === 4) doSolveAnchor(next);
      else setStatusMsg(`Corner ${next.length}/4 placed — next: ${CORNER_NAMES[next.length]}.`);
      return;
    }
    if (mode !== "ruler") return; // "none" = nothing selected, clicks are inert
    const g = pxToGround(rig, px, py);
    if (!g) return;
    setPicks((prev) => { const next = [...prev, g]; return next.length > 2 ? next.slice(-2) : next; });
  };

  const resetAll = () => {
    setRig(makeRig()); setPicks([]); setAnchorPts([]); setAnchored(false); setMode("anchor");
    setStatusMsg(defaultStatus(anchorType));
  };
  const clearAnchor = () => {
    setAnchorPts([]); setAnchored(false); setMode("anchor");
    setRig((r) => ({ ...r, H: null, Hinv: null, anchorYaw: 0 }));
    setStatusMsg(defaultStatus(anchorType));
  };

  if (!open) return null;

  // v2 button (DESIGN_GUIDE §4, mirrors V2Btn in the Treatment/Report shells):
  // 40px tall, radius 6, Inter 700 16. active = blue solid, otherwise ghost.
  const btn = (label: React.ReactNode, active: boolean, onClick: () => void, extra: React.CSSProperties = {}) => (
    <button type="button" onClick={onClick} style={{
      height: "2.5rem", padding: "0 1rem",
      background: active ? COLOR.blue : "transparent",
      color: active ? COLOR.white : COLOR.text,
      border: active ? "none" : `1px solid ${COLOR.borderInput}`,
      borderRadius: 6, fontFamily: FONT, fontWeight: 700, fontSize: 15,
      cursor: "pointer", whiteSpace: "nowrap",
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.375rem",
      ...extra,
    }}>{label}</button>
  );

  // v2 segmented control (matches ShareProjectModalV2 / Create Project segStyle)
  const seg = (label: string, selected: boolean, onClick: () => void) => (
    <div key={label} onClick={onClick} style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      padding: "0 10px", fontFamily: FONT, fontSize: 15, cursor: "pointer", userSelect: "none",
      ...(selected
        ? { background: COLOR.white, color: COLOR.gray800, fontWeight: 700 }
        : { background: COLOR.gray100, color: COLOR.gray500, fontWeight: 400 }),
    }}>{label}</div>
  );

  const inputStyle: React.CSSProperties = {
    boxSizing: "border-box", height: 40, padding: "0 12px",
    border: `1px solid ${COLOR.borderInput}`, borderRadius: 6,
    fontFamily: FONT, fontSize: 15, background: COLOR.white, color: COLOR.text,
  };
  const sectionTitle: React.CSSProperties = { fontFamily: FONT, fontWeight: 700, fontSize: 15, color: COLOR.text, marginBottom: 8 };
  const hintText: React.CSSProperties = { fontFamily: FONT, fontSize: 13, lineHeight: 1.55, color: COLOR.gray500 };

  const slider = (label: string, sub: string, key: keyof Rig, min: number, max: number, step: number, fmt: (v: number) => string, breakA: boolean) => (
    <label style={{ display: "block", margin: "6px 0", fontFamily: FONT, fontSize: 13.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ color: COLOR.text, fontWeight: 600 }}>{label} <span style={{ color: COLOR.gray500, fontWeight: 400 }}>{sub}</span></span>
        <span style={{ color: COLOR.gray600, fontVariantNumeric: "tabular-nums" }}>{fmt(rig[key] as number)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={rig[key] as number} style={{ width: "100%", accentColor: COLOR.blue }}
        onChange={(e) => patchRig({ [key]: parseFloat(e.target.value) } as Partial<Rig>, breakA)} />
    </label>
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="In-Image Path Measurement"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 3100,
        background: "rgba(26, 32, 44, 0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div style={{
        background: COLOR.white, border: `1px solid ${COLOR.border}`, borderRadius: 10,
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        maxWidth: "96vw", maxHeight: "calc(100vh - 48px)", overflow: "hidden",
        display: "flex", flexDirection: "column", fontFamily: FONT,
      }}>
        {/* Header (fixed) */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: `1px solid ${COLOR.border}` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 20, color: COLOR.text }}>In-Image Path Measurement</span>
            <span style={{ fontFamily: FONT, fontSize: 13, color: COLOR.gray500 }}>planning-grade, ±0.4–0.5 m near field</span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ background: "transparent", border: "none", cursor: "pointer", display: "inline-flex", lineHeight: 1, color: COLOR.gray500, padding: 0 }}
          >
            <LuX size={20} />
          </button>
        </div>

        {/* Body row: fixed height (= canvas). The image column stays still; only the
            controls column scrolls when the Calibrate accordion is open. */}
        <div style={{ display: "flex", gap: 18, padding: 22, minHeight: 0, flex: 1, overflow: "hidden", alignItems: "flex-start" }}>
          <canvas ref={canvasRef} width={Math.round(IMG_W * S)} height={Math.round(IMG_H * S)}
            onClick={onCanvasClick}
            style={{ border: `1px solid ${COLOR.border}`, borderRadius: 6, cursor: "crosshair", background: "#000", flex: "0 0 auto", maxWidth: "100%", alignSelf: "flex-start" }} />

          <aside style={{ flex: "1 1 300px", minWidth: 300, maxWidth: 380, height: Math.round(IMG_H * S), overflowY: "auto", minHeight: 0, paddingRight: 4 }}>
            {/* anchor */}
            <div style={{ paddingBottom: 12, borderBottom: `1px solid ${COLOR.border}` }}>
              <div style={sectionTitle}>Anchor</div>
              <div style={{ display: "flex", height: 36, border: `1px solid ${COLOR.border}`, borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
                {seg("Drain", anchorType === "drain", () => switchAnchorType("drain"))}
                {seg("Tactile", anchorType === "tactile", () => switchAnchorType("tactile"))}
                {seg("Custom", anchorType === "custom", () => switchAnchorType("custom"))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {btn("Click the 4 corners", mode === "anchor", () => { setMode(mode === "anchor" ? "none" : "anchor"); setPicks([]); }, { flex: 1, fontSize: 14 })}
                {btn("Clear", false, clearAnchor, { fontSize: 14 })}
              </div>
              <div style={{ ...hintText, marginTop: 8 }}>
                Order: <b style={{ color: COLOR.text }}>1 near-left, 2 near-right, 3 far-right, 4 far-left</b> — "near" = edge closest to the camera.
              </div>
              {anchorType === "drain" && (
                <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                  <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: COLOR.text }}>Size</span>
                  <select value={sizeIdx} onChange={(e) => { const i = parseInt(e.target.value); setSizeIdx(i); if (anchorPts.length === 4) doSolveAnchor(anchorPts, GRATING_SIZES[i]); }}
                    style={{ ...inputStyle, flex: 1, minWidth: 0, cursor: "pointer" }}>
                    {GRATING_SIZES.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
                  </select>
                </label>
              )}
              {anchorType === "tactile" && (
                <>
                  <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                    <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: COLOR.text }}>Size</span>
                    <select value={tactileIdx} onChange={(e) => { const i = parseInt(e.target.value); setTactileIdx(i); if (anchorPts.length === 4) doSolveAnchor(anchorPts, TACTILE_SIZES[i]); }}
                      style={{ ...inputStyle, flex: 1, minWidth: 0, cursor: "pointer" }}>
                      {TACTILE_SIZES.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
                    </select>
                  </label>
                  <div style={{ ...hintText, marginTop: 6 }}>Outline a whole mat when visible — a bigger anchor is more accurate.</div>
                </>
              )}
              {anchorType === "custom" && (
                <>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                    <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 14, color: COLOR.text }}>Size</span>
                    <input type="number" min={50} step={10} value={customNear || ""} onChange={(e) => onCustomDim("near", e.target.value)}
                      style={{ ...inputStyle, flex: 1, minWidth: 0, width: "100%" }} />
                    <span style={{ fontFamily: FONT, fontSize: 14, color: COLOR.gray500 }}>×</span>
                    <input type="number" min={50} step={10} value={customSide || ""} onChange={(e) => onCustomDim("side", e.target.value)}
                      style={{ ...inputStyle, flex: 1, minWidth: 0, width: "100%" }} />
                    <span style={{ fontFamily: FONT, fontSize: 14, color: COLOR.gray500 }}>mm</span>
                  </div>
                  <div style={{ ...hintText, marginTop: 6 }}>Near edge (facing you) × side edge. Must lie flat on the ground.</div>
                </>
              )}
              <div style={{ fontFamily: FONT, fontSize: 13, lineHeight: 1.5, color: anchored ? GREEN_OK : COLOR.gray500, marginTop: 8, minHeight: 20 }}>{statusMsg}</div>
            </div>

            {/* measure — no divider below, guidance lives in the readout sub-text */}
            <div style={{ padding: "12px 0" }}>
              <div style={sectionTitle}>Measure</div>
              <div style={{ display: "flex", gap: 8 }}>
                {btn("Ruler", mode === "ruler", () => { setMode(mode === "ruler" ? "none" : "ruler"); setPicks([]); }, { flex: 1, fontSize: 14 })}
                {btn("Clear", false, () => setPicks([]), { fontSize: 14 })}
              </div>
              {readout.main !== "—" && (
                <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 700, color: COLOR.text, fontVariantNumeric: "tabular-nums", marginTop: 8 }}>{readout.main}</div>
              )}
              <div style={{ ...hintText, marginTop: 8 }}>{readout.sub}</div>
              {readout.far > TRUSTED_M && (
                <div style={{ fontFamily: FONT, fontSize: 13, color: AMBER_WARN, marginTop: 6 }}>
                  {readout.far.toFixed(1)} m from camera — beyond the {TRUSTED_M} m trusted zone; precision degrades toward the horizon.
                </div>
              )}
            </div>

            {/* calibrate — collapsed accordion (fallback path; chevron pattern per v2) */}
            <div style={{ borderTop: `1px solid ${COLOR.border}` }}>
              <div
                onClick={() => setCalOpen((o) => !o)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", cursor: "pointer", userSelect: "none" }}
              >
                <span style={{ ...sectionTitle, marginBottom: 0 }}>
                  Calibrate {anchored && <span style={{ fontWeight: 400, fontSize: 13, color: GREEN_OK }}>seeded from anchor</span>}
                </span>
                <LuChevronDown size={16} color={COLOR.gray500} strokeWidth={2}
                  style={{ flexShrink: 0, transform: calOpen ? "rotate(180deg)" : "none", transformOrigin: "center" }} />
              </div>
              {calOpen && (
                <div style={{ paddingBottom: 4 }}>
                  <div style={{ ...hintText, marginBottom: 4 }}>
                    {anchored
                      ? "Yaw & k1 keep the exact solve; pitch/height/roll break to manual (~35 mm)."
                      : "Yaw spins the grid onto the path; pitch/height set scale for anchor-less frames."}
                  </div>
                  {slider("Yaw", "path direction", "yaw", -90, 90, 0.5, (v) => v.toFixed(1) + "°", false)}
                  {slider("k1", "curvature", "k1", -0.05, 0.03, 0.001, (v) => (v < 0 ? "−" : "+") + Math.abs(v).toFixed(3), false)}
                  {slider("Pitch", "vanishing point", "pitch", -15, 40, 0.1, (v) => v.toFixed(1) + "°", true)}
                  {slider("Height", "scale (m)", "height", 0.3, 2.5, 0.005, (v) => v.toFixed(3), true)}
                  {slider("Roll", "bike lean", "roll", -40, 40, 0.25, (v) => v.toFixed(1) + "°", true)}
                  <div style={{ marginTop: 4 }}>{btn("Reset all", false, resetAll, { height: "2.25rem", fontSize: 14 })}</div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body
  );
}
