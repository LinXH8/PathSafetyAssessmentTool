"""Regression tests for dtype-safe cell writes into CSV-parsed attribute frames.

pandas >= 3 raises ``TypeError`` instead of silently upcasting when a value that
does not fit a column's dtype is assigned.  Attribute columns mix numeric codes
with label strings, and an all-empty column read back from ``attributes.csv`` is
``float64`` — so autocode writing ``"<=1.5m"`` into ``Facility Width Sub-category``
used to blow up.  ``serializer.set_cell`` / ``set_masked`` widen the column first.
"""
import io
from pathlib import Path
import sys

import pandas as pd


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import serializer  # noqa: E402


def _csv_frame() -> pd.DataFrame:
    csv = (
        "Area type,Facility Type,Facility Width Sub-category,Road speed limit\n"
        "1,Footpath,,50\n"
        "2,Shared Path,,60\n"
    )
    return pd.read_csv(io.StringIO(csv))


def test_set_cell_label_into_empty_float_column():
    df = _csv_frame()
    assert df["Facility Width Sub-category"].dtype == "float64"

    serializer.set_cell(df, 0, "Facility Width Sub-category", "≤1.5m")

    assert df.at[0, "Facility Width Sub-category"] == "≤1.5m"
    assert pd.isna(df.at[1, "Facility Width Sub-category"])


def test_set_cell_code_into_label_column_and_string_into_int_column():
    df = _csv_frame()

    serializer.set_cell(df, 0, "Facility Type", 3)
    serializer.set_cell(df, 1, "Road speed limit", "NA")

    assert df.at[0, "Facility Type"] == 3
    assert df.at[1, "Road speed limit"] == "NA"
    # untouched cells preserved
    assert df.at[1, "Facility Type"] == "Shared Path"
    assert df.at[0, "Road speed limit"] == 50


def test_set_cell_creates_missing_column():
    df = _csv_frame()

    serializer.set_cell(df, 0, "Curvature Sub-category", "Sharp Turn")

    assert df.at[0, "Curvature Sub-category"] == "Sharp Turn"


def test_set_masked_status_string_into_empty_column():
    df = _csv_frame()
    df["Gradient Status"] = pd.Series([float("nan"), float("nan")])  # float64, all empty
    assert df["Gradient Status"].dtype == "float64"

    serializer.set_masked(df, [True, False], "Gradient Status", "N/A (no LiDAR result)")

    assert df.at[0, "Gradient Status"] == "N/A (no LiDAR result)"
    assert pd.isna(df.at[1, "Gradient Status"])


def test_attributes_round_trip_preserves_written_label(tmp_path):
    attrs = serializer.Attributes(size=2)
    serializer.set_cell(attrs.df, 0, "Facility Width Sub-category", "≤1.5m")
    serializer.set_cell(attrs.df, 0, "Area type", 1)

    path = tmp_path / "attributes.csv"
    attrs.serialize(path)

    reloaded = serializer.Attributes()
    reloaded.parse(path)

    assert reloaded.df.at[0, "Facility Width Sub-category"] == "≤1.5m"
    assert pd.isna(reloaded.df.at[1, "Facility Width Sub-category"])


def test_parse_widens_all_empty_columns_to_object(tmp_path):
    path = tmp_path / "attributes.csv"
    path.write_text("Area type,Curvature Sub-category\n1,\n2,\n", encoding="utf-8")

    tbl = serializer.Attributes()
    tbl.parse(path)

    assert tbl.df["Curvature Sub-category"].dtype == object
    # a column with real data keeps its numeric dtype
    assert str(tbl.df["Area type"].dtype).startswith("int")
