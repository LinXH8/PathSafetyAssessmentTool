# Gradient Runner

Read this only for LiDAR and gradient tasks. It is the operational source of truth for the
offline gradient workflow. Keep it focused on workflow rules, not general repo context —
repo-wide context lives in `CLAUDE.md`.

_Last reviewed: 2026-07-29._

## Goal

Build one road-level gradient set per target road:

- `gradient_profile.csv`
- `node_gradient_preview.csv`
- `metadata.json`

Canonical outputs live at `backend/shapefiles/gradient_profiles/{Planning Area}/{path_key}/`.

## Required References

Read these before running a build (see the token rules at the bottom — grep, never read in full):

- `Gradient Calculation/LAZ_to_Gradient_Guide.md`
- `docs/openrouter-deepseek-gradient-runbook.md`

Use `Gradient Calculation/build_path_gradient_profile.py` with explicit `--path-key` and
`--output-dir`.

## Working Surface

- Canonical outputs: `backend/shapefiles/gradient_profiles/{Planning Area}/{path_key}/`
- Reference shapefiles: `backend/shapefiles/planningareas/`
  - planning-area polygons: `G_MP25_PLNG_AREA_NO_SEA_PL.shp`
  - road centerlines / names: `ROADSECTIONLINE.shp`
- Current projects: `profiles/{profile}/projects/{Project Name}/`
  (as of 2026-07-29: `profiles/alaster/projects/` holds ~289 projects; `profiles/uat-profile/`
  also exists — glob `profiles/*/projects/`, do not hardcode one profile)
- Legacy projects: `data/{Project Name}/` (present but **empty** in this checkout — everything
  has moved under `profiles/`; still check it before declaring `Missing Source`)
- Staged source images: `in/{SOURCE FOLDER}/`
- Scratch output: `tmp/`

Planning areas with canonical output as of 2026-07-29 (26): Ang Mo Kio, Bishan, Bukit Merah,
Bukit Timah, Downtown Core, Geylang, Hougang, Kallang, Marina East, Marina South, Marine Parade,
Museum, Newton, Novena, Orchard, Outram, Punggol, River Valley, Rochor, Sengkang, Serangoon,
Singapore River, Straits View, Tanglin, Toa Payoh, Yishun.

## LiDAR Rules

