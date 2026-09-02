# 14. GIS Attribute Implementation Notes

These are the deep-dive implementation notes for individual GIS-derived CycleRAP
attributes — how each one is computed from the shapefiles in `backend/shapefiles/`,
and why. They're referenced from [../scoring.md](../scoring.md) and
[../cv-pipeline.md](../cv-pipeline.md) where relevant; this page is just the index so
they're reachable on their own.

## Curvature

- [curvature-implementation.md](curvature-implementation.md) — how the Curvature attribute is computed
- [curvature-diagnostics.md](curvature-diagnostics.md) — diagnosing bad/unexpected curvature values
- [curvature-visualization-api.md](curvature-visualization-api.md) — the API behind the curvature debug visualization

## Facility Width

- [facility-width-implementation.md](facility-width-implementation.md) — how Facility Width per Direction is computed
- [facility-width-summary.md](facility-width-summary.md) — condensed summary of the above
- [width-visualization-summary.md](width-visualization-summary.md) — visualization/debugging tooling for facility width

## Road Speed

- [road-operating-speed-implementation.md](road-operating-speed-implementation.md) — Road Operating Speed (mean) attribute
- [road-operating-speed-summary.md](road-operating-speed-summary.md) — condensed summary of the above
- [road-speed-limit-implementation.md](road-speed-limit-implementation.md) — Road Speed Limit autocoding

## Traffic

- [heavy-vehicle-flow-implementation.md](heavy-vehicle-flow-implementation.md) — Heavy Vehicle Flow attribute
