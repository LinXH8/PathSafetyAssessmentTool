# 9. Common Issues

This page covers the issues that show up most often in current PSAT workflows, especially around Docker setup, polygon-based project creation, and GIS-layer management.

---

## Table of Contents

- [9.1 Docker and startup](#81-docker-and-startup)
- [9.2 Models and shapefiles](#82-models-and-shapefiles)
- [9.3 `in/` folder and source images](#83-in-folder-and-source-images)
- [9.4 Polygon and road selection](#84-polygon-and-road-selection)
- [9.5 Project metadata and search](#85-project-metadata-and-search)
- [9.6 Scoring and coding](#86-scoring-and-coding)
- [9.7 Documentation drift](#87-documentation-drift)
- [9.8 Data recovery](#88-data-recovery)
- [9.9 Remote report export is not configured](#89-remote-report-export-is-not-configured)

---

## 9.1 Docker and startup

### 9.11 Docker Desktop is not running

**Symptom:** `docker compose up --build` fails immediately with a Docker pipe / connection error.

**Fix:** Start Docker Desktop and wait for it to report that the engine is running, then retry.

### 9.12 Port 80 or 8000 is already in use

**Symptom:** The stack starts partially, but the frontend or backend is unreachable.

**Fix:** Stop the conflicting service or change the port mappings in `docker-compose.yml`.

### 9.13 Backend health check fails after build

**Symptom:** `http://localhost:8000/api/ping` does not respond.

**Fix:** Check `docker compose logs backend` first. The most common causes are:

- missing `backend/models/`
- missing `backend/shapefiles/`
- a bad local edit that breaks imports

---

## 9.2 Models and shapefiles

### 9.21 Auto-code fails because models are missing

**Symptom:** CV auto-code returns 503 or logs show `missing path_seg.pt`.

**Fix:** Copy the shared model files into `backend/models/` and rebuild.

### 9.22 GIS auto-code or GIS Layers page is empty

**Symptom:** GIS-assisted coding returns nothing, or the GIS Layers page has no usable layers.

**Fix:** Confirm the shapefile tree exists under `backend/shapefiles/` and contains the expected layer files, not just empty folders.

---

## 9.3 `in/` folder and source images

### 9.31 `in/` was created by Docker instead of manually

**Symptom:** File writes into `in/` fail or behave strangely.

**Fix:** Stop Docker, recreate `in/` manually from the host, then restart.

### 9.32 Images are directly under `in/` instead of inside subfolders

**Symptom:** The folder dropdown is empty or project creation fails.

**Fix:** Put images inside subdirectories of `in/`, one folder per source road / survey batch.

### 9.33 Images have no GPS EXIF data

**Symptom:** Project creation fails, or you get zero usable segments.

**Fix:** The source images must contain GPS EXIF metadata. Screenshots, stripped images, and many exported image sets will not work.

---

## 9.4 Polygon and road selection

### 9.41 Polygon selection returns planning areas instead of roads

**Symptom:** The map selection tool only returns high-level planning-area names, or the road list looks incomplete.

**Cause:** The backend falls back when it cannot get better road matches from `road_reference.csv` and road-name shapefiles.

**Fix:**

1. Make sure `backend/shapefiles/road_reference.csv` exists.
2. Regenerate it after adding or renaming folders in `in/`:

```bash
python scripts/generate_road_reference.py
```

3. Confirm the road-name shapefiles are present under `backend/shapefiles/`.

### 9.42 Selected roads are marked unavailable

**Symptom:** The Create Project page shows roads, but some are flagged as missing and block creation.

**Fix:** Those roads do not currently have matching local folders under `in/`. Either:

- add the missing source folders and images
- or deselect the unavailable roads before creating the project

### 9.43 Create Project says no geotagged images were found inside the polygon

**Symptom:** `POST /api/projects/folders` returns a 400 error about no geotagged images inside the selected polygon.

**Cause:** The selected roads may exist, but none of their sampled GPS points survived the polygon filter.

**Fix:**

- redraw a larger polygon
- verify the images in those folders have GPS EXIF data
- regenerate `road_reference.csv` if the source folders changed recently

---

## 9.5 Project metadata and search

### 9.51 Searching by road name does not return the expected project

**Symptom:** The Projects, Treatment, or Path Analysis page does not surface a project when you search for a road.

**Cause:** Newer projects store `source_folders` explicitly. Older projects are reconstructed from image namespaces on a best-effort basis, which may be incomplete if images predate the multi-folder naming convention.

**Fix:** For older projects, check the actual project metadata or recreate the project if road-level provenance is critical.

### 9.52 Project name cannot contain underscores

**Symptom:** Project creation returns `Project name cannot contain underscores (_)`.

**Fix:** Use spaces, hyphens, or camel case instead.

---

## 9.6 Scoring and coding

### 9.61 Scores do not update after save

**Symptom:** The attributes save succeeds but the displayed scores look stale.

**Fix:** Check backend logs for scoring errors. `PUT /api/projects/<name>/attributes` recalculates and persists scores automatically.

### 9.62 First auto-code request is very slow

**Expected behavior:** The first CV request loads the YOLO models into memory. Subsequent requests are much faster.

---

## 9.7 Documentation drift

### 9.71 The repository docs were updated, but the Help page still shows old content

**Cause:** The Help page reads mirrored markdown from `frontend/public/docs/`, not directly from `docs/`.

**Fix:** Sync both locations whenever docs change.

---

## 9.8 Data recovery

### 9.81 Projects disappear after container restart

**Symptom:** `docker compose down` followed by `up` appears to lose projects.

**Fix:** Confirm that `./data:/app/data` is still present in `docker-compose.yml` and that the host `data/` directory still exists.

### 9.82 A project was deleted accidentally

**Cause:** Project deletion removes the project directory recursively.

**Fix:** Restore it from a filesystem backup if available. There is no soft-delete layer.

---

## 9.9 Remote report export is not configured

**Symptom:** The Report Builder's remote-export option is unavailable, or a remote export
request fails with `"Remote export is not configured."`

**Cause:** Remote export is an optional feature — it POSTs the generated report to an
external endpoint (a Google Apps Script web app; see
[../google-apps-script-report-receiver.gs](../google-apps-script-report-receiver.gs)). It's
disabled unless both of these are set:

| Env var | Or, in `profiles/report-upload.json` |
| --- | --- |
| `PSAT_REPORT_WEB_APP_URL` | `upload_url` |
| `PSAT_UPLOAD_SECRET` | `upload_secret` |

**Fix:** Set both env vars before starting the backend, or create
`profiles/report-upload.json` with `upload_url`/`upload_secret` keys. The secret must match
the `PSAT_UPLOAD_SECRET` script property configured on the receiving Apps Script deployment.
See `backend/app/services/telemetry_store.py` (`_load_remote_export_config`) for the exact
resolution order.
