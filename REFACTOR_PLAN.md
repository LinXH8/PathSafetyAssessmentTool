# REFACTOR_PLAN.md — PathSafetyAssessmentTool Cleanup & Structural Refactor

> **Resumable playbook.** This doc is the single source of truth for an ongoing, multi-session refactor.
> It is designed so a **fresh Claude Code chat with no prior context** can: (1) read this file, (2) find the
> next unchecked session in the Dashboard, (3) jump to that session, (4) load only the files it lists, (5) do
> the work, (6) tick the checkbox + fill the "Done" date, (7) stop. **Do one session per chat.**

---

## HOW TO USE THIS DOC (read first, every chat)

1. **Pick the next session:** In the Dashboard below, find the first row whose box is `[ ]`. Respect `Depends on`.
2. **Open that session block** (## S0.1, ## S1.2, …) and read its **Context to load** line TOP TO BOTTOM, in
   order, before opening any file it names. Graph queries are written as the FIRST part of that line precisely
   so they cannot be treated as an optional add-on — if the line opens with a graph tool call
   (`get_impact_radius_tool`, `query_graph_tool(pattern="callers_of"/"tests_for")`, `semantic_search_nodes_tool`),
   run it before you open a single file, and only then load the files named afterward. This replaces manual
   grep/AST-diffing for finding callers (see `CLAUDE.md`'s "MCP Tools: code-review-graph" section for the full
   tool table). A few sessions (e.g. S3.8) explicitly need no graph call — that's stated inline, not omitted.
3. **Goal = pure refactor.** No behavior changes, no new features. If you find a real bug, note it under
   "Deferred findings" at the bottom — do NOT fix it inline.
4. **Verify** with the session's checks, `detect_changes_tool` (risk-scored look at the diff), AND the global
   Regression Checklist (bottom) if it touched frontend UI.
5. **Update this file:** flip `[ ]`→`[x]` in the Dashboard, set the `Done:` date in the session block, and
   **add a SESSION LOG entry** following the SESSION LOG STANDARD below (one multi-line entry per session —
   see that section for the mandatory fields, including `GRAPH USAGE`). One-liners are no longer sufficient.
   Before moving on, call `build_or_update_graph_tool` (incremental, no args) so the graph reflects this
   session's edits — the next session (and its own step 2) depends on it being current.
6. **Commit** (per `CLAUDE.md`: prompt the user before committing/pushing to `xh_dev`). Suggested message is in
   each session — **every commit message must include the session tag `[Sx.y]`** (e.g. `[S0.1]`, `[S2.3]`).
   Commit this updated REFACTOR_PLAN.md together with the work.
7. **Stop.** One session per chat keeps context small and reviewable.

**Guardrails for every session:**

- **Session tag in every commit message.** Every commit produced by a session MUST include the session tag
  `[Sx.y]` (e.g. `[S0.1]`, `[S2.3]`) so commits can be traced back to the session that produced them.
  Format: `<type>(<scope>): <description> [Sx.y]`. Never omit the tag, even for minor follow-up commits.
- **Read-only commands run without asking.** Execute any non-mutating action — `git status/diff/log/show`, `grep`,
  `find`, `cat`, `ls`, `wc`, reachability scripts, `npm run lint`/`tsc --noEmit`, `python -c "import app"`, etc. —
  freely, WITHOUT prompting for permission. Only pause for approval on mutating/outward actions (commits, pushes,
  `git rm`, file writes/deletes, installs). This matches `CLAUDE.md`'s standard protocol.
- **Ask before guessing.** Whenever the request is ambiguous, a session's scope is unclear, there are multiple
  reasonable approaches, or an operation is high-risk (bulk deletes, `git rm`/`reset`, schema/API changes, anything
  hard to reverse), STOP and prompt the user for their preference rather than assuming. Present the options and a
  recommendation; proceed only after they choose. Do not silently pick a default on consequential decisions.
- **Use the code-review-graph MCP tools before Grep/Glob for exploration, and before extracting or moving any
  function/hook/class/component.** Each remaining session's **Context to load** line is written graph-call-first
  for exactly this reason — treat that ordering as load-bearing, not stylistic. If you're ever tempted to jump
  straight to reading a file "because it's faster," that's the signal you're about to skip the graph step; don't.
  `get_impact_radius_tool` / `query_graph_tool(pattern="callers_of")` on the target symbol BEFORE starting a
  move/extraction replaces the ad-hoc grep/AST-diffing used in S3.1/S3.2. Use `detect_changes_tool` as part of
  each session's Verify step. Full tool table lives in `CLAUDE.md`'s "MCP Tools: code-review-graph" section —
  this bullet points at it rather than repeating it. Record what you ran + found in the SESSION LOG's
  `GRAPH USAGE` field — a session that skipped the call has to write that down too, not silently mark `n/a`
  when a graph call was actually due.
- Read `CLAUDE.md` first — it documents live gotchas (filter-color leak, viewport restore, `startIndex=0`
  coloring, Chakra dialog scroll-lock cleanup, autocode skip flags). These are your regression tripwires.
- **`frontend/CLAUDE.md` is mandatory reading for every frontend-touching session.** It is the v2 UI
  contributor rulebook (container/ViewModel/shell seam, shared primitives, design tokens, `variant="v2"`
  gating). Where its rules conflict with an older per-session sketch in this plan, the rulebook wins.
- **Sync with main first.** Before starting any Phase 2/3 session, merge `origin/main` into `xh_dev` and
  re-verify the target file's current state (line count, structure) — main is actively developing the v2 UI
  in the same files this plan decomposes, and session sketches can go stale between chats.
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
`test_*.py` in backend root. Frontend: 5 monoliths (line counts re-measured 2026-07-03 after the v2 merge:
`PathAnalysisMapView` 3,537, `reportBuilderPage` 3,346, `codingPage` 2,301, `treatmentDetailPage` 1,387,
`GeoDataPanel` 1,824), `api/index.ts` 1,519 (split in S1.1), ad-hoc sessionStorage, empty `types/index.ts`
(populated in S1.2), ~147 `any`, duplicated utils. Repo: ~40 tracked junk files, 3 doc trees, duplicate
`config.json`, weak `.gitignore`, no CI. **Scope:** full structural refactor, NO test/CI work, solo+Claude Code.
**Target:** no file > ~600 lines, single sources of truth, clean hygiene, identical runtime behavior.

**v2 UI architecture (merged from main 2026-07-03, commit `d5613347`):** a parallel redesign effort on `main`
already split six pages (Projects, Coding, Treatment, CreateProject, PathAnalysis, Help) along a
**container / `*ViewModel.ts` / `*LayoutV1|V2.tsx` shell** seam (`frontend/src/pages/*/layouts/`), governed by
the `frontend/CLAUDE.md` rulebook. Containers own ALL logic; shells are pure functions of the view-model.
`PathAnalysisMapView` and `GeoDataPanel` are shared heavy components with gated `variant="v2"` props.
Phase 2 sessions below were re-scoped (2026-07-03) to build ON TOP of this seam, not against it.

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
- [x] **S0.3** Archive `scratch/` outside repo + `git rm -r scratch/` — 0.5d — *depends: none*
- [x] **S0.4** Move dev utility scripts → `scripts/` — 0.5d — *depends: S0.1*
- [x] **S0.5** Consolidate duplicate `config.json` — 0.5d — *depends: none*
- [x] **S0.6** Consolidate doc trees + add `docs/`→`frontend/public/docs/` sync — 1–1.5d — *depends: none*
- [x] **S0.7** English-only comment sweep (baseline pass) — 0.5d — *depends: none*
- [ ] ~~S1.5 unify AttributesDropdown~~ — **VOID** (Treatment/Analysis copies are dead code; deleted in S0.2)

### Phase 1 — Frontend shared foundation (6–9 days) — *do before Phase 2*
- [x] **S1.1** Split `api/index.ts` into domain modules + barrel — 1d — *depends: none*
- [x] **S1.2** Populate `types/index.ts`; remove dup interfaces; `any`→`unknown` — 1–2d — *depends: S1.1*
- [x] **S1.3** Extract `utils/riskColors.ts` + `utils/projection.ts` — 1d — *depends: none*
- [x] **S1.4** Extract shared map components (`DraggableMarker`, `PolygonDrawing`) — 1d — *depends: S1.3*
- [x] ~~**S1.5** Unify the 3 `AttributesDropdown` variants~~ — **VOID** (2 of 3 were dead code, deleted in S0.2)
- [x] **S1.6** `useSessionState` hook + typed `SESSION_KEYS`; migrate keys — 2d — *depends: S1.2*

### Phase 2 — Frontend monolith decomposition (13–17 days) — *depends: Phase 1 done; re-scoped 2026-07-03 for the v2 container/shell seam*
- [ ] **S2.1** Decompose `PathAnalysisMapView.tsx` (3,537; shared `variant="v2"` component) — 4d — *depends: S1.\**
- [ ] **S2.2** Decompose `GeoDataPanel.tsx` (1,824; shared `variant="v2"` component) — 3d — *depends: S1.\**
- [ ] **S2.3** Decompose `codingPage.tsx` container (2,301) — 3d — *depends: S2.2*
- [ ] **S2.4** Decompose `treatmentDetailPage.tsx` container (1,387; partly done by v2 split) — 1.5–2d — *depends: S1.\**
- [ ] **S2.5** Decompose `reportBuilderPage.tsx` (3,346; no v2 layout yet) — 4d — *depends: S1.\**

### Phase 3 — Backend modularization (14–17 days) — *can interleave with Phase 2*
- [x] **S3.1** Add `@with_project` decorator + standardize error→JSON — 1.5d — *depends: none*
- [x] **S3.2** Split `routes.py` into `projects/` blueprint package — 3d — *depends: S3.1*
- [x] **S3.3** Replace `print()` with `logging` — 1d — *depends: none*
- [x] **S3.4** Extract `CurvatureAnalyzer` + `WidthAnalyzer` from `gis_mapping.py` — 3d — *depends: none*
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
**Commit:** `chore: remove committed build/log artifacts and scratch scripts [S0.1]`

### S0.2 — Delete 21 dead frontend modules  · Done: 2026-07-02
**Goal:** Remove confirmed-unreachable FE source (see inventory — none are routed/rendered).
**Context to load:** inventory list; `frontend/src/App.tsx` (route table).
**Do:** Delete the 21 modules (whole dead pages `AnalysisPage/`, `PostTreatmentAnalysisPage/`,
`PreTreatmentAnalysisPage/`, `Home/home.tsx`, `ShapefileManagement/`, dead `TreatmentPage/components/{MapView,
TreatmentMapView,AttributesDropdown}`, orphaned `components/visualization/{AnalysisPanel, curvature/*, width/*,
scoreband/ScoreBandDistributionPanel}`). Remove now-empty dirs. **Re-run the reachability script after** to confirm no
newly-orphaned files. Keep `vite-env.d.ts` and `types/index.ts`.
**Verify:** `npm run lint && npx tsc --noEmit && npm run build` all pass; app runs, every route still renders.
**Commit:** `chore(frontend): remove dead unreachable pages and components [S0.2]`

### S0.3 — Archive + remove `scratch/`  · Done: 2026-07-02
**Goal:** Get one-off doc-gen tooling out of the repo (user chose: archive outside repo).
**Do:** Copy `scratch/` to an external archive location (outside the repo working tree), confirm the copy, then
`git rm -r scratch/`.
**Verify:** `git ls-files scratch/` empty; app unaffected.
**Commit:** `chore: remove scratch/ doc-generation tooling (archived externally) [S0.3]`

### S0.4 — Relocate dev utility scripts  · Done: 2026-07-02
**Context to load:** `backend/{extract_xml_dates,generate_road_reference,generate_user_guide_pdf,setup_test_project,
visualize_facility_width}.py`, `frontend/replace_tiles.py`.
**Do:** Move these into `scripts/` (or `backend/scripts/` for backend-specific); fix internal relative paths. Confirm via
grep none are imported by `backend/app/**` (already verified: 0 imports).
**Verify:** `grep -r` shows no broken imports; scripts still runnable standalone.
**Commit:** `chore: relocate dev utility scripts into scripts/ [S0.4]`

### S0.5 — Consolidate `config.json`  · Done: 2026-07-02
**Goal:** One source of truth (root vs `backend/config.json` are duplicates).
**Context to load:** `config.json`, `backend/config.json`, `backend/app/config.py`, `docker-compose.yml`, `backend.Dockerfile`.
**Do:** Determine which path the running app/Docker actually reads (grep for `config.json` loads). Keep that one,
remove the other, add a comment documenting the choice. Update any loader path if needed.
**Verify:** Backend boots and reads config; values unchanged.
**Commit:** `chore: consolidate duplicate config.json to single source [S0.5]`

### S0.6 — Consolidate docs + sync  · Done: 2026-07-02
**Goal:** Reduce 3 doc trees to a canonical set; stop drift. (`.docx` left alone per user decision.)
**Context to load:** `docs/`, `frontend/public/docs/`, `backend/Documentation/`, `frontend/public/README.md`.
**Do:** Canonical = markdown in `docs/`. Fold actionable `backend/Documentation/CURVATURE_*`/`FACILITY_WIDTH_*`/`ROAD_*`
content into `docs/`; archive purely-historical migration notes under `docs/archive/`. Add a small sync script (or npm
script) copying `docs/` → `frontend/public/docs/` and document it in README.
**Verify:** In-app Help still loads (`frontend/public/docs` populated); no broken relative links.
**Commit:** `docs: consolidate doc trees and add docs sync [S0.6]`

### S0.7 — English-only comment sweep (baseline)  · Done: 2026-07-02
**Goal:** Remove non-English comments/docs from files the refactor may not otherwise touch.
**Context to load:** grep for non-ASCII in comments, e.g. `grep -rnP "[^\x00-\x7F]" --include=*.py --include=*.ts
--include=*.tsx --include=*.txt backend frontend/src`. Known hit: `backend/requirements.txt` (mixed Chinese/English
comments re: torch/CUDA wheels).
**Do:** Translate non-English comments to English; preserve meaning. Leave genuine data strings/UI copy alone — only
translate **comments/docstrings**. (Per-file translations during later sessions are handled by the global guardrail;
this is the one-time baseline.)
**Verify:** Re-run the grep; remaining non-ASCII hits are intentional data, not comments.
**Commit:** `docs: translate non-English code comments to English [S0.7]`

### S1.1 — Split `api/index.ts`  · Done: 2026-07-02
**Goal:** 1,519-line client → ~9 domain modules + barrel; zero logic change.
**Context to load:** `frontend/src/api/index.ts`, `frontend/src/api/projectDataCache.ts`.
**Do:** Create `frontend/src/api/{projects,attributes,geo,autocode,treatments,shapefiles,auth,media,reports}.ts`; move
functions by domain (groupings noted in commit). Keep `index.ts` re-exporting everything (barrel) so existing imports
don't break. Shared `fetch` error helper stays/extracts to `api/_client.ts`.
**Verify:** frontend gate passes; no import churn at call sites.
**Commit:** `refactor(api): split monolithic api/index.ts into domain modules [S1.1]`

### S1.2 — Populate `types/index.ts`  · Done: 2026-07-03
**Goal:** Single home for shared domain types; kill duplicate interface decls.
**Context to load:** `frontend/src/types/index.ts` (empty), `codingPage.tsx` & `treatmentDetailPage.tsx` (dup
`ProjectDetail`/`AttributesResponse`), `api/index.ts` (`CodingFilterContext`).
**Do:** Define `ProjectDetail`,`AttributeRow`,`CodingFilterContext`,`SegmentScores`,`TreatmentDefinition`; import them
where currently re-declared; convert `catch (e: any)`→`unknown`+guards in touched files; enable stricter tsconfig flags
if low-risk.
**Verify:** `tsc --noEmit` clean.
**Commit:** `refactor(types): centralize shared domain types [S1.2]`

### S1.3 — `riskColors` + `projection` utils  · Done: 2026-07-03
**Context to load:** `frontend/src/constants/colorConstants.ts`; the 3 inline `to4326` copies in
`PathAnalysisMapView.tsx`, `GeoDataPanel.tsx`, `reportBuilderPage.tsx`.
**Do:** `utils/riskColors.ts` (reuse `colorConstants.ts`, export `RISK_COLORS`/`RISK_LABELS`); `utils/projection.ts`
(single `to4326`/`to3414`). Replace inline copies with imports.
**Verify:** Segment colors + map coords visually unchanged (Regression Checklist items 3).
**Commit:** `refactor(utils): extract shared risk-color and projection helpers [S1.3]`

### S1.4 — Shared map components  · Done: 2026-07-03
**Context to load:** `DraggableMarker`/`PolygonDrawingTool`/`isPointInPolygon` in `PathAnalysisMapView.tsx` &
`GeoDataPanel.tsx`.
**Do:** Create `frontend/src/components/map/DraggableMarker.tsx` + `PolygonDrawing.tsx`; replace both copies.
**Verify:** Polygon draw + marker drag work on both pages.
**Commit:** `refactor(map): extract shared DraggableMarker and PolygonDrawing [S1.4]`

### S1.5 — VOID
The Treatment/Analysis `AttributesDropdown` copies were dead code (deleted in S0.2); only
`PathAnalysisPage/components/AttributesDropdown.tsx` remains and is already single. No unification needed.

### S1.6 — `useSessionState` + key namespace  · Done: 2026-07-03
**Context to load:** `CLAUDE.md` (sessionStorage keys), grep `sessionStorage`/`localStorage` (~58 sites).
**Do:** `hooks/useSessionState.ts` (typed JSON get/set), `constants/sessionKeys.ts` (`SESSION_KEYS` — no magic
strings). Migrate `pathAnalysisMap_*`, `pathAnalysis_*`, `codingFilterContext`, `gisLayerToggles_*`. Preserve exact key
strings to keep existing user sessions valid.
**Note (2026-07-03, post-v2 merge):** `CreateProjectPage/folderSummaryCache.ts` (new from main) uses
**localStorage** with its own key — register that key in the central registry (e.g. a parallel `LOCAL_KEYS`)
for discoverability, but do **not** rewrite the file itself; it's fresh working main code. Also per
`frontend/CLAUDE.md`, layout shells may never touch sessionStorage — `useSessionState` consumers must be
containers/hooks.
**Verify:** Viewport restore + filter persistence + filter-color context all survive back-nav (Regression items 1,2,4).
**Commit:** `refactor(state): add useSessionState hook and typed session keys [S1.6]`

### S2.1–S2.5 — Monolith decomposition (one file per session)  · Done: ____ each
**Goal (all):** Turn each page into a thin orchestrator by extracting hooks (data/state) + sub-components along seams.
No behavior change. After each extraction: build + manual smoke + commit.

**v2-seam constraint (all — re-scoped 2026-07-03, see CONTEXT):** extractions must respect the
`frontend/CLAUDE.md` container/shell rules. Extracted data/state hooks live in (and are called from) the
**container** page file; `*LayoutV1/V2.tsx` shells remain pure functions of the `*ViewModel.ts` — never move
fetching, server state, or sessionStorage into a shell. Keep each page's ViewModel interface intact (callbacks
may be re-wired to new hooks, but the shell-facing contract must not change shape without updating both layouts).

