/**
 * In-image path measurement — single-view metrology core.
 *
 * Ported verbatim from the standalone prototype (now deleted; see
 * docs/in-image-metrology.md), whose math was validated exhaustively:
 *   - anchor solve exact to 1e-11 mm on all 18 real clicked gratings
 *   - px->ground->px round-trip exact (<1e-6 px) over every clickable pixel
 *   - yaw-on-anchor proven distance-preserving (drift < 1e-13 mm)
 *
 * 2026-07-16 refinement (re-verified after change): decomposeAnchor yaw sign fixed
 * (pose dials now reproduce the grating frame) and the anchored path rotates by
 * (yaw - anchorYaw), so the anchored grid starts aligned with the grating's side
 * edge and the yaw dial has identical meaning in the anchored and manual paths.
 *
 * DO NOT "simplify" the distortion inversion or the anchor/rig split without
 * re-running those checks — several subtle bugs (fixed-point divergence under
 * pincushion, non-monotonic bracket, degenerate decomposition) were fixed here.
 *
 * Coordinate frames: world x=right, y=forward(away), z=up; camera X=right, Y=down,
 * Z=forward. Ground plane is z=0.
 */

export type Mat3 = number[][];
export type Vec2 = [number, number];

/** Camera intrinsics — RIG CONSTANTS, recovered by calibrate_rig_from_anchors.py. */
export const INTRINSICS = { fx: 233.34, fy: 233.34, cx: 320.0, cy: 228.5, k1: -0.045, k2: 0.0 };

/** Native frame size these constants were fit to. */
export const IMG_W = 640;
export const IMG_H = 457;

/** Hand-verified starting extrinsics (user tuned height to 0.725 m). */
export const DEFAULT_HEIGHT = 0.725;
export const DEFAULT_PITCH = 2.18;

/** Beyond this ground distance precision falls off fast — the trusted near zone. */
export const TRUSTED_M = 3.0;

export interface AnchorSize { label: string; near: number; side: number }

/** Tactile tiles (BCA Code on Accessibility): 300x300 mm per tile. Mats are laid in
 *  300 mm multiples — clicking a whole-mat outline gives a bigger anchor = higher accuracy. */
export const TACTILE_SIZES: AnchorSize[] = [
  { label: "300 × 300 mm (single tile)", near: 300, side: 300 },
  { label: "600 × 600 mm (2 × 2 tiles)", near: 600, side: 600 },
  { label: "900 × 900 mm (3 × 3 tiles)", near: 900, side: 900 },
  { label: "600 × 300 mm (2 tiles across)", near: 600, side: 300 },
  { label: "900 × 300 mm (3 tiles across)", near: 900, side: 300 },
];

/** Standard grating outlines (mm): [nearEdge, sideEdge]. First is the common type
 *  (corrected 2026-07-16: the 700 mm edge faces the camera on standard path drains). */
export const GRATING_SIZES: AnchorSize[] = [
  { label: "700 × 850 mm (standard — 700 edge facing you)", near: 700, side: 850 },
  { label: "850 × 700 mm (rotated — long edge facing you)", near: 850, side: 700 },
  { label: "850 × 1000 mm", near: 850, side: 1000 },
  { label: "1000 × 850 mm", near: 1000, side: 850 },
  { label: "1500 × 1500 mm (square)", near: 1500, side: 1500 },
];

/** Full projection state: fixed intrinsics + per-frame pose + optional anchor. */
export interface Rig {
  fx: number; fy: number; cx: number; cy: number; k1: number; k2: number;
  /** metres */ height: number;
  /** degrees */ pitch: number; roll: number; yaw: number;
  /** anchor homography ideal-px -> ground (null = drive from pose) */ H: Mat3 | null;
  /** ground -> ideal-px */ Hinv: Mat3 | null;
  /** decomposed yaw at anchor time (degrees). The anchored path rotates by
   *  (yaw - anchorYaw), so the yaw dial means the same thing in both paths and
   *  the grid starts aligned with the grating's side edge, not the camera. */
  anchorYaw: number;
}

export function makeRig(partial?: Partial<Rig>): Rig {
  return {
    ...INTRINSICS,
    height: DEFAULT_HEIGHT, pitch: DEFAULT_PITCH, roll: 0, yaw: 0,
    H: null, Hinv: null, anchorYaw: 0,
    ...partial,
  };
}

// --- linear algebra ---------------------------------------------------------

const mul = (A: Mat3, B: Mat3): Mat3 =>
  A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const mv = (A: Mat3, v: number[]): number[] => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const transpose = (A: Mat3): Mat3 => A[0].map((_, j) => A.map((r) => r[j]));
const rotX = (a: number): Mat3 => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const rotZ = (a: number): Mat3 => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const RBASE: Mat3 = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];

