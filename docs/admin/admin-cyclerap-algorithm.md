# 5. Updating the CycleRAP Algorithm

PSAT's scoring engine is built on the CycleRAP v2.11 methodology. This section explains what to do when iRAP releases an updated version of the algorithm.

---

## Table of Contents

- [5.1 When Updates Are Needed](#51-when-updates-are-needed)
- [5.2 How to Request an Update](#52-how-to-request-an-update)
- [5.3 Where the Algorithm Lives in Code](#53-where-the-algorithm-lives-in-code)

---

### 5.1 When Updates Are Needed

iRAP periodically releases updated versions of the CycleRAP risk scoring model. An update may involve:

- New or changed attribute multipliers
- Revised risk band thresholds
- New crash type formulas
- New or deprecated attributes

When a new CycleRAP version is released, existing project scores calculated under the old version will differ from scores under the new version. Administrators should coordinate with the development team before upgrading to understand the impact on existing data.

### 5.2 How to Request an Update

Algorithm updates require changes to the backend scoring logic and are not self-service. To request an update:

1. Download the latest **CycleRAP Methodology** PDF from [irap.org/cyclerap](https://irap.org/cyclerap/).
2. Compare it against the version currently in use (check `backend/app/services/cycleRAP_interface.py` for version references).
3. Log a request with the development team, attaching the new Methodology PDF and noting which attributes or multipliers have changed.
4. The development team will update the scoring tables, run regression tests, and deploy the new version.

### 5.3 Where the Algorithm Lives in Code

| Component | Location |
|---|---|
| Scoring multipliers and formulas | `backend/app/services/cycleRAP_interface.py` |
| Risk band thresholds | Same file, band definitions section |
| Treatment effect mappings | `backend/app/api/projects/routes.py` (treatment triggers) |

> For full implementation details, testing procedures, and the scoring formula reference, see the [Developer Guide → 6. Scoring Logic](../developer/scoring.md).
