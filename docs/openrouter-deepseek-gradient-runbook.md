# OpenRouter + Claude Code + DeepSeek Gradient Runbook

This file is the companion runbook for running the gradient workflow through Claude Code with OpenRouter.

Read this together with:
- `Gradient Calculation/LAZ_to_Gradient_Guide.md`

Use this file when the goal is not "solve one road manually," but "clear a repeatable batch safely without blowing budget or session stability."

## 1. Recommended Stack

Recommended primary model:
- `DeepSeek V4 Flash` on OpenRouter, paid version

Reason:
- cheaper than Claude Sonnet for repetitive batch orchestration
- long context is available if needed
- good enough when the workflow is file-driven and rigid
- more stable than free-router traffic

Recommended shell/orchestrator:
- `Claude Code`

Role split:
- Claude Code = tool runner and file editor
- DeepSeek V4 Flash = reasoning model behind the batch decisions
- repo files = source of truth

Do not rely on chat transcript memory for batch state.

Operational assumption:
- the guide is authoritative for naming rules, blocker format, tie-breaks, compare-build triggers, and promotion rules
- the guide is also authoritative for salvage-build definition, validated nearby precedent, batch-summary verification, and the single project metadata mutation rule
- this runbook exists to make the operator prompt and per-run artifacts deterministic enough that the model should not need to ask follow-up questions

## 2. Goal Per Run

Do not try to clear 3800 roads in one run.

Target one batch per run with a hard stop after:
- temp build outputs are complete
- canonical promotion is complete
- project metadata `path_key` values are updated
- summary txt is written if requested
- markdown note is updated if requested

The run is complete only after those outputs exist on disk.

## 3. Best Batch Size For Roughly 2 Hours

Default answer:
- use `8` roads per run

Allowed range:
- `6` roads if the batch includes long arterials, uncertain LiDAR choice, or likely manual cleanup
- `8` roads as the normal default
- `10` roads only if they are short local roads in the same planning area and same LiDAR bundle, with no expected compare build

Reason for this default:
- recent Serangoon builds showed the slower per-road subprocess path taking about `13` to `18` minutes per road
- the shared-index cached path is faster, but still benefits from safety margin for promotion, summary writing, and retries
- `8` roads gives a practical 2-hour target without forcing the model to sprint or improvise

`Compare build` means a second build of the same target road, usually with an alternate LiDAR bundle or materially different build setting, run only to compare against the first result before promotion. If bundle choice is ambiguous or the first result looks weak, assume a compare build is likely and size the batch down accordingly.

Conservative rule:
- if you are unsure, choose `8`, not `10`

## 4. How To Decide Batch Size Quickly

Use this table.

`6` roads:
- includes an avenue, central road, or obviously long arterial
- includes uncertain bundle choice
- includes a likely compare build
- includes roads already known to be awkward or low-confidence

`8` roads:
- normal batch
- same planning area
- same LiDAR bundle
- mostly ordinary roads

`10` roads:
- all roads are short local streets
- same planning area
- same LiDAR bundle
- no compare build expected
- no storage reorganization is needed during the same run

## 5. Mandatory Batch Composition Rules

Never mix randomly.

Each batch should be:

1. one planning area only
2. one primary LiDAR bundle only
3. one road family or cluster when possible
4. one summary txt output only
5. one markdown update only

Do not mix Serangoon roads with Hougang roads in the same batch unless there is a very specific reason.

## 6. Prompt Size Discipline

Keep the model prompt small.

Include only:
- the road list for this batch
- the planning area
- the LiDAR bundle
- the output file names required
- the two guides

Do not dump:
- giant transcripts
- unrelated logs
- full historical conversations
- all 3800 roads at once

Prefer file-based state instead.

Before asking the human for planning area, bundle, project existence, source-folder naming, batch folder, or summary path, the model must search the repo state first. The guide is authoritative for that discovery order and the default fallbacks.

During normal execution, the model should not ask follow-up questions at all. It should infer, default, run one compare build when required by the guide, or stop with the exact blocker report format defined in the guide.

Exact runbook contract:

