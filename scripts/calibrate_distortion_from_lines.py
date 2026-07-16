"""Calibrate lens distortion by 'straight lines must be straight' (plumb-line method).

WHY THIS EXISTS
---------------
The first distortion estimate (k1 = -0.0731) was fit jointly with camera pose from 18
clicked gratings - all small, all in a narrow band near the middle of the frame. But
at ~108 deg HFOV, distortion is dominated by behaviour at LARGE RADIUS, where those
gratings gave no constraint at all. Result: k1 was overfit to the centre and is too
strong. The user observed it directly - the projected grid lines bow MORE than the
genuinely-straight lines in the photo.

THE FIX
-------
Urban scenes are full of world-straight lines: kerbs, path edges, railings, poles,
building edges. Barrel distortion bends them. The correct distortion coefficients are
the ones that make them straight again - and crucially, these lines span the WHOLE
frame, including the periphery where the gratings told us nothing.

METHOD
------
1. Canny -> trace edge chains (contours, no approximation).
2. Keep long, elongated chains that are ALREADY roughly linear - a world-straight line
   bent by barrel distortion is a gentle arc, not a blob. Reject tree canopy, foliage,
   text, and genuinely curved kerbs by requiring modest bow.
3. For candidate (k1, k2): undistort every chain's points, fit a line by PCA, take the
   RMS perpendicular residual. The true distortion minimises this over all chains.
4. Robust aggregation (trimmed mean) so a few genuinely-curved chains can't dominate.

Usage:
    backend\\.venv\\Scripts\\python.exe scripts\\calibrate_distortion_from_lines.py
"""
from __future__ import annotations

import glob
import json
import random
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import minimize_scalar, minimize

REPO = Path(__file__).resolve().parents[1]
IN_ROOT = REPO / "in"
OUT = REPO / "temp" / "distortion_from_lines.json"

N_FOLDERS = 90
PER_FOLDER = 2
MIN_CHAIN_PTS = 70        # long enough that curvature is measurable
MIN_ELONGATION = 5.0      # length / thickness - reject blobs
MAX_BOW_FRAC = 0.06       # a distorted straight line bows gently; more => really curved


