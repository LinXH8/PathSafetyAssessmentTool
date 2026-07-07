from pathlib import Path
import sys

import geopandas as gpd
import pytest
from flask import Flask
from shapely.geometry import LineString, Point


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.projects import routes  # noqa: E402
from app.services.gis_mapping import GIS, LayerStore  # noqa: E402


class DummyStore:
    def __init__(self, layers):
        self.layers = layers

    def to_metric_point(self, point, input_crs=None):
        if isinstance(point, Point):
            return point
        return Point(point)

    def get(self, name):
        return self.layers.get(name, gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"))


class CaptureCurvatureRouteGIS:
    def __init__(self):
        self.curvature_point = None
        self.visualization_point = None
        self.curvature_calls = []

    def get_curvature(self, point, sharp_turn_threshold=10.0, default_value=2):
        self.curvature_calls.append(point)
        self.curvature_point = point
        return 1, "<10m"

    def get_curvature_visualization(self, point, collect_radius=5.0):
        self.visualization_point = point
        return {
            "point": {"lon": point.x, "lat": point.y},
            "radius": 8.0,
            "width": 2.0,
            "curvature": 1,
            "curvature_subcategory": "<10m",
            "circle_geojson": {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": []},
                "properties": {"radius_m": collect_radius, "style": {}},
            },
            "paths": [],
            "layer_used": "shared",
            "analysis_window_m": collect_radius,
        }


class EndOnlyCurvatureRouteGIS(CaptureCurvatureRouteGIS):
    def get_curvature(self, point, sharp_turn_threshold=10.0, default_value=2):
        self.curvature_calls.append(point)
        self.curvature_point = point
        if round(point.x, 6) == 12.0:
            return 1, "<10m"
        return 2, ">18m"


def test_analyze_curvature_flags_path_junction_without_sharp_radius(monkeypatch):
    gis = GIS(LayerStore())

    monkeypatch.setattr(
        gis,
        "_snap_point_to_path_network",
        lambda point, max_snap_distance=30.0: (
            point,
            {
                "point_was_snapped": False,
                "snap_distance_m": 0.0,
                "snap_layer": "footpath",
            },
        ),
    )

    monkeypatch.setattr(
        gis,
        "get_radius_and_width_at_point",
        lambda **kwargs: (
            25.0,
            2.5,
            {
                "layer_used": "footpath",
                "width_layer": "footpath",
                "first_geometry_layer": "footpath",
            },
        ),
    )
    monkeypatch.setattr(gis, "_check_angle_curvature", lambda point, collect_radius=5.0: (False, True))

    result = gis.analyze_curvature(Point(103.8, 1.3), include_diagnostics=False)

    assert result["curvature"] == 1
    assert result["subcategory"] == "Path Junction"
    assert result["layer_used"] == "footpath"


def test_analyze_curvature_defaults_to_no_sharp_when_no_signal(monkeypatch):
    gis = GIS(LayerStore())

    monkeypatch.setattr(
        gis,
        "_snap_point_to_path_network",
        lambda point, max_snap_distance=30.0: (
            point,
            {
                "point_was_snapped": False,
                "snap_distance_m": 0.0,
                "snap_layer": None,
            },
        ),
    )

    monkeypatch.setattr(
        gis,
        "get_radius_and_width_at_point",
        lambda **kwargs: (
            None,
            None,
            {
                "layer_used": None,
                "width_layer": None,
                "first_geometry_layer": None,
            },
        ),
    )
    monkeypatch.setattr(gis, "_check_angle_curvature", lambda point, collect_radius=5.0: (False, False))

    result = gis.analyze_curvature(Point(103.8, 1.3), include_diagnostics=False)

    assert result["curvature"] == 2
    assert result["subcategory"] is None


def test_curvature_visualization_uses_shared_analysis_result(monkeypatch):
    gis = GIS(LayerStore())

    monkeypatch.setattr(
        gis,
        "analyze_curvature",
        lambda point, sharp_turn_threshold=10.0, default_value=2, collect_radius=5.0, include_diagnostics=False: {
            "radius": 25.0,
            "width": 2.5,
            "input_point": Point(103.8, 1.3),
            "analysis_point": Point(103.81, 1.31),
            "point_was_snapped": True,
            "snap_distance_m": 4.0,
            "snap_layer": "footpath",
            "layer_used": "footpath",
            "width_layer": "footpath",
            "first_geometry_layer": "footpath",
            "curvature": 1,
            "subcategory": "Path Junction",
            "has_sharp_curve": False,
            "has_kink": False,
            "has_path_junction": True,
            "diagnostics": None,
        },
    )

    result = gis.get_curvature_visualization(Point(103.8, 1.3))

    assert result["curvature"] == 1
    assert result["radius"] == 25.0
    assert result["layer_used"] == "footpath"
    assert result["curvature_subcategory"] == "Path Junction"
    assert result["point_was_snapped"] is True


def test_supports_sharp_curve_details_rejects_single_triplet_noise():
    gis = GIS(LayerStore())

    details = {
        "min_triplet": {
            "index": 2,
            "radius": 5.4,
            "points": [(0.0, 0.0), (1.0, 0.0), (2.0, 0.1)],
        },
        "all_triplets": [
            {
                "index": 2,
                "radius": 5.4,
                "points": [(0.0, 0.0), (1.0, 0.0), (2.0, 0.1)],
            },
        ],
    }

    assert gis._supports_sharp_curve_details(details, sharp_turn_threshold=10.0) is False


def test_supports_sharp_curve_details_accepts_sustained_heading_change():
    gis = GIS(LayerStore())

    details = {
        "min_triplet": {
            "index": 1,
            "radius": 5.8,
            "points": [(0.0, 0.0), (1.0, 0.0), (1.9, 0.3)],
        },
        "all_triplets": [
            {
                "index": 0,
                "radius": 6.2,
                "points": [(-1.0, 0.0), (0.0, 0.0), (1.0, 0.0)],
            },
            {
                "index": 1,
                "radius": 5.8,
                "points": [(0.0, 0.0), (1.0, 0.0), (1.9, 0.3)],
            },
            {
                "index": 2,
                "radius": 5.6,
                "points": [(1.0, 0.0), (1.9, 0.3), (2.6, 0.9)],
            },
            {
                "index": 3,
                "radius": 5.7,
                "points": [(1.9, 0.3), (2.6, 0.9), (3.0, 1.8)],
            },
        ],
    }

    assert gis._supports_sharp_curve_details(details, sharp_turn_threshold=10.0) is True


def test_radius_uses_connected_segments_across_path_layers():
    layers = {
        "cycling_path": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
        "footpath": gpd.GeoDataFrame(
            {"WIDTH": [2.0]},
            geometry=[LineString([(-5.0, 0.0), (-2.0, 0.0), (-1.848, 0.765), (-1.414, 1.414)])],
            crs="EPSG:3414",
        ),
        "shared_path": gpd.GeoDataFrame(
            {"WIDTH": [3.0]},
            geometry=[LineString([(-1.414, 1.414), (-0.765, 1.848), (0.0, 2.0), (0.0, 5.0)])],
            crs="EPSG:3414",
        ),
    }

    gis = GIS(DummyStore(layers))

    radius, width, details = gis.get_radius_and_width_at_point(
        Point(-2.0, 0.0),
        return_details=True,
    )

    assert width == 2.0
    assert radius is not None
    assert 1.0 <= radius < 10.0
    assert details["layer_used"] == "footpath"
    assert set(details["analysis_layers"]) == {"footpath", "shared"}


def test_analyze_curvature_uses_numeric_bucket_when_sharp_radius_and_junction_both_exist(monkeypatch):
    gis = GIS(LayerStore())

    monkeypatch.setattr(
        gis,
        "_snap_point_to_path_network",
        lambda point, max_snap_distance=30.0: (
            point,
            {
                "point_was_snapped": False,
                "snap_distance_m": 0.0,
                "snap_layer": "shared",
            },
        ),
    )

    monkeypatch.setattr(
        gis,
        "get_radius_and_width_at_point",
        lambda **kwargs: (
            8.0,
            2.5,
            {
                "layer_used": "shared",
                "width_layer": "shared",
                "first_geometry_layer": "shared",
            },
        ),
    )
    monkeypatch.setattr(gis, "_check_angle_curvature", lambda point, collect_radius=5.0: (False, True))

    result = gis.analyze_curvature(Point(103.8, 1.3), include_diagnostics=False)

    assert result["curvature"] == 1
    assert result["subcategory"] == "<10m"
    assert result["has_path_junction"] is True


def test_analyze_curvature_uses_tight_bucket_for_sub_6_5m_radius(monkeypatch):
    gis = GIS(LayerStore())

    monkeypatch.setattr(
        gis,
        "_snap_point_to_path_network",
        lambda point, max_snap_distance=30.0: (
            point,
            {
                "point_was_snapped": False,
                "snap_distance_m": 0.0,
                "snap_layer": "shared",
            },
        ),
    )

    monkeypatch.setattr(
        gis,
        "get_radius_and_width_at_point",
        lambda **kwargs: (
            5.2,
            2.5,
            {
                "layer_used": "shared",
                "width_layer": "shared",
                "first_geometry_layer": "shared",
            },
        ),
    )
    monkeypatch.setattr(gis, "_check_angle_curvature", lambda point, collect_radius=5.0: (False, True))

    result = gis.analyze_curvature(Point(103.8, 1.3), include_diagnostics=False)

    assert result["curvature"] == 1
    assert result["subcategory"] == "<6.5m"
    assert result["has_path_junction"] is True


def test_analyze_curvature_prefers_primary_corridor_over_side_branch_radius():
    main_left = LineString([
        (-10.260604, 1.809221),
        (-5.209445, 0.455767),
        (0.0, 0.0),
    ])
    main_right = LineString([
        (0.0, 0.0),
        (5.209445, 0.455767),
        (10.260604, 1.809221),
    ])
    branch = LineString([
        (0.0, 0.0),
        (0.0, 3.0),
        (3.0, 3.0),
    ])

    layers = {
        "cycling_path": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
        "footpath": gpd.GeoDataFrame(
            {"WIDTH": [2.0, 2.0]},
            geometry=[main_left, main_right],
            crs="EPSG:3414",
        ),
        "shared_path": gpd.GeoDataFrame(
            {"WIDTH": [3.0]},
            geometry=[branch],
            crs="EPSG:3414",
        ),
    }

    gis = GIS(DummyStore(layers))
    point = Point(-5.209445, 0.455767)

    radius, width, details = gis.get_radius_and_width_at_point(point, return_details=True)
    result = gis.analyze_curvature(point, include_diagnostics=False)

    assert width == 2.0
    assert radius is not None
    assert 18.0 < radius < 40.0
    assert details["layer_used"] == "footpath"
    assert details["analysis_layers"] == ["footpath"]
    assert result["curvature"] == 1
    assert result["subcategory"] == "Path Junction"
    assert result["has_path_junction"] is True
    assert result["has_kink"] is False
    assert result["radius"] is not None and result["radius"] > 18.0


def test_snap_point_to_path_network_uses_nearest_centreline():
    layers = {
        "cycling_path": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
        "shared_path": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
        "footpath": gpd.GeoDataFrame(
            {"WIDTH": [2.0]},
            geometry=[LineString([(10.0, -5.0), (10.0, 5.0)])],
            crs="EPSG:3414",
        ),
    }

    gis = GIS(DummyStore(layers))

    snapped_point, snap_info = gis._snap_point_to_path_network(Point(0.0, 0.0), max_snap_distance=15.0)

    assert round(snapped_point.x, 6) == 10.0
    assert round(snapped_point.y, 6) == 0.0
    assert snap_info["point_was_snapped"] is True
    assert round(snap_info["snap_distance_m"], 6) == 10.0
    assert snap_info["snap_layer"] == "footpath"


def test_check_angle_curvature_detects_junction_with_short_endpoint_stub():
    layers = {
        "cycling_path": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
        "shared_path": gpd.GeoDataFrame(
            {"WIDTH": [3.0, 3.0]},
            geometry=[
                LineString([(0.0, 0.0), (1.0, 0.0), (3.0, 0.0)]),
                LineString([(0.0, 0.0), (0.0, 1.0), (0.0, 3.0)]),
            ],
            crs="EPSG:3414",
        ),
        "footpath": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
    }

    gis = GIS(DummyStore(layers))

    has_kink, has_junction = gis._check_angle_curvature(Point(0.1, 0.1), collect_radius=2.0)

    assert has_kink is False
    assert has_junction is True


def test_check_angle_curvature_detects_junction_with_split_short_arm():
    layers = {
        "cycling_path": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
        "shared_path": gpd.GeoDataFrame(
            {"WIDTH": [3.0, 3.0]},
            geometry=[
                LineString([(0.0, 0.0), (1.24, 0.0)]),
                LineString([(0.0, 0.0), (0.0, 3.0)]),
            ],
            crs="EPSG:3414",
        ),
        "footpath": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
    }

    gis = GIS(DummyStore(layers))

    has_kink, has_junction = gis._check_angle_curvature(Point(0.2, 0.2), collect_radius=2.0)

    assert has_kink is False
    assert has_junction is True


def test_check_angle_curvature_detects_shallow_y_junction():
    layers = {
        "cycling_path": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
        "shared_path": gpd.GeoDataFrame(
            {"WIDTH": [3.0, 3.0]},
            geometry=[
                LineString([(0.0, 0.0), (3.0, 0.0)]),
                LineString([(0.0, 0.0), (2.598, 1.5)]),
            ],
            crs="EPSG:3414",
        ),
        "footpath": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
    }

    gis = GIS(DummyStore(layers))

    has_kink, has_junction = gis._check_angle_curvature(Point(0.1, 0.1), collect_radius=2.0)

    assert has_kink is False
    assert has_junction is True


def test_check_angle_curvature_detects_branch_at_internal_vertex():
    layers = {
        "cycling_path": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
        "shared_path": gpd.GeoDataFrame(
            {"WIDTH": [3.0, 3.0]},
            geometry=[
                LineString([(-3.0, 0.0), (0.0, 0.0), (3.0, 0.0)]),
                LineString([(0.0, 0.0), (0.0, 3.0)]),
            ],
            crs="EPSG:3414",
        ),
        "footpath": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
    }

    gis = GIS(DummyStore(layers))

    has_kink, has_junction = gis._check_angle_curvature(Point(0.1, 0.1), collect_radius=2.0)

    assert has_kink is False
    assert has_junction is True


def test_check_angle_curvature_detects_unnoded_intersection_junction():
    layers = {
        "cycling_path": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
        "shared_path": gpd.GeoDataFrame(
            {"WIDTH": [3.0, 3.0]},
            geometry=[
                LineString([(-3.0, 0.0), (3.0, 0.0)]),
                LineString([(0.0, -3.0), (0.0, 3.0)]),
            ],
            crs="EPSG:3414",
        ),
        "footpath": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
    }

    gis = GIS(DummyStore(layers))

    has_kink, has_junction = gis._check_angle_curvature(Point(0.1, 0.1), collect_radius=2.0)

    assert has_kink is False
    assert has_junction is True


def test_check_angle_curvature_ignores_shallow_unnoded_intersection():
    layers = {
        "cycling_path": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
        "shared_path": gpd.GeoDataFrame(
            {"WIDTH": [3.0, 3.0]},
            geometry=[
                LineString([(-3.0, 0.0), (3.0, 0.0)]),
                LineString([(-2.598, -1.5), (2.598, 1.5)]),
            ],
            crs="EPSG:3414",
        ),
        "footpath": gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:3414"),
    }

    gis = GIS(DummyStore(layers))

    has_kink, has_junction = gis._check_angle_curvature(Point(0.1, 0.1), collect_radius=2.0)

    assert has_kink is False
    assert has_junction is False


def test_autocode_gis_anchors_curvature_to_segment_start(monkeypatch):
    app = Flask(__name__)
    fake_gis = CaptureCurvatureRouteGIS()

    monkeypatch.setattr(routes, "_get_gis", lambda: fake_gis)

    with app.test_request_context(json={
        "coords": [[103.8, 1.3], [103.8005, 1.3005]],
        "fields": ["Curvature", "Curvature Sub-category"],
    }):
        response, status = routes.autocode_gis("TestProject")

    assert status == 200
    payload = response.get_json()
    assert payload["updates"]["Curvature"] == 1
    assert payload["updates"]["Curvature Sub-category"] == "<10m"
    assert fake_gis.curvature_calls
    assert fake_gis.curvature_calls[0].x == pytest.approx(103.8)
    assert fake_gis.curvature_calls[0].y == pytest.approx(1.3)


def test_curvature_visualization_route_anchors_to_segment_start(monkeypatch):
    app = Flask(__name__)
    fake_gis = CaptureCurvatureRouteGIS()

    monkeypatch.setattr(routes, "_get_gis", lambda: fake_gis)

    with app.test_request_context(json={
        "coords": [[103.8, 1.3], [103.8005, 1.3005]],
    }):
        response, status = routes.get_curvature_visualization("TestProject")

    assert status == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert fake_gis.visualization_point is not None
    assert fake_gis.visualization_point.x == pytest.approx(103.8)
    assert fake_gis.visualization_point.y == pytest.approx(1.3)


def test_autocode_gis_scans_segment_for_curvature_signal(monkeypatch):
    app = Flask(__name__)
    fake_gis = EndOnlyCurvatureRouteGIS()

    monkeypatch.setattr(routes, "_get_gis", lambda: fake_gis)

    with app.test_request_context(json={
        "coords": [[0.0, 0.0], [12.0, 0.0]],
        "fields": ["Curvature", "Curvature Sub-category"],
    }):
        response, status = routes.autocode_gis("TestProject")

    assert status == 200
    payload = response.get_json()
    assert payload["updates"]["Curvature"] == 1
    assert payload["updates"]["Curvature Sub-category"] == "<10m"
    assert [point.x for point in fake_gis.curvature_calls] == pytest.approx([0.0, 5.0, 10.0, 12.0])


def test_curvature_visualization_route_uses_best_segment_probe(monkeypatch):
    app = Flask(__name__)
    fake_gis = EndOnlyCurvatureRouteGIS()

    monkeypatch.setattr(routes, "_get_gis", lambda: fake_gis)

    with app.test_request_context(json={
        "coords": [[0.0, 0.0], [12.0, 0.0]],
    }):
        response, status = routes.get_curvature_visualization("TestProject")

    assert status == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert fake_gis.visualization_point is not None
    assert fake_gis.visualization_point.x == pytest.approx(12.0)
    assert fake_gis.visualization_point.y == pytest.approx(0.0)