- **S2.1 PathAnalysisMapView** — **Graph tools first:** `get_impact_radius_tool` on `PathAnalysisMapView.tsx`;
  `query_graph_tool(pattern="callers_of")` on each inline helper being pulled into a hook (GIS layer toggle logic,
  filter state, viewport persistence) to confirm no external caller is missed before it moves. **Then extract:**
  `useGISLayerToggles`, `useFilterState`, `useViewportPersistence`, `<GISLayerControls>`, `<FilterPanel>`,
  map-event hooks. **Shared heavy component with gated `variant="v2"`** (plus `filtersPortalTarget` /
  `MaybePortal`) — preserve the variant gating and verify BOTH render paths (v1 and v2 chrome).
- **S2.2 GeoDataPanel** — **Graph tools first:** `get_impact_radius_tool` on `GeoDataPanel.tsx` — it should
  surface the Treatment Before/After callers directly (confirm the graph finds them, rather than relying solely
  on this written reminder). **Then extract:** `useGISToggleState`, `useCurvatureOverlay`,
  `useWidthVisualization`, `<DefectsLayer>`. **Shared heavy component with gated `variant="v2"`** (floating tool
  cluster, `MapAutosize`) — same both-paths rule. Also consumed by Treatment's Before/After map panels; smoke
  those too.
- **S2.3 codingPage** — **Graph tools first:** `get_impact_radius_tool` on `codingPage.tsx`;
  `query_graph_tool(pattern="callers_of")` on `CodingViewModel`'s exported members to verify the shell-facing
  contract shape stays intact after extraction. **Then decompose** the **container** (`CodingLayoutV1/V2.tsx` +
  `CodingViewModel.ts` already exist): `useProjectDataCache`, `useFilterContext`, `useAutocode`,
  `useAttributeEditing`. Keep the `CodingViewModel` contract intact.
- **S2.4 treatmentDetailPage** — **Graph tools first:** `query_graph_tool(pattern="callers_of")` on
  `resolveIndex`/`projectMap` before extracting `useProjectMapping`; `get_impact_radius_tool` on
  `treatmentDetailPage.tsx`. **Then extract:** much of the old scope was done by the v2 split
  (`TreatmentDetailLayoutV1/V2.tsx` + `TreatmentViewModel.ts`; container is now 1,387 lines). Remaining: extract
  `useProjectMapping` (resolveIndex/projectMap), `useTreatmentEngine`, `useTreatmentState`/`useTreatmentAnalysis`
  from the container. Fix the deferred pre-existing errors here: unused `TREATMENTS` import (line 38) and
  missing `Treatment` type import (line 176).
- **S2.5 reportBuilderPage** — **Graph tools first:** `get_impact_radius_tool` + `get_affected_flows_tool` on
  `reportBuilderPage.tsx` — this file is the largest and most tangled with no existing seam, so understanding
  affected flows matters more here than a single-symbol caller lookup. **Then extract:** `useReportData`,
  `usePDFExport`, `useReportLayout`, per-domain `<ReportSection*>`. No v2 layout exists for this page yet (it
  grew to 3,346 lines) — structure the decomposition as container + view-model per `frontend/CLAUDE.md` so a
  future `ReportBuilderLayoutV2` can slot in.

**Context to load (each):** run this session's **Graph tools first** call (leading sentence of its bullet
above) BEFORE opening any file — it is part of loading context, not an optional extra step. Then load: the
target file + `CLAUDE.md` + **`frontend/CLAUDE.md` (mandatory — §0 protocol)** + the page's
`layouts/*ViewModel.ts` (if present) + hooks/components from Phase 1.
**Verify (each):** frontend gate + `detect_changes_tool` + full Regression Checklist for that page's flows
(including checklist item 7 — both layout variants render).
**Commit (each):** `refactor(<page>): decompose into hooks and sub-components [S2.x]`

