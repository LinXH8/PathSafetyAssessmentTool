import sys
import cv2
import numpy as np
import argparse
from pathlib import Path

# Resolve backend/ relative to this script's location in scripts/
_BACKEND_ROOT = Path(__file__).resolve().parent.parent / "backend"
sys.path.append(str(_BACKEND_ROOT))

from app.services.prediction import CycleRAP_Coding_Helper

def main():
    parser = argparse.ArgumentParser(description="Visualize obstacle detection and centerline analysis.")
    parser.add_argument("--input", "-i", required=True, help="Path to input folder of images")
    parser.add_argument("--output", "-o", default="visualized_obstacles", help="Name of the output folder")
    parser.add_argument("--conf", "-c", type=float, default=0.5, help="Confidence threshold")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    output_path.mkdir(parents=True, exist_ok=True)

    model_dir = _BACKEND_ROOT / "models"
    
    print(f"Initializing models from {model_dir}...")
    try:
        CycleRAP_Coding_Helper.initialise(model_dir)
    except Exception as e:
        print(f"Error initializing models: {e}")
        return

    image_extensions = {".jpg", ".jpeg", ".png", ".bmp"}
    images = [f for f in input_path.iterdir() if f.suffix.lower() in image_extensions]

    if not images:
        print(f"No images found in {input_path}")
        return

    print(f"Processing {len(images)} images...")

    for img_file in images:
        print(f"Processing {img_file.name}...")
        
        img_bgr = cv2.imread(str(img_file))
        if img_bgr is None:
            print(f"Failed to read {img_file}")
            continue
            
        img_h, img_w = img_bgr.shape[:2]
        
        # Run Path Segmentation
        # We need the path mask to calculate the path centerline relative to obstacles
        seg_results = CycleRAP_Coding_Helper.path_segmentation_model.predict(
            source=str(img_file), conf=args.conf, verbose=False
        )
        seg_result = seg_results[0]
        masks = CycleRAP_Coding_Helper._build_masks(seg_result, CycleRAP_Coding_Helper.class_sets, img_h, img_w, args.conf)
        path_mask = masks.get("pathway")
        
        # Run Obstacle Detection
        fixed_obs, non_fixed_obs, detections = CycleRAP_Coding_Helper._detect_obstacles(
            img_file, CycleRAP_Coding_Helper.obstacle_detector_model, args.conf
        )
        
        # Canvas for drawing
        canvas = img_bgr.copy()
        
        # Neon Colors (BGR)
        NEON_BLUE = (255, 255, 0)  # Cyan/Neon Blue
        NEON_RED = (50, 50, 255)   # Neon Red
        TEXT_COLOR = (255, 255, 255)
        
        for det in detections:
            x1, y1, x2, y2 = det["x1"], det["y1"], det["x2"], det["y2"]
            box = (x1, y1, x2, y2)
            
            # Analyze obstacle relative to path
            is_blocking, ratio, path_cx, obj_cx = CycleRAP_Coding_Helper._analyze_obstacle(box, path_mask)
            
            # 1. Draw Object Centerline (Neon Red)
            # Vertical line through the center of the bounding box
            cv2.line(canvas, (obj_cx, y1), (obj_cx, y2), NEON_RED, 2)
            
            # 2. Draw Path Centerline (Neon Blue)
            # Calculated at the base level of the current obstacle
            if path_cx > 0:
                bottom_y = min(y2, img_h - 1)
                # Draw a distinctive marker/line for the path center at this level
                cv2.line(canvas, (path_cx, 0), (path_cx, img_h), NEON_BLUE, 1, cv2.LINE_AA) # Full vertical line
                cv2.circle(canvas, (path_cx, bottom_y), 5, NEON_BLUE, -1)
            
            # Draw bounding box and label
            color = NEON_RED if is_blocking else (0, 255, 0)
            cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 2)
            label = f"{det['class_name']} ({'BLOCKING' if is_blocking else 'CLEAR'})"
            cv2.putText(canvas, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        # Overlay Decision text (Present/Not Present)
        # Create a semi-transparent box for readability
        overlay = canvas.copy()
        cv2.rectangle(overlay, (10, 10), (400, 110), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.6, canvas, 0.4, 0, canvas)
        
        cv2.putText(canvas, f"Fixed Obstacle: {fixed_obs}", (20, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.8, TEXT_COLOR, 2)
        cv2.putText(canvas, f"Non-Fixed Obstacle: {non_fixed_obs}", (20, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.8, TEXT_COLOR, 2)
        
        # Legend in top right
        cv2.putText(canvas, "PATH CENTERLINE", (img_w - 220, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.5, NEON_BLUE, 2)
        cv2.putText(canvas, "OBJ CENTERLINE", (img_w - 220, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.5, NEON_RED, 2)

        # Save result
        out_file = output_path / img_file.name
        cv2.imwrite(str(out_file), canvas)

    print(f"\nDone! Visualized images saved to: {output_path}")

if __name__ == "__main__":
    main()
