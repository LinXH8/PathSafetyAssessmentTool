# PSAT Deployment — Decisions & History (handover)

> **Purpose.** This is the *why* behind how PSAT is packaged and shipped. It exists so
> whoever inherits this work does not re-litigate settled decisions or re-discover
> problems that were already solved (some of them painfully). The companion document
> [deployment-operations-guide.md](deployment-operations-guide.md) is the *how* — the
> commands you actually run.
>
> Written July 2026 at handover. Nothing here is aspirational; every decision below is
> implemented and, except where explicitly noted, tested.

---

## 1. The problem

PSAT had to be installed on ~10 company Windows 11 machines whose exact specs were
unknown, and it had to **work first try**. A prior packaging attempt had failed.

The old `Run-PSAT.bat` was a *developer bootstrap*: on every machine it ran per-machine
`pip`/`conda` + `npm` installs and launched two dev servers. That is non-deterministic
and internet-dependent — the geospatial stack (GDAL/fiona/pyproj) is notorious for pip
wheels resolving differently on different machines, and it needs the whole toolchain
present. That is almost certainly why the first attempt failed.

The guiding principle that came out of this: **stop installing anything on the target
machine. Build once on a controlled machine, freeze it, ship the frozen thing.**

A second hard requirement arrived partway through: the app must **receive updates
remotely** without users installing Git or GitHub Desktop.

---

## 2. The decisions, and what was rejected

Each of these was a real fork. The rejected options are recorded because "why not X?"
is the first question a successor will ask.

### Packaging model → **portable frozen bundle**
A self-contained folder built once, copied to machines, run in place.
- **Rejected: PyInstaller.** The torch + GDAL + ultralytics combination is exactly what
  makes PyInstaller fragile (hidden imports, data dirs, DLL discovery). It was the
  highest-risk option and the most likely cause of the original failure.
- **Rejected: Docker.** Needs Docker Desktop + WSL2 + admin rights on every laptop.
  Heavy and a poor fit for "just works on a random company machine."

### Runtime topology → **one server, one port**
Flask serves the *built* React frontend on `:8000` alongside the API. The frontend
already used relative `/api` paths, so **Node.js is not needed at runtime at all**. This
removed an entire moving part (the Vite dev server) from production.

### Frozen Python → **conda-pack + conda-unpack**
- **Rejected: python-build-standalone + pip install.** Rebuilding the environment from
  PyPI wheels would re-roll the GDAL wheel roulette *and* change the OpenMP situation
  (see §3). `conda-pack` preserves the exact, already-tested conda-forge binaries;
  `conda-unpack` rebases the absolute paths baked in at build time so the env works from
  any location.

### Install location → **`%LOCALAPPDATA%\Programs\PSAT` (per-user)**
- **Rejected: `C:\Program Files\PSAT`.** Read-only per-user; the updater would need a UAC
  prompt on *every* update, which corporate policy often blocks.
