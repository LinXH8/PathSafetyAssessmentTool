"""
visualize_width_restriction.py
Visualise how Width Restriction is being decided for a folder of images.

For every image the script:
  1. Runs the path-segmentation model and overlays the pathway mask in semi-transparent green.
  2. Runs the obstacle-detector model and draws each bounding box.
  3. For every detection it shows:
       • The obstacle centrepoint (filled circle).
       • The path centrepoint at the base of that obstacle (filled circle).
       • A horizontal bracket showing the 90 % path-width span (5th–95th percentile).
       • A vertical "centre exclusion zone" band (±15 % of image width from image centre)
         — obstacles whose centrepoint falls outside this band are skipped (yellow box).
       • Whether the obstacle is BLOCKING (red) or CLEAR (green), with the ratio printed.
  4. Shows the final Width Restriction result in a summary overlay.

Usage
-----
    python scripts/visualize_width_restriction.py -i /path/to/images -o output_folder
"""

import sys
import argparse
import cv2
import numpy as np
from pathlib import Path

# Resolve backend/ relative to this script's location in scripts/
_BACKEND_ROOT = Path(__file__).resolve().parent.parent / "backend"
sys.path.append(str(_BACKEND_ROOT))
from app.services.prediction import CycleRAP_Coding_Helper

# ── colours (BGR) ───────────────────────────────────────────────────────────
C_PATHWAY   = (0,   200,  50)   # green – pathway mask tint
C_BLOCKING  = (40,  40,  230)   # red   – blocking obstacle box
C_CLEAR     = (50,  200,  50)   # green – non-blocking obstacle box
C_OBJ_PT    = (40,  40,  230)   # red   – obstacle centrepoint
C_PATH_PT   = (230, 160,  30)   # blue  – path centrepoint
C_WIDTH_BAR = (230, 160,  30)   # blue  – 5th–95th path-width bracket
C_TEXT      = (255, 255, 255)
C_TEXT_DARK = (20,  20,   20)

FONT      = cv2.FONT_HERSHEY_SIMPLEX
FONT_SM   = 0.45
FONT_MD   = 0.65
FONT_LG   = 0.85
THICK_TXT = 1
THICK_BOX = 2


# ── helpers ──────────────────────────────────────────────────────────────────

def overlay_mask(canvas: np.ndarray, mask: np.ndarray, colour_bgr: tuple, alpha: float = 0.35):
    """Blend a binary mask as a colour tint onto canvas in-place."""
    tint = canvas.copy()
    tint[mask > 0] = colour_bgr
    cv2.addWeighted(tint, alpha, canvas, 1 - alpha, 0, canvas)


def draw_label(canvas, text: str, x: int, y: int, fg=C_TEXT, bg=(0, 0, 0), scale=FONT_SM, thickness=THICK_TXT, pad=3):
    """Draw text with a filled background rectangle."""
    (tw, th), baseline = cv2.getTextSize(text, FONT, scale, thickness)
    cv2.rectangle(canvas, (x - pad, y - th - pad), (x + tw + pad, y + baseline + pad), bg, -1)
    cv2.putText(canvas, text, (x, y), FONT, scale, fg, thickness, cv2.LINE_AA)


def analyze_obstacle_verbose(obstacle_box, path_mask, threshold=0.1):
    """
    Same logic as CycleRAP_Coding_Helper._analyze_obstacle but also returns
    the path-width bracket endpoints for visualisation.
    """
    x_min, y_min, x_max, y_max = map(int, obstacle_box)
    obstacle_center_x = int((x_min + x_max) / 2)
    bottom_y = min(y_max + 10, path_mask.shape[0] - 1)

    path_row = path_mask[bottom_y, :]
    if not np.any(path_row):
        return False, 0.0, 0, 0, bottom_y, None, None

    path_pixels_x = np.where(path_row > 0)[0]

    splits = np.where(np.diff(path_pixels_x) > 1)[0] + 1
    runs = np.split(path_pixels_x, splits)
    longest_run = max(runs, key=len)
    path_center_x = int((longest_run[0] + longest_run[-1]) / 2)

    p5  = int(np.percentile(path_pixels_x, 5))
    p95 = int(np.percentile(path_pixels_x, 95))
    path_width = p95 - p5

    if path_width < 10:
        return False, 0.0, path_center_x, obstacle_center_x, bottom_y, p5, p95

    deviation  = abs(path_center_x - obstacle_center_x)
    ratio      = deviation / path_width
    is_blocking = ratio < threshold
    return is_blocking, ratio, path_center_x, obstacle_center_x, bottom_y, p5, p95


