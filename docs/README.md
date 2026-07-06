# Documentation

This directory is the **canonical source** for all PSAT documentation.

The in-app **Help** page fetches markdown at runtime from `frontend/public/docs/`.
Run `npm run docs:sync` (from `frontend/`) or `bash scripts/sync_docs.sh` (from repo root)
after any edit to regenerate that mirror. Commit both `docs/` edits and the updated
`frontend/public/docs/` together.

## Structure

```text
docs/
├── user/           User guide — loaded by the in-app Help → User Guide tab
├── admin/          Admin guide — loaded by the in-app Help → Admin Guide tab
├── developer/      Developer guide — loaded by the in-app Help → Developer Guide tab
│   ├── gis/        GIS attribute implementation notes (curvature, width, road speed, etc.)
│   └── *.md        Architecture, API reference, CV pipeline, scoring, treatments, …
└── archive/        Historical notes kept for reference only — NOT synced to in-app help
    └── gis/        Migration summaries and superseded implementation plans
```

## Editing workflow

1. Edit files in the relevant subdirectory under `docs/`.
2. Run `npm run docs:sync` (or `bash scripts/sync_docs.sh`) to push changes into `frontend/public/docs/`.
3. Commit both the `docs/` changes and the updated `frontend/public/docs/` in one commit.

## What lives where

| Content type | Location |
| --- | --- |
| End-user how-to guides | `docs/user/` |
| Admin / ops guides | `docs/admin/` |
| Developer setup, architecture, API | `docs/developer/` |
| GIS attribute implementation notes | `docs/developer/gis/` |
| Platform compatibility | `docs/developer/platform-compatibility.md` |
| CycleRAP v2.13 attribute audit | `docs/developer/cyclerap_v213_audit.md` |
| Historical migration summaries | `docs/archive/gis/` |

## Non-markdown assets

A few non-documentation files live at the docs root for convenience:

- `example-weekly-activity-report.json` — sample JSON for the weekly activity report schema
- `google-apps-script-report-receiver.gs` — Google Apps Script used to receive activity reports
