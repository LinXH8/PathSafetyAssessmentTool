## 2. Coding Page

The Coding page is the main review workspace. It can open one or more selected projects in a combined session.

---

## Table of Contents

- [2.1 Main Layout](#21-main-layout)
- [2.2 Navigating Segments](#22-navigating-segments)
- [2.3 Attribute Default Values](#23-attribute-default-values)
  - [2.3.1 Attribute Panel Groups](#231-attribute-panel-groups)
- [2.4 Auto-Code Options](#24-auto-code-options)
  - [2.4.1 Attributes Coded by CV (Image Analysis)](#241-attributes-coded-by-cv-image-analysis)
  - [2.4.2 Attributes Coded by GIS Layer Mapping](#242-attributes-coded-by-gis-layer-mapping)
    - [2.4.2.1 Grade](#2421-grade)
    - [2.4.2.2 Curvature](#2422-curvature)
  - [2.4.3 Attributes Coded by Logic Rules](#243-attributes-coded-by-logic-rules)
- [2.5 Manual Review](#25-manual-review)
- [2.6 Details and GIS Context](#26-details-and-gis-context)
- [2.7 Save and Progress Tracking](#27-save-and-progress-tracking)
- [2.8 CycleRAP Reference](#28-cyclerap-reference)
- [2.9 Hover Tips — Safety Scores & Attributes](#29-hover-tips--safety-scores--attributes)
- [2.10 Attribute Logic Checks on Verification](#210-attribute-logic-checks-on-verification)

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

#### 2.3.1 Attribute Panel Groups

The attributes panel organises all 44 coding attributes into **5 tabs** (groups). Click any tab to view only the attributes in that category:

| Tab | Attributes Included |
|---|---|
| **Facility Configuration** | Area Type; Facility Type; Adjacent Sidewalk 0–1m & 1–3m; Adjacent Road Lane 0–1m & 1–3m; Adjacent Vehicle Parking 0–1m & 1–3m; Adjacent Object or Level Change 0–1m & 1–3m |
| **Facility Clear Width** | Facility Access; Light Segregation; Fixed Obstacle on Facility; Non-Fixed Obstacle on Facility; Facility Width per Direction; Width Restriction; Adjacent Severe Hazard 0–1m & 1–3m; Line of Sight |
| **Facility Surface Conditions** | Delineation; Major Surface Deformation or Drain Opening; Loose or Slippery Surface; Grade; Curvature; Tram or Train Rails; Street Lighting |
| **Intersection** | Intersection Approach; Intersection or Road Crossing; Crossing Facility; Property Access; Pedestrian Crossing; Intersecting Bicycle Facility; Number of Lanes – Adjacent Road; Number of Lanes – Intersecting Road |
| **Flow & Speed** | Flow Direction; Peak Pedestrian Flow; Peak Bicycle/LV Traffic Flow; Observed Proportion of Cargo Bikes; Heavy Vehicle Flow; Bicycle/LV Speed – Average; Bicycle/LV Speed Differential; Road AADT; Road Operating Speed (mean); Road Speed Limit |

This grouping makes it easier to focus on related attributes — for example, all width and obstacle fields together in **Facility Clear Width**, or all speed and traffic fields in **Flow & Speed**.

---

When a segment is first created and no auto-code has been run, PSAT assigns the following default values. These represent the most common parameters for paths in Singapore.

| # | Attribute | Default Value | Reason |
|---|---|---|---|
| 1 | Area Type | Suburban | GIS fallback using LTA parking zone and URA land use layers; default when no urban/industrial/recreational polygon match |
| 2 | Facility Type | Sidewalk | Most common facility type in Singapore; overridden by CV image analysis |
| 3 | Facility Access | Adequate | Most common; code Inadequate only when congestion or blockages force users onto alternative routes |
| 4 | Loose or Slippery Surface | Not Present | Most common; GIS-assisted via PATH defects layer (algae); CV detection not yet ready |
| 5 | Tram or Train Rails | Not Present | No tram or train rail paths/roads exist in Singapore |
| 6 | Major Surface Deformation or Drain Opening | Not Present | Most common; GIS-assisted via PATH defects layer (tile cracks, tactile tile cracks, uneven pavement) |
| 7 | Fixed Obstacle on Facility | Not Present | Most common; overridden by CV image analysis |
| 8 | Non-Fixed Obstacle on Facility | Not Present | Most common; overridden by CV image analysis |
| 9 | Line of Sight | Adequate | Not yet in scoring specification; requires manual assessment of visibility along the path |
| 10 | Delineation | Not Present | Default is Not Present because the default Facility Type is Sidewalk (sidewalks are not delineated); CV codes first, then overwritten if PATH provides faded marking data |
| 11 | Light Segregation | Present | All off-road paths are expected to have kerb segregation; confirmed by CV and logic rules |
| 12 | Facility Width per Direction | Narrow | GIS-derived from LiDAR path width data; default when no width data available |
| 13 | Flow Direction | Two Way | Most on-road cycling lanes are one-way; all off-road paths default to two-way |
| 14 | Width Restriction | Not Present | Most common; logic rule sets Present when a fixed or non-fixed obstacle is detected |
| 15 | Adjacent Road Lane 0–1m | Not Present | CV-derived; present when path edge is ≤1m from road kerb with no protective barrier |
| 16 | Adjacent Vehicle Parking 0–1m | Not Present | Most common; GIS-derived from URA car park lot layer and GDM lane markings |
| 17 | Adjacent Severe Hazard 0–1m | Not Present | Rare in Singapore; requires manual assessment when waterways or drops >60cm are present with no barrier |
| 18 | Adjacent Object/Level Change 0–1m | Not Present | May be present when a road carriageway is within 1m of the path edge with no protective barrier; inferred by CV and logic rules — not always present even on off-road paths |
| 19 | Adjacent Sidewalk 0–1m | Not Present | Present when a separate pedestrian footpath runs parallel within 1m of the cycling path (e.g. split paths); detected by CV using multi-path classification and refined by logic rules |
| 20 | Adjacent Road Lane 1–3m | Not Present | CV-derived; present when road is 1–3m from path with no protective barrier |
| 21 | Adjacent Vehicle Parking 1–3m | Not Present | Most common; GIS-derived from URA car park lot layer |
| 22 | Adjacent Severe Hazard 1–3m | Not Present | Rare in Singapore; requires manual assessment when severe hazards are 1–3m from path |
| 23 | Adjacent Object/Level Change 1–3m | Not Present | Co-occurs with adjacent road lane; inferred by CV and logic rules |
| 24 | Adjacent Sidewalk 1–3m | Not Present | Not present by default; CV and logic rules detect when split paths with >1m green verge are present |
| 25 | Grade | < 5 Degrees | Most paths in Singapore are flat; GIS-derived from LiDAR 3D point cloud data |
| 26 | Curvature | No Sharp Turn Present | Most common; GIS-derived using path geometry and curvature radius calculation |
| 27 | Street Lighting | Present | Most urban paths in Singapore have adequate street lighting |
| 28 | Pedestrian Crossing | Not Present | Most common; GIS-derived from MRT exit and bus stop layers; manual coding where needed |
| 29 | Intersecting Bicycle Facility | Not Present | Most common; GIS-derived using pedestrian crossing layer within 5m radius |
| 30 | Intersection Approach | Separate/NA | Most off-road cycling paths remain separate from traffic at intersections |
| 31 | Intersection or Road Crossing | Not Present | Most common; overridden by CV when crossings are detected |
| 32 | Crossing Facility | Not Present | Most common; overridden by CV when zebra crossings or bicycle crossings are detected |
| 33 | Number of Lanes – Adjacent Road | > 1 per Direction | Most common; GIS-derived from LiDAR kerbline layer |
| 34 | Number of Lanes – Intersecting Road | 1 per Direction/NA | Default when no intersection is present; GIS-derived from LiDAR kerbline layer when intersection exists |
| 35 | Property Access | Not Present | Most common; CV and GIS auto-coding pending |
| 36 | Peak Pedestrian Flow | None | GIS-derived from MRT exit, bus stop, and AMG sensor count layers; default when no count data available |
| 37 | Peak Bicycle/LV Traffic Flow | Low | GIS-derived from AMG 24/7 sensor count data; default when no count data available |
| 38 | Observed Proportion of Cargo Bikes | Low | Most common; ePMD and PAB in Singapore are under 20kg, classifying them as low cargo proportion |
| 39 | Bicycle/LV Speed – Average | < 20 km/h | Most common cycling speed on Singapore shared paths and CPNs |
| 40 | Bicycle/LV Speed Differential | < 10 km/h | Most common; low speed variation typical on Singapore shared paths |
| 41 | Road AADT | 6000 | Must be coded manually; no GIS auto-code path; ERP2 data integration pending |
| 42 | Heavy Vehicle Flow | Low | Most paths are away from heavy traffic; GIS-derived from bus lane marking layer (GDM) |
| 43 | Road Speed Limit | 10 km/h | GIS-derived from GDM speed limit layer; used for analysis only and does not affect risk scores |
| 44 | Road Operating Speed (mean) | 30 | GIS-derived from LinkID layer and ERP2 speed data; required when adjacent road or road crossing is present |

### 2.4 Auto-Code Options

PSAT supports six auto-code methods that can be run individually or in combination:

- **CV auto-code** — reads the segment image using computer vision models
- **GIS auto-code** — reads GIS shapefiles for the segment location
- **Logic rules** — applies cascade rules based on detected surface types
- **Auto-code (by segment)** — auto-codes all attributes for the currently selected segment
- **Bulk auto-code** — runs across all selected rows or the full project (use **Autocode All Projects** to run across all loaded projects)
- **Per-attribute auto-code** — targets only certain attributes across selected project(s)

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
| Non-Fixed Obstacle on Facility | Fixed obstacle segmentation model — class label 9 in the YOLO model corresponds to non-fixed obstacles (temporary items such as bins, cones, and bicycles parked on the path) |
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
| Grade | LiDAR 3D point cloud (elevation data) | Weighted elevation interpolation within 3 m radius (see §2.4.2.1) |
| Curvature | `path` / `CyclingPath_Jul2024` / `FootPath_Mar2025` centreline | Path centreline geometry analysis within 5 m radius (see §2.4.2.2) |

> **Note:** Road AADT has no GIS auto-coding path — it must be coded manually.

##### 2.4.2.1 Grade

- Verify LiDAR points for gaps or corrupted files.
- Remove any points without elevation value
- Remove points below -10m and +65m (Bukit Timah Hill still lies below this point so there's no reason for 170m)

![LiDAR elevation range filter](/docs/user/img/grade-curvature/image1.png)

- Obtain all LiDAR points within 3m of identified GPS point
- Assign these LiDAR points a fixed score multiplier based on distance from point
- Score in relation to distance is calculated using this sigmund curve modified to accept a parameter for number of points

Confidence level is not a strict cut off point but instead a point at which the score begins to diminish rapidly, seen by the first curve of the sigmoid below. A higher confidence inversely affects the severity of the curve, resulting in a flatter score distribution and thus more evenly weighted across all distance, i.e. a high confidence of 100 will effectively cause points at 0m and 3m to have identical weightage. The confidence level of 2.87 is determined to be the highest accuracy based on comparisons to testing with personal equipment in my neighborhood (smartwatch's baro altimeter). This value can 100% be refined further, but the largest point of error now isn't my equipment accuracy but much more so the LiDAR accuracy.

![Sigmoid curve for point score calculation](/docs/user/img/grade-curvature/image2.png)

- Plot all points on a 3d graph such that Y = elevation, X = distance and Z = score

Very hard to give typical range due to the incredible amount of inaccuracy in the LiDAR data, i.e. an average elevation of 50m because the equipment happened to scan a flock of birds. Within Singapore, the expected range is 0m to 15m. Unable to give a picture example of said graph because this is purely computational and for auditing. This graph is not used in final calculations.

- Determine elevation using simple weighted aggregation

Points closer to 0m have higher weightage in regards to elevation, based on computed score given the sigmoid function above. To be more specific, I used the inverse distance weighting formula below where E-hat is the resulting estimated elevation (the hat signifies estimated, wi being the weight of point i, and ei being the elevation of point i. Further clarification: weight = score, the number calculted from the sigmoid curve above.

![Inverse distance weighting formula](/docs/user/img/grade-curvature/image3.png)

**REASONING**

- 3m search radius balances spatial specificity against the risk of insufficient point density in any single capture
- inverse distance weighting is an established spatial interpolation technique that preserves the intuition that nearer measurements are more representative of a target location
- logistic function is used to model confidence as a function of point count because density exhibits diminishing returns on estimate reliability i.e the difference between 1 and 10 points is significant, while the difference between 100 and 110 is negligible
- Weighted aggregation over distance-scaled scores produces a single elevation estimate that is robust to outlier points at the periphery of the search radius

##### 2.4.2.2 Curvature

- Path is snapped to nearest GIS path centreline; uses the facility under priority cycling>shared>footpath, i.e. if side by side cycling path/footpath, curvature will always use cycling path
- Buffer of 5m radius to prevent across the road problems

![5m buffer zone diagram](/docs/user/img/grade-curvature/image4.png)

**ALONG PATH**

- Within 5m (this is the radius we see) the path line found previously is densified to 0.5m spaced points and slides in consecutive triplet points (as in 0m is point A, 0.5m is point B, etc), one area can have many of these triplets
- The algorithm fits a circle that passes through any 3 points using this: R = (a * b * c) / (4 / Area) where area is derived from Heron's formula
- Passes through these rejection criteria: Nearly straight (collinear) abc points skipped (straight), micro-triangle abc points under 0.35m each side is skipped (inaccurate), lopsided abc (one long side one short side etc) skipped (inaccurate). Exact numbers are if long end is 3x the short end

Points ABC form lines AB and BC. Lopsided 3x signifies that AB:BC > 1:3 or vice versa.

![Triplet lopsided rejection diagram](/docs/user/img/grade-curvature/image5.png)

- Now we have a few non-rejected abc triplets, use the worst case (minimum radius)

**PATH INTERSECTION**

- If no sharp turn, run this, so if got sharp turn + path intersection, always will show sharp turn
- Any vertex deflection angle > 45 deg
- Must have >1m arm lengths (to account for drawing error)

![Path intersection deflection angle diagram](/docs/user/img/grade-curvature/image6.jpeg)

**EXACT NUMBER JUSTIFICATIONS**

- 0.5m densify spacing: any smaller, detection becomes too sensitive. Any higher, not enough points. Each triplet here spans roughly 1m and 5-6deg arc of a 10m circle
- 0.35m min triplet leg: GIS data shows this to be the breaking point where any smaller, centreline noise/inaccuracy starts to take ove

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

---

### 2.10 Attribute Logic Checks on Verification

When you mark a segment as **Verified**, PSAT checks the coded attributes for contradictory or impossible combinations. There are two categories of checks.

#### Hard Rules

Hard rules flag combinations that cannot coexist. Resolve all hard-rule conflicts before marking a segment as Verified.

| # | If | Then |
|---|---|---|
| 1 | Adjacent Road Lane 1–3m = Present | Adjacent Road Lane 0–1m = Not Present |
| 2 | Adjacent Vehicle Parking 1–3m = Present | Adjacent Vehicle Parking 0–1m = Not Present |
| 3 | Adjacent Severe Hazard 1–3m = Present | Adjacent Severe Hazard 0–1m = Not Present |
| 4 | Adjacent Object or Level Change 1–3m = Present | Adjacent Object or Level Change 0–1m = Not Present |
| 5 | Adjacent Sidewalk 1–3m = Present | Adjacent Sidewalk 0–1m = Not Present |
| 6 | Facility Type = Sidewalk | Adjacent Sidewalk 0–1m = Not Present |
| 7 | Facility Type = Mixed Traffic Road Lane | Adjacent Road Lane 0–1m = Present **and** Adjacent Road Lane 1–3m = Not Present |
| 8 | Facility Type = Sidewalk, Multi-Use Path, or Off-Road Bicycle Path | Adjacent Object or Level Change = Present |
| 9 | Width Restriction = Present | Fixed Obstacle on Facility = Present **or** Non-Fixed Obstacle on Facility = Present (or both) |
| 10 | Facility Type = Sidewalk, Multi-Use Path, or Off-Road Bicycle Path | Light Segregation = Present |
| 11 | Property Access = Present | Intersection or Road Crossing = Present |
| 12 | Facility Type = On-Road Bicycle Lane | Adjacent Road Lane 0–1m = Present |
| 13 | Adjacent Road Lane 0–1m = Present | Road AADT ≠ 0 |
| 14 | Adjacent Road Lane 0–1m = Present | Road Operating Speed (mean) ≠ 0 |
| 15 | Adjacent Road Lane 1–3m = Present | Road AADT ≠ 0 |
| 16 | Adjacent Road Lane 1–3m = Present | Road Operating Speed (mean) ≠ 0 |
| 17 | Intersection or Road Crossing = Present | Road AADT ≠ 0 |
| 18 | Intersection or Road Crossing = Present | Road Operating Speed (mean) ≠ 0 |
| 19 | Facility Type = Mixed Traffic Road Lane | Road AADT ≠ 0 |
| 20 | Facility Type = Mixed Traffic Road Lane | Road Operating Speed (mean) ≠ 0 |
| 21 | Facility Type = Road Shoulder | Adjacent Road Lane 0–1m = Present |

> **Rules 1–5** reflect the spatial logic that if a hazard exists in the outer band (1–3m) it cannot simultaneously exist in the inner band (0–1m) for the same feature type.

> **Rules 13–20** reflect that Road AADT and Road Operating Speed must have non-zero values whenever an adjacent road lane or road crossing is present, or when the facility itself is on a road.

#### Warnings

Warnings flag unusual combinations that are not always wrong. Review the segment image carefully before confirming.

| # | If | Expected |
|---|---|---|
| 1 | Facility Type = Off-Road Bicycle Path | Adjacent Sidewalk 0–1m **or** 1–3m = Present |
| 2 | Facility Type = Mixed Traffic Road Lane | Intersection or Road Crossing = Present |

> **Note:** Warning behaviour (how warnings are displayed and how a coder acknowledges them) is subject to review. This section will be updated once the display approach is confirmed.