1. If the operator did not supply planning area, LiDAR bundle, batch folder, summary path, or even exact project names, the model must still start from repo discovery and continue.
2. The runbook does not permit the model to bounce placeholders back to the operator as questions.
3. If the model cannot proceed after applying the guide's inference/default/tie-break rules, it must emit the exact blocker report and stop.

## 7. Batch State Files To Keep

For every run, keep state in files under `tmp/`.

Recommended per-run artifacts:
- `tmp/<batch_name>/` for temp build outputs
- `tmp/<batch_name>/batch_summary.json`
- `tmp/<batch_name>/batch_summary.tsv`
- user-requested simple txt summary if needed

Default names when the operator did not specify them:

- temp batch folder: `tmp/gradient_batch_<YYYYMMDD>/`
- salvage temp folder: `tmp/gradient_salvage_<YYYYMMDD>/`
- simple completion txt path: `tmp/gradient_batch_<YYYYMMDD>_completion.txt`
- batch summary json path: `tmp/gradient_batch_<YYYYMMDD>/batch_summary.json`
- batch summary tsv path: `tmp/gradient_batch_<YYYYMMDD>/batch_summary.tsv`

Retry naming rule:

- reuse the unsuffixed same-day folder only when resuming that exact batch on purpose
- if the default same-day folder already exists and that earlier attempt must remain readable, create a new same-day folder suffixed `_retry2`, `_retry3`, and so on instead of overwriting the earlier one
- never overwrite an earlier batch summary or temp output silently

Allowed `source_type` values:

- `canonical_existing`
- `direct_build`
- `salvage_build`

Use the guide's definitions exactly:

- `direct_build`: true target-road project used as the build source
- `salvage_build`: neighboring project trace used as the build source for the target road
- if the source project folder name differs from the target road name, treat it as salvage and pass `--display-name`

Allowed `status` values:

- `canonical_existing`
- `promoted`
- `temp_only`
- `blocked`

Meaning:

- `canonical_existing`: already present in canonical storage; no new build needed
- `promoted`: newly built and promoted in this run
- `temp_only`: result exists only in `tmp/` and was intentionally not promoted
- `blocked`: no build result because a real blocker stopped execution

Required `blocked_label` values for blocked rows:

- `Missing Source`
- `Not Viable`

Meaning:

- `Missing Source`: missing or unusable project/source imagery or geometry is the controlling blocker
- `Not Viable`: the source search finished, but there is no viable LiDAR/build path or no credible result can be produced from the available inputs

Deterministic tie-break:

- if a missing or unreadable source artifact would unblock the road, use `Missing Source`
- otherwise use `Not Viable`

`generated_at_utc` rule:

- use system UTC when writing the batch summary
- serialize as ISO 8601 UTC, for example `2026-05-28T10:30:56Z`
- do not use local time or omit the timezone

Recommended `batch_summary.json` schema:

```json
{
  "batch_name": "gradient_batch_20260528",
  "planning_area": "Serangoon",
  "primary_lidar_bundle": "Serangoon",
  "generated_at_utc": "2026-05-28T10:30:56Z",
  "roads": [
    {
      "road_name": "CONWAY GROVE",
      "project_name": "Conway Grove",
      "path_key": "conway_grove",
      "source_type": "canonical_existing",
      "status": "canonical_existing",
      "blocked_label": null,
      "completion_pct": 34.31,
      "valid_gradient_count": 70,
      "profile_point_count": 204,
      "canonical_dir": "backend/shapefiles/gradient_profiles/Serangoon/conway_grove",
      "temp_dir": null,
      "notes": "existing canonical result"
    }
  ],
  "counts": {
    "total": 1,
    "canonical_existing": 1,
    "promoted": 0,
    "temp_only": 0,
    "blocked": 0
  }
}
```

Recommended `batch_summary.tsv` columns in this exact order:

```text
road_name	project_name	path_key	source_type	status	blocked_label	completion_pct	valid_gradient_count	profile_point_count	canonical_dir	temp_dir	notes
```

If a column has no value, leave it blank in TSV and use `null` in JSON.

