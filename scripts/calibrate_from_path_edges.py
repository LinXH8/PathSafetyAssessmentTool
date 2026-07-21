"""Fix the far-field error by calibrating PITCH + DISTORTION from path edges.

THE BUG THIS FIXES
------------------
User measured a path of known width 1.53 m:
    near the camera -> 1.55 m   (right)
    further away    -> 2.05 m   (34% too wide)
Width correct at short range but INFLATING with distance is the signature of a
PITCH error, not a scale error. If the assumed ground plane is tilted against the
true one, ground points get placed too far away, and the error compounds toward the
horizon - so cross-path width grows with range.

The original calibration used 18 gratings, ALL sitting 1-3 m away in a narrow band
near the middle of the frame. It was validated (91 mm) exactly where it was fit, and
never tested the far field. Classic overfit to a small patch of the image.

THE CONSTRAINT
--------------
Path edges are two parallel straight lines on the ground, running from under the
camera all the way to the horizon - they span exactly the depth range that the
gratings did not.

  * A homography maps lines to lines, so "each edge is straight on the ground"
    tests only the DISTORTION.
  * Two parallel ground lines meet at a vanishing point ON THE HORIZON. If pitch is
    wrong the horizon is wrong, and the edges come out DIVERGING in our ground frame
    - which is precisely the observed symptom. So PARALLELISM tests PITCH.

Height is NOT fit here: it scales the ground uniformly and so cannot change any of
these shape residuals. Geometry first, scale after (from the gratings).

Usage:
    backend\\.venv\\Scripts\\python.exe scripts\\calibrate_from_path_edges.py
"""
from __future__ import annotations

import json
import random
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import least_squares

REPO = Path(__file__).resolve().parents[1]
IN_ROOT = REPO / "in"
MODEL = REPO / "backend" / "models" / "path_segmentation_6July.pt"
OUT = REPO / "temp" / "rig_calibration_v2.json"
ANCHORS = REPO / "temp" / "grating_anchors.json"

W, H = 640, 457
CX, CY = W / 2.0, H / 2.0
H_FIXED = 0.785            # scale only; refit from gratings afterwards

PATH_CLS = {"Pathway", "Cycling Path", "Brick Pathway", "Grey Tiled Pathway",
            "Square Pathway", "Stone Pathway", "White Pathway", "Wet Pathway",
            "Wet Cycling Path"}

N_FOLDERS, PER_FOLDER = 120, 1
ROWS_PER_FRAME = 16
MIN_ROW_WIDTH = 25         # px; narrower rows are near the horizon and too noisy

R_BASE = np.array([[1.0, 0, 0], [0, 0, -1.0], [0, 1.0, 0]])


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def cam_R(pitch, roll):
    return rot_z(roll) @ rot_x(pitch) @ R_BASE


def px_to_ground(pts, f, k1, k2, pitch, roll, h=H_FIXED):
    """Undistort, then intersect each ray with the ground plane z=0. Vectorised."""
    K = np.array([[f, 0, CX], [0, f, CY], [0, 0, 1.0]])
    und = cv2.undistortPoints(pts.reshape(-1, 1, 2).astype(np.float64), K,
                              np.array([k1, k2, 0, 0, 0.0])).reshape(-1, 2)
    rays = np.hstack([und, np.ones((len(und), 1))]) @ cam_R(pitch, roll)  # R^T applied
    C = np.array([0.0, 0.0, h])
    with np.errstate(divide="ignore", invalid="ignore"):
        t = -C[2] / rays[:, 2]
    ok = np.isfinite(t) & (t > 0) & (rays[:, 2] < -1e-6)
    g = C[None, :] + t[:, None] * rays
    return g[:, :2], ok


