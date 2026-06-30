# CLAUDE.md - PathSafetyAssessmentTool

## Standard Protocols

- **Read actions (Grep, Glob, Read, Bash reads):** Execute without asking for permission — never prompt the user before reading files or searching the codebase.
- **Commit & push after every action:** After every action or task is completed, always prompt the user asking whether they want to commit and push the changes to the `xh_dev` branch on `origin` before doing so.

## Project Overview
Path Safety Assessment Tool for LTA - a React + Python (Flask) application for analyzing cycling path safety using CycleRAP methodology.

## Architecture
- **Frontend:** React + TypeScript + Chakra UI + Leaflet maps
- **Backend:** Python Flask API
- **Key pages:** CodingPage (attribute coding), PathAnalysisPage (multi-project analysis), TreatmentPage (treatment application), GisLayersPage

## Key Patterns & Gotchas

### Multi-Project Index Mapping
- When multiple projects are loaded, segments are aggregated into global arrays (`attrs`, `geoFeatures`, `scores`)
- `projectMap` tracks each project's `startIndex` and `count` in the global arrays
- `resolveIndex(globalIndex)` maps global → `{ projectName, localIndex }`

### PathAnalysisPage: Project Selection Honors Reselection (2026-04-29)

**Symptom:** After loading multiple projects in PathAnalysisPage, navigating back to the Projects page and reselecting a different subset, the page still loaded **all** projects from the backend instead of only the reselected ones.

**Root cause:** `pathAnalysisPage.tsx` had a mount-time `useEffect` that unconditionally called `fetchProjectList()` and set `loadedProjects` to every project. The session storage key `pathAnalysis_loadedProjects` set by `projects.tsx::loadPathAnalysis()` was completely ignored.

**Fix:** Initialize `loadedProjects` state from `loadState("loadedProjects", [])` (which reads `pathAnalysis_loadedProjects` via the `SESSION_KEY_PREFIX`). Only fall back to `fetchProjectList()` when session storage is empty (e.g. user navigates directly to `/analysis/path` without going through the projects page).

**Key files:**

- `frontend/src/pages/PathAnalysisPage/pathAnalysisPage.tsx` — `useState` initializer + fallback `useEffect`
- `frontend/src/pages/Projects/projects.tsx` — `loadPathAnalysis()` writes `pathAnalysis_loadedProjects` (always overwrites, so each reselection refreshes the value)

### CodingPage: Filter Colors Leak From Path Analysis Into Direct Loads (2026-06-22)

**Symptom:** Apply filters in PathAnalysisPage, click a segment to open the CodingPage (segments
correctly show filter-derived colors). Then navigate back to the Projects page and load projects
directly into the Coding page — the **stale filter colors still persist** instead of the normal
risk-band colors for the project's segments.

**Root cause:** `CodingPage.resolveFilterContext()` (`codingPage.tsx`) resolves the filter context
with two priorities:

1. If `location.state.filterContext` is **defined** (even `null`) → it updates/removes the
   `codingFilterContext` sessionStorage key accordingly.
2. If `location.state.filterContext` is **`undefined`** → it falls back to the **stale
   sessionStorage value**.

PathAnalysisMapView writes `codingFilterContext` to sessionStorage when navigating into a filtered
segment. The Projects page's `loadProject()` navigated to `/coding/...` with **no `state` at all**,
so `filterContext` was `undefined` → CodingPage read the leftover key → `GeoDataPanel`'s
`filterColorMap` got populated (`GeoDataPanel.tsx:1679`: `filterColorMap?.get(localIdx) ??
getSegmentColor(globalIdx)`) → segments rendered with filter colors instead of risk-band colors.
This is the only Projects→Coding navigation path.

**Fix:** `loadProject()` passes explicit `state: { filterContext: null }`. This routes through
`resolveFilterContext()`'s priority-1 branch, which calls
`sessionStorage.removeItem(CODING_FILTER_CONTEXT_KEY)` and returns `null` — clearing both the
in-memory state and the stale sessionStorage entry in one step (no manual key import needed).

**Key files:**

- `frontend/src/pages/Projects/projects.tsx` — `loadProject()`: `navigate(..., { state: { filterContext: null } })`
- `frontend/src/pages/CodingPage/codingPage.tsx` — `resolveFilterContext()`: the priority-1 / fallback logic
- `frontend/src/pages/PathAnalysisPage/components/PathAnalysisMapView.tsx` — writes/removes `codingFilterContext` on segment click

### PathAnalysisPage: Slow Reload + Flash + Lost View On Return From Coding (2026-06-23)

**Symptom:** Apply filters in PathAnalysisPage, click a segment (navigates to the Coding
page), then navigate **back**. Three problems: (1) the whole page — especially the map —
took a long time to reload; (2) all segments flashed on screen for ~0.5s before collapsing
to the filtered set; (3) the map re-fit to all points and the colour/focus attribute reset
to the first filter, instead of restoring the user's previous pan/zoom and focus.

**Root causes:**

1. **Full remount, no caching.** `/analysis/path` is a plain `<Route element={...}>`, so
   navigating to Coding unmounts PathAnalysisPage and returning remounts it, re-running
   every fetch. Worse, three sibling components each fetched per-project `/results`
   independently (`AggregatedScoreBandPanel`, `AggregatedTopContributorsPanel`,
   `PathAnalysisMapView`) plus geodata and attributes — so each return fired ~3N
   `/results` requests and ~2N geodata/attribute requests, all uncached, gating the map
   behind the slowest.
