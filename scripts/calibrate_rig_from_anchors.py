"""Recover the rig constants from clicked grating anchors.

Solves a bundle adjustment over the anchor set produced by the grating clicker.
The structure of the problem is the whole point:

    GLOBAL (shared by every frame - these are RIG CONSTANTS):
        fx, fy   focal length (px)     - unknown, EXIF is stripped
        cx, cy   principal point       - NOT assumed centred (frames are cropped)
        k1,k2,k3 radial distortion     - GoPro barrel is severe at ~108 deg HFOV
        h        camera height (m)     - rigid mount => constant
        pitch    camera tilt (deg)     - rigid mount => constant

    PER-FRAME (free, because the bike LEANS):
        roll        camera roll (deg)
        cx, cy      camera position on the ground plane, in the grating's frame
        yaw         camera heading

Each clicked grating gives 4 correspondences (image px <-> a known metric
rectangle). Minimising reprojection error over all frames at once forces h and
pitch to a single consistent value.

Two validations are built in, and they are the point of the script:
  1. CONSISTENCY - recovered h must be tight across frames (it's a rig constant).
  2. LEAVE-ONE-OUT - refit without anchor i, then use the rig to MEASURE anchor
     i's grating. The error, in millimetres, is the honest end-to-end accuracy
     of the whole feature. This is the number that matters.

Usage:
    backend\\.venv\\Scripts\\python.exe scripts\\calibrate_rig_from_anchors.py
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import least_squares

REPO = Path(__file__).resolve().parents[1]
ANCHORS = REPO / "temp" / "grating_anchors.json"
OUT = REPO / "temp" / "rig_calibration.json"

R_BASE = np.array([[1.0, 0, 0], [0, 0, -1.0], [0, 1.0, 0]])

# Camera models to try. We pick by held-out accuracy AND physical plausibility.
#
# WHY NO free-PP / free-aspect MODELS (2026-07-10):
# Every anchor lies on the SAME plane (the ground) seen from a near-identical pose,
# so `pitch` and `cy` trade off almost exactly, as do focal length and height. The
# data cannot separate them - this is the classic planar-calibration degeneracy.
# Freeing the principal point let the optimiser reach a corner of parameter space
# that reproduces the anchor pixels while describing an IMPOSSIBLE camera: optical
# axis at y=91 of 457, pitched 28 deg UP at the sky, 35% non-square pixels. It
# scored 79mm held-out vs 91mm for the honest model - i.e. it bought 12mm of
# apparent accuracy by inventing a camera that does not exist.
#
# That degeneracy is NOT harmless: per-frame roll is a rotation ABOUT THE OPTICAL
# AXIS, so a wrong principal point rotates about the wrong point and the error grows
# with distance from centre - exactly where we measure. Physical realism wins.
MODELS = {
    "k1, centred PP":    dict(free_pp=False, free_aspect=False, n_k=1),
    "k1+k2, centred PP": dict(free_pp=False, free_aspect=False, n_k=2),
}


def implausible(fx, fy, cx, cy, h, pitch, W, Hh):
    """Reject fits that are not a physically real camera. Guards the degeneracy above."""
    why = []
    if not (0.4 <= h <= 2.2):
        why.append(f"height {h:.2f}m outside 0.4-2.2m (bike-mounted)")
    if not (-8 <= np.rad2deg(pitch) <= 45):
        why.append(f"pitch {np.rad2deg(pitch):+.1f}deg (expect a slight DOWN tilt)")
    if abs(cy - Hh / 2) > 0.18 * Hh:
        why.append(f"principal point cy={cy:.0f} far from centre {Hh/2:.0f}")
    if abs(cx - W / 2) > 0.18 * W:
        why.append(f"principal point cx={cx:.0f} far from centre {W/2:.0f}")
    if not (0.85 <= fy / fx <= 1.18):
        why.append(f"pixel aspect fy/fx={fy/fx:.2f} (expect ~square)")
    return why


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def cam_rotation(pitch, roll, yaw):
    return rot_z(roll) @ rot_x(pitch) @ (R_BASE @ rot_z(-yaw))


def pose_to_hpr(R, t):
    C = -R.T @ t
    n_cam = R @ np.array([0, 0, 1.0])
    pitch = np.arcsin(np.clip(-n_cam[2], -1, 1))
    roll = np.arctan2(n_cam[0], -n_cam[1])
    z_w = R.T @ np.array([0, 0, 1.0])
    yaw = np.arctan2(z_w[0], z_w[1])
    return float(C[2]), float(pitch), float(roll), float(yaw), C


def grating_corners(near_mm, side_mm):
    w, l = near_mm / 1000.0, side_mm / 1000.0
    return np.array([[0, 0, 0], [w, 0, 0], [w, l, 0], [0, l, 0]], dtype=np.float64)


class Model:
    """Packs/unpacks the parameter vector for a given camera-model choice."""

    def __init__(self, cfg, W, H, n):
        self.free_pp, self.free_aspect, self.n_k = cfg["free_pp"], cfg["free_aspect"], cfg["n_k"]
        self.W, self.H, self.n = W, H, n
        # fx(1) + fy(0|1) + pp(0|2) + k(n_k) + h,pitch(2)
        self.g = 3 + self.n_k + (1 if self.free_aspect else 0) + (2 if self.free_pp else 0)

    def unpack(self, p):
        i = 0
        fx = p[i]; i += 1
        fy = p[i] if self.free_aspect else fx
        i += 1 if self.free_aspect else 0
        if self.free_pp:
            cx, cy = p[i], p[i + 1]; i += 2
        else:
            cx, cy = self.W / 2.0, self.H / 2.0
        ks = np.zeros(3)
        ks[: self.n_k] = p[i:i + self.n_k]; i += self.n_k
        h, pitch = p[i], p[i + 1]; i += 2
        return fx, fy, cx, cy, ks, h, pitch, p[i:].reshape(self.n, 4)

    def seed(self, f0, h0, p0_pitch, per_view):
        parts = [[f0]]
        if self.free_aspect:
            parts.append([f0])
        if self.free_pp:
            parts.append([self.W / 2.0, self.H / 2.0])
        parts.append([0.0] * self.n_k)
        parts.append([h0, p0_pitch])
        parts.append(np.asarray(per_view).ravel())
        return np.concatenate([np.asarray(x, float).ravel() for x in parts])

    def bounds(self):
        lo, hi = [120.0], [1500.0]
        if self.free_aspect:
            lo += [120.0]; hi += [1500.0]
        if self.free_pp:
            lo += [self.W * 0.30, self.H * 0.20]; hi += [self.W * 0.70, self.H * 0.80]
        lo += [-1.5] * self.n_k; hi += [1.0] * self.n_k
        lo += [0.3, np.deg2rad(-40)]; hi += [3.0, np.deg2rad(70)]
        lo += [-60, -60, -np.pi, np.deg2rad(-60)] * self.n
        hi += [60, 60, np.pi, np.deg2rad(60)] * self.n
        return np.array(lo), np.array(hi)


def project(pts_w, fx, fy, cx, cy, ks, R, t):
    pc = pts_w @ R.T + t
    z = np.maximum(pc[:, 2], 1e-6)
    u, v = pc[:, 0] / z, pc[:, 1] / z
    r2 = u * u + v * v
    d = 1.0 + ks[0] * r2 + ks[1] * r2 * r2 + ks[2] * r2 ** 3
    return np.stack([fx * u * d + cx, fy * v * d + cy], axis=1)


def fit(model, obj, img, seed_f=320.0):
    n = len(obj)
    # per-view init via planar PnP at a guessed focal length
    K = np.array([[seed_f, 0, model.W / 2], [0, seed_f, model.H / 2], [0, 0, 1.0]])
    hs, ps, pv = [], [], []
    for o, im in zip(obj, img):
        ok, rv, tv = cv2.solvePnP(o, im, K, np.zeros(5), flags=cv2.SOLVEPNP_IPPE)
        if not ok:
            return None
        R, _ = cv2.Rodrigues(rv)
        hh, pp, rr, yy, C = pose_to_hpr(R, tv.ravel())
        hs.append(hh); ps.append(pp); pv.append([C[0], C[1], yy, rr])

    p0 = model.seed(seed_f, float(np.median(hs)), float(np.median(ps)), pv)
    lo, hi = model.bounds()
    p0 = np.clip(p0, lo + 1e-9, hi - 1e-9)

    def residuals(p):
        fx, fy, cx, cy, ks, h, pitch, pv_ = model.unpack(p)
        out = []
        for i in range(n):
            cxi, cyi, yaw, roll = pv_[i]
            R = cam_rotation(pitch, roll, yaw)
            t = -R @ np.array([cxi, cyi, h])
            out.append((project(obj[i], fx, fy, cx, cy, ks, R, t) - img[i]).ravel())
        return np.concatenate(out)

    # The Jacobian is overwhelmingly zero: a frame's (pos, yaw, roll) touches only
    # that frame's own 8 residuals. Declaring the sparsity turns an ~80-column
    # finite-difference Jacobian into ~(globals + 4) column groups. Order-of-
    # magnitude speedup, identical answer.
    g = model.g
    spars = np.zeros((8 * n, g + 4 * n), dtype=np.uint8)
    spars[:, :g] = 1
    for i in range(n):
        spars[8 * i:8 * (i + 1), g + 4 * i: g + 4 * (i + 1)] = 1

    return least_squares(residuals, p0, bounds=(lo, hi), loss="soft_l1",
                         f_scale=2.0, max_nfev=6000, jac_sparsity=spars)


def measure_grating(model, p, im_pts, near_mm, side_mm):
    """Use the SOLVED rig to measure a grating we pretend we don't know the size of.

    Rig gives fx,fy,cx,cy,k,h,pitch. Roll comes per-frame. We recover the ground
    homography, project the 4 clicked corners onto the ground, and read off the
    rectangle's dimensions in metres. Returns (near_mm, side_mm) as MEASURED.
    """
    fx, fy, cx, cy, ks, h, pitch, _ = model.unpack(p)

    def ground_from_px(px, roll):
        """Undistort a pixel, then intersect its ray with the ground plane z=0."""
        pts = np.array([[px]], dtype=np.float64)
        K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.0]])
        und = cv2.undistortPoints(pts, K, np.array([ks[0], ks[1], 0, 0, ks[2]]))
        u, v = und[0, 0]
        R = cam_rotation(pitch, roll, 0.0)  # yaw=0: measure in the camera's own frame
        ray_w = R.T @ np.array([u, v, 1.0])
        C = np.array([0.0, 0.0, h])
        if abs(ray_w[2]) < 1e-9 or (-C[2] / ray_w[2]) <= 0:
            return None
        return (C + (-C[2] / ray_w[2]) * ray_w)[:2]

    # Roll is the only per-frame unknown. Solve it by requiring the grating to be
    # a RECTANGLE on the ground (its two side edges must be parallel & equal).
    def rect_error(roll):
        g = [ground_from_px(p_, roll[0]) for p_ in im_pts]
        if any(x is None for x in g):
            return [1e3, 1e3]
        g = np.array(g)
        e_near, e_far = g[1] - g[0], g[2] - g[3]
        e_l, e_r = g[3] - g[0], g[2] - g[1]
        # opposite edges equal in length, and adjacent edges perpendicular
        return [np.linalg.norm(e_near) - np.linalg.norm(e_far),
                float(np.dot(e_near, e_l)) / (np.linalg.norm(e_near) * np.linalg.norm(e_l) + 1e-9)]

    r = least_squares(rect_error, [0.0], bounds=([-np.deg2rad(60)], [np.deg2rad(60)]))
    g = np.array([ground_from_px(p_, r.x[0]) for p_ in im_pts])
    near = (np.linalg.norm(g[1] - g[0]) + np.linalg.norm(g[2] - g[3])) / 2 * 1000
    side = (np.linalg.norm(g[3] - g[0]) + np.linalg.norm(g[2] - g[1])) / 2 * 1000
    return near, side, np.rad2deg(r.x[0])


def main() -> None:
    if not ANCHORS.exists():
        print(f"No anchors at {ANCHORS} - run scripts/TEMP_grating_clicker.py first.")
        return
    recs = json.loads(ANCHORS.read_text())
    n = len(recs)
    W, H = recs[0]["image_size"]
    obj = [grating_corners(r["near_edge_mm"], r["side_edge_mm"]) for r in recs]
    img = [np.array(r["corners_px"], dtype=np.float64) for r in recs]

    print("=" * 78)
    print(f"CAMERA-MODEL SELECTION  ({n} anchors, {W}x{H})")
    print("Chosen by LEAVE-ONE-OUT metric error - the honest end-to-end accuracy.")
    print("=" * 78)
    print(f"{'model':<28} {'params':>6} {'RMS px':>7} {'h (m)':>7} {'h sd':>6} {'LOO err':>9}")
    print("-" * 78)

    results = {}
    for name, cfg in MODELS.items():
        model = Model(cfg, W, H, n)
        sol = fit(model, obj, img)
        if sol is None:
            continue
        fx, fy, cx, cy, ks, h, pitch, pv = model.unpack(sol.x)
        rms = float(np.sqrt((sol.fun ** 2).mean()))

        # leave-one-out: refit without i, then MEASURE anchor i's grating
        loo = []
        for i in range(n):
            o2 = [o for j, o in enumerate(obj) if j != i]
            i2 = [im for j, im in enumerate(img) if j != i]
            m2 = Model(cfg, W, H, n - 1)
            s2 = fit(m2, o2, i2)
            if s2 is None:
                continue
            near_m, side_m, _ = measure_grating(m2, s2.x, img[i], recs[i]["near_edge_mm"], recs[i]["side_edge_mm"])
            en = abs(near_m - recs[i]["near_edge_mm"])
            es = abs(side_m - recs[i]["side_edge_mm"])
            loo.append((en + es) / 2)
        loo_err = float(np.median(loo)) if loo else float("nan")

        # per-frame h spread with the solved intrinsics
        K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.0]])
        dist = np.array([ks[0], ks[1], 0, 0, ks[2]])
        h_i = []
        for o, im in zip(obj, img):
            ok, rv, tv = cv2.solvePnP(o, im, K, dist, flags=cv2.SOLVEPNP_IPPE)
            if ok:
                R, _ = cv2.Rodrigues(rv)
                h_i.append(pose_to_hpr(R, tv.ravel())[0])
        h_sd = float(np.std(h_i))

        why = implausible(fx, fy, cx, cy, h, pitch, W, H)
        results[name] = dict(model=model, sol=sol, rms=rms, h=h, pitch=pitch, h_sd=h_sd,
                             loo=loo_err, fx=fx, fy=fy, cx=cx, cy=cy, ks=ks, why=why)
        tag = "  REJECTED: " + "; ".join(why) if why else ""
        print(f"{name:<28} {model.g + 4*n:>6} {rms:>7.2f} {h:>7.3f} {h_sd:>6.3f} {loo_err:>7.0f}mm{tag}")

    ok = {k: v for k, v in results.items() if not v["why"]}
    if not ok:
        print("\nEVERY model was physically implausible - do not trust this calibration.")
        for k, v in results.items():
            print(f"  {k}: {'; '.join(v['why'])}")
        return
    best_name = min(ok, key=lambda k: ok[k]["loo"])
    b = ok[best_name]
    fx, fy, cx, cy, ks = b["fx"], b["fy"], b["cx"], b["cy"], b["ks"]

    print("=" * 78)
    print(f"BEST MODEL: {best_name}")
    print("=" * 78)
    print(f"  fx, fy         : {fx:8.1f}, {fy:8.1f} px   (HFOV ~ {2*np.rad2deg(np.arctan(cx/fx)):.0f} deg)")
    print(f"  principal point: {cx:8.1f}, {cy:8.1f}      (image centre = {W/2:.0f}, {H/2:.0f})")
    print(f"  distortion k   : {', '.join(f'{k:+.4f}' for k in ks[:3])}")
    print(f"  camera height h: {b['h']:8.3f} m       <-- RIG CONSTANT")
    print(f"  camera pitch   : {np.rad2deg(b['pitch']):8.2f} deg down  <-- RIG CONSTANT")
    print(f"  reprojection   : {b['rms']:8.2f} px RMS")
    print()
    print(f"  >>> LEAVE-ONE-OUT metric error: {b['loo']:.0f} mm  <<<")
    print(f"      (median error when measuring a grating the rig has never seen)")

    OUT.write_text(json.dumps({
        "model": best_name,
        "fx": fx, "fy": fy, "cx": cx, "cy": cy,
        "k": [float(x) for x in ks[:3]],
        "height_m": b["h"], "pitch_deg": float(np.rad2deg(b["pitch"])),
        "image_size": [W, H], "reproj_rms_px": b["rms"],
        "loo_err_mm": b["loo"], "h_sd_m": b["h_sd"], "n_anchors": n,
    }, indent=2))
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
