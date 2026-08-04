# gis_mapping.py
from __future__ import annotations
import math
import geopandas as gpd
from shapely.geometry import Point, LineString
from pathlib import Path
import numpy as np
import pandas as pd


# Curvature/width logic is delegated to dedicated analyzer classes.
from app.services.curvature_analyzer import CurvatureAnalyzer
from app.services.width_analyzer import WidthAnalyzer


def _load_gdf_cached(path_str: str, metric_crs: str, src_mtime: float):
    """Load shapefile → reproject → warm sindex.  Uses parquet cache for speed."""
    shp = Path(path_str)
    cache = shp.with_name(shp.stem + ".cache.parquet")

    # Fast path: read from parquet cache (skips shapefile parsing + CRS conversion)
    if cache.exists():
        try:
            if cache.stat().st_mtime >= src_mtime:
                gdf = gpd.read_parquet(cache)
                _ = gdf.sindex
                return gdf
        except Exception:
            pass  # corrupt / incompatible cache → fall through

    # Read shapefile via pyogrio (C-level GDAL reader — releases GIL, ~5x faster than fiona)
    gdf = gpd.read_file(path_str, engine="pyogrio")
    if gdf.crs is None:
        raise ValueError(f"{shp.name} missing CRS")
    gdf = gdf.to_crs(metric_crs)
    _ = gdf.sindex

    # Write parquet cache for next startup
    try:
        gdf.to_parquet(cache)
    except Exception:
        pass

    return gdf

CRS_WGS84 = "EPSG:4326"
CRS_METRIC = "EPSG:3414"

