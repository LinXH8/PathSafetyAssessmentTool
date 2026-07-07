from pathlib import Path
import sys
from types import SimpleNamespace

from flask import Flask
import geopandas as gpd
import pandas as pd
from shapely.geometry import LineString, Point


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.projects import routes  # noqa: E402


def test_parse_selection_geometry_preserves_lines():
    geometry, selection_area, selection_kind = routes._parse_selection_geometry(
        selection_geometry_payload={
            "type": "LineString",
            "coordinates": [
                [103.8, 1.3],
                [103.801, 1.3],
            ],
        }
    )

    assert geometry.geom_type == "LineString"
    assert selection_kind == "line"
    assert selection_area.equals(geometry)


def test_build_selection_filter_geometry_buffers_lines_tightly():
    geometry, _, selection_kind = routes._parse_selection_geometry(
        selection_geometry_payload={
            "type": "LineString",
            "coordinates": [
                [103.8, 1.3],
                [103.801, 1.3],
            ],
        }
    )

    selection_filter = routes._build_selection_filter_geometry(geometry, selection_kind)

    assert selection_filter["kind"] == "line"
    assert selection_filter["geometry"].equals(geometry)
    assert not selection_filter["metric_geometry"].is_empty


def test_filter_geo_points_by_selection_area_keeps_points_within_tight_line_tolerance():
    geo_points = gpd.GeoDataFrame(
        {
            "filename": ["on_line.jpg", "near_line.jpg", "far_from_line.jpg"],
        },
        geometry=[
            Point(103.8, 1.3),
            Point(103.8004, 1.30002),
            Point(103.8004, 1.3002),
        ],
        crs="EPSG:4326",
    )

    geometry, _, selection_kind = routes._parse_selection_geometry(
        selection_geometry_payload={
            "type": "LineString",
            "coordinates": [
                [103.8, 1.3],
                [103.801, 1.3],
            ],
        }
    )

    selection_area = routes._build_selection_filter_geometry(geometry, selection_kind)

    filtered = routes._filter_geo_points_by_selection_area(geo_points, selection_area)

    assert list(filtered["filename"]) == ["on_line.jpg", "near_line.jpg"]


def test_resolve_source_folder_dir_matches_unique_survey_suffix(tmp_path):
    (tmp_path / "SERANGOON AVENUE 1_1Q2026").mkdir()
    (tmp_path / "BOUNDARY ROAD").mkdir()

    resolved = routes._resolve_source_folder_dir(tmp_path, "SERANGOON AVENUE 1")
    exact = routes._resolve_source_folder_dir(tmp_path, "BOUNDARY ROAD")

    assert resolved == tmp_path / "SERANGOON AVENUE 1_1Q2026"
    assert exact == tmp_path / "BOUNDARY ROAD"


def test_build_project_geo_data_from_points_skips_undersized_postfilter_result(monkeypatch):
    geo_points = gpd.GeoDataFrame(
        {
            "latitude": [1.3],
            "longitude": [103.8],
            "filename": ["single.jpg"],
        },
        geometry=[Point(103.8, 1.3)],
        crs="EPSG:4326",
    )

    monkeypatch.setattr(routes.cycleRAP_VA, "geoCode", lambda df: df)
    monkeypatch.setattr(routes.cycleRAP_VA, "get_geo_points_by_distance", lambda df, min_distance=10: pd.DataFrame())

    result = routes._build_project_geo_data_from_points(geo_points, "Tiny Folder")

    assert result.empty
    assert list(result.columns) == ["LATITUDE", "LONGITUDE", "FILENAME", "geometry"]


def test_get_matching_road_reference_points_uses_line_distance(monkeypatch):
    road_points = gpd.GeoDataFrame(
        {
            "road_name": ["Path Road", "Path Road", "Parallel Road"],
            "lat": [1.3, 1.30002, 1.3002],
            "lon": [103.8, 103.8004, 103.8004],
        },
        geometry=[
            Point(103.8, 1.3),
            Point(103.8004, 1.30002),
            Point(103.8004, 1.3002),
        ],
        crs="EPSG:4326",
    )
    monkeypatch.setattr(routes, "_ROAD_REFERENCE_POINTS_GDF", road_points)
    monkeypatch.setattr(routes, "_ROAD_REFERENCE_POINTS_GDF_3414", road_points.to_crs(epsg=3414))

    geometry, _, selection_kind = routes._parse_selection_geometry(
        selection_geometry_payload={
            "type": "LineString",
            "coordinates": [
                [103.8, 1.3],
                [103.801, 1.3],
            ],
        }
    )

    matched = routes._get_matching_road_reference_points(geometry, selection_kind)

    assert list(matched["road_name"]) == ["Path Road", "Path Road"]


def test_roads_in_polygon_line_selection_includes_shapefile_only_roads(monkeypatch, tmp_path):
    road_points = gpd.GeoDataFrame(
        {
            "road_name": ["Path Road", "Path Road", "Parallel Road"],
            "lat": [1.3, 1.30002, 1.3002],
            "lon": [103.8, 103.8004, 103.8004],
        },
        geometry=[
            Point(103.8, 1.3),
            Point(103.8004, 1.30002),
            Point(103.8004, 1.3002),
        ],
        crs="EPSG:4326",
    )
    monkeypatch.setattr(routes, "_ROAD_REFERENCE_POINTS_GDF", road_points)
    monkeypatch.setattr(routes, "_ROAD_REFERENCE_POINTS_GDF_3414", road_points.to_crs(epsg=3414))
    monkeypatch.setattr(
        routes,
        "get_ctx",
        lambda: {"pm": SimpleNamespace(in_path=tmp_path)},
    )
    monkeypatch.setattr(
        routes,
        "_get_road_sections_gdf",
        lambda: gpd.GeoDataFrame(
            {
                "RD_NAM": ["Cross Road"],
            },
            geometry=[LineString([(103.8005, 1.2995), (103.8005, 1.3005)])],
            crs="EPSG:4326",
        ),
    )

    (tmp_path / "Path Road").mkdir()

    app = Flask(__name__)
    with app.test_request_context(
        json={
            "selection_geometry": {
                "type": "LineString",
                "coordinates": [
                    [103.8, 1.3],
                    [103.801, 1.3],
                ],
            }
        }
    ):
        response, status = routes.roads_in_polygon()

    payload = response.get_json()
    assert status == 200
    assert payload["fallback"] is False
    assert payload["roads"] == [
        {"name": "Cross Road", "points": 1, "exists": False},
        {"name": "Path Road", "points": 2, "exists": True},
    ]


def test_parse_selection_geometry_preserves_polygon_selection_area():
    geometry, selection_area, selection_kind = routes._parse_selection_geometry(
        polygon_coords=[
            [1.3, 103.8],
            [1.301, 103.8],
            [1.301, 103.801],
            [1.3, 103.8],
        ]
    )

    assert selection_kind == "polygon"
    assert geometry.equals(selection_area)