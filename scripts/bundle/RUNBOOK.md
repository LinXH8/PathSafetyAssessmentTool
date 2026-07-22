# PSAT deployment runbook

Everything needed to build, ship, install and update PSAT on company Windows
machines. Written to be followed by someone who is not the author.

---

## 0. The one rule

**App and data live apart.**

| | Location | Owner |
|---|---|---|
| App | `%LOCALAPPDATA%\Programs\PSAT` | the updater — **replaced wholesale** |
| Data | `%LOCALAPPDATA%\PSAT\data`, or wherever chosen at install | the user — **never touched** |

Anything stored inside the app folder is destroyed by the next update. If you add
code that writes at runtime, resolve the path through
`backend/app/services/paths.py`.

---

## 1. Build a bundle

On the reference machine (needs the `psat` conda env, Node, and the repo):

```powershell
pwsh scripts\bundle\build_bundle.ps1 -OutDir D:\PSAT-build
```

Roughly 15 minutes cold; ~9 GB out. Flags: `-SkipEnv` reuses the packed
interpreter (the slow part), `-SkipFrontend` reuses `frontend/dist`.

The script **verifies** before declaring success: a required-paths manifest plus a
real `create_app()` import inside the frozen interpreter. If it says "bundle is
incomplete", believe it — an early version silently shipped a bundle missing the
scoring model and the whole profile system, and it assembled without error.

Test locally: `D:\PSAT-build\PSAT\PSAT.bat`

---

## 2. Make the thumbdrive

Copy onto the drive (64 GB+; a portable SSD is much faster):

```
<drive>\
  PSAT\              <- from D:\PSAT-build\PSAT
  install_psat.ps1   <- from scripts\bundle\
  Install PSAT.bat   <- from scripts\bundle\
  seed-data.zip      <- optional: survey folders, zipped
```

**Zip the survey data.** A quarter is ~365,000 files; copying them loose from USB
is dramatically slower than extracting one archive. The zip's contents should be
the survey folders themselves — they land in `<data>\in\`.

> Ship folders that have **not** had projects created from them. Creating a project
> runs `prune_source_folder`, which permanently deletes the dense raw frames. A
> pruned folder re-imports with a wrong (much lower) segment count.

---

## 3. Install on a machine

Double-click **`Install PSAT.bat`**. No admin needed.

It asks where data should go (Enter accepts `%LOCALAPPDATA%\PSAT\data`), checks
free space, copies the app, extracts seed data, and makes Desktop + Start Menu
shortcuts.

Choose a non-system drive if the machine's `C:` is tight — 45 GB of survey data
on a small system SSD is a bad time. The choice is recorded in
`data_dir.txt` in the install folder and survives updates.

Then launch from the Desktop shortcut. First start is slow (GIS warmup).

---

## 4. Publish an update

```powershell
# 1. build the new bundle
pwsh scripts\bundle\build_bundle.ps1 -OutDir D:\PSAT-build -SkipEnv

# 2. package it   (--skip-python when dependencies have not changed)
python scripts\bundle\make_release.py `
    --bundle D:\PSAT-build\PSAT `
    --out    D:\PSAT-build\release-1.1 `
    --version 1.1 --notes "What changed" --skip-python
```

Then create a GitHub Release on `LinXH8/PathSafetyAssessmentTool` tagged `v1.1`
and **upload every file** from `release-1.1\`, `manifest.json` included.

Bump `backend/version.json` to match before building, or installed clients will
report the old version.

**Sizes to expect** (compressed): frontend-only change ~7 MB; whole release minus
the interpreter ~0.7 GB; the interpreter ~1.5 GB (only when dependencies change).
Components are per top-level shapefile directory, so a one-layer GIS fix ships
that directory alone rather than 5 GB.

---

## 5. What happens on the user's machine

1. The app checks `manifest.json` from the latest release.
2. If something differs, it offers the update; the user chooses to download.
3. Only changed components download, each verified by sha256.
4. Files are staged in `pending\`; **nothing is applied while the app runs.**
5. Next launch: the launcher moves the current versions into `rollback\`,
   extracts the new ones, and starts the app.
6. If the new version fails its health check, it **rolls back automatically** and
   starts the previous version.
7. On success, `rollback\` is deleted.

Updates are never applied silently, and never on a running app.

---

## 6. When something goes wrong

| Symptom | Cause / fix |
|---|---|
| "PSAT needs X GB, drive has Y GB free" | Genuinely out of space. Free space or re-run and pick another folder. |
| Create Project shows no folders | Survey data is not in `<data>\in\`. Check `data_dir.txt` for where data actually lives. |
| "The update could not be installed" | Already rolled back; the app runs the previous version. Safe to retry. |
| App stuck on the old version | Look for `pending\` in the install folder — an update is staged. Restart PSAT. |
| Grey/blank maps | No internet. Expected: basemaps come from CARTO and are cached per user as they browse. Everything else works offline. |
| Won't start after an update | The launcher should self-heal. If not, delete `pending\` and restart; if `rollback\` exists, its contents are the previous version. |

**Manual recovery of last resort:** reinstall from the thumbdrive. Data is
untouched — it lives outside the app folder.

---

## 7. Deliberate omissions

- **No update signing.** Considered and dropped (2026-07-21): the same GitHub
  account already controls the source, so key management cost more than it bought
  at this fleet size. Downloads are still checksum-verified; transport is HTTPS.
- **No offline basemaps.** Decided 2026-07-21. Maps need internet for the tile
  imagery; everything else works offline.
- **No code-signing certificate.** Target machines have no restriction software.
  Delivering the first install from USB avoids the SmartScreen warning that a
  downloaded installer would trigger.
