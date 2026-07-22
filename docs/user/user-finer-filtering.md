## 5.6 Finer Filtering in Path Analysis

Finer filtering lets you narrow a segment filter down to a specific **sub-type** within a parent category. When an attribute supports it, selecting a top-level value reveals a second dropdown — and the map immediately updates to colour only the segments that match your exact sub-type.

Attributes that support finer filtering are marked **❖** in the filter panel.

---

## Table of Contents

- [Which Attributes Support Finer Filtering](#which-attributes-support-finer-filtering)
- [How to Use Finer Filtering](#how-to-use-finer-filtering)
- [Sub-category Reference Table](#sub-category-reference-table)
- [Correcting Wrong Sub-category Colours](#correcting-wrong-sub-category-colours)

---

### Which Attributes Support Finer Filtering

The following attributes currently have finer filtering enabled:

| Attribute | Top-level Values | Sub-category Count |
|---|---|---|
| **Facility Width per Direction** ❖ | Very Narrow; Narrow; Wide | 6 width ranges |
| **Curvature** ❖ | Sharp Turn Present; No Sharp Turn Present | 5 radius ranges |
| **Fixed Obstacle on Facility** ❖ | Present; Not Present | 10 obstacle types |
| **Non-Fixed Obstacle on Facility** ❖ | Present; Not Present | 5 obstacle types |
| **Delineation** ❖ | Present; Not Present | 5 delineation types when Present; 1 type when Not Present |
| **Crossing Facility** ❖ | Present; Not Present | 5 crossing types |
| **Major Surface Deformation or Drain Opening** ❖ | Present; Not Present | 3 deformation types |

All other attributes use standard single-level filtering.

---

### How to Use Finer Filtering

1. Open Path Analysis and load one or more projects.
2. In the **Filter Segment** panel, select an attribute marked **❖** from the dropdown.
3. Choose a top-level value (e.g. *Present* for Crossing Facility).
4. A **sub-category dropdown** appears immediately below — select the specific sub-type you want (e.g. *Zebra Crossing*).
5. The map updates to colour only segments with that sub-type. Segments with other values are shown in grey.
6. To **change** the sub-category, open the second dropdown and choose a different option.
7. To **clear** finer filtering, click the **×** on the active filter chip, or reset the top-level value to *Not Selected*.

---

### Sub-category Reference Table

| Attribute | Trigger Value | Sub-category Options | Map Colour Logic |
|---|---|---|---|
| Facility Width per Direction | Very Narrow | ≤1.5 m · >1.5–1.8 m · >1.8–<2 m | Red → Orange → Amber (narrower = more risk) |
| Facility Width per Direction | Narrow | 2–<3.5 m · 3.5–4 m | Green shades |
| Facility Width per Direction | Wide | >4 m | Blue |
| Curvature | Sharp Turn Present | <6.5 m (footpath threshold) · 6.5–<10 m · Path Junction | Red · Orange · Purple |
| Curvature | No Sharp Turn Present | 10–18 m · >18 m (cycling path threshold ≥18 m) | Green · Blue |
| Fixed Obstacle on Facility | Present | Lamp Post · Traffic Light · Covered Linkway Pole · Bollard · Billboard · Sign Pole · Utility Box · Railing · Vegetation · Others | Unique colour per type |
| Non-Fixed Obstacle on Facility | Present | Barrier · Bin · Bicycle · Cone · Others | Unique colour per type |
| Delineation | Present | Cycling Path · Red Stripe · Signalised Crossing · Traffic Crossing · Zebra Crossing | Unique colour per type |
| Delineation | Not Present | Faded Marking | Unique colour per type |
| Crossing Facility | Present | Zebra Crossing · Signalised PC · Bicycle Crossing · Unsignalised Junction · Development Access | Unique colour per type |
| Major Surface Deformation or Drain Opening | Present | Footpath crack · Uneven Footpath | Unique colour per type |

**Grade filter values** (no finer filtering, but updated options):

| Grade Value | Meaning |
|---|---|
| ≤2° (1:25) | Slope up to 2° — very gentle |
| 2.9° (1:20) | Slope up to 2.9° |
| 3.8° (1:15) | Slope up to 3.8° |
| 4.7° (1:12) | Slope up to 4.7° |
| ≥5° | 5° or steeper — steepest category |

**Road Speed Limit** filter values (0, 10, 20, 100, 110, 120 km/h removed — not applicable to Singapore cycling paths):

`NA · 30 km/h · 40 km/h · 50 km/h · 60 km/h · 70 km/h · 80 km/h · 90 km/h`

---

### Correcting Wrong Sub-category Colours

If the map shows unexpected colours when a sub-category filter is active — for example, a segment appears in the wrong colour or isn't highlighted at all — this usually means the source attribute was coded with an incorrect or missing sub-type value.

**Steps to fix it:**

1. Click the affected segment on the map to select it.
2. Click **Open in Coding** (or navigate to the Coding page from the sidebar).
3. In the attribute table, find the relevant attribute (e.g. *Fixed Obstacle Type* for Fixed Obstacle on Facility).
4. Correct the value to the appropriate sub-type from the dropdown.
5. Click **Save** to persist the change and recalculate risk scores.
6. Click **Back to Analysis** in the sidebar to return to Path Analysis.
7. Re-apply the same filter — the corrected colour will now appear on the map.

> This also applies when the CV auto-coder assigns a sub-type incorrectly. The Coding page lets you override any auto-coded value and is the authoritative source for what appears in the filters.
