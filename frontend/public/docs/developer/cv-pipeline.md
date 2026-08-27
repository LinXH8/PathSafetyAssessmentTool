# 5. CV / ML Pipeline

PSAT uses YOLO-based computer-vision models to automatically infer CycleRAP attribute values from street-level photographs. This process is called **auto-coding**.

---

## Table of Contents

- [5.1 Overview & Pipeline Flowchart](#5-1-overview-pipeline-flowchart)
- [5.2 Model Files](#5-2-model-files)
  - [5.21 Model Loading](#5-21-model-loading)
  - [5.22 Replacing or Updating a Model](#5-22-replacing-or-updating-a-model)
- [5.3 Inference Steps](#5-3-inference-steps)
  - [5.31 Step 1 — Path Segmentation](#5-31-step-1-path-segmentation)
  - [5.32 Step 2 — Cascade Facility-Type Assignment](#5-32-step-2-cascade-facility-type-assignment)
  - [5.33 Step 3 — Adjacent-Road Logic](#5-33-step-3-adjacent-road-logic)
  - [5.34 Step 4 — Obstacle Detection](#5-34-step-4-obstacle-detection)
- [5.4 Bulk Auto-coding Modes](#5-4-bulk-auto-coding-modes)
- [5.5 Confidence Thresholds](#5-5-confidence-thresholds)
- [5.6 Attributes Auto-coded by CV](#5-6-attributes-auto-coded-by-cv)
- [5.7 GIS Auto-coding](#5-7-gis-auto-coding)

## 5.1 Overview & Pipeline Flowchart

```
Street-level photograph (.jpg)
         │
         ▼
[Step 1] Path Segmentation (path_segmentation_6July.pt)
         Segments: road, traffic crossing, zebra crossing,
         cycling path (+ wet), red stripe (+ wet), pathway (+ variants)
         │
         ▼
[Step 2] Cascade Facility-Type Assignment (mask-based, no separate model)
         Default: Footpath
           → Cycling Path mask in bottom 20% of frame → Cycling Path
           → Red Stripe mask in bottom 20% of frame    → Shared Path
           → Signalised/Zebra crossing dominates bottom → Mixed Traffic Road Lane
           → Road mask dominates bottom                 → Mixed Traffic Road Lane
         │
         ├── [Step 3] Adjacent-Road Logic (road + crossing mask geometry)
         │           Sets Adjacent Road Lane 0-1m / 1-3m
         │
         └── [Step 4] Obstacle Detection (obstacle_detector_ema.pt, second pass)
                     Fixed / Non-Fixed Obstacle presence + FO/NFO Type + Width Restriction
         │
         ▼
Attribute dictionary {field: coded_value}
         │
         ▼
Stored in attributes.csv (merged with existing values)
```
*Layman's explanation: This flowchart shows the step-by-step process the computer takes to analyze a street photo and identify features like paths or obstacles.*

---

## 5.2 Model Files

PSAT's CV pipeline uses exactly **two** YOLO models. Both `.pt` files must be placed in a `model/` or `models/` directory (see [5.21](#5-21-model-loading)). They are **not in the repository** — copy from the project SSD.

| File | Type | Detects / Classifies |
|---|---|---|
| `path_segmentation_6July.pt` | Segmentation | Road, Traffic Crossing, Zebra Crossing, Cycling Path (+ Wet), Red Stripe (+ Wet), Pathway (+ Stone/Grey Tiled/Square/Wet variants) |
| `obstacle_detector_ema.pt` | Detection | Fixed obstacles (Pillar, Bollards, Fence, Utility Box, Traffic Light, Billboard, Lamp Post) and non-fixed obstacles (Cone, Bins, Bicycle, Pot, Barrier) |

> There is a `Legacy Models/` folder with older, unused `.pt` files from earlier CycleRAP iterations (e.g. per-attribute classifiers). None of those are loaded by the current pipeline — `CycleRAP_Coding_Helper.initialise()` only ever loads the two files above.

### 5.21 Model Loading

Models are loaded lazily on first CV request by `CycleRAP_Coding_Helper.initialise(model_dir)` (`backend/app/services/prediction.py`). The model directory is resolved by `_ensure_models_ready()` (`backend/app/api/projects/_helpers.py`), which searches, in order:

1. `MODEL_DIR` environment variable
2. `backend/model/`
3. `backend/models/`
4. Adjacent `model/` or `models/` relative to the active project's source path

If neither `path_segmentation_6July.pt` nor `obstacle_detector_ema.pt` is found in the resolved directory → `RuntimeError` → HTTP 503 for all CV requests.

### 5.22 Replacing or Updating a Model

1. Drop the new `.pt` file into the resolved model directory using the **exact same filename** (`path_segmentation_6July.pt` or `obstacle_detector_ema.pt`)
2. Rebuild: `docker compose up --build`
3. Verify via backend logs (`[Autocode] Loaded  <filename> in Xs`) and a test auto-code request

> To rename a model file, update the filename string in the `models_to_load` dict inside `CycleRAP_Coding_Helper.initialise()` (`backend/app/services/prediction.py`), then rebuild.

---

## 5.3 Inference Steps

All cascade logic lives in `CycleRAP_Coding_Helper._assign_attributes()` (`backend/app/services/prediction.py`). It is a single mask-based decision cascade — there is no separate model or classifier per step.

### 5.31 Step 1 — Path Segmentation

Runs `path_segmentation_6July.pt` on the full image at `CONF_THRESH = 0.5`. Each detected class's polygon mask is filled into one of these boolean mask groups: `road`, `traffic_crossing`, `zebra_crossing`, `cycling` (Cycling Path + Wet Cycling Path), `red_stripe` (Red Stripe + Wet Red Stripe), `pathway` (Pathway, Cycling Path, Stone/Grey Tiled/Square Pathway, Wet variants).

### 5.32 Step 2 — Cascade Facility-Type Assignment

Starting from a default of `Facility Type = Footpath`, the cascade evaluates masks in order and **overwrites** earlier results as later conditions match (later steps take priority):

| Condition | Resulting Facility Type | Side effects |
|---|---|---|
| Default | Footpath | Light Segregation = Present, Delineation = Not Present |
| Cycling-path mask present in bottom 20% of frame | Cycling Path | Delineation = Present, Adjacent Sidewalk 0-1m = Present |
| Red-stripe mask present in bottom 20% of frame | Shared Path | Delineation = Present |
| Traffic-crossing mask ≥ 80% of the bottom 10% of frame | Mixed Traffic Road Lane | Crossing Facility = Present, Crossing Type = Signalised Crossing, Intersection/Road Crossing = Present |
| Zebra-crossing mask ≥ 80% of the bottom 10% of frame | Mixed Traffic Road Lane | Crossing Facility = Present, Crossing Type = Zebra Crossing, Intersection/Road Crossing = Present |
| Road mask ≥ 80% of the bottom 10% of frame | Mixed Traffic Road Lane | Delineation reset to Not Present, all crossing/delineation triggers cleared |

`Delineation Type` is a comma-joined list of whichever of the above triggers fired (`"Cycling Path"`, `"Red Stripe"`, `"Signalised Crossing"`, `"Zebra Crossing"`), or `"Absent"` if none did.

`Property Access` is set independently: `Not Present` if any zebra/traffic crossing mask is detected anywhere in the frame; otherwise `Present` if the road mask covers ≥80% of the bottom 50% of the frame, or ≥50% of the bottom 15%.

### 5.33 Step 3 — Adjacent-Road Logic

`_compute_adjroad()` combines the `road` mask and the crossing masks (`traffic_crossing` + `zebra_crossing`) using frame geometry, no additional model:

1. If the bottom 20% of the frame is ≥75% road, or any crossing mask appears in the bottom 20% → `Adjacent Road Lane 0-1m = Present`, `1-3m = Not Present`.
2. Otherwise, compare road+crossing pixel density on the left half vs. right half of the frame. If the denser half exceeds 7% → `0-1m = Present`. If it's between 5% and 7% → `1-3m = Present`. Below 5% → both Not Present.

`Adjacent Object/Level Change 0-1m` / `1-3m` mirror the `Adjacent Road Lane` values exactly.

### 5.34 Step 4 — Obstacle Detection

Runs `obstacle_detector_ema.pt` on the full image (same `CONF_THRESH = 0.5`) as a second pass, skipped when the caller passes `skip_obstacles: true` (e.g. when the frontend's "Auto-code (By Attribute)" run doesn't request any obstacle-related field — see the "Autocode Per-Attribute: CV Skip Optimisation" note in the repo root `CLAUDE.md`). For each detected box:

- Classified as **fixed** (Pillar/Bollards/Fence/Utility Box/Traffic Light/Billboard/Lamp Post) or **non-fixed** (Cone/Bins/Bicycle/Pot/Barrier).
- Kept only if it overlaps the path mask, sampled 10px below the box's bottom edge against the longest contiguous run of path pixels in that row (≥30px horizontal overlap).
- `Fixed Obstacle on Facility` / `Non-Fixed Obstacle on Facility` = Present if any confirmed detection of that group exists; `FO Type` / `NFO Type` list the confirmed class names (renamed for the UI vocabulary, e.g. `Pillar` → `Covered Linkway Pole`, `Fence` → `Railing`, `Bollards` → `Bollard`, `Bins` → `Bin`).
- `Width Restriction` = Present if any confirmed obstacle's horizontal deviation from the path's center line is under 10% of the path's width (i.e. it visually blocks the path).

---

## 5.4 Bulk Auto-coding Modes

| Mode | Payload | Behaviour |
|---|---|---|
| Single image | `{ "imageRef": "...", "coords": [...] }` | Codes one segment |
| All rows | `{ "all": true, "save": false }` | Codes every segment |
| Selected rows | `{ "indices": [0, 3, 5], "save": false }` | Codes specified segments |

When `save: false`, results are returned to the frontend for review but **not written to disk**.

---

## 5.5 Confidence Thresholds

Both models use a single shared threshold — there is no per-model tuning.

| Model | Threshold | Below Threshold |
|---|---|---|
| Path segmentation (`path_segmentation_6July.pt`) | 0.5 | Detection is discarded; mask stays empty for that class |
| Obstacle detector (`obstacle_detector_ema.pt`) | 0.5 | Detection is discarded; not counted toward Fixed/Non-Fixed Obstacle |

---

## 5.6 Attributes Auto-coded by CV

| Field | Set By |
|---|---|
| Facility Type | Cascade mask evaluation ([5.32](#5-32-step-2-cascade-facility-type-assignment)) |
| Light Segregation | Cascade default / crossing overrides |
| Delineation, Delineation Type | Cascade triggers |
| Adjacent Road Lane 0-1m / 1-3m | Adjacent-road geometry logic ([5.33](#5-33-step-3-adjacent-road-logic)) |
| Adjacent Object/Level Change 0-1m / 1-3m | Mirrors Adjacent Road Lane |
| Adjacent Sidewalk 0-1m | Set Present when Cycling Path is assigned |
| Crossing Facility, Crossing Type | Set by crossing-dominant cascade steps |
| Intersection/Road Crossing, No of Lanes on Intersecting Road, Intersecting Bicycle Facility | Set by crossing-dominant cascade steps |
| Peak Pedestrian Flow | Defaulted to Low by the cascade (refined separately by GIS, see [5.7](#5-7-gis-auto-coding)) |
| Property Access | Independent road/crossing mask check ([5.32](#5-32-step-2-cascade-facility-type-assignment)) |
| Fixed Obstacle on Facility, Non-Fixed Obstacle on Facility | Obstacle detector pass ([5.34](#5-34-step-4-obstacle-detection)) |
| FO Type, NFO Type | Obstacle detector pass, class names |
| Width Restriction | Obstacle detector pass, path-center deviation |

---

## 5.7 GIS Auto-coding

The `/<project>/autocode/gis` endpoint (`_gis_autocode_core()` in `backend/app/api/projects/autocode.py`) derives attributes from the GIS layers loaded by `gis_mapping.py` and from the defects store, using each segment's start point (and, for curvature, its midpoint):

| Field(s) | Method | Notes |
|---|---|---|
| Peak pedestrian flow along or across facility | `is_mrt` (dist 20m) → 3; `is_bus_stop` (dist 20m) → 2; refined by peak-count lookup below | Later checks can overwrite earlier ones |
| Heavy vehicle flow | `is_bus_lane` (dist 20m) → 2, else `get_heavy_vehicle_flow` (buffer 15m, max 15m, default 1) | |
| Adjacent Vehicle Parking 0-1m | `is_parking` (dist 20m) | |
| Pedestrian Crossing | `is_bus_stop`, `is_road_crossing`, or `is_mrt`, each within 10m | Present if any match |
| Crossing Facility, Crossing Type | `is_bicycle_crossing` (dist 2m) → "Bicycle Crossing" | |
| Intersecting Bicycle Facility | `is_road_crossing` (dist 5m) | Present/Not Present |
| Area type | `get_area_type` (20m tolerance) | Urban/CBD (1) / Suburban (2, default) / Rural (3) / Industrial (4) / Recreational (5) |
| Road AADT | Hardcoded constant | Always set to **6000** — this is not a spatial lookup |
| Peak bicycle/LV traffic flow, Peak pedestrian flow (refinement) | `get_peak_pedestrian_flow` (dist 10m), sensor counts preferred over "before" counts | MICROMOBILITY > 50 → bicycle flow Moderate; OTHER > 50 → pedestrian flow High |
| Road operating speed (mean) | `get_road_operating_speed` (buffer 20m, max 30m, default 30.0) | |
| Road speed limit | `get_road_speed_limit` (buffer 20m, max 30m, default 10) | |
| Curvature, Curvature Sub-category | `get_curvature` on the segment midpoint (sharp-turn threshold 10°, default 2) | |
| Facility Width per Direction, Facility Width Sub-category | `get_facility_width` (radial search 2m–10m, step 2m, default 2) | Not a fixed-radius nearest lookup |
| Number of lanes – adjacent road | `get_number_of_lane` (dist 20m) | |
| Major Surface Deformation or Drain Opening, Loose or slippery surface, Delineation, Delineation Type, Defect Type | Queries the defects store within 5m of the segment line | "Algae" → slippery surface; "Faded Marking" → Delineation = Not Present, Delineation Type = Faded Marking; anything else → surface deformation, Defect Type lists the raw defect labels |

> **Correction:** Road AADT **is** auto-coded via `/autocode/gis` — it is simply a hardcoded constant (6000), not a spatial query, so it does not vary by location.
