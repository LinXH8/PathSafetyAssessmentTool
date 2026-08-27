# 10. Contributing

These notes are intentionally practical rather than process-heavy. The codebase is large, stateful, and file-backed, so the safest contributions are small, explicit, and well-validated.

---

## Table of Contents

- [10.1 Working style](#91-working-style)
- [10.2 Validation expectations](#92-validation-expectations)
- [10.3 Documentation rule](#93-documentation-rule)
- [10.4 Project-data safety](#94-project-data-safety)
- [10.5 Local development](#95-local-development)

---

## 10.1 Working style

- keep changes focused on one behavior or one documentation topic at a time
- avoid mixing unrelated cleanup into feature or bug-fix work
- prefer fixes at the owning layer instead of UI-only or data-only workarounds
- preserve existing file formats and naming conventions unless the task requires a migration


## 10.2 Validation expectations

Run the narrowest useful validation for the area you changed.

Typical checks:

- **backend route or service changes:** targeted Flask smoke test or Python import/compile check
- **frontend code changes:** TypeScript build or targeted page validation
- **documentation changes:** sync both `docs/` and `frontend/public/docs/`, then do a stale-content sweep

---

## 10.3 Documentation rule

If you update repository docs in `docs/`, update the mirrored Help-page copies in `frontend/public/docs/` as part of the same change.

---

## 10.4 Project-data safety

- do not hand-edit project directories in `data/` unless the task explicitly requires it
- be careful with destructive project actions because delete operations remove project folders recursively
- treat generated helper assets such as `backend/shapefiles/road_reference.csv` as environment-dependent outputs

---

## 10.5 Local development

For local setup, see [2. Installation Guide](installation.md).
