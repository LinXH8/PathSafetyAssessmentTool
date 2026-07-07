# Path Safety Assessment Tool (PSAT)

> Developer & User Guide — May 2026

## 1.1 Overview

The **Path Safety Assessment Tool (PSAT)** is a web application for assessing cycling and active-mobility corridors using the **CycleRAP v2.11** methodology. It brings together image-based auto-coding, GIS spatial lookups, manual review, risk scoring, treatment testing, and multi-project analysis in one unified workflow.

PSAT is used to:

- ingest geotagged survey images and build segment-based projects
- auto-code CycleRAP attributes using CV models, GIS spatial rules, and gradient profiles
- review and correct coding in a synchronized image–table–map workspace
- calculate **BB**, **BP**, **SB**, and **VB** risk scores and overall risk bands per segment
- analyse one or more projects together with filters, charts, and CSV exports
- explore and rank safety treatments with before/after score comparisons
- manage the GIS layers that power spatial auto-coding rules

## 1.2 Documentation

Developer docs are canonical under `docs/developer/`; user and admin guides live under `docs/user/` and `docs/admin/`.

| Document | Contents |
|---|---|
| [Installation](docs/developer/installation.md) | Local setup, required assets, Docker and non-Docker run modes |
| [Architecture](docs/developer/architecture.md) | Two-container design, storage model, and key design decisions |
| [API Reference](docs/developer/api-reference.md) | All REST endpoints with payloads and response shapes |
| [CV / ML Pipeline](docs/developer/cv-pipeline.md) | Image ingestion, model loading, and auto-coding pipeline details |
| [Scoring Logic](docs/developer/scoring.md) | CycleRAP scoring inputs, risk-band thresholds, and treatment list |
| [Treatments](docs/developer/treatments.md) | Treatment definitions and effectiveness ranking |
| [Frontend](docs/developer/frontend.md) | Route map, page behaviour, and client-side data flow |
| [Common Issues](docs/developer/common-issues.md) | Setup, GIS, and project-creation troubleshooting |
| [Contributing](docs/developer/contributing.md) | Team conventions and contribution notes |

> The in-app **Help** page loads mirrored markdown from `frontend/public/docs/`. `docs/` is the canonical source; after editing it, regenerate the mirror with `npm run docs:sync` (from `frontend/`) or `bash scripts/sync_docs.sh` (from the repo root), and commit both together.

---

## 1.3 Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript, Chakra UI v3, React Router v6, Leaflet / react-leaflet |
| Backend | Python 3.11, Flask 3, Geopandas, Shapely, Fiona, PyProj |
| CV / ML | Ultralytics YOLO (`.pt` weight files), OpenCV, Pillow |
| Scoring | Pure-Python CycleRAP v2.11 (`cyclerap_scoring.py`) — no Excel or Windows COM required |
| Maps | Leaflet (frontend preview), Geopandas / STRtree (backend spatial queries) |
| Storage | File system — no database; projects stored under `data/`, images under `in/` |
| Runtime | Docker Compose (two containers: nginx + Flask/Gunicorn) |

---

## 1.4 Prerequisites

### 1.41 Required software

| Tool | Purpose |
|---|---|
| **Git** | Clone and update the repository |
| **Docker Desktop** | Standard local runtime (must be running before startup) |
| **Node.js 20** *(non-Docker only)* | Frontend dev server |
| **Python 3.11** *(non-Docker only)* | Backend without Docker |

### 1.42 Required external assets

Two asset folders must be placed in `backend/` before CV and GIS-assisted coding will work. They are not included in the repository and must be copied from the project SSD.

| Folder | Destination | Contents |
|---|---|---|
| `models/` | `backend/models/` | YOLO `.pt` weight files for CV auto-coding |
| `shapefiles/` | `backend/shapefiles/` | GIS layers used for spatial lookups and road selection |

If these folders are missing the app can still boot, but GIS and CV features will return errors at runtime.

#### Model files

| File | Role |
|---|---|
| `path_seg.pt` | Path segmentation (main entry model) |
| `off_road_bicycle_path.pt` | Off-road bicycle path classifier |
| `adj_road_lane.pt` | Adjacent road lane distance classifier |
| `LTA_FIXEDOBSTACLE_BEST_2.pt` | Fixed obstacle and delineation segmentation |
| `DevelopmentAccess_last_150epochs.pt` | Development / property access classifier |
| `LTA_Dill_4_Best.pt` | Delineation / road marking classifier |
| `RoadClassification_best.pt` | Road type classifier |

---

## 1.5 Getting started

### 1.51 Option A — Docker (recommended)

