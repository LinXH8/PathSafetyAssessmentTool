# REFACTOR_PLAN.md — PathSafetyAssessmentTool Cleanup & Structural Refactor

> **Resumable playbook.** This doc is the single source of truth for an ongoing, multi-session refactor.
> It is designed so a **fresh Claude Code chat with no prior context** can: (1) read this file, (2) find the
> next unchecked session in the Dashboard, (3) jump to that session, (4) load only the files it lists, (5) do
> the work, (6) tick the checkbox + fill the "Done" date, (7) stop. **Do one session per chat.**

---

## HOW TO USE THIS DOC (read first, every chat)

1. **Pick the next session:** In the Dashboard below, find the first row whose box is `[ ]`. Respect `Depends on`.
2. **Open that session block** (## S0.1, ## S1.2, …). Read its *Context to load* and open only those files.
3. **Goal = pure refactor.** No behavior changes, no new features. If you find a real bug, note it under
   "Deferred findings" at the bottom — do NOT fix it inline.
4. **Verify** with the session's checks AND the global Regression Checklist (bottom) if it touched frontend UI.
5. **Update this file:** flip `[ ]`→`[x]` in the Dashboard, set the `Done:` date in the session block, add a
   one-line note of anything surprising for the next chat.
6. **Commit** (per `CLAUDE.md`: prompt the user before committing/pushing to `xh_dev`). Suggested message is in
   each session. Commit this updated REFACTOR_PLAN.md together with the work.
7. **Stop.** One session per chat keeps context small and reviewable.

**Guardrails for every session:**
- **Read-only commands run without asking.** Execute any non-mutating action — `git status/diff/log/show`, `grep`,
  `find`, `cat`, `ls`, `wc`, reachability scripts, `npm run lint`/`tsc --noEmit`, `python -c "import app"`, etc. —
  freely, WITHOUT prompting for permission. Only pause for approval on mutating/outward actions (commits, pushes,
  `git rm`, file writes/deletes, installs). This matches `CLAUDE.md`'s standard protocol.
- **Ask before guessing.** Whenever the request is ambiguous, a session's scope is unclear, there are multiple
  reasonable approaches, or an operation is high-risk (bulk deletes, `git rm`/`reset`, schema/API changes, anything
  hard to reverse), STOP and prompt the user for their preference rather than assuming. Present the options and a
  recommendation; proceed only after they choose. Do not silently pick a default on consequential decisions.
- Read `CLAUDE.md` first — it documents live gotchas (filter-color leak, viewport restore, `startIndex=0`
  coloring, Chakra dialog scroll-lock cleanup, autocode skip flags). These are your regression tripwires.
- No automated test suite exists (user opted out). Your safety net is: small commits + manual run + the
  Regression Checklist. Refactor ONE seam at a time; build/boot after each.
- **Document as you go** — see the Documentation Standard below. Every module/function/hook you create or move
  gets a doc block; a session is NOT done until its new code is documented.
- **English only** — all comments, docstrings, and doc blocks must be written in English. If you encounter
  non-English comments while editing a file, translate them to English in the same commit.
- Frontend gate: `cd frontend && npm run lint && npx tsc --noEmit && npm run build` must pass.
- Backend gate: app must import & boot (`cd backend && python -c "import app"` then boot the server).

---

## DOCUMENTATION STANDARD (mandatory for every code-touching session)

Refactoring is also a documentation pass. For any file you create, split, or substantially edit:

- **Module/file header:** a top-of-file block stating the module's single responsibility and how it fits the
  larger flow (which page/route uses it, what it owns). Python module docstring; TS file `/** … */` header.
- **Public functions / hooks / classes / components:** a docstring (Python) or TSDoc `/** … */` (TS) covering
  purpose, parameters, return shape, and any side effects (sessionStorage writes, network calls, mutations).
  Backend route handlers: document method + path, request payload, and response shape.
- **Non-obvious logic:** inline comments explaining *why* (especially the documented gotchas — e.g. why
  `startIndex` must be 0, why the Chakra scroll-lock cleanup exists). Don't comment the obvious.
- **English only**, no exceptions. Translate any non-English comment you touch.
- Keep `CLAUDE.md` authoritative for cross-cutting gotchas; link to it from code comments rather than copying
  long explanations.
- When a session meaningfully changes structure, add/update the relevant page under `docs/` (and re-run the
  `docs/`→`frontend/public/docs/` sync from S0.6).

---

## BRANCH & REVERT SAFETY (do this before S0.1, then obey every session)

- **All refactor work lives on `xh_dev` ONLY.** `main` is never touched by this effort — it is the ultimate rollback.
  First chat: `git checkout xh_dev` (create from `main` if it doesn't exist). Verify `git branch --show-current` is
  `xh_dev` at the start of EVERY session before editing.
- **Tag a baseline once, before S0.1:** `git tag pre-refactor-baseline` (already created at commit `9822f228`). Full
  rollback anytime: `git reset --hard pre-refactor-baseline` (on `xh_dev`).
- **One session = one commit.** This is the revert unit — undo a bad session with `git revert <sha>` without disturbing
  other work. Never batch multiple sessions into one commit.
- **Recovering an accidentally deleted file:** `git checkout <sha>~1 -- path/to/file` (from the commit that removed it),
  or `git restore <file>` if not yet committed. Lost commits persist in `git reflog` (~90 days).
- **Destructive steps archive first:** S0.3 copies `scratch/` outside the repo before `git rm`; S0.2 re-runs the
  reachability script before deleting. Never `git rm` an "unused" file without the inventory/verification backing it.
- Per `CLAUDE.md`: after each session, PROMPT the user before committing/pushing to `xh_dev`.

## CONTEXT (why this exists)

Tech debt hurting maintainability. Backend: `routes.py` 6,304 lines / ~125 fns (CRUD+autocode+GIS+images+export
mixed); `gis_mapping.py` 2,583 lines (proximity+speed+curvature+width in one class); `print()` logging; ~24 loose
`test_*.py` in backend root. Frontend: 5 monoliths (`PathAnalysisMapView` 3,555, `reportBuilderPage` 3,092,
`codingPage` 3,036, `treatmentDetailPage` 2,197, `GeoDataPanel` 1,901), `api/index.ts` 1,519, ad-hoc sessionStorage,
empty `types/index.ts`, ~147 `any`, duplicated utils. Repo: ~40 tracked junk files, 3 doc trees, duplicate
`config.json`, weak `.gitignore`, no CI. **Scope:** full structural refactor, NO test/CI work, solo+Claude Code.
**Target:** no file > ~600 lines, single sources of truth, clean hygiene, identical runtime behavior.

**Estimate:** ~40–55 working days total. Each session below is sized ~0.5–2 days (one or a few chats).

---

## UNUSED FILE INVENTORY (audited 2026-07-02)

Basis for Phase 0. Frontend "dead" = unreachable from `src/main.tsx`/`src/App.tsx` via transitive import graph
(verified script). Backend "not app" = not imported by `backend/app/**`. Route table in `App.tsx` mounts only 13
components; `/home` renders `pages/Projects/projects.tsx` (aliased `Home`).

**FE dead source — 21 modules, confirmed NOT routed / NOT rendered (delete):**
- Dead pages: `pages/AnalysisPage/` (analysisPage, components/MapView, components/AttributesDropdown);
  `pages/PostTreatmentAnalysisPage/`; `pages/PreTreatmentAnalysisPage/`; `pages/Home/home.tsx` (stale dup of
  projects.tsx); `pages/ShapefileManagement/` (page + AddShapefileView + ReplaceShapefileView + UploadModal — superseded
  by live `pages/sidebar/components/ShapefileModal.tsx`); `pages/TreatmentPage/components/` MapView, TreatmentMapView,
  AttributesDropdown.
- Orphaned viz: `components/visualization/AnalysisPanel.tsx`; `.../curvature/{CurvatureDiagnostics,CurvatureVisualization,
  CurvatureVisualizationPanel}`; `.../scoreband/ScoreBandDistributionPanel`; `.../width/{WidthSearchDiagnostics,
  WidthVisualization,WidthVisualizationPanel}`. (Live curvature/width goes via `GeoDataPanel` + `api/curvatureVisualization.ts`/`widthVisualization.ts`.)
- KEEP: `vite-env.d.ts` (tooling), `types/index.ts` (empty, reserved for S1.2).
- **Consequence:** old S1.5 (unify 3 AttributesDropdowns) is VOID — Treatment/Analysis copies are dead; only
  `PathAnalysisPage/components/AttributesDropdown.tsx` is live.

**Backend/root scratch `.py` — not imported by app (DELETE):** `debug_script.py`, `exec_task.py`, `final_check.py`,
`inspect_data.py`, `backend/inspect_data.py`, `inspect_curvature.py`, `inspect_curvature_v2.py`, `patch_geodata_panel.py`,
`task_run.py`, `test_script.py`, `generate_draft_slides.py`.

**Dev utility `.py` — not app runtime but legit (MOVE → `scripts/`):** `backend/{extract_xml_dates,generate_road_reference,
generate_user_guide_pdf,setup_test_project,visualize_facility_width}.py`, `frontend/replace_tiles.py`,
`scripts/summarise_in_folder.py` (already there).

**Backend `test_*.py` (19, in backend root) → `backend/tests/`** — handled in S3.7 (move only).

**Committed build/log artifacts (DELETE + gitignore):** `logs.txt`, `output.txt`, `batch_output.txt`, `pytest_out.txt`,
`overlaps_report.txt`, `overlaps_results.txt`, `test.txt`, `frontend/{build_errors,build_log,build_output,build_result}.txt`,
`frontend/{backend_compile,vite_build}.{out,err}`, `backend/autocode_debug.txt`, `backend/scripts.zip`,
`backend/Documentation/MIGRATION_COMPARISON.txt`.

**`scratch/` dir (39 files: doc-gen scripts + raw dumps):** DECISION = **archive outside the repo**, then `git rm -r scratch/`.

**`.docx` guides:** DECISION = **leave alone** for now (skip docx cleanup).

---

## PROGRESS DASHBOARD

> Flip the box when the session is merged. `Days` is rough effort, not calendar.

### Phase 0 — Repo hygiene & dead-file cleanup (3–4 days)
- [x] **S0.1** Delete committed build/log artifacts + untrack scratch `.py` + tighten `.gitignore` — 0.5d — *depends: none*
- [x] **S0.2** Delete 21 confirmed-dead frontend modules — 0.5d — *depends: none*
- [ ] **S0.3** Archive `scratch/` outside repo + `git rm -r scratch/` — 0.5d — *depends: none*
- [ ] **S0.4** Move dev utility scripts → `scripts/` — 0.5d — *depends: S0.1*
- [ ] **S0.5** Consolidate duplicate `config.json` — 0.5d — *depends: none*
- [ ] **S0.6** Consolidate doc trees + add `docs/`→`frontend/public/docs/` sync — 1–1.5d — *depends: none*
- [ ] **S0.7** English-only comment sweep (baseline pass) — 0.5d — *depends: none*
- [ ] ~~S1.5 unify AttributesDropdown~~ — **VOID** (Treatment/Analysis copies are dead code; deleted in S0.2)

### Phase 1 — Frontend shared foundation (6–9 days) — *do before Phase 2*
- [ ] **S1.1** Split `api/index.ts` into domain modules + barrel — 1d — *depends: none*
- [ ] **S1.2** Populate `types/index.ts`; remove dup interfaces; `any`→`unknown` — 1–2d — *depends: S1.1*
- [ ] **S1.3** Extract `utils/riskColors.ts` + `utils/projection.ts` — 1d — *depends: none*
- [ ] **S1.4** Extract shared map components (`DraggableMarker`, `PolygonDrawing`) — 1d — *depends: S1.3*
- [x] ~~**S1.5** Unify the 3 `AttributesDropdown` variants~~ — **VOID** (2 of 3 were dead code, deleted in S0.2)
- [ ] **S1.6** `useSessionState` hook + typed `SESSION_KEYS`; migrate keys — 2d — *depends: S1.2*

### Phase 2 — Frontend monolith decomposition (16–20 days) — *depends: Phase 1 done*
- [ ] **S2.1** Decompose `PathAnalysisMapView.tsx` — 4d — *depends: S1.\**
- [ ] **S2.2** Decompose `GeoDataPanel.tsx` — 3d — *depends: S1.\**
- [ ] **S2.3** Decompose `codingPage.tsx` — 4d — *depends: S2.2*
- [ ] **S2.4** Decompose `treatmentDetailPage.tsx` — 3d — *depends: S1.\**
- [ ] **S2.5** Decompose `reportBuilderPage.tsx` — 4d — *depends: S1.\**

### Phase 3 — Backend modularization (14–17 days) — *can interleave with Phase 2*
- [ ] **S3.1** Add `@with_project` decorator + standardize error→JSON — 1.5d — *depends: none*
- [ ] **S3.2** Split `routes.py` into `projects/` blueprint package — 3d — *depends: S3.1*
- [ ] **S3.3** Replace `print()` with `logging` — 1d — *depends: none*
- [ ] **S3.4** Extract `CurvatureAnalyzer` + `WidthAnalyzer` from `gis_mapping.py` — 3d — *depends: none*
- [ ] **S3.5** Add `query_nearby()` helper; unify proximity checks — 2d — *depends: S3.4*
- [ ] **S3.6** Split `project_manager.py` (+ `image_storage` module) — 2.5d — *depends: none*
- [ ] **S3.7** Move root `test_*.py` → `backend/tests/` + `conftest.py` — 1d — *depends: none*
- [ ] **S3.8** Type-hint pass on `routes.py` + `project_manager.py` — 2d — *depends: S3.2, S3.6*

### Phase 4 — Verification (3–4 days) — *depends: all above*
- [ ] **S4.1** Full end-to-end manual QA + fix regressions — 3–4d

---

## SESSION DETAILS

### S0.1 — Delete committed artifacts + untrack scratch `.py` + `.gitignore`  · Done: 2026-07-02
**Goal:** Remove build/log junk from the tree; stop it recurring.
**Context to load:** `.gitignore`, `backend/.gitignore`; UNUSED FILE INVENTORY above.
**Do:** `git rm` the committed build/log artifacts (see inventory: root `logs/output/batch_output/pytest_out/test.txt`,
`overlaps_*.txt`, `frontend/build_*.txt`, `frontend/*.{out,err}`, `backend/autocode_debug.txt`, `backend/scripts.zip`,
`backend/Documentation/MIGRATION_COMPARISON.txt`). `git rm` the root scratch `.py` (debug_script, exec_task, final_check,
inspect_data, backend/inspect_data, inspect_curvature{,_v2}, patch_geodata_panel, task_run, test_script,
generate_draft_slides). Add ignore globs (`*_log.txt`, `*.out`, `*.err`, `build_*.txt`). **Do NOT touch** dev utilities
(S0.4) or backend `test_*.py` (S3.7).
**Verify:** `git ls-files | grep -E '\.(out|err)$'` empty; app still boots.
**Commit:** `chore: remove committed build/log artifacts and scratch scripts`

### S0.2 — Delete 21 dead frontend modules  · Done: 2026-07-02
**Goal:** Remove confirmed-unreachable FE source (see inventory — none are routed/rendered).
**Context to load:** inventory list; `frontend/src/App.tsx` (route table).
**Do:** Delete the 21 modules (whole dead pages `AnalysisPage/`, `PostTreatmentAnalysisPage/`,
`PreTreatmentAnalysisPage/`, `Home/home.tsx`, `ShapefileManagement/`, dead `TreatmentPage/components/{MapView,
TreatmentMapView,AttributesDropdown}`, orphaned `components/visualization/{AnalysisPanel, curvature/*, width/*,
scoreband/ScoreBandDistributionPanel}`). Remove now-empty dirs. **Re-run the reachability script after** to confirm no
newly-orphaned files. Keep `vite-env.d.ts` and `types/index.ts`.
**Verify:** `npm run lint && npx tsc --noEmit && npm run build` all pass; app runs, every route still renders.
**Commit:** `chore(frontend): remove dead unreachable pages and components`

### S0.3 — Archive + remove `scratch/`  · Done: ____
**Goal:** Get one-off doc-gen tooling out of the repo (user chose: archive outside repo).
**Do:** Copy `scratch/` to an external archive location (outside the repo working tree), confirm the copy, then
`git rm -r scratch/`.
**Verify:** `git ls-files scratch/` empty; app unaffected.
**Commit:** `chore: remove scratch/ doc-generation tooling (archived externally)`

### S0.4 — Relocate dev utility scripts  · Done: ____
**Context to load:** `backend/{extract_xml_dates,generate_road_reference,generate_user_guide_pdf,setup_test_project,
visualize_facility_width}.py`, `frontend/replace_tiles.py`.
**Do:** Move these into `scripts/` (or `backend/scripts/` for backend-specific); fix internal relative paths. Confirm via
grep none are imported by `backend/app/**` (already verified: 0 imports).
**Verify:** `grep -r` shows no broken imports; scripts still runnable standalone.
**Commit:** `chore: relocate dev utility scripts into scripts/`

### S0.5 — Consolidate `config.json`  · Done: ____
**Goal:** One source of truth (root vs `backend/config.json` are duplicates).
**Context to load:** `config.json`, `backend/config.json`, `backend/app/config.py`, `docker-compose.yml`, `backend.Dockerfile`.
**Do:** Determine which path the running app/Docker actually reads (grep for `config.json` loads). Keep that one,
remove the other, add a comment documenting the choice. Update any loader path if needed.
**Verify:** Backend boots and reads config; values unchanged.
**Commit:** `chore: consolidate duplicate config.json to single source`

### S0.6 — Consolidate docs + sync  · Done: ____
**Goal:** Reduce 3 doc trees to a canonical set; stop drift. (`.docx` left alone per user decision.)
**Context to load:** `docs/`, `frontend/public/docs/`, `backend/Documentation/`, `frontend/public/README.md`.
**Do:** Canonical = markdown in `docs/`. Fold actionable `backend/Documentation/CURVATURE_*`/`FACILITY_WIDTH_*`/`ROAD_*`
content into `docs/`; archive purely-historical migration notes under `docs/archive/`. Add a small sync script (or npm
script) copying `docs/` → `frontend/public/docs/` and document it in README.
**Verify:** In-app Help still loads (`frontend/public/docs` populated); no broken relative links.
**Commit:** `docs: consolidate doc trees and add docs sync`

### S0.7 — English-only comment sweep (baseline)  · Done: ____
**Goal:** Remove non-English comments/docs from files the refactor may not otherwise touch.
**Context to load:** grep for non-ASCII in comments, e.g. `grep -rnP "[^\x00-\x7F]" --include=*.py --include=*.ts
--include=*.tsx --include=*.txt backend frontend/src`. Known hit: `backend/requirements.txt` (mixed Chinese/English
comments re: torch/CUDA wheels).
**Do:** Translate non-English comments to English; preserve meaning. Leave genuine data strings/UI copy alone — only
translate **comments/docstrings**. (Per-file translations during later sessions are handled by the global guardrail;
this is the one-time baseline.)
**Verify:** Re-run the grep; remaining non-ASCII hits are intentional data, not comments.
**Commit:** `docs: translate non-English code comments to English`

### S1.1 — Split `api/index.ts`  · Done: ____
**Goal:** 1,519-line client → ~9 domain modules + barrel; zero logic change.
**Context to load:** `frontend/src/api/index.ts`, `frontend/src/api/projectDataCache.ts`.
**Do:** Create `frontend/src/api/{projects,attributes,geo,autocode,treatments,shapefiles,auth,media,reports}.ts`; move
functions by domain (groupings noted in commit). Keep `index.ts` re-exporting everything (barrel) so existing imports
don't break. Shared `fetch` error helper stays/extracts to `api/_client.ts`.
**Verify:** frontend gate passes; no import churn at call sites.
**Commit:** `refactor(api): split monolithic api/index.ts into domain modules`

### S1.2 — Populate `types/index.ts`  · Done: ____
**Goal:** Single home for shared domain types; kill duplicate interface decls.
**Context to load:** `frontend/src/types/index.ts` (empty), `codingPage.tsx` & `treatmentDetailPage.tsx` (dup
`ProjectDetail`/`AttributesResponse`), `api/index.ts` (`CodingFilterContext`).
**Do:** Define `ProjectDetail`,`AttributeRow`,`CodingFilterContext`,`SegmentScores`,`TreatmentDefinition`; import them
where currently re-declared; convert `catch (e: any)`→`unknown`+guards in touched files; enable stricter tsconfig flags
if low-risk.
**Verify:** `tsc --noEmit` clean.
**Commit:** `refactor(types): centralize shared domain types`

### S1.3 — `riskColors` + `projection` utils  · Done: ____
**Context to load:** `frontend/src/constants/colorConstants.ts`; the 3 inline `to4326` copies in
`PathAnalysisMapView.tsx`, `GeoDataPanel.tsx`, `reportBuilderPage.tsx`.
**Do:** `utils/riskColors.ts` (reuse `colorConstants.ts`, export `RISK_COLORS`/`RISK_LABELS`); `utils/projection.ts`
(single `to4326`/`to3414`). Replace inline copies with imports.
**Verify:** Segment colors + map coords visually unchanged (Regression Checklist items 3).
**Commit:** `refactor(utils): extract shared risk-color and projection helpers`

### S1.4 — Shared map components  · Done: ____
**Context to load:** `DraggableMarker`/`PolygonDrawingTool`/`isPointInPolygon` in `PathAnalysisMapView.tsx` &
`GeoDataPanel.tsx`.
**Do:** Create `frontend/src/components/map/DraggableMarker.tsx` + `PolygonDrawing.tsx`; replace both copies.
**Verify:** Polygon draw + marker drag work on both pages.
**Commit:** `refactor(map): extract shared DraggableMarker and PolygonDrawing`

### S1.5 — VOID
The Treatment/Analysis `AttributesDropdown` copies were dead code (deleted in S0.2); only
`PathAnalysisPage/components/AttributesDropdown.tsx` remains and is already single. No unification needed.

### S1.6 — `useSessionState` + key namespace  · Done: ____
**Context to load:** `CLAUDE.md` (sessionStorage keys), grep `sessionStorage`/`localStorage` (~58 sites).
**Do:** `hooks/useSessionState.ts` (typed JSON get/set), `constants/sessionKeys.ts` (`SESSION_KEYS` — no magic
strings). Migrate `pathAnalysisMap_*`, `pathAnalysis_*`, `codingFilterContext`, `gisLayerToggles_*`. Preserve exact key
strings to keep existing user sessions valid.
**Verify:** Viewport restore + filter persistence + filter-color context all survive back-nav (Regression items 1,2,4).
**Commit:** `refactor(state): add useSessionState hook and typed session keys`

### S2.1–S2.5 — Monolith decomposition (one file per session)  · Done: ____ each
**Goal (all):** Turn each page into a thin orchestrator by extracting hooks (data/state) + sub-components along seams.
No behavior change. After each extraction: build + manual smoke + commit.
- **S2.1 PathAnalysisMapView** → `useGISLayerToggles`, `useFilterState`, `useViewportPersistence`, `<GISLayerControls>`,
  `<FilterPanel>`, map-event hooks.
- **S2.2 GeoDataPanel** → `useGISToggleState`, `useCurvatureOverlay`, `useWidthVisualization`, `<DefectsLayer>`.
- **S2.3 codingPage** → `useProjectDataCache`, `useFilterContext`, `useAutocode`, `useAttributeEditing`.
- **S2.4 treatmentDetailPage** → `useProjectMapping` (resolveIndex/projectMap), `useTreatmentEngine`, `useTreatmentState`/`useTreatmentAnalysis`.
- **S2.5 reportBuilderPage** → `useReportData`, `usePDFExport`, `useReportLayout`, per-domain `<ReportSection*>`.
**Context to load (each):** the target file + `CLAUDE.md` + hooks/components from Phase 1.
**Verify (each):** frontend gate + full Regression Checklist for that page's flows.
**Commit (each):** `refactor(<page>): decompose into hooks and sub-components`

### S3.1 — `@with_project` decorator  · Done: ____
**Context to load:** `backend/app/api/projects/routes.py` (the `get_ctx()`→`pm`→`project`→`latest` + try/except→JSON
pattern, ~40 sites).
**Do:** Decorator injecting `(pm, proj, ver)` and standardizing exception→JSON. Apply incrementally; keep responses
byte-identical.
**Verify:** Hit a representative endpoint of each kind; responses unchanged.
**Commit:** `refactor(backend): add @with_project decorator and standardize error handling`

### S3.2 — Split `routes.py`  · Done: ____
**Context to load:** `routes.py`, `backend/app/api/projects/__init__.py`.
**Do:** Convert `projects/` into a package of blueprints: `crud.py`, `autocode.py`, `segments.py`, `images.py`,
`source_folders.py`, `gis_queries.py`, `export.py`, `baseline.py`. Move private helpers to service functions. Keep URL
routes identical (register all blueprints).
**Verify:** Every route still registered (`flask routes`-equiv / boot log); smoke each group.
**Commit:** `refactor(backend): split projects routes.py into blueprint modules`

### S3.3 — `logging` over `print()`  · Done: ____
**Do:** Configure a logger; replace ~68 `print()` with leveled logs. Preserve any user-facing stdout the app relies on.
**Verify:** Boot, run an autocode, confirm logs emit.
**Commit:** `refactor(backend): replace print with logging`

### S3.4 — Extract Curvature/Width analyzers  · Done: ____
**Context to load:** `backend/app/services/gis_mapping.py` (curvature ~900 lines; width logic), `backend/app/utils/path_width_curvature.py`.
**Do:** Move curvature → `services/curvature_analyzer.py` (`CurvatureAnalyzer`); width → `services/width_analyzer.py`.
`GIS` class delegates. Keep numeric outputs identical (spot-check against a known segment).
**Verify:** `backend/test_curvature_analysis.py` still passes; compare curvature/width on a sample project.
**Commit:** `refactor(gis): extract CurvatureAnalyzer and WidthAnalyzer`

### S3.5 — `query_nearby()` + unify proximity  · Done: ____
**Context to load:** `gis_mapping.py` proximity methods (`is_mrt`/`is_bus_lane`/… ) + buffer/sindex/distance repeats.
**Do:** Add `query_nearby(layer, point, buffer, max_dist)`; route the 8 near-identical proximity checks + ~20 repeated
patterns through it.
**Verify:** GIS autocode results unchanged on a sample project.
**Commit:** `refactor(gis): add query_nearby helper and unify proximity checks`

### S3.6 — Split `project_manager.py`  · Done: ____
**Context to load:** `backend/app/services/project_manager.py`.
**Do:** Split `ProjectVersion` into data/serialization/defaults concerns; move image dedup/materialization to
`services/image_storage.py`. Keep public API of `project_manager` stable.
**Verify:** Create/open/list project + image dedup still work.
**Commit:** `refactor(backend): modularize project_manager and extract image_storage`

### S3.7 — Organize backend tests  · Done: ____
**Do:** Move the ~24 root `backend/test_*.py` into `backend/tests/` + add `conftest.py` + `pytest.ini`. **Move only,
do not rewrite** (per scope). Drop obviously-dead dependency-probe scripts (confirm via run first).
**Verify:** `cd backend && pytest` collects from `tests/`.
**Commit:** `chore(backend): consolidate tests into tests/ directory`

### S3.8 — Type-hint pass  · Done: ____
**Do:** Add param/return hints to `routes.py` + `project_manager.py`; add `TypedDict`s for common payloads. No logic
change.
**Verify:** Optional `mypy`/boot; gate passes.
**Commit:** `refactor(backend): add type hints to routes and project_manager`

### S4.1 — End-to-end manual QA  · Done: ____
**Do:** Run the app (`docker-compose up` or local dev). Walk the full flow: project create → code → autocode → score →
path analysis filters → treatment apply → report build/export → GIS layers. Fix regressions surfaced. Re-run the full
Regression Checklist.
**Commit:** `fix: resolve regressions found in end-to-end QA` (as needed)

---

## REGRESSION CHECKLIST (run after any UI-touching session)

From `CLAUDE.md` documented gotchas — these are the known-fragile behaviors:
1. **Viewport restore:** PathAnalysis → filter → click segment → back: pan/zoom/focus restored, no full re-fit, no flash.
2. **Filter persistence:** filters + category toggles survive back-nav from Coding.
3. **Segment colors:** risk-band colors (LOW `#87C424`/MED `#FFCC1A`/HIGH `#FF5B1A`/EXTREME `#CD1AFF`); **no blue
   `#2563EB`** (=broken scores lookup); filter colors don't leak into direct Coding loads.
4. **`startIndex=0`** when passing ALL aggregated features to `GeoDataPanel`.
5. **Chakra dialog:** closing EditProjectModal/AddSegmentsDialog leaves page interactive (no scroll-lock freeze).
6. **Autocode skip flags:** single-attribute autocode still respects `skip_cv`/`skip_obstacles`/`skip_gis`.

---

## DEFERRED FINDINGS (bugs/oddities spotted mid-refactor — do NOT fix inline)
- _(add dated one-liners here as you go)_

## SESSION LOG (one line per completed session)
- 2026-07-02 · setup · created `xh_dev` baseline tag `pre-refactor-baseline` (9822f228); wrote REFACTOR_PLAN.md to repo root (added `!REFACTOR_PLAN.md` to .gitignore since `*.md` is ignored).
- 2026-07-02 · S0.1 · removed 30 tracked junk files (build/log artifacts + root scratch `.py`); added artifact globs to .gitignore. Backend imports OK. Note: dev utilities + backend `test_*.py` intentionally left for S0.4/S3.7.
- 2026-07-02 · S0.2 · deleted 21 dead TSX modules + 4 companion CSS files (25 files total). Kept `AnalysisPanel.css` (used by live `AnalysisSidebar.tsx` + `codingPage.tsx`), `shapefileManagement.css` (used by live `ShapefileModal.tsx`), `ScoreBandDistributionPanel.css` (used by two live AggregatedPanel files). `curvature/` and `width/` subdirs now empty and removed. `tsc --noEmit` clean; build errors are all pre-existing (confirmed via stash comparison).
