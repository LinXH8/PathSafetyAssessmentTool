"""Unit tests for the CycleRAP v2.14 scoring engine.

Golden values come from the supplier workbook's own cached outputs
(`CycleRAP - model - generation v2.14-to supliers.xlsm`); full workbook parity
is exercised separately by scripts/numerical_parity_v214.py.
"""

import pandas as pd
import pytest

from app.services import cyclerap_scoring as cs
from app.services.cyclerap_scoring import (
    calculate_cyclerap_score,
    calculate_cyclerap_score_native,
    calculate_cm3,
    calculate_cm17,
    calculate_cm27,
    calculate_cm42,
    calculate_risk_band_for_type,
    get_aadt_risk_factor,
    get_road_speed_risk_factor,
)


def workbook_segment() -> dict:
    """The coded segment stored in the workbook (CycleRAP Model column O)."""
    return {
        cs.FACILITY_TYPE: 2, cs.FACILITY_ACCESS: 2, cs.LOOSE_SURFACE: 2,
        cs.TRAM_RAILS: 2, cs.SURFACE_DEFORMATION: 1, cs.FIXED_OBSTACLE: 2,
        cs.NON_FIXED_OBSTACLE: 2, cs.LINE_OF_SIGHT: 2, cs.DELINEATION: 1,
        cs.LIGHT_SEGREGATION: 1, cs.FACILITY_WIDTH: 2, cs.FLOW_DIRECTION: 2,
        cs.WIDTH_RESTRICTION: 2, cs.ADJACENT_ROAD_0_1M: 2,
        cs.ADJACENT_PARKING_0_1M: 2, cs.ADJACENT_HAZARD_0_1M: 2,
        cs.ADJACENT_OBJECT_0_1M: 2, cs.ADJACENT_SIDEWALK_0_1M: 2,
        cs.ADJACENT_ROAD_1_3M: 1, cs.ADJACENT_PARKING_1_3M: 2,
        cs.ADJACENT_HAZARD_1_3M: 2, cs.ADJACENT_OBJECT_1_3M: 2,
        cs.ADJACENT_SIDEWALK_1_3M: 2, cs.GRADE: 1, cs.CURVATURE: 2,
        cs.STREET_LIGHTING: 1, cs.PEDESTRIAN_CROSSING: 2,
        cs.INTERSECTING_FACILITY: 1, cs.INTERSECTION_APPROACH: 2,
        cs.INTERSECTION_CROSSING: 2, cs.CROSSING_FACILITY: 1,
        cs.NUM_LANES_ADJACENT: 1, cs.NUM_LANES_INTERSECTING: 1,
        cs.PROPERTY_ACCESS: 2, cs.PEDESTRIAN_FLOW: 2, cs.BICYCLE_FLOW: 2,
        cs.CARGO_BIKES: 1, cs.BICYCLE_SPEED: 1, cs.SPEED_DIFFERENTIAL: 1,
        cs.ROAD_AADT: 1500, cs.HEAVY_VEHICLE: 1, cs.ROAD_SPEED: 0,
        cs.SPEED_UNIT: 1,
    }


def score_row(row_dict):
    row = pd.Series(row_dict)
    return calculate_cyclerap_score(
        row, calculate_cm3(row), calculate_cm17(row),
        calculate_cm27(row), calculate_cm42(row),
    )


class TestWorkbookGoldenSegment:
    def test_scores_match_workbook_cache(self):
        bb, bp, sb, vb, total = score_row(workbook_segment())
        assert bb == pytest.approx(5.101190092189757, abs=1e-9)
        assert bp == pytest.approx(5.101190092189757, abs=1e-9)
        assert sb == pytest.approx(7.541251577384579, abs=1e-9)
        assert vb == pytest.approx(2.9129312906989084, abs=1e-9)
        assert total == pytest.approx(20.656563052463, abs=1e-9)

    def test_native_dataframe_entry_point(self):
        df = calculate_cyclerap_score_native(pd.DataFrame([workbook_segment()]))
        assert df["Overall Risk Level"].iloc[0] == pytest.approx(20.6566, abs=1e-4)
        # BB 5.1012 -> Medium (>5); VB 2.91 -> Low; overall band = max
        assert df["BB Band"].iloc[0] == 2
        assert df["VB Band"].iloc[0] == 1
        assert df["Overall Risk Level Band"].iloc[0] == 2