2. **Flash:** `visibleSegments` filtering calls `getFilterAttributeText`, which converts
   numeric attribute codes → text labels via `attrMappings`. `attrMappings` was fetched
   async on every mount and started `{}`; while empty, every segment's label fails to
   match the (restored) `categoryToggles` keys → all segments pass the filter until the
   mappings resolve.
3. **Lost viewport:** map mounted at a fixed center/zoom and the data-load effect always
   `setShouldAutoFit(true)`; the live viewport was never persisted.
4. **Lost focus:** `primaryFocusAttribute` / `categoryFilterAttributeIndex` ARE restored
   from sessionStorage, but the auto-focus effect seeded `prevFiltersRef` to `[]`, so on
   remount every active filter looked "newly added" → focus snapped to the first filter.

**Fix:**

- **Shared session cache** — new `frontend/src/api/projectDataCache.ts` wraps the read
  endpoints with a module-level promise cache (caches the *promise* so concurrent callers
  de-dup; evicts on rejection for retry). Makes back-navigation a pure cache hit and
  collapses the 3× `/results` fetches into one per project. Namespaces: `geodata`,
  `attributes`, `results`. **Invalidation:** auto on `psat:scores:updated` (evicts
  `results`); `invalidateProject(name)` on segment delete; `invalidateAll()` on add-segment
  success and — the explicit "start over" reset — in `projects.tsx::loadPathAnalysis()`.
  The three consumers use `getCachedGeoJSON/Attributes/Results`; the panels' Refresh
  buttons force-bypass via `invalidateAllOfNamespace("results")`.
- **Flash** — the cache also holds attribute mappings with a SYNCHRONOUS getter
  (`getCachedAttributeMappingsSync()`) plus `getCachedAttributeMappings()` (adequacy
  augmentation moved into the loader). `PathAnalysisMapView` initialises its `attrMappings`
  state from the sync value, so filtering is correct on the first render after a remount.
- **Viewport** — `ViewportPersister` (a `useMap()`/`useMapEvents` child) writes
  `{center, zoom}` to sessionStorage key `pathAnalysisMap_viewport` on moveend/zoomend. On
  mount, `savedViewport`/`initialCenter`/`initialZoom` refs seed `<MapContainer>` and the
  data-load effect skips `setShouldAutoFit(true)` when a saved viewport exists.
  `loadPathAnalysis()` clears the key so a fresh reselect re-fits.
- **Focus** — `prevFiltersRef` is seeded with the mount-time `selectedAttributes`, so no
  filter is treated as "added" on remount and the restored focus is preserved.

**Gotcha:** The cache lives for the SPA session only (module memory) — a hard reload (F5)
clears it. The only full reset in normal flow is a Projects-page reselect; everything else
is targeted/automatic. First-EVER load (cold cache) may still briefly flash; the fix
targets back-navigation specifically.

**Key files:**

- `frontend/src/api/projectDataCache.ts` — the cache (per-project read endpoints + sync
  attribute-mappings); `invalidate*` helpers
- `frontend/src/pages/PathAnalysisPage/components/PathAnalysisMapView.tsx` — cached fetches,
  sync `attrMappings` init, `ViewportPersister`, `initialCenter`/`initialZoom` + auto-fit
  guard, `prevFiltersRef` seed, `invalidateProject`/`invalidateAll` on mutations
- `frontend/src/pages/PathAnalysisPage/components/AggregatedScoreBandPanel.tsx` &
  `AggregatedTopContributorsPanel.tsx` — `getCachedResults`; Refresh buttons force-bypass
- `frontend/src/pages/Projects/projects.tsx` — `loadPathAnalysis()`: `invalidateAll()` +
  clears `pathAnalysisMap_viewport`

### TreatmentDetailPage: Can't Scroll After "Generate Report" → Back (2026-06-28)

**Symptom:** On the Treatment Application page, click **Generate Report** (sidebar →
navigates to `/analysis/report`), then press **back** to return to the treatment page. The
treatment page can no longer scroll at all — the mouse wheel does nothing.

**Root cause — leaked Chakra/Zag Dialog scroll lock.** The "Confirm Apply All" Dialog
(`treatmentDetailPage.tsx:2128`, `<Dialog.Root open={openConfirmAlert}>` rendered through a
`<Portal>`) is the page's only Chakra overlay. While open, Zag's scroll-lock machinery sets
`data-scroll-locked` plus inline `overflow: hidden` / `pointer-events: none` directly on
`<html>` and `<body>` (same mechanism documented in the next section). Zag normally restores
those styles when the dialog closes, but the restore runs after a close animation tick — if
the whole `TreatmentDetailPage` unmounts first (clicking **Generate Report** navigates away),
the cleanup never fires and the lock leaks onto the document. The **Report Builder
(`reportBuilderPage.tsx`) uses no Chakra components and never touches `<body>` styles**, so it
neither causes nor clears the lock. On back-navigation the treatment page remounts into an
already-locked `<body>` → window scroll is dead.

**Why it isn't obvious:** the treatment page's main content lives in fixed-height panels with
their own `overflowY: auto` (e.g. `treatmentDetailPage.tsx:1683`), so those inner regions keep
scrolling — only the outer window/page scroll is frozen.

**Fix:** Added a `clearScrollLock()` helper in `TreatmentDetailPage` that resets
`overflow` / `pointer-events` and removes `data-scroll-locked` from both `<html>` and `<body>`,
wired into two effects:

1. `useEffect([openConfirmAlert])` — when the dialog closes, `setTimeout(clearScrollLock, 400)`
   to win the race against Zag's own (possibly-skipped) cleanup.
