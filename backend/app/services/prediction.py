from __future__ import annotations
from . import serializer
import cv2
import numpy as np
from pathlib import Path

# Make EMA available for unpickling the obstacle model.
from .ema import EMA  # noqa: F401
import ultralytics.nn.modules.block as _ul_block
_ul_block.EMA = EMA

# ---------------------------------------------------------------------------
# Obstacle class definitions
# ---------------------------------------------------------------------------
FIXED_OBSTACLE_CLASSES = {
    "Pillar", "Bollards", "Fence", "Utility Box",
    "Traffic Light", "Billboard", "Lamp Post",
}
NON_FIXED_OBSTACLE_CLASSES = {"Cone", "Bins", "Bicycle", "Pot", "Barrier"}

# Detector class names are fixed by the trained model; map them to the current
# FO Type finer-attribute labels so freshly autocoded values match the UI vocabulary.
_FO_TYPE_LABEL_RENAMES = {
    "Pillar": "Covered Linkway Pole",
    "Fence": "Railing",
}


class CycleRAP_Coding_Helper:
    path_segmentation_model = None
    obstacle_detector_model = None
    class_sets: dict | None = None

    def __init__(self):
        raise RuntimeError("Do not create class instance, use the class methods instead")

    # ------------------------------------------------------------------
    # Model loading
    # ------------------------------------------------------------------
    @classmethod
    def initialise(cls, model_dir: Path):
        from ultralytics import YOLO
        from ultralytics.nn import tasks as _ul_tasks
        from concurrent.futures import ThreadPoolExecutor, as_completed

        # Patch BaseModel.fuse() so older .pt files don't crash
        _orig_fuse = _ul_tasks.BaseModel.fuse
        def _safe_fuse(self, verbose=True):
            try:
                return _orig_fuse(self, verbose=verbose)
            except AttributeError:
                return self
        _ul_tasks.BaseModel.fuse = _safe_fuse

        models_to_load = {
            "path_segmentation_model": "path_segmentation.pt",
            "obstacle_detector_model": "obstacle_detector_ema.pt",
        }

        # Validate files exist
        for attr, filename in models_to_load.items():
            path = model_dir / filename
            if not path.exists():
                raise RuntimeError(f'"{path}" could not be found')

        def _load_one(attr: str, filename: str):
            import time
            path = model_dir / filename
            print(f"[Autocode] Loading {filename}...", flush=True)
            t0 = time.time()
            model = YOLO(str(path))
            elapsed = time.time() - t0
            print(f"[Autocode] Loaded  {filename} in {elapsed:.1f}s", flush=True)
            return attr, model

        results: dict = {}
        errors: list = []
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="model-load") as pool:
            futures = {pool.submit(_load_one, attr, fn): attr for attr, fn in models_to_load.items()}
            for future in as_completed(futures):
                try:
                    attr, model = future.result()
                    results[attr] = model
                except Exception as e:
                    errors.append(str(e))

        if errors:
            raise RuntimeError("Model loading failed:\n" + "\n".join(errors))

        for attr, model in results.items():
            setattr(cls, attr, model)

        # Cache class-ID sets from the segmentation model
        cls.class_sets = cls._build_class_sets(cls.path_segmentation_model)
        print(f"[Autocode] Class sets: { {k: {cls.path_segmentation_model.names[cid] for cid in v} for k, v in cls.class_sets.items()} }", flush=True)

    # ------------------------------------------------------------------
    # Class-set helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _build_class_sets(model) -> dict[str, set[int]]:
        inv = {v: k for k, v in model.names.items()}

        def _ids(*names):
            return {inv[n] for n in names if n in inv}

        return {
            "road":              _ids("Road"),
            "traffic_crossing":  _ids("Traffic Crossing"),
            "zebra_crossing":    _ids("Zebra Crossing"),
            "cycling":           _ids("Cycling Path", "Wet Cycling Path"),
            "red_stripe":        _ids("Red Stripe", "Wet Red Stripe"),
            "pathway":           _ids(
                "Pathway", "Cycling Path", "Stone Pathway", "Wet Pathway",
                "Grey Tiled Pathway", "Wet Cycling Path", "Square Pathway",
            ),
        }

    # ------------------------------------------------------------------
    # Mask building
    # ------------------------------------------------------------------
    @staticmethod
    def _build_masks(
        result,
        class_sets: dict[str, set[int]],
        img_h: int,
        img_w: int,
        conf_thresh: float,
    ) -> dict[str, np.ndarray]:
        masks_out = {key: np.zeros((img_h, img_w), dtype=np.uint8) for key in class_sets}

        boxes = result.boxes
        seg_masks = result.masks
        if boxes is None or seg_masks is None:
            return masks_out

        class_ids = boxes.cls.int().tolist()
        confidences = boxes.conf.tolist()
        polygons = seg_masks.xy

        for i, (cid, conf) in enumerate(zip(class_ids, confidences)):
            if conf < conf_thresh or i >= len(polygons):
                continue
            poly = polygons[i]
            if len(poly) < 3:
                continue
            poly_int = np.array(poly, dtype=np.int32)
            for key, id_set in class_sets.items():
                if cid in id_set:
                    cv2.fillPoly(masks_out[key], [poly_int], 1)
                    break

        return masks_out

    # ------------------------------------------------------------------
    # Obstacle detection
    # ------------------------------------------------------------------
    @staticmethod
    def _detect_obstacles(
        img_path: Path,
        obstacle_model,
        conf_thresh: float,
    ) -> list[dict]:
        results = obstacle_model.predict(source=str(img_path), conf=conf_thresh, verbose=False)
        result = results[0]

        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return []

        inv = {v: k for k, v in obstacle_model.names.items()}
        fixed_ids     = {inv[n] for n in FIXED_OBSTACLE_CLASSES     if n in inv}
        non_fixed_ids = {inv[n] for n in NON_FIXED_OBSTACLE_CLASSES if n in inv}
        relevant_ids  = fixed_ids | non_fixed_ids

        class_ids   = boxes.cls.int().tolist()
        confidences = boxes.conf.tolist()
        xyxy_boxes  = boxes.xyxy.cpu().numpy().astype(int)
        img_h, img_w = result.orig_shape

        detections: list[dict] = []

        for i, (cid, conf) in enumerate(zip(class_ids, confidences)):
            if conf < conf_thresh or cid not in relevant_ids:
                continue
            x1, y1, x2, y2 = xyxy_boxes[i]
            x1, y1 = max(x1, 0), max(y1, 0)
            x2, y2 = min(x2, img_w - 1), min(y2, img_h - 1)

            group = "fixed" if cid in fixed_ids else "non_fixed"
            detections.append({
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                "class_name": obstacle_model.names[cid],
                "group": group,
            })

        return detections

    @staticmethod
    def _obstacle_overlaps_path(det: dict, path_mask: np.ndarray, overlap_thresh: int = 30) -> bool:
        y2 = det["y2"]
        if y2 + 10 >= path_mask.shape[0]:
            return True

        sample_y = y2 + 10
        path_row = path_mask[sample_y, :]
        if not np.any(path_row):
            return False

        path_pixels_x = np.where(path_row > 0)[0]
        splits = np.where(np.diff(path_pixels_x) > 1)[0] + 1
        runs = np.split(path_pixels_x, splits)
        longest_run = max(runs, key=len)
        run_start, run_end = int(longest_run[0]), int(longest_run[-1])

        overlap = max(0, min(det["x2"], run_end) - max(det["x1"], run_start))
        return overlap >= overlap_thresh

    @classmethod
    def _compute_obstacle_presence(
        cls,
        detections: list[dict],
        path_mask: np.ndarray,
    ) -> tuple[str, str, list[dict], list[dict]]:
        confirmed_fixed: list[dict] = []
        confirmed_non_fixed: list[dict] = []

        for det in detections:
            if not cls._obstacle_overlaps_path(det, path_mask):
                continue
            if det["group"] == "fixed":
                confirmed_fixed.append(det)
            else:
                confirmed_non_fixed.append(det)

        fixed_result     = "Present" if confirmed_fixed     else "Not Present"
        non_fixed_result = "Present" if confirmed_non_fixed else "Not Present"
        return fixed_result, non_fixed_result, confirmed_fixed, confirmed_non_fixed

    # ------------------------------------------------------------------
    # Obstacle-width analysis
    # ------------------------------------------------------------------
    @staticmethod
    def _analyze_obstacle(obstacle_box, path_mask, threshold=0.1):
        x_min, y_min, x_max, y_max = map(int, obstacle_box)
        obstacle_center_x = int((x_min + x_max) / 2)
        sample_y = min(y_max + 10, path_mask.shape[0] - 1)

        path_row = path_mask[sample_y, :]
        if not np.any(path_row):
            return False, 0.0, 0, 0

        path_pixels_x = np.where(path_row > 0)[0]

        # Use midpoint of the longest contiguous run to avoid skew when an obstacle splits the mask
        splits = np.where(np.diff(path_pixels_x) > 1)[0] + 1
        runs = np.split(path_pixels_x, splits)
        longest_run = max(runs, key=len)
        path_center_x = int((longest_run[0] + longest_run[-1]) / 2)
        path_width = np.percentile(path_pixels_x, 95) - np.percentile(path_pixels_x, 5)

        if path_width < 10:
            return False, 0.0, 0, 0

        deviation = abs(path_center_x - obstacle_center_x)
        ratio = deviation / path_width
        is_blocking = ratio < threshold
        return is_blocking, ratio, path_center_x, obstacle_center_x

    @classmethod
    def _compute_width_restriction(cls, path_mask: np.ndarray, detections: list[dict]) -> tuple[str, str | None, str | None]:
        blocking_fixed = []
        blocking_non_fixed = []
        is_restricted = False

        for det in detections:
            box = (det["x1"], det["y1"], det["x2"], det["y2"])
            is_blocking, _, _, _ = cls._analyze_obstacle(box, path_mask)
            if is_blocking:
                is_restricted = True
                cname = det["class_name"]
                if det["group"] == "fixed":
                    if cname not in blocking_fixed:
                        blocking_fixed.append(cname)
                else:
                    if cname not in blocking_non_fixed:
                        blocking_non_fixed.append(cname)

        width_restriction = "Present" if is_restricted else "Not Present"
        str_fixed = ", ".join(blocking_fixed) if blocking_fixed else None
        str_non_fixed = ", ".join(blocking_non_fixed) if blocking_non_fixed else None

        return width_restriction, str_fixed, str_non_fixed

    # ------------------------------------------------------------------
    # Adjacent-road logic
    # ------------------------------------------------------------------
    @staticmethod
    def _compute_adjroad(
        road_mask: np.ndarray,
        crossing_mask: np.ndarray,
        img_h: int,
        img_w: int,
    ) -> tuple[str, str]:
        # Logic 1 – bottom 20 %
        bottom_start = int(0.8 * img_h)
        bottom_pixels = (img_h - bottom_start) * img_w
        bottom_road_ratio = int(np.sum(road_mask[bottom_start:, :])) / max(bottom_pixels, 1)
        crossing_in_bottom = bool(np.any(crossing_mask[bottom_start:, :]))

        if bottom_road_ratio >= 0.75 or crossing_in_bottom:
            return ("Present", "Not Present")

        # Logic 2 – half-width split
        mid_x = img_w // 2
        combined = np.clip(road_mask + crossing_mask, 0, 1)
        left_ratio = int(np.sum(combined[:, :mid_x])) / max(img_h * mid_x, 1)
        right_ratio = int(np.sum(combined[:, mid_x:])) / max(img_h * (img_w - mid_x), 1)
        max_ratio = max(left_ratio, right_ratio)

        if max_ratio > 0.07:
            return ("Present", "Not Present")
        elif max_ratio >= 0.05:
            return ("Not Present", "Present")
        else:
            return ("Not Present", "Not Present")

    # ------------------------------------------------------------------
    # Bottom-region checks
    # ------------------------------------------------------------------
    @staticmethod
    def _check_bottom_presence(mask: np.ndarray, img_h: int, fraction: float) -> bool:
        cutoff = int(img_h * (1.0 - fraction))
        return bool(np.any(mask[cutoff:, :]))

    @staticmethod
    def _check_bottom_majority(
        mask: np.ndarray,
        img_h: int,
        img_w: int,
        fraction: float = 0.10,
        threshold: float = 0.80,
    ) -> bool:
        cutoff = int(img_h * (1.0 - fraction))
        region_pixels = (img_h - cutoff) * img_w
        if region_pixels == 0:
            return False
        ratio = float(np.sum(mask[cutoff:, :])) / region_pixels
        return ratio >= threshold

    # ------------------------------------------------------------------
    # Cascade attribute assignment (string values)
    # ------------------------------------------------------------------
    @classmethod
    def _assign_attributes(
        cls,
        masks: dict[str, np.ndarray],
        img_h: int,
        img_w: int,
        fixed_obstacles: str = "Not Present",
        non_fixed_obstacles: str = "Not Present",
        width_restriction: str = "Not Present",
        blocking_fixed_classes: str | None = None,
        blocking_non_fixed_classes: str | None = None,
    ) -> dict[str, str | None]:
        crossing_mask = np.clip(
            masks["traffic_crossing"] + masks["zebra_crossing"], 0, 1
        )
        adj_01, adj_13 = cls._compute_adjroad(masks["road"], crossing_mask, img_h, img_w)

        # Step 1 – Defaults (Sidewalk)
        attrs = {
            "Facility Type":                    "Sidewalk",
            "Light Segregation":                "Present",
            "Delineation":                      "Not Present",
            "Adjacent Road Lane 0-1m":          adj_01,
            "Adjacent Road Lane 1-3m":          adj_13,
            "Adjacent Object/Level Change 0-1m": adj_01,
            "Adjacent Object/Level Change 1-3m": adj_13,
            "Adjacent Sidewalk 0-1m":           "Not Present",
            "Crossing Facility":                "Not Present",
            "Crossing Type":                    None,
            "Width Restriction":               width_restriction,
            "Peak Pedestrian Flow":            "Low",
            "Intersection/Road Crossing":       "Not Present",
            "No of Lanes on Intersecting Road": "1 per direction",
        }

        delineation_triggers: list[str] = []

        # Step 2 – Cycling Path in bottom 20 %
        if cls._check_bottom_presence(masks["cycling"], img_h, fraction=0.20):
            attrs["Facility Type"] = "Off-Road Bicycle Path"
            attrs["Delineation"] = "Present"
            attrs["Adjacent Sidewalk 0-1m"] = "Present"
            delineation_triggers.append("Cycling Path")

        # Step 3 – Red Stripe in bottom 20 %
        if cls._check_bottom_presence(masks["red_stripe"], img_h, fraction=0.20):
            attrs["Facility Type"] = "Multi-Use Path"
            attrs["Delineation"] = "Present"
            delineation_triggers.append("Red Stripe")

        # Step 4 – Signalised Crossing >= 80 % of bottom 10 %
        if cls._check_bottom_majority(masks["traffic_crossing"], img_h, img_w):
            delineation_triggers.append("Signalised Crossing")
            attrs.update({
                "Facility Type":                    "Mixed Traffic Road Lane",
                "Light Segregation":                "Not Present",
                "Delineation":                      "Present",
                "Adjacent Road Lane 0-1m":          "Present",
                "Adjacent Road Lane 1-3m":          "Not Present",
                "Adjacent Object/Level Change 0-1m": "Not Present",
                "Adjacent Object/Level Change 1-3m": "Not Present",
                "Adjacent Sidewalk 0-1m":           "Not Present",
                "Crossing Facility":                "Present",
                "Crossing Type":                    "Signalised Crossing",
                "Peak Pedestrian Flow":             "Low",
                "Intersection/Road Crossing":       "Present",
                "No of Lanes on Intersecting Road": ">1 per direction",
                "Intersecting Bicycle Facility":    "Not Present",
            })

        # Step 5 – Zebra Crossing >= 80 % of bottom 10 %
        if cls._check_bottom_majority(masks["zebra_crossing"], img_h, img_w):
            delineation_triggers.append("Zebra Crossing")
            attrs.update({
                "Facility Type":                    "Mixed Traffic Road Lane",
                "Light Segregation":                "Not Present",
                "Delineation":                      "Present",
                "Adjacent Road Lane 0-1m":          "Present",
                "Adjacent Road Lane 1-3m":          "Not Present",
                "Adjacent Object/Level Change 0-1m": "Not Present",
                "Adjacent Object/Level Change 1-3m": "Not Present",
                "Adjacent Sidewalk 0-1m":           "Not Present",
                "Crossing Facility":                "Present",
                "Crossing Type":                    "Zebra Crossing",
                "Peak Pedestrian Flow":             "Low",
                "Intersection/Road Crossing":       "Present",
                "No of Lanes on Intersecting Road": "1 per direction",
                "Intersecting Bicycle Facility":    "Not Present",
            })

        # Step 6 – Road >= 80 % of bottom 10 %
        if cls._check_bottom_majority(masks["road"], img_h, img_w):
            delineation_triggers.clear()
            attrs.update({
                "Facility Type":                    "Mixed Traffic Road Lane",
                "Light Segregation":                "Not Present",
                "Delineation":                      "Not Present",
                "Adjacent Road Lane 0-1m":          "Present",
                "Adjacent Road Lane 1-3m":          "Not Present",
                "Adjacent Object/Level Change 0-1m": "Not Present",
                "Adjacent Object/Level Change 1-3m": "Not Present",
                "Adjacent Sidewalk 0-1m":           "Not Present",
                "Crossing Facility":                "Not Present",
                "Crossing Type":                    None,
                "Peak Pedestrian Flow":             "Low",
                "Intersection/Road Crossing":       "Not Present",
                "No of Lanes on Intersecting Road": ">1 per direction",
            })

        attrs["Fixed Obstacles"] = fixed_obstacles
        attrs["Non-Fixed Obstacles"] = non_fixed_obstacles
        attrs["FO Type"] = blocking_fixed_classes
        attrs["NFO Type"] = blocking_non_fixed_classes
        attrs["Delineation Type"] = ", ".join(delineation_triggers) if delineation_triggers else "Absent"

        # Property Access: not present if any crossing detected; otherwise road mask ≥80% of bottom 50%
        crossing_detected = masks["zebra_crossing"].any() or masks["traffic_crossing"].any()
        if crossing_detected:
            prop_access = False
        else:
            prop_access = cls._check_bottom_majority(
                masks["road"], img_h, img_w, fraction=0.50, threshold=0.80
            )
        attrs["Property Access"] = "Present" if prop_access else "Not Present"

        return attrs

    # ------------------------------------------------------------------
    # String → serializer integer conversion
    # ------------------------------------------------------------------
    @staticmethod
    def _convert_to_coded(attrs: dict[str, str]) -> dict[str, int | None]:
        F = serializer.Attributes.Fields

        # Map from assign_attributes keys → serializer field constants
        field_map = {
            "Facility Type":                    F.FACILITY_TYPE_STR,
            "Light Segregation":                F.LIGHT_SEGREGATION_STR,
            "Delineation":                      F.DELINEATION_STR,
            "Adjacent Road Lane 0-1m":          F.ADJ_ROAD_LANE_01M_STR,
            "Adjacent Road Lane 1-3m":          F.ADJ_ROAD_LANE_13M_STR,
            "Adjacent Object/Level Change 0-1m": F.ADJ_OBJ_LVL_CHGE_01M_STR,
            "Adjacent Object/Level Change 1-3m": F.ADJ_OBJ_LVL_CHGE_13M_STR,
            "Adjacent Sidewalk 0-1m":           F.ADJ_SIDEWALK_01M_STR,
            "Crossing Facility":                F.CROSS_FACILITY_STR,
            "Crossing Type":                    F.CROSSING_TYPE_STR,
            "Width Restriction":               F.WIDTH_RESTRICTION_STR,
            "Peak Pedestrian Flow":            F.PEAK_PED_FLOW_STR,
            "Intersection/Road Crossing":       F.INTERSECT_ROAD_CROSS_STR,
            "No of Lanes on Intersecting Road": F.NOL_INTERSECT_ROAD_STR,
            "Intersecting Bicycle Facility":    F.INTERSECT_FACILITY_STR,
            "Property Access":                 F.PROP_ACCESS_STR,
            "Fixed Obstacles":                 F.FIXED_OBSTACLE_STR,
            "Non-Fixed Obstacles":             F.NON_FIXED_OBSTACLE_STR,
            "FO Type":                         F.FIXED_OBSTACLE_TYPE_STR,
            "NFO Type":                        F.NON_FIXED_OBSTACLE_TYPE_STR,
            "Delineation Type":                F.DELINEATION_TYPE_STR,
        }

        # Value converters per field
        nol_map = {
            "1 per direction":  serializer.NoL_mapping["1 per Direction/NA"],
            ">1 per direction": serializer.NoL_mapping["> 1 per Direction"],
        }

        coded = dict.fromkeys(serializer.Attributes.Fields.values(), None)

        for raw_key, field_key in field_map.items():
            value = attrs.get(raw_key)
            if value is None:
                continue

            if field_key == F.FACILITY_TYPE_STR:
                coded[field_key] = serializer.facility_type_mapping.get(value)
            elif field_key == F.PEAK_PED_FLOW_STR:
                coded[field_key] = serializer.none_low_modhigh_mapping.get(value)
            elif field_key == F.NOL_INTERSECT_ROAD_STR:
                coded[field_key] = nol_map.get(value)
            elif field_key in [F.FIXED_OBSTACLE_TYPE_STR, F.NON_FIXED_OBSTACLE_TYPE_STR, F.CROSSING_TYPE_STR, F.DELINEATION_TYPE_STR]:
                coded[field_key] = value
            else:
                # All remaining fields use presence_mapping
                coded[field_key] = serializer.presence_mapping.get(value)

        return coded

    # ------------------------------------------------------------------
    # Main autocode entry point
    # ------------------------------------------------------------------
    @classmethod
    def autocode(cls, image_path: Path, skip_obstacles: bool = False) -> dict:
        if not cls.path_segmentation_model:
            raise RuntimeError("Path segmentation model is not initialised.")

        CONF_THRESH = 0.5

        # 1. Run path segmentation
        results = cls.path_segmentation_model.predict(
            source=str(image_path), conf=CONF_THRESH, verbose=False
        )
        result = results[0]
        img_h, img_w = result.orig_shape

        # 2. Build binary masks
        masks = cls._build_masks(result, cls.class_sets, img_h, img_w, CONF_THRESH)

        # 3. Detect obstacles (skip when no obstacle-related fields are requested)
        combined_path_mask = np.clip(masks["pathway"] + masks["red_stripe"], 0, 1)
        if skip_obstacles:
            fixed_obs = non_fixed_obs = "Not Present"
            fo_type_str = nfo_type_str = None
            all_confirmed: list[dict] = []
        elif cls.obstacle_detector_model is not None:
            detections = cls._detect_obstacles(image_path, cls.obstacle_detector_model, CONF_THRESH)
            fixed_obs, non_fixed_obs, confirmed_fixed, confirmed_non_fixed = cls._compute_obstacle_presence(detections, combined_path_mask)
            fo_type_str  = ", ".join(sorted({_FO_TYPE_LABEL_RENAMES.get(d["class_name"], d["class_name"]) for d in confirmed_fixed}))     or None
            nfo_type_str = ", ".join(sorted({d["class_name"] for d in confirmed_non_fixed})) or None
            all_confirmed = confirmed_fixed + confirmed_non_fixed
        else:
            fixed_obs = non_fixed_obs = "Not Present"
            fo_type_str = nfo_type_str = None
            all_confirmed = []

        # 4. Compute width restriction using confirmed detections + combined path mask
        width_restriction, blocking_fixed, blocking_non_fixed = cls._compute_width_restriction(combined_path_mask, all_confirmed)

        # 6. Assign attributes (string values)
        str_attrs = cls._assign_attributes(
            masks, img_h, img_w, fixed_obs, non_fixed_obs, width_restriction,
            blocking_fixed_classes=fo_type_str,
            blocking_non_fixed_classes=nfo_type_str,
        )

        print(f"[Autocode] [{Path(image_path).name}] {str_attrs['Facility Type']} | "
              f"Fixed: {fixed_obs} | Non-Fixed: {non_fixed_obs} | "
              f"FO Type: {fo_type_str} | NFO Type: {nfo_type_str}", flush=True)

        # 7. Convert to integer-coded dict
        return cls._convert_to_coded(str_attrs)