## 8. Runtime Risk Controls (Current Runner Behavior)

For urgent runs, use the corrected direct-source assessment path under `tmp/`.

Current controls that are already implemented:

- lazy LiDAR indexing per bundle (index only when a road actually needs that bundle)
- per-attempt progress checkpoints written to `attempt_status.json`
- persistent LiDAR bundle index cache under `tmp/lidar_index_cache_20260529/`

Why this matters:

- startup time is reduced because repeated LAZ header scans are avoided
- long LiDAR phases are observable from disk even when terminal output is sparse
- re-runs in new processes reuse cached tile bounds instead of starting from zero

Checkpoint file location pattern:

- `tmp/<run_stem>_builds/<road_slug>__<source_slug>__<bundle_slug>/attempt_status.json`

Checkpoint phases used by the current runner:

- `starting`
- `applying_road_boundary`
- `querying_lidar`
- `writing_outputs`
- `complete`
- `failed`

Operational reading rule:

- if a run appears stalled in terminal logs, inspect the newest `attempt_status.json` first
- `phase = querying_lidar` means source geometry and road-boundary steps already passed, and the run is in the expensive LiDAR lookup stage

No-LiDAR classification rule:

- if source exists and road-match passes, but no bundle yields usable elevations/gradients, classify as `Not Viable` (not `Missing Source`)
- use `Missing Source` only when controlling blockers are source/project artifacts or geometry prerequisites

Field population rules:

- for any road already read from canonical storage in this batch, set `source_type = canonical_existing` even if the current canonical artifact may have been produced by a user-accepted salvage run in some earlier session; do not try to reconstruct historical build lineage from current canonical files
- use `source_type = direct_build` or `source_type = salvage_build` only for roads actually built in the current batch
- for `canonical_existing`, read `completion_pct`, `valid_gradient_count`, and `profile_point_count` from canonical `metadata.json`; if any are missing, derive them from canonical `gradient_profile.csv`; use `null` only if both artifacts fail to provide the value
- for `promoted` and `temp_only`, populate those same fields from the temp or promoted artifacts produced in that run, with the same CSV fallback
- set `blocked_label = null` in JSON and leave it blank in TSV for `canonical_existing`, `promoted`, and `temp_only`
- for `blocked`, leave those fields `null` unless you are explicitly recording an existing temp artifact as `temp_only` instead
- for `blocked`, `blocked_label` is required and must be exactly `Missing Source` or `Not Viable`
- if `blocked_label = Missing Source`, `notes` must identify the missing or unreadable source artifact or geometry gap
- if `blocked_label = Not Viable`, `notes` must identify the LiDAR, coverage, retained-sample, ambiguity, or result-quality blocker

Counts consistency rule:

- recompute `counts` from the `roads` array after every status change
- `counts.total` must equal the number of entries in `roads`
- each per-status count must equal the number of rows with that exact `status`
- the sum of `canonical_existing + promoted + temp_only + blocked` must equal `counts.total`
- never hand-type stale counts after changing road rows

Project metadata mutation rule:

- use the guide's single project metadata mutation rule verbatim
- never create a runbook-specific exception to that rule

If the run is interrupted, the next run should read those files first instead of re-deriving state from chat.

Recommended blocked-row JSON example:

```json
{
  "road_name": "COURT ROAD",
  "project_name": null,
  "path_key": "court_road",
  "source_type": null,
  "status": "blocked",
  "blocked_label": "Missing Source",
  "completion_pct": null,
  "valid_gradient_count": null,
  "profile_point_count": null,
  "canonical_dir": null,
  "temp_dir": null,
  "notes": "no project folder with geo_data.gpkg"
}
```

## 8. Copy-Paste Prompt Template

Use this as the starting prompt in Claude Code with OpenRouter.

If planning area, bundle, or project/source presence is not explicitly supplied in the user request, the model must discover them from repo state before asking anything.

Use this template only when the operator already knows the planning area, primary bundle, and road list for the batch.

