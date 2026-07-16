/**
 * In-Image Path Measurement — Measure mode for the Coding page.
 *
 * A portal modal (NOT a Chakra Dialog — avoids the documented Zag pointer-events
 * freeze) that overlays a metric grid / ruler / two-point tool on the current
 * segment's street-level frame. All geometry comes from measureMath.ts, whose
 * math is validated exact; this file is only canvas drawing + controls.
 *
 * Reliable path: click the 4 corners of a drain grating -> exact ground solve.
 * Manual dials (pitch/height/roll/yaw/k1) refine or handle drain-less frames.
 *
 * v1: live read-off only (persistence deferred per the design doc).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  makeRig, solveAnchor, pxToGround, groundToPx, band,
  IMG_W, IMG_H, TRUSTED_M, GRATING_SIZES, TACTILE_SIZES,
  type AnchorSize, type Rig, type Vec2,
} from "./measureMath";

type Mode = "ruler" | "anchor";

type AnchorType = "drain" | "tactile" | "custom";
const ANCHOR_LABEL: Record<AnchorType, string> = {
  drain: "drain grating", tactile: "tactile tile / mat", custom: "custom object",
};
const CORNER_NAMES = ["near-left", "near-right", "far-right", "far-left"];
const defaultStatus = (t: AnchorType) => `Click the 4 corners of the ${ANCHOR_LABEL[t]} to solve exactly.`;

type Props = { projectName: string; imageRef: string; open: boolean; onClose: () => void };

const C = {
  bg: "#0f1419", panel: "#161d26", line: "#2a3644", txt: "#e6edf3", dim: "#8b98a5",
  blue: "#3182CE", green: "#87C424", amber: "#FFCC1A", red: "#FF5B1A", purple: "#CD1AFF",
};

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

  // ---- readout (derived, pure) --------------------------------------------
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
    else { ctx.fillStyle = C.panel; ctx.fillRect(0, 0, cv.width, cv.height); }

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

    if (!rig.Hinv) groundLine(-400, 400, 400, 400, C.amber, 1.5, [7, 5], 160); // horizon (unanchored)

    // anchor overlay
    if (anchorPts.length) {
      if (anchorPts.length === 4) {
        ctx.strokeStyle = C.red; ctx.lineWidth = 2.5; ctx.setLineDash([]); ctx.beginPath();
        anchorPts.forEach((p, i) => (i ? ctx.lineTo(p[0] * S, p[1] * S) : ctx.moveTo(p[0] * S, p[1] * S)));
        ctx.closePath(); ctx.stroke();
      }
      anchorPts.forEach((p, i) => {
        ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(p[0] * S, p[1] * S, 5, 0, 7); ctx.fill();
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
        groundLine(x, Y0, x, Y1, x === 0 ? C.blue : inT ? "rgba(135,196,36,.85)" : "rgba(135,196,36,.30)", x === 0 ? 2 : 1, [], 128);
      }
      for (let y = Math.ceil(Y0); y <= Y1; y++) {
        const inT = y <= TRUSTED_M;
        groundLine(X0, y, X1, y, inT ? "rgba(135,196,36,.85)" : "rgba(135,196,36,.30)", 1);
        if (y >= 0) {
          const p = g2(X1, y);
          if (p) { ctx.fillStyle = inT ? C.green : "rgba(135,196,36,.45)"; ctx.font = "600 11px Inter,sans-serif"; ctx.fillText(y + " m", p[0] * S + 4, p[1] * S + 4); }
        }
      }
      groundLine(-6, TRUSTED_M, 6, TRUSTED_M, C.amber, 1.5, [4, 4]);
    }

    if (mode === "ruler" && picks.length) {
      const o = picks[0];
      groundLine(o[0] - 6, o[1], o[0] + 6, o[1], C.blue, 2);
      for (let d = -6; d <= 6; d += 0.5) {
        const p = g2(o[0] + d, o[1]); if (!p) continue;
        const big = Number.isInteger(d);
        ctx.strokeStyle = C.blue; ctx.lineWidth = big ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(p[0] * S, p[1] * S - (big ? 7 : 4)); ctx.lineTo(p[0] * S, p[1] * S + (big ? 7 : 4)); ctx.stroke();
        if (big && d !== 0) { ctx.fillStyle = "#9ecbf0"; ctx.font = "600 10px Inter,sans-serif"; ctx.fillText(Math.abs(d) + "m", p[0] * S - 8, p[1] * S + 20); }
      }
      dot(o[0], o[1], C.red);
      if (picks.length >= 2) { const t = picks[1]; groundLine(o[0], o[1], t[0], o[1], C.purple, 2.5); dot(t[0], t[1], C.purple); }
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
    setStatusMsg(`✓ ANCHORED (exact) — ${sz.near}×${sz.side} mm → height ${d.h.toFixed(3)} m, pitch ${d.pitch.toFixed(1)}°, roll ${d.roll.toFixed(1)}°, yaw ${d.yaw.toFixed(1)}°.`);
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

  const btn = (label: string, active: boolean, onClick: () => void, extra: React.CSSProperties = {}) => (
    <button onClick={onClick} style={{
      background: active ? C.blue : "#20293a", color: C.txt, border: `1px solid ${active ? C.blue : C.line}`,
      borderRadius: 6, padding: "8px 12px", fontWeight: 600, fontSize: 13, cursor: "pointer", ...extra,
    }}>{label}</button>
  );

  const slider = (label: string, sub: string, key: keyof Rig, min: number, max: number, step: number, fmt: (v: number) => string, breakA: boolean) => (
    <label style={{ display: "block", margin: "10px 0", fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span>{label} <span style={{ color: C.dim }}>{sub}</span></span>
        <span style={{ color: C.dim, fontVariantNumeric: "tabular-nums" }}>{fmt(rig[key] as number)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={rig[key] as number} style={{ width: "100%", accentColor: C.blue }}
        onChange={(e) => patchRig({ [key]: parseFloat(e.target.value) } as Partial<Rig>, breakA)} />
    </label>
  );

  const modeHint: Record<Mode, string> = {
    anchor: `Click the 4 corners of the ${ANCHOR_LABEL[anchorType]}: near-left → near-right → far-right → far-left.`,
    ruler: "Click the path edge you're widening FROM, then the obstacle — reads clear width. The 1 m grid is painted for square-counting.",
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: C.bg, color: C.txt, border: `1px solid ${C.line}`, borderRadius: 10, maxWidth: "96vw", maxHeight: "94vh", overflow: "auto", display: "flex", flexDirection: "column", font: "14px/1.5 Inter,system-ui,sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${C.line}` }}>
          <div><b style={{ fontSize: 15 }}>In-Image Path Measurement</b> <span style={{ color: C.dim, fontSize: 12 }}>· planning-grade, ±0.4–0.5 m near field</span></div>
          {btn("✕ Close", false, onClose)}
        </div>

        <div style={{ display: "flex", gap: 14, padding: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <canvas ref={canvasRef} width={Math.round(IMG_W * S)} height={Math.round(IMG_H * S)}
            onClick={onCanvasClick}
            style={{ border: `1px solid ${C.line}`, borderRadius: 6, cursor: "crosshair", background: "#000", flex: "0 0 auto", maxWidth: "100%" }} />

          <aside style={{ flex: "1 1 300px", minWidth: 300, maxWidth: 380 }}>
            {/* anchor */}
            <div style={{ paddingBottom: 10, borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: C.dim, marginBottom: 8 }}>Anchor on a known object (reliable)</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {(["drain", "tactile", "custom"] as AnchorType[]).map((t) =>
                  <span key={t} style={{ flex: 1, display: "flex" }}>
                    {btn(t === "drain" ? "Drain" : t === "tactile" ? "Tactile" : "Custom", anchorType === t, () => switchAnchorType(t), { flex: 1, padding: "7px 6px", fontSize: 12.5 })}
                  </span>
                )}
              </div>
              {btn(`◎ Click the 4 corners of the ${ANCHOR_LABEL[anchorType]}`, mode === "anchor", () => { setMode("anchor"); setPicks([]); }, { width: "100%" })}
              <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6, lineHeight: 1.55 }}>
                Click order — trace the outline: <b style={{ color: C.txt }}>1 near-left, 2 near-right, 3 far-right, 4 far-left</b>.
                {" "}"Near" is the edge closest to the camera; "far" is the edge further up the path.
              </div>
              {anchorType === "drain" && (
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 13 }}>
                  <span>Size</span>
                  <select value={sizeIdx} onChange={(e) => { const i = parseInt(e.target.value); setSizeIdx(i); if (anchorPts.length === 4) doSolveAnchor(anchorPts, GRATING_SIZES[i]); }}
                    style={{ flex: 1, background: "#20293a", color: C.txt, border: `1px solid ${C.line}`, borderRadius: 6, padding: 6 }}>
                    {GRATING_SIZES.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
                  </select>
                </label>
              )}
              {anchorType === "tactile" && (
                <>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 13 }}>
                    <span>Size</span>
                    <select value={tactileIdx} onChange={(e) => { const i = parseInt(e.target.value); setTactileIdx(i); if (anchorPts.length === 4) doSolveAnchor(anchorPts, TACTILE_SIZES[i]); }}
                      style={{ flex: 1, background: "#20293a", color: C.txt, border: `1px solid ${C.line}`, borderRadius: 6, padding: 6 }}>
                      {TACTILE_SIZES.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
                    </select>
                  </label>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                    Tiles are 300 × 300 mm. If a full mat is visible, outline the whole mat (pick its size above) — a bigger anchor is more accurate.
                  </div>
                </>
              )}
              {anchorType === "custom" && (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 13 }}>
                    <span>Size</span>
                    <input type="number" min={50} step={10} value={customNear || ""} onChange={(e) => onCustomDim("near", e.target.value)}
                      style={{ flex: 1, minWidth: 0, background: "#20293a", color: C.txt, border: `1px solid ${C.line}`, borderRadius: 6, padding: 6 }} />
                    <span style={{ color: C.dim }}>×</span>
                    <input type="number" min={50} step={10} value={customSide || ""} onChange={(e) => onCustomDim("side", e.target.value)}
                      style={{ flex: 1, minWidth: 0, background: "#20293a", color: C.txt, border: `1px solid ${C.line}`, borderRadius: 6, padding: 6 }} />
                    <span style={{ color: C.dim }}>mm</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
                    Near edge (facing you) × side edge (going away). Any flat rectangle of known size works — e.g. ground signage. It must lie flat on the ground.
                  </div>
                </>
              )}
              <div style={{ fontSize: 11, color: anchored ? C.green : C.dim, marginTop: 6, minHeight: 28 }}>{statusMsg}</div>
              <div style={{ marginTop: 6 }}>{btn("Clear anchor", false, clearAnchor)}</div>
            </div>

            {/* measure */}
            <div style={{ padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: C.dim, marginBottom: 8 }}>Measure</div>
              <div style={{ display: "flex", gap: 8 }}>
                {btn("Ruler", mode === "ruler", () => { setMode("ruler"); setPicks([]); })}
              </div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>{modeHint[mode]}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 10 }}>{readout.main}</div>
              <div style={{ fontSize: 12, color: C.dim }}>{readout.sub}</div>
              {readout.far > TRUSTED_M && (
                <div style={{ fontSize: 12, color: C.amber, marginTop: 6 }}>
                  ⚠ {readout.far.toFixed(1)} m from camera — beyond the {TRUSTED_M} m trusted zone; precision degrades toward the horizon.
                </div>
              )}
              <div style={{ marginTop: 8 }}>{btn("Clear picks", false, () => setPicks([]))}</div>
            </div>

            {/* dials */}
            <div style={{ padding: "10px 0" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: C.dim, marginBottom: 4 }}>
                Calibrate {anchored ? <span style={{ color: C.green }}>— seeded from anchor</span> : <span>(tune by eye)</span>}
              </div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>
                {anchored
                  ? "On the exact 4-corner solve. Yaw & k1 stay exact; nudging pitch/height/roll goes manual (~35 mm)."
                  : "Yaw spins the grid onto the path. k1 matches grid curvature to real straight lines. Pitch/height for no-drain frames."}
              </div>
              {slider("Yaw", "path direction", "yaw", -90, 90, 0.5, (v) => v.toFixed(1) + "°", false)}
              {slider("k1", "curvature", "k1", -0.05, 0.03, 0.001, (v) => (v < 0 ? "−" : "+") + Math.abs(v).toFixed(3), false)}
              {slider("Pitch", "vanishing point", "pitch", -15, 40, 0.1, (v) => v.toFixed(1) + "°", true)}
              {slider("Height", "scale (m)", "height", 0.3, 2.5, 0.005, (v) => v.toFixed(3), true)}
              {slider("Roll", "bike lean", "roll", -40, 40, 0.25, (v) => v.toFixed(1) + "°", true)}
              <div style={{ marginTop: 6 }}>{btn("Reset all", false, resetAll)}</div>
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body
  );
}
