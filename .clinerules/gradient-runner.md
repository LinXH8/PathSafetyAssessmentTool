# Gradient Runner

This file is the operational source of truth for gradient-generation tasks. Keep it focused on workflow rules, not general repo context.

## Goal

Extract road gradient profiles from LiDAR point clouds and geotagged path imagery.

Expected outputs per road:
- `gradient_profile.csv`
- `node_gradient_preview.csv`
- `metadata.json`

## Read Before Acting

- `Gradient Calculation/LAZ_to_Gradient_Guide.md`
- `docs/openrouter-deepseek-gradient-runbook.md`

## Working Surface

- Canonical outputs: `backend/shapefiles/gradient_profiles/{Planning Area}/{path_key}/`
- Reference shapefiles: `backend/shapefiles/planningareas/`
- Current projects: `profiles/{profile}/projects/{Project Name}/`
- Legacy projects: `data/{Project Name}/`
- Staged source images: `in/{SOURCE FOLDER}/`
- Scratch output: `tmp/`

## LiDAR Rules

- LiDAR root is normally `E:\LIDAR\`.
- Always verify `E:\LIDAR\` exists before any LiDAR operation.
- If `E:\LIDAR\` does not exist, ask for the current drive letter.
- Confirm with the user before any LiDAR operation that touches `E:` because the drive is slow.
- As of 2026-06-02, `E:` contains Central/West Singapore bundles only.
- Do not attempt to rebuild NE-region roads from `E:`. Serangoon, Hougang, Sengkang, and Punggol bundles are no longer there.

Current active Phase 2 bundles:
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

Before asking the user for missing context, check in this order:

1. `backend/shapefiles/gradient_profiles/`
2. `profiles/alaster/projects/`
3. `data/`
4. `in/`
5. specific prior-run checkpoints in `tmp/`

# Gradient Runner

Read this only for LiDAR and gradient tasks. It is the operational source of truth for the offline gradient workflow.

## Goal

Build one road-level gradient set per target road:

- `gradient_profile.csv`
- `node_gradient_preview.csv`
- `metadata.json`

Canonical outputs live at `backend/shapefiles/gradient_profiles/{Planning Area}/{path_key}/`.

## Required References

Read these before running a build:

- `Gradient Calculation/LAZ_to_Gradient_Guide.md`
- `docs/openrouter-deepseek-gradient-runbook.md`

Use `Gradient Calculation/build_path_gradient_profile.py` with explicit `--path-key` and `--output-dir`.

## Current Dataset State

- LiDAR root is normally `E:\LIDAR\`; verify it exists before any LiDAR operation.
- If `E:\LIDAR\` is missing, ask the operator for the current drive letter.
- The active external dataset changed on 2026-06-02.
- `E:\LIDAR\` now contains Central/West bundles.
- NE bundles are no longer on `E:`. Do not attempt to rebuild Serangoon, Hougang, Sengkang, or Punggol from `E:`.
- `E:` is slow. Confirm with the user before any LiDAR operation that touches it.

Active Phase 2 bundles on `E:\LIDAR\`:

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
2. `profiles/alaster/projects/` for current projects
3. `data/` for legacy projects
4. `in/` for staged source folders
5. specific prior `tmp/.../attempt_status.json` paths only when re-running known work

Do not explore `tmp/` speculatively.

## Source and Project Rules

- Source images live under `D:\LIGHTHAUS MAR 2026\LIGHTHAUS MAR 2026\{sector}\{ROAD NAME}`.
- The `in/` folder is staging only, not proof that source imagery does or does not exist.
- Before declaring `Missing Source` or accepting `no source geometry`, check both project storage and Lighthaus.
- New projects live under `profiles/{profile}/projects/{Project Name}/`.
- Legacy projects live under `data/{Project Name}/`.
- `geo_data.gpkg` must already exist in the project folder. Do not fabricate it.

If imagery exists in Lighthaus but not in `in/`, stage it through the normal import flow:

1. add the road to `batch_import.py`
2. call `/api/projects/folders/copy-local`
3. call `/api/projects/folders`
4. then run the gradient build

## Path Key Rules

- Normalize to lowercase.
- Collapse each run of non-alphanumeric characters to `_`.
- Trim leading and trailing `_`.
- Always pass `--path-key` explicitly.
- Never derive the canonical key from a quarter-suffixed dataset name.

Examples:

- `CORFE PLACE` -> `corfe_place`
- `ANG MO KIO AVENUE 12` -> `ang_mo_kio_avenue_12`

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

Use `data\{Project Name}` for legacy projects.

Add `--display-name '{Road Name Title Case}'` for salvage builds where source project and target road differ.

## Promotion Rules

Build to `tmp/` first. Promote only when all are true:

- `metadata.json` exists and has the correct `path_key`
- `gradient_profile.csv` exists
- `node_gradient_preview.csv` exists
- `valid_gradient_count > 0`
- result is not degenerate

After promotion, update only the target project's `project_metadata.json` with the canonical `path_key`.
Never edit a salvage source project's metadata.

## Batch Rules

- Default batch size: 8 roads
- Maximum: 10 only for short, low-risk roads
- Minimum: 6 for long roads or uncertain coverage
- At most one compare build per road
- For Phase 2, start with the matching planning-area bundle; use a neighboring bundle only when coverage is weak
- Use `tmp/gradient_batch_{YYYYMMDD}/` and increment suffixes such as `_retry2` instead of overwriting

## Hard Rules

- Never read `backend/app/api/projects/routes.py` in full.
- Never read `tmp/` broadly; only inspect explicit known paths.
- Never promote a build with `valid_gradient_count == 0` unless the user explicitly accepts it.
- Never use a quarter-suffixed folder name as the canonical `path_key`.
- Never ask the user for planning area, bundle, or project existence before doing the discovery pass.
- **Planning Area Splits:** If a road is split between two planning areas, assign it to the one that holds the majority of the road length.
- For repeat accuracy checks, build clean without consulting an existing canonical profile.
- Never loop while waiting for gradients to process. Instead, set a wakeup notification to inform you. This saves tokens.

## Output Rules

For user-facing road tables:

- columns must be `Name`, `Status`, `Completion %`
- `Status` must be exactly `Done`, `Not Viable`, or `Missing Source`
- `Completion %` must be plain `XX.XX%`
- `Completion %` must be **left blank (empty cell)** when there is no value — i.e. for any `Not Viable` or `Missing Source` road. Do not write `N/A`, `-`, `0`, or any text. The column feeds a numbers-only spreadsheet, so a non-numeric token breaks it; an empty cell is the only acceptable "no value".
- preserve the exact road order submitted by the user

For completion text files, write one line per road as `ROAD NAME XX.XX%` with no header. When a road has no completion value, write the road name followed by nothing (`ROAD NAME ` with a trailing space, or just `ROAD NAME`) — leave the percentage blank rather than writing `N/A`.

## Efficiency & Token Rules

- **Large Reference Guides:** Never read `Gradient Calculation/LAZ_to_Gradient_Guide.md` or `docs/openrouter-deepseek-gradient-runbook.md` in full. They are >500 lines and should be grepped or read in specific sections only.
- **Consolidated Actions:** Batch directory listings and file reads using `&` or `type` to minimize tool overhead.