```text
Read `Gradient Calculation/LAZ_to_Gradient_Guide.md` and `docs/openrouter-deepseek-gradient-runbook.md` fully first.

You are handling one gradient batch only. Do not widen scope.

Batch details:
- Planning area: <Planning Area>
- Primary LiDAR bundle: <Bundle>
- Roads:
  - <Road 1>
  - <Road 2>
  - <Road 3>
  - <Road 4>
  - <Road 5>
  - <Road 6>
  - <Road 7>
  - <Road 8>

Rules:
0. Before asking the user anything, search canonical profiles, live projects (`profiles/alaster/projects/` for new; `data/` for legacy), `in/`, and `tmp/` as required by the guide.
1. Check whether each road already has a canonical promoted profile first.
2. Do not rebuild roads that already have an accepted canonical result unless explicitly asked.
3. If building is needed, use explicit `--path-key` values.
4. Build to `tmp/<batch_name>/<path_key>/` first and always pass explicit `--output-dir`.
5. For every salvage build from a neighboring project, pass `--display-name '<Road Name Title Case>'`.
6. Validate metadata and compare-build fields before promotion.
7. Promote successful outputs to `backend/shapefiles/gradient_profiles/<Planning Area>/<path_key>/`.
8. Apply the guide's single project metadata mutation rule.
9. Never invent a runbook-only exception to that rule.
10. Write the requested simple txt summary with exactly `ROAD NAME XX.XX%` lines and no header.
11. Write `batch_summary.json` and `batch_summary.tsv` using the runbook schema unless the user explicitly says not to.
12. For every blocked road, set `blocked_label` to `Missing Source` or `Not Viable` using the guide taxonomy.
13. Recompute `batch_summary.json.counts` from the `roads` array before finishing.
14. Update markdown if requested.
15. Stop after this batch is fully complete.
16. If blocked, emit the exact blocker report from the guide and stop instead of asking a follow-up question.

Output requirements:
- Return a concise final table: road | path_key | status | blocked_label | completion pct.
- Mention the summary txt path.
- Mention any failures or compare-build exceptions.
```

## 9. Zero-Input Prompt Template

Use this template when the operator does not know planning area, bundle, batch folder, summary path, or even whether some roads already exist canonically.

```text
Read `Gradient Calculation/LAZ_to_Gradient_Guide.md` and `docs/openrouter-deepseek-gradient-runbook.md` fully first.

You are handling one gradient batch only. Do not widen scope.

Roads for this batch:
- <Road 1>
- <Road 2>
- <Road 3>
- <Road 4>
- <Road 5>
- <Road 6>
- <Road 7>
- <Road 8>

You must not ask follow-up questions. Infer or default everything you can from repo state.

Required behavior:
1. Search canonical profiles, live projects (`profiles/alaster/projects/` for new; `data/` for legacy), `in/`, and `tmp/` exactly as the guide requires.
2. Infer planning area and primary LiDAR bundle from repo state or validated nearby precedent as defined by the guide; do not cross planning areas.
3. Use the guide's default temp batch folder and summary paths if none were specified.
4. Use explicit `--path-key` and `--output-dir` for any build, and pass `--display-name '<Road Name Title Case>'` for every salvage build.
5. Run at most one compare build per road, and only when the guide leaves a specific alternate plausible bundle candidate and the first build is weak or incomplete.
6. Promote only credible outputs.
7. Apply the guide's single project metadata mutation rule.
8. Write `batch_summary.json` and `batch_summary.tsv` using the runbook schema unless the user explicitly said not to.
9. For every blocked road, set `blocked_label` to `Missing Source` or `Not Viable` using the guide taxonomy.
10. Recompute summary counts from the `roads` array before finishing.
11. If blocked, emit the exact blocker report and stop instead of asking a question.

Output requirements:
- Return a concise final table: road | path_key | status | blocked_label | completion pct.
- Mention the summary txt path, or say `summary txt path: none requested`.
- Mention any failures or compare-build exceptions.
```

## 10. Prompt Variant For Existing Canonical Roads

Use this shorter prompt when the likely outcome is validation plus summary only.