2. `useEffect([])` — runs `clearScrollLock()` on **mount** (clears any lock left over when
   returning from the Report Builder) and on **unmount** (clears it before navigating away).

This is the same class of bug — and same JS cleanup workaround — as the EditProjectModal /
AddSegmentsDialog fix documented below; the only new wrinkle is that here the lock is surfaced
by a full-page route unmount rather than a same-page close.

**Key file:**

- `frontend/src/pages/TreatmentPage/treatmentDetailPage.tsx` — `clearScrollLock()` + the two
  `useEffect`s next to the `openConfirmAlert` state declaration

### Chakra UI Dialog: Blocking Interaction After Close

**Symptom:** After closing a `Dialog` (e.g. EditProjectModal), the page beneath becomes unresponsive — mouse wheel scroll and clicks on rows are blocked. Only the native scrollbar thumb drag still works.

#### Root cause (fully traced through library source)

**Architecture:**
- `Dialog.Backdrop` is `position: fixed`, `100dvw × 100dvh`, stays in DOM during close animation
- `@zag-js/presence` only removes overlay DOM nodes after `animationend` fires. During animation, the backdrop remains with `pointer-events: auto` (browser default)
- `Dialog.Positioner` has `pointer-events: none` via Zag's inline style when closed AND is immediately removed from DOM (its presence machine has no node → `animationName = "none"` → immediate UNMOUNT). **Positioner is not the blocking element.**
- The **backdrop** is the blocking element during the close animation (~200–300 ms)

**Why CSS class selectors failed (Attempt 3):**
The previous fix used:
```css
.chakra-dialog__backdrop[data-state="closed"] { pointer-events: none; }
.chakra-dialog__positioner[data-state="closed"] { pointer-events: none; }
```
The positioner rule matched **nothing** — `getPositionerProps()` does not set `data-state` (confirmed in `@zag-js/dialog/dist/dialog.connect.js` line 75–84). The backdrop rule *should* work (`.chakra-dialog__backdrop` IS applied via `classNameMap["backdrop"] = \`${config.className}__${slot}\`` in `sva.cjs`), but may have been overridden or did not reliably prevent the block.

**Why `unmountOnExit` alone failed (Attempt 2):**
`unmountOnExit: true` is already Chakra's **default** (set in `dialog.cjs` line 24: `defaultProps: { unmountOnExit: true, lazyMount: true }`). So adding it explicitly was a no-op. And even if it weren't, unmountOnExit only removes the DOM after `animationend` — it can't prevent the block during the animation.

**Why `setTimeout` failed (Attempt 1):**
Races with the animation. Doesn't affect pointer-events. Doesn't touch Zag presence cleanup.

#### Correct fix (Updated)

**Why the CSS fix alone was insufficient:** While removing pointer events from the backdrop solved some issues, Zag.js/Chakra UI actively places a `data-scroll-locked` attribute and inline `pointer-events: none` directly on the `<html>` and `<body>` tags. If the modal's `open` state becomes `false` simultaneously with a heavy parent state update (e.g., updating the project list which triggers a re-render), the modal may unmount or lose its internal cleanup sequence before it restores these tags.

**JS Cleanup Workaround:**
To reliably prevent the entire app from permanently freezing, explicitly clean up the `html` and `body` tag scroll locks using a `useEffect` hook with a delayed `setTimeout` whenever the modal closes (`open === false`):

```tsx
  useEffect(() => {
    if (!open) {
      // Force cleanup of pointer-events lock caused by Chakra UI Dialog bugs
      setTimeout(() => {
        document.body.style.pointerEvents = "auto";
        document.documentElement.style.pointerEvents = "auto";
        document.body.removeAttribute("data-scroll-locked");
        document.documentElement.removeAttribute("data-scroll-locked");
      }, 400);
    }
  }, [open]);
```

**Key files:** `frontend/src/pages/Projects/components/EditProjectModal.tsx`, `frontend/src/pages/PathAnalysisPage/components/AddSegmentsDialog.tsx`

#### Quick lookup: what attribute each element gets

| Element | `data-state` | `data-part` | Blocking risk |
|---------|-------------|-------------|---------------|
| Backdrop | ✓ `"open"/"closed"` | `"backdrop"` | YES during animation |
| Positioner | ✗ none | `"positioner"` | NO (immediate unmount via null-node presence machine) |
| Content | ✓ `"open"/"closed"` | `"content"` | No (not full-screen) |

### GeoDataPanel `startIndex` Prop
- **IMPORTANT:** When passing ALL aggregated `geoFeatures` and `scores` to `GeoDataPanel`, `startIndex` MUST be `0` — the local index already equals the global index
- `startIndex` should only be non-zero when passing a SUBSET of features (single project) that needs mapping to global indices
- **Bug fixed:** Previously, `treatmentDetailPage.tsx` passed the active project's `getProjectFirstSegmentIndex()` as `startIndex` even though ALL features were passed. This caused `globalIdx = startIndex + i` to overflow the scores array, producing blue (#2563EB) fallback colors for non-first projects