- LiDAR root is normally `E:\LIDAR\`.
- Always verify `E:\LIDAR\` exists before any LiDAR operation.
- If `E:\LIDAR\` does not exist, ask for the current drive letter. The operator alternates two
  external drives (one mounted, one being loaded by IT), so the root can land on another letter.
  **Checked 2026-07-29: `E:` was not mounted** — `D:` held `LIGHTHAUS MAR 2026`, not LiDAR. Do not
  assume `E:` is live; verify every session.
- Confirm with the user before any LiDAR operation that touches the LiDAR drive — it is slow.
- As of 2026-06-02, the mounted drive contains Central/West Singapore bundles only.
- Do not attempt to rebuild NE-region roads from it. Serangoon, Hougang, Sengkang, and Punggol
  bundles are no longer there.
- Bundles may hold LAZ files in subdirectories (e.g. `D_Bishan\LAZ_PartA`). The builder globs
  `**/*.laz` recursively, so pointing `--laz-dir` at the top-level bundle folder is correct.

Active Phase 2 bundles on the LiDAR root:

- `D_Bishan`
- `D_Toa Payoh`
- `D_Novena`
- `D_Newton_LTA`
- `D_BukitTimah`
- `Zone A_Bukit_Timah_LTA`
- `D_BukitMerah`
- `D_Bukit_Merah_&_Clementi_LTA`
- `D_Geylang_LTA`
- `D_Kallang_LTA`
- `Marine Parade`
- `D_Queenstown`
- `D_Queenstown_LTA`
- `D_Tanglin_LTA`
- `D_Downtown_Core_LTA`
- `D_Museum_LTA`
- `D_Orchard_LTA`
- `D_Outram_LTA`
- `D_River Valley_LTA`
- `D_Rochor_LTA`
- `D_Singapore_River_LTA`

## Discovery Order

Before asking the user about missing inputs, check in this order:

1. `backend/shapefiles/gradient_profiles/` for canonical outputs
2. `profiles/*/projects/` for current projects
3. `data/` for legacy projects
4. `in/` for staged source folders
5. specific prior `tmp/.../attempt_status.json` paths only when re-running known work

Do not explore `tmp/` speculatively.

## Source and Project Rules

- Source images live under `D:\LIGHTHAUS MAR 2026\LIGHTHAUS MAR 2026\{sector}\{ROAD NAME}`.
- The `in/` folder is staging only, not proof that source imagery does or does not exist.
- Before declaring `Missing Source` or accepting `no source geometry`, check project storage,
  Lighthaus, **and** whether the centerline-trace method below applies.
- New projects live under `profiles/{profile}/projects/{Project Name}/`; legacy under `data/`.

If imagery exists in Lighthaus but not in `in/`, stage it through the normal import flow:

1. add the road to `batch_import.py`
2. call `POST /api/projects/folders/copy-local` (`api/projects/source_folders.py`)
3. call `/api/projects/folders`
4. then run the gradient build

> **Segment-count gotcha (2026-07-09):** creating a project from a folder **prunes** the dense
> survey frames down to roughly one anchor per segment. Never re-derive a folder's segment count
> from a pruned folder, and never treat the surviving file count as the frame count. The cached
> `psat-folder-summary.json` holds the authoritative pre-prune numbers.

## Centerline-Trace Method (preferred when no project exists)

Validated 2026-07-06/08 across ~70 roads. **This supersedes the old "geo_data.gpkg must already
exist, do not fabricate it" rule.** Full method: `LAZ_to_Gradient_Guide.md` Section 18 — read that
section before using it.

- If a live project with `geo_data.gpkg` exists, use it.
- If no project exists anywhere (`profiles/*/projects/`, `data/`, stageable `in/`), **do not** call
  it `Missing Source`. Build `geo_data.gpkg` from `ROADSECTIONLINE.shp`'s official centerline:
  match `RD_NAM` case-insensitively, chain sections by greedy nearest-endpoint ordering, gap-bridge
  with `--gap-max` (default 60 m; up to 150 m for short residential/`JALAN` roads — verify a large
  remaining gap is not a genuine disconnection before forcing a bigger bridge).
- Write the GeoPackage with the exact schema `build_path_gradient_profile.py::load_project_segments()`
  expects: table `geo_data`, columns `fid, geom, "Image Reference", "Road Name", "Distance (Metres)"`,
  geometry column renamed to `geom` (`gdf.rename_geometry("geom")`), CRS EPSG:3414. No builder change
  is needed.
- Guard `linemerge`: `u = unary_union(lines); merged = u if isinstance(u, LineString) else linemerge(u)`.
- Centerline traces usually beat image-GPS traces, which only cover wherever photos were taken.

### Multi-bundle roads: junction directories

A road spanning several planning areas needs several bundles, but `--laz-dir` takes one directory:

1. Create a scratch dir, e.g. `tmp/{batch_folder}/_lazdirs/{path_key}/`.
2. Add one Windows directory junction per bundle:
   `New-Item -ItemType Junction -Path <scratch>\<Bundle> -Target <LiDAR root>\<Bundle>`
3. Pass the scratch dir as `--laz-dir`. Python's recursive glob follows junctions; PowerShell's
   `Get-ChildItem -Recurse` does **not**, so never smoke-test the count that way — use
   `python -c "import glob; print(len(glob.glob('<dir>/**/*.laz', recursive=True)))"`.

### Junction cleanup safety (hard rule)

A junction is a reparse point, not a copy — recursing into it reaches the real LiDAR data.

1. Never `Remove-Item -Recurse` / `rm -rf` a directory that might contain junctions.
2. Delete each junction as a single non-recursive delete
   (`[System.IO.Directory]::Delete($path, $false)`).
3. Only after confirming zero reparse points remain is a recursive delete of the empty tree safe.
4. Windows blocked one such mistake on `E:\LIDAR`, but that guard does not cover every path — apply
   this order every time regardless.

## Path Key Rules