class LayerStore:
    """Lazy-loading shapefile store with parquet caching."""
    def __init__(self, metric_crs=CRS_METRIC):
        self.metric_crs = metric_crs
        self.paths: dict[str, Path] = {}
        self.layers: dict[str, gpd.GeoDataFrame] = {}
        # Added for Road Operating Speed (mean)
        self.speed_data: pd.DataFrame | None = None  # Cache for speed CSV data

    def add_path(self, name: str, path: str | Path):
        self.paths[name] = Path(path)

    # Added for Road Operating Speed (mean)
    def set_speed_csv(self, csv_path: str | Path):
        """Load and cache the speed CSV data for Road Operating Speed (mean)"""
        csv_path = Path(csv_path)
        if not csv_path.exists():
            raise FileNotFoundError(f"Speed CSV not found: {csv_path}")

        # Read CSV - first row contains headers
        df = pd.read_csv(csv_path)

        # Convert LINKID to string for matching
        if 'LINKID' in df.columns:
            df['LINKID'] = df['LINKID'].astype(str)
            # Index by LINKID for quick lookup
            self.speed_data = df.set_index('LINKID')
        else:
            raise ValueError(f"Speed CSV missing LINKID column. Found columns: {df.columns.tolist()}")

    def get(self, name: str):
        """Lazy load: reads from parquet cache or shapefile on first access."""
        if name not in self.layers:
            if name not in self.paths:
                raise KeyError(f"Layer not registered: {name}")
            shp_path: Path = self.paths[name]
            if not shp_path.exists() and not shp_path.with_name(shp_path.stem + ".cache.parquet").exists():
                print(f"Warning: neither {shp_path} nor its parquet cache exists. Returning empty GeoDataFrame.")
                self.layers[name] = gpd.GeoDataFrame(geometry=[], crs=self.metric_crs)
                return self.layers[name]
            mtime = shp_path.stat().st_mtime if shp_path.exists() else 0.0
            gdf = _load_gdf_cached(str(shp_path), self.metric_crs, mtime)
            self.layers[name] = gdf
        return self.layers[name]

    def clear_cache(self, name: str = None):
        """Clear cached layers. If name is None, clear all cached layers."""
        if name is None:
            self.layers.clear()
        elif name in self.layers:
            del self.layers[name]

    def reload(self, name: str = None):
        """Force reload of one or all layers by clearing cache and reloading"""
        self.clear_cache(name)
        if name is not None:
            # Force reload by accessing the layer
            return self.get(name)
        else:
            # Reload all registered layers
            for layer_name in list(self.paths.keys()):
                try:
                    self.get(layer_name)
                except Exception as e:
                    print(f"Warning: Could not reload layer {layer_name}: {e}")

    def to_metric_point(self, point, input_crs=None):
        pt = Point(point) if isinstance(point, tuple) else point

        if input_crs is None:
            # Simple heuristic: if coordinates look like lat/lon, assume WGS84; otherwise treat as metric CRS already
            x, y = (pt.x, pt.y)
            if (-180 <= x <= 180) and (-90 <= y <= 90):
                crs_in = CRS_WGS84
            else:
                crs_in = self.metric_crs
        else:
            crs_in = input_crs

        gdf = gpd.GeoDataFrame(geometry=[pt], crs=crs_in).to_crs(self.metric_crs)
        return gdf.geometry.iloc[0]

    @classmethod
    def default(cls, base_dir="shp"):
        """Pre-register all default layer paths."""
        store = cls()
        base = Path(base_dir)
        store.add_path("mrt", base / "Mrt_exit" / "MRT_EXITS.shp")
        store.add_path("bus_lane", base / "bus_lane" / "Bus lanes.shp")
        store.add_path("bus_stop", base / "bus_stop" / "BusStop.shp")
        store.add_path("bus_shelter", base / "bus_stop" / "BusShelter.shp")
        store.add_path("parking", base / "parking_lot" / "URA_PARKING_LOT.shp")
        store.add_path("inner", base / "area_type" / "CentralMB2025.shp")
        store.add_path("industrial", base / "area_type" / "LanduseIndustrial2025.shp")
        store.add_path("rural", base / "area_type" / "LanduseRural2025.shp")
        # Recreation landuse was reorganised out of area_type/ into its own layer folder
        # (LanduseRecre2026). area_type/LanduseRecreation2025.shp no longer ships, so point
        # the recreation area-type test at the current file. get_area_type only does a
        # point-in-polygon test (_poly), so no attribute schema dependency.
        store.add_path("recreation", base / "LanduseRecre2026" / "LanduseRecre2026.shp")
        store.add_path("beforeCount", base / "AMGbeforeCount" / "AMGbeforeCount_export.shp")
        store.add_path("sensorCount", base / "AMGsensorCount" / "AMGsensorCount_export.shp")
        store.add_path("kerb_line", base / "kerb_line" / "kerbline.shp")
        # Added for Road Operating Speed (mean)
        store.add_path("road_links", base / "LinkID_Shape_File" / "31Oct24_Link_FUL.shp")
        # Added for Road Speed Limit
        store.add_path("speed_limit", base / "Speed_limit" / "ROADATTRIBUTELINE_SPEEDLIMITS.shp")
        # Added for Facility Width per Direction
        store.add_path("cycling_path", base / "path" / "CyclingpathCentreline.shp")
        store.add_path("footpath", base / "path" / "Footpathcentreline.shp")
        store.add_path("shared_path", base / "path" / "Sharedpathcentreline.shp")
        # Added for Road Crossing Layer
        store.add_path("roadcrossing", base / "roadcrossinglayer" / "ROADCROSSING.shp")
        # Added for Bicycle Crossing Facility (AMG BC 2025)
        store.add_path("bicycle_crossing", base / "AMG_BC2025_shp" / "AMG_BC2025_shp.shp")
        # Land Ownership layers
        store.add_path("land_state_land", base / "Land Ownership" / "LandOwnership_StateLand.shp")
        store.add_path("land_stat_board", base / "Land Ownership" / "LandOwnership_StatBoard.shp")
        store.add_path("land_private",    base / "Land Ownership" / "LandOwnership_Private.shp")
        store.add_path("land_ministry",   base / "Land Ownership" / "LandOwnership_Ministry.shp")

        # Load speed CSV if it exists
        speed_csv_path = base / "LinkID_Shape_File" / "TSE_AdHocReq_ERP2AverageSpeedData_250425.csv"
        if speed_csv_path.exists():
            try:
                store.set_speed_csv(speed_csv_path)
            except Exception as e:
                print(f"Warning: Could not load speed CSV: {e}")

        return store