def extract_edges():
    """Run path segmentation and pull the left/right edge of the path per frame."""
    from ultralytics import YOLO
    model = YOLO(str(MODEL))

    random.seed(3)
    folders = sorted(p for p in IN_ROOT.glob("*") if p.is_dir())
    folders = random.sample(folders, min(N_FOLDERS, len(folders)))

    frames = []
    for fo in folders:
        imgs = sorted(fo.glob("*.jpeg"))
        if not imgs:
            continue
        p = random.choice(imgs)
        img = cv2.imread(str(p))
        if img is None or img.shape[:2] != (H, W):
            continue
        r = model.predict(img, verbose=False)[0]
        if r.masks is None:
            continue
        best, best_area = None, 0
        for b, mk in zip(r.boxes, r.masks.data):
            if model.names[int(b.cls)] not in PATH_CLS or float(b.conf) < 0.45:
                continue
            a = int(mk.sum())
            if a > best_area:
                best, best_area = mk.cpu().numpy(), a
        if best is None or best_area < 4000:
            continue
        m = (cv2.resize(best, (W, H), interpolation=cv2.INTER_NEAREST) > 0.5)

        rows = np.where(m.any(axis=1))[0]
        if len(rows) < 30:
            continue
        # sample rows across the path's vertical extent, skipping the very top
        # (near the horizon the mask is unreliable and a pixel is worth metres)
        lo, hi = rows.min(), rows.max()
        cand = np.linspace(lo + 0.25 * (hi - lo), hi - 2, ROWS_PER_FRAME).astype(int)
        L, Rr = [], []
        for y in cand:
            xs = np.where(m[y])[0]
            if len(xs) < MIN_ROW_WIDTH:
                continue
            # reject rows where the mask is split into blobs (occlusions, junctions)
            if xs.max() - xs.min() + 1 > 1.6 * len(xs):
                continue
            L.append([xs.min(), y]); Rr.append([xs.max(), y])
        if len(L) < 6:
            continue
        frames.append(dict(name=f"{p.parent.name}/{p.name}",
                           left=np.array(L, float), right=np.array(Rr, float)))
    return frames


def fit_line(g):
    """PCA line fit -> (point, unit direction)."""
    c = g.mean(axis=0)
    _, _, vt = np.linalg.svd(g - c, full_matrices=False)
    return c, vt[0]


def residuals_for(frames, f, k1, k2, pitch, rolls):
    out = []
    for fr, roll in zip(frames, rolls):
        gl, okl = px_to_ground(fr["left"], f, k1, k2, pitch, roll)
        gr, okr = px_to_ground(fr["right"], f, k1, k2, pitch, roll)
        if okl.sum() < 5 or okr.sum() < 5:
            out.append(np.full(3, 10.0)); continue
        gl, gr = gl[okl], gr[okr]
        cl, dl = fit_line(gl)
        cr, dr = fit_line(gr)
        nl = np.array([-dl[1], dl[0]])                       # normal to the left edge

        # (1) straightness: each edge must be a straight ground line  -> DISTORTION
        s_l = ((gl - cl) @ nl)
        nr = np.array([-dr[1], dr[0]])
        s_r = ((gr - cr) @ nr)

        # (2) width constancy: distance from each right point to the left line must
        #     not drift with range -> PITCH. This is the user's exact symptom.
        wid = (gr - cl) @ nl
        w_dev = wid - wid.mean()

        out.append(np.array([
            np.sqrt((s_l ** 2).mean()) + np.sqrt((s_r ** 2).mean()),
            np.sqrt((w_dev ** 2).mean()) * 2.0,               # weight the money term
            abs(np.arcsin(np.clip(np.cross(dl, dr), -1, 1))) * 0.5,   # parallelism
        ]))
    return np.concatenate(out)


