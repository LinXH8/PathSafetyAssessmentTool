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
  - [5.32 Step 2 — Light Segregation](#5-32-step-2-light-segregation)
  - [5.33 Step 3 — Adjacent Road Classification](#5-33-step-3-adjacent-road-classification)
  - [5.34 Step 4 — Off-Road Bicycle Path](#5-34-step-4-off-road-bicycle-path)
  - [5.35 Step 5 — Facility Type Decision](#5-35-step-5-facility-type-decision)
  - [5.36 Step 6 — Fixed Obstacle & Delineation](#5-36-step-6-fixed-obstacle-delineation)
- [5.4 Bulk Auto-coding Modes](#5-4-bulk-auto-coding-modes)
- [5.5 Confidence Thresholds](#5-5-confidence-thresholds)
- [5.6 Attributes Auto-coded by CV](#5-6-attributes-auto-coded-by-cv)
- [5.7 GIS Auto-coding](#5-7-gis-auto-coding)

## 5.1 Overview & Pipeline Flowchart

```
Street-level photograph (.jpg)
         │
         ▼
[Step 1] Path Segmentation (path_seg.pt)
         Detects: path (class 0), road (class 1)
         │
         ├── No path → Flag for manual review
         │
         └── Path detected
               │
               ├── [Step 2] Light Segregation: Set Present (default)
               │
               ├── [Step 3] Adjacent Road Lane Classifier (adj_road_lane.pt)
               │           0–1m? 1–3m? Neither?
               │
               ├── [Step 4] Off-Road Bicycle Classifier (off_road_bicycle_path.pt)
               │           Is this an off-road path?
               │
               ├── [Step 5] Facility Type Decision (LTA_FIXEDOBSTACLE_BEST_2.pt)
               │           Bus stop? Road-dominant? Path-only?
               │
               └── [Step 6] Fixed Obstacle & Delineation Detection
                           (LTA_FIXEDOBSTACLE_BEST_2.pt + LTA_Dill_4_Best.pt)
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

All `.pt` files must be placed in `backend/models/`. They are **not in the repository** — copy from the project SSD.

| File | Type | Detects / Classifies |
|---|---|---|
| `path_seg.pt` | Segmentation | Path (0), road (1), buffer zone, zebra crossing |
| `off_road_bicycle_path.pt` | Classifier | Off-road bicycle path vs. other types |
| `adj_road_lane.pt` | Classifier | Adjacent road: 0–1m, 1–3m, or none |
| `LTA_FIXEDOBSTACLE_BEST_2.pt` | Segmentation | Fixed obstacles, bus stops, delineation markers |
| `DevelopmentAccess_last_150epochs.pt` | Classifier | Development/property access |
| `LTA_Dill_4_Best.pt` | Classifier | Delineation / road markings |
| `RoadClassification_best.pt` | Classifier | Road type classification |

### 5.21 Model Loading

Models are loaded lazily on first CV request by `CycleRAP_Coding_Helper.initialise(model_dir)`. Search order:

1. `MODEL_DIR` environment variable
2. `backend/model/`
3. `backend/models/`
4. Adjacent `model/` or `models/` relative to source path

If no directory is found → `RuntimeError` → HTTP 503 for all CV requests.

### 5.22 Replacing or Updating a Model

1. Drop the new `.pt` file into `backend/models/` using the **exact same filename**
2. Rebuild: `docker compose up --build`
3. Verify via backend logs and a test auto-code request

> To rename a model file, update the filename string in `prediction.py` inside `CycleRAP_Coding_Helper.initialise()`, then rebuild.

---

## 5.3 Inference Steps

### 5.31 Step 1 — Path Segmentation

Runs `path_seg.pt` on the full image (confidence ≥ 0.5). If no path (class `0`) is detected, the segment is flagged for manual review.

### 5.32 Step 2 — Light Segregation

Default: `Light Segregation = Present` whenever a path is detected.

### 5.33 Step 3 — Adjacent Road Classification

Runs `adj_road_lane.pt` on the cropped path bounding box (confidence ≥ 0.8):

| Class | Result |
|---|---|
| `1` | Adjacent Road Lane 0–1m = Present, 1–3m = Not Present |
| `2` | Adjacent Road Lane 0–1m = Not Present, 1–3m = Present |
| `0` / low confidence | Uncertain — logged for manual review |

### 5.34 Step 4 — Off-Road Bicycle Path

Runs `off_road_bicycle_path.pt` (confidence ≥ 0.8). If positive:
- `Facility Type = Off-Road Bicycle Path`
- `Delineation = Present`
- Multiple paths detected → `Adjacent Sidewalk 0-1m = Present`

### 5.35 Step 5 — Facility Type Decision

Runs `LTA_FIXEDOBSTACLE_BEST_2.pt` on the full image:

| Condition | Facility Type |
|---|---|
| Bus stop detected (labels 1, 4) | Sidewalk |
| Bottom half >90% pathway AND pathway > road | Multi-Use Path |
| Road confined to one side (>80%) | Sidewalk |
| Only pathway, no road | Sidewalk |
| Default | Mixed Traffic Road Lane |

### 5.36 Step 6 — Fixed Obstacle & Delineation

Second pass checks whether obstacle masks overlap the path mask:

| Label Set | Attribute Set |
|---|---|
| `{1, 2, 4, 6, 7}` intersect path | Fixed Obstacle on Facility = Present |
| Label `9` intersects path | Non-Fixed Obstacle on Facility = Present |
| `{0, 1, 2, 5}` on path | Delineation = Present |

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

| Model | Threshold | Below Threshold |
|---|---|---|
| Path segmentation | 0.5 | No path; flag for manual review |
| Adjacent road lane | 0.8 | Class 0 (uncertain) |
| Off-road bicycle | 0.8 | Not classified as off-road |
| Fixed obstacle | 0.6 | No obstacles detected |
| Development access | 0.5 | No access detected |
| Delineation | 0.5 | No delineation detected |

---

## 5.6 Attributes Auto-coded by CV

| Field | Set By |
|---|---|
| Facility Type | Off-road classifier + fixed obstacle decision |
| Light Segregation | Default Present when path detected |
| Adjacent Road Lane 0–1m | Adjacent road classifier |
| Adjacent Road Lane 1–3m | Adjacent road classifier |
| Adjacent Object/Level Change 0–1m | Inferred from Adjacent Road Lane 0–1m |
| Adjacent Object/Level Change 1–3m | Inferred from Adjacent Road Lane 1–3m |
| Adjacent Sidewalk 0–1m | Multi-path detection |
| Fixed Obstacle on Facility | Fixed obstacle segmentation |
| Non-Fixed Obstacle on Facility | Fixed obstacle segmentation (label 9) |
| Delineation | Delineation classifier |

---

## 5.7 GIS Auto-coding

The `/autocode/gis` endpoint derives attributes from shapefiles in `backend/shapefiles/`:

| Layer | Attribute Set | Method |
|---|---|---|
| `area_type` / `inner` (polygon) | Area Type = Urban/CBD | Point-in-polygon |
| Industrial zones | Area Type = Industrial | Point-in-polygon |
| `rural` / `LanduseRural2026` | Area Type = Rural | Point-in-polygon |
| `recreation` / `LanduseRecre2026` | Area Type = Recreational | Point-in-polygon |
| *(no match)* | Area Type = Suburban | Default fallback |
| `path` / `cycling_path` / `CyclingPath_Jul2024` | Facility Width per Direction | Nearest within 5 m |
| `footpath` / `FootPath_Mar2025` | Facility Width per Direction | Nearest within 5 m |
| `LinkID_Shape_File` | Road Operating Speed (mean) | Nearest link + CSV |
| `Speed_limit` | Road Speed Limit | Nearest within 20 m |
| `kerb_line` | Number of Lanes – Adjacent Road | Nearest within 10 m |
| `Mrt_exit` / `bus_stop` | Pedestrian Crossing, Peak Flow | Within 20 m |
| `bus_lane` | Heavy Vehicle Flow | Within 20 m |
| `roadcrossinglayer` / `AMG_BC2025_shp` | Road Crossing, Crossing Facility | Within 2–5 m |
| `parking_lot` | Adjacent Vehicle Parking | Within 20 m |
| `AMGbeforeCount` / `AMGsensorCount` | Peak Pedestrian & Bicycle Flow | Within 20 m, aggregated |

> **Note:** Road AADT has no GIS auto-coding path — it must be coded manually.