class GIS:
    """Simple rule-based spatial query wrapper."""
    def __init__(self, store: LayerStore):
        self.store = store
        # Curvature and width analysis live in dedicated analyzer classes
        # (curvature_analyzer.py / width_analyzer.py). They hold a back-reference
        # to this GIS and reach shared map data via self.gis.store. The public
        # methods below forward to them; that forwarding is what lets tests
        # monkeypatch e.g. gis._check_angle_curvature on the instance and have
        # the internal call chain honor it (see REFACTOR_PLAN.md S3.4).
        self._curv = CurvatureAnalyzer(self)
        self._width = WidthAnalyzer(self)

    def query_nearby(self, layer, point, buffer, max_dist=None, notna_only=False, distance_col=None):
        """
        Shared proximity-check helper used by the ~8 near-identical GIS proximity
        methods (is_mrt, is_bus_lane, is_bus_stop, is_road_crossing,
        is_bicycle_crossing, is_parking, get_peak_pedestrian_flow,
        get_number_of_lane) plus the nearest-feature lookups
        (get_road_operating_speed, get_road_speed_limit, get_heavy_vehicle_flow).

        Captures the shared pattern: build a `point.buffer(buffer)` disk, use it
        as a coarse spatial-index (bounding-box) pre-filter via `sindex.query`,
        then refine to only rows whose *exact* distance to `point` is <= `max_dist`.

        `gdf.sindex.query(buf)` (default predicate=None -> bounding-box test only)
        is equivalent to the `gdf.sindex.intersection(buf.bounds)` form used at
        some of the original call sites -- both compare against the same buffer
        bounding box -- so unifying onto one form here does not change results.

        Args:
            layer: registered layer name (str, looked up via `self.store.get`)
                   OR an already-loaded/pre-filtered GeoDataFrame.
            point: a Point already in the store's metric CRS (callers convert via
                   `self.store.to_metric_point()` beforehand, matching every
                   pre-refactor call site -- `query_nearby` does not re-convert).
            buffer: radius (metres) for the coarse spatial-index buffer/bbox query.
            max_dist: radius (metres) for the exact distance filter. Defaults to
                      `buffer` when omitted (the common case where one distance
                      value gates both steps, e.g. `_near`).
            notna_only: pre-filter out null geometries before indexing (some call
                        sites do this, some don't -- parameterized rather than
                        applied unconditionally to preserve exact behavior).
            distance_col: if given, attach the exact distance as this column name
                          on the returned candidates (only copies the frame in
                          this case, to avoid SettingWithCopyWarning).

        Returns:
            (candidates, distances): `candidates` is the GeoDataFrame subset of
            `layer` within `max_dist` of `point` (empty but column-preserving if
            none found); `distances` is the aligned Series of exact distances.
        """
        gdf = self.store.get(layer) if isinstance(layer, str) else layer
        if gdf is None or gdf.empty:
            empty = gdf if gdf is not None else gpd.GeoDataFrame(geometry=[], crs=self.store.metric_crs)
            return empty.iloc[0:0], pd.Series(dtype=float)

        if notna_only:
            gdf = gdf[gdf.geometry.notna()]
            if gdf.empty:
                return gdf, pd.Series(dtype=float)

        if max_dist is None:
            max_dist = buffer

        idx = list(gdf.sindex.query(point.buffer(buffer)))
        if not idx:
            return gdf.iloc[0:0], pd.Series(dtype=float)

        candidates = gdf.iloc[idx]
        dists = candidates.geometry.distance(point)
        within_mask = dists <= max_dist
        result = candidates[within_mask]
        result_dists = dists[within_mask]

        if distance_col is not None and not result.empty:
            result = result.copy()
            result[distance_col] = result_dists

        return result, result_dists

    def _near(self, layer, pt, dist):
        candidates, _ = self.query_nearby(layer, pt, dist)
        return not candidates.empty

    def _poly(self, layer, pt, tol):
        gdf = self.store.get(layer)
        return not gdf[gdf.geometry.buffer(tol).contains(pt)].empty
    
    @staticmethod
    def _remove_z_coordinate(geom):
        """Helper to force 3D geometries into 2D by stripping Z."""
        from shapely.geometry import Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon
        if geom is None: return None
        if not geom.has_z: return geom
        
        if geom.geom_type == 'Point':
            return Point(geom.x, geom.y)
        elif geom.geom_type == 'LineString':
            return LineString([(x, y) for x, y, z in geom.coords])
        elif geom.geom_type == 'Polygon':
            if len(geom.exterior.coords[0]) == 3:
                exterior = LineString([(x, y) for x, y, z in geom.exterior.coords])
                interiors = [LineString([(x, y) for x, y, z in ring.coords]) for ring in geom.interiors]
                return Polygon(exterior, interiors)
            return geom
        elif geom.geom_type.startswith('Multi'):
            parts = [GIS._remove_z_coordinate(g) for g in geom.geoms]
            if geom.geom_type == 'MultiPoint': return MultiPoint(parts)
            if geom.geom_type == 'MultiLineString': return MultiLineString(parts)
            if geom.geom_type == 'MultiPolygon': return MultiPolygon(parts)
        return geom

    @staticmethod
    def _peak_hourly_by_group(df, data_col='data_type', time_col='timestamp', count_col='count', dayfirst=True):
        if df is None or len(df) == 0:
            return {'MICROMOBILITY': 0, 'OTHER': 0}

        g = df.copy()
        # Normalise travel mode labels
        g[data_col] = g[data_col].astype(str).str.strip().str.upper()
        alias = {
            'CYCLISTS': 'CYCLIST',
            'E-SCOOTER': 'PMD',
            'POWER-ASSISTED BICYCLE': 'PAB',
            'POWER ASSISTED BICYCLE': 'PAB'
        }
        g[data_col] = g[data_col].replace(alias)
        mic = {'CYCLIST', 'PMD', 'PAB'}
        g['mode_group'] = np.where(g[data_col].isin(mic), 'MICROMOBILITY', 'OTHER')

        # Truncate timestamps to the hour
        g[time_col] = pd.to_datetime(g[time_col], errors='coerce', dayfirst=dayfirst)
        g = g[g[time_col].notna()]
        g['hour'] = g[time_col].dt.floor('H')

        # Coerce count column to numeric
        g[count_col] = pd.to_numeric(g[count_col], errors='coerce').fillna(0)

        # Sum counts by hour x mode group
        hourly = (g.groupby(['hour','mode_group'], as_index=False)[count_col]
                    .sum().rename(columns={count_col: 'hourly_count'}))

        mic_peak = int(hourly.loc[hourly['mode_group']=='MICROMOBILITY','hourly_count'].max()) if (hourly['mode_group']=='MICROMOBILITY').any() else 0
        oth_peak = int(hourly.loc[hourly['mode_group']=='OTHER','hourly_count'].max()) if (hourly['mode_group']=='OTHER').any() else 0
        return {'MICROMOBILITY': mic_peak, 'OTHER': oth_peak}
    
    def is_mrt(self, point, dist=20):
        pt = self.store.to_metric_point(point)
        return self._near("mrt", pt, dist)

    def is_bus_lane(self, point, dist=20):
        pt = self.store.to_metric_point(point)
        return self._near("bus_lane", pt, dist)

    def is_bus_stop(self, point, dist=20):
        pt = self.store.to_metric_point(point)
        return self._near("bus_stop", pt, dist)

    def is_road_crossing(self, point, dist=5):
        pt = self.store.to_metric_point(point)
        return self._near("roadcrossing", pt, dist)

    def is_bicycle_crossing(self, point, dist=2):
        pt = self.store.to_metric_point(point)
        return self._near("bicycle_crossing", pt, dist)

    def is_parking(self, point, dist=20):
        pt = self.store.to_metric_point(point)
        return self._near("parking", pt, dist)

    def get_area_type(self, point, tol=20):
        pt = self.store.to_metric_point(point)
        if self._poly("inner", pt, tol): return 1
        if self._poly("industrial", pt, tol): return 4
        if self._poly("rural", pt, tol): return 3
        if self._poly("recreation", pt, tol): return 5
        return 2
    
    def get_peak_pedestrian_flow(self, pt, dist=20):
        # Reproject query point to metric CRS (EPSG:3414)
        pt = self.store.to_metric_point(pt)

        gdf1 = self.store.get("beforeCount")
        gdf2 = self.store.get("sensorCount")

        # Drop rows with missing or non-Point geometries
        gdf1 = gdf1[gdf1.geometry.notna() & (gdf1.geom_type == "Point")].copy()
        gdf2 = gdf2[gdf2.geometry.notna() & (gdf2.geom_type == "Point")].copy()

        # Coarse sindex candidate filter, then exact distance refinement
        near1, _ = self.query_nearby(gdf1, pt, dist)
        near2, _ = self.query_nearby(gdf2, pt, dist)

        # Helper: aggregate to hourly peak by mode group
        before_peaks = (
            self._peak_hourly_by_group(
                near1,
                data_col='DataType',    # column name in beforeCount shapefile
                time_col='DateTime',    # column name in beforeCount shapefile
                count_col='Count_Data', # column name in beforeCount shapefile
                dayfirst=True
            )
            if len(near1) else None
        )

        sensor_peaks = (
            self._peak_hourly_by_group(
                near2,
                data_col='Pivot_user',
                time_col='Datetime_p',
                count_col='Count',
                dayfirst=True
            )
            if len(near2) else None
        )

        # Unified return structure
        return {
            "before_peaks": before_peaks,   # {'MICROMOBILITY': x, 'OTHER': y}
            "sensor_peaks": sensor_peaks,   # {'MICROMOBILITY': x, 'OTHER': y}
        }

    def get_number_of_lane(self, point, dist=20):
        """
        Find the nearest kerb line within dist metres of point and return the
        CycleRAP lane code for "Number of lanes – adjacent road":
            1 = "1 per Direction/NA"  (LANES == "1")
            2 = "> 1 per Direction"   (LANES >= 2)
        Returns None if no kerb line is found within dist or LANES is missing/unparseable.
        """
        pt = self.store.to_metric_point(point)

        candidates, dists = self.query_nearby("kerb_line", pt, dist, notna_only=True)
        if candidates.empty:
            return None

        nearest_row = candidates.loc[dists.idxmin()]
        lanes_str = str(nearest_row.get("LANES", "") or "").strip()
        if not lanes_str:
            return None
        try:
            lanes_count = int(lanes_str)
        except ValueError:
            return None

        return 1 if lanes_count <= 1 else 2

    # Added for Road Operating Speed (mean)
    def get_road_operating_speed(self, point, buffer_dist=20, max_dist=30, default_speed=30.0):
        """
        Get the road operating speed (mean) for a point by finding the nearest road link.

        Args:
            point: Shapely Point or (lon, lat) tuple in WGS84 or metric CRS
            buffer_dist: Buffer distance in meters for initial spatial query (default: 20m)
            max_dist: Maximum distance in meters to search for road links (default: 30m)
            default_speed: Default speed value to return if no match found (default: 30 km/h)

        Returns:
            float: Average hourly speed in km/h, or default_speed if not found

        Implementation follows the specification:
        1. Extract first coordinate from LineString geometry
        2. Create 20m buffer for spatial search
        3. Query candidate road links within buffer
        4. Filter to only links within 30m
        5. Find nearest road link
        6. Look up speed from CSV by Link ID
        7. Return speed or default value
        """
        # Convert point to metric CRS (EPSG:3414)
        pt = self.store.to_metric_point(point)

        # Check if road links shapefile is available
        try:
            road_gdf = self.store.get("road_links")
        except KeyError:
            print("Warning: road_links shapefile not registered")
            return default_speed

        if road_gdf is None or road_gdf.empty:
            return default_speed

        # Ensure road links are in metric CRS (should already be from LayerStore.get)
        if road_gdf.crs.to_epsg() != 3414:
            road_gdf = road_gdf.to_crs("EPSG:3414")

        # Coarse spatial-index buffer query + exact distance filter (shared helper)
        nearby_roads, distances = self.query_nearby(
            road_gdf, pt, buffer_dist, max_dist, notna_only=True
        )

        if nearby_roads.empty:
            return default_speed

        # Find the nearest road link
        nearest_idx = distances.idxmin()
        nearest_road = nearby_roads.loc[nearest_idx]

        # Extract Link ID (field name: LK_ID_NUM)
        if 'LK_ID_NUM' not in nearest_road.index:
            print(f"Warning: LK_ID_NUM field not found in road shapefile. Available fields: {list(nearest_road.index)}")
            return default_speed

        link_id = str(nearest_road['LK_ID_NUM'])

        # Look up speed in CSV data
        if self.store.speed_data is None:
            print("Warning: Speed CSV data not loaded")
            return default_speed

        if link_id in self.store.speed_data.index:
            # Get the average hourly speed
            speed_row = self.store.speed_data.loc[link_id]
            if 'AVERAGE_HOURLY_SPEED' in speed_row.index:
                speed = float(speed_row['AVERAGE_HOURLY_SPEED'])
                return speed
            else:
                print(f"Warning: AVERAGE_HOURLY_SPEED column not found. Available columns: {list(speed_row.index)}")
                return default_speed
        else:
            # Link ID not found in CSV - return default
            return default_speed

    # Added for Road Speed Limit
    def get_road_speed_limit(self, point, buffer_dist=20, max_dist=30, default_limit=10):
        """
        Get the road speed limit for a point by finding the nearest speed limit road segment.

        Args:
            point: Shapely Point or (lon, lat) tuple in WGS84 or metric CRS
            buffer_dist: Buffer distance in meters for initial spatial query (default: 20m)
            max_dist: Maximum distance in meters to search for speed limit segments (default: 30m)
            default_limit: Default speed limit value to return if no match found (default: 10 km/h)

        Returns:
            int or float: Speed limit in km/h, or default_limit if not found

        Implementation follows the specification:
        1. Extract first coordinate from LineString geometry
        2. Create 20m buffer for spatial search
        3. Query candidate speed limit segments within buffer
        4. Filter to only segments within 30m
        5. Find nearest speed limit segment
        6. Extract SPEEDLIMIT value
        7. Return speed limit or default value
        """
        # Convert point to metric CRS (EPSG:3414)
        pt = self.store.to_metric_point(point)

        # Check if speed limit shapefile is available
        try:
            speed_limit_gdf = self.store.get("speed_limit")
        except KeyError:
            print("Warning: speed_limit shapefile not registered")
            return default_limit

        if speed_limit_gdf is None or speed_limit_gdf.empty:
            return default_limit

        # Ensure speed limit data is in metric CRS (should already be from LayerStore.get)
        if speed_limit_gdf.crs.to_epsg() != 3414:
            speed_limit_gdf = speed_limit_gdf.to_crs("EPSG:3414")

        # Coarse spatial-index buffer query + exact distance filter (shared helper)
        nearby_segments, distances = self.query_nearby(
            speed_limit_gdf, pt, buffer_dist, max_dist, notna_only=True
        )

        if nearby_segments.empty:
            return default_limit

        # Find the nearest segment
        nearest_idx = distances.idxmin()
        nearest_segment = nearby_segments.loc[nearest_idx]

        # Extract SPEEDLIMIT value
        if 'SPEEDLIMIT' not in nearest_segment.index:
            print(f"Warning: SPEEDLIMIT field not found in speed limit shapefile. Available fields: {list(nearest_segment.index)}")
            return default_limit

        speed_limit_value = nearest_segment['SPEEDLIMIT']

        # Handle null/NaN values
        if pd.isna(speed_limit_value):
            return default_limit

        # Return the speed limit value
        return float(speed_limit_value)

    def get_heavy_vehicle_flow(self, point, buffer_dist=15, max_dist=15, default_value=1):
        """
        Get the heavy vehicle flow category for a point by checking proximity to bus lanes.

        Heavy Vehicle Flow indicates the level of heavy vehicle traffic (buses, trucks) on the road
        adjacent to the cycling facility. Locations near bus lanes are assumed to have higher heavy
        vehicle flow due to bus traffic.

        Args:
            point: Shapely Point or (lon, lat) tuple in WGS84 or metric CRS
            buffer_dist: Buffer distance in meters for initial spatial query (default: 15m)
            max_dist: Maximum distance in meters to check for bus lanes (default: 15m)
            default_value: Default category value (1 = Low) to return if no bus lane found

        Returns:
            int: Heavy vehicle flow category
                 1 = 'Low' (default - no bus lane within 15m)
                 2 = 'Moderate to high' (bus lane within 15m)

        Implementation follows the specification:
        1. Extract first coordinate from LineString geometry (or use provided point)
        2. Create 15m buffer for spatial search
        3. Query candidate bus lanes within buffer using spatial index
        4. Calculate distance from point to each candidate bus lane
        5. Find minimum distance to any bus lane
        6. If minimum distance <= 15m, return 2 (Moderate to high)
        7. Otherwise, return 1 (Low)
        """
        # Convert point to metric CRS (EPSG:3414)
        pt = self.store.to_metric_point(point)

        # Check if bus_lane shapefile is available
        try:
            bus_lane_gdf = self.store.get("bus_lane")
        except KeyError:
            print("Warning: bus_lane shapefile not registered")
            return default_value

        if bus_lane_gdf is None or bus_lane_gdf.empty:
            return default_value

        # Ensure bus lane data is in metric CRS (should already be from LayerStore.get)
        if bus_lane_gdf.crs.to_epsg() != 3414:
            bus_lane_gdf = bus_lane_gdf.to_crs("EPSG:3414")

        # Coarse spatial-index buffer query + exact distance filter (shared helper).
        # Original computed min(distance) over the bbox candidate pool and compared
        # to max_dist; `query_nearby` already restricts candidates to those within
        # max_dist, so "any candidate remains" is equivalent to "min distance <= max_dist".
        nearby_lanes, _ = self.query_nearby(bus_lane_gdf, pt, buffer_dist, max_dist, notna_only=True)

        # If a bus lane is within threshold, return "Moderate to high" (2)
        if not nearby_lanes.empty:
            return 2  # Moderate to high
        else:
            return default_value  # Low (1)

    # ------------------------------------------------------------------
    # Curvature / width delegation
    #
    # Heavy curvature/width logic lives in curvature_analyzer.py and
    # width_analyzer.py. These thin methods forward to the analyzers. Explicit
    # forwarding (rather than the analyzers calling each other directly) keeps
    # the test monkeypatch contract: tests patch analyze_curvature /
    # get_radius_and_width_at_point / _snap_point_to_path_network /
    # _check_angle_curvature on this GIS instance, and the analyzers reach back
    # through self.gis for exactly those, so a patch is honored.
    # ------------------------------------------------------------------
    def get_curvature(self, *args, **kwargs):
        """Delegates to CurvatureAnalyzer.get_curvature -> (category, subcategory)."""
        return self._curv.get_curvature(*args, **kwargs)

    def analyze_curvature(self, *args, **kwargs):
        """Delegates to CurvatureAnalyzer.analyze_curvature -> diagnostics dict."""
        return self._curv.analyze_curvature(*args, **kwargs)

    def get_curvature_visualization(self, *args, **kwargs):
        """Delegates to CurvatureAnalyzer.get_curvature_visualization."""
        return self._curv.get_curvature_visualization(*args, **kwargs)

    def get_radius_and_width_at_point(self, *args, **kwargs):
        """Delegates to CurvatureAnalyzer.get_radius_and_width_at_point."""
        return self._curv.get_radius_and_width_at_point(*args, **kwargs)

    def _snap_point_to_path_network(self, *args, **kwargs):
        """Delegates to CurvatureAnalyzer._snap_point_to_path_network."""
        return self._curv._snap_point_to_path_network(*args, **kwargs)

    def _check_angle_curvature(self, *args, **kwargs):
        """Delegates to CurvatureAnalyzer._check_angle_curvature."""
        return self._curv._check_angle_curvature(*args, **kwargs)

    def _supports_sharp_curve_details(self, *args, **kwargs):
        """Delegates to CurvatureAnalyzer._supports_sharp_curve_details."""
        return self._curv._supports_sharp_curve_details(*args, **kwargs)

    def get_facility_width(self, *args, **kwargs):
        """Delegates to WidthAnalyzer.get_facility_width -> (category, subcategory)."""
        return self._width.get_facility_width(*args, **kwargs)

    def get_width_visualization(self, *args, **kwargs):
        """Delegates to WidthAnalyzer.get_width_visualization."""
        return self._width.get_width_visualization(*args, **kwargs)

    def _standardize_width_column(self, *args, **kwargs):
        """Delegates to WidthAnalyzer._standardize_width_column (static width helper)."""
        return self._width._standardize_width_column(*args, **kwargs)
