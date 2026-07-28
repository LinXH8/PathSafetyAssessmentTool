# How to Ship a PSAT Update — Step by Step

> **Read this first, in full, before publishing anything.** It is written for someone who
> did not build PSAT. Follow it exactly. If a step doesn't work, **stop and ask** — do not
> improvise, and do not hand-make any files.

---

## THE ONE RULE

# 🚫 Never make the update ZIP files yourself. 🚫

You do **not** open folders, drag things into a `.zip`, or arrange anything by hand. **Two
commands** turn your code change into the exact files to publish. If you build the ZIPs
yourself, the update **will fail on every machine** — and in a way that is very hard to
diagnose. The section "Why hand-zipping breaks everything" explains why, if you want it.

Your entire job is: **change the code → run two commands → upload the folder they produce.**

---

## Why the codebase doesn't look like the installed folders

This is the confusion to clear up first.

**In the code (this repository), the layout is:**

```
PathSafetyAssessmentTool\
  backend\            ← the Python server code
    app\
    app.py
    version.json
    models\
    shapefiles\
  frontend\           ← the user interface, as SOURCE code (not usable directly)
    src\
  scripts\bundle\     ← the tools that do everything below
```

**On an installed machine, the layout is different:**

```
PSAT\
  python\             ← a whole copy of Python + all libraries
  backend\            ← the server code (copied from the repo's backend\)
  webui\              ← the BUILT interface (frontend\ turned into something a browser runs)
  launcher\
  PSAT.bat
```

They look different **on purpose**. The installed version is a packaged, ready-to-run
product; the repository is the raw ingredients. **You never convert one to the other by
hand — a script does it.** That script is `build_bundle.ps1`.

**A published update is a THIRD shape** — a folder of `.zip` files plus one `manifest.json`:

```
release-1.1\
  webui.zip
  backend.zip
  models.zip
  python.zip           (only if libraries changed)
  shp-*.zip            (one per GIS layer)
  manifest.json        ← the "index" that ties it all together
```

**You never make these either.** The script `make_release.py` produces them. Your only
manual step is uploading this folder's contents to GitHub.

So the whole pipeline is just:

```
   repo  --build_bundle.ps1-->  PSAT\ (installed shape)  --make_release.py-->  release\ (zips + manifest)  --you upload-->  GitHub
   (edit here)                    (a script does it)                            (a script does it)                          (your only manual step)
```

---

## What you actually run to ship a change

You need the **build machine** — the one PC set up with the tools (Python/conda env, Node,
this repository). Updates can only be built there. A normal office laptop cannot build an
update; it can only receive them.

### Step 1 — make your code change
Edit the code in the repository as normal, and confirm it works by running the app in the
usual dev way (`cd frontend && npm run dev`, `cd backend && python app.py`).

### Step 2 — set the new version number
Open **`backend\version.json`** and increase the version, e.g.:

```json
{ "version": "1.1", "channel": "stable" }
```

Rules: only ever go **up** (1.0 → 1.1 → 1.2 …). Never reuse a number. This is what tells
the machines "there is something newer."

### Step 3 — build the packaged app (one command)
```powershell
pwsh scripts\bundle\build_bundle.ps1 -OutDir D:\PSAT-build -SkipEnv
```
This rebuilds the interface and repackages everything into `D:\PSAT-build\PSAT\`. It takes
a few minutes. `-SkipEnv` reuses the big Python copy (correct for a normal code change).
**Only drop `-SkipEnv`** if you changed the Python libraries (added/removed a package) —
then it rebuilds the ~4 GB Python component too.

If it prints an error or "bundle is incomplete", **stop** — do not continue to Step 4.

### Step 4 — make the update files (one command)
```powershell
python scripts\bundle\make_release.py --bundle D:\PSAT-build\PSAT `
    --out D:\PSAT-build\release-1.1 --version 1.1 --notes "Fixed the thing" --skip-python
```
- `--version` **must match** what you put in `version.json` (1.1 here).
- `--notes` is the short message users see in the update popup. Keep it plain.
- `--skip-python` leaves out the 4 GB Python component. **Keep it in** for normal code
  changes. **Remove it only** if you rebuilt Python in Step 3.