/** Solve a 3x3 homography from 4 point correspondences (DLT + Gaussian elimination). */
export function homography(src: Vec2[], dst: Vec2[]): Mat3 | null {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

export function inv3(M: Mat3): Mat3 | null {
  const [a, b, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

const applyH = (M: Mat3, x: number, y: number): Vec2 | null => {
  const w = M[2][0] * x + M[2][1] * y + M[2][2];
  return Math.abs(w) < 1e-12 ? null : [(M[0][0] * x + M[0][1] * y + M[0][2]) / w, (M[1][0] * x + M[1][1] * y + M[1][2]) / w];
};

// --- lens distortion (only place the homography path still needs the rig) ---

/** Distorted pixel -> undistorted (ideal pinhole) pixel. Radial bisection: exact,
 *  cannot diverge, and clamped to the monotonic domain of the forward model. */
export function undistortPx(rig: Rig, px: number, py: number): Vec2 {
  const ud = (px - rig.cx) / rig.fx, vd = (py - rig.cy) / rig.fy;
  const rd = Math.hypot(ud, vd);
  if (rd < 1e-9) return [px, py];
  const fwd = (r: number) => r * (1 + rig.k1 * r * r + rig.k2 * r * r * r * r);
  let rMax = 6;
  for (let r = 0.05; r < 6; r += 0.05) {
    if (1 + 3 * rig.k1 * r * r + 5 * rig.k2 * r * r * r * r <= 0) { rMax = r - 0.05; break; }
  }
  if (fwd(rMax) <= rd) return [px, py];
  let lo = 0, hi = rMax;
  for (let i = 0; i < 80; i++) { const m = 0.5 * (lo + hi); if (fwd(m) < rd) lo = m; else hi = m; }
  const s = (0.5 * (lo + hi)) / rd;
  return [rig.fx * ud * s + rig.cx, rig.fy * vd * s + rig.cy];
}

/** Undistorted (ideal) pixel -> distorted pixel. */
export function distortPx(rig: Rig, pxu: number, pyu: number): Vec2 {
  const u = (pxu - rig.cx) / rig.fx, v = (pyu - rig.cy) / rig.fy;
  const r2 = u * u + v * v, d = 1 + rig.k1 * r2 + rig.k2 * r2 * r2;
  return [rig.fx * u * d + rig.cx, rig.fy * v * d + rig.cy];
}

// --- pose <-> projection -----------------------------------------------------

function camR(rig: Rig): Mat3 {
  const p = (rig.pitch * Math.PI) / 180, r = (rig.roll * Math.PI) / 180, y = (rig.yaw * Math.PI) / 180;
  return mul(rotZ(r), mul(rotX(p), mul(RBASE, rotZ(-y))));
}

/** Ideal-px sanity bounds: outside ~1 frame of margin the radial model folds back
 *  (d goes negative under barrel distortion) and would draw garbage lines. */
const inIdealBounds = (px: number, py: number): boolean =>
  px > -IMG_W && px < 2 * IMG_W && py > -IMG_H && py < 2 * IMG_H;

/** Ground metres -> image pixel (distortion applied, so grid lines bend correctly). */
export function groundToPx(rig: Rig, X: number, Y: number): Vec2 | null {
  if (rig.Hinv) {
    // anchored: exact. Yaw is a pure in-plane rotation on top of the homography,
    // measured relative to the anchor's own decomposed yaw (dial parity with pose path).
    const a = (-(rig.yaw - rig.anchorYaw) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const gx = X * c - Y * s, gy = X * s + Y * c;
    // w-row of Hinv is proportional to camera-frame depth (solveAnchor normalises its
    // sign so w > 0 = in front) -> clip points behind the camera instead of wrapping
    // them through the horizon.
    const w = rig.Hinv[2][0] * gx + rig.Hinv[2][1] * gy + rig.Hinv[2][2];
    if (w < 1e-12) return null;
    const px = (rig.Hinv[0][0] * gx + rig.Hinv[0][1] * gy + rig.Hinv[0][2]) / w;
    const py = (rig.Hinv[1][0] * gx + rig.Hinv[1][1] * gy + rig.Hinv[1][2]) / w;
    return inIdealBounds(px, py) ? distortPx(rig, px, py) : null;
  }
  const R = camR(rig), C = [0, 0, rig.height];
  const w = [X - C[0], Y - C[1], 0 - C[2]];
  const pc = mv(R, w);
  if (pc[2] <= 0.05) return null;
  const u = pc[0] / pc[2], v = pc[1] / pc[2];
  if (!inIdealBounds(rig.fx * u + rig.cx, rig.fy * v + rig.cy)) return null;
  const r2 = u * u + v * v;
  const d = 1 + rig.k1 * r2 + rig.k2 * r2 * r2;
  return [rig.fx * u * d + rig.cx, rig.fy * v * d + rig.cy];
}

/** Image pixel -> ground metres (undistort, then intersect ray with z=0). */
export function pxToGround(rig: Rig, px: number, py: number): Vec2 | null {
  if (rig.H) {
    const u = undistortPx(rig, px, py);
    const g = applyH(rig.H, u[0], u[1]);
    if (!g) return null;
    const a = ((rig.yaw - rig.anchorYaw) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return [g[0] * c - g[1] * s, g[0] * s + g[1] * c];
  }
  const un = undistortPx(rig, px, py);
  const u = (un[0] - rig.cx) / rig.fx, v = (un[1] - rig.cy) / rig.fy;
  const ray = mv(transpose(camR(rig)), [u, v, 1]);
  const C = [0, 0, rig.height];
  if (ray[2] >= -1e-6) return null; // at/above horizon
  const t = -C[2] / ray[2];
  if (t <= 0) return null;
  return [C[0] + t * ray[0], C[1] + t * ray[1]];
}

export interface Decomp { h: number; pitch: number; roll: number; yaw: number; }

/** Decompose an anchor homography back into pose (to seed the dials). */
export function decomposeAnchor(rig: Rig): Decomp | null {
  if (!rig.Hinv) return null;
  const { fx, fy, cx, cy } = rig;
  const Ki: Mat3 = [[1 / fx, 0, -cx / fx], [0, 1 / fy, -cy / fy], [0, 0, 1]];
  const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
    Ki[i][0] * rig.Hinv![0][j] + Ki[i][1] * rig.Hinv![1][j] + Ki[i][2] * rig.Hinv![2][j]));
  const c1 = [M[0][0], M[1][0], M[2][0]], c2 = [M[0][1], M[1][1], M[2][1]], c3 = [M[0][2], M[1][2], M[2][2]];
  const n = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
  let lam = 2 / (n(c1) + n(c2));
  if (c3[2] < 0) lam = -lam;
  const r1 = c1.map((v) => v * lam), r2 = c2.map((v) => v * lam), t = c3.map((v) => v * lam);
  const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const h = -dot(r3, t);
  if (!(h > 0.05) || !isFinite(h)) return null;
  const pitch = Math.asin(Math.max(-1, Math.min(1, -r3[2])));
  const roll = Math.atan2(r3[0], -r3[1]);
  const zw = [r1[2], r2[2], r3[2]];
  // camR applies rotZ(-yaw), so the dial convention is the NEGATED camera heading.
  // (Sign verified empirically: pose path with dials=decomp must reproduce the
  //  grating frame; the un-negated form mirrored it — 2x-yaw grid jump on skewed drains.)
  const yaw = Math.atan2(-zw[0], zw[1]);
  return { h, pitch: (pitch * 180) / Math.PI, roll: (roll * 180) / Math.PI, yaw: (yaw * 180) / Math.PI };
}

export interface AnchorResult { H: Mat3; Hinv: Mat3; decomp: Decomp; }

/** Solve the exact ground homography from 4 clicked grating corners (native px).
 *  Corner order: near-left, near-right, far-right, far-left. */
export function solveAnchor(rig: Rig, cornersPx: Vec2[], nearMm: number, sideMm: number): AnchorResult | null {
  if (cornersPx.length !== 4) return null;
  const src = cornersPx.map((p) => undistortPx(rig, p[0], p[1]));
  const w = nearMm / 1000, l = sideMm / 1000;
  const dst: Vec2[] = [[0, 0], [w, 0], [w, l], [0, l]];
  const H = homography(src, dst);
  let Hinv = H && inv3(H);
  if (!H || !Hinv) return null;
  // Normalise sign so Hinv's w-row (proportional to camera depth) is positive for
  // in-front points — lets groundToPx clip behind-camera geometry. Negating BOTH
  // H and Hinv keeps them an exact inverse pair (projectively identical).
  const wc = Hinv[2][0] * (w / 2) + Hinv[2][1] * (l / 2) + Hinv[2][2];
  let Hs = H;
  if (wc < 0) {
    Hs = H.map((r) => r.map((v) => -v));
    Hinv = Hinv.map((r) => r.map((v) => -v));
  }
  const decomp = decomposeAnchor({ ...rig, H: Hs, Hinv });
  if (!decomp) return null;
  return { H: Hs, Hinv, decomp };
}

/** Uncertainty band (metres) for a ground point — never quote a bare number. */
export function band(gx: number, gy: number): number {
  const d = Math.hypot(gx, gy);
  const base = 0.09; // measured 91 mm anchored
  const grow = 0.05 * Math.max(0, d - 1.0);
  const far = d > TRUSTED_M ? 0.1 * (d - TRUSTED_M) : 0;
  return base + grow + far;
}
