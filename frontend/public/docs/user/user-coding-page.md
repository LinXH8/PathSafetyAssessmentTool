## 2. Coding Page

The Coding page is the main review workspace. It can open one or more selected projects in a combined session.

---

## Table of Contents

- [2.1 Main Layout](#21-main-layout)
- [2.2 Navigating Segments](#22-navigating-segments)
- [2.3 Attribute Default Values](#23-attribute-default-values)
- [2.4 Auto-Code Options](#24-auto-code-options)
  - [2.4.1 Attributes Coded by CV (Image Analysis)](#241-attributes-coded-by-cv-image-analysis)
  - [2.4.2 Attributes Coded by GIS Layer Mapping](#242-attributes-coded-by-gis-layer-mapping)
  - [2.4.3 Attributes Coded by Logic Rules](#243-attributes-coded-by-logic-rules)
- [2.5 Manual Review](#25-manual-review)
- [2.6 Details and GIS Context](#26-details-and-gis-context)
- [2.7 Save and Progress Tracking](#27-save-and-progress-tracking)
- [2.8 CycleRAP Reference](#28-cyclerap-reference)
- [2.9 Hover Tips — Safety Scores & Attributes](#29-hover-tips--safety-scores--attributes)

---

### 2.1 Main Layout

The page keeps three views in sync:

- the current **segment image**
- the **attributes table**
- the **segment map**

Selecting a segment in one area automatically updates the others.

### 2.2 Navigating Segments

You can navigate through segments in three ways:

- Type a segment number in the jump box to go directly to that segment
- Click **Next** or **Back** to move one segment at a time
- Click a point on the segment map to select it

### 2.3 Attribute Default Values

When a segment is first created and no auto-code has been run, PSAT assigns the following default values. These represent the most common parameters for paths in Singapore.

| # | Attribute | Default Value | Reason |
|---|---|---|---|
| 1 | Area Type | Suburban | GIS fallback when no urban/industrial/rural polygon match |
| 2 | Facility Type | Sidewalk | Most common facility type |
| 3 | Adjacent Sidewalk 0–1m | Present | Assumed adjacent sidewalk in urban context |
| 4 | Adjacent Sidewalk 1–3m | Not Present | — |
| 5 | Adjacent Road Lane 0–1m | See image logic | Derived from CV image analysis |
| 6 | Adjacent Road Lane 1–3m | See image logic | Derived from CV image analysis |
| 7 | Adjacent Vehicle Parking 0–1m | Not Present | Most common |
| 8 | Adjacent Vehicle Parking 1–3m | Not Present | Most common |
| 9 | Adjacent Object/Level Change 0–1m | Mirrors Adj. Road 0–1m | Co-occurs with adjacent road |
| 10 | Adjacent Object/Level Change 1–3m | Mirrors Adj. Road 1–3m | Co-occurs with adjacent road |
| 11 | Facility Access | Adequate | Most common |
| 12 | Light Segregation | Present | Assumed when path is detected |
| 13 | Fixed Obstacle on Facility | Not Present | Most common |
| 14 | Non-Fixed Obstacle on Facility | Not Present | Most common |
| 15 | Facility Width per Direction | Narrow | GIS-derived; default when no width data available |
| 16 | Width Restriction | Not Present | Most common |
| 17 | Adjacent Severe Hazard 0–1m | Not Present | Most common |
| 18 | Adjacent Severe Hazard 1–3m | Not Present | Most common |
| 19 | Line of Sight | Not coded | Not yet in scoring specification |
| 20 | Delineation | Not Present | Default; overridden by CV if markers detected |
| 21 | Major Surface Deformation or Drain Opening | Not Present | Most common |
| 22 | Loose or Slippery Surface | Not Present | Most common |
| 23 | Grade | < 5 Degrees | Most paths in Singapore are flat |
| 24 | Curvature | No Sharp Turn | Most common |
| 25 | Tram or Train Rails | Not Present | Most common |
| 26 | Street Lighting | Present | Most urban paths have lighting |
| 27 | Intersection Approach | Separate/NA | Most common |
| 28 | Intersection or Road Crossing | Not Present | Most common |
| 29 | Crossing Facility | Not Present | Default; overridden by CV |
| 30 | Property Access | Not Present | Most common |
| 31 | Pedestrian Crossing | Not Present | Most common |
| 32 | Intersecting Bicycle Facility | Not Present | Most common |
| 33 | Number of Lanes – Adjacent Road | 1 per Direction/NA | Most common |
| 34 | Number of Lanes – Intersecting Road | 1 per Direction/NA | Default from image logic |
| 35 | Flow Direction | One Way | Most common for Singapore paths |
| 36 | Peak Pedestrian Flow | Low | GIS-derived; default when no count data |
| 37 | Peak Bicycle/LV Traffic Flow | Low | GIS-derived; default when no count data |
| 38 | Observed Proportion of Cargo Bikes | Low | Most common |
| 39 | Heavy Vehicle Flow | Low | Most paths away from heavy traffic |
| 40 | Bicycle/LV Speed – Average | < 20 km/h | Most common cycling speed |
| 41 | Bicycle/LV Speed Differential | < 10 km/h | Most common |
| 42 | Road AADT | — | Must be coded manually; no GIS auto-code path |
| 43 | Road Operating Speed (mean) | — | GIS-derived from LinkID layer |
| 44 | Road Speed Limit | — | GIS-derived from speed limit layer |

### 2.4 Auto-Code Options

PSAT supports five auto-code methods that can be run individually or in combination:

- **CV auto-code** — reads the segment image using computer vision models
- **GIS auto-code** — reads GIS shapefiles for the segment location
- **Logic rules** — applies cascade rules based on detected surface types
- **Bulk auto-code** — runs across all selected rows or the full project
- **Per-attribute auto-code** — targets only certain attributes

Autocode progress is tracked in the project listing as **Percentage Segments Autocoded**.

#### 2.4.1 Attributes Coded by CV (Image Analysis)

The following attributes are automatically inferred from street-level photographs using YOLO computer vision models:

| Attribute | How CV Determines the Value |
|---|---|
| Facility Type | Off-road bicycle classifier + fixed obstacle decision logic |
| Light Segregation | Set to Present by default when any path is detected |
| Adjacent Road Lane 0–1m | Adjacent road classifier (confidence ≥ 0.8) |
| Adjacent Road Lane 1–3m | Adjacent road classifier (confidence ≥ 0.8) |
| Adjacent Object/Level Change 0–1m | Inferred from Adjacent Road Lane 0–1m result |
| Adjacent Object/Level Change 1–3m | Inferred from Adjacent Road Lane 1–3m result |
| Adjacent Sidewalk 0–1m | Multi-path detection (multiple path segments visible) |
| Fixed Obstacle on Facility | Fixed obstacle segmentation model |
| Non-Fixed Obstacle on Facility | Fixed obstacle segmentation (label 9 = non-fixed) |
| Delineation | Delineation classifier model |

#### 2.4.2 Attributes Coded by GIS Layer Mapping

The following attributes are automatically derived from the GIS shapefiles stored in the system:

| Attribute | GIS Layer Used | Buffer / Method |
|---|---|---|
| Area Type (Urban/CBD) | `area_type` polygon | Point-in-polygon containment |
| Area Type (Industrial) | `area_type` polygon | Point-in-polygon containment |
| Area Type (Rural) | `LanduseRural2026` / `rural` polygon | Point-in-polygon containment |
| Area Type (Recreational) | `LanduseRecre2026` / `recreation` polygon | Point-in-polygon containment |
| Area Type (Suburban) | *(No layer match)* | Default fallback |
| Facility Width per Direction | `path` / `CyclingPath_Jul2024` / `FootPath_Mar2025` | Nearest within 5 m |
| Road Operating Speed (mean) | `LinkID_Shape_File` (with speed CSV lookup) | Nearest road link |
| Road Speed Limit | `Speed_limit` | Nearest road link |
| Number of Lanes – Adjacent Road | `kerb_line` | Nearest within 10 m |
| Adjacent Vehicle Parking | `parking_lot` | Within 20 m buffer |
| Peak Pedestrian Flow | `AMGbeforeCount` / `AMGsensorCount` | Within 20 m buffer |
| Peak Bicycle/LV Traffic Flow | `AMGbeforeCount` / `AMGsensorCount` | Within 20 m buffer |
| Intersection or Road Crossing | `roadcrossinglayer` / `AMG_BC2025_shp` | Within 5 m / 2 m buffer |
| Crossing Facility | `AMG_BC2025_shp` | Within 2 m buffer |
| Pedestrian Crossing proximity | `Mrt_exit` / `bus_stop` | Within 20 m buffer |
| Heavy Vehicle Flow | `bus_lane` proximity | Within 20 m buffer |

> **Note:** Road AADT has no GIS auto-coding path — it must be coded manually.

#### 2.4.3 Attributes Coded by Logic Rules

Logic rules apply a **cascade system** based on what surface types the CV model detects in the image. Each step overrides the previous if its trigger condition is met:

| Step | Trigger Condition | Key Attributes Set |
|---|---|---|
| **Step 1 — Default** | Always applied first | Facility Type = Sidewalk, Light Seg. = Present, Delineation = Not Present |
| **Step 2 — Cycling Path** | Cycling/Wet Cycling surface in bottom 20% of image | Facility Type = Off-Road Bicycle Path, Delineation = Present |
| **Step 3 — Red Stripe** | Red Stripe surface in bottom 20% of image | Facility Type = Multi-Use Path, Delineation = Present |
| **Step 4 — Traffic Crossing** | Traffic Crossing markings ≥ 80% of bottom 10% | Facility Type = Mixed Traffic, Crossing Facility = Present, Intersection = Present |
| **Step 5 — Zebra Crossing** | Zebra crossing ≥ 80% of bottom 10% | Same as Step 4, but Lanes on Intersecting Road = 1 |
| **Step 6 — Road Surface** | Road pixels ≥ 80% of bottom 10% | Facility Type = Mixed Traffic, Light Seg. = Not Present, Adj. Road 0–1m = Present |

### 2.5 Manual Review

You can override any coded value directly in the table. The page also shows:

- **risk score updates (on-the-fly)** for the selected segment as you change values
- **boxed attributes** highlighting fields that have been manually overwritten
- a **validation summary table** comparing the percentage of attributes overwritten against the stored autocoded baseline
- **field-source provenance** showing whether each value came from CV, GIS, logic rules, or manual entry

### 2.6 Details and GIS Context

For supported attributes, the page can show extra spatial detail within a **5m radius** of the current segment:

- nearby GIS layers (e.g. cycling path, footpath, MRT stations, bus stops)
- curvature visualization
- width visualization
- grade or gradient details when profile data is available

#### Auto-enable GIS Layers on Analysis Overlay

When you turn on the **Analysis Overlay** toggle on the coding page map, PSAT automatically enables the **Footpath**, **Cycling Path**, and **Shared Path** GIS layers so the overlay is always shown over visible path geometry. These layers are never auto-disabled — you can manually toggle them off if you do not need them.

#### Filtered Segments from Path Analysis

If you navigate to the Coding page directly from Path Analysis (by clicking a segment on the Path Analysis map), the coding page map will show **only the segments that were visible in your active filter**. The currently selected segment is always shown regardless of the filter. This makes it easier to focus on a specific subset while coding without losing your analysis context.

### 2.7 Save and Progress Tracking

After review:

- save your attribute edits to persist them and recalculate risk scores
- update the **Segments Verified Percentage** counter as you complete manual checks

### 2.8 CycleRAP Reference

The **CycleRAP** button (next to Coding Guide in the top tab bar) opens the official iRAP CycleRAP page at [irap.org/cyclerap](https://irap.org/cyclerap/) in a new browser tab. Use it to look up attribute definitions, scoring rationale, or the full CycleRAP methodology while you are coding.

#### What is CycleRAP?

CycleRAP is the international standard for evaluating road and cycling infrastructure safety. It assesses risk for bicyclists and other light mobility users across all facility types — on-road or off-road — without requiring crash data. PSAT's scoring engine is built on the CycleRAP methodology.

#### Resources available on the CycleRAP page

Once the page opens, you will find four downloadable or interactive resources:

| Resource | What it contains |
|---|---|
| **Download CycleRAP Methodology** | The full technical specification — all attributes, scoring multipliers, crash type formulas, and risk band thresholds used in PSAT |
| **Download CycleRAP User Guide** | A practical step-by-step guide for surveyors and coders on how to apply CycleRAP in the field |
| **Explore the CycleRAP Demonstrator Tool** | An interactive online tool showing sample assessments and how scores are calculated |
| **Where is CycleRAP being used?** | A map and list of countries and organisations currently using CycleRAP |

#### How to download the CycleRAP Methodology

1. Click the **CycleRAP** button on the Coding page — the iRAP CycleRAP page opens in a new tab.
2. Scroll down until you see the green **"Download CycleRAP Methodology here ↗"** button.
3. Click it. The PDF downloads to your default Downloads folder.
4. Open the PDF to find the full attribute list, scoring multipliers, and risk band definitions that match PSAT's coding attributes.

#### How to download the CycleRAP User Guide

1. On the same CycleRAP page, click the green **"Download CycleRAP User Guide here ↗"** button (next to the Methodology button).
2. The User Guide PDF downloads immediately.
3. This guide explains field-coding procedures and attribute definitions in plain language — useful as a reference while reviewing segments.

#### Other resources

- **Explore the CycleRAP Demonstrator Tool** — click this button to open an interactive tool that walks through a sample assessment and shows how risk scores are calculated from attribute values.
- **Where is CycleRAP being used?** — shows a global map of deployments; useful context for understanding the methodology's scope and adoption.

> **Tip:** The attribute names in PSAT map directly to the CycleRAP Methodology. If you are unsure what value to assign to an attribute (e.g. *Facility Width per Direction* or *Peak Pedestrian Flow*), the Methodology PDF contains the exact definitions and example photographs for each option.

---

### 2.9 Hover Tips — Safety Scores & Attributes

PSAT surfaces contextual help through hover tooltips throughout the interface.

#### Crash Type Score Tooltips

On any page that shows the **Crash Type Scores** panel (Coding Page, Path Analysis, Treatment Page), hover over any of the five score cards to see the risk banding thresholds for that crash type.

**BB / BP / SB (Bicycle-Bicycle, Bicycle-Pedestrian, Single-Bicycle)**

| Band | Score Range |
|---|---|
| Low | < 5 |
| Medium | 5 – 10 |
| High | 10 – 20 |
| Extreme | > 20 |

**VB (Vehicle-Bicycle)**

| Band | Score Range |
|---|---|
| Low | < 10 |
| Medium | 10 – 25 |
| High | 25 – 60 |
| Extreme | > 60 |

The **Risk Score** is the sum of all four crash type scores. Its banding colour reflects the **worst-case** band across all crash types. Hovering the **Risk Score** card shows a compact summary of all banding thresholds for reference.

> **Tip:** Tooltips appear instantly on hover and stay visible even if you accidentally click the card. Move the cursor away to dismiss.

#### Attribute Info Tooltips

On the **Coding Page**, every coding attribute that has a description shows a small **ⓘ info icon** next to its label. Hover the icon to read a plain-English explanation of:

- What the attribute measures.
- How it is typically coded in a Singapore context.
- How it contributes to the CycleRAP risk score.

**Example:**

> **Area type** — *"Classify the surrounding land use. Singapore paths are mostly Suburban (HDB/residential). Use Urban for city area and dense commercial zones, Industrial for business parks and logistics areas, Recreational for parks."*

#### Where Tooltips Appear

| Location | What is shown |
|---|---|
| Crash Type Score cards (BB/BP/SB/VB) | Risk banding thresholds for that crash type |
| Risk Score card | Full banding summary for all crash types |
| Attribute ⓘ icons (Coding Page) | Plain-English description of the attribute and scoring impact |
