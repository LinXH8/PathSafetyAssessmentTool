# 2. Installation Guide

This guide covers local setup for PSAT on Windows. Docker is the standard path, but a non-Docker developer workflow is also supported.

---

## Table of Contents

- [2.1 Prerequisites](#2-1-prerequisites)
  - [2.11 Required Software](#2-11-required-software)
  - [2.12 Required Assets](#2-12-required-assets)
- [2.2 Step 1 — Obtain the Project Files](#2-2-step-1-obtain-the-project-files)
  - [2.21 Option A: GitHub Desktop](#2-21-option-a-github-desktop)
  - [2.22 Option B: Command Line](#2-22-option-b-command-line)
- [2.3 Step 2 — Prepare the Folder Structure](#2-3-step-2-prepare-the-folder-structure)
  - [2.31 Create the `in/` Folder](#2-31-create-the-in-folder)
  - [2.32 Copy Models and Shapefiles](#2-32-copy-models-and-shapefiles)
  - [2.33 Build the Road Reference CSV (Recommended)](#2-33-build-the-road-reference-csv-recommended)
- [2.4 Step 3 — Run the App](#2-4-step-3-run-the-app)
  - [2.41 Start the Stack](#2-41-start-the-stack)
  - [2.42 Verify the Backend](#2-42-verify-the-backend)
  - [2.43 Stop the App](#2-43-stop-the-app)
- [2.5 Data Persistence](#2-5-data-persistence)
- [2.6 Port Reference](#2-6-port-reference)
- [2.7 Updating the App](#2-7-updating-the-app)
- [2.8 Advanced: Running Without Docker](#2-8-advanced-running-without-docker)
  - [2.81 Backend (Flask)](#2-81-backend-flask)
  - [2.82 Frontend (Vite dev server)](#2-82-frontend-vite-dev-server)

## 2.1 Prerequisites

### 2.11 Required Software

| Tool | Purpose | Download |
|---|---|---|
| **Git** | Clone the repository | https://git-scm.com |
| **GitHub Desktop** *(optional)* | GUI for Git | https://desktop.github.com |
| **Docker Desktop** | Run the containerised app | https://www.docker.com/products/docker-desktop |

Install all three before proceeding. Docker Desktop must be **running** before you attempt to start the app.

### 2.12 Required Assets

Two external asset folders must be copied into `backend/` before CV and GIS-assisted coding will work:

| Folder | Destination | Contents |
|---|---|---|
| `models/` | `backend/models/` | YOLO `.pt` model files (see [CV Pipeline](cv-pipeline.md)) |
| `shapefiles/` | `backend/shapefiles/` | GIS shapefiles used by the GIS autocoder |

If these folders are missing, the app can still boot, but GIS and/or CV features will fail at runtime.

---

## 2.2 Step 1 — Obtain the Project Files

### 2.21 Option A: GitHub Desktop

1. Open GitHub Desktop.
2. Press **Ctrl + Shift + O** (or **File → Clone Repository**).
3. Search for `LinXH8/PathSafetyAssessmentTool` and clone it to a local folder of your choice.

### 2.22 Option B: Command Line

```bash
git clone https://github.com/LinXH8/PathSafetyAssessmentTool.git
cd PathSafetyAssessmentTool
```

> **Windows line endings:** Set `autocrlf` to false **before cloning** to prevent shell script issues inside Docker:
> ```bash
> git config --global core.autocrlf false
> ```

---

## 2.3 Step 2 — Prepare the Folder Structure

After cloning, the root should look like this:

```text
PathSafetyAssessmentTool/
├── backend/
├── frontend/
├── data/                ← created automatically on first run
├── in/                  ← YOU MUST CREATE THIS MANUALLY
├── backend.Dockerfile
└── docker-compose.yml
```
*Layman's explanation: This shows how the main folders of the application are organized on your computer.*

### 2.31 Create the `in/` Folder

**Create `in/` manually before running Docker.** If Docker creates it, it may be owned by root and cause permission errors.

```bash
mkdir in
```

Inside `in/`, each subfolder is a reusable image source. A project can be created from one folder or from multiple folders selected by polygon on the Create Project map.

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
*Layman's explanation: This example shows how your input photos should be organized in the 'in' folder for the system to find them.*

### 2.32 Copy Models and Shapefiles

Populate the following before running Docker:

```text
backend/
├── models/
│   ├── path_seg.pt
│   ├── off_road_bicycle_path.pt
│   ├── adj_road_lane.pt
│   ├── LTA_FIXEDOBSTACLE_BEST_2.pt
│   ├── DevelopmentAccess_last_150epochs.pt
│   ├── LTA_Dill_4_Best.pt
│   └── RoadClassification_best.pt
└── shapefiles/
    └── <GIS layer files>
```
*Layman's explanation: This shows where to put the specialized files for computer vision and mapping logic.*

### 2.33 Build the Road Reference CSV (Recommended)

After populating `in/`, generate the road-reference CSV used by the polygon road-selection tool:

```bash
cd backend
python generate_road_reference.py
cd ..
```

This writes `backend/shapefiles/road_reference.csv`. The map-based road selector can still work without it, but the CSV improves matching between the selection polygon and locally available road folders.

---

## 2.4 Step 3 — Run the App

### 2.41 Start the Stack

Open a terminal in the project root and run:

```bash
docker compose up --build
```

The first run takes several minutes. Subsequent runs are much faster.

Once started:
- **Frontend (UI):** http://localhost
- **Backend API:** http://localhost:8000/api

### 2.42 Verify the Backend

```bash
curl http://localhost:8000/api/ping
# Expected: {"status": "ok"}
```

### 2.43 Stop the App

```bash
docker compose down
```

---

## 2.5 Data Persistence

The following folders are bind-mounted as Docker volumes. **Data persists between container restarts.**

| Host path | Container path | Contents |
|---|---|---|
| `./data/` | `/app/data` | All project data (attributes, results, geodata, baselines) |
| `./in/` | `/app/in` | Input image source folders |

Do **not** delete or move these folders while the container is running.

---

## 2.6 Port Reference

| Service | Host port | Container port |
|---|---|---|
| Frontend (nginx) | 80 | 80 |
| Backend (Flask) | 8000 | 8000 |

If port 80 or 8000 is already in use, see [Common Issues](common-issues.md).

---

## 2.7 Updating the App

```bash
git pull
docker compose up --build
```

The `--build` flag ensures the Docker image is rebuilt with any code changes. Project data in `./data/` is unaffected by rebuilds.

---

## 2.8 Advanced: Running Without Docker

For active development, you can run the backend and frontend directly without Docker. This gives faster iteration at the cost of managing dependencies yourself.

**Requirements:**
- Python 3.11
- Node.js 20

### 2.81 Backend (Flask)

```bash
cd backend
pip install -r requirements.txt
python app.py
```

The backend starts on `http://localhost:8000`.

### 2.82 Frontend (Vite dev server)

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server starts on `http://localhost:5173` and proxies all `/api/*` requests to `http://localhost:8000`.

> **Note:** `pywin32` is Windows-only. On non-Windows platforms, remove or skip that line from `requirements.txt`.
