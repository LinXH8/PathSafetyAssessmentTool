# How to Update PSAT on Every Machine, Remotely

> **Who this is for:** anyone, at any experience level, who needs to push a change out to
> the installed PSAT machines. Follow it top to bottom the first time. Once you've done it
> once, the **Quick version** at the top is all you'll need.
>
> **Related docs:** [deployment-operations-guide.md](deployment-operations-guide.md) (the full
> build/install reference), [deployment-updating-guide.md](deployment-updating-guide.md) (the
> strict "never hand-zip" rules), [deployment-decisions-and-history.md](deployment-decisions-and-history.md)
> (why it all works this way).

---

## The 60-second mental model

- **The app and the user's data live apart.** An update only ever replaces **app files**;
  it never touches anyone's projects, coding, survey photos, or profiles.
- **You don't push to the machines. They pull.** You publish a **GitHub Release**; each
  installed PSAT checks GitHub on its own (about **20 seconds after it starts, then every
  6 hours**), offers the update, downloads it, and applies it on the **next restart**. A
  bad update **rolls itself back** automatically.
- **Machines download only what changed.** Each machine compares a fingerprint of its own
  files against the release. A backend fix is a ~20 MB download, not a 9 GB one.
- **You can build most updates on ANY computer — including a Mac.** Only one kind of change
  is Windows-only (see the table in Step 1).

That's the whole system. Now the steps.

---

## Quick version (once you've done it before)

```bash
# 1. commit your change to main, then bump the version:
#    edit backend/version.json  ->  "version": "1.02"

# 2. build (Mac/Linux; backend and/or frontend change):
scripts/bundle/build_bundle.sh --out-dir temp/PSAT-build --no-python --skip-gis

# 3. package:
python3 scripts/bundle/make_release.py --bundle temp/PSAT-build/PSAT \
    --out temp/release-1.02 --version 1.02 --notes "What changed, in plain words" --skip-python

# 4. publish: GitHub -> Releases -> Draft new release -> tag v1.02, target main,
#    attach EVERY file in temp/release-1.02/ (manifest.json included) -> Publish.
```

On Windows, swap step 2 for `pwsh scripts\bundle\build_bundle.ps1 -OutDir temp\PSAT-build -SkipEnv`.
The rest is identical. Everything below explains each step for a first-timer.

---

## Step 1 — Decide what kind of change you're shipping

This decides **which computer you can build on**. Nothing else changes.

| What you changed | Build on | How |
|---|---|---|
| **Backend code** (Python) and/or **frontend** (the interface) | **Any** computer, incl. a Mac | `build_bundle.sh --no-python …` + `make_release.py --skip-python` |
| **GIS data** (shapefiles) or **models** (YOLO weights) | **Any** computer | same, but **drop** `--skip-gis` so the changed data is included |
| **A new/updated Python dependency** (you added a package to the app) | **Windows build machine only** | full `build_bundle.ps1` + `make_release.py` **without** `--skip-python` |

**Why the last row is special:** the update includes a frozen copy of Python + its libraries,
and that copy is specific to the operating system it was built on. A Mac-built Python can't
run on the Windows machines. Everything else (your code, the built interface, data) is the
same on every OS, so any computer can build it. (Full reasoning:
[deployment-decisions-and-history.md](deployment-decisions-and-history.md) → "Build hosts".)

> If you're not sure whether you changed a dependency: did you `pip install` / `conda install`
> something new that the app imports? If no, you did **not** change a dependency — use the
> normal (any-computer) path.

---

## Step 2 — Make your change and put it on `main`

1. Edit the code and confirm it works locally (`cd frontend && npm run dev`, `cd backend && python app.py`).
2. **Commit and push to `main`.** The build reads from your working copy, so the branch and
   your files should be clean and current. Pull `main` first if you're on the build machine.

---

## Step 3 — Bump the version number

Open **`backend/version.json`** and raise the version:

```json
{ "version": "1.02", "channel": "stable" }
```

Rules:
- **Only ever go up.** `1.0 → 1.01 → 1.02 → 1.1 …`. Never reuse a number.
- It's the label users see in the update popup. (The machines actually decide "is there
  something new?" by comparing file fingerprints, so the *exact* number doesn't gate the
  update — but always bump it so versions stay meaningful and go forward.)

Commit this too.

---

## Step 4 — Build the update files

Pick the row that matches Step 1. `temp/` is git-ignored, so the (large) build output never
gets committed.

**Backend and/or frontend change — on a Mac/Linux (the common case):**
```bash
scripts/bundle/build_bundle.sh --out-dir temp/PSAT-build --no-python --skip-gis
```
- Add `--no-webui` if you changed **only** the backend — it skips rebuilding the interface,
  which keeps the update tiny **and** avoids accidentally shipping an unfinished UI change.
- Leave `--no-webui` **off** if you changed the interface (the script will build it).

**Same change — on the Windows build machine:**
```powershell
pwsh scripts\bundle\build_bundle.ps1 -OutDir temp\PSAT-build -SkipEnv
```