# ── per-image processing ─────────────────────────────────────────────────────

def process_image(img_file: Path, conf_thresh: float) -> np.ndarray:
    img_bgr = cv2.imread(str(img_file))
    if img_bgr is None:
        raise ValueError(f"Cannot read {img_file}")

    img_h, img_w = img_bgr.shape[:2]

    # ── 1. Path segmentation ────────────────────────────────────────────
    seg_results = CycleRAP_Coding_Helper.path_segmentation_model.predict(
        source=str(img_file), conf=conf_thresh, verbose=False
    )
    masks = CycleRAP_Coding_Helper._build_masks(
        seg_results[0], CycleRAP_Coding_Helper.class_sets, img_h, img_w, conf_thresh
    )
    pathway_mask = masks["pathway"]

    # ── 2. Obstacle detection ────────────────────────────────────────────
    _, _, detections = CycleRAP_Coding_Helper._detect_obstacles(
        img_file, CycleRAP_Coding_Helper.obstacle_detector_model, conf_thresh
    )

    # ── 3. Compute width restriction (mirrors _compute_width_restriction) ─
    blocking_fixed     = []
    blocking_non_fixed = []
    is_restricted      = False
    det_results        = []   # (det, is_blocking, ratio, path_cx, obj_cx, bottom_y, p5, p95)

    for det in detections:
        box = (det["x1"], det["y1"], det["x2"], det["y2"])
        is_blocking, ratio, path_cx, obj_cx, bottom_y, p5, p95 = analyze_obstacle_verbose(
            box, pathway_mask
        )

        if is_blocking:
            is_restricted = True
            cname = det["class_name"]
            if det["group"] == "fixed":
                if cname not in blocking_fixed:
                    blocking_fixed.append(cname)
            else:
                if cname not in blocking_non_fixed:
                    blocking_non_fixed.append(cname)

        det_results.append((det, is_blocking, ratio, path_cx, obj_cx, bottom_y, p5, p95))

    width_restriction = "Present" if is_restricted else "Not Present"

    # ── 4. Draw ──────────────────────────────────────────────────────────
    canvas = img_bgr.copy()

    # Pathway mask overlay
    overlay_mask(canvas, pathway_mask, C_PATHWAY, alpha=0.30)

    # Per-detection visuals
    for det, is_blocking, ratio, path_cx, obj_cx, bottom_y, p5, p95 in det_results:
        x1, y1, x2, y2 = det["x1"], det["y1"], det["x2"], det["y2"]

        box_colour = C_BLOCKING if is_blocking else C_CLEAR
        label_text = f"{det['class_name']} [BLOCKING]" if is_blocking else f"{det['class_name']} [CLEAR]"

        # Bounding box
        cv2.rectangle(canvas, (x1, y1), (x2, y2), box_colour, THICK_BOX)

        # Obstacle centrepoint
        cv2.circle(canvas, (obj_cx, (y1 + y2) // 2), 6, C_OBJ_PT, -1)
        cv2.circle(canvas, (obj_cx, (y1 + y2) // 2), 6, C_TEXT,    1)

        # Path centrepoint at bottom_y
        if path_cx > 0 and bottom_y is not None:
            cv2.circle(canvas, (path_cx, bottom_y), 6, C_PATH_PT, -1)
            cv2.circle(canvas, (path_cx, bottom_y), 6, C_TEXT,     1)

            # Line connecting path_cx to obj_cx at bottom_y
            cv2.line(canvas, (path_cx, bottom_y), (obj_cx, bottom_y), C_TEXT, 1, cv2.LINE_AA)

            # Path width bracket (5th–95th percentile) at bottom_y
            if p5 is not None and p95 is not None:
                bk_y = bottom_y - 8
                cv2.line(canvas, (p5, bk_y - 5), (p95, bk_y - 5), C_WIDTH_BAR, 2, cv2.LINE_AA)
                cv2.line(canvas, (p5, bk_y - 5 - 4), (p5, bk_y - 5 + 4),   C_WIDTH_BAR, 2)
                cv2.line(canvas, (p95, bk_y - 5 - 4), (p95, bk_y - 5 + 4), C_WIDTH_BAR, 2)
                draw_label(canvas, f"path w={p95 - p5}px",
                           (p5 + p95) // 2 - 30, bk_y - 12, fg=C_WIDTH_BAR, bg=C_TEXT_DARK, scale=FONT_SM - 0.05)

        draw_label(canvas, label_text,
                   x1, max(y1 - 6, 12), fg=box_colour, bg=C_TEXT_DARK, scale=FONT_SM)

    # ── 5. Summary overlay (bottom-left) ─────────────────────────────────
    wr_colour = C_BLOCKING if is_restricted else C_CLEAR
    lines = [
        (f"Width Restriction: {width_restriction}", wr_colour),
        (f"Blocking fixed:     {', '.join(blocking_fixed) or 'none'}",      C_TEXT),
        (f"Blocking non-fixed: {', '.join(blocking_non_fixed) or 'none'}", C_TEXT),
        (f"threshold=0.10",                                                  C_TEXT),
    ]
    line_h  = 28
    box_h   = len(lines) * line_h + 16
    box_w   = 490
    y_start = img_h - box_h - 10
    bg_rect = canvas.copy()
    cv2.rectangle(bg_rect, (8, y_start), (8 + box_w, img_h - 10), (0, 0, 0), -1)
    cv2.addWeighted(bg_rect, 0.65, canvas, 0.35, 0, canvas)
    for i, (text, colour) in enumerate(lines):
        cv2.putText(canvas, text, (16, y_start + 20 + i * line_h),
                    FONT, FONT_MD, colour, THICK_TXT + 1, cv2.LINE_AA)

    # ── 6. Legend (top-right) ────────────────────────────────────────────
    legend = [
        ("Pathway mask",         C_PATHWAY),
        ("Obstacle centrepoint", C_OBJ_PT),
        ("Path centrepoint",     C_PATH_PT),
        ("Path width bracket",   C_WIDTH_BAR),
        ("Blocking obstacle",    C_BLOCKING),
        ("Clear obstacle",       C_CLEAR),
    ]
    lx = img_w - 230
    for i, (label, colour) in enumerate(legend):
        ly = 18 + i * 22
        cv2.circle(canvas, (lx, ly - 4), 6, colour, -1)
        cv2.putText(canvas, label, (lx + 14, ly), FONT, FONT_SM, colour, THICK_TXT, cv2.LINE_AA)

    return canvas


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Visualise Width Restriction logic on a folder of images."
    )
    parser.add_argument("--input",  "-i", required=True,
                        help="Path to the input folder containing images.")
    parser.add_argument("--output", "-o", default="visualized_width_restriction",
                        help="Output folder name (default: visualized_width_restriction).")
    parser.add_argument("--conf",   "-c", type=float, default=0.5,
                        help="Confidence threshold for both models (default: 0.5).")
    args = parser.parse_args()

    input_path  = Path(args.input)
    output_path = Path(args.output)
    output_path.mkdir(parents=True, exist_ok=True)

    model_dir = _BACKEND_ROOT / "models"
    print(f"Loading models from {model_dir} …", flush=True)
    import os, io
    with open(os.devnull, "w") as _devnull:
        _real_stdout, sys.stdout = sys.stdout, _devnull
        try:
            CycleRAP_Coding_Helper.initialise(model_dir)
        finally:
            sys.stdout = _real_stdout
    print("Models loaded.", flush=True)

    exts   = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    images = sorted(f for f in input_path.iterdir() if f.suffix.lower() in exts)
    if not images:
        print(f"No images found in {input_path}")
        return

    print(f"Processing {len(images)} image(s) …")
    for img_file in images:
        print(f"  {img_file.name}", end="", flush=True)
        try:
            canvas = process_image(img_file, args.conf)
            out_file = output_path / img_file.name
            cv2.imwrite(str(out_file), canvas)
            print(f"  → {out_file}")
        except Exception as exc:
            print(f"  ERROR: {exc}")

    print(f"\nDone. Results saved to: {output_path.resolve()}")


if __name__ == "__main__":
    main()
