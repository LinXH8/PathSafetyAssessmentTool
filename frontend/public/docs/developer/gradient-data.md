# 12. Gradient Data Pipeline

Grade / Gradient % is the one CycleRAP attribute that photos alone cannot answer — you cannot
read a road's slope off a street-level image with any reliability. PSAT instead derives it
offline from LiDAR point clouds, stores the result as a per-road **gradient profile**, and
injects it into a project's attributes at autocode time by matching each photo's location to
the nearest point on that profile. This section explains how to obtain a gradient profile for a
road that doesn't have one yet, and why each step in that process exists.

---

## Table of Contents

- [12.1 Why This Exists](#12-1-why-this-exists)
- [12.2 How It Fits Together](#12-2-how-it-fits-together)
- [12.2a Quickstart — Prompting a Fresh Chat](#12-2a-quickstart-prompting-a-fresh-chat)
- [12.3 Prerequisites](#12-3-prerequisites)
- [12.4 Step-by-Step: Building a Gradient Profile](#12-4-step-by-step-building-a-gradient-profile)
- [12.5 The Gradient Calculation Algorithm](#12-5-the-gradient-calculation-algorithm)
- [12.6 Promoting a Build to Canonical Storage](#12-6-promoting-a-build-to-canonical-storage)
- [12.7 Linking a Live Project to a Profile](#12-7-linking-a-live-project-to-a-profile)
- [12.8 Verifying the Result](#12-8-verifying-the-result)
- [12.9 How Grade Feeds Scoring](#12-9-how-grade-feeds-scoring)
- [12.10 Running This as a Batch / Autonomous Workflow](#12-10-running-this-as-a-batch-autonomous-workflow)
- [12.11 Reference Tables](#12-11-reference-tables)
- [12.12 Gotchas](#12-12-gotchas)

## 12.1 Why This Exists

CycleRAP's CM3 base score, and the CM17/CM27 triggers, all read the coded `Grade` attribute
(1 = gentle, 2 = ≥5° incline — see the "Scoring Logic" doc, §6.51/§6.52). The CV
auto-coding pipeline (see the "CV / ML Pipeline" doc) can infer facility type
and obstacles from a single photo because those are visible in-frame. Slope is not — a photo
taken on a hill looks the same as one on flat ground unless you know the elevation of the ground
a few metres before and after it. That means Grade needs an independent elevation source, and
LiDAR (airborne laser scanning, delivered as `.laz` point-cloud tiles) is the one available in
this project. Reasoning this shapes everything downstream: because LiDAR coverage is tiled by
geographic bundle and is expensive to query, gradient data is computed **once per road, offline,
in advance** — not per-photo, per-request — and the result is cached to disk as a small profile
file that autocode reads at runtime.

## 12.2 How It Fits Together

```
ROADSECTIONLINE.shp / project geo_data.gpkg          LiDAR .laz tiles (external bundles)
        │ ordered road geometry                                │ elevation samples
        └──────────────────┬─────────────────────────────────┘
                            ▼
        Gradient Calculation/build_path_gradient_profile.py
        (offline, run once per road — NOT part of the running backend)
                            │
                            ▼
   backend/shapefiles/gradient_profiles/<Planning Area>/<path_key>/
        gradient_profile.csv · node_gradient_preview.csv · metadata.json
                            │  read at runtime by
                            ▼
   backend/app/api/projects/gradient.py
   _resolve_gradient_profile_for_project() → _get_project_gradient_mapping()
   → _inject_grade() (called from autocode.py during CV/GIS autocode)
                            │
                            ▼
        project attributes: "Grade", "Gradient %", "Gradient Status"
```

The builder script is a **separate, offline tool** — it is not imported by the Flask app, has no
API route, and is not part of the packaged install (`Gradient Calculation/` is gitignored; see
[§12.3](#12-3-prerequisites)). The only thing the running backend ever reads is the promoted
`gradient_profiles/` folder. This separation exists because a LiDAR query over a whole road is
slow (LAZ tiles are read from an external drive) and only needs to happen once, whereas
`_inject_grade` needs to answer in milliseconds for every photo during autocode.

## 12.2a Quickstart — Prompting a Fresh Chat

If you just want the data and don't care how it works, this is the whole thing. Open a new chat
in this repo and prompt in order. Each prompt has a **predictable output** — if you get something
else, that's the signal to stop and read the relevant section below.

**60-second mental model.** You give road names. The agent traces each road's shape (from the
official map or an existing project), samples ground height from LiDAR laser tiles every 2 m,
turns height-vs-distance into slope %, saves a small profile file per road, and links it to a
project so autocode can stamp `Grade` / `Gradient %` onto that road's photos. Two things gate the
whole run: the **road must exist** (as a project, or on the official road map), and the **LiDAR
drive must be mounted**. Everything else the agent infers.

| # | Prompt | Predictable output | What it means / what it's for |
| --- | --- | --- | --- |
| **A** | *"Run gradients for these roads: `<list>`. Follow `.clinerules/gradient-runner.md`."* | A **discovery table**: per road — already canonical? has a project? has `in/` source? — plus the planning area and LiDAR bundle it inferred. | Tells you the scope before any slow work: which roads are already done, which will be built, which are blocked. Nothing is written yet. |
| **A′** | *(agent may reply)* `Is the LiDAR drive mounted?` or a **`BLOCKED`** report (`Missing Source` / `Not Viable`). | A gate, not an error. | `Missing Source` = no road geometry/photos to build from. `Not Viable` = geometry exists but no usable LiDAR. Point it at the drive, or accept the road can't be built. |
| **B** | *"Build the ones that need it."* | Per-road **build result**: `valid_gradient_count / points`, `completion %`, min/max slope. | `completion %` = the fraction of the road that got a trustworthy slope reading. 15–30% is normal here; low % isn't a bug, it's sparse/noisy LiDAR. Output lands in `tmp/`, not live yet. |
| **C** | *"Promote to canonical."* | Files copied into `backend/shapefiles/gradient_profiles/<Area>/<path_key>/`, and a `Name / Status / Completion %` table. | The profiles are now in the folder the running app reads. The backend auto-picks them up — no restart. |
| **D** | *"Build reference projects in profile `<slug>` and link them."* | New projects under `profiles/<slug>/projects/`, each with `path_key` set. | **This is what makes autocode actually use the data.** A promoted profile with no project for that road is never consumed (see [§12.7](#12-7-linking-a-live-project-to-a-profile)). |

**One-shot version.** *"Run gradients for `<roads>`, promote them, and build linked reference
projects in profile `<slug>`."* → the agent does A→D in one pass and returns the final table. Use
the step-by-step version when you want to inspect completion % before committing slow LiDAR time.

**Repeatable output rule.** For a completion list, the agent returns one `ROAD NAME XX.XX%` line
per road, in the order you submitted them, `Status` ∈ `Done` / `Not Viable` / `Missing Source`
only — see [§12.10](#12-10-running-this-as-a-batch-autonomous-workflow).

## 12.3 Prerequisites

Reasoning first: none of this is bundled with the repo, because both the tool and the raw data
are large, environment-specific, and not something every contributor needs.

1. **`Gradient Calculation/` folder** — holds `build_path_gradient_profile.py`,
   `find_lidar_bundle_overlaps.py`, and `LAZ_to_Gradient_Guide.md`. It is `.gitignore`d because
   it was developed as an internal operator toolkit outside the main app; if it's missing from
   your checkout, get it from whoever last ran a gradient batch and drop it at the repo root.
2. **LiDAR point-cloud bundles** — external `.laz` tiles, not part of this repo. On the
   Windows operator box these live at `E:\LIDAR\<Bundle>\` (the operator alternates two physical
   drives, so verify the drive letter every session before assuming `E:`). Bundle folders are
   literal top-level directories such as `D_Bishan`, `D_Novena`, `D_Toa Payoh` — see
   `.clinerules/gradient-runner.md` for the current bundle-to-planning-area map. **Always
   confirm the drive is actually mounted before running anything** — it's slow, and a build
   against a stale/wrong drive fails silently rather than obviously.
3. **A Python environment with `laspy`** — the builder needs `laspy[lazrs]` to read `.laz`
   files, which the app's normal backend environment does not otherwise need. Install it once
   into whichever interpreter you'll run the builder with (`pip install "laspy[lazrs]"`).
4. **Reference shapefiles already in the repo** — `backend/shapefiles/planningareas/
   ROADSECTIONLINE.shp` (road centerlines/names, `RD_NAM` column, CRS EPSG:3414/SVY21) and
   `G_MP25_PLNG_AREA_NO_SEA_PL.shp` (planning-area polygons). These *are* checked in, because
   they're small and every gradient build needs them regardless of environment.

## 12.4 Step-by-Step: Building a Gradient Profile

Each step below exists to answer one question the builder needs before it can query LiDAR
sensibly. Skipping the reasoning and jumping straight to "run the script" is how you end up
re-doing expensive LiDAR reads or promoting a profile nothing can ever find.

**Step 1 — Check whether a canonical profile already exists.**
Look under `backend/shapefiles/gradient_profiles/*/<path_key>/`. *Why:* LiDAR queries are the
slowest part of the whole pipeline; re-running a build for a road that's already covered wastes
that cost for no benefit. If a profile exists, read its `metadata.json` before deciding to
rebuild — `usable_gradient_completion_pct` and `valid_gradient_count` tell you whether it's
actually usable already.

**Step 2 — Decide the road's `path_key`.**
Normalize the road name: lowercase, collapse every run of non-alphanumeric characters to a
single `_`, trim leading/trailing `_` (e.g. `ANG MO KIO AVENUE 12` → `ang_mo_kio_avenue_12`).
*Why a stable key at all:* project folder names and road names both change over time (renames,
re-imports, quarter-suffixed source folders like `CONWAY GROVE_1Q2026`), but the profile on disk
needs one identity that survives that churn. Always pass `--path-key` explicitly rather than
letting the builder derive it — its fallback order (`--path-key` → `project_metadata.json.
path_key` → `.dataset` → stripped project-folder name) will happily produce a
`conway_grove_1q2026`-style key from a quarter-suffixed dataset if you don't, and once that's
promoted, nothing will match it by alias later.

**Step 3 — Locate the planning area and LiDAR bundle for the road.**
Bundles are geographic tiles, so you need to know which bundle physically covers the road before
you can query it. Prefer reusing a bundle already validated for a neighbouring road in the same
estate/cluster; otherwise run `find_lidar_bundle_overlaps.py --project-dir <project> --laz-root
<LiDAR root>` (needs a project with real geometry) or intersect the road's geometry against
`G_MP25_PLNG_AREA_NO_SEA_PL.shp` to find the containing planning area, then check
`.clinerules/gradient-runner.md`'s bundle table for that area's bundle name. *Why not just query
the whole LiDAR root:* the builder's `--laz-dir` recursively globs every `.laz` file under
whatever directory you give it, so pointing it at the entire external drive instead of one
bundle would scan orders of magnitude more tiles than the road could ever touch.

**Step 4 — Obtain ordered source geometry for the road.**
The builder reads an ordered line of points from a GeoPackage — it has no concept of "a road,"
only "the line I was given." Two ways to produce that line, in order of preference:

- **A live project's `geo_data.gpkg`**, if one already exists under `profiles/<profile>/
  projects/<Project Name>/`. This is built during project creation from geotagged survey photos
  (GPS extraction → reverse-geocode → distance-sample → LineString segments), so it only covers
  the road wherever photos were actually taken.
- **Centerline-trace from `ROADSECTIONLINE.shp`**, when no project exists yet. Select every
  `RD_NAM` row matching the road (case-insensitive), chain the matched sections into one line by
  greedy nearest-endpoint ordering (start from the longest section, repeatedly attach whichever
  remaining endpoint is closest to either end of the growing chain, reversing a section's
  coordinate order when its far end is the closer match), stopping a chain extension if the gap
  exceeds `--gap-max` (default 60 m; up to 150 m for short, legitimately-split local/`JALAN`
  roads — but verify a large gap isn't a genuine disconnection before forcing it). Write the
  result as a GeoPackage table literally named `geo_data`, columns `fid, geom, "Image
  Reference", "Road Name", "Distance (Metres)"` (image reference can be null), geometry column
  renamed from GeoPandas' default `geometry` to `geom`, CRS EPSG:3414 — this is the exact schema
  `build_path_gradient_profile.py::load_project_segments()` expects, so no code change is
  needed to consume it.

  *Why prefer the centerline over an image trace:* an image-GPS trace only ever covers wherever
  the survey walked, so a road with sparse or partial photo coverage produces a profile that's
  only ever accurate to that same partial slice — one historical case had only 1 valid gradient
  point out of a 27-point trace for exactly this reason. The official centerline covers the
  entire road, so completion is limited only by real LiDAR/elevation factors afterward, not by
  where a camera happened to go.

**Step 5 — Run the builder.**

```bash
python "Gradient Calculation/build_path_gradient_profile.py" \
  --laz-dir "<LiDAR root>/<Bundle>" \
  --project-dir "<path to the geo_data.gpkg's parent folder>" \
  --path-key "<path_key from Step 2>" \
  --output-dir "tmp/<batch or road name>/<path_key>" \
  --target-road-name "<ROAD NAME IN UPPERCASE>" \
  --offroad-policy trim
```

Always pass `--output-dir` explicitly — the no-argument default writes to a legacy flat
`backend/shapefiles/gradient_profiles/<path_key>/` path with no planning-area subfolder, which
the runtime catalog loader does not expect (it globs a two-level `*/*/metadata.json` layout — see
[§12.6](#12-6-promoting-a-build-to-canonical-storage)). Build to `tmp/` first and only promote
after inspecting the result, rather than writing straight into canonical storage, so a bad build
never silently overwrites a working profile. If the source project's folder name isn't the
target road's name (a *salvage* build, using a neighbouring project's trace because the true
project doesn't exist), also pass `--display-name '<Road Name Title Case>'` — this is what lets
the runtime alias-match a differently-named source back to the intended road later.

## 12.5 The Gradient Calculation Algorithm

This is the exact computation, stage by stage, as implemented in
`build_path_gradient_profile.py`. Knowing it matters because most "why did completion come out
low" questions are answered by one of these stages, not by raw LiDAR coverage — the pipeline
rejects and repairs a lot of data on the way to a final gradient value, on purpose.

**Stage 1 — Stitch.** `stitch_path_line()` walks the project's/centerline's segments in order,
appending each one's coordinates to a running line; for each segment it compares the distance
from the running line's current end point to that segment's *start* vs. its *end*, and reverses
the segment's coordinate order first if the end is closer. *Why:* segments are stored
independently with no guaranteed order or consistent direction, so a naive concatenation would
zig-zag.

**Stage 2 — Sample.** `sample_line()` builds a fixed chainage grid:

```
chainages = 0, spacing_m, 2·spacing_m, … up to total_length
(plus one final point exactly at total_length if the grid didn't already land on it)
coords[i] = line.interpolate(chainages[i])   # (x, y) at that distance along the line
```

Default `spacing_m = 2.0`. *Why a fixed grid instead of one point per segment:* segments vary
wildly in length (a few metres to hundreds), so a uniform chainage grid is what makes the later
fixed-length gradient window (Stage 8, below) comparable point-to-point along the whole road.

**Stage 3 — Road-boundary trim** (only when `--target-road-name` is given). Every sampled point
is nearest-joined (`geopandas.sjoin_nearest`) against `ROADSECTIONLINE.shp`'s road sections; a
point is "off-road" if its nearest section's name isn't the target road (or an alias). Under
`--offroad-policy trim`, off-road points are dropped entirely before LiDAR querying even starts.
*Why:* a stitched trace can briefly clip a side street or a neighbouring road at an intersection;
without trimming, those points would pull elevation from geometry the target road doesn't
actually run through.

**Stage 4 — Query LiDAR elevation per point.** This is a ground-filtering step, not a simple
nearest-point lookup, because raw LiDAR returns include hits on vegetation, vehicles, and
canopy above the true road surface:

```
index_laz_files(): read every tile's header bbox only (fast — no point data read yet)
assign_points_to_tiles(): assign each sample point to every tile whose bbox contains it
                          (a point can be assigned to more than one tile)

for each tile with ≥1 assigned point:
    read the tile's points in chunks, keep only points with:
        Z_MIN(-5m) ≤ z ≤ Z_MAX(50m)                      # discard obvious noise/spikes
        within [tile query bbox ± search_radius]          # cheap spatial prefilter
    build a 2-D (x, y) k-d tree over the surviving points

    for each assigned sample point:
        find its k = min(50, n) nearest neighbours in the tree
        keep only neighbours within search_radius (default 5.0 m)
        if none survive: no elevation from this tile for this point
        z_floor = min(z) among the kept neighbours
        ground_band = kept neighbours with z ≤ z_floor + 1.5 m
        tile_elevation(point) = median(ground_band.z)

elevation(point) = mean of tile_elevation(point) across every tile that produced one
```

*Why the "lowest cluster + 1.5 m band, then median" step instead of just averaging the k nearest
returns:* the 50 nearest returns around a point on a tree-lined footpath will include real
ground hits mixed with canopy/branch hits well above the surface. Taking the lowest local cluster
approximates the bare-earth surface, and the shallow 1.5 m band above it tolerates genuine ground
roughness/kerbs without pulling in canopy returns; the median (not min) inside that band then
resists any single remaining noisy low outlier.

**Stage 5 — Reject local elevation outliers.**

```
window = max(5, round(outlier_window_m / spacing_m)), rounded up to the nearest odd number
local_median[i] = centered rolling median of raw elevation over `window` points
                  (min_periods = max(3, window // 2))
reject point i if |elevation[i] − local_median[i]| > outlier_dev_m
rejected points → NaN, then linearly interpolate gaps of ≤ 2 consecutive points
```

Defaults: `outlier_window_m = 14.0`, `outlier_dev_m = 1.5`. *Why a local rolling median instead
of a single global threshold:* a single spurious LiDAR return (point-cloud noise, a parked
vehicle) can be wildly inconsistent with its immediate neighbours without being unusual for the
road as a whole (a genuinely hilly stretch), so the comparison has to be local to catch the
former without flagging the latter.

**Stage 6 — Reject seam/step jumps.** Runs for up to 6 passes:

```
interpolate any existing gaps (≤ 3 points)
repeat up to 6 times:
    jump_positions = indices i where |elevation[i+1] − elevation[i]| > 0.3 m
    if none: stop
    changed = false
    for each jump at i, considering candidates {i, i+1}:
        for each candidate index c:
            window = up to 3 valid points on each side of c (c itself excluded)
            if fewer than 2 valid neighbours: skip this candidate
            score(c) = |elevation[c] − median(window)|
        reject whichever candidate has the higher score → set it to NaN, changed = true
    if not changed: stop
    re-interpolate gaps (≤ 3 points)
```

*Why iterative, and why reject the "worse" of the two endpoints rather than both:* LiDAR bundles
are stitched from separate flight passes/tiles, so a genuine tile-seam discontinuity (not a real
road feature) shows up as an abrupt jump between two adjacent points — one of the two is usually
the actual outlier and the other is fine, so scoring both against their own local neighbourhoods
and dropping only the worse one preserves as much real signal as possible. Iterating (rather than
one pass) catches jumps that only become visible after an earlier jump in the same stretch has
already been resolved and re-interpolated.

**Stage 7 — Smooth.**

```
interpolate remaining gaps (≤ 2 points)
window = max(3, round(smooth_window_m / spacing_m)), rounded up to the nearest odd number
smoothed[i] = centered rolling median over `window` points (min_periods = max(2, window // 2))
```

Default `smooth_window_m = 8.0`. *Why median smoothing after outlier/step rejection, not
instead of it:* smoothing alone would blur a real spurious spike into its neighbours rather than
removing it; doing rejection first and smoothing second keeps genuine terrain shape while damping
whatever small-scale point-cloud noise survives.

**Stage 8 — Compute gradient percent** over a centered baseline window:

```
half_window = max(1, round((baseline_m / 2) / spacing_m))     # default baseline_m = 10.0
for each chainage index i:
    left  = max(0, i − half_window)
    right = min(N−1, i + half_window)
    skip if left == right
    skip if the point at `left` or `right` was rejected as a step jump (Stage 6)
    skip if elevation at `left` or `right` is NaN
    gradient[i] = (elevation[right] − elevation[left]) / (chainage[right] − chainage[left]) × 100
```

*Why centered, not one-sided:* a one-sided slope (this point vs. the previous point) is far
noisier at 2 m spacing than a wider centered window, and centering avoids systematically biasing
the slope toward whichever direction the chainage happens to increase. *Why skip a window whose
endpoint was step-jump-rejected:* using an already-flagged-bad elevation as one end of the
baseline would silently reintroduce the seam-noise Stage 6 just removed.

**Stage 9 — Repair isolated bad gradient spikes / remove bad stretches.** Two passes:

*Pass 1 — anomalous-run detection:*

```
walk the gradient series left to right; a run starts wherever
    |gradient[i] − gradient[i−1]| ≥ spike_threshold_pct (default 2.5)
the run extends while consecutive differences stay below that threshold
for a detected run bounded by `left` (before the run) and `right` (after it):
    if |left − right| ≤ neighbor_tolerance_pct (default 1.0)          # the road is flat either side
       AND |mean(run) − mean(left, right)| ≥ spike_threshold_pct       # but the run itself is way off
    then:
        run length 1  → replace that single point with mean(left, right)   [repaired]
        run length >1 → blank the whole run to NaN                          [removed]
```

*Pass 2 — fill remaining lone gaps:* any isolated single-NaN position that still has valid
neighbours on both sides is filled with their mean [repaired].

*Why a repair pass separate from Stage 5's elevation-outlier rejection:* Stage 5 cleans the
*elevation* profile; a lone extreme *gradient* value can still appear afterward, especially on
sparse profiles, because a small elevation error is amplified by the gradient formula's division.
Requiring the road to look flat on both sides of a suspicious run (`neighbor_tolerance_pct`)
before "fixing" it is what stops this pass from also erasing a genuine short, steep grade — a
real hill has different values on both sides, a spike doesn't. When there are no valid
neighbouring points to repair against (very short or sparse roads), the value survives untouched
as a flagged low-confidence outlier rather than being silently dropped.

**Stage 10 — Derive `Grade` and write outputs.**

```
Grade = 2 if |gradient_pct| ≥ 8.748  else  1        (NaN gradient → NaN Grade)
```

`8.748` is `tan(5°) × 100` — it's expressed as a percent-grade threshold because that's what's
cheap to compute from the rise/run gradient formula above, not because the underlying CycleRAP
spec is percent-based; it matches the "≥5°" trigger the scoring model actually uses (see
[§12.9](#12-9-how-grade-feeds-scoring)). Three files are written: `gradient_profile.csv` (one row
per sampled chainage point — raw/filtered/smoothed elevation, `gradient_pct`, `Grade`),
`node_gradient_preview.csv` (the input project's own segments mapped onto the profile, for human
review only — not consumed at runtime), and `metadata.json` (provenance + summary counts used
for promotion decisions, see [§12.6](#12-6-promoting-a-build-to-canonical-storage)).

## 12.6 Promoting a Build to Canonical Storage

Before promoting a `tmp/` build, verify all of: `metadata.json`, `gradient_profile.csv`, and
`node_gradient_preview.csv` exist; `metadata.json.path_key` is correct; and
`valid_gradient_count > 0` (unless you're deliberately accepting an empty result). *Why check
`valid_gradient_count` specifically:* `gradient.py::_load_gradient_profile_catalog()` **silently
skips** any profile folder with `valid_gradient_count <= 0` when it builds its in-memory catalog
— a degenerate promotion doesn't error, it just quietly never gets used, which is much harder to
debug than catching it before promotion.

Move the folder to:

```
backend/shapefiles/gradient_profiles/<Planning Area>/<path_key>/
```

*Why this exact two-level layout matters, not just convention:* `_load_gradient_profile_catalog()`
globs `gradient_profiles/*/*/metadata.json` — one level for planning area, one for `path_key`.
A flat `gradient_profiles/<path_key>/` layout (the builder's own no-`--output-dir` default) is
invisible to that glob. The catalog also auto-rebuilds whenever any planning-area directory's
mtime is newer than the last load, so a promotion is picked up on the next request without
restarting the backend — but only from the correct nested location.

If two planning-area folders ever end up holding the same `path_key` (e.g. after correcting
which area a boundary road belongs to), delete the stale copy — `_load_gradient_profile_catalog()`
resolves duplicates by directory iteration order, so a leftover duplicate silently wins or loses
unpredictably rather than raising an error.

## 12.7 Linking a Live Project to a Profile

A promoted profile with no matching project is never consumed — `_inject_grade` is only ever
called per-project, during that project's autocode. `gradient.py::_resolve_gradient_profile_for_project()`
resolves a project to a catalog entry in this order:

1. **Exact `path_key` match** — if the project's `project_metadata.json.path_key` is set and
   equals a catalog key (or one of its normalized aliases from `display_name`/`source_project`),
   use it directly.
2. **Alias match** — otherwise, normalize the project's own name/dataset the same way
   (lowercase, non-alphanumeric runs collapsed, survey-quarter suffix stripped) and look for an
   exact match against every profile's alias set, preferring the closest centerline length if
   more than one matches.
3. **Spatial fallback** — otherwise, compare the project's own stitched centerline bounding box
   against each profile's stored `path_bounds_svy21`, accepting the nearest one only if it's
   within 50 m and its length is within `max(75 m, 35% of the profile's length)` of the
   project's.

*Why bother setting `path_key` explicitly rather than relying on the fallbacks:* the alias and
spatial fallbacks exist so *something* still resolves for older/salvage projects, but they're
heuristics — a same-named road in a different estate, or a short trace with an ambiguous
bounding box, can genuinely fail to match or (worse) match the wrong profile. Setting
`project_metadata.json.path_key` to the canonical key is the only deterministic path, so for any
project you specifically built a profile for, set it after promotion (and only for that true
target project — never write a target road's `path_key` into a neighbouring salvage source
project's metadata, since that would make the wrong project claim the profile).

Once resolved, `_get_project_gradient_mapping()` builds a per-image lookup: it stitches the
project's own `geo_data.gpkg` into a centerline, projects each image's segment midpoint onto
that centerline to get a chainage, and finds the nearest chainage in the *profile's* CSV within
a tolerance derived from the profile's own sample spacing (`max(median step × 1.5, 1.0 m)`).
*Why re-derive chainage from the project's own geometry rather than reusing the profile's
`node_gradient_preview.csv` directly:* the project's image-GPS geometry and the promoted
centerline trace are rarely pixel-identical (different source, different sampling), so mapping
by proximity at read time is what lets a profile built from the centerline still serve a project
whose own trace differs slightly.

## 12.8 Verifying the Result

Run (or re-run) autocode for the project and check the `Grade`, `Gradient %`, and
`Gradient Status` attribute columns. Three outcomes are possible, and distinguishing them is the
point of the separate status field:

- **A numeric `Grade`/`Gradient %`** — the segment matched a chainage point in the profile with
  a valid gradient. Success.
- **`Gradient Status = "N/A (no LiDAR result)"`** — a profile *was* found and resolved for this
  project, but this particular segment's chainage fell outside the profile's covered/valid
  range (e.g. near the very ends, or in a stretch that failed cleanup). This points at coverage,
  not configuration.
- **`Gradient Status = "Not assessed yet"`** — no profile could be resolved for the project at
  all (none of the three matches in [§12.7](#12-7-linking-a-live-project-to-a-profile)
  succeeded). This points at [§12.7](#12-7-linking-a-live-project-to-a-profile) — check whether
  `path_key` is set, or whether a profile exists for this road at all.

## 12.9 How Grade Feeds Scoring

`Grade` (1 or 2) is a coded attribute consumed directly by the CycleRAP scoring model — it's a
CM3 CU factor (1.2× if steep) and a CM17/CM27 trigger. See the "Scoring Logic" doc's §6.51
for the full factor table and §6.5 for how coded attributes feed the scoring functions in
general. `Gradient %` itself is not scored directly — only the coded `Grade` band is.

## 12.10 Running This as a Batch / Autonomous Workflow

Covering a whole planning area is hundreds of roads, not one. `Gradient Calculation/
LAZ_to_Gradient_Guide.md` and `docs/openrouter-deepseek-gradient-runbook.md` define a stricter
operating contract for that scale, meant to let a run — human or LLM-driven — get through many
roads unattended without stopping to ask questions or drifting into inconsistent per-road
choices. *Why a separate, stricter contract instead of just repeating §12.4 many times:* at
single-road scale, an ad hoc choice (which folder to check first, what counts as "good enough")
costs nothing. At hundreds-of-roads scale, the same ad hoc-ness compounds — inconsistent
`path_key` derivation, inconsistent promotion thresholds, or a run that stops to ask a question
per road all turn a batch into something that can't finish unattended or be trusted to compare
across roads. The rules below exist to remove exactly that variance.

**Discovery order, before ever asking a question.** Search, in this order: canonical profiles
under `gradient_profiles/`, live projects under `profiles/*/projects/`, legacy projects under
`data/`, staged source folders under `in/`, and only then specific prior `tmp/...
/attempt_status.json` paths when resuming known work (never explore `tmp/` speculatively). *Why
this exact order:* it's cheapest-check-first — an already-canonical road needs no work at all, a
live project is the fastest path to a real build, and `tmp/` is only useful when you already know
what you're looking for, so scanning it blindly wastes time without narrowing anything.

**Batch composition.** One planning area per batch, one primary LiDAR bundle per batch, one road
cluster where possible, one summary output file, one markdown update. Default size 8 roads (6 for
long arterials / uncertain bundle choice / likely compare-builds; 10 only for short local roads
in the same area and bundle with no compare-build expected). *Why fix the batch size instead of
just "as many as fit in the session":* recent per-road builds ran roughly 13–18 minutes on the
un-cached path, so 8 roads gives a practical ~2-hour run with margin for promotion, retries, and
one compare-build, without forcing either a rushed run or an open-ended one that risks leaving a
batch half-finished. *Why one area/bundle per batch:* mixing LiDAR bundles within a batch
multiplies the chance of picking the wrong bundle for a given road, and mixing planning areas
scatters the resulting promotions across the folder tree in a way that's harder to audit
afterward.

**The blocker report.** When a road genuinely cannot proceed after the discovery pass and the
inference/default rules above, stop with this exact shape instead of asking an open-ended
question:

```text
BLOCKED
road_name: <ROAD NAME OR BATCH>
label: <Missing Source | Not Viable>
reason: <single concrete reason>
searched_paths:
- <path 1>
- <path 2>
next_required_artifact: <specific file/folder/project/source that must exist>
```

`Missing Source` means the controlling blocker is missing/unusable project or source geometry
(no `geo_data.gpkg` anywhere, an unreadable one, no matching `in/` folder). `Not Viable` means
the source search finished but there's no usable LiDAR/build outcome (no overlapping bundle, zero
retained samples after boundary trimming, a genuinely too-short road). Tie-break: if a missing or
unreadable source artifact would unblock the road, it's `Missing Source`; otherwise `Not Viable`.
*Why this distinction matters, not just the report format:* the two labels point at different
next actions — `Missing Source` means someone needs to supply imagery/geometry, `Not Viable`
means the road has been fairly assessed and simply has no usable result. Conflating them either
sends someone hunting for data that was never going to help, or makes a real gap in coverage look
like a settled "no."

**Batch state lives in files, not chat memory.** Keep `tmp/<batch_name>/batch_summary.json` and
`.tsv` per run, with one row per road (`road_name`, `path_key`, `source_type`, `status`,
`blocked_label`, `completion_pct`, `valid_gradient_count`, `profile_point_count`, and paths), and
recompute the summary `counts` from that row list after every change rather than hand-typing
them. *Why:* a run can be interrupted and resumed by a different session or a different model
entirely; file-based state is what makes that resumable and auditable, where a chat transcript is
neither.

**Output formatting is strict, because it feeds a real spreadsheet downstream, not just a chat
reply.** User-facing road tables use exactly the columns `Name`, `Status`, `Completion %` in that
order; `Status` is exactly `Done`, `Not Viable`, or `Missing Source`; `Completion %` is a plain
`XX.XX%` or a genuinely **blank** cell when there's no value (never `N/A`, `-`, or `0` — those are
non-numeric or wrong-numeric tokens that would corrupt a numbers-only column). Completion text
files are one line per road, `ROAD NAME XX.XX%`, no header. No emoji anywhere in this workflow's
output — plain words like "low confidence" or "flagged" instead of a symbol, because this data
feeds real planning decisions and a symbol doesn't survive being copied into a spreadsheet cell
the way a word does.

**Recommended orchestration stack**, per the runbook: `Claude Code` as the tool runner/file
editor, a cheaper model (`DeepSeek V4 Flash` on OpenRouter, at the time the runbook was written)
as the reasoning model behind repetitive batch decisions, and the repo's own files — never chat
transcript memory — as the source of truth for what's been done. *Why a cheaper model is
appropriate here specifically:* batch gradient decisions are repetitive and almost entirely
file-driven/rule-driven once the contract above is followed, so the value of a stronger model is
concentrated in genuinely ambiguous cases (an unclear bundle choice, unexplained repeated
failures, road-boundary trimming behaving unexpectedly) rather than in the bulk of the run — the
runbook's own guidance is to escalate only for those specific situations.

**Already-completed coverage** is tracked as a point-in-time results log inside
`LAZ_to_Gradient_Guide.md` §12 (not reproduced here, since it goes stale immediately) — the actual
live source of truth is always the promoted folders under `backend/shapefiles/gradient_profiles/`
themselves (1,443 profiles as of this writing), not any written-down list of "what's done."

## 12.11 Reference Tables

**Default build parameters** (`build_path_gradient_profile.py`):

| Parameter | Flag | Default | Purpose |
|---|---|---|---|
| Sample spacing | `--spacing-m` | 2.0 m | Chainage grid resolution |
| Gradient baseline | `--baseline-m` | 10.0 m | Centered window for the gradient formula |
| Smoothing window | `--smooth-window-m` | 8.0 m | Elevation smoothing after outlier rejection |
| Outlier window | `--outlier-window-m` | 14.0 m | Rolling-median window for outlier detection |
| Outlier deviation | `--outlier-dev-m` | 1.5 m | Deviation from local median to reject a point |
| LiDAR search radius | `--search-radius` | 5.0 m | Radius around each sample for nearest LiDAR hit |
| Road-boundary gap | `--gap-max` (centerline trace) | 60.0 m (150.0 for short/`JALAN` roads) | Max endpoint gap before stopping a chain |
| Grade threshold | `GRADE_THRESHOLD_PCT` (constant) | 8.748 % (= tan 5°) | `abs(gradient_pct) >= 8.748` → Grade 2, else Grade 1 |

**Key file locations:**

| Path | Role |
|---|---|
| `Gradient Calculation/build_path_gradient_profile.py` | The offline builder (gitignored, obtain separately) |
| `Gradient Calculation/find_lidar_bundle_overlaps.py` | Finds which LiDAR bundle(s) overlap a project's geometry |
| `Gradient Calculation/LAZ_to_Gradient_Guide.md` | Full internal operator runbook (batch rules, blocker taxonomy, centerline-trace method §18) |
| `.clinerules/gradient-runner.md` | Environment map (Windows/Mac paths, current LiDAR bundle table) and hard rules for batch runs |
| `docs/openrouter-deepseek-gradient-runbook.md` | Batch-orchestration conventions for running large multi-road batches |
| `backend/shapefiles/planningareas/ROADSECTIONLINE.shp` | Road centerlines/names (`RD_NAM`), used for boundary trimming and the centerline-trace fallback |
| `backend/shapefiles/planningareas/G_MP25_PLNG_AREA_NO_SEA_PL.shp` | Planning-area polygons, used to determine which area/bundle a road belongs to |
| `backend/shapefiles/gradient_profiles/<Planning Area>/<path_key>/` | Canonical promoted profile storage (what the running app actually reads) |
| `backend/app/api/projects/gradient.py` | Runtime catalog loading, project resolution, and `_inject_grade` |

## 12.12 Gotchas

- **`backend/shapefiles/gradient_lookup.csv` is not read by any backend code.** It looks like it
  should be the gradient source of truth (it has `Image Reference`, `gradient_pct`, `Grade`
  columns), but nothing in `backend/` references its filename — the real runtime path is
  entirely through the `gradient_profiles/*/*/` catalog described above. Treat it as a legacy
  artifact, not a source of truth, unless you've independently confirmed something new reads it.
- **The builder's own default `--output-dir`** (used when you omit the flag) writes to a flat
  `backend/shapefiles/gradient_profiles/<path_key>/` with no planning-area folder — this is
  invisible to the runtime catalog's two-level glob. Always pass `--output-dir` explicitly.
- **A promoted profile only helps a project once that project's `path_key` (or a matching
  alias/geometry) resolves to it** — building and promoting a profile is necessary but not
  sufficient; see [§12.7](#12-7-linking-a-live-project-to-a-profile).
- **This whole pipeline runs offline, outside the Flask app.** There is no API endpoint that
  triggers a LiDAR build — the only backend-side code involved (`gradient.py`) only *reads*
  already-promoted profiles. Running the builder is always a manual, deliberate step by whoever
  is populating gradient coverage for a road.
