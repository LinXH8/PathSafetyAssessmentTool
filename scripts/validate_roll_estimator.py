"""Validate the per-frame ROLL estimator against grating-derived ground truth.

This is the linchpin of the whole feature. At runtime, most frames have NO grating,
so roll (which swings +-20 deg because the bike leans) must be estimated from the
image alone. If that estimate is poor, the no-anchor path is worthless.

We can test it honestly: on the 18 anchor frames we know the TRUE roll, because the
clicked grating pins the full camera pose. So run the image-only estimator on those
same frames and compare.

The estimator: man-made verticals (lamp posts, building edges, railings, poles) are
plumb in the world. Their tilt in the image IS the camera roll. We Hough-detect long
near-vertical lines and take a length-weighted median.

Read the RMS error at the bottom. Roughly:
    < 1.5 deg  -> excellent; no-anchor path is solid
    1.5-3 deg  -> usable, widen the uncertainty band
    > 3 deg    -> the no-anchor path is NOT viable as-is

Usage:
    backend\\.venv\\Scripts\\python.exe scripts\\validate_roll_estimator.py
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[1]
ANCHORS = REPO / "temp" / "grating_anchors.json"
CALIB = REPO / "temp" / "rig_calibration.json"

import importlib.util

_spec = importlib.util.spec_from_file_location("cal", REPO / "scripts" / "calibrate_rig_from_anchors.py")
_cal = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_cal)


def estimate_roll_from_verticals(img_bgr, K, dist):
    """Image-only roll estimate. Returns degrees, or None if no verticals found.

    Undistort FIRST - barrel distortion bends straight verticals, which would
    otherwise bias the angle badly.
    """
    und = cv2.undistort(img_bgr, K, dist)
    gray = cv2.cvtColor(und, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    # Verticals live in the upper/middle band. The lower band is mostly ground
    # (path edges, kerbs) which are NOT plumb and would corrupt the estimate.
    y0, y1 = int(h * 0.02), int(h * 0.70)
    band = gray[y0:y1, :]

    edges = cv2.Canny(band, 60, 180, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 360, threshold=40,
                            minLineLength=35, maxLineGap=6)
    if lines is None:
        return None, 0

    cands = []
    for (ax, ay, bx, by) in lines[:, 0]:
        dx, dy = float(bx - ax), float(by - ay)
        if abs(dy) < 1e-6:
            continue
        ang = np.degrees(np.arctan2(dx, -dy))
        ang = (ang + 90) % 180 - 90
        if abs(ang) <= 30:                      # near-vertical only
            cands.append((ang, float(np.hypot(dx, dy))))
    if len(cands) < 3:
        return None, len(cands)

    # length-weighted median: long structures (posts, building edges) dominate
    cands.sort(key=lambda t: t[0])
    total = sum(l for _, l in cands)
    acc = 0.0
    for ang, l in cands:
        acc += l
        if acc >= total / 2:
            return ang, len(cands)
    return cands[len(cands) // 2][0], len(cands)


def main() -> None:
    if not CALIB.exists():
        print("Run scripts/calibrate_rig_from_anchors.py first.")
        return
    cal = json.loads(CALIB.read_text())
    recs = json.loads(ANCHORS.read_text())

    fx, fy, cx, cy = cal["fx"], cal["fy"], cal["cx"], cal["cy"]
    k = cal["k"]
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.0]])
    dist = np.array([k[0], k[1], 0, 0, k[2]])

    print("=" * 74)
    print("ROLL ESTIMATOR VALIDATION  (image-only estimate vs grating ground truth)")
    print("=" * 74)
    print(f"{'#':>2}  {'true':>7}  {'est':>7}  {'error':>7}  {'lines':>5}   folder")
    print("-" * 74)

    errs, n_fail = [], 0
    for i, r in enumerate(recs):
        img = cv2.imread(str(REPO / r["image"]))
        if img is None:
            continue

        # ground truth roll: PnP the clicked grating with the solved intrinsics
        obj = _cal.grating_corners(r["near_edge_mm"], r["side_edge_mm"])
        imp = np.array(r["corners_px"], dtype=np.float64)
        ok, rv, tv = cv2.solvePnP(obj, imp, K, dist, flags=cv2.SOLVEPNP_IPPE)
        if not ok:
            continue
        R, _ = cv2.Rodrigues(rv)
        _, _, roll_true, _, _ = _cal.pose_to_hpr(R, tv.ravel())
        roll_true = np.rad2deg(roll_true)

        est, nlines = estimate_roll_from_verticals(img, K, dist)
        if est is None:
            n_fail += 1
            print(f"{i:2d}  {roll_true:+7.2f}  {'--':>7}  {'FAIL':>7}  {nlines:5d}   {r['folder']}")
            continue

        err = est - roll_true
        errs.append(err)
        flag = "  <-- BAD" if abs(err) > 3 else ""
        print(f"{i:2d}  {roll_true:+7.2f}  {est:+7.2f}  {err:+7.2f}  {nlines:5d}   {r['folder']}{flag}")

    if not errs:
        print("\nNo estimates produced.")
        return
    e = np.array(errs)
    rms = float(np.sqrt((e ** 2).mean()))
    print("-" * 74)
    print(f"  frames estimated : {len(e)} / {len(recs)}   ({n_fail} had too few verticals)")
    print(f"  bias (mean err)  : {e.mean():+6.2f} deg")
    print(f"  RMS error        : {rms:6.2f} deg   <<< THE NUMBER")
    print(f"  median |err|     : {np.median(np.abs(e)):6.2f} deg")
    print(f"  worst |err|      : {np.abs(e).max():6.2f} deg")
    print()
    if rms < 1.5:
        print("  => EXCELLENT. No-anchor path is solid.")
    elif rms < 3.0:
        print("  => USABLE. Widen the uncertainty band on no-anchor frames.")
    else:
        print("  => NOT VIABLE as-is. The no-anchor path needs a better roll cue")
        print("     (path-edge vanishing point, or a manual horizon nudge).")

    # What does the roll error COST in metres? Roll tilts the ground plane, so a
    # lateral offset d out from the camera picks up an error ~ d * tan(roll_err).
    print()
    print("  Cost of that error when measuring sideways clearance:")
    for d in (2.0, 3.0, 5.0):
        print(f"    at {d:.0f} m out : ~{d*np.tan(np.deg2rad(rms))*100:5.1f} cm")


if __name__ == "__main__":
    main()