### Segment Color System
- Colors are determined by max risk level across crash types (BB, BP, SB, VB)
- Risk band colors: LOW=#87C424, MEDIUM=#FFCC1A, HIGH=#FF5B1A, EXTREME=#CD1AFF
- Blue (#2563EB) is the FALLBACK color when scores are missing — if you see blue segments, scores lookup is broken
- Defined in `colorConstants.ts`, used in `GeoDataPanel.getSegmentColor()`

### Autocode Per-Attribute: CV Skip Optimisation

The "Auto-code (By Attribute)" flow sends `fields: string[]` to `POST /<project>/autocode/all`.
Two skip flags are computed from `fields_filter` before the bulk loop:

| Flag             | Condition                                                                 | Effect                                                         |
|------------------|---------------------------------------------------------------------------|----------------------------------------------------------------|
| `skip_cv`        | ALL requested fields are in `_GIS_ONLY_FIELDS`                            | Skips the path-segmentation YOLO model entirely                |
| `skip_obstacles` | CV runs, but none of the obstacle fields are requested (see list below)   | Skips the second YOLO model pass (obstacle detector)           |

Obstacle fields that require the detector: `"Fixed Obstacle on Facility"`, `"Non-Fixed Obstacle on Facility"`,
`"Width Restriction"`, `"FO Type"`, `"NFO Type"`.

**Bug fixed (2026-04-15):** Selecting only "Facility type" always ran the obstacle detector (`_detect_obstacles`)
unnecessarily. Root cause: `autocode()` in `prediction.py` always called `_detect_obstacles` regardless of which
fields were requested. Fix: added `skip_obstacles: bool = False` to `autocode()`, propagated through
`autocode_image` (reads `skipObstacles` from JSON body) → `_call_autocode_pair` → `autocode_all`.

**Key files:**

- `backend/app/services/prediction.py` — `autocode()`: the `skip_obstacles` branch
- `backend/app/api/projects/routes.py` — `autocode_all()`: `_GIS_ONLY_FIELDS`, `_CV_OBSTACLE_FIELDS`, `skip_cv`, `skip_obstacles`; `_call_autocode_pair()`: passes `skipObstacles` in json
- `frontend/src/constants/autocodeAttributes.ts` — `KEY_ALIASES` maps display names → real backend field keys
- `frontend/src/pages/sidebar/components/CodingSidebar.tsx` — `handleRun()` converts names via `KEY_ALIASES`, calls `onAutoCodeByAttribute(realKeys)`

### Autocode Per-Attribute: Remaining Performance Issues (2026-04-15)

Despite the `skip_obstacles` fix, bulk autocode is still slow. Four root causes identified:

#### Issue 1: `test_request_context` overhead in `_call_autocode_pair` (routes.py:3249–3261) — **CONFIRMED PRIMARY BOTTLENECK (~2.5 s/seg floor)**

`_call_autocode_pair` calls `autocode_image` and `autocode_gis` by creating a fake Flask HTTP context
(`current_app.test_request_context(...)`) for every single segment. This adds per-segment overhead:

- Flask `RequestContext` setup/teardown
- JSON serialisation → `.get_json()` → JSON deserialisation (round-trip per sub-call)
- `_ensure_models_ready()` (acquires `_INIT_LOCK`) re-entered inside `autocode_image` for every segment
- Response object creation (`ok(...)`) just to be immediately unwrapped

**Fix:** Extract the core logic of `autocode_image` and `autocode_gis` into private helper functions
(e.g. `_cv_autocode_core(image_ref, skip_obstacles)` and `_gis_autocode_core(coords)`) and call those
directly from `_call_autocode_pair`, bypassing HTTP dispatch entirely.

#### Issue 2: Double `_inject_grade` per segment in bulk mode (routes.py:2571 + 3424–3425) — **MEDIUM IMPACT**

`autocode_image` (line 2571) already calls `_inject_grade`, which injects Grade/Gradient% into `updates`
before returning. `_call_autocode_pair` then propagates those already-injected values. Despite this,
`_bulk_gen` calls `_inject_grade` again at line 3424–3425 on the merged result. The gradient lookup
includes a linear O(N) scan fallback, so this wasted work scales with project size.

**Fix:** Remove the `_inject_grade` call from `autocode_image` (the single-image endpoint should still
call it, but via the caller), OR remove the duplicate call in `_bulk_gen` by checking whether Grade
was already set in `merged` before calling `_inject_grade`.

#### Issue 3: `autocode_gis` runs ALL 11 GIS spatial queries regardless of `fields_filter` (routes.py:2606–2673) — **HIGH IMPACT**

`fields_filter` is only applied at line 3429 (after `_call_autocode_pair` returns). `autocode_gis` always
runs every GIS query — MRT check, bus lane check, parking check, pedestrian flow lookup, road speed, speed
limit, heavy vehicle flow, curvature, facility width — even when only one field is requested. For example,
requesting only "Curvature" still fires all 11 spatial queries.

Additionally, the `skip_gis` parameter in `_call_autocode_pair` (line 3221) is **never set to True** in the
bulk loop (line 3418). There is no symmetric `_CV_ONLY_FIELDS` guard, so GIS always runs even when all
requested fields are CV-only (e.g. "Facility Type").

**Fix:** Pass `fields_filter` into `autocode_gis` (or its extracted core) so it can skip queries whose
output field is not in the filter. Also define a `_CV_ONLY_FIELDS` set and use it to set `skip_gis=True`
in the bulk loop when all requested fields are CV-only.

#### Issue 4: Sequential segment processing — no parallelism (routes.py:3396) — **HIGH IMPACT**

Segments are processed strictly one-at-a-time in `_bulk_gen`'s `for idx in indices:` loop. YOLO inference
is CPU-bound (limited by GIL), but GIS spatial queries are I/O-bound (shapefile reads, STRtree lookups) and
could run concurrently. There is no batching or pipelining.

**Fix:** Consider `ThreadPoolExecutor` for GIS calls (GIL-releasing C extensions), or a producer-consumer
pipeline that overlaps GIS queries for segment N+1 while CV runs on segment N. For the most impactful gain,
pre-compute all GIS results in a single vectorised spatial join before the YOLO loop.

### Autocode Per-Attribute: Benchmark Results (2026-04-15, AMK AVE 8, 412 segments)

Measured on the full AMK AVE 8 project using `scripts/benchmark_autocode.py`. `save: false` to avoid
mutating stored attributes. Backend on localhost, models already warm.

| Mode | Total time | Per-segment | skip_cv | skip_obstacles |
| ---- | ---------- | ----------- | ------- | -------------- |
| All attributes (full) | 1116.5 s (18.6 min) | 2.710 s | False | False |
| Single attr — "Curvature" | 953.2 s (15.9 min) | 2.314 s | **True** | n/a |
| Single attr — "Facility Type" | 1102.6 s (18.4 min) | 2.676 s | False | **True** |

**Per-segment time breakdown (derived from baseline):**

| Component | Time/seg | Share of total |
| --------- | -------- | -------------- |
| GIS queries (all 11) | ~2.31 s | ~85% |
| Path-seg YOLO (1 pass) | ~0.36 s | ~13% |
| Obstacle detector YOLO | ~0.03 s | ~1% |
| Overhead (test_request_context etc.) | baked in | — |

**Key finding (baseline):** GIS queries appeared to consume ~85% of per-segment time, suggesting
per-field short-circuiting (Issue 3) would yield a large speedup.

**Issue 3 fix applied (2026-04-15):** Per-field `_needs()` guards added to `autocode_gis`. After fix:

| Mode | Total time | Per-segment | Notes |
| ---- | ---------- | ----------- | ----- |
| All attributes (full) | 1064.9 s (17.7 min) | 2.585 s | All 11 GIS queries + CV |
| Single attr — "Curvature" | 1024.3 s (17.1 min) | 2.486 s | Only get_curvature() fires |
| Single attr — "Facility Type" | 1030.6 s (17.2 min) | 2.501 s | **Zero GIS queries** fire (CV-only field) |

**Revised finding:** The Issue 3 fix produced **no meaningful speedup (1.0×)**. "Facility Type" now
skips every GIS query entirely yet still costs ~2.5 s/seg — nearly identical to running 11 queries.
This proves the GIS spatial queries themselves are fast (collectively <0.1 s/seg); the ~2.5 s/seg
floor is almost entirely the `test_request_context` overhead (Issue 1): creating a fake Flask HTTP
context, JSON encoding/decoding, and route dispatch runs for every segment even when no work is done.

**Revised priority: Issue 1 is the dominant bottleneck.** Fixing `_call_autocode_pair` to call
`_gis_autocode_core()` / `_cv_autocode_core()` directly (bypassing HTTP dispatch) is expected to
reduce per-segment time from ~2.5 s to <0.5 s and is the highest-impact remaining fix.

### TreatmentDetailPage: Score Drops Disappear After Data Loads (2026-06-26)

**Symptom:** In the Treatment Application page's "By Segment" view, the "Score drop: X.X"
labels under each treatment did not appear consistently after projects were loaded. They
would sometimes appear briefly then vanish, or not appear at all — dependent on how fast
the backend responded to the score-drop API call.

**Root cause: `commitPage` debounce fires 300ms after data loads and calls `gotoPage`**

The chain of events on `fetchData` completion:

1. `setProjectMap(newMap)` + `setAttrs(newAttrs)` → `scope.count` changes (0 → N) and
   `gotoPage` is recreated (depends on `len = attrs.length`).
2. `commitPage` is recreated — it depends on `[gotoPage, isAllScope, scope]`.
3. The `pageInput` debounce effect (`[pageInput, commitPage]`, line 1355) fires because
   `commitPage` is a new function reference, even if `pageInput` hasn't changed.
4. 300ms later: `commitPage(pageInput)` → `gotoPage(currentPage)` (same page) →
   `setSegmentScoreDrops({})` clears the score drops.
5. `currentIndex` didn't change → score drops `useEffect` deps unchanged → effect does
   NOT re-run → score drops stay empty forever (until the user navigates to a new segment).

**Why it was inconsistent:** If the `treatment_segment_effectiveness` API responded in
**< 300ms**, drops would appear, then be wiped by step 4. If it responded in **> 300ms**,
the fetch was still in flight when `gotoPage` fired; since `currentIndex` didn't change,
`cancelled` stayed `false` and the fetch completed, setting the drops correctly.

**Fix:** Add `currentPage` to `commitPage`'s dependency array and add an early return
when `globalPage === currentPage`. This prevents `gotoPage` (and its `setSegmentScoreDrops({})`)
from being called when `commitPage` fires due to `scope`/`gotoPage` recreation but the
resolved destination page is the same:

```ts
if (globalPage === currentPage) return;
```

**Key file:**
- `frontend/src/pages/TreatmentPage/treatmentDetailPage.tsx` — `commitPage`: added
  `currentPage` to deps, early return on `globalPage === currentPage`

### Report Builder: Top Risk Stretches Images (2026-06-11)

**Symptom:** Every "Top Risk Stretches" page in the Report Builder showed the grey
"No image available" placeholder — for all projects, in both the on-screen preview and the
exported PDF. The live `POST /api/report/segment-details` returned `imageUrl: null` and
`topAttributes: []` for every segment.

**Two bugs (both required for new projects):**

#### Bug A — wrong project manager (the actual blocker)

`segment_details` called `pm = project_manager()`. `project_manager` is a **class** whose
constructor discovers projects from the default config dir `../data` (empty). The active
profile's projects live under `profiles/<profile>/projects/`, and the profile redirect
(`pm.des_path = profile_projects_root; pm._discover_projects()`) is applied **only inside
`get_ctx()`** (`projects/routes.py`). So `pm.project(name)` raised `KeyError`, the per-segment
`except Exception:` swallowed it silently, and every segment came back null.

**Fix:** use the profile-aware shared pm: `from app.api.projects.routes import get_ctx;
pm = get_ctx()["pm"]` (the same accessor the working `/api/projects/<name>/images/...`
endpoint uses). Import `get_ctx` inside the function to avoid blueprint import-order issues.

**Gotcha for debugging:** any module that needs project data must go through `get_ctx()` —
constructing `project_manager()` directly silently points at the empty `../data` dir and
finds **zero** projects. The `/api/projects/<name>/images/<ref>` endpoint returning `200`
while `segment-details` returned null was the tell that the pm, not the image serving, was
broken.

#### Bug B — image reference lives in geo_data, not attributes

New folder-created projects store image filenames in the **geo_data** GeoDataFrame under the
`"Image Reference"` column (`project_manager.create_project()`), NOT in `attributes.csv`.
Images stay in `in/<source_folder>/`, resolved at serve time by `_resolve_image_from_in`.
The old code read only `attrs_df.get("Image Reference")` → always empty for new projects.

**Fix:** read `proj.geo_data.df["Image Reference"]` first, fall back to `attrs_df` for legacy
projects, then URL-encode. This mirrors how the Coding page resolves images.

**Also:** added an image-decode guard (`await img.decode()` over in-canvas `<img>`s) before
the `html2canvas` PDF capture in `reportBuilderPage.tsx` so exports don't grab half-loaded
images. The PDF was empty only because the preview was empty — same root cause.

**Backend runs with `use_reloader=True`** (`app.py`) — Flask auto-reloads on `.py` file changes.
Note: model state is lost on reload; YOLO models re-initialise on the next autocode request.

**Key files:**

- `backend/app/api/report/routes.py` — `segment_details()`: `get_ctx()["pm"]` + geo_data lookup
- `backend/app/api/projects/routes.py` — `get_ctx()`: the profile redirect + canonical pm accessor
- `frontend/src/pages/ReportBuilderPage/reportBuilderPage.tsx` — enrichment fetch + html2canvas capture

### Report Builder: Top Risk Stretches — Upload Treatment Image (2026-06-13)

**Symptom:** In the "full-page" view mode, every Top Risk Stretch segment lacked a way to upload a post-treatment photo directly. Only segments that already had treatments applied in the Treatment App showed any right-side panel, and even then only offered a link to navigate away to the Treatment App. Segments without applied treatments had no right panel at all.

**Two bugs fixed:**

#### Bug A — frontend never called the upload endpoint

The backend already had all three endpoints (stored under `profiles/<profile>/projects/<project>/post_treatment_images/<segIndex>.png`):
- `POST /api/projects/<project>/segments/<segIndex>/post-treatment-image` — upload
- `GET  /api/projects/<project>/segments/<segIndex>/post-treatment-image` — serve
- `DELETE /api/projects/<project>/segments/<segIndex>/post-treatment-image`

The frontend simply never called the upload endpoint — only linked out to the Treatment App via a button.

**Fix:** Added a shared hidden `<input type="file">` driven by `postTreatmentUploadRef` + `uploadingSegment` state. `handleUploadTreatmentImageClick(project, segIndex)` sets the target and triggers the picker. `handlePostTreatmentFileChange` POSTs the file as `FormData`, then re-fetches `segment-details` for just that segment and patches `enrichedMap` in place so the new image appears immediately. The "Post treatment photo missing" panel now shows a primary **"Upload Treatment Image"** button and a secondary outline "Add Photo in Treatment App" link.

#### Bug B — right-side panel gated on `t.length > 0`

The entire post-treatment image panel (right half of the image section) was wrapped in `{t.length > 0 && (...)}`, so only segments with treatments applied in the Treatment App ever got the upload option. Segments with no recorded treatments never showed the right panel at all.

**Fix:** Removed the `t.length > 0` gate. The right-side panel now always renders. If `e.postImageUrl` is present it shows the post-treatment image; otherwise it shows the upload UI. The "Original" label and dividing border are also unconditional.

**Correct logic:** The upload option appears for every segment that has no `postImageUrl`, regardless of whether treatments are recorded in the system.

**Key files:**
- `frontend/src/pages/ReportBuilderPage/reportBuilderPage.tsx` — `postTreatmentUploadRef`, `uploadingSegment`, `handleUploadTreatmentImageClick`, `handlePostTreatmentFileChange`, hidden `<input>`, updated image section in `renderTopRiskFullPage`

### Report Builder → Treatment Page: Post-Treatment Image Not Reflected (2026-06-13)

**Symptom:** After uploading a post-treatment image via the Report Builder's "Upload Treatment Image" button, navigating to the Treatment Application page for the same segment still showed no image (or showed a stale/old image).

**Root cause:** Browser HTTP caching. The GET endpoint (`/api/projects/<project>/segments/<segIndex>/post-treatment-image`) set `Cache-Control: public, max-age=86400` on successful responses, so the browser cached the image for 24 hours. Meanwhile, `PostTreatmentImageUpload.fetchImage()` called `fetch(url)` with the default cache mode `"default"`, meaning the browser returned the cached response without hitting the server. If the user had previously loaded the segment with no image, or had a prior image cached, the new upload was invisible until the 24-hour TTL expired.

**Fix:**
1. **Frontend** (`PostTreatmentImageUpload.tsx`) — changed `fetch(url)` to `fetch(url, { cache: "no-store" })` so every mount/re-fetch bypasses the browser cache entirely.
2. **Backend** (`routes.py`, `get_post_treatment_image`) — changed `Cache-Control` from `public, max-age=86400` to `no-store` so the browser never caches post-treatment images.

**Key files:**
- `frontend/src/pages/TreatmentPage/components/PostTreatmentImageUpload.tsx` — `fetchImage()`: added `{ cache: "no-store" }` to fetch
- `backend/app/api/projects/routes.py` — `get_post_treatment_image()`: `Cache-Control: no-store`

### Report Builder: "Change Image" Doesn't Show New Upload (2026-06-15)

**Symptom:** In the Report Builder's Top Risk Stretches full-page view, clicking "Change
Image" (or "Upload Treatment Image"), picking a new photo, and uploading appeared to
succeed but the displayed post-treatment image did **not** update — it kept showing the old
photo (or nothing).

**Root cause — NOT HTTP caching.** The backend GET endpoint already sends
`Cache-Control: no-store` (see the 2026-06-13 fix above). The real problem is that
`postImageUrl` is a **static path** built in `segment_details()`
(`/api/projects/<project>/segments/<segIndex>/post-treatment-image`) that is byte-for-byte
identical before and after an upload. After upload, `handlePostTreatmentFileChange` re-fetches
`/api/report/segment-details` and patches `enrichedMap`, but the new `postImageUrl` string
equals the old one. React re-renders, but since the `<img src>` prop is unchanged the DOM
`<img>` element's `src` attribute never changes, so the browser issues **no new request** and
keeps displaying the already-rendered bitmap.

**Fix:** Append a cache-busting timestamp (`?t=${Date.now()}`) to `postImageUrl` when patching
`enrichedMap` after a successful upload. This changes the `src` string, forcing the `<img>` to
re-request the (now `no-store`) image. The buster is computed once per upload (`const bust =
Date.now()`) and appended with `?`/`&` depending on whether the URL already has a query string.

**Note:** Only the post-upload patch path adds the buster — the initial enrichment fetch
(line ~889) leaves `postImageUrl` clean, which is fine because that's the first time the URL is
rendered.

**Key files:**
- `frontend/src/pages/ReportBuilderPage/reportBuilderPage.tsx` — `handlePostTreatmentFileChange()`: cache-busting `?t=` appended to `postImageUrl` in the `setEnrichedMap` patch

### Report Builder: PDF Download Fails With Filtered Sections (2026-06-15)

**Symptom:** Enabling **"Include filtered sections"** and clicking **↓ PDF** produced no
download (the button finished but no file appeared). Disabling filtered sections let the PDF
download normally.

**Root cause — browser `<canvas>` size limit.** `handleDownloadPDF()` rasterises the whole
report canvas with `html2canvas(canvas, { scale: 2 })`. Browsers cap a single `<canvas>` at
**~32767px per dimension** and **~268M px² total area**; exceeding either makes html2canvas
return a **blank, zero-size** canvas (it does not throw). The filtered feature appends a
`(Filtered)` duplicate of nearly every section (Top Risk Stretches full-page alone is
`topN × 1123px`), so the canvas height roughly doubles. At `scale: 2` the output pixel height
blew past 32767px → empty capture → `toDataURL()` returned `"data:,"` → `jsPDF.addImage`
produced nothing and `pdf.save()` wrote an empty/again-failed file. The `catch` only did
`console.error`, so the failure was **silent** to the user.

**Fix (two parts):**

1. **Clamp the capture scale** to the largest value that keeps the raster within the browser
   limits, instead of a hard-coded `2`:

   ```ts
   const cssW = canvas.scrollWidth, cssH = canvas.scrollHeight;
   const MAX_DIM = 32000, MAX_AREA = 256 * 1024 * 1024; // margins under the real caps
   const captureScale = Math.max(0.5,
     Math.min(2, MAX_DIM / cssW, MAX_DIM / cssH, Math.sqrt(MAX_AREA / (cssW * cssH))));
   ```

   Short reports still capture at 2× (unchanged quality); tall ones scale down just enough to
   succeed.
2. **Fail loudly:** after capture, throw if `!captured.width || !captured.height`, and the
   `catch` now `alert()`s the message so the user knows the report is too large (with the hint
   to hide sections / reduce Top N) rather than getting a silent no-op.

**Gotcha:** This limit is about the **total rendered height**, not specifically filtered
sections — a non-filtered report with many full-page Top Risk Stretches at high Top N can hit it
too. The clamp covers both. Quality is only reduced when the report is genuinely huge.

**Key files:**

- `frontend/src/pages/ReportBuilderPage/reportBuilderPage.tsx` — `handleDownloadPDF()`:
  `captureScale` clamp, empty-canvas guard, user-facing `alert` on failure

### CodingPage → PathAnalysisPage: Child Attribute Color Stale After Save (2026-06-26)

**Symptom:** Filter PathAnalysisPage for a parent attribute (e.g. "Fixed Obstacle on Facility" = Present), click a segment to open CodingPage, change its child attribute (e.g. FO Type → "Vegetation"), save, and navigate back. The segment on the map still renders with the **old** child attribute color instead of the newly saved value.

**Root cause:** `saveAllProjects()` in `codingPage.tsx` writes updated attributes to the backend but never invalidates the `projectDataCache`. On return, PathAnalysisPage remounts and calls `getCachedAttributes(project)` — which is a cache hit on the stale pre-edit data — so `getFocusedAttributeValue` reads the old FO Type value and `getCategoryColor` returns the old color.

**Fix:** Import `invalidateProject` from `projectDataCache` and call it for every dirty project immediately after `Promise.all(savePromises)` resolves inside `saveAllProjects()`:

```ts
// Invalidate PathAnalysis cache so back-navigation sees fresh attributes/results
dirtyProjects.forEach(projName => invalidateProject(projName));
```

This drops all three cache namespaces (`geodata`, `attributes`, `results`) for each saved project, forcing a fresh fetch on the next PathAnalysisPage mount. The fix is generic — it covers **all** child attributes (FO Type, NFO Type, Facility Width Sub-category, Curvature Sub-category, Crossing Type, Delineation Type) since any attribute edit marks the project dirty.

**Why no other save paths need fixing:** `handleSaveOptions` only manages dropdown option lists in local state (no backend write, no navigation). The three `window.history.back()` calls in the "← Back to Path Analysis" button are: (1) no-changes case — cache is not stale; (2) discard case — changes reverted, cache is not stale; (3) save-and-exit — now fixed.

**Key files:**

- `frontend/src/pages/CodingPage/codingPage.tsx` — `saveAllProjects()`: added `invalidateProject` call per dirty project; import added
- `frontend/src/api/projectDataCache.ts` — `invalidateProject(project)`: drops `geodata`, `attributes`, `results` for one project

### PathAnalysisPage: Grey "All-Segments" Flash After Treatment → Report Round-Trip (2026-06-30)

**Symptom:** Navigate Analysis → Treatment (via the "Open in Treatment" button) → **Generate
Report** → back to Treatment → back to Analysis. On the returning Analysis page there's a brief
flash where **all** segments (including ones the filter should hide — "irrelevant segments") are
rendered **grey** (`#6B7280`) before the correct filtered/coloured view appears.

**Two independent causes, both fixed:**

#### Cause A — `attrMappings`-cold render shows ALL segments grey (primary)

`visibleSegments` (`PathAnalysisMapView.tsx`) filters via `getFilterAttributeText` and the map
colours via `getCategoryColor` — **both rely on `attrMappings`** to convert numeric attribute
codes into the text labels that `categoryToggles` and the colour maps are keyed by. When
`attrMappings` is empty for a render (the module-level mappings cache is cold — e.g. its initial
async fetch hadn't resolved/persisted before this longer multi-page round-trip), **every**
segment's value is an unmatched code → nothing is filtered out (all segments show) and nothing
gets a category colour (all grey). This is the same "all segments then filtered" flash class the
sync-mappings init (`getCachedAttributeMappingsSync()`) targets, but that only helps when the
cache is already warm.

**Fix:** In the `visibleSegments` memo, when mappings are **required** (`activeFilters.length > 0`
or a non-`Project` `primaryFocusAttribute`) but **not ready** (`attrMappings` has no keys), return
`[]` — render **nothing** for that frame instead of all-grey. A brief blank is far
less jarring than irrelevant grey segments, and it self-resolves the moment mappings load (the
fetch's `.catch` sets a minimal adequacy fallback, so it can never stay blank). Warm-cache path is
unaffected (mappings ready on render 1). Added `attrMappings` + `primaryFocusAttribute` to the memo
deps. **Use `primaryFocusAttribute`, NOT `effectiveFocusAttribute`, in the guard** —
`effectiveFocusAttribute` is derived from `visibleSegments` (circular dep).

#### Cause B — Report generation destroyed the Analysis loaded-projects state

The Treatment-page **Generate Report** button (`Sidebar.tsx`, the `onTreatmentDetail` variant) did
`sessionStorage.removeItem("pathAnalysis_loadedProjects")` so the Report Builder (which unioned
`pathAnalysis_loadedProjects` + `treatment_loadedProjects`) would reflect the Treatment selection.
This corrupted the Analysis page's persisted loaded-projects list; on back-navigation it only
"self-healed" via the `pathAnalysis_selectedProjects` fallback in `getStoredLoadedProjects()` — and
if that key was also absent, Analysis fell back to `fetchProjectList()` and loaded **all** projects
(the "irrelevant segments").

**Fix:** Stop deleting the key. The Report Builder now **prefers** `treatment_loadedProjects` when
present, else `pathAnalysis_loadedProjects` (`reportBuilderPage.tsx`: `const combined = trP.length
> 0 ? [...new Set(trP)] : [...new Set(paP)]`). The two report entry points already clear the other
context's key (Analysis→Report clears `treatment_loadedProjects`), so the preference is
unambiguous and no destructive removal is needed.

**Key files:**

- `frontend/src/pages/PathAnalysisPage/components/PathAnalysisMapView.tsx` — `visibleSegments`:
  `mappingsReady`/`needsMappings` guard + deps
- `frontend/src/pages/sidebar/Sidebar.tsx` — Treatment-page "Generate Report": removed the
  `removeItem("pathAnalysis_loadedProjects")`
- `frontend/src/pages/ReportBuilderPage/reportBuilderPage.tsx` — session-restore effect: prefer
  `treatment_loadedProjects` over `pathAnalysis_loadedProjects` instead of unioning

## Commands

- Frontend: `cd frontend && npm run dev`
- Backend: `cd backend && python -m flask run` (or similar)

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: After completing any code edits, ALWAYS call `build_or_update_graph_tool` (incremental, no args needed) to keep the knowledge graph in sync.**

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
