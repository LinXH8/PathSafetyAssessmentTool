# Gradient Guide: Operator + LLM Safe Version

This is the gradient markdown file.

Path:
- `Gradient Calculation/LAZ_to_Gradient_Guide.md`

Companion runbook for Claude Code + OpenRouter + DeepSeek:
- `docs/openrouter-deepseek-gradient-runbook.md`

If another model is taking over this workflow, read this file fully before doing anything else.

## 1. Non-Negotiable Rules

These rules are not optional.

1. The canonical master store for finished gradient profiles is:
   `backend/shapefiles/gradient_profiles/<Planning Area>/<path_key>/`
2. A canonical profile folder must contain exactly these core outputs:
   `gradient_profile.csv`, `node_gradient_preview.csv`, `metadata.json`
3. Do not treat `tmp/` as canonical storage.
4. Do not treat project folders as canonical storage.
5. In this repo's current live setup, project folders are under:
   `profiles/alaster/projects/<Project Name>/`
6. After and only after a successful promotion, apply the single project metadata mutation rule from Section 10.
7. If a canonical profile already exists for a road, do not rebuild it blindly.
8. Read existing `metadata.json` first.
9. If the user asks for a simple completion text file, the file must contain only:
   `ROAD NAME XX.XX%`
   one road per line, no header, no comments.