**GIS/model data change (any computer):** as above but **remove** `--skip-gis` so the data
is included.

**Dependency change (Windows only):** `pwsh scripts\bundle\build_bundle.ps1 -OutDir temp\PSAT-build`
(drop `-SkipEnv` so it re-freezes Python).

The script prints a size report and **refuses to finish if the bundle is incomplete** — if
it errors, stop and fix it; do not continue.

---

## Step 5 — Package it into a release

Same command on every OS (it needs no special setup — plain Python is enough):

```bash
python3 scripts/bundle/make_release.py --bundle temp/PSAT-build/PSAT \
    --out temp/release-1.02 --version 1.02 \
    --notes "Plain-words summary users will see in the popup" --skip-python
```

- `--version` **must match** what you put in `version.json`.
- `--skip-python` for the any-computer path. **Drop it only** for a dependency change built
  on Windows.
- This produces `temp/release-1.02/` containing some `.zip` files and one **`manifest.json`**.

> 🚫 **Never make or edit those zip files by hand, and never edit `manifest.json`.** The tool
> writes each file together with a fingerprint the machines check; touch them and every
> machine will reject the update. See [deployment-updating-guide.md](deployment-updating-guide.md).

---

## Step 6 — Publish on GitHub (the only click-based step)

1. Repo → **Releases** → **Draft a new release**.
2. **Tag:** `v1.02` (the letter v + your version). **Target:** `main`.
3. **Title:** `PSAT 1.02`.
4. **Release label:** leave on **None** — *not* "Pre-release". Machines read the **latest**
   published release, and a pre-release doesn't count as latest.
5. **Attach every file** from `temp/release-1.02/` — all the `.zip`s **and** `manifest.json`.
   Missing one file breaks the update.
6. (Optional) Write a description. The popup text actually comes from your `--notes`, so this
   is just for the record.
7. **Publish release.**

Done. The machines take it from here.

---

## Step 7 — Confirm it actually landed (do ONE machine first)

1. On a deployed PC **with internet**, reopen PSAT. Within ~20 seconds (or up to 6 hours if
   it was already open) the **update popup** appears. Click **Download**, then **restart** when
   prompted.
2. Confirm the version now reads `1.02` (Help/About or `/api/health`).
3. Sanity-check that your actual change is present.

Only once one machine is confirmed should you trust the whole fleet will follow.

---

## What happens on machines that are already open

Publishing while people have PSAT open is completely safe:
- A running app checks ~20 s after launch and **every 6 hours** — so it notices within 6 hours,
  or immediately if the user closes and reopens PSAT.
- **Nothing is applied to a running app.** The download is staged and only swapped in on the
  next restart. No one is interrupted mid-work.
- Simplest thing to tell the team: **"Next time you restart PSAT, accept the update."**
- A machine that's offline just picks it up the next time it's online.

---

## Golden rules (the short list that prevents every common mistake)

- ✅ Change code → **bump version.json** → **two commands** → **upload the whole `temp/release-*` folder**.
- 🚫 Never hand-make or edit the zips or `manifest.json`.
- 🚫 Never reuse or lower a version number.
- 🚫 Never forget `manifest.json` in the upload, and never upload only some files.
- 🚫 Never mark the release "Pre-release" (machines won't see it).
- ⚠️ A **dependency change** must be built on Windows; everything else can be built anywhere.

---

## If something goes wrong

| Symptom | What to check |
|---|---|
| Machines don't see the update | Did you **Publish** (not leave a draft)? Is `manifest.json` attached? Is the version higher than before? Is the machine online? Is it marked Pre-release by mistake? |
| Popup appears but download fails | A file is missing from the release, or files were edited/hand-zipped. Re-run `make_release.py` cleanly and re-upload the **whole** folder. |
| Popup offers a huge (multi-GB) download for a small change | The manifest and zips don't match — almost always something in the folder was edited or hand-zipped. Re-run `make_release.py` and re-upload everything. |
| "The update could not be installed" on a machine | It already rolled back to the previous version automatically. Safe to retry after fixing the release. |
| Build step errors / "bundle is incomplete" | Do **not** publish. Fix the error first (or ask the maintainer). |

**Last-resort recovery on a machine:** reinstall from the USB drive. User data is untouched —
it lives outside the app folder.

---

## A real worked example (PSAT 1.01, the "photo pruning" fix)

A backend-only fix, built on a Mac:

```bash
# change committed to main; backend/version.json set to "1.01"
scripts/bundle/build_bundle.sh --out-dir temp/PSAT-build --no-python --no-webui --skip-gis
python3 scripts/bundle/make_release.py --bundle temp/PSAT-build/PSAT \
    --out temp/release-1.01 --version 1.01 \
    --notes "Fix: creating a project no longer deletes seeded survey frames" --skip-python
# -> temp/release-1.01/ : backend.zip (~22 MB) + manifest.json
# Published as GitHub release v1.01 (target main, label None, both files attached).
```

Every machine that opened PSAT afterwards downloaded the ~22 MB `backend.zip` and applied it
on restart. No frontend rebuild, no 9 GB, no Windows machine required.
