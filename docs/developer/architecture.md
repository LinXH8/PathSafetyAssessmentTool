# 3. Architecture Overview

PSAT is a two-container application orchestrated by Docker Compose. The frontend is a React SPA served by nginx, and the backend is a Flask API that owns project storage, GIS lookups, CV inference, scoring, and treatment logic. There is no database; the file system under `data/`, `in/`, and `backend/shapefiles/` is the source of truth.

---

## Table of Contents

- [3.1 System Diagram](#3-1-system-diagram)
- [3.2 High-Level Flow](#3-2-high-level-flow)
- [3.3 Key Ideas](#3-3-key-ideas)
- [3.4 Backend Structure](#3-4-backend-structure)
  - [3.41 Registered Blueprints](#3-41-registered-blueprints)
  - [3.42 Lazy Initialization](#3-42-lazy-initialization)
  - [3.43 GIS Caches and Helper Assets](#3-43-gis-caches-and-helper-assets)
- [3.5 Frontend Structure](#3-5-frontend-structure)
- [3.6 Project Storage Model](#3-6-project-storage-model)
  - [3.61 `project_metadata.json`](#3-61-project-metadata-json)
  - [3.62 Snapshot Behavior](#3-62-snapshot-behavior)
  - [3.63 Sidecar Directories](#3-63-sidecar-directories)
- [3.7 Project Creation Pipeline](#3-7-project-creation-pipeline)
- [3.8 Multi-Project Aggregation Pattern](#3-8-multi-project-aggregation-pattern)
- [3.9 Shapefile Management Architecture](#3-9-shapefile-management-architecture)
- [3.10 Key Design Choices](#3-10-key-design-choices)
  - [3.101 API-Only Frontend Communication](#3-101-api-only-frontend-communication)
  - [3.102 Native Scoring Path](#3-102-native-scoring-path)
  - [3.103 CRS Handling](#3-103-crs-handling)
  - [3.104 Thread Safety](#3-104-thread-safety)
- [3.11 GIS Layer Definition System](#3-11-gis-layer-definition-system)

## 3.1 System Diagram

```text
Browser
  |
  | HTTP :80
  v
+-----------------------+
| nginx / Vite frontend |
| - serves SPA          |
| - serves help docs    |
| - proxies /api/*      |
+-----------+-----------+
            |
            | HTTP :8000
            v
+-----------------------+
| Flask backend         |
| - projects API        |
| - shapefiles API      |
| - CV + GIS logic      |
| - scoring + treatments|
+-----+-----------+-----+
      |           |      |
      v           v      v
   ./data/      ./in/  backend/shapefiles/
```
*Layman's explanation: This diagram shows how the user's browser, the website interface, and the background system work together to manage project data.*

Docker bind-mounts `./data/` and `./in/`, so project data and source image folders survive rebuilds and restarts.

## 3.2 High-Level Flow

1. The user creates or selects a project in the frontend.
2. The frontend calls `/api/projects/*` and `/api/shapefiles/*` as needed.
3. The backend loads project metadata, geodata, snapshot CSVs, shapefiles, and models lazily.
4. Coding, analysis, and treatment flows mutate the latest snapshot and persist derived artifacts such as scores, baselines, and autocode metadata.
5. The frontend rehydrates the updated data through normal REST reads.

## 3.3 Key Ideas

- projects are stored on disk, not in a database
- the backend owns project metadata, snapshots, geodata, and image references
- the frontend reads and writes everything through REST endpoints
- the Help page reads mirrored markdown from `frontend/public/docs/`
- polygon-based project creation depends on both source folders in `in/` and GIS helper assets in `backend/shapefiles/`

## 3.4 Backend Structure

```text
backend/
├── app.py
├── app/
│   ├── __init__.py
│   ├── api/
│   │   ├── health.py               # /api/ping, /api/health
│   │   ├── gis_layers/routes.py    # /api/shapefiles/*
│   │   └── projects/routes.py      # /api/projects/*
│   ├── services/
│   │   ├── project_manager.py
│   │   ├── serializer.py
│   │   ├── prediction.py
│   │   ├── cyclerap_scoring.py
│   │   ├── cycleRAP_VA.py
│   │   ├── gis_mapping.py
│   │   └── global_var.py
│   └── utils/
│       └── path_width_curvature.py
├── generate_road_reference.py
├── models/
└── shapefiles/
```
*Layman's explanation: This is a directory map showing how the background system's files are organized to handle project logic and data.*

### 3.41 Registered Blueprints

- `health.py` exposes the liveness checks
- `projects/routes.py` owns project lifecycle, coding, scoring, treatment, baseline, and project-discovery endpoints
- `gis_layers/routes.py` exposes shapefile inventory, preview, upload, replace, and delete operations under `/api/shapefiles`

### 3.42 Lazy Initialization

`get_ctx()` in `projects/routes.py` lazily initializes and caches:

- `project_manager` over `data/`
- serializer / attribute-mapping data
- the legacy CycleRAP interface helpers where still needed

CV models are loaded separately by `_ensure_models_ready()`. Initialization failures are memoized so repeated requests fail fast with HTTP 503 rather than repeatedly blocking on model load.

### 3.43 GIS Caches and Helper Assets

The backend also caches GIS layers and project-level gradient/profile lookups. One new helper asset is:

- `backend/shapefiles/road_reference.csv` — sampled EXIF points per road folder, used by the polygon road-selection flow

That CSV is optional, but when present it lets the create-project map show which intersecting roads actually have local image folders.

## 3.5 Frontend Structure

```text
frontend/
├── public/
│   ├── README.md
│   └── docs/
├── src/
│   ├── api/index.ts
│   ├── App.tsx
│   ├── layouts/AppLayout.tsx
│   ├── pages/
│   │   ├── CreateProjectPage/
│   │   ├── CodingPage/
│   │   ├── GisLayersPage/
│   │   ├── HelpPage/
│   │   ├── PathAnalysisPage/
│   │   ├── Projects/
│   │   └── TreatmentPage/
│   ├── components/
│   └── utils/projectSearch.ts
```
*Layman's explanation: This is a directory map showing how the website's interface files are organized for building the user interface.*


Two frontend details are easy to miss but now matter architecturally:

- `frontend/public/docs/` contains the markdown actually served in the Help page
- `utils/projectSearch.ts` centralizes the project-or-road fuzzy matching used across multiple pages

## 3.6 Project Storage Model

Each project lives under `data/<ProjectName>/`.

```text
data/
└── ProjectName/
    ├── project_metadata.json
    ├── geo_data.gpkg
    ├── images/
    ├── autocode/
    │   └── ProjectName_metadata.json
    ├── baseline/
    │   └── ProjectName_baseline.csv
    └── versions/
        └── YYYYMMDD/
            ├── snapshot_metadata.csv
            ├── attributes.csv
            ├── results.csv
            └── treatment.csv
```
*Layman's explanation: This shows how a project's data, such as photos, results, and settings, is neatly filed away in folders on the system.*

### 3.61 `project_metadata.json`

The metadata model now carries more than name and tags. Relevant fields include:

- `project_name`
- `dataset`
- `source_folders`
- `tags`
- `path_key`
- `verified`
- `verified_segment_count`
- `autocoded_segment_count`
- `date_created`
- `last_updated`

`dataset` is a single source-folder name for legacy / single-folder projects, or `MULTI_FOLDER_SELECTION` for projects created from multiple folders. `source_folders` is the durable provenance field used by fuzzy search and by newer UI flows.

### 3.62 Snapshot Behavior

Version folders are date-based (`YYYYMMDD`). Multiple saves on the same day update the same dated snapshot rather than creating many sub-daily versions.

### 3.63 Sidecar Directories

Two newer sidecar directories support analysis workflows:

- `baseline/` stores the attribute baseline used by autocode validation comparisons
- `autocode/` stores changed-field and field-source metadata for the coding UI

## 3.7 Project Creation Pipeline

Project creation still starts from geotagged source images in `in/`, but it now supports both single-folder and multi-folder/polygon flows.

Backend steps:

1. enumerate one or more source folders
2. extract EXIF GPS data from images
3. optionally filter nodes by a selection polygon
4. geocode and sample points at the project-creation stage
5. convert sampled points to LineStrings
6. copy images into the project image store
7. create metadata, geodata, and the initial dated snapshot

When multiple source folders are merged, copied image names are namespaced so duplicate filenames do not collide.

## 3.8 Multi-Project Aggregation Pattern

Several frontend pages load multiple projects into one combined view. The usual pattern is:

- concatenate attributes, results, and geodata into global arrays
- keep a `projectMap` of project name, start index, and count
- resolve UI actions back to `{ projectName, localIndex }` when saving, deleting, or treating a row

This pattern is especially important in coding, treatment, and path-analysis views.

## 3.9 Shapefile Management Architecture

The GIS Layers page is backed by the `gis_layers` blueprint. That blueprint:

- scans `backend/shapefiles/`
- groups layers by category (subdirectory)
- can return a selected shapefile as WGS84 GeoJSON
- validates uploaded ZIPs and replacement files
- supports upload, preview, replace, and delete operations

This means the same layer inventory drives both the GIS Layers admin page and the backend GIS mapping logic used during coding.

## 3.10 Key Design Choices

### 3.101 API-Only Frontend Communication

The frontend never reads the filesystem directly. Every read/write goes through REST endpoints, which keeps all storage rules and migration logic on the backend.

### 3.102 Native Scoring Path

The current score endpoint uses `calculate_cyclerap_score_native()` instead of Excel COM. Legacy Excel helpers still exist, but native Python scoring is the main path.

### 3.103 CRS Handling

Source image GPS is read in WGS84 (`EPSG:4326`). Stored project geodata is written in Singapore SVY21 (`EPSG:3414`) so geometric distance and width/curvature operations behave sensibly.

### 3.104 Thread Safety

Model loading is protected by a lock and cached error state, which avoids repeated slow failures under concurrent requests.

## 3.11 GIS Layer Definition System

The application maintains a strict schema for GIS layers to ensure compatibility with auto-coding rules.

- **Location**: `backend/app/services/gis_layer_definition.py`
- **Structure**: Each layer defines its `layer_name`, `affects_psat_attribute`, and `required_columns`.
- **Mapping Indices**: Required columns now include 1-based indices (e.g., `LU_DESC (1)`) which are used by both the backend for validation and the frontend for user guidance.