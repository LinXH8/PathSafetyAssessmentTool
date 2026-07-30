# Path Safety Assessment Tool (PSAT)

> Developer Guide | Updated May 2026

---

## Table of Contents

- [1.1 What PSAT Does](#11-what-psat-does)
- [1.2 Quick Start](#12-quick-start)
- [1.3 Repository Layout](#13-repository-layout)
- [1.4 Documentation Index](#14-documentation-index)

## 1.1 What PSAT Does

The **Path Safety Assessment Tool (PSAT)** is an internal web application for assessing cycling and active-mobility corridors using the **CycleRAP v2.11** methodology. It combines image-driven coding, GIS lookups, manual review, scoring, and treatment testing in one workflow.

PSAT is used to:

- turn geotagged survey images into segment-based project data
- auto-code attributes with CV models, GIS rules, and gradient profiles
- inspect and manage the GIS layers that power the coding rules
- review and correct coding in a synchronised image-table-map workspace
- calculate **BB**, **BP**, **SB**, and **VB** risk scores plus overall risk bands
- analyse one or more projects together with filters, charts, and exports
- test treatments and compare before/after risk outcomes, including generating AI image prompts for treatment visualisation

## 1.2 Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/LinXH8/PathSafetyAssessmentTool.git
cd PathSafetyAssessmentTool

# 2. Create the input folder before Docker creates it for you
mkdir in

# 3. Copy required assets into backend/
#    backend/models/      -> YOLO .pt files
#    backend/shapefiles/  -> GIS shapefiles

# 4. Build and run
docker compose up --build
```

Once running:

- **Frontend:** http://localhost
- **Backend API:** http://localhost:8000/api

## 1.3 Repository Layout

```text
PathSafetyAssessmentTool/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── health.py                # /api/ping and /api/health
│   │   │   ├── gis_layers/routes.py     # /api/shapefiles/* endpoints
│   │   │   └── projects/routes.py       # Core /api/projects/* API surface
│   │   ├── services/
│   │   │   ├── prediction.py            # CV inference and bulk autocode helpers
│   │   │   ├── cyclerap_scoring.py      # Native CycleRAP scoring
│   │   │   ├── project_manager.py       # Project and snapshot lifecycle
│   │   │   ├── serializer.py            # Project metadata / CSV / GPKG serialization
│   │   │   ├── cycleRAP_VA.py           # GPS extraction and LineString generation
│   │   │   ├── gis_mapping.py           # GIS lookups, width, and curvature logic
│   │   │   └── gis_layer_definition.py  # GIS layer schema definitions
│   ├── generate_road_reference.py       # Builds shapefiles/road_reference.csv
│   ├── models/                          # External CV model files (not in repo)
│   ├── shapefiles/                      # External GIS layers and road reference CSV
│   └── requirements.txt
├── frontend/
│   ├── public/
│   │   ├── README.md                    # Help-page overview (this file)
│   │   └── docs/                        # In-app mirrored markdown docs
│   ├── src/
│   │   ├── api/index.ts                 # Typed fetch helpers
│   │   ├── layouts/AppLayout.tsx        # Shared shell + sidebar
│   │   ├── pages/
│   │   │   ├── CreateProjectPage/       # Single-folder and polygon-based creation
│   │   │   ├── CodingPage/              # Main coding workspace
│   │   │   ├── GisLayersPage/           # GIS layer browser / manager
│   │   │   ├── HelpPage/                # In-app user and developer guide viewer
│   │   │   ├── PathAnalysisPage/        # Multi-project analysis workspace
│   │   │   ├── Projects/                # Project listing and management
│   │   │   └── TreatmentPage/           # Treatment overview and detail views
│   │   └── utils/projectSearch.ts       # Shared project-or-road fuzzy matcher
├── docs/                                # Canonical markdown docs for developers
├── data/                                # Persisted project storage (bind-mounted)
├── in/                                  # Source image folders (bind-mounted)
├── backend.Dockerfile
└── docker-compose.yml
```

## 1.4 Documentation Index

| # | Document | Description |
|---|---|---|
| 1 | [Installation](docs/installation.md) | Local setup, required assets, Docker and non-Docker run modes |
| 2 | [Architecture](docs/architecture.md) | Application structure, storage model, and key design decisions |
| 3 | [API Reference](docs/api-reference.md) | REST endpoints, payloads, and response shapes |
| 4 | [CV / ML Pipeline](docs/cv-pipeline.md) | Image ingestion, model loading, and auto-coding pipeline |
| 5 | [Scoring Logic](docs/scoring.md) | CycleRAP scoring inputs, formulas, and risk-band behaviour |
| 6 | [Frontend](docs/frontend.md) | Route map, page behaviour, and client-side data flow |
| 7 | [Common Issues](docs/common-issues.md) | Setup, GIS, and project-creation troubleshooting |
| 8 | [Contributing](docs/contributing.md) | Team conventions and contribution notes |

> The in-app Help page loads mirrored markdown from `frontend/public/docs/`. When you update docs in `docs/`, resync the mirrored copies as well.