10. If the user says to override or overwrite the text file, replace the old contents completely.
11. Do not ask the user for planning area, LiDAR bundle, batch folder, summary txt path, or project/source existence until after searching the workspace state.
12. Search in this order before asking: canonical profiles, live projects, `data/`, `in/`, then prior temp outputs under `tmp/`.
13. If the workspace has no project/source geometry for the requested road, report the exact blocker and the paths searched; do not keep asking open-ended setup questions.
14. If a build uses a neighboring project's trace instead of a true target-road project, treat it as salvage only until the temp metadata proves credible coverage.
15. Always pass `--output-dir` explicitly. The builder's no-argument default still points at a legacy flat `backend/shapefiles/gradient_profiles/<path_key>/` path and is not the canonical planning-area layout.
16. Never derive `Project Name` by reversing `path_key`. Search actual workspace folders and metadata first.
17. A LiDAR `bundle` means one literal top-level folder directly under the LiDAR root (typically `E:\LIDAR\`, but see Section 2 drive-swap note).
18. During normal execution, do not ask the user follow-up questions. Infer, default, compare-build, or stop with the exact blocker report format defined below.
19. If multiple candidate projects, source folders, or bundles remain tied after the deterministic rules in this file, stop with a blocker report instead of asking a vague question.
20. If the user asks to build a gradient for a road that already has a canonical profile and marks it as a repeat or duplicate run, do not read, reference, or compare against the existing canonical profile, completion percentage, or metadata during the build. Treat it as a completely fresh build with no prior result. Repeat runs are intentional accuracy checks against established ("tried and true") results and must be done at the start of a new conversation in a clean state.

## 2. Current Storage Map

Use these paths exactly.

Gradient guide:
- `Gradient Calculation/LAZ_to_Gradient_Guide.md`

Builder script:
- `Gradient Calculation/build_path_gradient_profile.py`

LiDAR overlap checker:
- `Gradient Calculation/find_lidar_bundle_overlaps.py`

Completion helper:
- `Gradient Calculation/show_gradient_completion.cmd`
- `Gradient Calculation/show_gradient_completion.ps1`

Canonical promoted gradient profiles:
- `backend/shapefiles/gradient_profiles/<Planning Area>/<path_key>/`

Planning area polygons:
- `backend/shapefiles/planningareas/G_MP25_PLNG_AREA_NO_SEA_PL.shp`

Road name / road boundary reference:
- `backend/shapefiles/planningareas/ROADSECTIONLINE.shp`

Current user profile project root:
- `data/<Project Name>/`

Imported source image folders:
- `in/<SOURCE_FOLDER>/`

Temporary working outputs:
- `tmp/`

Runtime observability/checkpoint artifacts for urgent assessment runs:
- `tmp/<run_stem>_builds/<road_slug>__<source_slug>__<bundle_slug>/attempt_status.json`

Persistent LiDAR index cache used by corrected urgent runners:
- `tmp/lidar_index_cache_20260529/`

LiDAR root used in this workstream:
- `E:\LIDAR` *(primary — but see drive-swap note below)*

**Drive-swap note:** The operator uses two external LiDAR drives and alternates them — one is mounted while the other is being loaded by IT. The LiDAR root is `E:\LIDAR\` when the primary drive is mounted, but may be on a different drive letter (e.g. `F:\LIDAR\`) when the drives are swapped. **Before any LiDAR operation, verify `E:\LIDAR\` exists.** If it does not, ask the operator for the current drive letter rather than assuming E:.

Top-level LiDAR bundle folders are literal subdirectories under that root, for example:
- `D_Bishan`
- `D_Toa Payoh`
- `D_Novena`

**Note:** Some bundles contain LAZ files in subdirectories (e.g. `D_Bishan\LAZ_PartA`, `D_Bishan\LAZ_PartB`). The builder's `--laz-dir` uses `glob("**/*.laz", recursive=True)` so pointing at the top-level bundle folder is correct and sufficient.

### Naming And Identity Rules

`path_key` rule used by the builder:

1. Prefer explicit `--path-key`.
2. Else use `project_metadata.json.path_key`.
3. Else use `project_metadata.json.dataset`.
4. Else use `project_dir.name` with a trailing survey suffix stripped if it matches the builder's fallback pattern.
5. Normalize by replacing every run of non-alphanumeric characters with `_`, trimming leading/trailing `_`, and lowercasing.

Examples:

- `CONWAY GROVE` -> `conway_grove`
- `ANG MO KIO AVENUE 12` -> `ang_mo_kio_avenue_12`
- `YIO-CHU KANG LINK` -> `yio_chu_kang_link`
- `LORONG 1A TOA PAYOH` -> `lorong_1a_toa_payoh`

Important consequences:

1. Numbers are preserved.
2. Hyphens, spaces, slashes, and punctuation all collapse to `_`.
3. Abbreviations are not expanded automatically. `AVE` stays `ave`; `AVENUE` stays `avenue`.
4. Because the builder falls back to `project_metadata.json.dataset` before the stripped project-folder fallback, a quarter-suffixed dataset like `CONWAY GROVE_1Q2026` can incorrectly become `conway_grove_1q2026` if `path_key` is missing. For canonical work, always pass explicit `--path-key` or ensure project metadata already has the correct `path_key`.
5. If `project_metadata.json.dataset` is `null`, empty, or missing, skip that step and continue to the project-folder fallback. Do not stop at a null dataset.

`Project Name` rule:

1. `Project Name` means the literal folder name under `profiles/alaster/projects/`.
2. Single-road projects in the current repo usually use human-readable road names such as `Conway Grove` or `Burghley Drive`.
3. Multi-road or legacy projects can use coded names such as `TPYEAST3Q25`.
4. Do not assume `Project Name == path_key`.
5. Use `project_metadata.json.project_name` and the actual folder listing as the source of truth.

`--display-name` rule:

1. `--display-name` controls `metadata.json.display_name` only.
2. Use the human-readable road label you want future readers to see, not the source project folder name.
3. If the workspace already has an established spelling in a project folder or metadata file, copy that spelling verbatim.
4. Otherwise use normal road-name casing with spaces and numbers preserved, for example `Corfe Place`, `Crowhurst Drive`, `Ang Mo Kio Avenue 12`.
5. Do not expand or shorten road types just for this field.
6. Every salvage build that uses a neighboring project's trace must pass `--display-name '<Target Road Title Case>'` because the source project folder name is, by definition, not the target road name.

### Salvage Build Definition

Use this definition everywhere in this guide and the runbook.

1. A `direct build` uses the true target-road project as `--project-dir`.
2. A `salvage build` uses a neighboring project's real trace as `--project-dir` because the true target-road project or source geometry is missing.
3. A build is salvage if the source project folder name is not the target road name and target-road coverage depends on retained points after the builder's road-boundary filtering.
4. Salvage outputs are `temp_only` by default unless the promotion rules later say otherwise.
5. Every salvage build must pass `--display-name '<Target Road Title Case>'`.
6. In batch artifacts, salvage uses `source_type = salvage_build`.

### `project_metadata.json` Fields That Matter Here

Treat `project_metadata.json` as ordinary JSON. Do not invent alternate structure.

Fields this workflow cares about:

- `project_name`: string, usually matching the human-readable project folder name
- `dataset`: string or `null`, often the original source-folder label
- `source_folders`: array of literal source-folder names, for example `['CONWAY GROVE_1Q2026']`
- `tags`: array of strings when present
- `path_key`: canonical gradient key when already assigned

Real example shape from this repo:

```json
{
   "project_name": "Conway Grove",
   "dataset": "CONWAY GROVE_1Q2026",
   "source_folders": [
      "CONWAY GROVE_1Q2026"
   ],
   "tags": [
      "Gradient",
      "May28",
      "Serangoon"
   ],
   "path_key": "conway_grove"
}
```

Matching rule:

1. `source_folders` is a plain array of strings.
2. Compare the requested source-folder name against array elements only.
3. If `source_folders` is missing or empty, treat it as `[]` and continue to the next selection rule.
4. Do not synthesize nested objects or alternate keys.

If `project_metadata.json` is missing entirely:

1. An exact folder-name match can still identify the project folder as a geometry source.
2. Treat all metadata-driven fields as unavailable, not as empty strings.
3. Use explicit `--path-key`; do not infer from missing metadata.
4. Do not create or repair `project_metadata.json` during a normal gradient run.
5. If the run would need a metadata update for promotion, stop with blocker reason `missing project_metadata.json`.

### `geo_data.gpkg` Prerequisite

`geo_data.gpkg` is not created by the gradient builder.

In the normal project flow it is created earlier, during project creation, by:

1. reading geotagged images from `in/<SOURCE_FOLDER>/`
2. extracting GPS points
3. reverse-geocoding road names
4. sampling points by distance
5. converting the sampled points into LineString segments
6. saving those segments into the project folder before the gradient workflow starts

Practical rule:

1. If `geo_data.gpkg` is missing, the gradient workflow has a real blocker.
2. If `geo_data.gpkg` exists but cannot be opened, contains zero usable geometry rows, or is otherwise unreadable for this workflow, stop with blocker reason `unreadable geo_data.gpkg`.
3. The guide does not authorize fabricating it from scratch during a gradient run.
4. If a target-road project is missing, either use an existing project with real geometry or stop and report that project/source geometry does not exist yet.
5. Source-folder lookup under `in/` first tries an exact folder name and then a unique quarter-suffix-stripped match.

### No-Questions Execution Contract

If you are a model following this guide, do not ask the user follow-up questions during a normal gradient run.

For every missing input, do exactly one of these:

1. infer it from repo state using the rules in this file
2. apply the documented default
3. run the documented compare-build fallback
4. stop with the exact blocker report format below

Do not convert missing information into a conversational question unless the user explicitly asks for brainstorming instead of execution.

Exact blocker report format:

```text
BLOCKED
road_name: <ROAD NAME OR BATCH>
label: <Missing Source | Not Viable>
reason: <single concrete reason>
searched_paths:
- <path 1>
- <path 2>
- <path 3>
next_required_artifact: <specific file/folder/project/source that must exist>
```

`next_required_artifact` must be concrete. Use a literal missing file or folder path, not a vague sentence.

Examples:

- `next_required_artifact: profiles/alaster/projects/Court Road/geo_data.gpkg`
- `next_required_artifact: profiles/alaster/projects/Court Road/project_metadata.json`
- `next_required_artifact: in/COURT ROAD_1Q2026`
- `next_required_artifact: backend/shapefiles/gradient_profiles/Serangoon/court_road/metadata.json`

Blocked label rules:

- `Missing Source`: the controlling blocker is missing or unusable project/source imagery or geometry, such as no exact live project or source folder, missing `geo_data.gpkg`, unreadable source geometry, or a missing required folder under `in/`
- `Not Viable`: the controlling blocker is not missing source input but lack of a viable LiDAR/build outcome, such as no overlapping LiDAR bundle, zero retained target-road samples from nearby traces, ambiguous non-source ties after deterministic rules, or a build result too weak to trust

Current runtime-control behavior to assume in urgent runs:

1. LiDAR bundle indexing is lazy per bundle, not full upfront.
2. Per-attempt phase checkpoints are written to `attempt_status.json`.
3. LiDAR tile-bound indexes are cached across processes under `tmp/lidar_index_cache_20260529/`.

Interpretation rule when terminal logs are sparse:

1. Read the latest `attempt_status.json` first.
2. `phase = querying_lidar` means source and road-boundary stages succeeded and the run is in the expensive LiDAR query stage.
3. Do not relabel this as `Missing Source` unless a concrete source artifact/geometry prerequisite is actually missing or unreadable.

Tie-break rule:

- if a concrete missing or unreadable source artifact would unblock the run, use `Missing Source`
- otherwise use `Not Viable`

Allowed reasons are concrete filesystem or result states only, for example:

- `no project folder with geo_data.gpkg`
- `unreadable geo_data.gpkg`
- `missing project_metadata.json`
- `no matching source folder under in/`
- `multiple ambiguous source folders`
- `no overlapping LiDAR bundle and no validated nearby precedent`
- `metadata incomplete after build`
- `multiple equally plausible planning areas`
- `multiple equally plausible project candidates`

### Deterministic Selection Rules

Use these tie-break rules exactly.

Project selection for a target road:

1. Exact case-insensitive folder-name match under `profiles/alaster/projects/` wins.
2. Else exact case-insensitive `project_metadata.json.project_name` match wins.
3. Else exact case-insensitive `project_metadata.json.path_key` match wins.
4. Else if a project's `source_folders` JSON array contains an exact road source folder or a unique suffix-stripped source-folder match, that project wins.
5. Else a neighboring-project salvage candidate is allowed only if it retains target-road samples under the builder's road-boundary logic.
6. If multiple neighboring salvage candidates exist, prefer the one with the highest retained sample count.
7. If there is still a tie, stop with a blocker report.

Interpretation for step 4:

1. `source_folders` values are literal folder names such as `CONWAY GROVE_1Q2026`.
2. Compare against the array elements exactly, then against the unique suffix-stripped match.
3. If `source_folders` is absent or empty, do not guess; continue to the next tie-break rule.

Source-folder selection under `in/`:

1. Exact folder-name match wins.
2. Else one unique suffix-stripped match wins.
3. If more than one suffix-stripped match exists, stop with blocker reason `multiple ambiguous source folders`.

Planning-area selection:

1. If an exact canonical profile already exists for the target `path_key`, use that folder's parent planning area.
2. Else if validated canonical neighboring roads from the same local road cluster all live under one planning-area folder, use that area.
3. Else if the target project's `tags` contain exactly one value that exactly matches a real directory name already present under `backend/shapefiles/gradient_profiles/`, use it.
4. Else query `backend/shapefiles/planningareas/G_MP25_PLNG_AREA_NO_SEA_PL.shp` against the project's `geo_data.gpkg` trace and rank hits by overlap length.
5. If one planning area has the greatest overlap length, use it.
6. If there is still a tie, stop with blocker reason `multiple equally plausible planning areas`.

Validated nearby precedent means:

1. the precedent road already has a canonical promoted profile with usable metadata
2. the precedent road and target road resolve to the same planning area
3. the precedent road comes from the same local road cluster or estate, not a different town or planning area
4. the precedent can be named concretely from repo state, for example an existing canonical neighboring road in the same cluster
5. if you cannot name the precedent road and its planning area concretely, treat it as no validated nearby precedent

Current explicitly documented nearby-precedent cluster in this repo:

- the Serangoon estate local-road cluster around `burghley_drive`, `cardiff_grove`, `carisbrooke_grove`, `chartwell_drive`, `chuan_*`, `coniston_grove`, `conway_circle`, and `conway_grove`

LiDAR bundle selection:

1. If exact canonical or nearby validated metadata already establishes a bundle for the same local road cluster, reuse that bundle first.
2. Else if overlap finder returns exactly one bundle, use it.
3. Else if overlap finder returns a bundle whose name exactly matches the planning area, use that as primary.
4. Else if overlap finder returns both a plain planning-area bundle and a `D_..._LTA` bundle for the same area, use the plain planning-area bundle first and treat the `D_..._LTA` bundle as the compare-build candidate.
5. Else if multiple bundles remain and none is clearly preferred, use the first non-`D_` bundle alphabetically as primary.
6. If no non-`D_` bundle exists, use the first bundle alphabetically.
7. If there is no overlap result and no nearby validated precedent, stop with blocker reason `no overlapping LiDAR bundle and no validated nearby precedent`.

`alternate plausible bundle exists` means:

1. the LiDAR bundle selection rules identify one primary bundle and at least one specific remaining compare candidate for the same target road
2. the most common case is a plain planning-area bundle plus its paired `D_..._LTA` bundle
3. multiple bundle folders existing under the LiDAR root does not, by itself, make them plausible compare candidates for the target road
4. if the bundle selection rules do not leave a specific named secondary candidate, then no alternate plausible bundle exists

Compare-build evaluation data:

1. Required fields for compare-build and promotion decisions are `valid_gradient_count`, `profile_point_count`, `gradient_min_pct`, and `gradient_max_pct`.
2. Read those fields from `metadata.json` first.
3. If any are missing, derive them from `gradient_profile.csv` as:
   `profile_point_count = row count`
   `valid_gradient_count = non-empty gradient_pct row count`
   `gradient_min_pct = minimum non-empty gradient_pct`
   `gradient_max_pct = maximum non-empty gradient_pct`
4. If any required field still cannot be derived, the first result is incomplete.

Compare-build trigger:

1. Do not ask whether to run a compare build.
2. Run exactly one compare build only when the LiDAR bundle rules leave a specific alternate plausible bundle candidate and the first direct build is clearly weak or incomplete.
3. A first direct build is clearly weak if any of these are true:
   `valid_gradient_count == 0`
   `gradient_min_pct == gradient_max_pct`
   `profile_point_count < 20`
4. A first direct build is incomplete if any required compare-build field remains unavailable after the CSV fallback above.
5. If no alternate plausible bundle exists and the first result is incomplete, stop with blocker reason `metadata incomplete after build`.
6. If the first direct build has `valid_gradient_count > 0` and is not degenerate, do not force a compare build just because completion is low.
7. After one compare build, keep the better direct result and stop; do not keep branching.

## 3. What Counts As Done

A road is done only when all of these are true:

1. A canonical folder exists at
   `backend/shapefiles/gradient_profiles/<Planning Area>/<path_key>/`
2. That folder contains `gradient_profile.csv`, `node_gradient_preview.csv`, and `metadata.json`
3. `metadata.json` has the expected `path_key`
4. `valid_gradient_count` is present and greater than zero, unless the user explicitly accepted an empty result
5. If a true target-road project exists, its project metadata file has `path_key` set correctly; do not modify a neighboring salvage source project instead
6. Any requested summary txt file has been written in the exact format requested
7. This guide or the relevant markdown note has been updated if the user asked for it

## 4. Exact Gradient Formula

Yes. The core formula is the same every time unless the code changes.

After the path is stitched and sampled, the builder computes gradient percent as:

$$
\text{gradient \%} = \frac{z_{right} - z_{left}}{x_{right} - x_{left}} \times 100
$$

In code terms, this is:

- left endpoint elevation = `z_left`
- right endpoint elevation = `z_right`
- horizontal distance along chainage = `distance`
- computed value = `(z_right - z_left) / distance * 100.0`

Important detail:
- This is not a one-sided slope at a single point.
- It uses a centered baseline window around each sampled chainage point.

What changes between runs is usually not the formula itself. What changes is:
- the LiDAR bundle used
- the road-boundary trimming result
- the baseline length
- the sample spacing
- the smoothing window
- the outlier / seam-jump rejection outcome

## 5. Current Default Build Parameters

Unless there is a strong reason to do otherwise, assume these defaults:

- `spacing_m = 2.0`
- `baseline_m = 10.0`
- `smooth_window_m = 8.0`
- `search_radius_m = 5.0`
- `offroad-policy = trim`
- `target-road-name = exact uppercase road name`

Current gradient grade threshold in the builder:
- `GRADE_THRESHOLD_PCT = 8.748`

Meaning:
- `abs(gradient_pct) >= 8.748` becomes Grade `2`
- otherwise Grade `1`

## 6. Exact Build Pipeline

The builder does these steps in this order:

1. Read ordered project geometry from `geo_data.gpkg`
2. Stitch project segments into one centerline
3. Sample the centerline at fixed spacing
4. If `target-road-name` is provided, nearest-map sampled points to road sections and trim off-road points when `offroad-policy=trim`
5. Query LiDAR elevations near each sampled point
6. Reject local elevation outliers with a rolling median window
7. Reject seam / step jumps iteratively when adjacent elevation changes are too large
8. Smooth the cleaned elevation profile with a rolling median
9. Compute gradient percent using the centered baseline formula above
10. Repair isolated bad gradient spikes
11. Remove bad gradient stretches when they fail the cleanup rule
12. Write `gradient_profile.csv`, `node_gradient_preview.csv`, and `metadata.json`

If step-jump rejection is very high, usable completion can collapse even when LiDAR footprint coverage looks good.

## 7. Absolute Do / Do Not List

Do this:

1. Check whether a canonical profile already exists before proposing a rebuild.
2. Read `metadata.json` before deciding anything.
3. Use explicit `--path-key` when building.
4. Build to `tmp/` first.
5. Promote to canonical storage only after checking the temp build.
6. Keep canonical folders grouped by planning area.
7. Use the planning-area shapefile if the correct area folder is unclear.
8. Reuse or derive compare-build fields from `gradient_profile.csv` before deciding that metadata is unusable.
9. Recompute batch-summary counts from the per-road rows instead of hand-typing them.

Do not do this:

1. Do not write master outputs directly into a project folder.
2. Do not use quarter-suffixed dataset names as the canonical `path_key` unless that is explicitly intended.
3. Do not invent a new storage layout.
4. Do not leave successful temp outputs unpromoted and then claim the road is finished.
5. Do not forget to update `project_metadata.json`.
6. Do not write headers or commentary into a user-requested simple completion txt file.
7. Do not reorganize canonical folders without keeping them under planning-area subfolders.
8. Do not write a target road `path_key` into a neighboring salvage source project's `project_metadata.json`.
9. Do not apply salvage-only promotion cutoffs to direct builds.

## 8. First Decision Tree For Any Future LLM

If the user asks about a road, follow this order exactly.

Case A: User only wants the completion percentage.

1. Find the canonical profile folder.
2. Open `metadata.json`.
3. Read `usable_gradient_completion_pct`.
4. If that field is missing and metadata still has both inputs, compute it manually as:
   `valid_gradient_count / profile_point_count * 100`
5. If both counts are missing from metadata, read `gradient_profile.csv` and use:
   `profile_point_count = row count`
   `valid_gradient_count = non-empty gradient_pct row count`
6. If metadata and CSV still do not provide those values, report that completion cannot be derived from the available files.
7. Return the percentage.
8. Do not rebuild anything.

Case B: User wants a new build for a road.

1. Normalize the requested road into an expected `path_key`.
2. Check whether a canonical profile already exists.
3. If one exists, inspect metadata before rebuilding.
4. Check for an exact live project under `profiles/alaster/projects/<Project Name>/`.
5. If it is missing, search `profiles/alaster/projects/`, `data/`, and `in/` for exact-name or obvious quarter-suffixed matches before asking the user anything.
6. If the workspace still has no usable project/source geometry, stop and report the exact blocker.
7. Run overlap screening only if you have a real project directory containing `geo_data.gpkg`; otherwise use validated nearby precedent as defined above or stop.
8. Build to `tmp/<some_batch_folder>/<path_key>/`.
9. Validate metadata.
10. Promote to `backend/shapefiles/gradient_profiles/<Planning Area>/<path_key>/` only if the temp result is credible.
11. Apply the single project metadata mutation rule from Section 10.
12. Write the user-requested summary file if needed.
13. If blocked at any point, return the exact blocker report and stop instead of asking the user a question.

Case C: User wants gradients organized by area.

1. Treat `backend/shapefiles/gradient_profiles/<Planning Area>/<path_key>/` as the required structure.
2. Use the planning-area shapefile when the area is unclear.
3. Do not flatten the folders again.

Before asking the user anything, do this exact discovery pass:

1. Search canonical profiles under every planning-area folder first.
2. Search `profiles/alaster/projects/` for exact road folders, then nearby obvious neighbor projects.
3. Search `data/` and `in/` for exact road names and uppercase quarter-suffixed source folders.
4. Search `tmp/` for prior batch outputs, build logs, and salvage attempts.
5. Infer planning area from existing canonical neighbors when the cluster is obvious.
6. Infer the first-pass bundle from nearby validated metadata or overlap output before asking.
7. If the user asked for a percentage only, do not ask about batch folders or summary txt paths.
8. If the user asked for a file but not the exact path, default to `tmp/<batch_name>_completion.txt` instead of bouncing the question back.
9. If the user did not specify a temp batch folder, default to `tmp/gradient_batch_<YYYYMMDD>/`; use `tmp/gradient_salvage_<YYYYMMDD>/` only for derived-road probes.
10. If the default same-day folder already exists and that earlier attempt must remain readable, create a new same-day folder suffixed `_retry2`, `_retry3`, and so on instead of overwriting the earlier one.
11. Ask the user only if these searches still leave a real blocker.

Deterministic default names:

1. Default batch folder: `tmp/gradient_batch_<YYYYMMDD>/`
2. Default salvage batch folder: `tmp/gradient_salvage_<YYYYMMDD>/`
3. Default summary txt path when requested without a path: `tmp/gradient_batch_<YYYYMMDD>_completion.txt`
4. Default batch summary paths for multi-road batch runs: `tmp/gradient_batch_<YYYYMMDD>/batch_summary.json` and `tmp/gradient_batch_<YYYYMMDD>/batch_summary.tsv`
5. Do not create batch summary files for a single-road percentage lookup unless the user explicitly asked for a batch artifact.

If batch summary files are written, follow these rules in the guide itself:

1. `generated_at_utc` must use system UTC in ISO 8601 form with a trailing `Z`, for example `2026-05-28T10:30:56Z`.
2. Recompute the `counts` object from the final per-road rows after every status change.
3. `counts.total` must equal the number of road rows.
4. The sum of `canonical_existing + promoted + temp_only + blocked` must equal `counts.total`.
5. If the default same-day folder already exists and that earlier attempt must remain readable, create a new same-day folder suffixed `_retry2`, `_retry3`, and so on instead of overwriting the earlier one.
6. Every road row in `batch_summary.json` and `batch_summary.tsv` must include `blocked_label`.
7. For `canonical_existing`, `promoted`, and `temp_only`, set `blocked_label = null` in JSON and leave it blank in TSV.
8. For `blocked`, `blocked_label` is required and must be exactly `Missing Source` or `Not Viable`.
9. If `blocked_label = Missing Source`, the blocker reason or row notes must identify the missing or unreadable source artifact or geometry gap.
10. If `blocked_label = Not Viable`, the blocker reason or row notes must identify the LiDAR, coverage, retained-sample, ambiguity, or result-quality condition that made the road non-viable.

Current repo-specific default:

1. For the current local-road Serangoon estate cluster around `burghley_drive`, `cardiff_grove`, `carisbrooke_grove`, `chartwell_drive`, `chuan_*`, `coniston_grove`, `conway_circle`, and `conway_grove`, planning area is `Serangoon` and the first-pass LiDAR bundle is `Serangoon` unless overlap data or existing metadata contradicts it.

## 9. Exact Commands To Reuse

These commands are safe templates. Change placeholders only.

Search workspace state before asking the user:

```powershell
Get-ChildItem 'data' -Directory | Select-Object -ExpandProperty Name
Get-ChildItem 'in' -Directory | Select-Object -ExpandProperty Name
Get-ChildItem 'backend\shapefiles\gradient_profiles' -Directory -Recurse | Select-Object -ExpandProperty FullName
```

Check actual project metadata before deriving anything:

```powershell
Get-Content 'data\<Project Name>\project_metadata.json'
```

Show only the metadata fields this workflow actually uses:

```powershell
Get-Content 'data\<Project Name>\project_metadata.json' | ConvertFrom-Json | Select-Object project_name,dataset,path_key,source_folders,tags
```

Check completion from metadata:

```powershell
.\Gradient Calculation\show_gradient_completion.cmd "backend\shapefiles\gradient_profiles\<Planning Area>\<path_key>\metadata.json"
```

Determine planning area from the project trace when canonical neighbors do not settle it:

```powershell
& 'C:\Users\Alaster\miniconda3\envs\psat\python.exe' -c "from pathlib import Path; import geopandas as gpd; project = Path(r'profiles/alaster/projects/<Project Name>/geo_data.gpkg'); areas = gpd.read_file(r'backend/shapefiles/planningareas/G_MP25_PLNG_AREA_NO_SEA_PL.shp'); trace = gpd.read_file(project); areas2 = areas.to_crs(trace.crs) if areas.crs and trace.crs and areas.crs != trace.crs else areas; geom = trace.geometry.union_all(); hits = areas2[areas2.intersects(geom)].copy(); hits['overlap_m'] = hits.geometry.intersection(geom).length; print(hits[['PLN_AREA_N','PLN_AREA_C','overlap_m']].sort_values('overlap_m', ascending=False).to_string(index=False))"
```

If multiple planning areas are listed, choose the one with the greatest `overlap_m`; if there is still a tie, stop with a blocker.

Find overlapping LiDAR bundles:

```powershell
& 'C:\Users\Alaster\miniconda3\envs\psat\python.exe' 'Gradient Calculation\find_lidar_bundle_overlaps.py' --project-dir 'data\<Project Name>' --laz-root '<LiDAR root>'
```

Run the overlap finder only after confirming `profiles\alaster\projects\<Project Name>\geo_data.gpkg` exists and is readable with non-empty geometry. If it is missing, stop with blocker reason `no project folder with geo_data.gpkg`; if it is unreadable or empty, stop with blocker reason `unreadable geo_data.gpkg`.

Build a road to temp output:

```powershell
& 'C:\Users\Alaster\miniconda3\envs\psat\python.exe' 'Gradient Calculation\build_path_gradient_profile.py' --laz-dir '<LiDAR root>\<Bundle>' --project-dir 'data\<Project Name>' --path-key '<path_key>' --output-dir 'tmp\<batch_folder>\<path_key>' --target-road-name '<UPPERCASE ROAD NAME>' --offroad-policy trim
```

`<LiDAR root>` is typically `E:\LIDAR` — verify it exists before running (see drive-swap note above). `<Bundle>` is the literal top-level subfolder name under that root.

If the source project folder name is not the target road name, add:

```powershell
--display-name '<Road Name Title Case>'
```

For every salvage build from a neighboring project, this `--display-name` flag is mandatory.

## 10. Promotion Checklist

Before promotion, verify all of these in the temp folder:

1. `metadata.json` exists
2. `gradient_profile.csv` exists
3. `node_gradient_preview.csv` exists
4. `metadata.json` has the correct `path_key`
5. `valid_gradient_count` is not zero unless an empty result was explicitly accepted
6. For direct builds, any non-degenerate completion is acceptable; do not invent a numeric completion floor, and do not apply the salvage-only completion guardrail below.
7. The result is not an obviously weak salvage artifact unless the user explicitly accepted that tradeoff

Metadata completeness rule for validation:

1. Required compare-build fields are `valid_gradient_count`, `profile_point_count`, `gradient_min_pct`, and `gradient_max_pct`.
2. Read them from `metadata.json` first.
3. If any are missing, derive them from `gradient_profile.csv`.
4. If they still cannot be derived, the temp result is incomplete and non-promotable.
5. If an alternate plausible bundle exists, one compare build is allowed; otherwise stop with blocker reason `metadata incomplete after build`.

Credibility rule for autonomous promotion:

1. There is no single numeric minimum for a direct build from a true target-road project. Low direct-build completions can still be promotable if the build is real, metadata is complete, `valid_gradient_count > 0`, gradients are not obviously degenerate, and no better compare build is still owed.
2. A salvage build from a neighboring project is non-promotable by default.
3. Autonomous salvage rule from the 2026-05-28 Serangoon batch: do not promote salvage when any of these are true:
   `profile_point_count < 20`
   `usable_gradient_completion_pct < 10`
   `valid_gradient_count == 0`
   `gradient_min_pct == gradient_max_pct`
   This `usable_gradient_completion_pct < 10` guardrail is salvage-only, comes from the weak 2026-05-28 Serangoon salvage probes, and is intentionally strict `< 10.00`, not `<= 10.00`.
4. Keep weak salvage results in `tmp/` as evidence only unless the user explicitly accepts them or a real target-road project later confirms the road.
5. For direct builds, promote when the build is real, metadata is complete, `valid_gradient_count > 0`, the result is not degenerate, and no compare build is still owed under the compare-build trigger above.

`Compare build` definition:

1. A compare build is a second build of the same target road run only to compare against the first result before promotion.
2. Common compare cases are:
   alternate LiDAR bundle, for example `Serangoon` vs `D_Serangoon_LTA`
   materially different build settings, for example a different baseline after a weak first pass
   a weak or implausible first result that needs one more direct attempt before deciding
3. If a compare build is likely, treat the batch as smaller and slower work.

After promotion, verify all of these:

1. Canonical folder exists under the correct planning-area folder
2. Only the true target-road project's metadata was updated, if that target project exists
3. No neighboring salvage source project's metadata was changed
4. The summary txt file exists if requested

Single project metadata mutation rule used throughout this guide:

1. Update `profiles/alaster/projects/<Target Project>/project_metadata.json` only after promotion, only for the true target-road project, and never for `temp_only`, `blocked`, compare-only, or canonical-existing read-only cases.
2. Do not edit any `project_metadata.json` for `temp_only`, `blocked`, compare-only, or canonical-existing read-only cases.
3. Never write a target-road `path_key` into a neighboring salvage source project's metadata.
4. If no true target-road project folder exists, leave all project metadata untouched and record that fact in the summary or blocker output.

## 11. Planning Area Organization Rule

Canonical profiles are grouped by planning area.

Current pattern:
- `backend/shapefiles/gradient_profiles/Ang Mo Kio/<path_key>/`
- `backend/shapefiles/gradient_profiles/Hougang/<path_key>/`
- `backend/shapefiles/gradient_profiles/Serangoon/<path_key>/`
- `backend/shapefiles/gradient_profiles/Toa Payoh/<path_key>/`

If the user says a batch belongs to Serangoon, promote those roads under:
- `backend/shapefiles/gradient_profiles/Serangoon/<path_key>/`

Backend lookup already supports nested area folders. Do not revert to a flat folder layout.

## 11a. Scope: Phase 2 — Central and Surrounding Planning Areas

**Phase 1 (NE Region) is complete.** The E: drive has been replaced with a Central/West Singapore LiDAR dataset. The NE region bundles (Serangoon, Hougang, Sengkang, Punggol) no longer exist on E:. Do not attempt to rebuild NE roads — the canonical profiles are the final record.

**Current phase covers these planning areas** (using `E:\LIDAR\` as root):

| Planning Area | Primary Bundle | Secondary / Notes |
|---|---|---|
| Bishan | `D_Bishan` (767 LAZ in LAZ_PartA + LAZ_PartB) | No plain Bishan bundle; D_Bishan is primary |
| Bukit Merah | `D_BukitMerah` | Also `D_Bukit_Merah_&_Clementi_LTA` |
| Bukit Timah | `D_BukitTimah` | Also `Zone A_Bukit_Timah_LTA` |
| Geylang | `D_Geylang_LTA` | |
| Kallang | `D_Kallang_LTA` | |
| Marine Parade | `Marine Parade` | |
| Novena | `D_Novena` | |
| Queenstown | `D_Queenstown` | Also `D_Queenstown_LTA` |
| Tanglin | `D_Tanglin_LTA` | |
| Toa Payoh | `D_Toa Payoh` (324 LAZ) | Previous note that TPY has no LiDAR is **obsolete** — D_Toa Payoh now available |
| Central Area | `D_Downtown_Core_LTA`, `D_Museum_LTA`, `D_Newton_LTA`, `D_Orchard_LTA`, `D_Outram_LTA`, `D_River Valley_LTA`, `D_Rochor_LTA`, `D_Singapore_River_LTA` | Use sub-area bundle by road location |

**Bundle naming note:** Most Phase 2 bundles are `D_` prefixed (LTA supplemental scans). There are no plain planning-area bundles (like `Serangoon` or `Hougang_02`). Apply the bundle selection rule: if no non-`D_` bundle exists, use the `D_` bundle as primary.

**Phase 1 NE Region — complete, do not rebuild:**

| Planning Area | Status |
|---|---|
| Serangoon | **Complete** (2026-05-29 to 2026-05-31) |
| Hougang | **Complete** (2026-05-31) |
| Sengkang | **Complete** (2026-06-01) |
| Punggol | **Complete** (2026-06-01) |
| Ang Mo Kio | Partial (old dataset only; NE LiDAR no longer on E:) |

## 12. Current Validated Serangoon Results From 2026-05-28

Previously validated subset:

- `burghley_drive` = `42.41%`
- `cardiff_grove` = `53.43%`
- `carisbrooke_grove` = `28.08%`
- `chartwell_drive` = `27.97%`
- `chepstow_close` = `59.18%`
- `chiltern_drive` = `73.90%`
- `chiselhurst_grove` = `43.94%`
- `chuan_close` = `5.68%`
- `chuan_drive` = `18.70%`
- `chuan_garden` = `40.00%`

Second validated subset:

- `chuan_lane` = `86.90%`
- `chuan_link` = `18.99%`
- `chuan_place` = `8.13%`
- `chuan_terrace` = `23.05%`
- `chuan_view` = `20.00%`
- `chuan_walk` = `59.13%`
- `clifton_vale` = `34.12%`
- `colchester_grove` = `57.19%`
- `coniston_grove` = `71.60%`
- `conway_circle` = `51.63%`
- `conway_grove` = `34.31%`

Third validated subset (2026-05-29 batch):

- `cooling_close` = `31.40%`
- `corfe_place` = `58.18%`
- `cotswold_close` = `44.77%`
- `court_road` = `11.76%`
- `cowdray_avenue` = `44.61%`

These were validated under:
- `backend/shapefiles/gradient_profiles/Serangoon/<path_key>/`

Fourth validated subset (2026-05-29 batch retry4):

- `farleigh_avenue` = `32.29%`
- `gambir_walk` = `53.00%`
- `golden_drive` = `25.00%`
- `golden_rise` = `38.89%`
- `golden_walk` = `83.05%`

Fifteenth validated subset (2026-05-31 batch retry3 — final Serangoon batch S–Y + Chuan Grove; NE2/SE1 use Serangoon, NE3 use D_Serangoon_LTA; TAVISTOCK AVENUE used NE2 source (338 imgs) over NE3 (2 imgs); BOUNDARY CLOSE not viable — 10m stub, GPS trace on AMK Ave 1, zero LiDAR in both bundles):

- `stratton_road` = `31.11%`
- `stratton_walk` = `44.44%`
- `summer_place` = `38.54%`
- `sundridge_park_road` = `51.20%`
- `sunshine_terrace` = `27.86%`
- `tai_hwan_avenue` = `29.87%`
- `tai_hwan_close` = `43.55%`
- `tai_hwan_crescent` = `39.44%`
- `tai_hwan_drive` = `71.43%`
- `tai_hwan_grove` = `39.51%`
- `tai_hwan_heights` = `28.52%`
- `tai_hwan_lane` = `85.00%`
- `tai_hwan_place` = `79.66%`
- `tai_hwan_terrace` = `41.01%`
- `tai_hwan_walk` = `54.29%`
- `tai_yuan_heights` = `59.28%`
- `tamarind_road` = `25.64%`
- `tavistock_avenue` = `28.10%`
- `upper_neram_road` = `38.66%`
- `vaughan_road` = `70.09%`
- `walmer_drive` = `55.19%`
- `wolskel_road` = `30.46%`
- `worthing_road` = `56.90%`
- `york_place` = `14.29%`
- `chuan_grove` = `19.64%`

Fourteenth validated subset (2026-05-31 batch retry2 — Serangoon/Sommerville/Stratton roads; NE2/SE1 use Serangoon, NE3 use D_Serangoon_LTA; ST. HELIER'S AVENUE missing from Lighthaus):

- `serangoon_central_drive` = `73.87%`
- `serangoon_garden_close` = `66.67%`
- `serangoon_garden_drive` = `37.25%`
- `serangoon_garden_place` = `39.47%`
- `serangoon_garden_rise` = `47.73%`
- `serangoon_garden_terrace` = `28.36%`
- `serangoon_lane` = `11.11%`
- `serangoon_link` = `43.81%`
- `serangoon_north_avenue_2` = `45.68%`
- `serangoon_north_avenue_3` = `31.20%`
- `serangoon_north_avenue_6` = `31.14%`
- `serangoon_north_view` = `69.23%`
- `serangoon_terrace` = `25.34%`
- `sommerville_road` = `29.08%`
- `sommerville_walk` = `46.06%`
- `stokesay_drive` = `16.25%`
- `stratton_drive` = `35.97%`
- `stratton_green` = `59.26%`
- `stratton_place` = `28.26%`

Thirteenth validated subset (2026-05-31 batch — R–S roads; NE2/SE1 use Serangoon, NE3 use D_Serangoon_LTA; SARACA TERRACE missing from Lighthaus):

- `recreation_lane` = `46.43%`
- `recreation_road` = `51.04%`
- `ripley_crescent` = `34.38%`
- `sandown_place` = `38.46%`
- `saraca_drive` = `29.41%`
- `saraca_hill` = `31.25%`
- `saraca_place` = `24.14%`
- `saraca_road` = `38.48%`
- `saraca_view` = `22.25%`
- `saraca_walk` = `44.13%`
- `seletar_close` = `24.52%`
- `seletar_court` = `31.88%`
- `seletar_crescent` = `19.88%`
- `seletar_green_avenue` = `23.16%`
- `seletar_green_view` = `43.86%`
- `seletar_green_walk` = `59.23%`
- `seletar_hills_drive` = `22.61%`
- `seletar_terrace` = `22.40%`
- `serangoon_avenue_4` = `82.75%`

Twelfth validated subset (2026-05-31 batch retry6 — M–R roads; NE2/SE1 use Serangoon, NE3 use D_Serangoon_LTA; MORETON CLOSE not viable — only 5 images):

- `mimosa_terrace` = `20.67%`
- `mimosa_vale` = `18.42%`
- `mimosa_view` = `30.80%`
- `mimosa_walk` = `35.05%`
- `muswell_hill` = `54.55%`
- `neram_crescent` = `27.60%`
- `neram_road` = `16.28%`
- `nim_crescent` = `18.71%`
- `nim_drive` = `42.90%`
- `nim_green` = `30.85%`
- `nim_rise` = `46.62%`
- `nim_road` = `32.09%`
- `nim_terrace` = `44.16%`
- `penshurst_place` = `24.52%`
- `pillai_road` = `22.54%`
- `plantation_avenue` = `17.69%`
- `portchester_avenue` = `50.85%`
- `quemoy_road` = `22.86%`
- `raglan_grove` = `30.30%`

Eleventh validated subset (2026-05-30 batch retry5 — L–M roads; NE2/SE1 use Serangoon, NE3 use D_Serangoon_LTA; LUXUS HILL HEIGHTS missing from Lighthaus):

- `ludlow_place` = `38.89%`
- `luxus_hill_avenue` = `51.17%`
- `luxus_hill_drive` = `53.73%`
- `luxus_hill_road` = `34.15%`
- `luxus_hill_view` = `37.50%`
- `lynwood_grove` = `40.98%`
- `mackerrow_road` = `42.31%`
- `maju_avenue` = `50.00%`
- `marlene_avenue` = `81.39%`
- `matlock_rise` = `65.25%`
- `medway_drive` = `47.67%`
- `mei_hwan_crescent` = `37.11%`
- `mei_hwan_drive` = `23.30%`
- `mei_hwan_road` = `14.29%`
- `melrose_drive` = `54.55%`
- `mimosa_crescent` = `35.20%`
- `mimosa_drive` = `2.58%`
- `mimosa_place` = `63.91%`
- `mimosa_road` = `24.36%`

Tenth validated subset (2026-05-30 batch retry4 — K–L roads; NE2/SE1 use Serangoon, NE3 use D_Serangoon_LTA):

- `kingswear_avenue` = `26.49%`
- `lew_lian_vale` = `28.57%`
- `li_hwan_close` = `38.22%`
- `li_hwan_place` = `18.06%`
- `li_hwan_terrace` = `77.50%`
- `li_hwan_view` = `28.57%`
- `li_hwan_walk` = `20.83%`
- `lichfield_road` = `22.96%`
- `lilac_drive` = `57.40%`
- `lilac_road` = `29.51%`
- `lilac_walk` = `40.00%`
- `lim_tua_tow_road` = `56.51%`
- `lorong_biawak` = `100.00%`
- `lorong_gambir` = `43.97%`
- `lorong_how_sun` = `40.59%`
- `lorong_lew_lian` = `39.44%`
- `lorong_ong_lye` = `21.59%`
- `lorong_penchalak` = `72.53%`
- `lorong_selangat` = `32.96%`

Ninth validated subset (2026-05-30 batch retry3 — Jalan R–S, Joon Hiang, Kasai, Kelulut Hill, Kensington; NE2/SE1 use Serangoon, NE3 use D_Serangoon_LTA):

- `jalan_riang` = `26.16%`
- `jalan_rindu` = `35.92%`
- `jalan_selaseh` = `17.28%`
- `jalan_sindor` = `25.40%`
- `jalan_sukachita` = `67.23%`
- `jalan_teck_kee` = `41.67%`
- `joon_hiang_road` = `48.16%`
- `kasai_road` = `28.50%`
- `kelulut_hill` = `33.82%`
- `kensington_park_road` = `23.36%`

Eighth validated subset (2026-05-30 batch retry2 — Jalan P–R roads; NE2/SE1 use Serangoon, NE3 use D_Serangoon_LTA):

- `jalan_pacheli` = `65.15%`
- `jalan_pelajau` = `10.47%`
- `jalan_peradun` = `34.86%`
- `jalan_redop` = `23.48%`
- `jalan_rengas` = `6.32%`
- `jalan_resak` = `35.16%`
- `jalan_ria` = `5.71%`

Seventh validated subset (2026-05-30 batch — Jalan K–L roads; NE3 use D_Serangoon_LTA, SE1 use Serangoon):

- `jalan_kesoma` = `52.04%`
- `jalan_kelulut` = `25.17%`
- `jalan_kenarah` = `13.79%`
- `jalan_keruing` = `26.37%`
- `jalan_ketumbit` = `11.98%`
- `jalan_labu_ayer` = `31.23%`
- `jalan_lakum` = `34.34%`
- `jalan_lateh` = `57.38%`
- `jalan_lebat_daun` = `20.48%`
- `jalan_lekub` = `52.63%`

Non-promoted from this batch: `JALAN LABU MANIS` — only 1 image in Lighthaus SE1, insufficient for GPS trace (Not Viable). `JALAN LABU MERAH` — GPS trace entirely on JALAN LABU AYER (road too short at 21.7m, misidentified in shapefile), 2 valid gradients only (Not Viable).

Sixth validated subset (2026-05-29/30 batch retry6 — Jalan roads; NE3 roads use D_Serangoon_LTA, NE2/SE1 use Serangoon):

- `jalan_antoi` = `10.31%`
- `jalan_bangau` = `36.25%`
- `jalan_chermai` = `25.74%`
- `jalan_chermat` = `37.72%`
- `jalan_chulek` = `12.84%`
- `jalan_girang` = `47.70%`
- `jalan_hwi_yoh` = `14.89%`
- `jalan_jarak` = `25.50%`
- `jalan_jitong` = `58.93%`
- `jalan_joran` = `12.03%`

Fifth validated subset (2026-05-29 batch retry5):

- `grace_park` = `68.42%`
- `grace_walk` = `42.98%`
- `hemsley_avenue` = `46.83%`
- `how_sun_close` = `23.81%`
- `how_sun_drive` = `21.43%`
- `how_sun_road` = `10.59%`
- `how_sun_walk` = `21.67%`
- `huddington_avenue` = `63.76%`
- `hythe_road` = `58.37%`

Non-promoted from retry5: `HOW SUN AVENUE` — Serangoon bundle produced degenerate result (1/47 valid, 0.00%–0.00%); D_Serangoon_LTA had zero tile coverage; classified Not Viable.

Current non-promotable Serangoon missing-road note from 2026-05-28:

- `CRICHTON CLOSE` only had salvage coverage from `Burghley Drive`; temp result was `4.35%` and was not promoted.
- `CROWHURST DRIVE` only had salvage coverage from `Chartwell Drive`; temp result was `0.00%` and was not promoted.
- `CROUCHER ROAD`, `DAISY AVENUE`, and `DAISY ROAD` had no exact live project or source-folder geometry in the workspace as of 2026-05-29.
- `DEDAP LINK`
- `DEDAP PLACE`
- `DEDAP ROAD`
- `DUNSFOLD DRIVE`
- `EDEN GROVE`

## 13. Exact Rule For The Simple Completion TXT File

If the user asks for a simple txt file, follow these rules exactly.

1. One road per line.
2. Format is:
   `ROAD NAME XX.XX%`
3. No header.
4. No bullets.
5. No extra commentary.
6. If a road truly failed or has no accepted canonical result, **leave the percentage blank** — do not write `N/A`, `-`, `0`, or any other token. The completion value feeds a spreadsheet column that only accepts numbers, so any non-numeric text breaks it. In the txt file this means writing just `ROAD NAME` (no percentage) for that road; in output tables it means an empty `Completion %` cell.
7. If the user says to override the file, replace the entire file contents.
8. In any output list or table returned to the user, the percentage column must contain only `XX.XX%` — a plain number followed immediately by `%`. No surrounding text, no parentheticals, no labels such as "completion" or "usable". The number and the `%` operator are the entire cell value.
9. Return the output list in the exact order the user submitted the roads. Do not sort, regroup, or reorder by status, bundle, or any other field. Preserve the user's original sequence.
10. Use exactly these status labels in output tables (case-sensitive): `Done`, `Not Viable`, `Missing Source`. Do not use "promoted", "blocked", "canonical_existing", or any other label in user-facing output tables.
11. All output tables returned to the user must use exactly these three column headers in this order: `Name`, `Status`, `Completion %`. No extra columns, no renamed headers.

## 14. What To Update After Each Batch

If the user says to update the markdown, do both of these:

1. Update this file's validated-results section if the batch materially changes the known state.
2. Keep the storage rules and exact workflow current if the code or folder layout changes.

Do not leave stale path examples in this file.

## 15. Minimal Handoff Prompt For A Weak Replacement Model

Use this prompt if you need to hand the workflow to another model:

"Read `Gradient Calculation/LAZ_to_Gradient_Guide.md` and `docs/openrouter-deepseek-gradient-runbook.md` fully first. Do not invent a new workflow. Canonical gradient outputs live under `backend/shapefiles/gradient_profiles/<Planning Area>/<path_key>/`. Current live projects are under `data/<Project Name>/`. LiDAR root is `E:\\LIDAR\\`. Before asking the user anything, search canonical profiles, `data/`, `in/`, and `tmp/` in that order. Do not ask the user for planning area, LiDAR bundle, batch folder, summary txt path, or project existence until those searches are done. The Phase 2 active planning areas are Bishan, Bukit Merah, Bukit Timah, Geylang, Kallang, Marine Parade, Novena, Queenstown, Tanglin, Toa Payoh, and Central Area sub-areas. Their primary LiDAR bundles are named `D_<PlanningArea>` or `D_<PlanningArea>_LTA` under `E:\\LIDAR\\`. Some bundles store LAZ files in subdirectories (e.g. `D_Bishan\\LAZ_PartA`) — the builder is recursive, so pass the top-level bundle folder. If the workspace has no source geometry, report the exact blocker and searched paths instead of asking open-ended setup questions. If building, use an explicit `--path-key`, build to `tmp/` first, validate `metadata.json`, then promote only credible outputs and apply the single project metadata mutation rule after promotion only. If asked for a simple txt summary, write only `ROAD NAME XX.XX%` lines with no header or commentary." 

Additional mandatory clarifications for weak models:

1. `path_key` is lowercase with runs of non-alphanumeric characters collapsed to `_`; do not expand abbreviations automatically.
2. `Project Name` is the literal project folder name under `profiles/alaster/projects/`; do not derive it from `path_key`.
3. A LiDAR bundle is the literal top-level folder name under `E:\3D point cloud GSV_NorthEast_30092025\`.
4. Always pass explicit `--output-dir`; the builder's default output path is legacy flat and not the canonical planning-area layout.
5. If `usable_gradient_completion_pct` and its metadata counts are missing, derive completion from `gradient_profile.csv` row count and non-empty `gradient_pct` rows.
6. Do not ask the user follow-up questions during execution; infer, default, compare-build, or emit the exact blocker report format from this guide.
7. A build is salvage when the source project folder name differs from the target road name; salvage builds must pass `--display-name` and remain `temp_only` by default unless the promotion rules later allow otherwise.
8. If you write batch summary files, recompute counts from the road rows and write `generated_at_utc` in ISO 8601 UTC with a trailing `Z`.

## 16. Planning Area Audit CSV Format

Planning area audit files live under `planning_csvs/<Planning Area>.csv`.

Columns: `Name`, `Priority`, `Status`, `Completion`, `Coverage`

**Priority** values are caps-sensitive; only these three are valid:

| Value | Meaning | Source categories |
|---|---|---|
| `high` | Major arterial or expressway | CAT1, CAT2, CAT3 in `ROADSECTIONLINE.shp` |
| `medium` | Minor arterial / collector | CAT4 |
| `low` | Local access or unclassified | CAT5, NCAT |

Priority is derived from `RD_CATG_CD` in `backend/shapefiles/planningareas/ROADSECTIONLINE.shp`. Do not guess or re-derive it — the column is already populated in the CSVs. Never change `high` / `medium` / `low` casing.

## 17. Claude Code + OpenRouter Batch Rule

If this workflow is being run through Claude Code with OpenRouter and DeepSeek V4 Flash, use the companion runbook.

Default rule for a roughly 2-hour run:

1. Start with `8` roads in one planning area and one LiDAR bundle.
2. Only increase to `10` roads if the roads are all short local roads and there is no expected compare build.
3. Drop to `6` roads if the batch includes long arterials, uncertain bundle choices, or likely manual cleanup.
4. Do not try to clear an entire town in one run.
5. Save state to files after every batch; do not rely on chat history as the source of truth.

## 18. Centerline-Trace Method (validated 2026-07-06/07)

When a target road has no live project (no `geo_data.gpkg` anywhere under
`profiles/*/projects/`, `data/`, or a stageable `in/` source), do not treat this as an
automatic `Missing Source` blocker. Build `geo_data.gpkg` directly from the official road
centerline in `ROADSECTIONLINE.shp` instead. This method is now validated across roughly 70
roads (mixed arterials, expressways, and Novena local roads) and is preferred over the
image-GPS-trace workflow whenever no project exists yet, because it gives full-length
road coverage instead of a partial trace bounded by wherever geotagged photos happened to
be taken.

### Why this is normally better than an image-derived trace

The old image-GPS-trace method only covers the road wherever the source photo set actually
walked. Partial photo coverage was the direct cause of several of the weakest historical
canonical results (for example a Bukit Timah road that had only 1 valid gradient point from
a 27-point trace). A centerline-derived trace covers the entire official road length, so the
completion percentage is limited only by real elevation/LiDAR/seam-noise factors, not by
missing photographic coverage.

### Build steps

1. Read `ROADSECTIONLINE.shp`, select all `RD_NAM` rows matching the target road
   (case-insensitive exact match), reproject to EPSG:3414 if needed.
2. Chain the matched sections into one connected centerline using greedy nearest-endpoint
   ordering (start from the longest section, repeatedly attach the nearest remaining
   endpoint to either end of the growing chain). Reverse a section's coordinate order when
   its far endpoint is the closer match.
3. Stop growing the chain when the nearest remaining endpoint gap exceeds `--gap-max`
   (default `60.0` meters). Increase to `150.0` when a short local road's official sections
   are still legitimately split by more than 60 m (common for `JALAN`-prefixed and other
   short residential roads) but do not blindly raise it further without checking whether the
   remaining unchained length is a real disconnection (some roads are genuinely split into
   unrelated segments by an intervening road or park; do not force-bridge those).
4. Write a GeoPackage table named `geo_data` with columns `fid, geom, "Image Reference",
   "Road Name", "Distance (Metres)"` — this is the exact schema
   `build_path_gradient_profile.py::load_project_segments()` expects. The geometry column
   must be named `geom` (GeoPandas defaults to `geometry`; rename it before writing, e.g.
   `gdf.rename_geometry("geom")`), and CRS must be EPSG:3414. `Image Reference` can be left
   null; the builder does not require it for the centerline path.
5. Use this generated `geo_data.gpkg` as `--project-dir` in the normal build command. No
   change is needed to `build_path_gradient_profile.py` itself.

A working reference implementation was written to the session scratchpad during the
2026-07-06/07 batches (`make_geodata_from_shp.py`); recreate it from this section's build
steps rather than assuming it still exists on disk, since scratchpad files are session-scoped
and are not part of this repository.

### Known pitfall: `linemerge` on an already-single geometry

`shapely.ops.linemerge` raises `ValueError: Cannot linemerge <LineString>` if
`unary_union()` on the input already collapsed to a single `LineString` (rather than a
`MultiLineString`). Guard for this case before calling `linemerge`:

```python
u = unary_union(lines)
merged = u if isinstance(u, LineString) else linemerge(u)
```

### Combining multiple LiDAR bundles per road (junction directories)

A road can span multiple planning areas, each with its own LiDAR bundle. The builder's
`--laz-dir` only accepts one directory and globs it recursively
(`glob("**/*.laz", recursive=True)`). To point one build at several bundles at once without
copying LAZ files off the slow external LiDAR drive:

1. Create an empty scratch directory (for example
   `tmp/<batch_folder>/_lazdirs/<path_key>/`).
2. Inside it, create one Windows directory junction per needed bundle, each pointing at the
   real bundle folder under the LiDAR root:
   `New-Item -ItemType Junction -Path <scratch>\<Bundle> -Target <LiDAR root>\<Bundle>`
3. Pass the scratch directory itself as `--laz-dir`. Python's `glob(..., recursive=True)`
   follows directory junctions (confirmed on this drive), so all bundles are scanned in one
   pass even though PowerShell's own `Get-ChildItem -Recurse` does **not** follow junctions
   (a `Get-ChildItem`-based LAZ count through a junction will read `0` even though the build
   itself will find everything — do not use that as a smoke test; use
   `python -c "import glob; print(len(glob.glob('<dir>/**/*.laz', recursive=True)))"`
   instead, or point `Get-ChildItem` directly at the junction, not its parent).

### Junction cleanup safety rule (important, learned the hard way)

A directory junction is a reparse point, not a real copy — recursing into it with a
destructive command reaches through to the real target. When cleaning up scratch junction
directories:

1. Never run a recursive delete (`Remove-Item -Recurse`, `rm -rf`, etc.) starting from a
   directory that might contain junctions without first confirming there are no reparse
   points inside it, or without deleting the junctions individually first.
2. Delete each junction as a single non-recursive directory delete
   (`[System.IO.Directory]::Delete($junctionPath, $false)` in PowerShell, or `rmdir` without
   a recurse flag) so only the reparse point itself is removed, never its target contents.
3. Only after confirming zero reparse points remain under the scratch root is it safe to
   recursively remove the now-empty scratch directory tree.
4. Windows itself will refuse `Remove-Item -Recurse` on some protected paths (for example it
   blocked an attempt to recurse-delete straight into `E:\LIDAR`) but do not rely on that
   guard alone — apply the junction-first deletion order above every time regardless.

### Result quality note: isolated spike artifacts on sparse profiles

Very short or sparsely-covered roads can produce one or two isolated large-magnitude
gradient values (for example a single `+42%` or `-32%` point) sitting among an otherwise
plausible profile, because the spike-repair logic in the builder needs valid neighboring
points to repair a spike and a sparse profile may not have any. Treat these as low-confidence
outliers rather than blockers: the build is still real and non-degenerate
(`valid_gradient_count > 0`) and is still promotable per the guide's credibility rule, but
flag the affected road's extreme value(s) as unreliable in batch notes rather than presenting
them as trustworthy.

### Result quality note: genuine zero-valid-gradient roads

A very short road (under roughly 100 m) built from a real centerline trace against a real,
overlapping LiDAR bundle can still legitimately produce `valid_gradient_count == 0` after
outlier/step-jump rejection removes every sample. This is a real `Not Viable` result, not a
`Missing Source` blocker — the source geometry and LiDAR overlap were both fine; there simply
was not enough surviving signal after cleanup. Do not promote it, and do not re-classify it as
a source problem.

## 19. Output Formatting Rule: No Emojis, Ever

Per explicit user instruction (2026-07-07): never include emojis in any output related to
this workflow — not in completion tables, chat responses, status flags, warnings, or
generated files. The user's completion data feeds real spreadsheets and this data is
sensitive; use plain-text words (for example "low confidence" or "flagged") instead of any
emoji or symbol to mark caveats.