### S3.1 — `@with_project` decorator  · Done: 2026-07-03
**Context to load:** `backend/app/api/projects/routes.py` (the `get_ctx()`→`pm`→`project`→`latest` + try/except→JSON
pattern, ~40 sites).
**Do:** Decorator injecting `(pm, proj, ver)` and standardizing exception→JSON. Apply incrementally; keep responses
byte-identical.
**Verify:** Hit a representative endpoint of each kind; responses unchanged.
**Commit:** `refactor(backend): add @with_project decorator and standardize error handling [S3.1]`

### S3.2 — Split `routes.py`  · Done: 2026-07-03
**Context to load:** `routes.py`, `backend/app/api/projects/__init__.py`.
**Do:** Convert `projects/` into a package of blueprints: `crud.py`, `autocode.py`, `segments.py`, `images.py`,
`source_folders.py`, `gis_queries.py`, `export.py`, `baseline.py`. Move private helpers to service functions. Keep URL
routes identical (register all blueprints).
**Verify:** Every route still registered (`flask routes`-equiv / boot log); smoke each group.
**Commit:** `refactor(backend): split projects routes.py into blueprint modules [S3.2]`

### S3.3 — `logging` over `print()`  · Done: 2026-07-04
**Context to load (run this first, before opening any file):** `semantic_search_nodes_tool` for `print(` call
sites across the 14 files named in S3.2's NOTES FOR NEXT — one call gets file+context instead of a flat grep pass.
**Do:** Configure a logger; replace ~68 `print()` with leveled logs. Preserve any user-facing stdout the app relies on.
**Verify:** Boot, run an autocode, confirm logs emit; `detect_changes_tool` on the diff.
**Commit:** `refactor(backend): replace print with logging [S3.3]`

### S3.4 — Extract Curvature/Width analyzers  · Done: 2026-07-05
**Context to load (run the graph queries first, before opening the files):** `query_graph_tool(pattern="callers_of")`
on the curvature/width methods in `gis_mapping.py` BEFORE moving them out, so every internal and external caller is
known ahead of the `GIS`-class delegation; `get_impact_radius_tool` on `gis_mapping.py`. Then open:
`backend/app/services/gis_mapping.py` (curvature ~900 lines; width logic), `backend/app/utils/path_width_curvature.py`.
**Do:** Move curvature → `services/curvature_analyzer.py` (`CurvatureAnalyzer`); width → `services/width_analyzer.py`.
`GIS` class delegates. Keep numeric outputs identical (spot-check against a known segment).
**Verify:** `backend/test_curvature_analysis.py` still passes; compare curvature/width on a sample project;
`detect_changes_tool` on the diff.
**Commit:** `refactor(gis): extract CurvatureAnalyzer and WidthAnalyzer [S3.4]`

### S3.5 — `query_nearby()` + unify proximity  · Done: ____
**Context to load (run the graph query first):** `semantic_search_nodes_tool` to enumerate the ~8 proximity-check
methods (`is_mrt`, `is_bus_lane`, …) as extraction targets, instead of manually reading the file. Then open:
`gis_mapping.py` proximity methods (`is_mrt`/`is_bus_lane`/… ) + buffer/sindex/distance repeats.
**Do:** Add `query_nearby(layer, point, buffer, max_dist)`; route the 8 near-identical proximity checks + ~20 repeated
patterns through it.
**Verify:** GIS autocode results unchanged on a sample project; `detect_changes_tool` on the diff.
**Commit:** `refactor(gis): add query_nearby helper and unify proximity checks [S3.5]`

### S3.6 — Split `project_manager.py`  · Done: ____
**Context to load (run the graph queries first, before opening the file):** `get_impact_radius_tool` on
`project_manager.py`; `query_graph_tool(pattern="callers_of")` on `ProjectVersion`'s methods before splitting
data/serialization/defaults concerns. Then open: `backend/app/services/project_manager.py`.
**Do:** Split `ProjectVersion` into data/serialization/defaults concerns; move image dedup/materialization to
`services/image_storage.py`. Keep public API of `project_manager` stable.
**Verify:** Create/open/list project + image dedup still work; `detect_changes_tool` on the diff.
**Commit:** `refactor(backend): modularize project_manager and extract image_storage [S3.6]`

### S3.7 — Organize backend tests  · Done: ____
**Context to load (run this first):** `query_graph_tool(pattern="tests_for")` to confirm the current
test↔code coverage mapping before moving files, so nothing silently stops being collected after the move.
**Do:** Move the ~24 root `backend/test_*.py` into `backend/tests/` + add `conftest.py` + `pytest.ini`. **Move only,
do not rewrite** (per scope). Drop obviously-dead dependency-probe scripts (confirm via run first).
**Verify:** `cd backend && pytest` collects from `tests/`.
**Commit:** `chore(backend): consolidate tests into tests/ directory [S3.7]`

### S3.8 — Type-hint pass  · Done: ____
**Context to load:** no graph query required — no code is moved or extracted this session (hints only); note
this explicitly in the SESSION LOG's `GRAPH USAGE` field as `n/a` rather than skipping the field.
**Do:** Add param/return hints to `routes.py` + `project_manager.py`; add `TypedDict`s for common payloads. No logic
change.
**Verify:** Optional `mypy`/boot; gate passes.
**Commit:** `refactor(backend): add type hints to routes and project_manager [S3.8]`

### S4.1 — End-to-end manual QA  · Done: ____
**Context to load (run this first, before any manual click-through):** `detect_changes_tool` +
`get_affected_flows_tool` across the full accumulated branch diff, to risk-rank which flows to test first.
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
7. **Both layout variants render:** for any page whose container/ViewModel was touched, both `*LayoutV1` and
   `*LayoutV2` still render and interact correctly (the v1/v2 switch must not break either path).

---

## DEFERRED FINDINGS (bugs/oddities spotted mid-refactor — do NOT fix inline)
- 2026-07-02 · S0.5 · `serializer.py:475` opens `config.json` with a bare relative path (`open("config.json")`), making it CWD-dependent. Works today because the app always runs from `backend/`, but fragile. Should switch to `get_full_path("config.json")` in a later session.
- 2026-07-03 · S1.2 · `treatmentDetailPage.tsx`: `TREATMENTS` is imported but never used (line 38); `Treatment` type is used at line 176 (`new Map<number, Treatment>()`) but not imported. Both are pre-existing errors in the 37-error baseline. Fix inline when decomposing this file in S2.4. (Line numbers re-verified 2026-07-03 after the v2 merge from main; baseline still 37.)
- 2026-07-05 · S3.4 · `gis_mapping.py` had `_remove_z_coordinate` defined **twice** on the old `GIS` class (former lines 220 and 2519); the second silently shadowed the first, so only the 2519 version was ever live. S3.4 moved the live (2519) copy into `CurvatureAnalyzer` alongside `_load_path_layer`; the dead 220 copy was left verbatim in `GIS` (now ~line 203) to keep the refactor behavior-preserving. It is unreferenced dead code and can be deleted in a later cleanup (e.g. S3.5/S3.8).
- 2026-07-05 · S3.4 · `test_curvature_analysis.py` has **6 pre-existing failures** unrelated to the curvature/width logic itself: 4 reference `routes.autocode_gis` / `routes.get_curvature_visualization`, which moved out of `routes.py` during the S3.2 blueprint split (now in `app/api/projects/autocode.py` / `gis_queries.py`) and were never updated; 2 (`…uses_tight_bucket_for_sub_6_5m_radius`, `…uses_numeric_bucket_when_sharp_radius_and_junction_both_exist`) assert `has_path_junction is True` but get `False`. All 6 fail identically before and after S3.4. The 4 stale-route ones should be repointed when S3.7 organizes backend tests; the 2 junction-logic ones need a separate look (possible real logic drift — do NOT fix inline).

## SESSION LOG STANDARD (mandatory template for every entry)

Each completed session must produce one entry in the SESSION LOG below. The entry must cover every
field in this template. Skip a field only if it is genuinely not applicable (e.g. no files deleted)
— do NOT omit because it's hard to fill in.

```markdown
- YYYY-MM-DD · <tag> · <one-sentence summary of what was accomplished>
  FILES CREATED:   <list each new file with its initial line count>
  FILES DELETED:   <list each removed file and why>
  FILES MOVED:     <old path → new path (via git mv, or note if logical move only)>
  FILES MODIFIED:  <list each edited file; for large files note before→after line count>
  SYMBOLS MOVED/EXTRACTED: <function/hook/class name, from file → to file, caller count>
  IMPORT SITES UPDATED: <N files had imports rewritten; list or summarise the pattern>
  GRAPH USAGE:     <graph tool(s) called, target symbol/file, and key findings — e.g. "get_impact_radius_tool
                   on X.tsx: 4 callers, 0 external"; "query_graph_tool(callers_of) on Y(): confirmed no
                   callers outside this file"; or "n/a — no code moved/extracted this session">
  BUILD GATE:      TSC <before> → <after> errors; lint <before> → <after>; build <PASS|FAIL>
  REGRESSION CHECK: <list which checklist items (1–7) were manually verified, or "n/a">
  ARCHITECTURAL DECISIONS: <any non-obvious choices made during the session — e.g. why a
                   particular extraction boundary was chosen, a trade-off accepted, an
                   alternative rejected. If none: "none — straightforward extraction.">
  DEFERRED:        <anything bumped to DEFERRED FINDINGS, with cross-ref to line, or "none">
  NOTES FOR NEXT:  <anything the next chat must know before touching related files>
```

**Why comprehensive entries matter:** a fresh Claude Code chat starts with zero context. A thorough
log entry is the primary way prior decisions (what was moved, what was consciously left, what
surprised us) survive across sessions. Terse one-liners cause the next chat to re-derive decisions
we already made — wasting tokens and risking conflicting choices. The same applies to `GRAPH USAGE`:
a caller count or impact radius re-derived by hand every session wastes tokens the graph already
gives for free — record what you found so the next session doesn't re-query from scratch.

---

## SESSION LOG (one entry per completed session — follow SESSION LOG STANDARD above)

- 2026-07-02 · setup · established `xh_dev` branch with baseline tag and wrote the initial REFACTOR_PLAN.md playbook.
  FILES CREATED:   `REFACTOR_PLAN.md` (376L) — the resumable session playbook
  FILES DELETED:   none
  FILES MOVED:     none
  FILES MODIFIED:  `.gitignore` — added `!REFACTOR_PLAN.md` exception (overrides the global `*.md` ignore rule)
  SYMBOLS MOVED/EXTRACTED: n/a
  IMPORT SITES UPDATED: n/a
  BUILD GATE:      not run (no code touched)
  REGRESSION CHECK: n/a
  ARCHITECTURAL DECISIONS: `*.md` was globally ignored; `!REFACTOR_PLAN.md` exception keeps it tracked without
                   opening up all markdown files. Baseline tag `pre-refactor-baseline` created at `9822f228` as
                   the full-rollback anchor.
  DEFERRED:        none
  NOTES FOR NEXT:  S0.1 through S0.7 can all run independently; no ordering dependency between them.