def edge_chains(gray):
    """Long, thin, gently-bowed edge chains == candidate world-straight lines."""
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in contours:
        pts = c.reshape(-1, 2).astype(np.float64)
        if len(pts) < MIN_CHAIN_PTS:
            continue
        mean = pts.mean(axis=0)
        u, s, _ = np.linalg.svd(pts - mean, full_matrices=False)
        if s[1] < 1e-9:
            continue
        if s[0] / s[1] < MIN_ELONGATION:      # not line-like
            continue
        # bow: perpendicular spread relative to length. A straight line bent by barrel
        # distortion is a gentle arc; foliage/curved kerbs bow far more.
        length = 4 * s[0] / np.sqrt(len(pts))
        bow = (4 * s[1] / np.sqrt(len(pts))) / max(length, 1e-6)
        if bow > MAX_BOW_FRAC:
            continue
        # thin out - we don't need every pixel
        out.append(pts[:: max(1, len(pts) // 40)])
    return out


def straightness(chains, K, k1, k2):
    """Dimensionless BOW per chain: perpendicular spread / along-chain spread.

    CRITICAL that this is a RATIO, not an absolute pixel residual. An absolute
    residual can be driven to zero by any distortion that collapses the chain toward
    a point - and the optimiser WILL find that (it ran off to k1=1e16 doing exactly
    this). A ratio is scale-invariant, so shrinking buys nothing; only genuinely
    straightening the line lowers the cost.
    """
    dist = np.array([k1, k2, 0.0, 0.0, 0.0])
    res = []
    for pts in chains:
        und = cv2.undistortPoints(pts.reshape(-1, 1, 2), K, dist, P=K).reshape(-1, 2)
        if not np.all(np.isfinite(und)):
            return None
        d = und - und.mean(axis=0)
        _, s, _ = np.linalg.svd(d, full_matrices=False)
        if s[0] < 1e-6:
            return None
        res.append(s[1] / s[0])                # bow ratio - dimensionless
    return np.array(res)


def cost(chains, K, k1, k2):
    # keep coefficients physically sane; a real lens does not need |k1| > 0.5
    if not (-0.5 <= k1 <= 0.2) or not (-0.2 <= k2 <= 0.2):
        return 1e6
    r = straightness(chains, K, k1, k2)
    if r is None or len(r) == 0:
        return 1e6
    r = np.sort(r)
    keep = r[: max(1, int(0.85 * len(r)))]     # trim the worst 15% (genuinely curved)
    return float(keep.mean())


def main() -> None:
    random.seed(5)
    folders = sorted(p for p in IN_ROOT.glob("*") if p.is_dir())
    folders = random.sample(folders, min(N_FOLDERS, len(folders)))

    chains, n_img = [], 0
    for f in folders:
        imgs = sorted(f.glob("*.jpeg"))
        if not imgs:
            continue
        for p in random.sample(imgs, min(PER_FOLDER, len(imgs))):
            g = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
            if g is None:
                continue
            n_img += 1
            chains.extend(edge_chains(g))

    if len(chains) < 50:
        print(f"Only {len(chains)} usable chains - too few.")
        return

    H, W = 457, 640
    cx, cy = W / 2.0, H / 2.0

    print("=" * 70)
    print("DISTORTION FROM STRAIGHT LINES  (plumb-line calibration)")
    print("=" * 70)
    print(f"  frames sampled : {n_img}")
    print(f"  straight-line candidates : {len(chains)}")
    print()

    # focal is coupled to distortion; sweep a few plausible values and let the
    # straightness objective pick. (Straightness is scale-invariant in the image, but
    # the normalised radius - hence how k1/k2 act - depends on f.)
    print(f"{'focal':>7}  {'k1':>9}  {'k2':>9}  {'straightness (px)':>18}")
    print("-" * 70)
    best = None
    for f_px in (200.0, 233.34, 270.0, 320.0):
        K = np.array([[f_px, 0, cx], [0, f_px, cy], [0, 0, 1.0]])
        r0 = cost(chains, K, 0.0, 0.0)
        sol = minimize(lambda p: cost(chains, K, p[0], p[1]), x0=[-0.05, 0.0],
                       method="Nelder-Mead",
                       options=dict(xatol=1e-4, fatol=1e-5, maxiter=200))
        k1, k2 = sol.x
        c = sol.fun
        star = ""
        if best is None or c < best["cost"]:
            best = dict(f=f_px, k1=k1, k2=k2, cost=c, undist=r0)
            star = "  <-- best"
        print(f"{f_px:7.1f}  {k1:+9.4f}  {k2:+9.4f}  {c:18.4f}{star}")

    K = np.array([[best['f'], 0, cx], [0, best['f'], cy], [0, 0, 1.0]])
    print("-" * 70)
    print(f"  straightness with NO correction : {best['undist']:.4f} px")
    print(f"  straightness after correction   : {best['cost']:.4f} px"
          f"   ({100*(1-best['cost']/best['undist']):.0f}% straighter)")
    print()
    print(f"  >>> k1 = {best['k1']:+.4f}   k2 = {best['k2']:+.4f}   (at f={best['f']:.1f}) <<<")
    print()
    print(f"  For comparison, the grating-only fit gave k1 = -0.0731.")
    if abs(best["k1"]) < 0.0731:
        print(f"  => CONFIRMS the user's observation: the old k1 was TOO STRONG")
        print(f"     (grid lines bowed more than the real straight lines).")

    OUT.write_text(json.dumps({
        "k1": best["k1"], "k2": best["k2"], "focal_used": best["f"],
        "principal_point": [cx, cy],
        "straightness_px_before": best["undist"], "straightness_px_after": best["cost"],
        "n_chains": len(chains), "n_frames": n_img,
    }, indent=2))
    print(f"  wrote {OUT}")


if __name__ == "__main__":
    main()
