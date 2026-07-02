## 3. Path Analysis

The Path Analysis page is the multi-project analysis workspace.

---

## Table of Contents

- [3.1 Select Projects](#31-select-projects)
- [3.2 Filter Before Loading](#32-filter-before-loading)
- [3.3 Analyse Loaded Data](#33-analyse-loaded-data)
  - [3.3.1 Attribute Filters and Finer Filtering](#331-attribute-filters-and-finer-filtering)
- [3.4 Export](#34-export)
- [3.5 Session Continuity](#35-session-continuity)

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
- view attribute distributions
- inspect filtered segments on the map and in the table
- click a segment to navigate to the Coding page to make edits to the attribute(s) (if necessary)
- click **Back to Analysis** to return and continue

**Top Risk Contributors** — the panel showing the attributes contributing most to risk scores is **reactive to your active filters**. As you apply or change segment filters, the Top Risk Contributors list updates automatically to reflect only the filtered subset of segments, so the contributors you see always match the segments currently visible on the map and in the table.

**Segment thumbnails on hover** — hovering over a segment dot on the map shows a small thumbnail of its street-level image, along with the project name, segment number, and the value of your currently selected focus attribute (if any). This lets you preview a segment before clicking into it. This hover thumbnail is only available on the Path Analysis map, not on the Coding page map.

#### 3.3.1 Attribute Filters and Finer Filtering

When you select an attribute for analysis, you can filter segments by its coded values. Attributes marked **❖** also support **finer filtering** — selecting a specific value (e.g. *Present* for Fixed Obstacle on Facility) reveals a secondary sub-category dropdown so you can pinpoint exact sub-types. The map updates to show distinct colours for each sub-category once a sub-type is selected.

| Attribute | Filter Values | Finer Filter Sub-categories (❖ = available) |
|---|---|---|
| Overall Risk Level | 1 (Low); 2 (Medium); 3 (High); 4 (Extreme) | — |
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
| Delineation **❖** | Present; Not Present | When "Present": Cycling Path; Red Strip; Signalised Crossing; Traffic Crossing; Zebra Crossing <br> When "Not Present": Faded Marking |
| Fixed Obstacle on Facility **❖** | Present; Not Present | When "Present": Lamp Post; Traffic Light; Covered Linkway Pole; Bollards; Railing; Sign Pole; Billboards, Vegetation; Others (any obstacle not matching a preset type is standardised to *Others*) |
| Non-Fixed Obstacle on Facility **❖** | Present; Not Present | When "Present": Barrier; Bins; Bicycle; Cone; Others (any obstacle not matching a preset type is standardised to *Others*) |
| Light Segregation | Present; Not Present | — |
| Intersection or Road Crossing | Present; Not Present | — |
| Crossing Facility **❖** | Present; Not Present | When "Present": Zebra Crossing; Signalised PC; Bicycle Crossing; Unsignalised Junction; Development Access |
| Property Access | Present; Not Present | — |
| Tram or Train Rails | Present; Not Present | — |
| Major Surface Deformation or Drain Opening **❖** | Present; Not Present | When "Present": Footpath crack; Footpath uneven; Footpath Uneven IMU |
| Peak Pedestrian Flow | None; Low; Moderate to High | — |
| Peak Bicycle/LV Traffic Flow | Low; Moderate to High | — |
| Observed Proportion of Cargo Bikes | Low; Moderate to High | — |
| Heavy Vehicle Flow | Low; Moderate to High | — |
| Bicycle/LV Speed – Average | < 20 km/h; ≥ 20 km/h | — |
| Road Speed Limit | NA; 30 km/h; 40 km/h; 50 km/h; 60 km/h; 70 km/h; 80 km/h; 90 km/h | — |
| Delineation | Not Present | Faded Marking |
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

### 3.5 Session Continuity

Your selections and filters are kept for the browser session, so navigating away (e.g. to edit a segment in Coding) and returning does not immediately clear the analysis setup.

#### Filtered Segments from Path Analysis

If you click a segment on the Path Analysis map to open it in the Coding page, the coding page map will show **only the segments that were visible in your active filter — with the same colours** (risk band or finer-filter sub-category colours) carried over from Path Analysis. The currently selected segment is always shown regardless of the filter. This lets you review and correct mis-coded segments by clicking straight through the coloured points on the Coding page map, without needing to keep navigating back and forth to Path Analysis to re-check which segments are affected.

Click **Back to Analysis** in the sidebar to return to Path Analysis with your filters intact. Secondary attribute (finer filter) colours on the map are **automatically refreshed** when you return — changes you made to obstacle types or other sub-category attributes in the Coding page will be reflected immediately without needing to re-apply the filter.

#### Mark Verified

When you open the Coding page from a Path Analysis filter, a **Mark Verified** button is available. Clicking it toggles the current segment between "Mark Verified" and "✓ Verified" (shown with a green fill). Verified segments are highlighted on the map with a green halo around their point, and their tooltip shows "✓ Verified" — making it easy to track which segments in your filtered set you've already reviewed while working through the list.

> **Mark Verified is not permanently saved.** This status is held in memory only for your current session — it is **not** written to the project or database, and resets if you leave and re-enter the Coding page or reload the browser. Treat it as a temporary checklist while reviewing a batch of segments in one sitting, not as a permanent record.