- 2026-07-02 · S0.1 · removed 30 tracked junk files (build/log artifacts + root scratch scripts) and tightened `.gitignore` with artifact globs.
  FILES CREATED:   n/a (REFACTOR_PLAN.md was already created in setup; added to this commit)
  FILES DELETED:   30 files (~4,287 lines deleted):
                   - Build/log artifacts (18): `batch_output.txt`, `logs.txt`, `output.txt`, `pytest_out.txt`, `test.txt`,
                     `overlaps_report.txt`, `overlaps_results.txt`, `frontend/backend_compile.{err,out}`,
                     `frontend/build_{errors,log,output,result}.txt`, `frontend/vite_build.{err,out}`,
                     `backend/autocode_debug.txt`, `backend/scripts.zip`,
                     `backend/Documentation/MIGRATION_COMPARISON.txt`
                   - Root scratch scripts (12): `debug_script.py` (61L), `exec_task.py` (46L), `final_check.py` (53L),
                     `inspect_data.py` (21L), `backend/inspect_data.py` (53L), `inspect_curvature.py` (47L),
                     `inspect_curvature_v2.py` (47L), `patch_geodata_panel.py` (192L), `task_run.py` (28L),
                     `test_script.py` (22L), `generate_draft_slides.py` (223L)
  FILES MOVED:     none
  FILES MODIFIED:  `.gitignore` (+12L): added `*_log.txt`, `*.out`, `*.err`, `build_*.txt`, `autocode_debug.txt`,
                   `scripts.zip`; added `!REFACTOR_PLAN.md` exception; also `.gitignore` for `REFACTOR_PLAN.md`
                   (session written with plan file)
  SYMBOLS MOVED/EXTRACTED: n/a
  IMPORT SITES UPDATED: n/a
  BUILD GATE:      backend `python -c "import app"` OK; no frontend gate (no source touched)
  REGRESSION CHECK: n/a — only junk files removed, no app code changed
  ARCHITECTURAL DECISIONS: Added glob rules (`*_log.txt` etc.) rather than listing filenames, to prevent
                   recurrence. Dev utilities and `backend/test_*.py` intentionally excluded — deferred to S0.4/S3.7
                   per inventory decision.
  DEFERRED:        dev utility scripts (S0.4); `backend/test_*.py` (S3.7)
  NOTES FOR NEXT:  S0.2 can run independently. Re-run reachability script before deleting any FE module.

- 2026-07-02 · S0.2 · deleted 21 confirmed-dead frontend modules and 4 companion CSS files (25 files, ~5,804 lines).
  FILES CREATED:   none
  FILES DELETED:   25 files (~5,804 lines):
                   - Dead pages: `pages/AnalysisPage/` (analysisPage.tsx 239L, components/AttributesDropdown.tsx 194L,
                     components/MapView.tsx 45L); `pages/PostTreatmentAnalysisPage/postTreatmentAnalysisPage.tsx` (207L);
                     `pages/PreTreatmentAnalysisPage/preTreatmentAnalysisPage.tsx` (206L); `pages/Home/home.tsx` (241L)
                     + `home.css` (205L); `pages/ShapefileManagement/` (ShapefileManagementPage.tsx 230L,
                     AddShapefileView.tsx 225L, ReplaceShapefileView.tsx 329L, UploadModal.tsx 110L)
                   - Dead Treatment components: `TreatmentPage/components/AttributesDropdown.tsx` (320L),
                     `MapView.tsx` (45L), `TreatmentMapView.tsx` (198L)
                   - Orphaned viz: `components/visualization/AnalysisPanel.tsx` (388L);
                     `curvature/CurvatureDiagnostics.tsx` (175L) + `.css` (492L),
                     `CurvatureVisualization.tsx` (169L), `CurvatureVisualizationPanel.tsx` (221L) + `.css` (279L);
                     `scoreband/ScoreBandDistributionPanel.tsx` (240L);
                     `width/WidthSearchDiagnostics.tsx` (137L), `WidthVisualization.tsx` (137L),
                     `WidthVisualizationPanel.tsx` (189L) + `.css` (581L)
  FILES MOVED:     none
  FILES MODIFIED:  `REFACTOR_PLAN.md` (+3L: session note)
  SYMBOLS MOVED/EXTRACTED: n/a
  IMPORT SITES UPDATED: n/a (deleted modules were not imported anywhere live)
  BUILD GATE:      `tsc --noEmit` clean; `npm run build` errors all pre-existing (confirmed via stash comparison
                   showing identical error list before/after)
  REGRESSION CHECK: n/a — dead code only; every live route still renders
  ARCHITECTURAL DECISIONS: Kept 3 CSS files that appeared to belong to deleted modules but were actually still
                   imported by live code (`AnalysisPanel.css` → `AnalysisSidebar.tsx` + `codingPage.tsx`;
                   `shapefileManagement.css` → `ShapefileModal.tsx`; `ScoreBandDistributionPanel.css` →
                   `AggregatedScoreBandPanel.tsx` + `AggregatedTopContributorsPanel.tsx`). Verified via grep before
                   each deletion.
  DEFERRED:        none
  NOTES FOR NEXT:  S1.5 (unify 3 AttributesDropdowns) is now **VOID** — 2 of the 3 copies were in the deleted
                   modules; only `PathAnalysisPage/components/AttributesDropdown.tsx` remains.

- 2026-07-02 · S0.3 · archived 39-file `scratch/` directory to `~/psat_scratch_archive/` and removed it from the repo.
  FILES CREATED:   none
  FILES DELETED:   41 files (~8,180 lines):
                   - 13 guide-building scripts (`build_*.py`, `create_guides.py`, `generate_user_word_doc.py`,
                     `generate_word_doc.py`, `inject_tocs.py`, `reformat_guides.py`, `update_*.py`)
                   - 12 extraction/inspection scripts (`dump_all_details.py`, `extract_*.py`, `inspect_docx_zip.py`,
                     `read_docx*.py`, `search_all_docx_comments.py`)
                   - 8 raw output text dumps (`feedback_and_guides_extracted.txt` 2151L, `guide_structures.txt` 1817L,
                     `docx_full_text.txt`, `pptx_analysis_raw.json` 518L, `pptx_shapes_full_dump.txt` 163L,
                     `word_xml_raw.txt`)
                   - 6 miscellaneous (`check_shp_cols*.py`, `test2.py`, `test_smooth.py`, `test_upload.py`,
                     `verify_gis*.py`)
  FILES MOVED:     scratch/ → `~/psat_scratch_archive/` (external, outside repo)
  FILES MODIFIED:  `.gitignore` (+1L: `scratch/`); `REFACTOR_PLAN.md` (+3L)
  SYMBOLS MOVED/EXTRACTED: n/a
  IMPORT SITES UPDATED: n/a
  BUILD GATE:      not run (tooling scripts only, no app code touched)
  REGRESSION CHECK: n/a
  ARCHITECTURAL DECISIONS: Archive location `~/psat_scratch_archive/` chosen as outside-repo. Copy was
                   diff-verified clean before `git rm`. Added `scratch/` to `.gitignore` to prevent accidental
                   re-creation being tracked.
  DEFERRED:        none
  NOTES FOR NEXT:  none

- 2026-07-02 · S0.4 · relocated 6 tracked dev utility scripts to `scripts/` via `git mv`; promoted 2 previously-ignored visualize scripts; fixed all relative path references.
  FILES CREATED:   `scripts/replace_tiles.py` (41L, was `frontend/replace_tiles.py`);
                   `scripts/visualize_obstacles.py` (119L, promoted from .gitignored);
                   `scripts/visualize_width_restriction.py` (276L, promoted from .gitignored)
  FILES DELETED:   `frontend/replace_tiles.py` (37L, replaced by scripts/ copy)
  FILES MOVED (via git mv):
                   `backend/extract_xml_dates.py` → `scripts/extract_xml_dates.py`
                   `backend/generate_road_reference.py` → `scripts/generate_road_reference.py`
                   `backend/generate_user_guide_pdf.py` → `scripts/generate_user_guide_pdf.py`
                   `backend/setup_test_project.py` → `scripts/setup_test_project.py`
                   `backend/visualize_facility_width.py` → `scripts/visualize_facility_width.py`
  FILES MODIFIED:  `.gitignore` (-2L: removed `visualize_obstacles.py` and `visualize_width_restriction.py`
                   filename-only ignore rules); path fixups applied to 4 moved scripts:
                   `generate_road_reference.py`, `generate_user_guide_pdf.py`, `setup_test_project.py`,
                   `visualize_facility_width.py` — changed `Path(__file__).parent` → `Path(__file__).resolve().parent.parent / "backend"`
                   so scripts work when run from `scripts/` rather than from `backend/`
  SYMBOLS MOVED/EXTRACTED: n/a
  IMPORT SITES UPDATED: 0 — grep confirmed none of the moved scripts are imported by `backend/app/**`
  BUILD GATE:      backend `python -c "import app"` OK; no frontend gate
  REGRESSION CHECK: n/a
  ARCHITECTURAL DECISIONS: `replace_tiles.py` had no relative path references so needed no fixup. The two
                   visualize scripts were .gitignored individually by filename; those rules were removed and the
                   files promoted to tracked entries in `scripts/` so they benefit from version control.
  DEFERRED:        none
  NOTES FOR NEXT:  none

- 2026-07-02 · S0.5 · deleted the root `config.json` (dead duplicate of `backend/config.json`); documented canonical config location.
  FILES CREATED:   none
  FILES DELETED:   `config.json` (root, 9L) — confirmed dead: all `get_full_path()` calls resolve to
                   `backend/config.json`; Docker only copies `backend/` into the container image
  FILES MOVED:     none
  FILES MODIFIED:
    `backend/app/config.py` — translated Chinese inline comment to English (1 line)
    `backend/app/services/cycleRAP_VA.py` — added full docstring to `get_full_path()` (+12L) documenting
                   `backend/config.json` as the canonical location and explaining Docker resolution
  SYMBOLS MOVED/EXTRACTED: none (get_full_path() already existed; docstring added, not moved)
  IMPORT SITES UPDATED: n/a
  BUILD GATE:      backend `python -c "import app"` + manual server boot OK; config values unchanged
  REGRESSION CHECK: n/a — config values unchanged; root file was never read
  ARCHITECTURAL DECISIONS: Canonical choice is `backend/config.json` because: (1) all `get_full_path()` callers
                   resolve relative to `backend/`; (2) `docker-compose.yml` copies only `backend/` into `/app/`.
                   The docstring in `get_full_path()` is the authoritative declaration of this decision so future
                   readers don't re-discover it.
  DEFERRED:        `serializer.py:475` — bare `open("config.json")` is CWD-dependent (works today because app
                   always runs from `backend/` but will silently break if CWD changes). Should use `get_full_path()`.
  NOTES FOR NEXT:  none

