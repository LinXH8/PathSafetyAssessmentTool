# 6.9 Treatment Configuration

Treatments in PSAT are used to simulate safety improvements on road segments. Each treatment has a set of **triggers** (conditions that must be met for the treatment to be applicable) and **effects** (changes to the road attributes if the treatment is applied).

---

## Table of Contents

- [6.9 Structure of a Treatment](#69-structure-of-a-treatment)
- [6.10 How to Add a New Treatment](#610-how-to-add-a-new-treatment)
- [6.11 Implementation Details](#611-implementation-details)

---

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

### 6.91 Fields Explained

| Field | Type | Description |
|---|---|---|
| `id` | Integer | A unique 1-based identifier for the treatment. |
| `name` | String | The display name shown in the Treatment Page. |
| `triggers` | List[Dict] | A list of condition sets. If **any** dictionary in the list matches the segment's attributes, the treatment is applicable (**OR logic** between list items). |
| `effects` | Dict | A dictionary of field-value pairs. When applied, these attributes are updated to the specified values (**1-based indices** from the attribute dropdowns). |

### 6.92 Trigger Logic (AND/OR)

- **OR Logic**: The `triggers` list is a collection of alternative conditions. If a segment satisfies any one of these dictionaries, the treatment becomes a "Recommended Treatment".
- **AND Logic**: Inside a single trigger dictionary, all specified fields must match the segment's current values. For example, `{"Facility Type": [5], "Light Segregation": [2]}` means the segment must be a Road Shoulder (5) **AND** have no Light Segregation (2).

---

## 6.10 How to Add a New Treatment

To add a new treatment to the system, follow these steps:

1.  **Locate the Definitions**: Open `backend/app/api/projects/routes.py`.
2.  **Find the `TREATMENTS` List**: Search for the `TREATMENTS = [...]` variable near the top of the file.
3.  **Append a New Entry**: Add a new dictionary to the end of the list.
    - Ensure the `id` is the next available integer.
    - Use the correct attribute names as keys (matching the CSV headers).
    - Use the numeric indices for values (e.g., `1` for Present, `2` for Not Present).
4.  **Restart the Backend**: If running in Docker, rebuild or restart the container to pick up the changes.

---

## 6.11 Implementation Details

The treatment logic is handled by the following endpoints:
- `POST /api/projects/<name>/treatments/preview`: Calculates the score change without saving.
- `POST /api/projects/<name>/treatments/apply`: Persists the treatment to the segment.
- `POST /api/projects/<name>/treatments/effectiveness`: Ranks treatments by how much they reduce risk across the project.

```python
# Internal logic snippet
for trigger_set in treatment["triggers"]:
    if all(row.get(field) in allowed_values for field, allowed_values in trigger_set.items()):
        is_applicable = True
        break
```

*Layman's explanation: This document explains how to teach the computer new ways to fix road safety issues by defining what conditions need to be met and what changes should be made to the road's information.*