- Normalize to lowercase.
- Collapse each run of non-alphanumeric characters to `_`.
- Trim leading and trailing `_`.
- Always pass `--path-key` explicitly.
- Never derive the canonical key from a quarter-suffixed dataset name (`CONWAY GROVE_1Q2026` →
  `conway_grove`, never `conway_grove_1q2026`). The builder falls back to
  `project_metadata.json.dataset` before the folder-name fallback, which is how that bug happens.
- Abbreviations are never expanded: `AVE` stays `ave`, `AVENUE` stays `avenue`.

Examples:

- `CORFE PLACE` -> `corfe_place`
- `ANG MO KIO AVENUE 12` -> `ang_mo_kio_avenue_12`
- `YIO-CHU KANG LINK` -> `yio_chu_kang_link`

## Default Build Parameters

Unless there is a strong reason otherwise: `spacing_m = 2.0`, `baseline_m = 10.0`,
`smooth_window_m = 8.0`, `search_radius_m = 5.0`, `offroad-policy = trim`,
`target-road-name = exact uppercase road name`. Builder grade threshold:
`GRADE_THRESHOLD_PCT = 8.748` (`abs(gradient_pct) >= 8.748` → Grade 2, else Grade 1).

## Build Template

```powershell
& 'C:\Users\Alaster\miniconda3\envs\psat\python.exe' 'Gradient Calculation\build_path_gradient_profile.py' `
  --laz-dir '<LiDAR root>\{Bundle}' `
  --project-dir 'profiles\alaster\projects\{Project Name}' `
  --path-key '{path_key}' `
  --output-dir 'tmp\{batch_folder}\{path_key}' `
  --target-road-name '{UPPERCASE ROAD NAME}' `
  --offroad-policy trim
```

Use `data\{Project Name}` for legacy projects, or the generated centerline GeoPackage's folder for
centerline-trace builds.

Add `--display-name '{Road Name Title Case}'` for salvage builds where source project and target
road differ.

## Promotion Rules

Build to `tmp/` first. Promote only when all are true:

- `metadata.json` exists and has the correct `path_key`
- `gradient_profile.csv` exists
- `node_gradient_preview.csv` exists
- `valid_gradient_count > 0`
- result is not degenerate

After promotion, update only the target project's `project_metadata.json` with the canonical
`path_key`. Never edit a salvage source project's metadata.

### How the backend consumes a promoted profile

`backend/app/api/projects/gradient.py::_load_gradient_profile_catalog()` globs
`backend/shapefiles/gradient_profiles/*/*/metadata.json`, so the two-level
`{Planning Area}/{path_key}/` layout is load-bearing. Facts that matter when promoting:

- A profile is **silently skipped** when `gradient_profile.csv` is missing or
  `valid_gradient_count <= 0`. A degenerate promotion is invisible, not an error.
- Lookup keys on `metadata.json.path_key`, with aliases from `display_name` and `source_project`
  (normalized and survey-suffix-stripped) — this is why `--display-name` matters for salvage builds.
- `path_bounds_svy21` (`min_x/min_y/max_x/max_y`) drives the spatial fallback match; keep it.
- The catalog **auto-rebuilds** when any planning-area directory's mtime is newer than the last
  load, so a promotion is picked up without restarting the backend.
- Duplicate `path_key` across two planning areas means one silently wins. When a majority-area
  reassignment moves a road, **delete the old copy** — stale duplicates have been left behind before
  (`Bishan/lornie_road`, `Bukit Merah/central_expressway`).

## Batch Rules

- Default batch size: 8 roads
- Maximum: 10 only for short, low-risk roads
- Minimum: 6 for long roads or uncertain coverage (Punggol-length roads: 6 max)
- At most one compare build per road
- For Phase 2, start with the matching planning-area bundle; use a neighboring bundle only when
  coverage is weak
- Use `tmp/gradient_batch_{YYYYMMDD}/` and increment suffixes such as `_retry2` instead of
  overwriting

## Result Quality Notes

- **Isolated spikes on sparse profiles** (a lone `+42%` among plausible values) come from
  spike-repair having no valid neighbours. Promotable if non-degenerate, but flag as low confidence
  in batch notes.