This creates `D:\PSAT-build\release-1.1\` full of `.zip` files and one `manifest.json`.
**That folder is your finished update. Do not touch or rename anything inside it.**

> **On a Mac (or Linux)?** You can ship a **backend or frontend** change without a Windows
> machine — those parts of the app are the same on every OS. Use the `.sh` build script
> instead of the `.ps1`, then the **same** `make_release.py` command:
> ```bash
> scripts/bundle/build_bundle.sh --out-dir temp/PSAT-build --no-python --no-webui --skip-gis
> python3 scripts/bundle/make_release.py --bundle temp/PSAT-build/PSAT \
>     --out temp/release-1.1 --version 1.1 --notes "Fixed the thing" --skip-python
> ```
> (`--no-webui` for a backend-only change; drop it and let the script build the frontend for
> a UI change.) The one thing a Mac **cannot** build for the Windows machines is a
> **dependency change** (a new Python package) — that needs the `--skip-python` flag dropped,
> which only works on Windows. For those, use the build machine. Everything else about
> publishing (Step 5) is identical.

### Step 5 — publish on GitHub (your only manual, click-based step)
1. Go to the repository on GitHub → **Releases** → **Draft a new release**.
2. **Tag:** type `v1.1` (the letter v, then your version). Create the tag on `main`.
3. **Title:** `PSAT 1.1` (or similar).
4. **Attach files:** open `D:\PSAT-build\release-1.1\` and drag **every single file** into
   the release's attachment box — all the `.zip` files **and** `manifest.json`. Miss one
   and the update breaks.
5. Click **Publish release**.

Done. Within a few hours (or immediately if a user reopens PSAT) each machine sees the
update, shows the popup, and installs it on the next restart.

---

## A worked example: changing a label in the interface

Say you want to change a button's text.

1. Edit the file in `frontend\src\...`, save.
2. Check it in dev (`cd frontend && npm run dev`).
3. `backend\version.json`: `1.0` → `1.1`.
4. `pwsh scripts\bundle\build_bundle.ps1 -OutDir D:\PSAT-build -SkipEnv`
5. `python scripts\bundle\make_release.py --bundle D:\PSAT-build\PSAT --out D:\PSAT-build\release-1.1 --version 1.1 --notes "Renamed the export button" --skip-python`
6. This produces a **tiny** `webui.zip` (a few MB) plus the manifest. Publish the folder to
   GitHub as release `v1.1`.
7. Each machine downloads only the few MB that changed, and shows the new label after a
   restart.

You did not create a single ZIP or folder by hand. That is the point.

---

## 🚫 DO NOT — the list that will save you

- **DO NOT** create ZIP files yourself. Only `make_release.py` may.
- **DO NOT** rename, edit, delete, or add anything inside the `release-*` folder. It is a
  matched set — the `manifest.json` contains exact fingerprints of each ZIP, and any change
  makes them mismatch.
- **DO NOT** edit `manifest.json` in a text editor. Ever.
- **DO NOT** reuse or lower a version number.
- **DO NOT** forget to upload `manifest.json` — it is the piece everything depends on.
- **DO NOT** upload only some of the files. Upload the whole folder's contents.
- **DO NOT** try to build an update on an office laptop. Only the build machine can.
- **DO NOT** change `backend\version.json` without also rebuilding (Steps 3–4). The version
  and the files must always be produced together.

---

## Why hand-zipping breaks everything (the reason behind the rule)

Every machine checks the update honestly. For each ZIP, `manifest.json` records an exact
**fingerprint** (a SHA-256 hash — a long code derived from the file's precise contents).
When a machine downloads a ZIP, it recomputes that fingerprint and **refuses the file unless
it matches**. This is a safety feature: it stops a corrupted or tampered download from ever
being installed.

`make_release.py` writes the ZIPs and the fingerprints **together**, so they always match. If
you make a ZIP by hand — even one with the exact same files — its bytes differ (compression,
ordering, timestamps), so its fingerprint won't match what the manifest says, and every
machine will reject it. The update silently does nothing, and you will have no obvious clue
why. The same happens if you edit anything in the folder after `make_release.py` ran.

So: the tool makes the files and their fingerprints as one step. Never come between them.

---

## What happens on the machines (so you know it's working)

1. On launch, and every 6 hours, each machine reads `manifest.json` from the **latest**
   GitHub release.
2. If something changed, a popup offers the update with its download size. The user clicks
   **Download**.
3. Only the changed ZIPs download, each fingerprint-checked, and are set aside.
4. The popup says it installs on next start. When the user reopens PSAT, it swaps in the new
   files and starts up.
5. If the new version fails to start, it **automatically rolls back** to the previous one.

Nothing is forced on the user, nothing installs while they're working, and a bad update
undoes itself.

---

## How a machine knows what it already has (no action needed)

A machine works out which version each component is on by **hashing its own installed
files** and comparing that to the manifest. It needs no baseline file and no prior update
to have happened — a brand-new install correctly sees "nothing to download" for its own
version, and only downloads the parts that genuinely differ in a newer release. (This
replaced an earlier design that could have made a fresh machine re-download everything.)

You still do not have to do anything special for the first release. Just follow the steps
above.

---

## If something goes wrong

| Symptom | What to check |
|---|---|
| Machines don't see the update | Did you publish the release (not leave it a draft)? Is `manifest.json` attached? Is the version number higher than before? |
| Update popup appears but download fails | A file is missing from the release, or the wrong files were uploaded. Re-run `make_release.py` and re-upload the **whole** folder. |
| Popup offers a huge (many-GB) download for a small change | The manifest and the files don't match — almost always because something in the release folder was edited or hand-zipped. Re-run `make_release.py` cleanly and re-upload the whole folder. |
| Build step errors | Do not proceed to publish. The error must be fixed first. Ask the maintainer. |

**Golden rule again:** change code → two commands → upload the produced folder. Never make
or edit the ZIPs or the manifest yourself.
