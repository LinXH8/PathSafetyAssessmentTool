# Documentation Index

The overview lives in the Help page's `README.md` entry.

These `docs/` files are the mirrored copies rendered inside the application. They should stay aligned with the canonical documentation in the repository `docs/` folder.

Main documents:

- [installation.md](installation.md)
- [architecture.md](architecture.md)
- [api-reference.md](api-reference.md)
- [cv-pipeline.md](cv-pipeline.md)
- [scoring.md](scoring.md)
- [treatments.md](treatments.md)
- [frontend.md](frontend.md)
- [common-issues.md](common-issues.md)
- [contributing.md](contributing.md)
- [platform-compatibility.md](platform-compatibility.md) — Windows-only (Excel/COM) features and why they're non-fatal elsewhere
- [gradient-data.md](gradient-data.md) — the offline LiDAR → Grade/Gradient % pipeline
- [gis/README.md](gis/README.md) — implementation notes for individual GIS-derived attributes (curvature, facility width, road speed, heavy vehicle flow)
- [dev-jira.md](dev-jira.md) — bug/task tracking in Jira
- [cyclerap_v213_audit.md](cyclerap_v213_audit.md) — historical, superseded by v2.14; kept for audit trail

Deployment & remote updates:

- [how-to-update-remotely.md](how-to-update-remotely.md) — **start here** to push an update to every machine (written for all levels)
- [deployment-operations-guide.md](deployment-operations-guide.md) — full build/install/update reference
- [deployment-updating-guide.md](deployment-updating-guide.md) — the strict "never hand-zip a release" rules
- [deployment-decisions-and-history.md](deployment-decisions-and-history.md) — why the packaging/update system works the way it does
- [../google-apps-script-report-receiver.gs](../google-apps-script-report-receiver.gs) — the receiving end of the optional Report Builder remote-export feature (see `common-issues.md` §9.9)