```bash
# 1. Clone
git clone https://github.com/LinXH8/PathSafetyAssessmentTool.git
cd PathSafetyAssessmentTool

# 2. Create the input folder before Docker does (avoids ownership issues on Windows)
mkdir in

# 3. Place backend/models/ and backend/shapefiles/ as described above

# 4. Build and start
docker compose up --build
```

Once the stack is healthy:

| Service | URL |
|---|---|
| Frontend | http://localhost |
| Backend API | http://localhost:8000/api |

Liveness check:

```bash
curl http://localhost:8000/api/ping
# → {"status":"ok"}
```

To stop:

```bash
docker compose down
```

To update:

```bash
git pull
docker compose up --build
```

Rebuilds do not erase `data/` or `in/`.

---

### 1.52 Option B — Windows one-click (`Run-PSAT.bat`)

Double-click **`Run-PSAT.bat`** from the repository root. The script:

1. Detects a conda `psat` environment or falls back to a `.venv` in `backend/`
2. Installs Python requirements (CPU PyTorch + `ultralytics` + `requirements.txt`)
3. Starts the Flask backend in a separate terminal window
4. Installs npm packages if `node_modules` is missing
5. Starts the Vite dev server and opens the browser

Once running:

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |

Log files written on failure:

- `backend/backend_pip_install.log`
- `backend/torch_install.log`
- `backend/ultralytics_install.log`

**Recommended Python setup for `Run-PSAT.bat`** (geospatial packages install more reliably through conda):

```bash
conda create -n psat python=3.11 -y
conda activate psat
conda install -c conda-forge gdal geopandas pyproj fiona rtree pyogrio -y
pip install -r backend/requirements.txt
```

---

### 1.53 Option C — Manual (backend + frontend separately)

