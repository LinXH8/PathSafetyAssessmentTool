# 6. GIS Layer Management

PSAT uses external GIS shapefiles and GeoJSON layers to provide spatial context for path coding and risk analysis. Use the **GIS Layer Management** tool to keep these datasets up to date.

---

## Table of Contents

- [6.1 Viewing GIS Layers](#61-viewing-gis-layers)
- [6.2 All GIS Layers in PSAT](#62-all-gis-layers-in-psat)
- [6.3 Adding a New GIS Layer](#63-adding-a-new-gis-layer)
- [6.4 Replacing an Existing GIS Layer](#64-replacing-an-existing-gis-layer)
- [6.5 Updating GIS Layers](#65-updating-gis-layers)
- [6.6 Filtering Shapefiles](#66-filtering-shapefiles)
- [6.7 Renaming a Shapefile](#67-renaming-a-shapefile)
- [6.8 Reverting a Shapefile to Its Original Name](#68-reverting-a-shapefile-to-its-original-name)

---

## 6.1 Viewing GIS Layers

Click the **View GIS Layers** button in the sidebar to open the GIS Layers dashboard. Here you can:

- Browse all current GIS layers (sorted in alphabetical order)
- View last updated date, required columns, and metadata for each layer
- **Required Columns**: Inspect the mandatory column names needed for PSAT to process the layer. The number in parentheses, e.g., `LU_DESC (1)`, indicates the expected column index in the source data
- Preview any layer on an interactive map by clicking it
- **Filter** the list instantly by typing a keyword into the filter box (see [Section 6.6](#66-filtering-shapefiles))
- **Rename** any layer to a custom display name or **revert** it back to its original name (see [Sections 6.7](#67-renaming-a-shapefile) and [6.8](#68-reverting-a-shapefile-to-its-original-name))

## 6.2 All GIS Layers in PSAT

The table below lists every shapefile currently loaded in PSAT, the PSAT attribute it affects, and the required columns. Layer names match the display names shown on the GIS Layers page.

| Layer Name | Category | Geometry | PSAT Attribute Affected | Required Columns |
|---|---|---|---|---|
| `31Oct24 Link Ful` | LinkID_Shape_File | LineString | Road Operating Speed (mean) | `LK_ID_NUM (1)` |
| `31Oct24 Node Ful` | LinkID_Shape_File | Point | Road Network Node Reference | `NODE_ID_NU (1)`, `RD_TYP_CD (2)` |
| `Amgbeforecount Export` | AMGbeforeCount | Point | Peak Pedestrian Flow, Peak Bicycle Traffic Flow | `DataType (1)`, `DateTime (2)`, `Count_Data (3)` |
| `Amgsensorcount Export` | AMGsensorCount | Point | Peak Pedestrian Flow, Peak Bicycle Traffic Flow | `Pivot_user (1)`, `Datetime_p (2)`, `Count (3)` |
| `Bus Lanes` | bus_lane | LineString | Heavy Vehicle Flow; Extracted Type: A1, A6, A7, L, Q, Q1, Q2, Y | `TYP_CD (1)`, `TYP_NAM (2)` |
| `Busshelter` | bus_stop | LineString | Pedestrian Crossing, Peak Flow | `BUS_ROOF_N (1)`, `LOC_DESC (2)` |
| `Busstop` | bus_stop | Point | Pedestrian Crossing, Peak Flow | `BUS_STOP_N (1)`, `LOC_DESC (3)` |
| `Centralmb2025` | area_type | Polygon | Area Type (Urban) | `PARKING_ZO (1)`, `STATION_NA (2)` |
| `Cyclingpathcentreline` | path | LineString | Facility Width, Curvature | `WIDTH (1)` |
| `Cyclingpathgazette` | CyclingPath_Jul2024 | LineString | Planning Area Reference | `PLANNING_A (1)`, `PLANNING_1 (2)` |
| `Dgp 27Oct14` | Planning_area | Polygon | Area-based Reporting | `PLN_AREA_N (1)` |
| `Existing Cycling Paths` | CyclingPath_Jul2024 | LineString | Cycling Path Type Reference | `path_type (1)` |
| `Footpath` | FootPath_Mar2025 | LineString | Facility Width, Curvature | `WDT_CATG_C (1)`, `TYP_CD (2)` |
| `Footpathcentreline` | path | LineString | Facility Width, Curvature | `WIDTH (1)` |
| `Hdb Car Park Lots` | parking_lot | Point / Polygon | Adjacent Vehicle Parking | `CARPARKNO (1)`, `NOOFCARLOT (2)` |
| `Kerbline` | kerb_line | LineString | Number of Lanes – Adjacent Road | `LANES (1)`, `LOCATION (2)`, `DIRECTION (3)` |
| `Landuseindustrial2025` | area_type | Polygon | Area Type (Urban, Industrial, Rural, Recreational) | `LU_DESC (1)`, `LU_TEXT (3)` |
| `Landuserecre2026` | LanduseRecre2026 | Polygon | Area Type (Recreational) | `LU_DESC (1)`, `LU_TEXT (3)` |
| `Landuserural2025` | area_type | Polygon | Area Type (Urban, Industrial, Rural, Recreational) | `LU_DESC (1)`, `LU_TEXT (3)` |
| `Landuserural2026` | LanduseRural2026 | Polygon | Area Type (Rural) | `LU_DESC (1)`, `LU_TEXT (3)` |
| `Mrt Exits` | Mrt_exit | Point | Pedestrian Crossing, Peak Flow | `STATION_NA (1)`, `EXIT_CODE (2)` |
| `Roadattributeline Speedlimits` | Speed_limit | LineString | Road Speed Limit | `SPEEDLIMIT (1)` |
| `Roadcrossing` | roadcrossinglayer | LineString / Point | Pedestrian Crossing | `UNIQUE_ID (1)` |
| `Roadnetworkline` | Road_name | LineString | Road Name Reference | `RD_CD_DESC (1)` |
| `Sharedpathcentreline` | path | LineString | Facility Width, Curvature | `WIDTH (1)` |
| `Ura Parking Lot` | parking_lot | Polygon | Adjacent Vehicle Parking | `PP_CODE (1)`, `LOT_NO (2)`, `TYPE (3)` |

> **Column index numbers** in parentheses indicate the column position (1-based) expected in the source shapefile. These are used during validation when uploading replacement layers.

## 6.3 Adding a New GIS Layer

Use the **Add GIS Layer** workflow to upload entirely new datasets.

- **New Category**: You must provide a name for the category folder (e.g., `school_zones`). Every upload is assigned to a specific category.
- **File Upload**: Drag and drop your GIS files. For shapefiles, ensure you upload all companion files together (`.shp`, `.shx`, `.dbf`, `.prj`).
- **Preview**: Once uploaded, you can preview the geometry on the map before finalising.

### Before You Upload — Confirmation Prompt

Before the file is accepted, PSAT displays a **"Before You Upload"** confirmation dialog. You must confirm that your shapefile meets **all** of the following requirements:

| Requirement | Description |
|---|---|
| **Exact file name** | The file name must exactly match what the system expects. |
| **Exact columns and numbers** | The shapefile must contain the correct number of columns, with no extras or omissions. |
| **Exact attribute names** | Every column/attribute name must match exactly, including capitalisation. |
| **Exact sequence** | The columns must appear in exactly the same order as specified. |

> **Warning:** Uploading an incompatible shapefile may cause system errors or incorrect data rendering.

If you are unsure of the expected format, refer to the existing shapefiles in the GIS Layers list as a reference before uploading.

Click **Confirm & Upload** to proceed, or **Cancel** to go back and check your file.

## 6.4 Replacing an Existing GIS Layer

Use the **Replace GIS Layer** workflow when you have updated data for an existing layer.

- **Filterable Search**: Use the searchable inputs to quickly find the folder and specific layer you wish to replace. Type a few letters (e.g., `bus`) to filter the list.
- **Safety Checks**: PSAT performs compatibility checks to ensure the new file has the same required columns as the original.
- **Warnings**: If differences are found in the column structure, the system will warn you before overwriting the old data.

## 6.5 Updating GIS Layers

GIS layers should be updated whenever:

- A new version of a dataset is released (e.g., updated cycling path network)
- A new category of infrastructure needs to be tracked
- The existing layer has outdated or incorrect geometry

**Steps to update a layer:**

1. Obtain the new shapefile from the relevant data source (e.g., LTA, URA)
2. Verify the file has the **required columns** listed in the table above
3. Open **GIS Layers** from the sidebar
4. Use **Replace GIS Layer**, search for the existing layer, and upload the new file
5. Review the compatibility check results before confirming the replacement

> For system-level GIS management (file paths, permissions, bulk updates), refer to the **Admin Guide**.

## 6.6 Filtering Shapefiles

When your system has many GIS layers, scrolling through the full list can be slow. The **filter box** at the top of the Available Shapefiles panel lets you narrow the list instantly.

**How to use it:**

1. Open the **GIS Layers** page from the sidebar
2. Click the **Filter shapefiles…** input field beside the "Available Shapefiles" heading
3. Type any keyword — the list updates in real time to show only layers whose name contains your search term (the search is case-insensitive)
4. Clear the field to restore the full list

**Examples:**

| What you type | Layers shown |
|---|---|
| `bus` | bus_stop, bus_lane, bus_shelter … |
| `path` | cycling_path, shared_path, footpath, CyclingPath_Jul2024 … |
| `count` | AMGbeforeCount, AMGsensorCount … |

> If no layers match your search term, the panel displays a "No shapefiles match …" message.

## 6.7 Renaming a Shapefile

You can give any shapefile a custom display name to make it easier to identify within your team's workflow. The rename only affects how the layer appears in the PSAT dashboard — the underlying file on disk is not moved or changed.

**Steps:**

1. Open the **GIS Layers** page from the sidebar
2. Locate the shapefile you want to rename (use the filter box if needed)
3. Click the **Edit** button on the right side of the layer row
4. The layer name becomes an editable text field — type your new name
5. Press **Enter** or click the **save (✓)** button to confirm
6. Press **Escape** or click the **cancel (✕)** button to discard the change

> Renamed layers retain all their original metadata, required columns, geometry, and category. Only the display name is updated.

## 6.8 Reverting a Shapefile to Its Original Name

If a layer has been renamed and you want to restore its original filename as the display name, use the **Revert** option.

**Steps:**

1. Open the **GIS Layers** page from the sidebar
2. Locate the renamed shapefile (a **Revert** button will be visible next to **Edit**)
3. Click **Revert**
4. Confirm the action — the display name immediately reverts to the layer's original filename

> The **Revert** button only appears on layers that have been given a custom name. Layers still showing their original name will not have this option.
