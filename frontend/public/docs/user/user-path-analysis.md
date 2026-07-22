## 3. Path Analysis

The Path Analysis page is the multi-project analysis workspace.

> **What's new in v2:** The Path Analysis page was fully redesigned. The underlying filtering, export, and session-continuity behaviour described below is the same — what changed is layout and a few added conveniences:
>
> - **Layout:** the top row is now an **accordion card** with three collapsible sections — *Top Risk Contributors* (open by default), *Toggle Attributes*, and *Current Filters* — next to the map; the bottom row shows *Distribution of Project* next to an *Overall Risk Level* card (stacked risk-band bars per crash type, replacing the v1 pie/bar-only view).
> - **Map/Table toggle, Jump-to-Project pills, and Download** — the Map/Table switch and the project "jump to" pills (now pink) sit above the map; the three separate coloured download buttons are consolidated into a single **"Download ▾"** dropdown (Section 3.4 still lists all three formats it offers).
> - **Segment hover thumbnails** — hovering over a segment dot on the map shows a small thumbnail of its street-level image, plus the project name, segment number, and the value of your currently selected focus attribute. This lets you preview a segment before clicking into it, and only appears on the Path Analysis map, not the Coding page map.
> - **Mark Verified (session-only)** — when you open a segment in Coding from a Path Analysis filter, a **Mark Verified** button lets you tick off segments as you review them; see [Section 3.5](#filtered-segments-from-path-analysis) for details and its limitations.
> - **Generate Report** moved from the sidebar onto the canvas, next to the Download dropdown; it reads **"📄 Continue Report"** instead of **"📄 Generate Report"** once a report layout already exists in your browser.
> - **Clear Filters** is on-canvas rather than a dedicated sidebar button — see [Section 3.3](#33-analyse-loaded-data).

---

## Table of Contents

- [3.1 Select Projects](#31-select-projects)
- [3.2 Filter Before Loading](#32-filter-before-loading)
- [3.3 Analyse Loaded Data](#33-analyse-loaded-data)
  - [3.3.1 Attribute Filters and Finer Filtering](#331-attribute-filters-and-finer-filtering)
  - [3.3.2 Finer Filtering — Sub-category Options](#332-finer-filtering--sub-category-options)
- [3.4 Export](#34-export)
- [3.5 Session Continuity](#35-session-continuity)
- [3.6 Finer Filtering Reference](#36-finer-filtering-reference)

---

### 3.1 Select Projects

You can select one or more projects to analyse together. The search box matches both **project names** and **source road names**, so you can find projects even when the project title and road name differ.

### 3.2 Filter Before Loading

Before loading projects, you can filter by:

| Filter | Description |
|---|---|
| Project or road name | Text search |
| Tag | e.g. NSC, AMK, Pre, Post |
| Date created range | Filter projects created within a date window |
| Last updated range | Filter projects updated within a date window |

### 3.3 Analyse Loaded Data

After loading projects, you can:

- choose **up to five attributes** to focus on
- apply segment-level filters (see sections below)
- view attribute distributions and aggregated score-band summaries
- inspect filtered segments on the map and in the table
- hover a segment dot to preview its thumbnail image, project name, and focus-attribute value before clicking in
- click a segment to navigate to the Coding page to make edits to the attribute(s) (if necessary)
- click **Back to Analysis** to return and continue

**Top Risk Contributors** — the panel showing the attributes contributing most to risk scores is **reactive to your active filters**. As you apply or change segment filters, the Top Risk Contributors list updates automatically to reflect only the filtered subset of segments, so the contributors you see always match the segments currently visible on the map and in the table.

**Clear Filters** — clear every active segment filter in one click from the **Current Filters** section of the accordion (v2) or the dedicated Clear Filters button (v1).

#### 3.3.1 Attribute Filters and Finer Filtering

When you select an attribute for analysis, you can filter segments by its coded values. Attributes marked **❖** also support **finer filtering** — selecting a specific value (e.g. *Present* for Fixed Obstacle on Facility) reveals a secondary sub-category dropdown so you can pinpoint exact sub-types. The map updates to show distinct colours for each sub-category once a sub-type is selected.

| Attribute | Filter Values | Finer Filter Sub-categories (❖ = available) |
|---|---|---|
| Facility Type | Sidewalk; Multi-Use Path; Off-Road Bicycle Path; On-road Bicycle Lane; Road Shoulder; Mixed Traffic Road Lane | — |
| Area Type | Urban/CBD; Suburban; Rural; Industrial; Recreational | — |
| Adjacent Road Lane 0–1m | Present; Not Present | — |
| Adjacent Road Lane 1–3m | Present; Not Present | — |
| Adjacent Vehicle Parking 0–1m | Present; Not Present | — |
| Adjacent Vehicle Parking 1–3m | Present; Not Present | — |
| Facility Width per Direction **❖** | Very Narrow; Narrow; Wide | Very Narrow: ≤1.5m; >1.5–1.8m; >1.8–<2m · Narrow: 2–<3.5m; 3.5–4m · Wide: >4m |
| Flow Direction | One Way; Two Way | — |
| Grade | ≤2° (1:25); 2.9° (1:20); 3.8° (1:15); 4.7° (1:12); ≥5° | — |
| Curvature **❖** | Sharp Turn Present; No Sharp Turn Present | Sharp Turn: <6.5m; 6.5–<10m; Path Junction · No Sharp Turn: 10–18m; >18m |
| Street Lighting | Present; Not Present | — |
| Delineation **❖** | Present; Not Present | When "Present": Cycling Path; Red Stripe; Signalised Crossing; Traffic Crossing; Zebra Crossing <br> When "Not Present": Faded Marking |
| Fixed Obstacle on Facility **❖** | Present; Not Present | When "Present": Lamp Post; Traffic Light; Covered Linkway Pole; Bollard; Billboard; Sign Pole; Utility Box; Railing; Vegetation; Others (any obstacle not matching a preset type is standardised to *Others*) |
| Non-Fixed Obstacle on Facility **❖** | Present; Not Present | When "Present": Barrier; Bin; Bicycle; Cone; Others (any obstacle not matching a preset type is standardised to *Others*) |
| Light Segregation | Present; Not Present | — |
| Intersection or Road Crossing | Present; Not Present | — |
| Crossing Facility **❖** | Present; Not Present | When "Present": Zebra Crossing; Signalised PC; Bicycle Crossing; Unsignalised Junction; Development Access |
| Property Access | Present; Not Present | — |
| Tram or Train Rails | Present; Not Present | — |
| Major Surface Deformation or Drain Opening **❖** | Present; Not Present | When "Present": Footpath crack; Uneven Footpath |
| Peak Pedestrian Flow | None; Low; Moderate to High | — |
| Peak Bicycle/LV Traffic Flow | Low; Moderate to High | — |
| Observed Proportion of Cargo Bikes | Low; Moderate to High | — |
| Heavy Vehicle Flow | Low; Moderate to High | — |
| Bicycle/LV Speed – Average | < 20 km/h; ≥ 20 km/h | — |
| Road Speed Limit | NA; 30 km/h; 40 km/h; 50 km/h; 60 km/h; 70 km/h; 80 km/h; 90 km/h | — |
| Overall Risk Level Band | 1 (Low); 2 (Medium); 3 (High); 4 (Extreme) | — |

#### 3.3.2 Finer Filtering — Sub-category Options

Selecting a top-level filter value for any attribute marked **❖** reveals a secondary sub-category dropdown. Each sub-category is shown with a distinct colour on the map.

| Attribute | Trigger Value | Sub-category Options |
|---|---|---|
| Facility Width per Direction | Very Narrow | ≤1.5 m; >1.5–1.8 m; >1.8–<2 m |
| Facility Width per Direction | Narrow | 2–<3.5 m; 3.5–4 m |
| Facility Width per Direction | Wide | >4 m |
| Curvature | Sharp Turn Present | <6.5 m (footpath threshold); 6.5–<10 m; Path Junction |
| Curvature | No Sharp Turn Present | 10–18 m; >18 m (cycling path threshold ≥18 m) |
| Fixed Obstacle on Facility | Present | Lamp Post; Traffic Light; Covered Linkway Pole; Bollard; Billboard; Sign Pole; Utility Box; Railing; Vegetation; Others (standardised fallback for any unrecognised type) |
| Non-Fixed Obstacle on Facility | Present | Barrier; Bin; Bicycle; Cone; Others (standardised fallback for any unrecognised type) |
| Delineation | Present | Cycling Path; Red Stripe; Signalised Crossing; Traffic Crossing; Zebra Crossing |
| Delineation | Not Present | Faded Marking |
| Crossing Facility | Present | Zebra Crossing; Signalised PC; Bicycle Crossing; Unsignalised Junction; Development Access |
| Major Surface Deformation or Drain Opening | Present | Footpath crack; Uneven Footpath |

**How to use finer filtering:**

1. In the Filter panel, select an attribute that supports finer filtering (marked **❖**).
2. Choose a top-level value (e.g. *Present* for Fixed Obstacle on Facility).
3. A second dropdown appears — select the specific sub-type you want to highlight.
4. The map immediately updates to colour only segments matching that sub-type.
5. To adjust or clear the sub-filter, click the **×** on the active sub-category chip, or change the top-level value.

> **If the finer filtering colours are not appearing correctly on the map**, it is likely because the source attribute was coded incorrectly for some segments. To fix this:
>
> 1. Hover over a segment dot to preview its thumbnail image and confirm it's the right one, then click the affected segment on the map to open it in the Coding page.
> 2. Review and correct the attribute value (e.g. change the sub-type for Fixed Obstacle Type).
> 3. Save the segment, then click **Back to Analysis** to return.
> 4. Re-apply the filter — the updated colour will now be reflected on the map.

### 3.4 Export

The page supports three exports:

| Export | Format | Contents |
|---|---|---|
| **Download Table** | CSV | All currently filtered segment rows |
| **Download Images** | ZIP | All images for the currently filtered segments |
| **Download Shapefile** | ZIP (Shapefile) | Filtered segments exported as point geometry with attributes |

**Download Shapefile** exports the currently visible filtered segments as a standard GIS shapefile package (`.zip`). The file is named `shapefile_export_YYYY-MM-DD.zip` and can be opened in QGIS, ArcGIS, or any other GIS application. Only segments that have a valid image reference are included.

> **Project names in exports** — the project name shown in the CSV and shapefile exports matches exactly what is displayed in the Path Analysis page, ensuring consistency when cross-referencing exported data against the on-screen analysis.

> **v2 layout:** All three exports are reached from a single dark **"Download ▾"** dropdown button instead of three separate coloured buttons — the export formats and contents themselves are unchanged.

### 3.5 Session Continuity

Your selections and filters are kept for the browser session, so navigating away (e.g. to edit a segment in Coding) and returning does not immediately clear the analysis setup.

#### Filtered Segments from Path Analysis

If you click a segment on the Path Analysis map to open it in the Coding page, the coding page map will show **only the segments that were visible in your active filter — with the same colours** (risk band or finer-filter sub-category colours) carried over from Path Analysis. The currently selected segment is always shown regardless of the filter. This lets you review and correct mis-coded segments by clicking straight through the coloured points on the Coding page map, without needing to keep navigating back and forth to Path Analysis to re-check which segments are affected.

Click **Back to Analysis** in the sidebar to return to Path Analysis with your filters intact. Secondary attribute (finer filter) colours on the map are **automatically refreshed** when you return — changes you made to obstacle types or other sub-category attributes in the Coding page will be reflected immediately without needing to re-apply the filter.

#### Mark Verified

When you open the Coding page from a Path Analysis filter, a **Mark Verified** button is available. Clicking it toggles the current segment between "Mark Verified" and "✓ Verified" (shown with a green fill). Verified segments are highlighted on the map with a green halo around their point, and their tooltip shows "✓ Verified" — making it easy to track which segments in your filtered set you've already reviewed while working through the list.

> **Mark Verified is not permanently saved.** This status is held in memory only for your current session — it is **not** written to the project or database, and resets if you leave and re-enter the Coding page or reload the browser. Treat it as a temporary checklist while reviewing a batch of segments in one sitting, not as a permanent record.

---

### 3.6 Finer Filtering Reference

Finer filtering lets you narrow a segment filter down to a specific **sub-type** within a parent category. When an attribute supports it, selecting a top-level value reveals a second dropdown — and the map immediately updates to colour only the segments that match your exact sub-type.

Attributes that support finer filtering are marked **❖** in the filter panel.

#### Which Attributes Support Finer Filtering

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

#### How to Use Finer Filtering

1. Open Path Analysis and load one or more projects.
2. In the **Filter Segment** panel, select an attribute marked **❖** from the dropdown.
3. Choose a top-level value (e.g. *Present* for Crossing Facility).
4. A **sub-category dropdown** appears immediately below — select the specific sub-type you want (e.g. *Zebra Crossing*).
5. The map updates to colour only segments with that sub-type. Segments with other values are shown in grey.
6. To **change** the sub-category, open the second dropdown and choose a different option.
7. To **clear** finer filtering, click the **×** on the active filter chip, or reset the top-level value to *Not Selected*.

#### Sub-category Reference Table

| Attribute | Trigger Value | Sub-category Options | Map Colour Logic |
|---|---|---|---|
| Facility Width per Direction | Very Narrow | ≤1.5 m · >1.5–1.8 m · >1.8–<2 m | Red → Orange → Amber (narrower = more risk) |
| Facility Width per Direction | Narrow | 2–<3.5 m · 3.5–4 m | Green shades |
| Facility Width per Direction | Wide | >4 m | Blue |
| Curvature | Sharp Turn Present | <6.5 m (footpath threshold) · 6.5–<10 m · Path Junction | Red · Orange · Purple |
| Curvature | No Sharp Turn Present | 10–18 m · >18 m (cycling path threshold ≥18 m) | Green · Blue |
| Fixed Obstacle on Facility | Present | Lamp Post · Traffic Light · Covered Linkway Pole · Bollard · Billboard · Sign Pole · Utility Box · Railing · Vegetation · Others | Unique colour per type; unrecognised types standardised to *Others* |
| Non-Fixed Obstacle on Facility | Present | Barrier · Bin · Bicycle · Cone · Others | Unique colour per type; unrecognised types standardised to *Others* |
| Delineation | Present | Cycling Path · Red Stripe · Signalised Crossing · Traffic Crossing · Zebra Crossing | Unique colour per type |
| Delineation | Not Present | Faded Marking | Unique colour per type |
| Crossing Facility | Present | Zebra Crossing · Signalised PC · Bicycle Crossing · Unsignalised Junction · Development Access | Unique colour per type |
| Major Surface Deformation or Drain Opening | Present | Footpath crack · Uneven Footpath | Unique colour per type |

#### Correcting Wrong Sub-category Colours

If the map shows unexpected colours when a sub-category filter is active, this usually means the source attribute was coded with an incorrect or missing sub-type value.

1. Click the affected segment on the map to select it.
2. Click **Open in Coding** (or navigate to the Coding page from the sidebar).
3. In the attribute table, find the relevant attribute (e.g. *Fixed Obstacle Type* for Fixed Obstacle on Facility).
4. Correct the value to the appropriate sub-type from the dropdown.
5. Click **Save** to persist the change and recalculate risk scores.
6. Click **Back to Analysis** in the sidebar to return to Path Analysis.
7. Re-apply the same filter — the corrected colour will now appear on the map.

> This also applies when the CV auto-coder assigns a sub-type incorrectly. The Coding page lets you override any auto-coded value and is the authoritative source for what appears in the filters.
