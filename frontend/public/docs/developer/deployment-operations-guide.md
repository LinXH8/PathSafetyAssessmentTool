# 16. PSAT Packaging, Installation & Updates — Operations Guide (handover)

> **Purpose.** Everything you actually run to build PSAT, put it on machines, and ship
> updates. Written to be followed by someone who did not build it. For *why* it works this
> way, see [deployment-decisions-and-history.md](deployment-decisions-and-history.md).
> `scripts/bundle/RUNBOOK.md` is a shorter quick-reference of the same material.
>
> Every script lives in **`scripts/bundle/`**.

---

## 0. The one rule you must not break

**The application and the user's data live in two separate places.**

| | Location (default) | Owner |
|---|---|---|
| Application | `%LOCALAPPDATA%\Programs\PSAT` | the updater — **replaced wholesale on every update** |
| User data | `%LOCALAPPDATA%\PSAT\data` (or a folder chosen at install) | the user — **never touched by an update** |

Anything written inside the application folder is destroyed by the next update. If you add
backend code that writes a file at runtime, resolve its path through
`backend/app/services/paths.py` — never hard-code a path under `backend/`.

The chosen data folder is recorded in `data_dir.txt` in the install folder. It sits
outside every update component, so it survives updates.

---

## 1. Prerequisites (reference/build machine only)

You build on **one** controlled machine. Target machines need none of this.