- **Rejected: `C:\PSAT` machine-wide + user-writable ACL.** A mild security smell (any
  user could alter app binaries) and unnecessary — the machines are effectively
  single-Windows-user (PSAT's own profile system handles multiple people). Per-user
  install needs no admin ever and has no duplication penalty here.

### App vs data separation → **the rule everything else follows**
The updater replaces the app folder wholesale, so **nothing writable may live inside it**.
User data (projects, profiles, survey images, exports, uploaded GIS layers, config,
tile cache) lives in a separate root that the updater never touches. This is enforced in
code by `backend/app/services/paths.py`; every runtime writer resolves through it.

### Update mechanism → **custom component-manifest updater**
- **Rejected: Velopack** (the mature Squirrel successor). It was genuinely tempting, but
  three facts about *this* payload killed it:
  1. GitHub caps a release asset at **2 GiB**; Velopack publishes the app as one ~9 GB
     package with no native splitting.
  2. It reconstructs the whole app on every update (~14 GB transient disk for a 7 MB
     frontend fix) — above our own minimum-spec machines.
  3. Its chained deltas force a long-offline machine to walk every intermediate release.

  The custom updater downloads only the changed component, versions the 5 GB shapefile
  tree per-directory, and is state-based (a machine offline for five releases fetches only
  what differs).

### Update hosting → **public GitHub Releases** on `LinXH8/PathSafetyAssessmentTool`
The repo is already public and exposing the backend Python source was deemed acceptable.
Free, plain HTTPS, no Git client on the user's side. Big components ship as split
`<2 GiB` parts to respect the asset cap.

### Update consent → **notify, then apply on restart**
Never silent, never applied to a running app. The user is told, chooses to download, and
the update installs on the next launch. There is **no staged fleet rollout** — the
machines are independent and have no awareness of each other, so there is nothing to
stage against.

### What was deliberately dropped

- **Update signing (Ed25519).** Considered and built, then removed. Signing protects
  against one scenario — a compromised GitHub account pushing malicious code — but that
  same account already controls the source everything is built from, so it closes a
  narrow gap. At ~10 machines with a single publisher, the key-management burden (secure
  storage, backup, "lose it and nobody can ship updates") cost more than it bought.
  **sha256 per component was kept** — not for security, but because a truncated download
  silently corrupting an install is a *likely* failure, not a hypothetical one.
- **Offline basemaps.** Maps fetch tiles from CARTO. Making them work fully offline means
  bundling a PMTiles/Protomaps Singapore extract, which changes how every map *looks*.
  Declined. The `/api/tiles/...` indirection was kept regardless, so a different tile
  source can be dropped in later without touching the frontend. Accepted limitation: a
  machine offline from first launch shows grey basemaps, including in exported PDFs;
  areas visited while online cache per-user.
- **Code-signing certificate (Authenticode).** Target machines carry no restriction
  software, and delivering the first install from USB avoids the SmartScreen
  Mark-of-the-Web warning a downloaded installer would trigger.
- **Excel/COM at runtime.** The legacy `cycleRAP_interface` (Excel automation) used to
  raise on init and brick the whole project context if Excel or the `.xlsm` was missing.
  All live scoring/treatment now uses the pure-Python `calculate_cyclerap_score_native`
  (v2.14), so that init was made non-fatal. **Excel is no longer a runtime dependency.**

---

## 3. Problems discovered and solved

These are the traps. Each one cost real time; none should have to be found twice.

### OpenMP duplicate runtime (could silently corrupt scores)
`import torch` before `numpy` initialises two copies of `libiomp5md.dll` (torch's and
MKL's) and the process aborts with `OMP: Error #15`. Measured precisely: `torch` alone or
`fiona`→`torch` fails; `numpy`→`torch` is fine. **The app only worked by accident** —
geopandas happened to import numpy first. That is not guaranteed in a rebuilt env, so
`backend/app/__init__.py` now imports numpy first, explicitly, as its very first line.
The standard `KMP_DUPLICATE_LIB_OK=TRUE` workaround was **refused** — Intel documents that
it "may silently produce incorrect results," which is unacceptable for safety scoring.

### GDAL/PROJ data paths don't survive relocation
conda sets `GDAL_DATA`/`PROJ_LIB` in activation scripts, but the packaged app launches
`python.exe` directly and never activates. Worse, absolute paths baked in at build time
are wrong once the env is installed elsewhere. `_bind_native_data_dirs()` in
`app/__init__.py` derives them from `sys.prefix`, making the env self-locating.

### `robocopy /XD` bare-name trap (shipped a dead bundle)
The build script excluded user-data dirs with `/XD data profiles`. **A bare name excludes
that name at any depth**, so it silently deleted `backend/app/services/data/` (the entire
v2.14 scoring + treatment model) and `backend/app/api/profiles/` (the whole profile
system). The bundle assembled without error and then died on import. Fixed by anchoring
excludes to full paths — and the build script now has a **Verify step** that imports the
app inside the frozen interpreter. *An assembled bundle is never trusted until it has
actually run.*

### `config.json` UTF-8 BOM corrupted the data-folder path
The installer wrote `data_dir.txt` with `Set-Content -Encoding UTF8`, which in Windows
PowerShell 5.1 adds a BOM. The launcher read the BOM as part of the path and silently
fell back to the default data location. Fixed both ends: write with no BOM, read with
`utf-8-sig` so a hand-edit in Notepad can't break it either.

### Pruned source folders re-import with wrong counts
Creating a project runs `prune_source_folder`, which **permanently deletes** the dense raw
survey frames it didn't use as segment anchors. A folder that has already had a project
made from it re-imports with a badly undercounted segment total. **Ship only folders that
have not had projects created from them.** (Also: never point the packaged app at the dev
repo's `in/` — it would prune the master survey data.)

### Partial drive copy looked exactly like a code bug
An interrupted ~9 GB copy to the HDD left the frozen env missing `_distutils_hack`,
`win32`, and `Lib\urllib` — surfacing on the target as three unrelated-looking "module
not found" errors. This is why `verify_drive.ps1` exists: it checks file count and exact
byte total *and* runs the copied interpreter. A count alone would not have caught it.

### The survey data needed its own pipeline (discovered late)
Seeding was assumed to be "copy the `in/` folder". It is not. Two findings:

**The working copy was not shippable.** The repo's `in/` (1,591 roads, 45 GB) had **425
folders already pruned** — projects had been created from them over time, permanently
deleting their raw frames. Shipping it would have put wrong, undercounted segment numbers
on ~27% of roads in a safety tool. The fix is to always flatten from the **original
delivery**, never from a working copy.

**The delivery's shape doesn't match PSAT's.** Deliveries are grouped by map region
(`NE1\ANCHORVALE LINK\`), PSAT needs road folders flat. Flattening is not a plain copy:
- **274 roads span multiple regions** (MACPHERSON ROAD is in SE1+SE2+SE3). A naive flatten
  has each region overwrite the last and silently loses frames — they must be *merged*.
- **Repeated frame names are not all duplicates.** Of 359 repeats in three regions, 344
  were byte-identical (safe to collapse) but **15 were genuinely different images sharing
  a filename**. A single spot-check suggested "all duplicates, safe to overwrite" and was
  wrong; only hashing every case revealed the 15. They are now preserved under
  `__<REGION>` names.
- **Timestamps must be preserved.** PSAT derives the survey quarter from file mtime, so a
  copy that resets mtimes would mislabel the entire delivery.

The real quarter is also ~3× the working copy: **3,868 roads / 128.9 GB**, which is what
pushed the per-machine disk requirement to ~160 GB and the drive to 256 GB.

`scripts/bundle/flatten_survey_data.ps1` encapsulates all of this and refuses to report
success on a mismatch or an empty run.

### Reducing 129 GB without corrupting the data (pre-prune)
129 GB per machine was not viable, and the obvious fix — ship fewer frames — is exactly the
thing that breaks PSAT. Measured on one road: keeping half the frames dropped segments
59 → 41 (−31%) and the road measured *shorter* (1.42 → 1.34 km). Keeping a quarter dropped
it to 15. PSAT samples a frame every ~10 m; thin the frames and sample points find nothing
to match, so coverage silently disappears. On a safety tool that is under-reporting how much
path was assessed, with no error shown.

**The resolution came from the app itself.** Its `prune_source_folder` deletes exactly the
frames no project references — and crucially the project's geometry is computed from the
*full* frame set **before** any deletion. So creating a project first, then pruning, shrinks
the folder while the project keeps correct segments. Pruning also re-stamps the folder's
pre-prune summary, so the UI still reports true counts.

Doing that for every road (`preprune_seed_data.ps1`, run once on the build machine) took
**128.68 GB → 27.88 GB, 78% smaller**, with 3,730 projects created and segment counts
verified intact.

**The critical constraint this creates:** the projects must ship *with* the pruned data. A
pruned folder without its project is the broken state — a new project created from it would
resample thinned frames and undercount. The projects are what make the pruned state valid.

Two things worth knowing for anyone revisiting this:
- 138 roads (3.6%) can't be pre-pruned — stub roads of 1–21 frames, too short to segment.
  They keep every frame and stay correct; it costs ~75 MB. Not a defect.
- The pruned state is *not* re-derivable from itself. If the flatten is ever re-run, `data/`
  must be discarded too, and pre-prune re-run from the original delivery.

### The frontend build gate
`npm run build` is `tsc -b && vite build`. 17 pre-existing TypeScript errors meant `tsc`
failed and no production bundle could be produced. Fixed rather than bypassed, so the
bundle build has a real type-check gate.

---

## 4. The numbers that shape everything

Measured, not estimated:

| Thing | Size |
|---|---|
| App bundle total | **8.92 GB** (frozen python 3.9 GB · shapefiles 5.1 GB · models 27 MB · code 2 MB · webui 10 MB) |
| Full quarter, raw (Mar-2026 delivery) | 128.9 GB · 3,868 roads · 13 regions |
| **Same quarter after pre-prune (what actually ships)** | **28.3 GB** (27.9 survey + 0.4 projects) |
| (the repo's partially-pruned working copy, for contrast) | 45.3 GB · 1,591 roads — **not shippable**, see above |
| **Minimum free disk per machine** | **~50 GB** (9 GB app + 28 GB data + working headroom) |
| Frontend-only update (compressed) | ~7 MB |
| Whole release minus the interpreter (compressed) | ~0.7 GB |

Consequences that drove design: a **256 GB** drive is needed to carry app + a full quarter;
the data folder must be placeable off the system drive; and `SYSTEM_REQUIREMENTS.md`'s old
10 GB figure was an order of magnitude too low (now corrected).

If 160 GB per machine is impractical, the lever is **scope**: seed only the regions a given
person works rather than all 3,868 roads. Nothing in the tooling assumes a full quarter —
`flatten_survey_data.ps1` takes a `-Regions` subset.

Target runtime, for reference: **CPython 3.11.15 win64**, torch 2.10.0+cpu, numpy 2.4.2,
fiona/GDAL 3.11.4, geopandas 1.1.1.

---

## 5. How we verified it

- **Numerical parity.** Scoring (64 fixed-seed rows) and the **raw YOLO forward pass**
  (fixed synthetic image) produce byte-identical sha256 hashes in the dev conda env and in
  the relocated frozen bundle. Raw forward pass, not post-NMS detections — detections on a
  synthetic image are empty and would pass vacuously. This is what closed the OpenMP
  "silently wrong" risk.
- **Update cycle (local).** Against a locally served release: diff finds only the changed
  component, a corrupt download is rejected, apply works, and rollback restores the
  previous version and re-offers the update.
- **Clean-machine acceptance test (the real gate).** Installed from the drive onto a
  machine with no Python/Node/conda/Git. **Project creation, autocode, and GIS layer
  viewing all confirmed working.** Autocode passing is the important one — it exercises
  the torch/YOLO path on hardware that never had a dev environment.

---

## 6. Status at handover

**Proven:** build → bundle → drive → install → run, and project creation / autocode / GIS
on a genuinely clean machine.

**Not yet exercised on real hardware:** the remote update flow *machine-to-machine* via an
actual GitHub Release (only verified locally at the API level), and the update modal's
on-screen rendering. Rehearse one real release before relying on updates in front of the
team — the procedure is in the operations guide.

**Known pre-existing noise (not caused by this work):** the backend test suite has 12
failing tests (6 in `test_curvature_analysis.py`) and, on some Windows setups, ~39 errors
from pytest being unable to create its temp dir. Compare against a clean checkout before
blaming a deployment change.

**Left on the table (safe to ignore, worth knowing):** `streamlit` is bundled but never
imported by the backend; removing it and its dependencies (`_polars_runtime_32` ~158 MB,
PyQt6 ~18 MB) would reclaim a couple hundred MB. Do this only after the bundle is proven
in the field, never as a pre-launch change.