- 2026-07-02 · S0.6 · consolidated three doc trees into `docs/` as canonical source; eliminated `backend/Documentation/`; added `scripts/sync_docs.sh` + `npm run docs:sync`.
  FILES CREATED:
    `scripts/sync_docs.sh` (32L) — rsync `docs/{user,admin,developer}/` → `frontend/public/docs/`; excludes `archive/`
    `docs/developer/api-reference.md` (232L), `docs/developer/cv-pipeline.md` (212L),
    `docs/developer/cyclerap_v213_audit.md` (236L), `docs/developer/dev-jira.md` (130L),
    `docs/developer/installation.md` (243L), `docs/developer/README.md` (17L)
    `docs/developer/gis/` (9 files, content moved from `backend/Documentation/`)
    `docs/archive/gis/` (5 historical migration summary files, 0L placeholder stubs)
    `docs/user/` (12 files moved from `frontend/public/docs/user/`)
    `docs/admin/` (7 files moved from `frontend/public/docs/admin/`)
    `frontend/public/docs/developer/gis/` (9 new GIS implementation docs, ~3,700L combined)
    `frontend/public/docs/developer/platform-compatibility.md` (105L)
    `frontend/public/docs/developer/cyclerap_v213_audit.md` (236L)
  FILES DELETED:
    9 stale root `docs/*.md` duplicates (`api-reference.md` 783L, `cv-pipeline.md` 273L, `installation.md` 220L, etc.)
    `backend/Documentation/` directory (16 files, moved to `docs/developer/gis/` or `docs/archive/gis/`)
    `frontend/public/docs/user/`, `frontend/public/docs/admin/`, `frontend/public/docs/developer/` (source copies,
                   replaced by mirror generated by sync script)
  FILES MOVED:     `frontend/public/docs/{user,admin,developer}/` → `docs/{user,admin,developer}/` (canonical)
                   `backend/Documentation/CURVATURE_*/FACILITY_WIDTH_*/ROAD_*` → `docs/developer/gis/`
                   Historical migration notes → `docs/archive/gis/`
  FILES MODIFIED:  `docs/README.md` (+55L): updated to describe new tree layout and sync workflow
                   `docs/developer/architecture.md`, `contributing.md`, `common-issues.md`, `frontend.md`,
                   `scoring.md`, `treatments.md` — moved from root `docs/` with minor link fixes
                   `frontend/package.json` (+3L): added `"docs:sync"` npm script
                   `.gitignore` (+3L): added `!docs/**` exception to allow docs tree to be tracked
  SYMBOLS MOVED/EXTRACTED: n/a
  IMPORT SITES UPDATED: n/a (HelpPage fetches from `/docs/...` paths; `frontend/public/docs/` mirror verified)
  BUILD GATE:      all 21 HelpPage doc paths verified reachable; no frontend build gate run (docs only)
  REGRESSION CHECK: n/a — in-app Help still loads; sync verified identical content for pre-existing user/admin/developer files
  ARCHITECTURAL DECISIONS: `docs/` is canonical; `frontend/public/docs/` is a generated mirror — never edit the
                   mirror directly. `archive/` subtree excluded from sync (historical notes, not in-app content).
                   `backend/Documentation/` entirely eliminated; actionable GIS docs folded into
                   `docs/developer/gis/`, purely-historical migration notes into `docs/archive/gis/`.
  DEFERRED:        `.docx` guide files left as-is per user decision (skip docx cleanup).
  NOTES FOR NEXT:  After any edit under `docs/`, run `npm run docs:sync` (or `bash scripts/sync_docs.sh`)
                   from repo root, then commit both `docs/` and `frontend/public/docs/` together.

- 2026-07-02 · S0.7 · baseline English-only comment sweep: translated 38 Chinese comments/docstrings across 8 files; zero CJK characters remain in source comments.
  FILES CREATED:   none
  FILES DELETED:   none
  FILES MOVED:     none
  FILES MODIFIED:
    `backend/requirements.txt` — 5 Chinese comment lines translated (torch/CUDA wheel selection notes)
    `backend/app/services/gis_mapping.py` — 12 inline comments + 1 exception message translated
    `backend/app/services/serializer.py` — 3 comments translated
    `backend/app/services/project_manager.py` — 1 comment translated
    `frontend/src/api/index.ts` — 5 comments translated
    `frontend/src/pages/CodingPage/components/GeoDataPanel.tsx` — 11 comments translated
    `frontend/src/pages/Projects/layouts/ProjectsDialogs.tsx` — 1 comment translated
    `frontend/src/pages/LandingPage/landingPage.tsx` — 1 comment translated
  SYMBOLS MOVED/EXTRACTED: n/a
  IMPORT SITES UPDATED: n/a
  BUILD GATE:      backend `python -c "import app"` OK; frontend build errors all pre-existing
  REGRESSION CHECK: n/a — comment-only changes; no runtime behavior touched
  ARCHITECTURAL DECISIONS: Non-CJK non-ASCII characters (arrows `→`, en-dashes `–`, box-drawing `─`) are
                   intentional English typography and were left as-is. Only `comments/docstrings` translated —
                   genuine data strings and UI copy left alone. Verified by re-running `grep -rnP "[^\x00-\x7F]"`
                   after the sweep.
  DEFERRED:        none
  NOTES FOR NEXT:  Per-file translation during later sessions handled by the global guardrail ("English only").
                   The S0.7 pass is the one-time baseline only.

- 2026-07-02 · S1.1 · split the 1,596-line `api/index.ts` monolith into 9 domain modules + a re-export barrel; zero call-site churn.
  FILES CREATED:
    `frontend/src/api/_client.ts` (~21L net): `readError()` shared fetch-error helper
    `frontend/src/api/projects.ts` (~349L): project CRUD + all shared types (`ProjectListItem`, `FileResponse`,
                   `ProjectDetail`, `AttributeRow`, `AttributesResponse`, `AttrMappings`, `FilteredSegmentPoint`,
                   `FilteredProjectData`, `FilterLegendEntry`, `CodingFilterContext`, `CalculateScoreResult`)
    `frontend/src/api/geo.ts` (~134L): GeoJSON fetch, segment add/delete
    `frontend/src/api/sourceFolders.ts` (~204L): source folder listing and management
    `frontend/src/api/autocode.ts` (~226L): autocode by image, by GIS, bulk autocode endpoints
    `frontend/src/api/treatments.ts` (~270L): treatment CRUD, apply, reset, effectiveness analysis
    `frontend/src/api/shapefiles.ts` (~228L): shapefile import, delete, reproject, list
    `frontend/src/api/auth.ts` (~273L): login, logout, user management, profile management
    `frontend/src/api/media.ts` (~41L): image serving and thumbnail generation
    `frontend/src/api/reports.ts` (~49L): report generation and segment-details endpoint
  FILES DELETED:   none (content moved into new files)
  FILES MOVED:     n/a (logical move; `index.ts` rewritten as barrel)
  FILES MODIFIED:
    `frontend/src/api/index.ts`: 1,596L → 31L — now a pure re-export barrel (`export * from "./..."`)
    `frontend/src/api/projectDataCache.ts`: 3 imports updated from `./index` → `./projects` directly
                   (avoids barrel, eliminates potential circular-import risk)
  SYMBOLS MOVED/EXTRACTED: all ~65 exported functions + 15 types from `api/index.ts` distributed across
                   domain modules; `index.ts` re-exports all of them so existing import paths unchanged
  IMPORT SITES UPDATED: 0 — barrel pattern means no call site needed to change; verified by build passing clean
  BUILD GATE:      `tsc --noEmit` clean; `npm run build` error count unchanged at 37 (0 new errors)
  REGRESSION CHECK: n/a (no UI logic changed); barrel compatibility verified by clean build
  ARCHITECTURAL DECISIONS: Kept `index.ts` as a re-export barrel rather than deleting it — prevents mass
                   find-replace across every consumer. `projectDataCache.ts` updated to import directly from
                   `./projects` (not via barrel) to reduce coupling. `CalculateScoreResult.result_rows` kept
                   as `any[]` matching the original — narrowing deferred to S1.2 to avoid cascading errors.
                   All new files carry module-level `/** … */` TSDoc headers and per-function TSDoc.
  DEFERRED:        `CalculateScoreResult.result_rows: any[]` → narrow to `unknown[]` in S1.2
  NOTES FOR NEXT:  S1.2 types centralization should import from `api/projects` (not barrel) to avoid cycles.