class TestBandThresholds:
    """v2.14 bands are inclusive upper bounds (BU4/BU9/BU18/BU29)."""

    @pytest.mark.parametrize("crash", ["BB", "BP", "SB"])
    def test_bb_bp_sb_boundaries(self, crash):
        assert calculate_risk_band_for_type(5.0, crash) == 1
        assert calculate_risk_band_for_type(5.0001, crash) == 2
        assert calculate_risk_band_for_type(10.0, crash) == 2
        assert calculate_risk_band_for_type(10.0001, crash) == 3
        assert calculate_risk_band_for_type(20.0, crash) == 3
        assert calculate_risk_band_for_type(20.0001, crash) == 4

    def test_vb_boundaries(self):
        assert calculate_risk_band_for_type(10.0, "VB") == 1
        assert calculate_risk_band_for_type(10.0001, "VB") == 2
        assert calculate_risk_band_for_type(25.0, "VB") == 2
        assert calculate_risk_band_for_type(25.0001, "VB") == 3
        assert calculate_risk_band_for_type(60.0, "VB") == 3
        assert calculate_risk_band_for_type(60.0001, "VB") == 4


class TestSpeedRiskTable:
    """v2.14 replaced the sigmoid with a fixed 0-150 lookup (km/h + mph)."""

    def test_known_values(self):
        assert get_road_speed_risk_factor(0, unit=1) == pytest.approx(1.0)
        assert get_road_speed_risk_factor(50, unit=1) == pytest.approx(6.587603695027646)
        assert get_road_speed_risk_factor(20, unit=2) == pytest.approx(2.1308214755690544)

    def test_rounds_half_away_from_zero(self):
        # Excel ROUND(49.5) = 50
        assert get_road_speed_risk_factor(49.5, unit=1) == get_road_speed_risk_factor(50, unit=1)
        assert get_road_speed_risk_factor(49.4, unit=1) == get_road_speed_risk_factor(49, unit=1)

    def test_clamps_out_of_range(self):
        assert get_road_speed_risk_factor(500, unit=1) == get_road_speed_risk_factor(150, unit=1)
        assert get_road_speed_risk_factor(-5, unit=1) == get_road_speed_risk_factor(0, unit=1)

    def test_none_and_garbage_default_to_1(self):
        assert get_road_speed_risk_factor(None) == 1.0
        assert get_road_speed_risk_factor("n/a") == 1.0


class TestAadtTable:
    def test_breakpoints(self):
        assert get_aadt_risk_factor(0) == pytest.approx(0.25)
        assert get_aadt_risk_factor(1500) == pytest.approx(0.75)
        assert get_aadt_risk_factor(2499) == pytest.approx(0.75)
        assert get_aadt_risk_factor(2500) == pytest.approx(1.0)
        # +7% compounding: verified byte-exact against the workbook
        assert get_aadt_risk_factor(40000) == pytest.approx(2.252191588960824)
        assert get_aadt_risk_factor(10**7) == pytest.approx(2.252191588960824)


class TestCU52DelineationParkingRule:
    """CM42's delineation factor is 1.2 ONLY when Delineation is Present AND
    Adjacent vehicle parking 0-1m is Present (`=IF(AND(CT52=1,CT45=1),1.2,1)`)."""

    def _cm42_row(self, delineation, parking):
        row = workbook_segment()
        row[cs.DELINEATION] = delineation
        row[cs.ADJACENT_PARKING_0_1M] = parking
        return pd.Series(row)

    def test_both_present_applies_1_2(self):
        base = calculate_cm42(self._cm42_row(2, 1))
        both = calculate_cm42(self._cm42_row(1, 1))
        # parking present adds its own 1.5 factor in both cases; the extra 1.2
        # only appears when delineation is ALSO present. The workbook segment
        # has exactly one CM42 trigger firing (adjacent road 1-3m), so the
        # product exponent is 1 + 0.1 = 1.1.
        assert both / base == pytest.approx(1.2 ** 1.1, rel=1e-9)

    def test_delineation_alone_is_neutral_in_cm42(self):
        assert calculate_cm42(self._cm42_row(1, 2)) == pytest.approx(
            calculate_cm42(self._cm42_row(2, 2)), abs=1e-12
        )


class TestFacilityTypeColumns:
    def test_mixed_traffic_triggers_cm42(self):
        row = workbook_segment()
        # Remove all other CM42 triggers
        row[cs.ADJACENT_ROAD_1_3M] = 2
        assert calculate_cm42(pd.Series(row)) == 0
        row[cs.FACILITY_TYPE] = 6  # Mixed traffic road lane: DR conditional = 1
        assert calculate_cm42(pd.Series(row)) > 0

    def test_vb_severity_column(self):
        # Sidewalk/MUP/off-road get vb_sev 0.8; on-road/shoulder/mixed get 1.0
        assert cs.LOOKUP_TABLES["facility_type"][1]["vb_sev"] == pytest.approx(0.8)
        assert cs.LOOKUP_TABLES["facility_type"][6]["vb_sev"] == pytest.approx(1.0)
        assert cs.LOOKUP_TABLES["facility_type"][6]["vb_cf"] == pytest.approx(1.2)