- **Genuine zero-valid-gradient on very short roads** (under ~100 m) is a real `Not Viable`, not a
  source problem. Do not promote, do not reclassify as `Missing Source`.
- High step-jump rejection can collapse completion even when LiDAR footprint coverage looks fine.

## Hard Rules

- Never read `backend/app/api/projects/routes.py` in full — post-refactor it is a thin compat shim
  anyway; the real handlers live in `backend/app/api/projects/*.py` (gradient logic in
  `gradient.py`, folder staging in `source_folders.py`, project creation in `crud.py`).
- Never read `tmp/` broadly; only inspect explicit known paths.
- Never promote a build with `valid_gradient_count == 0` unless the user explicitly accepts it.
- Never use a quarter-suffixed folder name as the canonical `path_key`.
- Never ask the user for planning area, bundle, or project existence before doing the discovery pass.
- **Planning Area Splits:** if a road is split between two planning areas, assign it to the one that
  holds the majority of the road length, and delete any copy left in the other area.
- For repeat accuracy checks, build clean without consulting an existing canonical profile.
- Never loop while waiting for gradients to process. Launch the build in the background, call
  `ScheduleWakeup` with a delay matched to the expected build time (~270 s short batches, ~1200 s
  long ones), and stop responding until it fires. This saves tokens.
- **Never use emojis** in any output for this workflow — tables, chat, status flags, warnings, or
  generated files. The completion data feeds real, sensitive spreadsheets. Use plain words such as
  "low confidence" or "flagged".

## Output Rules

For user-facing road tables:

- columns must be `Name`, `Status`, `Completion %`
- `Status` must be exactly `Done`, `Not Viable`, or `Missing Source`
- `Completion %` must be plain `XX.XX%`
- `Completion %` must be **left blank (empty cell)** when there is no value — i.e. for any
  `Not Viable` or `Missing Source` road. Do not write `N/A`, `-`, `0`, or any text. The column feeds
  a numbers-only spreadsheet, so a non-numeric token breaks it; an empty cell is the only acceptable
  "no value".
- preserve the exact road order submitted by the user

For completion text files, write one line per road as `ROAD NAME XX.XX%` with no header. When a road
has no completion value, write the road name followed by nothing — leave the percentage blank rather
than writing `N/A`.

## Backend Interaction Rules

Only relevant when a task needs the running app (folder staging, verifying grade injection):

- Run the backend with `cd backend && python app.py` — this is **waitress**, no reloader, serving
  API **and** the built frontend on `http://localhost:8000`. Use `PSAT_DEV=1 python app.py` for the
  old auto-reloading dev server. Host defaults to `127.0.0.1`.
- Health check: `GET /api/health` → `{status, version, channel}`.
- **Active-profile gotcha:** endpoints resolving through `pm.project()` return
  `KeyError: Project not found` when no profile is active. The active profile now persists to
  `profiles/active_profile.json`, but if that file is missing, log in once through the UI to create
  it. Endpoints that build filesystem paths directly still return 200, which masks the failure.
- `gradient_profiles/` is excluded from the GIS-layers listing via `_NON_LAYER_DIRS` in
  `api/gis_layers/routes.py` (its ~1300 `.json` files made `/api/shapefiles` take 60+ s). Do not
  "fix" that exclusion.
- Packaging note: `backend/shapefiles/` is an **install-root** component that the updater replaces
  wholesale, and `gradient.py` reads the catalog from the install tree, not the user-data root. In a
  source checkout the two roots collapse to the same paths, so nothing changes for local gradient
  work — but promoted profiles ship as part of the shapefiles update component, not as user data.

## Efficiency & Token Rules

- **Large Reference Guides:** never read `Gradient Calculation/LAZ_to_Gradient_Guide.md` or
  `docs/openrouter-deepseek-gradient-runbook.md` in full. They are >1000 lines — grep, or read
  specific sections only (Section 18 is the centerline method; Section 19 the no-emoji rule).
- **Consolidated Actions:** batch directory listings and file reads using `&` or `type` to minimize
  tool overhead.