- 2026-07-03 · S1.2 · centralized 10 shared domain types into `types/index.ts`; removed 3 duplicate declarations; converted 17 `catch (e: any)` to typed guards.
  FILES CREATED:
    `frontend/src/types/index.ts` (35L): re-export barrel for 10 shared API types; was previously an empty file
  FILES DELETED:   none
  FILES MOVED:     none
  FILES MODIFIED:
    `frontend/src/pages/CodingPage/codingConstants.ts`: removed duplicate `ProjectDetail` + `AttrMappings`
                   declarations; now imports from `api/projects`
    `frontend/src/pages/TreatmentPage/treatmentConstants.ts`: removed duplicate `ProjectDetail` +
                   `AttributesResponse`; now imports from `api/projects`
    `frontend/src/pages/CodingPage/codingPage.tsx`: removed local `AttributesResponse` interface; imported from
                   `api` barrel; converted 15 `catch (e: any)` → `catch (e: unknown)` with `instanceof Error`
                   guards or bare `catch {}`
    `frontend/src/pages/TreatmentPage/treatmentDetailPage.tsx`: converted 2 `catch (e: any)` → `catch (e: unknown)`
  SYMBOLS MOVED/EXTRACTED: `ProjectDetail`, `AttrMappings` (removed from `codingConstants.ts` → canonical in
                   `api/projects.ts`); `ProjectDetail`, `AttributesResponse` (removed from `treatmentConstants.ts`
                   → canonical in `api/projects.ts`)
  IMPORT SITES UPDATED: 3 files had type imports rewritten (`codingConstants.ts`, `treatmentConstants.ts`,
                   `codingPage.tsx`)
  BUILD GATE:      TSC errors unchanged at 37 (all pre-existing); lint errors 396 → 374 (−22, from removed
                   `any` annotations); `npm run build` clean
  REGRESSION CHECK: n/a — types only; no runtime logic changed
  ARCHITECTURAL DECISIONS: `types/index.ts` is a re-export barrel, not a type definition file — types stay
                   co-located with the module that owns them. Rule documented in `types/index.ts` header: only
                   add to the barrel when a type is needed by 3+ unrelated modules.
  DEFERRED:        `treatmentDetailPage.tsx` line 38: `TREATMENTS` unused import (pre-existing);
                   line 176: `Treatment` type used but not imported (pre-existing). Both deferred to S2.4.
  NOTES FOR NEXT:  TSC baseline is 37 errors. Any Phase 2/3 session that touches `treatmentDetailPage.tsx`
                   should fix the `TREATMENTS`/`Treatment` pre-existing errors inline (not counted against the
                   session's "zero new errors" goal).

- 2026-07-03 · S1.3 · extracted shared `to4326()` projection helper and `RISK_COLORS`/`RISK_LABELS` constants; removed 3 duplicate inline implementations.
  FILES CREATED:
    `frontend/src/utils/projection.ts` (45L): `to4326(p: Position): [number, number]` with WGS84 pass-through
                   guard (returns input unchanged if already in EPSG:4326)
    `frontend/src/utils/riskColors.ts` (31L): `RISK_COLORS: Record<number, string>` and
                   `RISK_LABELS: Record<number, string>` derived from `colorConstants.ts RISK_BAND_COLORS`
  FILES DELETED:   none
  FILES MOVED:     none
  FILES MODIFIED:
    `frontend/src/pages/CodingPage/components/GeoDataPanel.tsx` (−23L): removed inline `proj4.defs()` +
                   `to4326` block; `proj4` import retained (still used for curvature-triplet inline conversion);
                   `Position` type import removed (no longer needed)
    `frontend/src/pages/PathAnalysisPage/components/PathAnalysisMapView.tsx` (−17L): removed inline
                   `proj4.defs()` + `to4326`; removed `proj4` import and `Position` type (no longer needed here)
    `frontend/src/pages/ReportBuilderPage/reportBuilderPage.tsx` (−21L): removed inline `to4326` block and
                   local `RISK_COLORS`/`RISK_LABELS` const declarations; removed `proj4` + `Position` imports
  SYMBOLS MOVED/EXTRACTED: `to4326` (3 inline copies → `utils/projection.ts`, 3 callers);
                   `RISK_COLORS`, `RISK_LABELS` (`reportBuilderPage.tsx` → `utils/riskColors.ts`)
  IMPORT SITES UPDATED: 3 files updated to `import { to4326 } from "../../utils/projection"`;
                   `reportBuilderPage.tsx` updated to `import { RISK_COLORS, RISK_LABELS } from "../../utils/riskColors"`
  BUILD GATE:      `tsc --noEmit` clean; `npm run build` errors unchanged at 37
  REGRESSION CHECK: segment colors + map coordinates visually verified (checklist item 3)
  ARCHITECTURAL DECISIONS: The canonical `to4326` uses GeoDataPanel's version which includes a WGS84 guard
                   (returns input unchanged if already EPSG:4326). PathAnalysisMapView and reportBuilderPage
                   previously lacked this guard — the new shared version is a silent correctness improvement for
                   new projects that natively output EPSG:4326 coordinates. GeoDataPanel retains its own `proj4`
                   import for an unrelated curvature-triplet conversion that was NOT extracted (different input
                   shape, different use case).
  DEFERRED:        none
  NOTES FOR NEXT:  GeoDataPanel's curvature-triplet `proj4` usage is still inline — a future session (S2.2)
                   can extract it if needed.

- 2026-07-03 · S1.4 · extracted shared `DraggableMarker` and `PolygonDrawingTool` components from two monoliths; split `isPointInPolygon` into its own utility file.
  FILES CREATED:
    `frontend/src/components/map/DraggableMarker.tsx` (54L): `DraggableMarkerProps` + `DraggableMarker`
                   component — props: `position`, `index`, `icon`, `onDrag`, `onDragEnd`; uses `[number, number]`
                   tuples
    `frontend/src/components/map/PolygonDrawing.tsx` (133L): `PolygonDrawingToolProps` + `PolygonDrawingTool`
                   component — handles polygon vertex rendering, click-to-add, and close-polygon interaction
    `frontend/src/components/map/polygonUtils.ts` (38L): `isPointInPolygon(point, vs)` — ray-casting PIP test;
                   kept separate from `PolygonDrawing.tsx` to satisfy `react-refresh/only-export-components` rule
  FILES DELETED:   none
  FILES MOVED:     none
  FILES MODIFIED:
    `frontend/src/pages/CodingPage/components/GeoDataPanel.tsx` (−166L): removed inline `DraggableMarker`,
                   `PolygonDrawingTool`, `isPointInPolygon`; removed `useMapEvents` react-leaflet import
    `frontend/src/pages/PathAnalysisPage/components/PathAnalysisMapView.tsx` (−185L): same removals; also
                   removed `Marker` react-leaflet import (only used by the now-extracted inline `DraggableMarker`);
                   callbacks updated from `L.LatLng` → `[number, number]` tuple API
  SYMBOLS MOVED/EXTRACTED: `DraggableMarker` (GeoDataPanel + PathAnalysisMapView → `components/map/`; 2 callers);
                   `PolygonDrawingTool` (same 2 files → `components/map/`);
                   `isPointInPolygon` (same 2 files → `components/map/polygonUtils.ts`)
  IMPORT SITES UPDATED: 2 files updated to import from `../../components/map/`
  BUILD GATE:      `tsc --noEmit` clean; lint 374 → 372 (−2: two pre-existing `e as any` casts removed as a
                   side effect of the edit); build errors unchanged at 37
  REGRESSION CHECK: polygon draw and marker drag verified on both GeoDataPanel (CodingPage) and
                   PathAnalysisMapView (PathAnalysisPage)
  ARCHITECTURAL DECISIONS: `isPointInPolygon` lives in `polygonUtils.ts` rather than inside `PolygonDrawing.tsx`
                   because React Fast Refresh (`react-refresh/only-export-components`) requires component files to
                   export ONLY components — mixing a utility function into a component file disables HMR for that
                   file. The `[number, number]` tuple API was chosen as the canonical form (GeoDataPanel was
                   already on tuples; PathAnalysisMapView was on `L.LatLng` and was updated to match).
  DEFERRED:        none
  NOTES FOR NEXT:  S2.1 (PathAnalysisMapView) and S2.2 (GeoDataPanel) can now build on these shared primitives
                   without re-extracting them.

- 2026-07-03 · plan-maintenance · absorbed the v2 UI merge from `main` (commit `d5613347`); re-scoped Phase 2 sessions to build on the container/ViewModel/shell seam.
  FILES CREATED:   none (doc-only update)
  FILES DELETED:   none
  FILES MOVED:     none
  FILES MODIFIED:  `REFACTOR_PLAN.md` — updated CONTEXT section with new line counts post-merge
                   (`treatmentDetailPage` 2,197→1,387; `codingPage` 3,036→2,301; `reportBuilderPage` 3,092→3,346);
                   re-scoped S2.1–S2.5 session sketches to respect the `container/*ViewModel.ts/*LayoutV1|V2.tsx`
                   seam; added two guardrails (`frontend/CLAUDE.md` mandatory reading; merge origin/main before
                   Phase 2/3 sessions); added Regression checklist item 7 (both layout variants must render);
                   noted `folderSummaryCache.ts` localStorage key for S1.6 registration
  SYMBOLS MOVED/EXTRACTED: n/a
  IMPORT SITES UPDATED: n/a
  BUILD GATE:      verified TSC baseline still 37 errors post-merge; S1.2 deferred findings re-verified at new
                   line numbers (38 / 176) in `treatmentDetailPage.tsx`
  REGRESSION CHECK: n/a (doc-only)
  ARCHITECTURAL DECISIONS: Phase 2 sessions re-scoped to extract hooks/sub-components from containers only;
                   `*LayoutV1/V2.tsx` shells are pure functions of the ViewModel and must not receive new
                   logic. The v2 merge already did the container/shell split — we build on it, not against it.
  DEFERRED:        none
  NOTES FOR NEXT:  `frontend/CLAUDE.md` is now mandatory reading for every frontend-touching session. Sync
                   with `origin/main` at the start of each Phase 2/3 session — main actively develops the v2
                   UI in the same files.

- 2026-07-03 · S1.6 · created typed `SESSION_KEYS` / `LOCAL_KEYS` constants and `useSessionState` hook; migrated all raw storage string literals across 8 files.
  FILES CREATED:
    `frontend/src/constants/sessionKeys.ts` (125L): `SESSION_KEYS` object (22 entries covering all
                   `pathAnalysis_*`, `pathAnalysisMap_*`, `treatment_*`, `codingFilterContext`,
                   `psat:projectSelection`, `psat:uiVersion`, `psat_report_layout` keys);
                   `LOCAL_KEYS` object (2 entries: `GIS_LAYER_TOGGLES_PREFIX`, `FOLDER_SUMMARY_CACHE`);
                   `gisLayerToggleKey(projectName: string)` helper function;
                   `CODING_FILTER_CONTEXT_KEY` re-export (for backward compat with barrel)
    `frontend/src/hooks/useSessionState.ts` (54L): typed JSON-backed `useState` — `useSessionState<T>(key,
                   defaultValue)` reads/writes sessionStorage on every state change; returns `[T, Dispatch<T>]`
  FILES DELETED:   none
  FILES MOVED:     none
  FILES MODIFIED (8 consumer files migrated; key strings unchanged):
    `frontend/src/pages/PathAnalysisPage/pathAnalysisPage.tsx`: removed `SESSION_KEY_PREFIX` constant and
                   `loadState()` helper function; `activeFilters` + `hiddenProjects` converted to
                   `useSessionState`; remaining raw strings → `SESSION_KEYS.*`
    `frontend/src/pages/PathAnalysisPage/components/PathAnalysisMapView.tsx`: removed local `VIEWPORT_KEY`;
                   all `pathAnalysisMap_*`, `pathAnalysis_*`, `treatment_*` strings → `SESSION_KEYS.*`
    `frontend/src/pages/ReportBuilderPage/reportBuilderPage.tsx`: removed local `LAYOUT_KEY`; 6 session
                   storage strings → `SESSION_KEYS.*`
    `frontend/src/pages/TreatmentPage/treatmentDetailPage.tsx`: 4 strings → `SESSION_KEYS.*`
    `frontend/src/pages/sidebar/Sidebar.tsx`: 3 strings → `SESSION_KEYS.*`
    `frontend/src/pages/CodingPage/codingPage.tsx`: `"codingFilterContext"` → `CODING_FILTER_CONTEXT_KEY`
    `frontend/src/pages/CodingPage/components/GeoDataPanel.tsx`: `"gisLayerToggles_" + name` → `gisLayerToggleKey(name)`
    `frontend/src/api/projects.ts`: re-exports `CODING_FILTER_CONTEXT_KEY` (maintains barrel backward compat)
    `frontend/src/features/projectNav.ts`: updated to import `SESSION_KEYS`
  SYMBOLS MOVED/EXTRACTED: `SESSION_KEY_PREFIX` + `loadState()` (removed from `pathAnalysisPage.tsx`, replaced
                   by `SESSION_KEYS` + `useSessionState`); `VIEWPORT_KEY` (removed from `PathAnalysisMapView.tsx`
                   → `SESSION_KEYS.PA_MAP_VIEWPORT`); `LAYOUT_KEY` (removed from `reportBuilderPage.tsx` →
                   `SESSION_KEYS.REPORT_LAYOUT`)
  IMPORT SITES UPDATED: 9 files (8 consumer files + `api/projects.ts` for barrel re-export)
  BUILD GATE:      `tsc --noEmit` clean; lint 374 (unchanged); build 37 errors (all pre-existing)
  REGRESSION CHECK: viewport restore, filter persistence, and filter-color context verified via back-navigation
                   (checklist items 1, 2, 4)
  ARCHITECTURAL DECISIONS: Key string values are frozen — only the definition site changed — so existing user
                   sessions stored in the browser remain valid. `gisLayerToggleKey()` is a function (not a
                   constant) because the key is per-project. Both `SESSION_KEYS` (sessionStorage) and
                   `LOCAL_KEYS` (localStorage) are registered in the same file for discoverability. `folderSummaryCache.ts`
                   (new from main merge) already uses `LOCAL_KEYS.FOLDER_SUMMARY_CACHE`; its key is registered
                   in the central constants but the file itself was not rewritten (it is fresh working-main code).
                   Per `frontend/CLAUDE.md`, `useSessionState` may only be called from containers/hooks — never
                   from layout shells.
  DEFERRED:        none
  NOTES FOR NEXT:  Before starting S2.1, merge `origin/main` and re-check `PathAnalysisMapView.tsx` line count /
                   structure — main is actively developing the v2 UI in that file.

- 2026-07-03 · S3.1 · added a `@with_project` decorator to `projects/routes.py` and converted 27 single-project
  handlers to use it, killing the repeated `get_ctx()→pm→project→latest` boilerplate and standardising the
  missing-project failure path to a JSON 404.
  FILES CREATED:   none
  FILES DELETED:   none
  FILES MOVED:     none
  FILES MODIFIED:  `backend/app/api/projects/routes.py` (+114 / −121 lines net; added `import functools`, added
                   the `with_project` decorator (~55L incl. docstring) right after `get_ctx()`, converted 27
                   handlers)
  SYMBOLS MOVED/EXTRACTED: new `with_project(_fn=None, *, version=False)` decorator (module-level, defined after
                   `get_ctx`). It reads the project name from the route's `project_name` kwarg (falls back to
                   `name` for the `<string:name>/attributes` route), resolves `pm`/`proj` (and `ver` when
                   `version=True`), and injects them as kwargs into the handler. 27 call sites (handlers) now
                   decorated.
  HANDLERS CONVERTED (27): get_project, get_project_metadata, get_image_date_range, get_latest_attributes,
                   calculate_score, get_results, evaluate_treatments, apply_treatments, preview_treatments,
                   treatment_effectiveness, treatment_segment_effectiveness, get_all_treatments,
                   get_segment_treatments, apply_all_treatments, apply_specific_treatment, reset_all_treatments,
                   save_treatments, update_attributes, get_geodata, delete_segment, delete_segments_batch,
                   autocode_all, baseline_exists, get_baseline, save_baseline, get_autocode_metadata,
                   save_autocode_metadata. Plain `@with_project` (proj only): metadata, image-date-range, geodata,
                   delete_segment, delete_segments_batch + the 5 baseline/autocode-metadata handlers. Everything
                   else uses `@with_project(version=True)`.
  IMPORT SITES UPDATED: n/a (internal to routes.py; no external callers of these handlers)
  BUILD GATE:      `python -m py_compile` OK; `pyflakes` reports zero undefined names; `create_app()` boots and
                   registers all 62 `projects.*` routes (all 27 converted endpoints present, unique endpoint
                   names preserved via `functools.wraps`). Backend gate only (no frontend touched).
  REGRESSION CHECK: n/a for the FE checklist (backend-only). Verified via Flask test client against 6 live
                   projects: (success) `GET /<proj>`, `/metadata`, `/versions/latest/attributes`, `/results`,
                   `/treatments/all`, `/baseline/exists`, `/autocode-metadata` all return 200 with unchanged
                   response shapes; (error) `/metadata` and `/results` on a nonexistent project both return
                   `404 {"error": "Project not found"}`.
  ARCHITECTURAL DECISIONS:
    • Error-shape standardisation (user-confirmed): the decorator returns `fail("Project not found", 404)` on
      `KeyError` from `pm.project()` and `fail("Project version not found", 404)` on `ValueError`/`FileNotFoundError`
      from `proj.latest()`. SUCCESS responses are byte-identical; the change is confined to the error path.
      Handlers that already caught `KeyError`→404 JSON (the baseline/autocode-metadata group) are now
      byte-identical on errors too; handlers that previously let `KeyError` propagate to Flask's default HTML 500
      (e.g. get_project, get_latest_attributes, update_attributes — the latter had DEAD `if not proj` code that
      could never fire since `pm.project()` raises) now uniformly return JSON 404. This is the stated "standardise
      exception→JSON" goal, not a regression.
    • Injection via kwargs (not `flask.g`): chosen so each handler's dependency on `pm`/`proj`/`ver` is explicit
      in its signature. Cost: handlers that only need a subset get harmless `unused-parameter` *Hints* (not
      errors; the backend gate is import/boot, not lint). `version=True` handlers keep a uniform
      `(…, pm, proj, ver)` signature for consistency.
    • Resolution moved OUTSIDE each handler's own `try/except`: for the try-wrapped handlers the inner
      `try/except Exception` is retained for non-resolution errors (scoring, save, I/O); only the project lookup
      moved to the decorator. For `autocode_all`, resolution now runs before `_ensure_models_ready()` — a missing
      project 404s before CV models load (slightly more efficient; success path identical).
    • The 5 baseline/autocode-metadata handlers keep their now-unreachable `except KeyError: return
      fail("Project not found", 404)` clauses as harmless belt-and-suspenders, guaranteeing byte-identical
      behaviour even if a body were to raise `KeyError` for an unrelated reason.
    • Scope = 27 clean single-project handlers. Deliberately NOT converted: no-project routes (list_projects,
      folders/*, roads/*, attribute-mappings), multi-project routes (copy_segments, check_collisions),
      pm-only/custom routes (image serving, post-treatment-image, download-images, export-shapefile,
      autocode/image, autocode/gis, curvature/width/gis-layers, delete/patch project). These don't fit the
      single `project_name`→proj injection and are left for S3.2's blueprint split. ~27 `ctx = get_ctx()` sites
      remain (these handlers + internal helpers).
  DEFERRED:        none new. (Pre-existing S1.2 finding still open: `treatmentDetailPage.tsx` `TREATMENTS`/`Treatment`
                   — frontend, unrelated, addressed in S2.4.)
  NOTES FOR NEXT:  S3.2 (split routes.py into a blueprint package) can build on this: `with_project` is a
                   module-level helper in `routes.py` — when routes move into sub-modules (crud/treatments/
                   autocode/baseline/…), `with_project` (and `get_ctx`, `ok`, `fail`) should move to a shared
                   module (e.g. `projects/_helpers.py` or `projects/context.py`) that every sub-blueprint imports.
                   The remaining unconverted handlers are good candidates to fold into the decorator (or a sibling
                   `@with_pm`) as they land in their target sub-modules.

- 2026-07-03 · S3.2 · split the 6,455-line `projects/routes.py` monolith into a blueprint package — 4 shared
  helper modules + 9 domain route modules — keeping the single `projects` blueprint so all 62 URLs and
  endpoint names are byte-identical. `routes.py` is now a 20-line back-compat barrel.
  FILES CREATED (13 modules, all with module docstrings per the Documentation Standard):
    Support (helpers, no routes):
      `_helpers.py` (390L): the single `projects` blueprint's cross-cutting infra — `get_ctx`/`invalidate_ctx`
                     (+`_CTX`/`_CTX_LOCK`), `ok`/`fail`/`df_to_records`, the `with_project` decorator, the GIS
                     singleton `_get_gis` (+`_GIS_INSTANCE`/`_INIT_LOCK`/`_INIT_ERR`), `warmup_gis`, CV-model
                     readiness (`_ensure_models_ready`/`_MODELS_READY`/`_warmup_models_in_background`/
                     `_warmup_thread` + its `.start()`), the `@bp.before_request` logger `_log_incoming`, the
                     shared `_INFERENCE_DEPTH` counter, and the generic `_get_segment_midpoint` geom helper.
      `roads_util.py` (207L): cached road-section + planning-area GeoDataFrame accessors and road-name/
                     download-folder resolution (`_get_road_sections_gdf`, `_get_planning_areas_gdf`,
                     `_get_known_road_names`, `_available_road_names/_folders`, `_pretty_folder_label`,
                     `_QUARTER_SUFFIX_RE`).
      `gradient.py` (472L): the LiDAR gradient-profile subsystem (catalog load, chainage mapping, per-project
                     cache, `_inject_grade`, `GRADIENT_STATUS_*`).
      `image_utils.py` (477L): image reference resolution/namespacing + geo-data-from-EXIF-points + legacy
                     image migration + source-folder→namespace mapping (`_resolve_image_from_in`,
                     `make_image_namespace`, `build_project_geo_data`, `_migrate_legacy_images`,
                     `_get_project_source_folders`, `_get_image_date_range`, …). Note: the duplicate
                     `_IMAGE_EXTENSIONS` definition (old routes.py line 50, dead — overwritten at import by the
                     line-1160 def) was dropped; the surviving definition is the effective runtime value.
    Route blueprints (import `from . import bp` + `@bp.route`):
      `crud.py` (966L): project lifecycle, attributes, custom options, attribute-mappings, score, results,
                     create-from-folder.
      `segments.py` (248L): delete (single/batch), copy, collision check.
      `treatments.py` (1,289L): the `TREATMENTS` catalogue + all 11 `/treatments/*` endpoints.
      `images.py` (211L): project image serving, post-treatment photo up/get/delete, bulk download.
      `source_folders.py` (684L): `/folders/*` routes + their ~19 private helpers.
      `gis_queries.py` (1,040L): roads/planning lookups, GIS overlay/viewport/near-segment layers, curvature +
                     width visualisations.
      `autocode.py` (711L): CV/GIS/bulk autocode (`_cv_autocode_core`, `_gis_autocode_core`, `autocode_all`).
      `export.py` (248L): shapefile export + helpers.
      `baseline.py` (230L): baseline + autocode-metadata persistence.
  FILES DELETED:   none (routes.py content moved out; file repurposed as a barrel).
  FILES MOVED:     n/a (logical move via AST-driven extraction, not `git mv`).
  FILES MODIFIED:
    `backend/app/api/projects/routes.py`: 6,455L → 20L — now a docstring + re-export barrel exposing
                     `get_ctx`, `invalidate_ctx`, `warmup_gis`, `_get_gis`, `ok`, `fail` for the four external
                     importers (`app/__init__.py`, `report/routes.py`, `profiles/routes.py`,
                     `width_visualization.py`) so NO external import site changed.
    `backend/app/api/projects/__init__.py` (4L → 23L): defines `bp`, then imports the 4 support modules, the 9
                     route modules (registering handlers), and the `routes` barrel.
  SYMBOLS MOVED/EXTRACTED: all 149 functions + 30 module-level globals/constants distributed across the 13
                     modules per an AST-computed call graph (single-domain symbols → their domain module;
                     cross-domain → the relevant support module). Cross-module imports were auto-generated from
                     the graph. `_INFERENCE_DEPTH` (written by autocode `_cv_autocode_core`/`autocode_all`/its
                     nested `_bulk_gen`, read by crud `update_project_metadata`) was moved to `_helpers` and all
                     4 sites rewritten from `global _INFERENCE_DEPTH; _INFERENCE_DEPTH ±= 1` to live
                     module-attribute access `_helpers._INFERENCE_DEPTH ±= 1` — the ONLY intentional logic edit.
  IMPORT SITES UPDATED: 0 external. Intra-package: each route module imports its helpers `from ._helpers` /
                     `.image_utils` / `.gradient` / `.roads_util`.
  BUILD GATE:      `py_compile` all 15 files OK; `create_app()` boots and registers exactly 62 `projects.*`
                     routes (identical count + identical endpoint names/URLs/methods vs the S3.1 baseline);
                     backend gate only (no frontend touched).
  REGRESSION CHECK: n/a for the FE checklist (backend-only). Backend verification: (1) AST-diff of every
                     function old-vs-new → 149 funcs, 0 missing / 0 extra, only the 4 expected `_INFERENCE_DEPTH`
                     functions differ; (2) module-level globals diff → all preserved, only intentional
                     `_IMAGE_EXTENSIONS` dedup (2→1); (3) `_log_incoming` before_request still registered;
                     (4) functional smoke via test client on 6 live projects — crud (get/metadata/attributes/
                     results/geodata/image-date-range), gradient (attributes), image_utils (geodata migration),
                     treatments (all/segment), baseline (exists/metadata) all 200; gis_queries/segments/export/
                     autocode/source_folders reached their own input-validation paths (400/handler-level 500)
                     with no ImportError/NameError, proving cross-module imports resolve at runtime; (5) error
                     path `/<missing>/metadata` → 404 unchanged.
  ARCHITECTURAL DECISIONS:
    • Single shared `bp` (user-confirmed) over multiple sub-blueprints: keeps Flask endpoint names byte-identical
      (`projects.<fn>`), which the plan's "identical runtime behaviour" goal demands. No `url_for("projects.…")`
      exists anywhere, but the single-bp choice is strictly safer and is the standard Flask pattern for splitting
      a large routes file.
    • `routes.py` kept as a back-compat barrel (not deleted) because 4 modules import names from
      `app.api.projects.routes`. Zero external edits needed.
    • Support-vs-route module split: everything that is NOT a `@bp.route` handler and is used by ≥2 domains lives
      in a support module (`_helpers`/`image_utils`/`gradient`/`roads_util`); single-domain private helpers live
      with their route module. `gradient` and `image_utils` earned their own modules because their helper
      clusters are large and shared by crud+autocode / crud+images+source_folders+autocode respectively.
    • Shared mutable global `_INFERENCE_DEPTH`: accessed via `_helpers._INFERENCE_DEPTH` (module attribute), NOT
      `from ._helpers import _INFERENCE_DEPTH`, so writers and the reader see the same live value across modules
      (a `from … import` would bind a stale snapshot; a per-module `global` would create separate counters).
    • Extraction was performed by a one-shot AST-driven generator (`/tmp/split_routes.py`) rather than manual
      copy/paste, so function bodies are provably byte-identical (verified by AST dump comparison) — the safest
      way to move ~6k lines without drift.
    • Import headers: every module carries the full external-import header from the old file (harmless
      over-import) to guarantee no missing import; the backend gate is import/boot, not lint, so unused-import
      hints are acceptable. A future tidy pass could prune per-module.
  DEFERRED:        Three modules still exceed the ~600-line target — `treatments.py` (1,289; ~210L is the
                   `TREATMENTS` data catalogue that could move to a `treatment_definitions.py` data module),
                   `gis_queries.py` (1,040; `get_gis_layers` alone is ~200L), `crud.py` (966). These are cohesive
                   domain modules and a reasonable S3.2 stopping point; a follow-up could sub-split them and prune
                   the duplicated import headers. (Not added to DEFERRED FINDINGS — this is refactor granularity,
                   not a bug.)
  NOTES FOR NEXT:  S3.3 (logging) now has 14 files to sweep for `print()` instead of one — the GIS singleton
                   prints (`[GIS] …`) live in `_helpers.py`, the request logger in `_helpers._log_incoming`, and
                   `[PM]`/`[Context]` prints in the service layer. S3.8 (type hints) targets `crud.py` (the
                   former routes.py CRUD core) + `project_manager.py`. The `with_project`/`get_ctx`/`ok`/`fail`
                   shared helpers now live in `_helpers.py` (as the S3.1 note predicted). When adding a new
                   projects endpoint, put it in the matching domain module and `from . import bp` — do NOT
                   reintroduce routes into `routes.py` (it is a barrel only).

- 2026-07-04 · S3.3 · replaced all 68 `print()` calls in the projects blueprint package with leveled `logging`, and added a central logging config to the app factory.
  FILES CREATED:   none
  FILES DELETED:   none
  FILES MOVED:     none
  FILES MODIFIED:  `backend/app/__init__.py` (+`_configure_logging()`, called first in `create_app`);
                   `backend/app/api/projects/_helpers.py` (20 prints), `gradient.py` (14), `gis_queries.py` (12),
                   `image_utils.py` (10), `autocode.py` (9), `crud.py` (2), `export.py` (1) — each gained a
                   top-level `import logging` + `logger = logging.getLogger(__name__)` after the `__future__`
                   import, and every `print(..., flush=True)` became `logger.<level>(...)` (flush dropped).
  SYMBOLS MOVED/EXTRACTED: none moved; added `_configure_logging()` in `app/__init__.py`.
  IMPORT SITES UPDATED: 0 external. Each of the 7 package modules added its own `import logging` + module logger.
  GRAPH USAGE:     `build_or_update_graph_tool` (incremental) after the post-merge state and again after edits;
                   `semantic_search_nodes_tool("print debug logging …")` → 0 hits (keyword mode, no embeddings —
                   `print(` isn't a node name), so authoritative site discovery fell back to `grep` (68 real
                   calls; the raw `grep -c` count of 70 included 2 `Blueprint(` substring false positives in
                   `__init__.py`/`width_visualization.py`, which are NOT print calls). `detect_changes_tool`
                   (base=HEAD) → risk 0.35, only the 2 new logging fns flagged untested (no suite — expected).
  BUILD GATE:      Backend-only (no frontend touched). `py_compile` all 7 modules OK; `create_app()` boots and
                   registers 62 `projects.*` routes (identical to the S3.2 baseline). Log-emission smoke:
                   INFO/WARNING emit at default level, DEBUG suppressed; `LOG_LEVEL=DEBUG` surfaces DEBUG.
  REGRESSION CHECK: n/a for the FE checklist (backend-only).
  ARCHITECTURAL DECISIONS:
    • Level mapping rule: strings labelled ERROR / init failures → `error`; labelled WARNING or "failed"/
      "could not" conditions → `warning`; per-request and per-segment/per-image diagnostics (the `[Flask] >>>`
      request tracer, autocode CV-inference traces, gradient per-image results, GIS per-layer counts, migration
      skips) → `debug` so they're silent at the default INFO level but recoverable via `LOG_LEVEL=DEBUG`;
      everything else (startup/warmup status, bulk progress) → `info`.
    • Kept the semantic `[GIS]`/`[Context]`/`[Autocode]`/`[Gradient]`/`[migrate]` prefixes inside the message
      text rather than encoding them as logger names — they don't map 1:1 to modules (`_helpers.py` alone emits
      `[GIS]`, `[Context]`, `[Autocode]`, `[Flask]`), so preserving them keeps output greppable and behaviour-close.
    • Central config via `logging.basicConfig` in `create_app` (level from `LOG_LEVEL` env, default INFO). Needed
      because there was NO logging config before — Python's last-resort handler only shows WARNING+, which would
      have silently dropped the many former INFO-level status prints.
    • Scope bounded to the projects package (the 7 files S3.2 created, matching the "~68" estimate). Service-layer
      `[PM]`/`[Context]` prints referenced in S3.2's note were left for a future pass — they live outside the
      S3.3-named file set and touching them would overlap S3.6/S3.8's targets.
  DEFERRED:        Service-layer `print()`s (`project_manager.py` `[PM]`, prediction/GIS service modules) still
                   use `print()` — out of S3.3's file scope; fold into S3.6/S3.8 or a follow-up logging pass.
  NOTES FOR NEXT:  Logging is now configured centrally — new backend code should use `logging.getLogger(__name__)`,
                   NOT `print()`. Default level is INFO; set `LOG_LEVEL=DEBUG` to see the per-request/per-segment
                   traces. The module-logger pattern (`import logging` + `logger = logging.getLogger(__name__)`
                   right after `from __future__ import annotations`) is established across the projects package —
                   match it when adding modules.

- 2026-07-05 · S3.4 · extracted the curvature and facility-width logic out of the 2,600-line `gis_mapping.py`
  `GIS` monolith into two dedicated analyzer classes, leaving `GIS` as a thin proximity/speed class that
  delegates curvature/width to the analyzers via a back-reference. Numeric outputs verified byte-identical.
  FILES CREATED:   `backend/app/services/curvature_analyzer.py` (1627L — CURVATURE_* constants + `CurvatureAnalyzer`:
                   path-layer prep, snapping, triplet/angle radius calc, `analyze_curvature`, `get_curvature`,
                   `get_curvature_visualization`, and the width+curvature hybrid `get_radius_and_width_at_point`);
                   `backend/app/services/width_analyzer.py` (413L — `WidthAnalyzer`: `get_facility_width`,
                   `get_width_visualization`, static `_standardize_width_column`)
  FILES DELETED:   none
  FILES MOVED:     logical moves only (no `git mv`): curvature methods gis_mapping.py→curvature_analyzer.py;
                   width methods gis_mapping.py→width_analyzer.py; `CURVATURE_*` module constants →
                   curvature_analyzer.py; `from app.utils.path_width_curvature import get_radius_and_width_at_point`
                   → width_analyzer.py (its only remaining user)
  FILES MODIFIED:  `backend/app/services/gis_mapping.py` 2600→682L — `GIS.__init__` now builds
                   `self._curv = CurvatureAnalyzer(self)` / `self._width = WidthAnalyzer(self)`; added 10 thin
                   delegation methods (`get_curvature`, `analyze_curvature`, `get_curvature_visualization`,
                   `get_radius_and_width_at_point`, `_snap_point_to_path_network`, `_check_angle_curvature`,
                   `_supports_sharp_curve_details`, `get_facility_width`, `get_width_visualization`,
                   `_standardize_width_column`); dropped the now-orphaned `_prepared_path_layers` init and the
                   `CURVATURE_*` block. `REFACTOR_PLAN.md` (this file).
  SYMBOLS MOVED/EXTRACTED: ~30 curvature methods + hybrid `get_radius_and_width_at_point` → `CurvatureAnalyzer`;
                   `get_facility_width`/`get_width_visualization`/`_standardize_width_column` → `WidthAnalyzer`.
                   External callers (verified via graph, see below): `get_curvature` & `get_facility_width` ←
                   `autocode.py::_gis_autocode_core`; `get_curvature_visualization` & `get_width_visualization` ←
                   `gis_queries.py` routes; `analyze_curvature`/`get_radius_and_width_at_point` ← tests. All still
                   call `gis.<method>()` unchanged — the delegation stubs keep the public surface identical.
  IMPORT SITES UPDATED: 0 external. The 14 modules that do `from app.services import gis_mapping as gis` use
                   `gis.GIS`/`gis.LayerStore`, both unchanged. `gis_mapping.py` gained two internal imports of the
                   new analyzer modules (no import cycle: the analyzers never import `gis_mapping`).
  GRAPH USAGE:     `query_graph_tool(pattern="callers_of")` on all six public curvature/width methods →
                   external callers = `_gis_autocode_core` (get_curvature@195, get_facility_width@201), the two
                   gis_queries routes, and 2 tests; `get_curvature_visualization`/`get_width_visualization`
                   returned 0 graph callers, so a grep cross-check surfaced the two `gis_queries.py` route calls
                   the graph missed (string-resolved) — recorded so the next session need not re-derive.
                   `get_impact_radius_tool` on gis_mapping.py errored on arg name (schema mismatch) → substituted
                   `query_graph_tool` + targeted grep. `detect_changes_tool` on the diff: risk 0.55, `GIS` flagged,
                   no correctness warnings specific to the extraction.
  BUILD GATE:      backend `python -c "import app"` OK; all three modules `ast.parse` clean. (No frontend touched;
                   TSC/lint n/a.)
  REGRESSION CHECK: n/a for the FE checklist (backend-only). Backend safety net instead: `pytest
                   test_curvature_analysis.py` = 14 passed / 6 failed **identical to the pre-change baseline**
                   (the 6 are pre-existing — see DEFERRED FINDINGS); old-vs-new numeric spot-check on a synthetic
                   curved path (4 points) → radius, width, curvature category+subcategory, facility-width, and viz
                   width ALL byte-identical.
  ARCHITECTURAL DECISIONS: (1) Back-reference pattern (analyzers hold `self.gis`, read shared data via
                   `self.gis.store`) chosen over passing `LayerStore` + a third shared-helpers module — lowest churn,
                   safest for identical outputs (user-approved). (2) The width+curvature hybrid
                   `get_radius_and_width_at_point` lives in `CurvatureAnalyzer` (it is mostly curvature machinery)
                   and reaches the one width helper via `self.gis._standardize_width_column` (user-approved).
                   (3) **Monkeypatch contract preserved without magic:** `test_curvature_analysis.py` patches four
                   methods on the `gis` *instance* (`_snap_point_to_path_network`, `get_radius_and_width_at_point`,
                   `_check_angle_curvature`, `analyze_curvature`) and expects internal callers to honor the patch.
                   So inside `CurvatureAnalyzer` those four are called back through `self.gis.<method>` (all other
                   inter-method calls stay analyzer-local `self.`), and `GIS` exposes explicit delegation stubs for
                   the full test-referenced surface. This is why the extraction is a class-move but NOT a pure
                   "self→self.gis everywhere" sweep — only the patched surface routes through gis.
  DEFERRED:        Duplicate/dead `_remove_z_coordinate` in `GIS` (see DEFERRED FINDINGS 2026-07-05); the 6
                   pre-existing `test_curvature_analysis.py` failures (see DEFERRED FINDINGS 2026-07-05) — 4 stale
                   route refs for S3.7, 2 junction-logic assertions need a separate look. None fixed inline.
  NOTES FOR NEXT:  S3.5 (`query_nearby()` + unify the ~8 proximity checks) now works on a much smaller
                   `gis_mapping.py` (682L) whose `GIS` class is just LayerStore access + proximity/speed +
                   delegation stubs — the proximity methods (`is_mrt`, `is_bus_lane`, …) it targets are all still
                   there. When touching curvature/width internals in future sessions, remember the `self.gis`
                   routing rule for the 4 monkeypatched methods (documented in both analyzer module docstrings and
                   `GIS.__init__`), or those tests will silently regress. `gis_mapping.py` is 682L — modestly over
                   the ~600 target; splitting proximity vs speed could close it but is out of S3.4 scope.
