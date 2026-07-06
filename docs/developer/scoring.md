# 6. Scoring Logic

PSAT implements the **CycleRAP v2.11** risk scoring algorithm as a pure Python module (`cyclerap_scoring.py`). No Excel, VBA macros, or Windows-only dependencies are required.

---

## Table of Contents

- [6.1 Overview](#6-1-overview)
- [6.2 Risk Bands](#6-2-risk-bands)
  - [6.21 BB, BP, SB](#6-21-bb-bp-sb)
  - [6.22 VB](#6-22-vb)
  - [6.23 Overall Risk Level Band](#6-23-overall-risk-level-band)
- [6.3 Algorithm: Component Formulas](#6-3-algorithm-component-formulas)
  - [6.31 CM3 — Main Cycling Environment Risk](#6-31-cm3-main-cycling-environment-risk)
  - [6.32 CM16 — Departure and Fall Scenarios](#6-32-cm16-departure-and-fall-scenarios)
  - [6.33 CM25 — Speed-Related Incidents](#6-33-cm25-speed-related-incidents)
  - [6.34 CM40 — Vehicle Interaction](#6-34-cm40-vehicle-interaction)
  - [6.35 Final Score Combination](#6-35-final-score-combination)
- [6.4 Worked Example: CM3](#6-4-worked-example-cm3)
  - [6.41 Road Speed Risk Factor](#6-41-road-speed-risk-factor)
- [6.5 Attribute Fields Reference](#6-5-attribute-fields-reference)
  - [6.51 Facility Configuration](#6-51-facility-configuration)
  - [6.52 Facility Clear Width](#6-52-facility-clear-width)
  - [6.53 Facility Surface Conditions](#6-53-facility-surface-conditions)
  - [6.54 Intersection](#6-54-intersection)
  - [6.55 Flow & Speed](#6-55-flow-speed)
- [6.6 `cyclerap_scoring.py` — Function Reference](#6-6-cyclerap-scoring-py-function-reference)
  - [6.61 Output Columns](#6-61-output-columns)
- [6.7 Treatment Logic](#6-7-treatment-logic)
  - [6.71 Treatment List](#6-71-treatment-list)
- [6.8 Updating the CycleRAP Algorithm](#6-8-updating-the-cyclerap-algorithm)
- [6.9 Treatment Configuration](#6-9-treatment-configuration)
- [6.10 How to Add a New Treatment](#6-10-how-to-add-a-new-treatment)
- [6.11 Implementation Details](#6-11-implementation-details)

## 6.1 Overview

CycleRAP produces four independent risk scores for each road segment, each representing a distinct crash scenario:

| Score | Crash type | Description |
|---|---|---|
| **BB** | Bicyclist–Bicyclist | Conflict between cyclists (and with light vehicles) |
| **BP** | Bicyclist–Pedestrian | Conflict between a cyclist and a pedestrian |
| **SB** | Single Bicyclist | Cyclist departing facility and striking a fixed/severe hazard |
| **VB** | Vehicle–Bicyclist | Conflict between a motor vehicle and a cyclist |

Each score is a continuous real number. Scores are then classified into one of four **risk bands**.

An **Overall Risk Level** (the sum of all four scores) and an **Overall Risk Level Band** (the maximum of the four component bands) are also computed.

---

## 6.2 Risk Bands

### 6.21 BB, BP, SB

| Band | Label | Score range |
|---|---|---|
| 1 | Low | < 5 |
| 2 | Medium | 5 – 10 |
| 3 | High | 10 – 20 |
| 4 | Extreme | > 20 |

### 6.22 VB

| Band | Label | Score range |
|---|---|---|
| 1 | Low | < 10 |
| 2 | Medium | 10 – 25 |
| 3 | High | 25 – 60 |
| 4 | Extreme | > 60 |

### 6.23 Overall Risk Level Band

Equal to the **maximum** band across BB, BP, SB, and VB for that segment. This means a single extreme sub-score elevates the overall band to Extreme regardless of the others.

---

## 6.3 Algorithm: Component Formulas

The algorithm builds four intermediate components (`CM3`, `CM16`, `CM25`, `CM40`) and then combines them into the final scores.

### 6.31 CM3 — Main Cycling Environment Risk

```
CM3 = (product of CU factors) ^ (1 + CQ_sum × 0.1)
```
*Layman's explanation: This math formula is used to calculate the risk score for the main cycling environment based on various factors like surface and lighting.*

**CU factors** (continuous risk multipliers):

| Factor | Attribute | Effect |
|---|---|---|
| Loose/slippery surface | `Loose or slippery surface` | 1.5 if Present |
| Delineation | `Delineation` | 1.2 if Not Present |
| Facility width | `Facility Width per Direction` | 1.8/1.5/1.0 for Very Narrow/Narrow/Wide |
| Flow direction | `Flow Direction` | 1.5 if Two Way |
| Width restriction | `Width Restriction` | 1.2 if Present |
| Grade | `Grade` | 1.2 if ≥5 Degrees |
| Cargo bikes | `Observed proportion of cargo bikes` | 1.2 if Moderate to high |
| Pedestrian flow | `Peak pedestrian flow` | 1.2 if Low; 1.5 if Moderate to high |
| Bicycle flow | `Peak bicycle/LV traffic flow` | 1.2 if Moderate to high |
| Speed differential | `Bicycle/LV speed differential` | 1.2 if ≥10 km/h |
| Curvature | `Curvature` | 1.5 if Sharp Turn Present |
| Street lighting | `Street Lighting` | 1.2 if Not Present |

**CQ triggers** (condition flags that increase the exponent):

| Trigger | Attribute | Fires when |
|---|---|---|
| Surface deformation | `Major Surface Deformation or Drain Opening` | Present |
| Fixed obstacle | `Fixed Obstacle on Facility` | Present |
| Non-fixed obstacle | `Non-Fixed Obstacle on Facility` | Present |
| Adjacent parking 0–1m | `Adjacent Vehicle Parking 0-1m` | Present |
| Intersection crossing | `Intersection or Road Crossing` | Present |
| Property access | `Property Access` | Present |
| Intersecting facility | `Intersecting Bicycle Facility` | Present |
| Pedestrian crossing | `Pedestrian Crossing` | Present |

### 6.32 CM16 — Departure and Fall Scenarios

Only fires if at least one of: Loose/slippery surface, Grade ≥5°, or Curvature = Sharp Turn.

### 6.33 CM25 — Speed-Related Incidents

Only fires if at least one of: Tram/train rails present, Surface deformation present.

### 6.34 CM40 — Vehicle Interaction

Only fires if at least one of: Intersection crossing, Property access, Adjacent road 0–1m, Adjacent road 1–3m, Facility type = Mixed Traffic, Intersection approach = Shared.

### 6.35 Final Score Combination

The four components combine into final scores as follows:

```
cj3  = CM3 + CM16   # combined conflict exposure
cj25 = CM25         # fall hazard modifier
cj40 = CM40         # shared space conflict modifier

BB = cj3 × (bicycle_speed × grade × speed_differential × cargo_bike factors)

BP = BB_component × sidewalk_condition
   + BB_component × pedestrian_condition
   (each term is 0 if the condition is absent)

SB = cj3 × severity_factors                  [departure gate — 0 if no departure condition]
   + (cj3 + cj25) × fall_severity_factors    [fall gate — 0 if no fall condition]

VB = (cj3 + cj25) × factors   [fall/conflict — 0 if condition absent]
   + cj3 × factors             [departure — 0 if condition absent]
   + cj40 ÷ 3                  [intersection term 1 — 0 if condition absent]
   + cj40 ÷ 3                  [intersection term 2 — 0 if condition absent]
   + cj40 ÷ 3                  [intersection term 3 — 0 if condition absent]
```
*Layman's explanation: These equations combine the different risk factors calculated above into the final safety scores you see on the screen.*

**Key takeaway:** BB and BP are driven entirely by CM3 + CM16. SB additionally incorporates CM25 for fall scenarios. VB is the only score that uses CM40 (shared-space and intersection conflicts).

---

## 6.4 Worked Example: CM3

The following example traces a single segment through the CM3 calculation by hand.

**Segment attributes:**

| Attribute | Value | Code |
|---|---|---|
| Loose or slippery surface | Not Present | 2 |
| Delineation | Not Present | 2 |
| Facility Width per Direction | Narrow | 2 |
| Flow Direction | One Way | 1 |
| Width Restriction | Not Present | 2 |
| Grade | < 5 Degrees | 1 |
| Observed proportion of cargo bikes | Low | 1 |
| Peak pedestrian flow | None | 1 |
| Peak bicycle/LV traffic flow | Low | 1 |
| Bicycle/LV speed differential | < 10 km/h | 1 |
| Curvature | Sharp Turn Present | 1 |
| Street Lighting | Present | 1 |
| All CQ-trigger fields | Not Present / N/A | 2 |

**Step 1 — Build the CU product:**

```
CU = 1.0  (loose surface: Not Present → 1.0)
   × 1.2  (delineation:  Not Present → 1.2)
   × 1.5  (width:        Narrow      → 1.5)
   × 1.0  (flow:         One Way     → 1.0)
   × 1.0  (width restr:  Not Present → 1.0)
   × 1.0  (grade:        <5°         → 1.0)
   × 1.0  (cargo bikes:  Low         → 1.0)
   × 1.0  (ped flow:     None        → 1.0)
   × 1.0  (bike flow:    Low         → 1.0)
   × 1.0  (speed diff:   <10 km/h    → 1.0)
   × 1.5  (curvature:    Sharp Turn  → 1.5)
   × 1.0  (lighting:     Present     → 1.0)
   = 1.8
```

**Step 2 — Count the CQ triggers:**

All eight CQ-trigger fields (surface deformation, fixed obstacle, non-fixed obstacle, adjacent parking 0–1m, intersection crossing, property access, intersecting facility, pedestrian crossing) are coded as Not Present. CQ_sum = 0.

**Step 3 — Apply the formula:**

```
CM3 = CU_product ^ (1 + CQ_sum × 0.1)
    = 1.8 ^ (1 + 0 × 0.1)
    = 1.8 ^ 1.0
    = 1.8
```
*Layman's explanation: This example shows how the computer calculates a risk score of 1.8 for a specific road segment.*

**Now add one CQ trigger — set Intersection or Road Crossing = Present (1):**

- CQ_sum = 1 (intersection_crossing fires)

```
CM3 = 1.8 ^ (1 + 1 × 0.1)
    = 1.8 ^ 1.1
    ≈ 1.91
```

The exponent increases by 0.1 per active CQ trigger, compounding the base risk. Eight simultaneous triggers would raise the exponent to 1.8, producing `1.8^1.8 ≈ 2.66`.



Road traffic volume is converted to a risk factor using a stepped lookup table:

| AADT threshold | Risk factor |
|---|---|
| < 100 | 0.25 |
| 100 – 499 | 0.25 |
| 500 – 1499 | 0.50 |
| 1500 – 2499 | 0.75 |
| 2500 – 4999 | 1.00 |
| 5000 – 7499 | 1.07 |
| 7500 – 9999 | 1.14 |
| 10000 – 12499 | 1.23 |
| 12500 – 14999 | 1.31 |
| 15000 – 17499 | 1.40 |
| 17500 – 19999 | 1.50 |
| 20000 – 22499 | 1.61 |
| 22500 – 24999 | 1.72 |
| 25000 – 29999 | 1.84 |
| 30000 – 34999 | 1.97 |
| 35000 – 39999 | 2.10 |
| ≥ 40000 | 2.25 |

### 6.41 Road Speed Risk Factor

Operating speed is converted via a sigmoid formula:

```
lookup_speed = round(speed) - 1
risk = 1 + 27.82 / (1 + exp(5.84 − 0.091 × lookup_speed))
```
*Layman's explanation: This formula is used to calculate how the speed of vehicles on the road affects the safety score.*

> Speed is first rounded to the nearest integer, then decremented by 1 before the sigmoid is applied. Returns 1.0 if speed ≤ 1.

---

## 6.5 Attribute Fields Reference

The table below documents every field stored per segment. **39 fields are actively used in the scoring algorithm**; the remaining fields (Area type, Road speed limit, operating speed, unit) are stored for reference or display but do not feed into the CycleRAP formulas.

> The data model contains 43 fields in total. Of those: 39 are scored, 1 (Area type) is metadata only, and 3 (Road speed limit, operating speed, unit) are informational. The "41 fields" figure cited in CycleRAP v2.11 literature refers to the 41 coded attributes including Area type but excluding the three road speed fields.

> Fields are grouped below to match the attribute panel groupings in the PSAT UI.

### 6.51 Facility Configuration

| # | Field name | Type | Values | Scoring use |
|---|---|---|---|---|
| 1 | Area type | Enum | 1 = Urban, 2 = Suburban, 3 = Rural, 4 = Industrial, 5 = Recreation | Not scored |
| 2 | Facility Type | Enum | 1 = Sidewalk, 2 = Multi-Use Path, 3 = Off-Road Bicycle Path, 4 = On-road Bicycle Lane, 5 = Road Shoulder, 6 = Mixed Traffic Road Lane | VB: `vb_cond` and `vb_sev` flags; BP: `bp_cond` |
| 3 | Adjacent Sidewalk 0–1m | Enum | 1 = Present, 2 = Not Present | BP trigger (shared sidewalk exposure) |
| 4 | Adjacent Sidewalk 1–3m | Enum | 1 = Present, 2 = Not Present | BP trigger (shared sidewalk exposure) |
| 5 | Adjacent Road Lane 0–1m | Enum | 1 = Present, 2 = Not Present | CM40 trigger; VB CB26/CB32 |
| 6 | Adjacent Road Lane 1–3m | Enum | 1 = Present, 2 = Not Present | VB CU (0.8 — slight protective); VB CB32/CB45 |
| 7 | Adjacent Vehicle Parking 0–1m | Enum | 1 = Present, 2 = Not Present | CM3 CQ; SB departure trigger; VB CU (1.5) |
| 8 | Adjacent Vehicle Parking 1–3m | Enum | 1 = Present, 2 = Not Present | SB departure trigger; VB CU (1.2) |
| 9 | Adjacent object or level change 0–1m | Enum | 1 = Present, 2 = Not Present | SB departure trigger |
| 10 | Adjacent object or level change 1–3m | Enum | 1 = Present, 2 = Not Present | SB departure trigger |

### 6.52 Facility Clear Width

| # | Field name | Type | Values | Scoring use |
|---|---|---|---|---|
| 11 | Facility access | Enum | 1 = Adequate, 2 = Inadequate | CM40 trigger; risk 1.2 if Inadequate |
| 12 | Light Segregation | Enum | 1 = Present, 2 = Not Present | VB CU (0.8 if Present — protective); VB CB45 trigger |
| 13 | Fixed Obstacle on Facility | Enum | 1 = Present, 2 = Not Present | CM3 CQ trigger |
| 14 | Non-Fixed Obstacle on Facility | Enum | 1 = Present, 2 = Not Present | CM3 CQ trigger |
| 15 | Facility Width per Direction | Enum | 1 = Very Narrow, 2 = Narrow, 3 = Wide | CM3 CU (1.8 / 1.5 / 1.0) |
| 16 | Width Restriction | Enum | 1 = Present, 2 = Not Present | CM3 CU (1.2 if Present) |
| 17 | Adjacent Severe Hazard 0–1m | Enum | 1 = Present, 2 = Not Present | SB departure trigger; SB CU severity (1.8) |
| 18 | Adjacent Severe Hazard 1–3m | Enum | 1 = Present, 2 = Not Present | SB departure trigger; SB CU severity (1.5) |
| 19 | Line of Sight | Enum | — | — |

> **Note:** Line of Sight appears in the UI but is not yet documented in the CycleRAP v2.11 scoring specification. Confirm with the team whether it contributes to scoring.

### 6.53 Facility Surface Conditions

| # | Field name | Type | Values | Scoring use |
|---|---|---|---|---|
| 20 | Delineation | Enum | 1 = Present, 2 = Not Present | CM3 CU (1.2 if Not Present); VB CU (1.2) |
| 21 | Major Surface Deformation or Drain Opening | Enum | 1 = Present, 2 = Not Present | CM3 CQ trigger |
| 22 | Loose or slippery surface | Enum | 1 = Present, 2 = Not Present | CM3 CU (1.5 if Present); CM16 trigger |
| 23 | Grade | Enum | 1 = < 5 Degrees, 2 = ≥ 5 Degrees | CM3 CU (1.2 if steep); CM16/CM25 trigger |
| 24 | Curvature | Enum | 1 = Sharp Turn Present, 2 = No Sharp Turn | CM3 CU (1.5 if sharp); CM16 trigger |
| 25 | Tram or Train Rails | Enum | 1 = Present, 2 = Not Present | CM25 trigger (risk 1.5 if Present) |
| 26 | Street Lighting | Enum | 1 = Present, 2 = Not Present | CM3 CU (1.2 if absent); VB CU (1.2) |

### 6.54 Intersection

| # | Field name | Type | Values | Scoring use |
|---|---|---|---|---|
| 27 | Intersection Approach | Enum | 1 = Shared, 2 = Separate/NA | CM40 trigger; VB CB32/CB40 |
| 28 | Intersection or Road Crossing | Enum | 1 = Present, 2 = Not Present | CM3 CQ; CM40 trigger; VB CB26/CB49 |
| 29 | Crossing Facility | Enum | 1 = Present, 2 = Not Present | VB CU (1.2 if Not Present — adverse) |
| 30 | Property Access | Enum | 1 = Present, 2 = Not Present | CM3 CQ; CM40 trigger; VB CB40/CB49 |
| 31 | Pedestrian Crossing | Enum | 1 = Present, 2 = Not Present | CM3 CQ trigger |
| 32 | Intersecting Bicycle Facility | Enum | 1 = Present, 2 = Not Present | CM3 CQ trigger |
| 33 | Number of lanes – adjacent road | Enum | 1 = 1 per Direction/NA, 2 = > 1 per Direction | VB CU (1.2 if > 1) |
| 34 | Number of lanes – intersecting road | Enum | 1 = 1 per Direction/NA, 2 = > 1 per Direction | VB CU (1.2 if > 1) |

### 6.55 Flow & Speed

| # | Field name | Type | Values | Scoring use |
|---|---|---|---|---|
| 35 | Flow Direction | Enum | 1 = One Way, 2 = Two Way | CM3 CU (1.5 if Two Way); VB CU |
| 36 | Peak pedestrian flow along or across facility | Enum | 1 = None, 2 = Low, 3 = Moderate to high | CM3 CU (1.2 if Low; 1.5 if Moderate to high); BP trigger |
| 37 | Peak bicycle/LV traffic flow | Enum | 1 = Low, 2 = Moderate to high | CM3 CU (1.2 if moderate/high) |
| 38 | Observed proportion of cargo bikes and mopeds | Enum | 1 = Low, 2 = Moderate to high | CM3 CU (1.2 if moderate/high); BB severity |
| 39 | Heavy vehicle flow | Enum | 1 = Low, 2 = Moderate to high | VB CU (1.2 if moderate/high) |
| 40 | Bicycle/LV speed – average | Enum | 1 = < 20 km/h, 2 = ≥ 20 km/h | CM16/CM25 CU; BB/SB/VB severity (1.5) |
| 41 | Bicycle/LV speed differential | Enum | 1 = < 10 km/h, 2 = ≥ 10 km/h | CM3 CU (1.2 if high); BB severity |
| 42 | Road AADT | Numeric | Annual Average Daily Traffic (vehicles/day) | VB: stepped AADT lookup table |
| 43 | Road Operating Speed (mean) | Numeric | km/h or mph | VB: sigmoid speed risk formula |
| — | Road Operating Speed (unit) | Enum | 1 = km/h, 2 = mph | Unit for operating speed field |
| — | Road Speed Limit | Enum | NA, 10–120 km/h | Informational; displayed in UI |

> **Note:** Road speed limit, operating speed (mean), and the unit field are present in the data model but are not part of the 41 core CycleRAP scoring fields. Area type is also stored but not used in scoring.

---

## 6.6 `cyclerap_scoring.py` — Function Reference

| Function | Description |
|---|---|
| `calculate_cm3(row)` | Returns CM3 component (main cycling environment) |
| `calculate_cm16(row)` | Returns CM16 component (departure/fall) |
| `calculate_cm25(row)` | Returns CM25 component (speed-related incidents) |
| `calculate_cm40(row)` | Returns CM40 component (vehicle interaction) |
| `calculate_cyclerap_score(row, cm3, cm16, cm25, cm40)` | Returns `(BB, BP, SB, VB, total)` tuple |
| `calculate_risk_band_for_type(score, crash_type)` | Converts score to band (1–4) using type-specific thresholds |
| `calculate_cyclerap_score_native(attributes_df)` | **Main entry point.** Scores all rows; returns DataFrame with 10 columns |
| `get_aadt_risk_factor(aadt)` | Stepped AADT → risk factor lookup |
| `get_road_speed_risk_factor(speed)` | Sigmoid speed → risk factor |
| `get_risk(attr_key, value)` | Looks up risk multiplier from `LOOKUP_TABLES` |
| `get_cond(attr_key, value)` | Looks up condition flag from `LOOKUP_TABLES` |

### 6.61 Output Columns

`calculate_cyclerap_score_native()` returns a DataFrame with these 10 columns per row:

| Column | Type | Description |
|---|---|---|
| `BB` | float | Bicyclist–Bicyclist score (4 decimal places) |
| `BB Band` | int | BB risk band (1–4) |
| `BP` | float | Bicyclist–Pedestrian score |
| `BP Band` | int | BP risk band (1–4) |
| `SB` | float | Severe Hazard–Bicyclist score |
| `SB Band` | int | SB risk band (1–4) |
| `VB` | float | Vehicle–Bicyclist score |
| `VB Band` | int | VB risk band (1–4) |
| `Overall Risk Level` | float | Sum of BB + BP + SB + VB |
| `Overall Risk Level Band` | int | Maximum of the four band values |

---

## 6.7 Treatment Logic

The 25 predefined treatments (defined in `routes.py`) each have:
- **Triggers:** one or more sets of `{field: [allowed_values]}` conditions. If any trigger set matches, the treatment is applicable.
- **Effects:** `{field: new_value}` pairs applied to the segment's attributes before re-scoring.

Treatments are evaluated by `apply_treatments`, `apply_all_treatments`, and `preview_treatments` endpoints. The projected score change (before/after) is returned so the user can see the improvement.

### 6.71 Treatment List

| ID | Name | Key trigger condition |
|---|---|---|
| 1 | Upgrade to on-road bicycle lane with light segregation | Road shoulder or mixed traffic, no light segregation |
| 2 | Safety barrier (adjacent road 0–1m) | Bicycle lane/shoulder with adjacent road < 1m and intersection |
| 3 | Safety barrier (adjacent road 1–3m) | Bicycle lane/shoulder with adjacent road 1–3m and intersection |
| 4 | Upgrade to cycling-priority street | Sidewalk/multi-use path/shoulder/mixed traffic with property access |
| 5 | Upgrade to multi-use path | Sidewalk/multi-use path/shoulder/mixed traffic with property access |
| 6 | Upgrade to off-road bicycle path | Sidewalk/multi-use path/shoulder/mixed traffic with property access |
| 7 | Convert to one-way facility | On-road lane/shoulder/mixed traffic, two-way flow |
| 8 | Improve surface conditions | Loose or slippery surface present |
| 9 | Install light segregation | Light segregation not present |
| 10 | Install street lighting | Street lighting not present |
| 11 | Remove fixed obstacles | Fixed obstacle present |
| 12 | Remove non-fixed obstacles | Non-fixed obstacle present |
| 13 | Remove width restriction | Width restriction present |
| 14 | Improve facility access | Facility access inadequate |
| 15 | Redesign sharp curves | Curvature = sharp turn |
| 16 | Widen the facility | Facility width very narrow or narrow |
| 17 | Install protective barrier | Adjacent severe hazard 0–1m present |
| 18 | Improve delineation | Delineation not present |
| 19 | Review intersection approach | Intersection approach = shared |
| 20 | Improve crossing facility | Crossing facility not present |
| 21 | Evaluate grade separation | Intersection/road crossing present |
| 22 | Reconfigure/remove parking | Adjacent vehicle parking 0–1m present |
| 23 | Review tram/train rails | Tram/train rails present |
| 24 | Install traffic calming | On-road lane, intersection crossing, adjacent road 0–1m |
| 25 | Bicycle speed control | Bicycle speed ≥ 20 km/h |

---

## 6.8 Updating the CycleRAP Algorithm

When CycleRAP releases an updated risk scoring model (e.g., transitioning from v2.11 to a newer version), the development team must update the scoring module. The update process involves the following steps:

> For administrator instructions on when to trigger an update, see the [Admin Guide → Section 5: CycleRAP Algorithm](../admin/admin-cyclerap-algorithm.md).

1. **Reviewing the New Specifications**: Obtain the new CycleRAP methodology documentation or Excel reference tool.
2. **Updating `LOOKUP_TABLES`**: Modify the attribute-to-risk-factor dictionaries in `backend/app/services/cyclerap_scoring.py` to match the new multipliers.
3. **Adjusting Formula Equations**: If new formulas are introduced for intermediate components (e.g., `CM3`, `CM16`, `CM25`, `CM40`) or final scores (`BB`, `BP`, `SB`, `VB`), update the corresponding `calculate_cmX()` and `calculate_cyclerap_score()` functions.
4. **Modifying Attribute Definitions**: If the new model introduces new fields or changes the allowed values (enums) for existing fields, update the data model, including frontend forms and backend shapefile ingestion validation.
5. **Testing**: Validate the updated Python output against the new official CycleRAP reference tool (typically using a test batch of road segments) to ensure full fidelity.

---

## 6.9 Treatment Configuration

Treatments in PSAT simulate safety improvements on road segments. Each treatment has a set of **triggers** (conditions that must be met for the treatment to be applicable) and **effects** (attribute changes applied when the treatment is used).

Treatments are defined as a list of dictionaries in the backend. Each dictionary follows this schema:

```python
{
    "id": 1,
    "name": "Upgrade to on-road bicycle lane with light segregation",
    "triggers": [
        {"Facility Type": [5], "Light Segregation": [2]},
        {"Facility Type": [6], "Light Segregation": [2]}
    ],
    "effects": {"Facility Type": 4, "Light Segregation": 1, "Facility access": 1}
}
```

| Field | Type | Description |
|---|---|---|
| `id` | Integer | A unique 1-based identifier for the treatment |
| `name` | String | The display name shown in the Treatment Page |
| `triggers` | List[Dict] | A list of condition sets. If **any** dictionary matches the segment's attributes, the treatment is applicable (**OR logic** between list items) |
| `effects` | Dict | A dictionary of field–value pairs applied when the treatment is used (**1-based indices** from the attribute dropdowns) |

**Trigger Logic (AND / OR):**

- **OR Logic**: The `triggers` list is a collection of alternative conditions. If a segment satisfies any one of these dictionaries, the treatment becomes a "Recommended Treatment".
- **AND Logic**: Inside a single trigger dictionary, all specified fields must match. For example, `{"Facility Type": [5], "Light Segregation": [2]}` means the segment must be a Road Shoulder (5) **AND** have no Light Segregation (2).

*Layman's explanation: Triggers decide when a treatment is relevant to a road segment. Effects decide what gets changed when the treatment is applied. The OR/AND logic ensures treatments are only offered to segments where they would actually make a difference.*

---

## 6.10 How to Add a New Treatment

To add a new treatment to the system:

1. Open `backend/app/api/projects/routes.py`.
2. Find the `TREATMENTS = [...]` variable near the top of the file.
3. Append a new dictionary to the end of the list:
   - Ensure the `id` is the next available integer.
   - Use the correct attribute names as keys (matching the CSV headers).
   - Use the numeric indices for values (e.g. `1` for Present, `2` for Not Present).
4. If running in Docker, rebuild or restart the backend container to pick up the changes:
   ```bash
   docker compose restart backend
   ```

---

## 6.11 Implementation Details

The treatment logic is handled by the following endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/projects/<name>/treatments/preview` | Calculates the score change without saving |
| `POST /api/projects/<name>/treatments/apply` | Persists the treatment to the segment |
| `POST /api/projects/<name>/treatments/effectiveness` | Ranks treatments by how much they reduce risk across the project |

Internal matching logic:

```python
for trigger_set in treatment["triggers"]:
    if all(row.get(field) in allowed_values for field, allowed_values in trigger_set.items()):
        is_applicable = True
        break
```

*Layman's explanation: This code checks each treatment against the road segment's current coded values. If the segment's attributes match any of the trigger conditions, the treatment is offered as a recommended fix.*

