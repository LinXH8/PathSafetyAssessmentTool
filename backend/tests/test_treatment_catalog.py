"""Unit tests for the CycleRAP v2.14 STM treatment catalog engine."""

import pandas as pd

from app.services.treatment_catalog import (
    TREATMENTS,
    TREATMENT_BY_ID,
    applicable_treatments,
    apply_treatment_effects,
    is_treatment_applicable,
    treatment_mask,
)


class TestCatalogShape:
    def test_thirty_treatments_with_v214_ids(self):
        assert [t["id"] for t in TREATMENTS] == list(range(1, 31))

    def test_id18_is_line_of_sight(self):
        # v2.14 inserted this treatment, shifting later IDs vs the old app list
        assert TREATMENT_BY_ID[18]["name"] == "Improve line of sight (sight distance)"
        assert TREATMENT_BY_ID[18]["effects"] == {"Line of Sight": 1}

    def test_every_treatment_has_trigger_sets(self):
        for t in TREATMENTS:
            assert t["trigger_sets"], f"T{t['id']} has no trigger sets"

    def test_vehicles_speed_control_requires_manual_value(self):
        t29 = TREATMENT_BY_ID[29]
        assert t29["requires_manual_value"] is True
        assert t29["effects"] == {}

    def test_traffic_calming_sets_numeric_speed(self):
        assert TREATMENT_BY_ID[27]["effects"] == {"Road operating speed (mean)": 30}
        assert TREATMENT_BY_ID[28]["effects"] == {"Road operating speed (mean)": 20}


class TestTriggerMatching:
    def test_simple_category_trigger(self):
        # T9 "Improve surface conditions" triggers on Loose/slippery Present
        t9 = TREATMENT_BY_ID[9]
        assert is_treatment_applicable({"Loose or slippery surface": 1}, t9)
        assert not is_treatment_applicable({"Loose or slippery surface": 2}, t9)

    def test_missing_attribute_fails_closed(self):
        t9 = TREATMENT_BY_ID[9]
        assert not is_treatment_applicable({}, t9)

    def test_redesign_curve_triggers_on_sharp_turn_alone(self):
        # Intentional LTA deviation from the STM (see treatment_catalog.py):
        # "Redesign the curve" (CM 17) applies whenever a sharp turn is present,
        # with no co-factor required, and never on "no sharp turn".
        t17 = TREATMENT_BY_ID[17]
        assert is_treatment_applicable({"Curvature": 1}, t17)
        assert not is_treatment_applicable({"Curvature": 2}, t17)
        assert not is_treatment_applicable({}, t17)

    def test_speed_range_trigger(self):
        # T27 traffic calming (km/h): facility 5/6, unit km/h, 30 < speed < 50
        t27 = TREATMENT_BY_ID[27]
        base = {
            "Facility Type": 5,
            "Road operating speed (unit)": 1,
            "Road operating speed (mean)": 40,
        }
        assert is_treatment_applicable(base, t27)
        assert not is_treatment_applicable({**base, "Road operating speed (mean)": 30}, t27)  # gt bound
        assert not is_treatment_applicable({**base, "Road operating speed (mean)": 50}, t27)  # lt bound
        assert not is_treatment_applicable({**base, "Road operating speed (mean)": None}, t27)

    def test_mph_treatments_inert_on_kmh_data(self):
        # Every mph-variant trigger set requires unit=2, so km/h segments
        # (unit=1 or missing, defaulting to 1) can never match.
        row = {
            "Facility Type": 6,
            "Intersection Approach": 1,
            "Intersection or Road Crossing": 1,
            "Peak bicycle/LV traffic flow": 2,
            "Road operating speed (mean)": 25,
        }
        for tid in (5, 28):
            assert not is_treatment_applicable(row, TREATMENT_BY_ID[tid])
        # same row coded in mph triggers the mph traffic calming
        assert is_treatment_applicable(
            {**row, "Road operating speed (unit)": 2}, TREATMENT_BY_ID[28]
        )

    def test_unit_defaults_to_kmh_when_missing(self):
        t27 = TREATMENT_BY_ID[27]
        row = {"Facility Type": 5, "Road operating speed (mean)": 40}
        assert is_treatment_applicable(row, t27)

    def test_applicable_treatments_hides_manual(self):
        # T29 "Vehicles speed control" triggers on operating speed > 70
        t29 = TREATMENT_BY_ID[29]
        row = {"Road operating speed (mean)": 80, "Road operating speed (unit)": 1}
        assert is_treatment_applicable(row, t29)
        assert all(t["id"] != 29 for t in applicable_treatments(row))
        assert any(t["id"] == 29 for t in applicable_treatments(row, include_manual=True))


class TestVectorizedMask:
    def test_mask_agrees_with_scalar(self):
        rows = [
            {"Loose or slippery surface": 1, "Facility Type": 5,
             "Road operating speed (unit)": 1, "Road operating speed (mean)": 40},
            {"Loose or slippery surface": 2, "Facility Type": 3,
             "Road operating speed (unit)": 1, "Road operating speed (mean)": 20},
            {"Loose or slippery surface": 1, "Facility Type": 6,
             "Road operating speed (unit)": 2, "Road operating speed (mean)": 25},
        ]
        df = pd.DataFrame(rows)
        for t in TREATMENTS:
            mask = treatment_mask(df, t)
            for i, row in enumerate(rows):
                assert bool(mask.iloc[i]) == is_treatment_applicable(row, t), \
                    f"T{t['id']} row {i}"

    def test_mask_missing_column_fails_closed(self):
        df = pd.DataFrame([{"Facility Type": 5}])
        t9 = TREATMENT_BY_ID[9]  # needs Loose or slippery surface
        assert not treatment_mask(df, t9).any()


class TestEffects:
    def test_apply_effects_overrides_and_preserves(self):
        row = {"Loose or slippery surface": 1, "Grade": 2}
        out = apply_treatment_effects(row, [9])
        assert out["Loose or slippery surface"] == 2
        assert out["Grade"] == 2
        assert row["Loose or slippery surface"] == 1  # input untouched

    def test_unknown_ids_ignored(self):
        assert apply_treatment_effects({"Grade": 1}, [999]) == {"Grade": 1}
