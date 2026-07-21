"""TEMP TOOL — DELETE BEFORE SHIP. Tracked in temp/IN_IMAGE_METROLOGY_FEATURE.md §11.

Grating-anchor corner clicker. Collects the calibration data for the in-image
metrology feature: you click the 4 outline corners of a drain/sump grating on a
set of survey frames, and this writes the image<->metric correspondences to JSON.

That JSON is what pins down the rig constants (camera height h, pitch theta) and
the lens distortion coefficient. See §9 of the design doc.

USAGE
    backend\\.venv\\Scripts\\python.exe scripts\\TEMP_grating_clicker.py

CONTROLS
    left-click x4   mark the grating OUTLINE corners, in this order:
                      1. NEAR-LEFT    (corner closest to camera, left side)
                      2. NEAR-RIGHT
                      3. FAR-RIGHT
                      4. FAR-LEFT
                    (i.e. clockwise, starting nearest-left. "Near" = closer to you.)
    1..5            set the grating's real size, then it SAVES and advances:
                      1 = 700 x 850    (near edge 700mm, side 850mm)
                      2 = 850 x 700    (near edge 850mm, side 700mm)
                      3 = 850 x 1000
                      4 = 1000 x 850
                      5 = 1500 x 1500  (square - orientation doesn't matter)
    u               undo last corner
    n / SPACE       skip this frame (no usable grating)
    b               go back one frame
    q / ESC         quit and write the JSON

After the 4th click a 1 m grid is projected onto the ground from your corners so
you can eyeball whether the solve is plausible BEFORE saving. If the grid looks
wildly wrong, press 'u' and re-click.

TARGET: ~12-15 good frames is plenty. Prefer gratings that are:
  - fully visible (all 4 corners), not clipped by the frame edge
  - in the NEAR field (lower half of the image) - that's the trusted zone
  - on flat ground, lying in the path plane (not on a slope or raised verge)
  - spread across DIFFERENT streets/folders, and across different bike lean angles
"""
from __future__ import annotations

import glob
import json
import random
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[1]
IN_ROOT = REPO / "in"
OUT_JSON = REPO / "temp" / "grating_anchors.json"

DISPLAY_SCALE = 2  # 640x457 is small; upscale for precise clicking
N_FOLDERS = 140  # how many street folders to sample frames from
PER_FOLDER = 2

# key -> (near_edge_mm, side_edge_mm)
SIZES = {
    ord("1"): (700, 850),
    ord("2"): (850, 700),
    ord("3"): (850, 1000),
    ord("4"): (1000, 850),
    ord("5"): (1500, 1500),
}

WIN = "grating clicker  |  click 4 corners: near-L, near-R, far-R, far-L  |  1-5=save  u=undo  n=skip  b=back  q=quit"


def build_frame_list() -> list[Path]:
    random.seed(11)
    folders = sorted(p for p in IN_ROOT.glob("*") if p.is_dir())
    folders = random.sample(folders, min(N_FOLDERS, len(folders)))
    frames: list[Path] = []
    for f in folders:
        imgs = sorted(f.glob("*.jpeg"))
        if not imgs:
            continue
        frames.extend(random.sample(imgs, min(PER_FOLDER, len(imgs))))
    random.shuffle(frames)
    return frames


def solve_h(corners_px: list[tuple[float, float]], near_mm: float, side_mm: float):
    """4 image corners -> ground-plane homography (pixels -> metres).

    Ground frame: origin at the grating's near-left corner, +x to the right along
    the near edge, +y away from the camera along the side edge.
    """
    src = np.array(corners_px, dtype=np.float32)
    w, l = near_mm / 1000.0, side_mm / 1000.0
    dst = np.array([[0, 0], [w, 0], [w, l], [0, l]], dtype=np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def draw_grid_preview(canvas, H, scale: int):
    """Project a 1 m ground grid back into the image to sanity-check the solve."""
    try:
        Hinv = np.linalg.inv(H)
    except np.linalg.LinAlgError:
        return

    def to_px(x, y):
        p = Hinv @ np.array([x, y, 1.0])
        if abs(p[2]) < 1e-9:
            return None
        return (p[0] / p[2] * scale, p[1] / p[2] * scale)

    def seg(a, b, color, thick=1):
        pa, pb = to_px(*a), to_px(*b)
        if pa is None or pb is None:
            return
        h, w = canvas.shape[:2]
        # cheap reject of wildly out-of-frame projections
        if not all(-4 * w < v < 5 * w for v in (pa[0], pb[0])):
            return
        if not all(-4 * h < v < 5 * h for v in (pa[1], pb[1])):
            return
        cv2.line(canvas, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])), color, thick, cv2.LINE_AA)

    # grid spans 4 m either side of the anchor, 6 m out from it
    X0, X1, Y0, Y1 = -4, 4, -2, 6
    for x in range(X0, X1 + 1):
        seg((x, Y0), (x, Y1), (90, 200, 90))
    for y in range(Y0, Y1 + 1):
        seg((X0, y), (X1, y), (90, 200, 90))
    # highlight the anchor rectangle itself in a hot colour
    seg((0, 0), (1, 0), (60, 60, 255), 2)