def main() -> None:
    print("Running path segmentation to extract edges...")
    frames = extract_edges()
    print(f"usable frames: {len(frames)}")
    if len(frames) < 15:
        print("Too few frames with a clean path mask.")
        return

    n = len(frames)

    def pack(p):
        return p[0], p[1], p[2], p[3], p[4:]

    def fun(p):
        f, k1, k2, pitch, rolls = pack(p)
        r = residuals_for(frames, f, k1, k2, pitch, rolls)
        # bike lean is zero-mean across many frames; without this the fit can absorb a
        # pitch error into a systematic roll bias (they trade off per-frame).
        return np.concatenate([r, [rolls.mean() * 3.0]])

    p0 = np.concatenate([[233.34, -0.0731, 0.0, np.deg2rad(2.18)], np.zeros(n)])
    lo = np.concatenate([[150.0, -0.45, -0.15, np.deg2rad(-10)], np.full(n, np.deg2rad(-35))])
    hi = np.concatenate([[420.0, 0.10, 0.15, np.deg2rad(25)], np.full(n, np.deg2rad(35))])

    print("Fitting focal, k1, k2, pitch + per-frame roll...")
    sol = least_squares(fun, p0, bounds=(lo, hi), loss="soft_l1", f_scale=0.05,
                        max_nfev=300, verbose=0)
    f, k1, k2, pitch, rolls = pack(sol.x)

    r0 = residuals_for(frames, 233.34, -0.0731, 0.0, np.deg2rad(2.18), np.zeros(n))
    r1 = residuals_for(frames, f, k1, k2, pitch, rolls)
    w0 = r0[1::3].mean() / 2.0
    w1 = r1[1::3].mean() / 2.0

    print()
    print("=" * 66)
    print("CALIBRATION FROM PATH EDGES")
    print("=" * 66)
    print(f"  focal   : {233.34:7.1f}  ->  {f:7.1f} px  (HFOV {2*np.rad2deg(np.arctan(CX/f)):.0f} deg)")
    print(f"  k1      : {-0.0731:+7.4f}  ->  {k1:+7.4f}")
    print(f"  k2      : {0.0:+7.4f}  ->  {k2:+7.4f}")
    print(f"  pitch   : {2.18:7.2f}  ->  {np.rad2deg(pitch):7.2f} deg down   <-- the fix")
    print()
    print(f"  width drift along path (RMS):")
    print(f"     before : {w0*100:6.1f} cm   <- the 1.53 -> 2.05 m blow-out")
    print(f"     after  : {w1*100:6.1f} cm")
    print(f"  roll: mean {np.rad2deg(rolls.mean()):+.2f} deg  sd {np.rad2deg(rolls.std()):.2f} deg")

    # ---- rescale: pitch/f/k changed, so height must be refit from the gratings ----
    recs = json.loads(ANCHORS.read_text())
    scales = []
    for r in recs:
        pts = np.array(r["corners_px"], float)
        best = None
        for roll in np.deg2rad(np.arange(-25, 25, 0.25)):
            g, ok = px_to_ground(pts, f, k1, k2, pitch, roll, h=1.0)   # unit height
            if ok.sum() < 4:
                continue
            eN, eF = g[1] - g[0], g[2] - g[3]
            eL, eR = g[3] - g[0], g[2] - g[1]
            err = (abs(np.linalg.norm(eN) - np.linalg.norm(eF))
                   + abs(np.linalg.norm(eL) - np.linalg.norm(eR))
                   + abs(np.dot(eN, eL)) / (np.linalg.norm(eN) * np.linalg.norm(eL) + 1e-9))
            if best is None or err < best[0]:
                best = (err, g)
        if best is None:
            continue
        g = best[1]
        near = (np.linalg.norm(g[1] - g[0]) + np.linalg.norm(g[2] - g[3])) / 2
        side = (np.linalg.norm(g[3] - g[0]) + np.linalg.norm(g[2] - g[1])) / 2
        # at unit height the grating measures `near`; true size fixes the real height
        scales.append(((r["near_edge_mm"] / 1000) / near + (r["side_edge_mm"] / 1000) / side) / 2)
    h_new = float(np.median(scales))
    print()
    print(f"  height  : {H_FIXED:7.3f}  ->  {h_new:7.3f} m   (rescaled from gratings)")

    OUT.write_text(json.dumps({
        "fx": f, "fy": f, "cx": CX, "cy": CY, "k": [k1, k2, 0.0],
        "height_m": h_new, "pitch_deg": float(np.rad2deg(pitch)),
        "image_size": [W, H],
        "width_drift_cm_before": float(w0 * 100), "width_drift_cm_after": float(w1 * 100),
        "n_path_frames": n,
    }, indent=2))
    print(f"\n  wrote {OUT}")


if __name__ == "__main__":
    main()
