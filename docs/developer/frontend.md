# 7. Frontend

The PSAT frontend is a React + TypeScript SPA built with Vite and served by nginx. It talks to the Flask backend only through `/api/*` requests.

**UI library:** Chakra UI v3  
**Routing:** React Router v6  
**Maps:** Leaflet via react-leaflet  
**Docs renderer:** React Markdown + mirrored files in `frontend/public/docs`

---

## Table of Contents

- [7.1 Route map](#71-route-map)
- [7.2 Page behavior](#72-page-behavior)
  - [7.21 Landing page](#721-landing-page)
  - [7.22 Help page](#722-help-page)
  - [7.23 Projects page](#723-projects-page)
  - [7.24 Create Project page](#724-create-project-page)
  - [7.25 Coding page](#725-coding-page)
  - [7.26 Path Analysis page](#726-path-analysis-page)
  - [7.27 Treatment pages](#727-treatment-pages)
  - [7.28 GIS Layers page](#728-gis-layers-page)
- [7.3 API client highlights](#73-api-client-highlights)
- [7.4 Visual analysis components](#74-visual-analysis-components)
- [7.5 State management](#75-state-management)
- [7.6 nginx behavior](#76-nginx-behavior)
- [7.7 Supporting implementation details](#77-supporting-implementation-details)

---

| URL pattern | Component | Purpose |
|---|---|---|
| `/` | `LandingPage` | Entry screen |
| `/help` | `HelpPage` | In-app user and developer guide |
| `/home` | `Projects` | Project listing and management |
| `/coding/:projectNames` | `CodingPage` | Main coding workspace for one or more projects |
| `/treatment` | `TreatmentPage` | Project picker for treatment workflows |
| `/treatment/:projectName` | `TreatmentDetailPage` | Treatment detail for one or more selected projects |
| `/analysis/path` | `PathAnalysisPage` | Multi-project analysis and export workspace |
| `/projects/create` | `CreateProjectPage` | Project creation wizard |
| `/gis-layers` | `GisLayersPage` | GIS layer browser and management page |
| `*` | `Navigate -> /home` | Catch-all redirect |

`HelpButton` is rendered globally, so the help entry point is available from anywhere in the app.

---

## 7.2 Page behavior

### 7.21 Landing page

`LandingPage` is a lightweight entry screen with no backend dependency beyond navigation.

### 7.22 Help page

`HelpPage` renders three doc collections in switchable tabs:

- **User Guide** — the `user-*.md` files under `frontend/public/docs/user/`
- **Developer Guide** — the developer-focused markdown files under `frontend/public/docs/developer/`, plus the root `README.md`
- **Admin Guide** — the `admin-*.md` files under `frontend/public/docs/admin/`

Each tab renders through a dedicated React component (`UserGuide.tsx`, `DeveloperGuide.tsx`, `AdminGuide.tsx`) that fetches and displays the appropriate markdown files.

> Documentation changes must be mirrored into `frontend/public/docs/`, not just `docs/`. The Help page reads only the files under `frontend/public/docs/`.

### 7.23 Projects page

> **Recent Addition:** Fuzzy project search that also matches source road names.

`Projects` is the operational home screen.

Current behavior:

- loads `GET /api/projects`
- supports fuzzy search by **project or road**, not just exact project name
- filters by one or more tags
- sorts by verification %, distance verified, autocode %, and last modified time
- shows live verification/autocode counters pushed back from the coding page
- supports multi-select navigation into coding, path analysis, or treatment workflows
- supports rename/tag edits via `EditProjectModal`
- deletes entire projects with confirmation

The fuzzy search logic lives in `src/utils/projectSearch.ts` and matches against:

- project name
- `dataset`
- tags
- `source_folders`

### 7.24 Create Project page

> **Recent Addition:** Multi-road project creation from a drawn polygon or selected planning area.

`CreateProjectPage` now supports two creation modes:

1. **Single-folder creation** using a source folder from `in/`
2. **Polygon-based multi-road creation** using the embedded `SelectRoadsMap`

The map workflow adds several behaviors that were not in the earlier implementation:

- draw a polygon manually
- show road overlays for the current viewport
- show planning-area overlays and click one to seed the selection polygon
- query intersecting roads with `POST /api/projects/roads-in-polygon`
- warn when selected roads do not exist locally in `in/`
- pass `folder_names` and an optional `polygon` to project creation

If multiple source folders are selected, the backend namespaces copied image filenames to avoid collisions and stores the original list in `source_folders`.

### 7.25 Coding page

`CodingPage` is the primary work area and supports one or more projects in a single session through the comma-separated `:projectNames` route param.

Key UI slices:

- image viewer
- attributes table
- GeoDataPanel map
- live score card
- curvature visualization
- width visualization
- autocode validation panel

Key current behaviors:

- loads project detail, metadata, attributes, geodata, results, baseline rows, and autocode metadata
- allows CV-only, GIS-only, single-segment, selected-segment, or full-project bulk autocode
- persists changed-field provenance through `/autocode-metadata`
- compares current attributes to a saved baseline for validation stats
- updates `verified_segment_count` and `autocoded_segment_count` back into project metadata
- can request nearby GIS context layers on the map through `/api/projects/<name>/gis/layers`

Multi-project coding/treatment views aggregate segment arrays and keep a project index map in the page state so UI actions can still resolve back to the owning project and local row.

### 7.26 Path Analysis page

`PathAnalysisPage` is now a full **multi-project analysis workspace**, not just an autocode review screen.

It currently supports:

- searching projects by project name or source-road name
- tag and date-range filtering before loading projects
- multi-select loading of projects into one analysis session
- selecting up to five attributes for analysis
- an aggregated score-band panel
- attribute distribution charts
- a synchronized map/table analysis surface
- export of the filtered table as CSV
- download of filtered images as a ZIP

The page also stores filter and selection state in `sessionStorage`, so analysts can navigate away and return without losing the active analysis setup.

### 7.27 Treatment pages

> **Recent Addition:** Treatment-effectiveness ranking for both project-wide and per-segment views.

`TreatmentPage` is the picker / filter view. It mirrors the project-or-road search behavior introduced on the Projects page.

`TreatmentDetailPage` is where treatment work happens. Current capabilities include:

- loading one or more selected projects into a combined treatment session
- viewing treatments **By Segment** or **By Treatment**
- ranking treatments using backend effectiveness endpoints
- previewing treatment effects before save
- applying a treatment to one segment, all applicable segments, or one specific treatment across the loaded set
- saving or resetting pending treatment state

### 7.28 GIS Layers page

> **Recent Addition:** Dedicated GIS Layers page with upload, preview, replace, and delete flows.

`GisLayersPage` exposes the shapefile inventory that powers GIS-assisted coding.

It currently supports:

- listing available shapefiles and categories
- previewing a selected layer as GeoJSON on a Leaflet map
- opening `ShapefileModal` to upload, validate, replace, or delete layers
- surfacing metadata such as source, year, category, and file size

---

## 7.3 API client highlights

All client-side fetch wrappers live in `src/api/index.ts`.

Notable newer exports include:

- `queryRoadsInPolygon()`
- `queryRoadsInBounds()`
- `queryPlanningAreasInBounds()`
- `getAllTreatments()`
- `getTreatmentEffectiveness()`
- `getTreatmentSegmentEffectiveness()`
- shapefile-management helpers such as `listShapefiles()`, `uploadShapefiles()`, and `replaceShapefiles()`

---

## 7.4 Visual analysis components

### 7.41 CurvatureVisualizationPanel

Calls `POST /api/projects/<name>/curvature/visualize` and renders the local path geometry, 5 m analysis window, derived radius, and curvature classification.

### 7.42 WidthVisualizationPanel

Calls `POST /api/projects/<name>/width/visualize` and renders the expanding search rings, candidate paths, and derived width category.

### 7.43 GeoDataPanel GIS overlays

When a single project is active, the coding map can request nearby GIS layers from `POST /api/projects/<name>/gis/layers` to show map context around the active segment.

---

## 7.5 State management

PSAT still relies on page-local React state rather than a global state library. The main shared patterns are:

- local `useState` / `useEffect` for page data
- memoized derived views with `useMemo`
- browser storage for selected Path Analysis filters
- custom browser events to push metadata changes back to listing pages

---

## 7.6 nginx behavior

The frontend container:

- serves the built SPA from `/usr/share/nginx/html`
- falls back to `index.html` for client-side routes
- proxies `/api/*` to `http://backend:8000/api/`

```nginx
location / {
    root /usr/share/nginx/html;
    try_files $uri /index.html;
}
location /api/ {
    proxy_pass http://backend:8000/api/;
}
```
*Layman's explanation: This configuration tells the system how to correctly route messages between the website interface and the background system.*

---

## 7.7 Supporting implementation details

- the Help page reads markdown from `frontend/public/docs/`
- shared fuzzy matching lives in `src/utils/projectSearch.ts`
- all backend calls are centralized in `src/api/index.ts`