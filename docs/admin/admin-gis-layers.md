# 3. Managing GIS Data Layers

GIS shapefiles power the spatial auto-coding rules in PSAT (bus stops, MRT exits, road crossings, area types, etc.). This section covers where they are stored and how to update them.

---

## Table of Contents

- [3.1 Storage Location](#31-storage-location)
- [3.2 Updating via the UI](#32-updating-via-the-ui)
- [3.3 Replacement Safety Checks](#33-replacement-safety-checks)
- [3.4 Column Mapping Requirements](#34-column-mapping-requirements)

---

### 3.1 Storage Location

All CycleRAP contextual GIS infrastructure shapefiles are stored under:

```
backend/shapefiles/
```

Each layer lives in its own subfolder (e.g. `bus_stop/BusStop.shp`, `Mrt_exit/MRT_EXITS.shp`). Each shapefile must be accompanied by its companion files (`.shx`, `.dbf`, `.prj`).

### 3.2 Updating via the UI

Administrators can add or replace layers without touching the filesystem directly:

1. Log in to PSAT and navigate to the **Projects** page.
2. Click **View GIS Layers** in the sidebar.
3. To add a new layer, click **Add Layer** and upload the shapefile package (zip or individual files).
4. To replace an existing layer, find it in the list, click **Replace**, and upload the new file.

The UI handles file validation and ensures all mandatory companion files (`.shx`, `.dbf`, etc.) are present before accepting the upload.

### 3.3 Replacement Safety Checks

The **Replace GIS Layer** workflow includes:

- A **search filter** for quick navigation when many layers are listed.
- A **compatibility check** that verifies the new file's column structure matches the existing layer definition before the replacement is finalised.

If the column check fails, the upload is rejected and the existing layer is left untouched.

### 3.4 Column Mapping Requirements

Each layer has required column indices documented in the [GIS Layers dashboard](#32-updating-via-the-ui). For example:

| Layer | Required column | Index |
|---|---|---|
| Area type (LU_DESC) | `LU_DESC` | 1 |
| Bus stop | `BUS_STOP_N` | varies |

Always cross-check against the layer definition shown in the GIS Layers dashboard before uploading a replacement file. Mismatched columns will cause auto-code to produce incorrect results for attributes derived from that layer.

> For full GIS layer management instructions available to users, see [User Guide → 8. GIS Layer Management](../user/user-gis-management.md). For scoring algorithm updates, see the [Developer Guide → 6.8 Updating the CycleRAP Algorithm](../developer/scoring.md).
