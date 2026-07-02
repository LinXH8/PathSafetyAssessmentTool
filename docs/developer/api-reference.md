# 4. API Reference

All endpoints are prefixed with `/api/`.

- **Direct backend:** `http://localhost:8000/api`
- **Through frontend:** `http://localhost/api`

---

## Table of Contents

- [4.1 Health Endpoints](#4-1-health-endpoints)
- [4.2 Project Endpoints](#4-2-project-endpoints)
  - [4.21 Project Listing & Metadata](#4-21-project-listing-metadata)
  - [4.22 Project Data](#4-22-project-data)
  - [4.23 Project Creation & Road Selection](#4-23-project-creation-road-selection)
- [4.3 Coding & Autocode Endpoints](#4-3-coding-autocode-endpoints)
  - [4.31 Autocode](#4-31-autocode)
  - [4.32 Baseline & Validation](#4-32-baseline-validation)
  - [4.33 Visualisation & GIS Context](#4-33-visualisation-gis-context)
- [4.4 Segment Management & Exports](#4-4-segment-management-exports)
- [4.5 Treatment Endpoints](#4-5-treatment-endpoints)
- [4.6 Shapefile Management Endpoints](#4-6-shapefile-management-endpoints)
- [4.7 User Profile Endpoints](#4-7-user-profile-endpoints)
- [4.8 Admin & Telemetry Endpoints](#4-8-admin--telemetry-endpoints)
- [4.9 Report Builder Endpoints](#4-9-report-builder-endpoints)
- [4.10 Defects Summary Endpoints](#4-10-defects-summary-endpoints)
- [4.11 Common Status Codes](#4-11-common-status-codes)

## 4.1 Health Endpoints

| Method | Endpoint | Response |
|---|---|---|
| `GET` | `/api/ping` | `{ "status": "ok" }` |
| `GET` | `/api/health` | `{ "status": "ok" }` |

---

## 4.2 Project Endpoints

### 4.21 Project Listing & Metadata

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/projects` | List all projects |
| `GET` | `/api/projects/<name>` | Get project versions |
| `GET` | `/api/projects/<name>/metadata` | Get detailed project metadata |
| `PATCH` | `/api/projects/<name>` | Update name, tags, verified status |
| `DELETE` | `/api/projects/<name>` | Delete entire project |

Project list responses include: `dataset`, `source_folders`, `verified_segment_count`, `autocoded_segment_count`, `total_segments`.

### 4.22 Project Data

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/projects/<name>/versions/latest/attributes` | Latest attribute rows (with score bands if available) |
| `PUT` | `/api/projects/<name>/attributes` | Save attributes and recalculate scores |
| `GET` | `/api/projects/<name>/geodata` | Project geometry as GeoJSON FeatureCollection |
| `GET` | `/api/projects/<name>/results` | Saved results rows (BB, BP, SB, VB, bands) |
| `POST` | `/api/projects/<name>/score` | Run native CycleRAP scoring |
| `GET` | `/api/projects/<name>/images/<filename>` | Serve a project image |
| `GET` | `/api/projects/attribute-mappings` | Label mappings for discrete fields |

### 4.23 Project Creation & Road Selection

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/projects/folders` | List source folders under `in/` |
| `POST` | `/api/projects/folders` | Create a project (single or multi-folder) |
| `POST` | `/api/projects/folders/upload-images` | Upload images into a source folder |
| `GET` | `/api/projects/folders/preview` | Preview folder details before create |
| `GET` | `/api/projects/folders/image` | Get first image thumbnail from folder |
| `GET` | `/api/projects/folders/suggestions` | Get name suggestions for project |
| `POST` | `/api/projects/folders/pick-local` | Select local directory directly |
| `POST` | `/api/projects/folders/copy-local` | Copy local directory files to `in/` |
| `POST` | `/api/projects/roads-in-polygon` | Roads intersecting a drawn polygon |
| `GET` | `/api/projects/roads-in-bounds` | Road polylines for the current viewport |
| `GET` | `/api/projects/roads-by-name` | Find road coordinates by name |
| `GET` | `/api/projects/planning-areas-in-bounds` | Planning-area polygons for the viewport |

`POST /api/projects/folders` supports:
- Single folder: `{ "folder_name": "...", "project_name": "...", "tags": [] }`
- Multi-folder: `{ "folder_names": [...], "polygon": [...], "project_name": "...", "tags": [] }`

---

## 4.3 Coding & Autocode Endpoints

### 4.31 Autocode

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects/<name>/autocode/image` | CV auto-code for one image |
| `POST` | `/api/projects/<name>/autocode/gis` | GIS auto-code for one segment |
| `POST` | `/api/projects/<name>/autocode/all` | Bulk auto-code (single / all / selected rows) |
| `GET` | `/api/projects/<name>/autocode-metadata` | Read saved autocode provenance |
| `POST` | `/api/projects/<name>/autocode-metadata` | Write autocode provenance metadata |

### 4.32 Baseline & Validation

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/projects/<name>/baseline/exists` | Check if baseline exists |
| `GET` | `/api/projects/<name>/baseline` | Get baseline attribute rows |
| `POST` | `/api/projects/<name>/baseline` | Save a baseline |

### 4.33 Visualisation & GIS Context

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects/<name>/curvature/visualize` | Curvature geometry and radius context |
| `POST` | `/api/projects/<name>/width/visualize` | Width search rings and path candidates |
| `POST` | `/api/projects/<name>/gis/layers` | Nearby GIS features for coding map overlay |
| `POST` | `/api/projects/<name>/gis/detect` | Diagnostic GIS feature inspection |

---

## 4.4 Segment Management & Exports

| Method | Endpoint | Description |
|---|---|---|
| `DELETE` | `/api/projects/<name>/segments/<index>` | Delete a single segment |
| `POST` | `/api/projects/<name>/segments/delete-batch` | Delete multiple segments |
| `POST` | `/api/projects/check-collisions` | Check image collisions before copy |
| `POST` | `/api/projects/copy-segments` | Copy segments into another project |
| `POST` | `/api/projects/download-images` | ZIP download of filtered images |
| `POST` | `/api/projects/export-shapefile` | Generate ZIP shapefile download |
| `GET` | `/api/projects/custom-attribute-options` | Fetch custom defined enums |
| `PUT` | `/api/projects/custom-attribute-options` | Save/modify custom enums |

---

## 4.5 Treatment Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects/<name>/treatments/preview` | Preview treatments without saving |
| `POST` | `/api/projects/<name>/treatments/apply` | Apply treatments to one segment |
| `GET` | `/api/projects/<name>/treatments/segment/<index>` | Treatment state for one segment |
| `GET` | `/api/projects/<name>/treatments/all` | All stored treatment states |
| `POST` | `/api/projects/<name>/treatments/apply-all` | Apply all applicable treatments |
| `POST` | `/api/projects/<name>/treatments/apply-specific` | Apply one treatment across all segments |
| `POST` | `/api/projects/<name>/treatments/reset-all` | Clear pending treatment state |
| `POST` | `/api/projects/<name>/treatments/save` | Persist pending treatment edits |
| `POST` | `/api/projects/<name>/treatments/effectiveness` | Rank treatments by risk band improvement |
| `GET` | `/api/projects/<name>/treatments/effectiveness/segment/<index>` | Per-treatment score drops for one segment |

---

## 4.6 Shapefile Management Endpoints

All under `/api/shapefiles/`:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/shapefiles` | List all shapefiles with metadata and required columns |
| `GET` | `/api/shapefiles/categories` | List category folders |
| `POST` | `/api/shapefiles/geojson` | Convert shapefile to WGS84 GeoJSON |
| `POST` | `/api/shapefiles/validate` | Validate uploaded ZIP before import |
| `POST` | `/api/shapefiles/preview-upload` | Temporary GeoJSON preview without saving |
| `POST` | `/api/shapefiles/upload` | Upload new shapefile assets into a category |
| `POST` | `/api/shapefiles/validate-replacement` | Check column compatibility of replacement |
| `PUT` | `/api/shapefiles/replace` | Overwrite existing shapefile (creates `.bak` backup) |
| `DELETE` | `/api/shapefiles/<path>` | Delete shapefile and companion files |
| `POST` | `/api/shapefiles/rename` | Rename shapefile + companion files |
| `POST` | `/api/shapefiles/revert` | Revert renamed shapefile back to original stem |

---

## 4.7 User Profile Endpoints

All under `/api/profiles`:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/profiles` | List all profiles (overview of names, divisions, and legacy projects) |
| `POST` | `/api/profiles` | Create a new profile (name, division, PIN) |
| `POST` | `/api/profiles/login` | Login to profile (profile ID, PIN) |
| `POST` | `/api/profiles/logout` | Logout of active profile |
| `POST` | `/api/profiles/activity` | Record profile telemetry client event (e.g. `page_view`) |
| `PATCH` | `/api/profiles/<profile_id>` | Update profile metadata (requires current PIN) |
| `POST` | `/api/profiles/<profile_id>/reset-pin` | Reset profile PIN (requires current PIN and new PIN) |
| `POST` | `/api/profiles/migrate-legacy-projects` | Move unassigned projects from `data/` to profile |

---

## 4.8 Admin & Telemetry Endpoints

All under `/api/admin`:

| Method | Endpoint | Description |
|---|---|---|



---

## 4.9 Report Builder Endpoints

All under `/api/report`:

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/report/generate-pptx` | Export PowerPoint (.pptx) summary slides |
| `POST` | `/api/report/generate-docx` | Export fully detailed Word document (.docx) based on layout canvas |
| `POST` | `/api/report/segment-details` | Fetch images and top 3 risk factors for listed segment references |

---

## 4.10 Defects Summary Endpoints

All under `/api/defects`:

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/defects/nearby` | Query Daily Defect summaries within search radius around point |

---

## 4.11 Common Status Codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `400` | Bad request (missing field, invalid polygon, underscore in project name) |
| `404` | Project, folder, image, or shapefile not found |
| `409` | Conflict — project already exists |
| `500` | Unexpected backend error |
| `503` | Service unavailable — CV models missing or failed to load |

*Layman's explanation: These numbers are like secret codes the computer uses to tell the website if a request was successful or if something went wrong.*