- The `psat` conda environment (the app's Python dependencies).
- `conda-pack` in that env: `python -m pip install conda-pack`
- Node.js (to build the frontend).
- `cryptography` is **not** required — update signing was removed.

Target machines need **nothing** — no Python, Node, conda, or Git.

### Which OS builds what (the dual build system)
There are two build scripts — `build_bundle.ps1` (Windows) and `build_bundle.sh`
(macOS/Linux) — because the frozen `python/` component is the **build machine's own**
interpreter + native binaries (torch, GDAL, fiona…) and cannot cross-compile:

| You are building… | Where it must run |
|---|---|
| A **full bundle** or the **`python/` component** (dependency change) | On the **target OS**. The fleet is Windows → build on Windows (`build_bundle.ps1`). |
| A **`--skip-python` update** (backend / webui / models / shapefiles change) | On **any** OS. These components are platform-independent and clients compare *content* digests, so a macOS/Linux build (`build_bundle.sh --no-python`) produces a release valid for the Windows fleet. |

`make_release.py` runs on a plain-Python machine with **no** conda env — it loads the
digest functions from `updater.py` in isolation (falls back automatically), so a Mac can
package `--skip-python` releases. The one thing a Mac/Linux build can **never** ship to
Windows is the `python/` interpreter itself.

---

## 2. Build a bundle

```powershell
pwsh scripts\bundle\build_bundle.ps1 -OutDir D:\PSAT-build
```

- ~15 minutes cold; produces `D:\PSAT-build\PSAT\` (~9 GB).
- Flags: `-SkipEnv` reuses the packed interpreter (the slow ~4 GB step);
  `-SkipFrontend` reuses an existing `frontend/dist`.
- The script **verifies before declaring success**: a required-paths manifest plus a real
  `create_app()` import inside the frozen interpreter. If it says the bundle is
  incomplete, believe it — do not ship a bundle that failed verification.

Test it locally: `D:\PSAT-build\PSAT\PSAT.bat`

**Bundle layout produced:**

```
PSAT\
  python\     frozen CPython + all dependencies (relocatable)
  backend\    app code + models\ + shapefiles\ + version.json
  webui\      built React frontend (no node_modules)
  launcher\   launch_psat.py
  PSAT.bat    entry point
```

### On macOS / Linux (`build_bundle.sh`)
Same script, ported. A **full** build needs a local conda env to freeze
(`--conda-env`), and its `python/` runs only on that OS (see §1). The common case on a
non-Windows machine is a **backend / webui update for the Windows fleet**, built without
the frozen interpreter:

```bash
# Backend-only update (no frontend rebuild, no 5 GB GIS, no interpreter):
scripts/bundle/build_bundle.sh --out-dir temp/PSAT-build --no-python --no-webui --skip-gis
```

Useful flags (beyond the ps1's `--skip-env` / `--skip-frontend`): `--no-python` (skip the
frozen interpreter + its smoke test), `--no-webui` (backend-only — avoids shipping a
rebuilt/mismatched frontend when only the backend changed), `--skip-gis` (omit
models/shapefiles). Output goes under `temp/` (git-ignored). Then package with
`make_release.py … --skip-python` exactly as in §6 — it needs no conda env.

---

## 2b. Prepare the survey data (flatten the delivery)

**PathWatcher deliveries are not in the layout PSAT needs**, so this step is mandatory
before the data can be seeded.

A delivery arrives grouped by map region:

```
LIGHTHAUS MAR 2026\LIGHTHAUS MAR 2026\
  NE1\ANCHORVALE LINK\*.jpeg
  SE2\MACPHERSON ROAD\*.jpeg          <- 13 regions
```

PSAT needs road folders **flat**, images directly inside, quarter-suffixed:

```
in\ANCHORVALE LINK_1Q2026\*.jpeg
```

```powershell
pwsh scripts\bundle\flatten_survey_data.ps1 `
    -Source "D:\LIGHTHAUS MAR 2026\LIGHTHAUS MAR 2026" `
    -Dest   "D:\PSAT-seed\in" -Quarter 1Q2026
```

Add `-Regions "NE1"` to trial one region first, or `-WhatIfOnly` to preview.

### Three things this handles that a plain copy would get wrong

1. **Roads spanning regions.** 274 roads appear in more than one region (MACPHERSON ROAD
   is in SE1+SE2+SE3). A naive flatten has each region overwrite the last and silently
   loses frames. These are **merged** instead.
2. **Repeated frame names.** Where a road crosses a boundary the delivery repeats frames.
   In the Mar-2026 delivery, 344 repeats were byte-identical (safely collapsed) but **15
   were different images sharing a filename**. Those are kept under `__<REGION>` names, so
   nothing is lost. The script hashes to tell the two cases apart — never assume.
3. **Timestamps.** PSAT derives the survey quarter from file **mtime**, so timestamps are
   preserved. Resetting them to copy-time would mislabel the entire delivery.

### Choosing the `-Quarter` value
Check the delivery's file mtimes, not the folder name — the Mar-2026 delivery has mtimes
of `2026-03-05` (Q1) even though capture dates run Dec 2025–Jan 2026. The script reports
any file falling outside the quarter you named, so a wrong value is visible rather than
silent. Getting it right avoids PSAT renaming thousands of folders on first run.

### Verify before shipping
The script fails loudly on file-count mismatch, copy errors, or an empty run. Only ship a
`FLATTEN OK` result.

> **Do not point PSAT at a delivery you also use as a master copy.** Creating a project
> runs `prune_source_folder`, which permanently deletes raw frames. Always work on a copy.

---

## 2c. Shrink the data (pre-prune) — 129 GB → 28 GB

A full quarter of raw frames is ~129 GB, more than the office machines can be relied on to
have free. **Frames cannot simply be thinned** — PSAT samples one roughly every 10 m, so
removing frames silently undercuts segments and road length (measured: keeping half lost
31% of segments, and the road measured shorter).

The one safe reduction is **the app's own pruning**, which deletes exactly the frames no
project references. That needs a project to exist, so this creates one per road:

```powershell
pwsh scripts\bundle\preprune_seed_data.ps1 -DataRoot D:\PSAT-seed
```

Add `-Limit 25` to sample first. Run it **once on the build machine** — the shrunken result
ships to every machine, so the cost is paid here instead of 11 times.

### Why this is safe when thinning is not
The project's geometry is computed from the **full** frame set *before* anything is deleted.
Pruning then removes only what that project doesn't reference. The project keeps its correct
segments; the folder shrinks. Pruning also re-stamps the folder's pre-prune summary, so the
Create Project table still reports the true image count and segment count.

### Measured on the Mar-2026 quarter
| | |
|---|---|
| Survey data | **128.68 GB → 27.88 GB (78% smaller)** |
| Project data | 0.41 GB |
| **Total to ship** | **28.28 GB** |
| Projects created | 3,730 of 3,868 |
| Runtime | ~3 h (one-off) |

Verified afterwards: project segments = folder-reported segments = frames on disk, exactly
one anchor frame per segment (ALKAFF CRESCENT 59/59/59, BRADDELL ROAD 367/367/367).

### The 138 roads that "fail" are fine
They error with *"No geotagged images found inside the selected polygon"* — these are stub
roads of 1–21 frames, too short to form a segment. They keep **all** their frames, stay
fully correct, and total ~576 frames (~75 MB). Nothing to fix.

### ⚠️ Ship `in/` AND `data/` together — the projects are not optional
A pruned folder **without** its project is the broken state: creating a new project from it
would resample the thinned frames and undercount. The projects are what make the pruned
state valid. Never ship one without the other, and never re-run the flatten over a pruned
`in/` without also discarding `data/`.

> Note (2026-07-28): on the *deployed* machine, `prune_source_folder` now no-ops on any
> folder already marked `pruned:true`, so a user creating a project from a shipped folder can
> no longer delete its anchor frames (previously a second profile could — see the history
> doc's "Pruned source folders" entry). This is a data-loss safety net only; the undercount
> above is unchanged, so the ship-together rule still stands.

---

## 3. Make the install drive

One command assembles everything and verifies it:

```powershell
pwsh scripts\bundle\make_install_drive.ps1 -Drive F:\ `
    -Bundle D:\PSAT-build\PSAT -SeedData D:\PSAT-seed\in
```

It space-checks first, copies the bundle + installer tooling + survey data, then confirms
byte totals. **Safe to re-run** — robocopy skips identical files, so an interrupted copy
resumes rather than restarting.

Resulting layout:

```
<drive>\
  PSAT\               the app bundle
  Install PSAT.bat    double-click to install
  install_psat.ps1
  Uninstall PSAT.bat  for reinstall/test cycles
  uninstall_psat.ps1
  verify_drive.ps1
  RUNBOOK.md
  seed-data\          flattened survey data (road folders)
```

### Drive sizing
App ~9 GB + a full quarter ~129 GB, so use a **256 GB** drive for a whole quarter. A
portable SSD is worth it: reading hundreds of thousands of small files from USB flash is
painfully slow.

### Loose vs zipped survey data
The data is copied **loose**, not zipped. JPEGs barely compress, so zipping ~129 GB would
cost hours and save almost nothing in size — and loose lets robocopy **resume**, which
matters because an interrupted copy to removable media has already bitten this project
once. The trade-off is slower per-machine install (many small reads from USB). The
installer also accepts `seed-data.zip`, so archiving is the optimisation to reach for if
install time becomes the bottleneck.

> Ship folders that have **not** had projects created from them. Creating a project prunes
> the raw frames, and a pruned folder re-imports with a wrong (much lower) segment count.
> Flatten from the original delivery, never from a working copy.

### Always verify the drive before carrying it anywhere

```powershell
pwsh scripts\bundle\verify_drive.ps1 -Drive E:\ -Source D:\PSAT-build\PSAT\..\PSAT-USB
```

It compares file count and exact byte total against the source **and runs the copied
interpreter** (imports torch/geopandas/pywrite, checks the PROJ transform, calls
`create_app()`). This exists because a partial copy once looked exactly like a code bug —
do not skip it. `DRIVE VERIFIED` means safe to go.

---

## 4. Install on a machine

Double-click **`Install PSAT.bat`**. No admin required.

It will:
1. Ask where to store data (press Enter for `%LOCALAPPDATA%\PSAT\data`, or type a path).
   Choose a non-system drive if the machine's `C:` is tight.
2. If PSAT data already exists there, ask **Keep or Wipe**. Keep = normal reinstall (data
   preserved). Wipe = fresh start — deletes all projects, survey images and profiles after
   you type `WIPE`. Scripted equivalent: `-CleanData`.
3. Preflight free disk and **refuse with a clear number** rather than half-filling a drive.
4. Copy the app + survey data + projects (`seed\in` → `<data>\in`, `seed\data` → `<data>\data`),
   and create Desktop + Start Menu shortcuts.

Then launch from the **Desktop shortcut**. First start is slow (GIS warmup — up to a
couple of minutes). A browser opens to the app.

### First launch on each machine
1. On the landing page, **create a profile** (name + PIN). One user per machine.
2. That's it — the ~3,730 pre-seeded road projects are **adopted into the profile
   automatically on login** (a same-volume move, ~3 s for the whole quarter). No banner,
   no click. Images resolve immediately because they live in the shared `in/` and are not
   moved.

**Smoke test after install:** app opens · the seeded projects are listed · open one and
confirm segments + images show · **run autocode on a fresh road** (the most important check
— it's the torch/YOLO path) · GIS layers render.

---

## 5. Uninstall / reinstall (for testing)

Double-click **`Uninstall PSAT.bat`**, or:

```powershell
pwsh scripts\bundle\uninstall_psat.ps1            # removes the app, KEEPS data
pwsh scripts\bundle\uninstall_psat.ps1 -IncludeData   # also deletes projects+data
```

- Stops a running PSAT first (files can't be deleted while in use).
- Only removes shortcuts pointing at the install being removed.
- **Data is kept by default.** `-IncludeData` requires typing `DELETE DATA` in full,
  because the data folder holds coded projects that are not recoverable from the drive.
- Reads the real data location from `data_dir.txt`, so a wipe can't miss it.

---

## 6. Publish an update

This is the part not yet rehearsed machine-to-machine — do one dry run before relying on it.

### Step 1 — bump the version
Edit `backend/version.json` (e.g. `"1.0"` → `"1.1"`) **before building**, or installed
clients report the wrong version.

### Step 2 — build + package
```powershell
pwsh scripts\bundle\build_bundle.ps1 -OutDir D:\PSAT-build -SkipEnv

python scripts\bundle\make_release.py `
    --bundle D:\PSAT-build\PSAT `
    --out    D:\PSAT-build\release-1.1 `
    --version 1.1 --notes "What changed" --skip-python
```
Use `--skip-python` when dependencies have not changed (the interpreter is the big, rarely
changing component). Omit it when you have changed the conda env.

### Step 3 — publish
Create a **GitHub Release** on `LinXH8/PathSafetyAssessmentTool` tagged `v1.1` and **upload
every file** in `release-1.1\`, including `manifest.json`.

Clients read the manifest from the release tagged `latest`, so publishing the release is
what makes the update live.

**Expected sizes (compressed):** frontend-only change ~7 MB; whole release minus the
interpreter ~0.7 GB; the interpreter ~1.5 GB (only when dependencies changed). Components
are split into `<2 GiB` parts to respect GitHub's asset cap, and reassembled client-side.

### What happens on the user's machine
1. The app checks `manifest.json` (~20 s after launch, then every 6 h).
2. If something differs, the **update modal** offers it; the user chooses to download.
3. Only changed components download, each verified by sha256, staged in `pending\`.
4. **Nothing is applied while the app runs.** On the next launch the launcher moves the
   current versions into `rollback\`, extracts the new ones, and starts the app.
5. If the updated app fails its health check, it **rolls back automatically** and starts
   the previous version. On success, `rollback\` is deleted.

---

## 7. Environment variables

Set by the launcher; useful for manual runs and debugging.

| Variable | Default | Meaning |
|---|---|---|
| `PSAT_DATA_DIR` | (see `data_dir.txt`, then `%LOCALAPPDATA%\PSAT\data`) | Writable data root. Highest priority. |
| `PSAT_HOST` | `127.0.0.1` | Bind address. **Loopback on purpose** — `0.0.0.0` would publish every project to the LAN unauthenticated. |
| `PSAT_PORT` | `8000` | Port. The launcher scans upward from here for a free one. |
| `PSAT_THREADS` | `8` | waitress worker threads. |
| `PSAT_DEV` | (unset) | `=1` runs the Flask dev server with auto-reload instead of waitress. Dev only. |
| `PSAT_WEBUI_DIR` | (auto) | Override the built-frontend location. |
| `PSAT_UPDATE_URL` | GitHub latest-release manifest | Override the update feed (useful for testing against a local server). |

---

## 8. Key files

| Path | What |
|---|---|
| `scripts/bundle/build_bundle.ps1` | Build + verify the bundle (Windows) |
| `scripts/bundle/build_bundle.sh` | Build + verify the bundle (macOS/Linux); `--no-python`/`--no-webui`/`--skip-gis` for platform-independent update builds |
| `scripts/bundle/make_release.py` | Turn a bundle into release archives + `manifest.json`; runs without a conda env (isolated `updater.py` load) |
| `scripts/bundle/install_psat.ps1` · `Install PSAT.bat` | Per-user installer |
| `scripts/bundle/uninstall_psat.ps1` · `Uninstall PSAT.bat` | Uninstaller (keeps data by default) |
| `scripts/bundle/verify_drive.ps1` | Validate a copied drive by running its interpreter |
| `scripts/bundle/launch_psat.py` | Runtime launcher: applies staged updates, port scan, health wait, rollback |
| `backend/version.json` | Single source of truth for the version; surfaced at `/api/health` |
| `backend/app/services/paths.py` | Install-root vs user-data-root resolution — **the separation rule** |
| `backend/app/__init__.py` | numpy-first OpenMP guard + GDAL/PROJ self-location (keep numpy import first) |
| `backend/app/webui.py` | Flask serves the built frontend (one port) |
| `backend/app/api/tiles.py` | Basemap tile proxy (`/api/tiles/...`) |
| `backend/app/services/updater.py` · `app/api/updates.py` | Update check/download/stage + endpoints |
| `frontend/src/components/common/UpdateModal.tsx` | The update-available UI |

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "PSAT needs X GB, drive has Y GB free" | Genuinely out of space. Free space or pick another data folder. |
| Create Project shows no folders | Survey data isn't in `<data>\in\`. Check `data_dir.txt` for where data actually lives. |
| Seeded projects don't appear after install | The one-time move wasn't done. On the Projects page click **Move Shared Projects** (create a profile first if needed). |
| "module not found" errors (`distutils`, `pywin32`, `urllib`, …) on a fresh install | **Truncated drive copy.** Re-copy and run `verify_drive.ps1` before reusing the drive. Not a code bug. |
| Wrong / much lower segment counts on import | The source folder was already pruned by a prior project. Use un-pruned folders. (Since 2026-07-28 re-creating from a pruned folder no longer *deletes* its frames — `prune_source_folder` no-ops on `pruned:true` folders — but the newly-created project still undercounts, so this remains build-stage guidance.) |
| Seed frames vanished / dropped further after a second profile created a project | Fixed 2026-07-28. Pruning was profile-scoped and would delete anchors protected only by the first profile's shipped project; `prune_source_folder` now skips already-pruned folders. If a pre-fix machine already lost frames, re-seed that folder's `in/` + `data/` from the drive. |
| App ignores the chosen data folder | A corrupt `data_dir.txt` (e.g. a BOM). Current code tolerates a BOM; if hand-edited, save as plain UTF-8. |
| Grey/blank maps | No internet. Expected — basemaps come from CARTO and cache per-user as you browse. Everything else works offline. |
| "The update could not be installed" | Already rolled back automatically; the previous version runs. Safe to retry. |
| App stuck on the old version after an update | A `pending\` folder is staged in the install dir. Restart PSAT to apply it. |
| Asks for Python / Node / conda / Git | **Something is wrong.** A correct bundle needs none of these. Re-verify the drive/bundle. |

**Last-resort recovery:** reinstall from the drive. User data is untouched — it lives
outside the app folder.

---

## 10. Deliberate omissions (do not "fix" these)

- **No update signing.** Removed on purpose; downloads are still sha256-verified over
  HTTPS. See the history doc for the reasoning.
- **No offline basemaps.** Maps need internet for tile imagery; everything else works
  offline. The `/api/tiles` indirection is kept so a bundled tile source could be added
  later without frontend changes.
- **No code-signing certificate.** First install comes from USB, which avoids the
  SmartScreen warning; target machines have no restriction software.
- **`python app.py` runs waitress, not the dev server.** Use `PSAT_DEV=1` for the
  auto-reloading dev server.