```text
Read `Gradient Calculation/LAZ_to_Gradient_Guide.md` and `docs/openrouter-deepseek-gradient-runbook.md` first.

For this batch, validate whether canonical profiles already exist for these roads under the correct planning-area folder. Search repo state before asking the user for anything. If canonical profiles exist, read `metadata.json`, derive completion/counts from `gradient_profile.csv` if metadata is incomplete, confirm project `path_key` values, and write the requested summary txt. Do not rebuild anything unless a road is missing canonical outputs.
```

## 11. What The Model Must Not Do

Do not let the model do any of these:

1. process all roads in `in/` just because they exist
2. rebuild accepted canonical roads without being told to
3. flatten the canonical folder structure
4. leave temp outputs unpromoted and still call the batch done
5. forget to update `project_metadata.json`
6. write commentary into the simple txt summary
7. continue into a second batch in the same run unless explicitly told to do so
8. ask the operator to choose among repo-discoverable planning areas, bundles, project names, or default file paths
9. reference, read, or compare against existing canonical data when the user requests a repeat or duplicate run on an already-audited road — treat the road as if it has no prior result and build from scratch
10. include any text other than `XX.XX%` in the percentage column of any output list or table — the value must be a plain number followed immediately by `%` with no surrounding labels, parentheticals, or qualifiers
11. reorder, resort, or regroup the output list — return roads in the exact order the user submitted them, regardless of status, bundle, or completion
12. use any status label other than exactly `Done`, `Not Viable`, or `Missing Source` (case-sensitive) in user-facing output tables
13. use any column headers other than exactly `Name`, `Status`, `Completion %` (in that order) in output tables returned to the user

## 12. 2-Hour Run Strategy

The best practical strategy is:

1. choose `8` roads
2. keep them all in the same planning area
3. keep them all on the same primary LiDAR bundle
4. finish one batch completely
5. stop
6. start a fresh run for the next batch

This is better than a 20-road run that partially completes and leaves messy state.

## 13. When To Escalate To A Better Model

Use DeepSeek V4 Flash as the default.

Escalate only when:
- the batch has repeated failures with unclear cause
- bundle choice is genuinely ambiguous
- road-boundary trimming is behaving unexpectedly
- the model keeps trying to widen scope or rewrite the workflow

In other words:
- cheap model for throughput
- better model for weird exceptions only

## 14. Recommended Human Operating Habit

If you are the human supervising runs:

1. feed one batch only
2. review the final table
3. confirm the summary txt exists
4. confirm the canonical folders exist
5. then start the next batch

Do not ask the model to keep running forever.

## 15. LiDAR Drive Note

The LiDAR root is `E:\LIDAR\` when the primary drive is mounted. The operator uses **two external drives** and alternates them — one is mounted for builds while the other is loaded by IT.

Before any LiDAR operation: verify `Test-Path "E:\LIDAR\"` returns `True`. If it returns `False`, the drives have been swapped — ask the operator for the current drive letter and substitute it in all `--laz-dir` and `--laz-root` arguments. Do not assume E:.

## 16. Planning Area Audit CSV — Priority Field

Planning area audit files live under `planning_csvs/<Planning Area>.csv` with columns `Name`, `Priority`, `Status`, `Completion`, `Coverage`.

**Priority is caps-sensitive.** Only these exact values are valid:

- `high` — expressways and major arterials (CAT1 / CAT2 / CAT3 in `ROADSECTIONLINE.shp`)
- `medium` — minor arterials and collectors (CAT4)
- `low` — local access roads and unclassified (CAT5 / NCAT)

Source: `RD_CATG_CD` column in `backend/shapefiles/planningareas/ROADSECTIONLINE.shp`. The column is pre-populated in the CSVs — do not re-derive or alter the casing.

## 17. Bottom-Line Recommendation

For your setup:

- model: `DeepSeek V4 Flash` paid on OpenRouter
- shell: `Claude Code`
- default batch size: `8` roads
- hard maximum batch size: `10` roads
- safer reduced batch size: `6` roads for long or uncertain roads

If the real target is stable, repeatable 2-hour runs, `8` roads is the correct default.