def main() -> None:
    frames = build_frame_list()
    if not frames:
        print("No frames found under", IN_ROOT)
        return

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []
    if OUT_JSON.exists():
        try:
            records = json.loads(OUT_JSON.read_text())
            print(f"Resuming: {len(records)} anchors already saved in {OUT_JSON}")
        except json.JSONDecodeError:
            records = []
    done = {r["image"] for r in records}

    clicks: list[tuple[float, float]] = []

    def on_mouse(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and len(clicks) < 4:
            clicks.append((x / DISPLAY_SCALE, y / DISPLAY_SCALE))

    cv2.namedWindow(WIN, cv2.WINDOW_AUTOSIZE)
    cv2.setMouseCallback(WIN, on_mouse)

    i = 0
    while 0 <= i < len(frames):
        path = frames[i]
        rel = str(path.relative_to(REPO)).replace("\\", "/")
        if rel in done:
            i += 1
            continue

        img = cv2.imread(str(path))
        if img is None:
            i += 1
            continue

        clicks.clear()
        while True:
            canvas = cv2.resize(
                img, None, fx=DISPLAY_SCALE, fy=DISPLAY_SCALE, interpolation=cv2.INTER_CUBIC
            )

            # preview grid once all 4 corners are down (uses a 1500sq guess purely
            # for the visual; the real size is chosen on save)
            if len(clicks) == 4:
                try:
                    draw_grid_preview(canvas, solve_h(clicks, 1500, 1500), DISPLAY_SCALE)
                except cv2.error:
                    pass

            for n, (cx, cy) in enumerate(clicks):
                p = (int(cx * DISPLAY_SCALE), int(cy * DISPLAY_SCALE))
                cv2.circle(canvas, p, 5, (0, 0, 255), -1)
                cv2.putText(canvas, str(n + 1), (p[0] + 7, p[1] - 7),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2, cv2.LINE_AA)
            if len(clicks) == 4:
                pts = np.array([[int(x * DISPLAY_SCALE), int(y * DISPLAY_SCALE)] for x, y in clicks])
                cv2.polylines(canvas, [pts], True, (0, 220, 255), 2, cv2.LINE_AA)

            status = (
                f"[{i + 1}/{len(frames)}]  saved={len(records)}  corners={len(clicks)}/4   {path.parent.name}"
            )
            hint = "press 1-5 to pick size + SAVE" if len(clicks) == 4 else "click near-L, near-R, far-R, far-L"
            cv2.rectangle(canvas, (0, 0), (canvas.shape[1], 44), (0, 0, 0), -1)
            cv2.putText(canvas, status, (8, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.putText(canvas, hint, (8, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 220, 255), 1, cv2.LINE_AA)

            cv2.imshow(WIN, canvas)
            k = cv2.waitKey(20) & 0xFF

            if k in (ord("q"), 27):
                cv2.destroyAllWindows()
                OUT_JSON.write_text(json.dumps(records, indent=2))
                print(f"\nWrote {len(records)} anchors -> {OUT_JSON}")
                return
            if k == ord("u") and clicks:
                clicks.pop()
            elif k in (ord("n"), ord(" ")):
                i += 1
                break
            elif k == ord("b"):
                i = max(0, i - 1)
                break
            elif k in SIZES and len(clicks) == 4:
                near_mm, side_mm = SIZES[k]
                records.append({
                    "image": rel,
                    "folder": path.parent.name,
                    "corners_px": [[round(x, 2), round(y, 2)] for x, y in clicks],
                    "corner_order": ["near_left", "near_right", "far_right", "far_left"],
                    "near_edge_mm": near_mm,
                    "side_edge_mm": side_mm,
                    "image_size": [img.shape[1], img.shape[0]],
                })
                OUT_JSON.write_text(json.dumps(records, indent=2))
                print(f"saved {len(records):3d}  {near_mm}x{side_mm}mm  {rel}")
                i += 1
                break

    cv2.destroyAllWindows()
    OUT_JSON.write_text(json.dumps(records, indent=2))
    print(f"\nDone. Wrote {len(records)} anchors -> {OUT_JSON}")


if __name__ == "__main__":
    main()