Backend:

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Frontend (separate terminal):

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api/*` to `http://localhost:8000`.

> On Windows, `pywin32` is installed automatically from `requirements.txt`. On macOS/Linux it is skipped and the legacy Excel-COM scoring path is unavailable — the native Python scoring path is used instead.

---

## 1.6 First run

1. Open the **Projects** page at http://localhost (Docker) or http://localhost:5173 (non-Docker).
2. Click **Create Project**.
3. Choose a source folder from `in/`, or use the map to draw a polygon and select roads.
4. Confirm the project is created and the app navigates to the Coding page.

### 1.61 Preparing `in/`

Each subfolder under `in/` is one survey source. Images must contain GPS EXIF metadata.

```text
in/
├── ANG MO KIO AVENUE 1/
│   ├── Cam1_0001.jpg
│   └── ...
├── ANG MO KIO AVENUE 8/
│   └── ...
└── BISHAN STREET 11/
    └── ...
```

### 1.62 Optional: build the road reference CSV

After populating `in/`, run this once to improve polygon road-selection matching:

```bash
python scripts/generate_road_reference.py
```

This writes `backend/shapefiles/road_reference.csv`. (Dev utility scripts were consolidated under `scripts/` during the July 2026 refactor.)

---

## 1.7 Application pages

### 1.71 Projects (`/home`)

Lists all projects with fuzzy search across project name, road names, and tags. Supports multi-select to open projects in coding, path-analysis, or treatment workflows. Allows rename, re-tag, and delete.

### 1.72 Create Project (`/projects/create`)

Two creation modes:

- **Single folder** — pick one source folder from `in/`.
- **Polygon / multi-road** — draw a polygon on the map, select intersecting roads, and create from one or more source folders at once. The backend filters images to nodes inside the polygon and namespaces copied filenames to avoid collisions.

### 1.73 Coding (`/coding/:projectNames`)

The primary work area. Supports one or more comma-separated projects in a single session.

- Synchronized image viewer, attributes table, and Leaflet map
- Live risk score card per segment
- CV auto-code (image-based), GIS auto-code (spatial), or bulk autocode across all / selected segments
- Attribute-level autocode with per-field skip optimisation (e.g. requesting only "Curvature" skips the CV model entirely)
- Curvature and width visualization panels
- Autocode validation: compare current attributes to a saved baseline
- Autocode metadata provenance (which fields changed, CV vs GIS source)

### 1.74 Path Analysis (`/analysis/path`)

Multi-project analysis workspace. Select a subset of projects, filter by tag and date range, then:

- view aggregated score-band panels and attribute distribution charts
- explore a synchronized map/table surface
- export filtered rows as CSV or download filtered images as ZIP
- session state is persisted in `sessionStorage` so you can navigate away and return

### 1.75 Treatment (`/treatment` and `/treatment/:projectName`)

- **Treatment page** — picker with the same fuzzy project search as the Projects page
- **Treatment Detail page** — load one or more projects into a combined treatment session; view by segment or by treatment; rank treatments by effectiveness; preview and apply; save or reset pending changes

### 1.76 GIS Layers (`/gis-layers`)

Browse, preview, upload, replace, and delete the shapefiles that power GIS-assisted coding.

### 1.77 Help (`/help`)

In-app documentation viewer. Loads user and developer guides from `frontend/public/docs/`.

---

## 1.8 CV / ML pipeline summary

Auto-coding runs a pipeline of YOLO models against each segment image:

1. **Path segmentation** (`path_seg.pt`) — detects the path area and road area
2. **Off-road bicycle classifier** — identifies off-road bicycle paths
3. **Adjacent road lane classifier** — determines whether an adjacent road is 0–1 m or 1–3 m away
4. **Fixed obstacle segmentation** (`LTA_FIXEDOBSTACLE_BEST_2.pt`) — detects obstacles, bus stops, delineation markers; determines facility type
5. **Development access classifier** — detects driveway / property access
6. **Delineation classifier** (`LTA_Dill_4_Best.pt`) — detects road markings

Models are loaded lazily on the first CV request and cached; the first request will be slow. Subsequent requests are fast.

GIS auto-coding runs spatial queries against the shapefiles to set area type, facility width, road speed, pedestrian flow, and other GIS-derivable attributes.

See [CV / ML Pipeline](docs/cv-pipeline.md) for the full pipeline and confidence thresholds.

---

## 1.9 Scoring summary

PSAT implements CycleRAP v2.11 as a pure Python module (`cyclerap_scoring.py`). Four scores are produced per segment:

| Score | Crash scenario |
|---|---|
| **BB** | Bicyclist–Bicyclist |
| **BP** | Bicyclist–Pedestrian |
| **SB** | Single Bicyclist (departure / fall) |
| **VB** | Vehicle–Bicyclist |

Each score maps to a risk band (Low / Medium / High / Extreme). The **Overall Risk Level Band** is the maximum of the four component bands.

| Band | BB / BP / SB range | VB range |
|---|---|---|
| Low | < 5 | < 10 |
| Medium | 5–10 | 10–25 |
| High | 10–20 | 25–60 |
| Extreme | > 20 | > 60 |

25 predefined treatments can be previewed and applied. Treatments are ranked by the number of segments whose overall risk band improves when they are applied in isolation.

See [Scoring Logic](docs/scoring.md) for the full formula reference and treatment list.

---

## 1.10 Data persistence

Docker bind-mounts keep project data on the host:

| Host path | Container path | Contents |
|---|---|---|
| `./data/` | `/app/data` | Project metadata, geodata, snapshots, baselines, treatment state |
| `./in/` | `/app/in` | Source image folders |

`data/` and `in/` are **not** deleted by `docker compose down` or `docker compose up --build`.

Each project is stored as a directory under `data/`:

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

---

## 1.11 Repository layout

> The July 2026 structural refactor split the two largest backend files and the frontend
> API client / page monoliths into modules. `backend/app/api/projects/routes.py` is now a thin
> backwards-compatibility shim; the real handlers live in per-domain blueprint modules that all
> register on the same `projects` blueprint (URLs unchanged).

```text
PathSafetyAssessmentTool/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── health.py                # /api/ping and /api/health
│   │   │   ├── gis_layers/routes.py     # /api/shapefiles/* endpoints
│   │   │   ├── profiles/                # /api/profiles/* — user profiles & login
│   │   │   ├── report/                  # /api/report/* — report export endpoints
│   │   │   ├── defects/                 # /api/defects/* — daily-defect summaries
│   │   │   ├── admin/                   # /api/admin/* — telemetry & admin
│   │   │   └── projects/               # /api/projects/* — split into blueprint modules:
│   │   │       ├── routes.py            #   compat shim (re-exports get_ctx, warmup_gis, …)
│   │   │       ├── _helpers.py          #   get_ctx(), invalidate_ctx(), ok()/fail()
│   │   │       ├── crud.py              #   project list/metadata/create/delete
│   │   │       ├── segments.py          #   segment edit / delete / copy
│   │   │       ├── autocode.py          #   CV + GIS autocode + bulk autocode
│   │   │       ├── gis_queries.py       #   GIS context / curvature / width lookups
│   │   │       ├── treatments.py        #   treatment preview / apply / effectiveness
│   │   │       ├── images.py            #   image + post-treatment image serving
│   │   │       ├── source_folders.py    #   in/ folder listing, roads-in-polygon
│   │   │       ├── export.py            #   CSV / shapefile / ZIP exports
│   │   │       ├── baseline.py          #   autocode baseline save/compare
│   │   │       └── gradient.py          #   gradient-profile injection
│   │   ├── services/
│   │   │   ├── prediction.py            # CV inference and bulk autocode helpers
│   │   │   ├── cyclerap_scoring.py      # Native CycleRAP v2.11 scoring
│   │   │   ├── project_manager.py       # Project lifecycle (thin façade)
│   │   │   ├── project_version.py       # ProjectVersion snapshot data/serialization
│   │   │   ├── image_storage.py         # Image dedup / materialization
│   │   │   ├── serializer.py            # Metadata / CSV / GPKG serialization
│   │   │   ├── cycleRAP_VA.py           # GPS extraction and LineString generation
│   │   │   ├── gis_mapping.py           # GIS proximity/speed lookups (query_nearby)
│   │   │   ├── curvature_analyzer.py    # CurvatureAnalyzer (extracted from gis_mapping)
│   │   │   ├── width_analyzer.py        # WidthAnalyzer (extracted from gis_mapping)
│   │   │   └── profile_store.py         # Active-profile persistence
│   │   └── utils/
│   │       └── path_width_curvature.py
│   ├── app.py                           # Flask application entry point
│   ├── models/                          # External YOLO .pt weight files (not in repo)
│   ├── shapefiles/                      # External GIS layers (not in repo)
│   ├── ONBOARDING.md                    # Manual setup notes for geospatial packages
│   ├── PLATFORM_COMPATIBILITY.md        # Windows-only feature notes
│   └── requirements.txt
├── frontend/
│   ├── public/
│   │   ├── README.md                    # Help-page copy of this README
│   │   └── docs/                        # Mirrored markdown for the in-app Help page
│   └── src/
│       ├── api/                         # Typed fetch helpers, split by domain
│       │   ├── index.ts                 #   barrel — re-exports every domain module
│       │   ├── _client.ts               #   shared fetch/error helper
│       │   ├── projects.ts / geo.ts / attributes.ts (etc.)  # one file per domain
│       │   └── projectDataCache.ts      #   session read-cache for path-analysis/coding
│       ├── App.tsx                      # Router and route definitions
│       ├── layouts/AppLayout.tsx        # Shared shell and sidebar
│       ├── pages/                       # Each page: container + layouts/*ViewModel + *LayoutV1/V2
│       │   ├── CreateProjectPage/       # Single-folder and polygon-based creation
│       │   ├── CodingPage/              # Main coding workspace (hooks/ + components/)
│       │   ├── GisLayersPage/           # GIS layer browser and manager
│       │   ├── HelpPage/               # In-app documentation viewer
│       │   ├── PathAnalysisPage/        # Multi-project analysis workspace
│       │   ├── ReportBuilderPage/       # Report canvas + PDF/Word/PPTX export
│       │   ├── Projects/                # Project listing and management
│       │   └── TreatmentPage/           # Treatment overview and detail views
│       ├── hooks/
│       │   └── useSessionState.ts       # Typed sessionStorage hook (SESSION_KEYS)
│       ├── components/map/              # Shared DraggableMarker / PolygonDrawing
│       ├── constants/
│       │   ├── autocodeAttributes.ts    # Autocode field name aliases and groupings
│       │   └── sessionKeys.ts           # Central SESSION_KEYS registry
│       └── utils/
│           ├── projectSearch.ts         # Shared fuzzy project-or-road matcher
│           ├── riskColors.ts            # Shared risk-band colours / labels
│           └── projection.ts            # Shared to4326 / to3414 CRS helpers
├── docs/                                # Canonical documentation (developer/user/admin)
├── scripts/                             # Dev utilities (generate_road_reference.py, sync_docs.sh, …)
├── data/                                # Persisted project storage (created at runtime)
├── in/                                  # Source image folders (create before first run)
├── Run-PSAT.bat                         # Windows one-click startup script
├── run_psat.sh                          # Linux/macOS startup script
├── backend.Dockerfile
└── docker-compose.yml
```

---

## 1.12 Ports

| Service | Host port | Notes |
|---|---|---|
| Frontend | 80 | Docker; 5173 in dev mode |
| Backend | 8000 | Both Docker and dev mode |

If either port is already in use, change the mapping in `docker-compose.yml` or stop the conflicting service.

---

## 1.13 Contributing

- Keep changes focused on one behaviour or documentation topic at a time.
- Prefer fixes at the owning layer rather than UI-only workarounds.
- When updating `docs/`, also update the mirrored copies in `frontend/public/docs/`.
- Project names cannot contain underscores — use spaces, hyphens, or camel case.
- Do not hand-edit directories under `data/` unless the task explicitly requires it.

See [Contributing](docs/contributing.md) for validation expectations and working-style guidance.
