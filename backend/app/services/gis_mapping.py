# gis_mapping.py
from __future__ import annotations
import math
import geopandas as gpd
from shapely.geometry import Point, LineString
from pathlib import Path
import numpy as np
import pandas as pd

# Import utility module for width and curvature calculation
from app.utils.path_width_curvature import get_radius_and_width_at_point


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

CURVATURE_FINE_STEP_M = 0.5
CURVATURE_DEDUP_TOLERANCE_M = 0.10
CURVATURE_MIN_TRIPLET_LEG_M = 0.35
# A circumradius is only a valid radius-of-curvature estimate when the two arms of
# the triplet (A→B and B→C) are of comparable length. A long arm paired with a very
# short arm collapses the circumradius toward the short arm and reports a phantom
# sharp turn from a single noisy vertex jog. Skip triplets whose arms are more
# lopsided than this ratio; genuine curves are still captured by the evenly-spaced
# (densified) triplets where both arms are ~CURVATURE_FINE_STEP_M.
CURVATURE_MAX_ARM_RATIO = 3.0
CURVATURE_MIN_PLAUSIBLE_RADIUS_M = 1.0
CURVATURE_MIN_KINK_LEG_M = 1.0
CURVATURE_JUNCTION_SNAP_TOL_M = 0.75
CURVATURE_MIN_JUNCTION_LEG_M = 1.2
# Maximum distance the analysis point may be snapped onto the path network. Coding
# points sit within a couple of metres of their path (median ≈ 2 m); snapping much
# farther reaches across the carriageway and analyses the path on the *wrong* side
# of the road, fabricating curvature/junctions from an unrelated facility.
CURVATURE_MAX_SNAP_DISTANCE_M = 6.0
CURVATURE_TIGHT_RADIUS_BUCKET_M = 6.5
CURVATURE_KINK_ANGLE_THRESHOLD_DEG = 45.0
CURVATURE_JUNCTION_ANGLE_THRESHOLD_DEG = 25.0
CURVATURE_INTERSECTION_JUNCTION_ANGLE_THRESHOLD_DEG = 60.0
CURVATURE_MIN_SHARP_HEADING_CHANGE_DEG = 15.0

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
                raise KeyError(f"未注册图层: {name}")
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
            # 简单启发式：如果像经纬度，就当 WGS84，否则当作已是米制
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
        """预设所有图层路径"""
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
        store.add_path("recreation", base / "area_type" / "LanduseRecreation2025.shp")
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
    """简单规则判断"""
    def __init__(self, store: LayerStore):
        self.store = store
        # Cache prepared path layers to avoid repeated CRS/Z/validity processing.
        self._prepared_path_layers: dict[str, dict[str, object]] = {}

    def _near(self, layer, pt, dist):
        gdf = self.store.get(layer)
        idx = gdf.sindex.query(pt.buffer(dist))
        if not len(idx):
            return False
        d = gdf.iloc[idx].distance(pt).min()
        return d <= dist

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
        # 统一出行类型
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

        # 时间→按小时取整
        g[time_col] = pd.to_datetime(g[time_col], errors='coerce', dayfirst=dayfirst)
        g = g[g[time_col].notna()]
        g['hour'] = g[time_col].dt.floor('H')

        # 计数列数值化
        g[count_col] = pd.to_numeric(g[count_col], errors='coerce').fillna(0)

        # 每小时 × 分组 合计
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
        # 统一坐标到 3414（米）
        pt = self.store.to_metric_point(pt)

        gdf1 = self.store.get("beforeCount")
        gdf2 = self.store.get("sensorCount")

        # 只保留有效点
        gdf1 = gdf1[gdf1.geometry.notna() & (gdf1.geom_type == "Point")].copy()
        gdf2 = gdf2[gdf2.geometry.notna() & (gdf2.geom_type == "Point")].copy()

        buf = pt.buffer(dist)

        # sindex 粗筛 + 精确距离细筛
        idx1 = gdf1.sindex.query(buf)
        near1 = gdf1.iloc[idx1]
        if len(near1):
            near1 = near1[near1.geometry.distance(pt) <= dist]
        else:
            near1 = gdf1.iloc[0:0]  # 空表但保留列

        idx2 = gdf2.sindex.query(buf)
        near2 = gdf2.iloc[idx2]
        if len(near2):
            near2 = near2[near2.geometry.distance(pt) <= dist]
        else:
            near2 = gdf2.iloc[0:0]
            

        # 小工具：做小时聚合
        before_peaks = (
            self._peak_hourly_by_group(
                near1,
                data_col='DataType',    # ← 按你的真实列名改
                time_col='DateTime',    # ← 按你的真实列名改
                count_col='Count_Data',       # ← 按你的真实列名改
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

        # 统一返回结构
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

        gdf = self.store.get("kerb_line")
        if gdf is None or gdf.empty:
            return None
        gdf = gdf[gdf.geometry.notna()].copy()

        candidates_idx = list(gdf.sindex.query(pt.buffer(dist)))
        if not candidates_idx:
            return None

        candidates = gdf.iloc[candidates_idx]
        dists = candidates.geometry.distance(pt)
        within = dists[dists <= dist]
        if within.empty:
            return None

        nearest_row = candidates.loc[within.idxmin()]
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

        # Filter to only valid geometries
        road_gdf = road_gdf[road_gdf.geometry.notna()].copy()

        # Create buffer for spatial query
        buffer_geom = pt.buffer(buffer_dist)

        # Use spatial index to find candidate road links
        candidate_indices = list(road_gdf.sindex.intersection(buffer_geom.bounds))

        if not candidate_indices:
            return default_speed

        # Get candidate road links
        candidates = road_gdf.iloc[candidate_indices].copy()

        # Calculate distances to point
        candidates['distance'] = candidates.geometry.distance(pt)

        # Filter to only roads within max_dist
        nearby_roads = candidates[candidates['distance'] <= max_dist]

        if nearby_roads.empty:
            return default_speed

        # Find the nearest road link
        nearest_idx = nearby_roads['distance'].idxmin()
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

        # Filter to only valid geometries
        speed_limit_gdf = speed_limit_gdf[speed_limit_gdf.geometry.notna()].copy()

        # Create buffer for spatial query
        buffer_geom = pt.buffer(buffer_dist)

        # Use spatial index to find candidate speed limit segments
        candidate_indices = list(speed_limit_gdf.sindex.intersection(buffer_geom.bounds))

        if not candidate_indices:
            return default_limit

        # Get candidate speed limit segments
        candidates = speed_limit_gdf.iloc[candidate_indices].copy()

        # Calculate distances to point
        candidates['dist_to_pt'] = candidates.geometry.distance(pt)

        # Filter to only segments within max_dist
        nearby_segments = candidates[candidates['dist_to_pt'] <= max_dist]

        if nearby_segments.empty:
            return default_limit

        # Find the nearest segment
        nearest_idx = nearby_segments['dist_to_pt'].idxmin()
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

        # Filter to only valid geometries
        bus_lane_gdf = bus_lane_gdf[bus_lane_gdf.geometry.notna()].copy()

        # Create buffer for spatial query
        buffer_geom = pt.buffer(buffer_dist)

        # Use spatial index to find candidate bus lanes
        candidate_indices = list(bus_lane_gdf.sindex.intersection(buffer_geom.bounds))

        if not candidate_indices:
            return default_value

        # Get candidate bus lanes
        candidates = bus_lane_gdf.iloc[candidate_indices].copy()

        # Calculate distances to point
        candidates['dist_to_pt'] = candidates.geometry.distance(pt)

        # Find the minimum distance to any bus lane
        min_distance = candidates['dist_to_pt'].min()

        # If minimum distance is within threshold, return "Moderate to high" (2)
        if min_distance <= max_dist:
            return 2  # Moderate to high
        else:
            return default_value  # Low (1)

    def get_radius_and_width_at_point(
        self,
        point,
        start_radius=1.0,
        max_radius=5.0,
        step=1.0,
        collect_radius=5.0,
        sample_half_window=1.0,
        epsilon=1e-6,
        return_details=False,
    ):
        """
        Calculate the minimum curvature radius and facility width at a given point using a
        TWO-STAGE process that matches the original PathAssignmentTool implementation.

            return geom_a.intersects(geom_b)
        This method implements the exact algorithm from the original Streamlit app:
        - STAGE 1: Expanding ring search (1m→5m) to find WIDTH from the nearest path
        - STAGE 2: Fixed window search (5m) to calculate CURVATURE from the same layer

        Args:
            point: Shapely Point or (lon, lat) tuple in WGS84
            start_radius: Initial ring radius for width search (default: 1.0m)
            max_radius: Maximum ring radius for width search (default: 5.0m)
            step: Ring increment size (default: 1.0m)
            collect_radius: Fixed window radius for curvature calculation (default: 5.0m, extended to 5.5m internally)
            sample_half_window: Legacy parameter (not used - densification now uses 0.25m fixed step and preserves original vertices)
            epsilon: Minimum threshold for distance/area calculations (default: 1e-6)

        Returns:
            tuple: (min_radius, width)
                   - min_radius (float or None): Minimum circumradius in meters (sharpest curve)
                   - width (float or None): Facility width in meters from the nearest path feature

        Algorithm (Two-Stage Process):

        STAGE 1 - WIDTH SEARCH (Expanding Ring):
        1. For each radius in [start_radius, start_radius+step, ..., max_radius]:
           a. Create circular buffer at current radius
           b. For each layer in priority order [cycling, shared, footpath]:
              - Find features intersecting this ring
              - If width not yet locked AND features found with valid WIDTH:
                * Lock the width from the nearest feature
                * Remember which layer provided it
           c. Increment radius and continue (width stays locked)

        STAGE 2 - CURVATURE CALCULATION (Fixed Window):
        1. Use ONLY the layer that provided the width
        2. Query features within collect_radius (5.5m extended) of the point
        3. Merge connectable line segments using shapely's linemerge/unary_union
        4. Clip merged geometry to the circular buffer
        5. IMPROVED DENSIFICATION: Preserve original vertices + add points at 0.25m intervals
        6. Calculate minimum circumradius using sliding triplet window on ALL points
        7. Return (min_radius, width)

        Key Characteristics:
        - Width and curvature come from THE SAME LAYER
        - Width uses EXPANDING RING (tries closer features first)
        - Curvature uses FIXED WINDOW (always collect_radius, not expanding)
        - Width locks at first match (never changes after first valid value)
        - Curvature calculated AFTER width search completes
        """
        # Convert point to metric CRS (EPSG:3414)
        pt = self.store.to_metric_point(point)

        # Priority order: cycling paths first, then shared, then footpaths
        priority = ["cycling", "shared", "footpath"]
        layer_names = {
            "cycling": "cycling_path",
            "shared": "shared_path",
            "footpath": "footpath"
        }
        prepared_layers = {}
        for layer_key in priority:
            try:
                gdf = self._load_path_layer(layer_names[layer_key])
                if gdf is not None and not gdf.empty:
                    prepared_layers[layer_key] = gdf
            except KeyError:
                continue

        # ========================================================================
        # STAGE 1: EXPANDING RING SEARCH FOR WIDTH
        # ========================================================================
        width_layer = None       # layer that gave us a valid width
        found_width = None
        curvature_layer = None   # layer to use for curvature (first geometric hit,
                                 # even if it has no WIDTH attribute)

        # Expand search radius from start_radius to max_radius in steps
        current_radius = start_radius
        while current_radius <= max_radius:
            buffer_ring = pt.buffer(current_radius)

            for layer_key in priority:
                try:
                    gdf = prepared_layers.get(layer_key)
                    if gdf is None or gdf.empty:
                        continue

                    # Spatial query using index
                    candidate_indices = list(gdf.sindex.intersection(buffer_ring.bounds))
                    if not candidate_indices:
                        continue

                    candidates = gdf.iloc[candidate_indices]

                    # Find features that actually intersect the buffer
                    intersecting = candidates[candidates.intersects(buffer_ring)]
                    if intersecting.empty:
                        continue

                    # Record the first layer found geometrically for curvature use
                    if curvature_layer is None:
                        curvature_layer = layer_key

                    # Lock width if not yet set
                    if found_width is None:
                        # Standardize WIDTH column
                        intersecting_std = self._standardize_width_column(intersecting)
                        if 'WIDTH' in intersecting_std.columns:
                            # Get width from the nearest feature
                            distances = intersecting_std.geometry.distance(pt)
                            nearest_idx = distances.idxmin()
                            width_value = intersecting_std.loc[nearest_idx, 'WIDTH']
                            if pd.notna(width_value):
                                found_width = float(width_value)
                                width_layer = layer_key  # Remember which layer provided it

                except KeyError:
                    continue
                except Exception as e:
                    print(f"Warning: Error processing {layer_key} for width search: {e}")
                    continue

            # Increment radius for next ring
            current_radius += step

        # Curvature seeds from the width layer when available, otherwise the first
        # geometric hit, then continues across the connected local path network.
        effective_curvature_layer = width_layer if width_layer is not None else curvature_layer

        # ========================================================================
        # STAGE 2: CURVATURE CALCULATION (Fixed Window)
        # ========================================================================
        min_radius = None
        analysis_layers = []
        analysis_lines = []
        primary_segments = []

        try:
            buffer_curv = pt.buffer(collect_radius + 0.5)
            all_segments = self._collect_path_segments(pt, buffer_curv)
            primary_segments = self._select_primary_path_segments(
                all_segments,
                preferred_layer=effective_curvature_layer,
            )

            if primary_segments:
                analysis_layers = sorted({segment["layer_key"] for segment in primary_segments})
                analysis_lines = self._merge_analysis_segments(primary_segments)
                min_radius = self._calculate_min_radius_from_lines(
                    analysis_lines,
                    pt,
                    collect_radius=collect_radius,
                    epsilon=epsilon,
                )
        except Exception as e:
            print(f"Warning: Error calculating curvature from connected paths: {e}")

        if return_details:
            return (
                min_radius,
                found_width,
                {
                    "width_layer": width_layer,
                    "first_geometry_layer": curvature_layer,
                    "layer_used": effective_curvature_layer,
                    "analysis_layers": analysis_layers,
                    "analysis_lines": analysis_lines,
                    "analysis_segments": primary_segments,
                },
            )

        return (min_radius, found_width)

    @staticmethod
    def _path_layer_names():
        return {
            "cycling": "cycling_path",
            "shared": "shared_path",
            "footpath": "footpath",
        }

    def _load_path_layer(self, store_key):
        raw_gdf = self.store.get(store_key)
        if raw_gdf is None or raw_gdf.empty:
            return raw_gdf

        raw_signature = (id(raw_gdf), len(raw_gdf))
        cached = self._prepared_path_layers.get(store_key)
        if cached is not None and cached.get("raw_signature") == raw_signature:
            return cached.get("prepared")

        gdf = raw_gdf
        if gdf.crs is not None and gdf.crs.to_epsg() != 3414:
            gdf = gdf.to_crs("EPSG:3414")

        if len(gdf) > 0 and gdf.geometry.iloc[0].has_z:
            gdf = gdf.copy()
            gdf.geometry = gdf.geometry.apply(
                lambda geom: self._remove_z_coordinate(geom) if geom is not None else None
            )

        prepared = gdf[gdf.geometry.notna() & gdf.geometry.is_valid].copy()
        self._prepared_path_layers[store_key] = {
            "raw_signature": raw_signature,
            "prepared": prepared,
        }
        return prepared

    @staticmethod
    def _flatten_line_geometries(geom):
        if geom is None or geom.is_empty:
            return []
        if geom.geom_type == "LineString":
            return [geom]
        if geom.geom_type == "MultiLineString":
            return [part for part in geom.geoms if part is not None and not part.is_empty]
        if geom.geom_type == "GeometryCollection":
            lines = []
            for part in geom.geoms:
                lines.extend(GIS._flatten_line_geometries(part))
            return lines
        return []

    @staticmethod
    def _line_endpoints(line):
        coords = list(line.coords)
        if not coords:
            return []
        return [coords[0][:2], coords[-1][:2]]

    def _collect_path_segments(self, pt, search_geom):
        segments = []
        for layer_key, store_key in self._path_layer_names().items():
            try:
                gdf = self._load_path_layer(store_key)
                if gdf is None or gdf.empty:
                    continue

                candidate_indices = list(gdf.sindex.intersection(search_geom.bounds))
                if not candidate_indices:
                    continue

                candidates = gdf.iloc[candidate_indices]
                intersecting = candidates[candidates.intersects(search_geom)]
                if intersecting.empty:
                    continue

                for feature_idx, geom in zip(intersecting.index, intersecting.geometry):
                    for part_idx, line in enumerate(self._flatten_line_geometries(geom)):
                        if line.is_empty:
                            continue
                        segments.append({
                            "segment_id": f"{layer_key}:{feature_idx}:{part_idx}",
                            "layer_key": layer_key,
                            "geometry": line,
                            "distance": float(line.distance(pt)),
                            "endpoints": self._line_endpoints(line),
                        })
            except Exception as e:
                print(f"Warning: Error collecting path segments from {layer_key}: {e}")
        return segments

    def _snap_point_to_path_network(self, point, max_snap_distance=CURVATURE_MAX_SNAP_DISTANCE_M):
        pt = self.store.to_metric_point(point)
        search_geom = pt.buffer(max_snap_distance)
        segments = self._collect_path_segments(pt, search_geom)

        if not segments:
            return pt, {
                "point_was_snapped": False,
                "snap_distance_m": None,
                "snap_layer": None,
            }

        nearest_segment = min(segments, key=lambda segment: segment["distance"])
        nearest_line = nearest_segment["geometry"]
        snapped_point = nearest_line.interpolate(nearest_line.project(pt))
        snap_distance = float(pt.distance(snapped_point))

        return snapped_point, {
            "point_was_snapped": snap_distance > 1e-6,
            "snap_distance_m": snap_distance,
            "snap_layer": nearest_segment["layer_key"],
        }

    @staticmethod
    def _segments_are_connected(segment_a, segment_b, snap_tol=CURVATURE_JUNCTION_SNAP_TOL_M):
        geom_a = segment_a["geometry"]
        geom_b = segment_b["geometry"]

        try:
            if geom_a.intersects(geom_b):
                return True
        except Exception:
            pass

        tol_sq = snap_tol * snap_tol
        for ax, ay in segment_a["endpoints"]:
            for bx, by in segment_b["endpoints"]:
                if (ax - bx) ** 2 + (ay - by) ** 2 <= tol_sq:
                    return True
        return False

    @staticmethod
    def _matching_endpoint_index(segment, point, snap_tol=CURVATURE_JUNCTION_SNAP_TOL_M):
        tol_sq = snap_tol * snap_tol
        for endpoint_idx, endpoint in enumerate(segment["endpoints"]):
            dx = endpoint[0] - point[0]
            dy = endpoint[1] - point[1]
            if dx * dx + dy * dy <= tol_sq:
                return endpoint_idx
        return None

    @staticmethod
    def _endpoint_vector(segment, endpoint_idx):
        line = segment["geometry"]
        if line is None or line.is_empty or line.length <= 1e-9:
            return None

        lookahead = min(CURVATURE_MIN_JUNCTION_LEG_M, float(line.length))

        if endpoint_idx == 0:
            start = line.interpolate(0.0)
            probe = line.interpolate(lookahead)
            return (probe.x - start.x, probe.y - start.y)

        end = line.interpolate(line.length)
        probe = line.interpolate(line.length - lookahead)
        return (probe.x - end.x, probe.y - end.y)

    @staticmethod
    def _normalized_vector_angle(vector_a, vector_b, epsilon=1e-9):
        if vector_a is None or vector_b is None:
            return 180.0

        ax, ay = vector_a
        bx, by = vector_b
        mag_a = math.sqrt(ax * ax + ay * ay)
        mag_b = math.sqrt(bx * bx + by * by)
        if mag_a < epsilon or mag_b < epsilon:
            return 180.0

        cos_a = max(-1.0, min(1.0, (ax * bx + ay * by) / (mag_a * mag_b)))
        return math.degrees(math.acos(abs(cos_a)))

    @staticmethod
    def _deflection_angle_points(point_a, point_b, point_c, epsilon=1e-9):
        ax, ay = point_a[:2]
        bx, by = point_b[:2]
        cx, cy = point_c[:2]

        v1x, v1y = bx - ax, by - ay
        v2x, v2y = cx - bx, cy - by
        mag_a = math.sqrt(v1x * v1x + v1y * v1y)
        mag_b = math.sqrt(v2x * v2x + v2y * v2y)
        if mag_a < epsilon or mag_b < epsilon:
            return 0.0

        cos_a = max(-1.0, min(1.0, (v1x * v2x + v1y * v2y) / (mag_a * mag_b)))
        return math.degrees(math.acos(cos_a))

    @staticmethod
    def _vertex_outgoing_vectors(coords, vertex_idx, epsilon=1e-9):
        if not coords or vertex_idx < 0 or vertex_idx >= len(coords):
            return []

        vertex = coords[vertex_idx][:2]
        vectors = []
        lookahead = CURVATURE_MIN_JUNCTION_LEG_M

        if vertex_idx > 0:
            reverse_line = LineString([coord[:2] for coord in reversed(coords[:vertex_idx + 1])])
            if not reverse_line.is_empty and reverse_line.length >= epsilon:
                reverse_probe = reverse_line.interpolate(min(lookahead, float(reverse_line.length)))
                dx = reverse_probe.x - vertex[0]
                dy = reverse_probe.y - vertex[1]
                if math.sqrt(dx * dx + dy * dy) >= epsilon:
                    vectors.append((dx, dy))

        if vertex_idx < len(coords) - 1:
            forward_line = LineString([coord[:2] for coord in coords[vertex_idx:]])
            if not forward_line.is_empty and forward_line.length >= epsilon:
                forward_probe = forward_line.interpolate(min(lookahead, float(forward_line.length)))
                dx = forward_probe.x - vertex[0]
                dy = forward_probe.y - vertex[1]
                if math.sqrt(dx * dx + dy * dy) >= epsilon:
                    vectors.append((dx, dy))

        return vectors

    @staticmethod
    def _line_directions_at_point(line, point, epsilon=1e-9):
        if line is None or line.is_empty or point is None:
            return []

        point_on_line = line.interpolate(line.project(point))
        distance_on_line = line.project(point_on_line)
        directions = []

        backward = min(CURVATURE_MIN_JUNCTION_LEG_M, float(distance_on_line))
        if backward >= epsilon:
            backward_point = line.interpolate(distance_on_line - backward)
            dx = backward_point.x - point_on_line.x
            dy = backward_point.y - point_on_line.y
            if math.sqrt(dx * dx + dy * dy) >= epsilon:
                directions.append((dx, dy))

        forward = min(CURVATURE_MIN_JUNCTION_LEG_M, float(line.length - distance_on_line))
        if forward >= epsilon:
            forward_point = line.interpolate(distance_on_line + forward)
            dx = forward_point.x - point_on_line.x
            dy = forward_point.y - point_on_line.y
            if math.sqrt(dx * dx + dy * dy) >= epsilon:
                directions.append((dx, dy))

        return directions

    def _supports_sharp_curve_details(
        self,
        details,
        sharp_turn_threshold=10.0,
        min_heading_change_deg=CURVATURE_MIN_SHARP_HEADING_CHANGE_DEG,
    ):
        if not details:
            return True

        min_triplet = details.get("min_triplet")
        if not min_triplet or min_triplet.get("radius") is None:
            return True
        if min_triplet["radius"] >= sharp_turn_threshold:
            return False

        radius_triplets = {
            triplet["index"]: triplet
            for triplet in details.get("all_triplets", [])
            if "radius" in triplet
        }
        if not radius_triplets:
            return True

        start_idx = min_triplet["index"]
        end_idx = min_triplet["index"]

        while (start_idx - 1) in radius_triplets and radius_triplets[start_idx - 1]["radius"] < sharp_turn_threshold:
            start_idx -= 1
        while (end_idx + 1) in radius_triplets and radius_triplets[end_idx + 1]["radius"] < sharp_turn_threshold:
            end_idx += 1

        run_triplets = [
            radius_triplets[idx]
            for idx in range(start_idx, end_idx + 1)
            if idx in radius_triplets
        ]
        if not run_triplets:
            return True

        run_coords = [
            tuple(run_triplets[0]["points"][0]),
            tuple(run_triplets[0]["points"][1]),
            tuple(run_triplets[0]["points"][2]),
        ]
        for triplet in run_triplets[1:]:
            point_c = tuple(triplet["points"][2])
            if point_c != run_coords[-1]:
                run_coords.append(point_c)

        cumulative_heading_change = 0.0
        for idx in range(len(run_coords) - 2):
            cumulative_heading_change += self._deflection_angle_points(
                run_coords[idx],
                run_coords[idx + 1],
                run_coords[idx + 2],
            )

        details["support_heading_change_deg"] = float(cumulative_heading_change)
        return cumulative_heading_change >= min_heading_change_deg

    def _select_primary_path_segments(self, segments, preferred_layer=None, snap_tol=CURVATURE_JUNCTION_SNAP_TOL_M):
        if not segments:
            return []

        min_dist = min(segment["distance"] for segment in segments)
        candidate_indices = [
            idx for idx, segment in enumerate(segments)
            if segment["distance"] <= min_dist + 1e-9
        ]

        if preferred_layer is not None:
            preferred_dists = [
                segment["distance"] for segment in segments if segment["layer_key"] == preferred_layer
            ]
            if preferred_dists:
                preferred_min = min(preferred_dists)
                if preferred_min <= min_dist + snap_tol:
                    candidate_indices = [
                        idx for idx, segment in enumerate(segments)
                        if (
                            segment["layer_key"] == preferred_layer
                            and segment["distance"] <= preferred_min + 1e-9
                        )
                    ]

        seed_idx = min(
            candidate_indices,
            key=lambda idx: (
                segments[idx]["distance"],
                0 if preferred_layer is not None and segments[idx]["layer_key"] == preferred_layer else 1,
                -segments[idx]["geometry"].length,
                idx,
            ),
        )

        selected_indices = {seed_idx}

        def walk(current_idx, endpoint_idx):
            while True:
                current_segment = segments[current_idx]
                junction_point = current_segment["endpoints"][endpoint_idx]
                current_vector = self._endpoint_vector(current_segment, endpoint_idx)
                candidates = []

                for other_idx, other_segment in enumerate(segments):
                    if other_idx in selected_indices or other_idx == current_idx:
                        continue

                    other_endpoint_idx = self._matching_endpoint_index(
                        other_segment,
                        junction_point,
                        snap_tol=snap_tol,
                    )
                    if other_endpoint_idx is None:
                        continue

                    other_vector = self._endpoint_vector(other_segment, other_endpoint_idx)
                    angle = self._normalized_vector_angle(current_vector, other_vector)
                    candidates.append((
                        angle,
                        other_segment["distance"],
                        0 if preferred_layer is not None and other_segment["layer_key"] == preferred_layer else 1,
                        -other_segment["geometry"].length,
                        other_idx,
                        other_endpoint_idx,
                    ))

                if not candidates:
                    break

                _, _, _, _, next_idx, matched_endpoint_idx = min(candidates)
                selected_indices.add(next_idx)
                current_idx = next_idx
                endpoint_idx = 1 - matched_endpoint_idx

        walk(seed_idx, 0)
        walk(seed_idx, 1)

        return [segments[idx] for idx in sorted(selected_indices)]

    def _select_connected_segments(self, segments, preferred_layer=None, snap_tol=CURVATURE_JUNCTION_SNAP_TOL_M):
        if not segments:
            return []

        min_dist = min(segment["distance"] for segment in segments)
        seed_indices = {
            idx for idx, segment in enumerate(segments)
            if segment["distance"] <= min_dist + 1e-9
        }

        if preferred_layer is not None:
            preferred_dists = [
                segment["distance"] for segment in segments if segment["layer_key"] == preferred_layer
            ]
            if preferred_dists:
                preferred_min = min(preferred_dists)
                if preferred_min <= min_dist + snap_tol:
                    for idx, segment in enumerate(segments):
                        if (
                            segment["layer_key"] == preferred_layer
                            and segment["distance"] <= preferred_min + 1e-9
                        ):
                            seed_indices.add(idx)

        selected = set(seed_indices)
        queue = list(seed_indices)
        while queue:
            current_idx = queue.pop(0)
            current = segments[current_idx]
            for other_idx, other in enumerate(segments):
                if other_idx in selected:
                    continue
                if self._segments_are_connected(current, other, snap_tol=snap_tol):
                    selected.add(other_idx)
                    queue.append(other_idx)

        return [segments[idx] for idx in sorted(selected)]

    def _merge_analysis_segments(self, segments):
        if not segments:
            return []

        from shapely.ops import linemerge, unary_union

        merged_geom = unary_union([segment["geometry"] for segment in segments])
        if merged_geom.geom_type == "MultiLineString":
            merged_geom = linemerge(merged_geom)
        return self._flatten_line_geometries(merged_geom)

    def _build_curvature_coords_with_distance(self, line, pt):
        if line.is_empty:
            return []

        original_coords = list(line.coords)
        if len(original_coords) < 2:
            return []

        combined_coords = []
        for i in range(len(original_coords) - 1):
            combined_coords.append(original_coords[i])

            segment = line.__class__([original_coords[i], original_coords[i + 1]])
            segment_length = segment.length
            if segment_length > CURVATURE_FINE_STEP_M:
                num_intermediate = int(segment_length / CURVATURE_FINE_STEP_M)
                for j in range(1, num_intermediate + 1):
                    dist = j * CURVATURE_FINE_STEP_M
                    if dist < segment_length:
                        pt_interp = segment.interpolate(dist)
                        combined_coords.append((pt_interp.x, pt_interp.y))

        combined_coords.append(original_coords[-1])

        deduped_coords = [combined_coords[0]]
        for coord in combined_coords[1:]:
            prev = deduped_coords[-1]
            dist_sq = (coord[0] - prev[0]) ** 2 + (coord[1] - prev[1]) ** 2
            if dist_sq > CURVATURE_DEDUP_TOLERANCE_M * CURVATURE_DEDUP_TOLERANCE_M:
                deduped_coords.append(coord)

        coords_with_dist = []
        for coord in deduped_coords:
            dist_to_pt = ((coord[0] - pt.x) ** 2 + (coord[1] - pt.y) ** 2) ** 0.5
            coords_with_dist.append((coord, dist_to_pt))

        return coords_with_dist

    def _calculate_windowed_min_radius_triplets(self, coords_with_dist, max_dist, epsilon=1e-6, return_details=False):
        if len(coords_with_dist) < 3:
            if return_details:
                return None, {
                    "error": "Insufficient points",
                    "num_points": len(coords_with_dist),
                    "required": 3,
                }
            return None

        min_radius = float('inf')
        min_triplet_idx = None
        all_triplets = []

        for i in range(len(coords_with_dist) - 2):
            (coord_a, dist_a), (coord_b, dist_b), (coord_c, dist_c) = coords_with_dist[i:i + 3]

            if min(dist_a, dist_b, dist_c) > max_dist:
                if return_details:
                    all_triplets.append({
                        "index": i,
                        "points": [coord_a, coord_b, coord_c],
                        "skipped": "outside_window",
                        "reason": "Triplet is outside the analysis window",
                    })
                continue

            a = np.sqrt((coord_b[0] - coord_a[0]) ** 2 + (coord_b[1] - coord_a[1]) ** 2)
            b = np.sqrt((coord_c[0] - coord_b[0]) ** 2 + (coord_c[1] - coord_b[1]) ** 2)
            c = np.sqrt((coord_c[0] - coord_a[0]) ** 2 + (coord_c[1] - coord_a[1]) ** 2)

            if (
                a < CURVATURE_MIN_TRIPLET_LEG_M
                or b < CURVATURE_MIN_TRIPLET_LEG_M
                or c < CURVATURE_MIN_TRIPLET_LEG_M
            ):
                if return_details:
                    all_triplets.append({
                        "index": i,
                        "points": [coord_a, coord_b, coord_c],
                        "skipped": "degenerate",
                        "reason": "Side length too small",
                    })
                continue

            # Arms a (A→B) and b (B→C) must be of comparable length for the
            # circumradius to be a meaningful radius-of-curvature estimate. A lopsided
            # long/short pair reports a phantom sharp turn from a single noisy vertex.
            shorter_arm = min(a, b)
            if max(a, b) > CURVATURE_MAX_ARM_RATIO * shorter_arm:
                if return_details:
                    all_triplets.append({
                        "index": i,
                        "points": [coord_a, coord_b, coord_c],
                        "skipped": "unbalanced_arms",
                        "reason": (
                            f"Arms too lopsided (ratio {max(a, b) / shorter_arm:.1f} "
                            f"> {CURVATURE_MAX_ARM_RATIO})"
                        ),
                    })
                continue

            p = 0.5 * (a + b + c)
            area_squared = p * (p - a) * (p - b) * (p - c)
            if area_squared <= epsilon:
                if return_details:
                    all_triplets.append({
                        "index": i,
                        "points": [coord_a, coord_b, coord_c],
                        "skipped": "collinear",
                        "reason": "Points are nearly collinear",
                    })
                continue

            area = np.sqrt(area_squared)
            radius = (a * b * c) / (4.0 * area)
            if radius < CURVATURE_MIN_PLAUSIBLE_RADIUS_M:
                if return_details:
                    all_triplets.append({
                        "index": i,
                        "points": [coord_a, coord_b, coord_c],
                        "skipped": "implausible_radius",
                        "reason": f"Radius below plausible minimum ({CURVATURE_MIN_PLAUSIBLE_RADIUS_M}m)",
                    })
                continue

            if return_details:
                all_triplets.append({
                    "index": i,
                    "points": [coord_a, coord_b, coord_c],
                    "sides": {"a": float(a), "b": float(b), "c": float(c)},
                    "semi_perimeter": float(p),
                    "area": float(area),
                    "radius": float(radius),
                    "is_minimum": False,
                })

            if radius < min_radius:
                min_radius = radius
                min_triplet_idx = len(all_triplets) - 1 if return_details else i

        if min_radius == float('inf'):
            if return_details:
                return None, {
                    "error": "No valid triplets",
                    "total_points": len(coords_with_dist),
                    "all_triplets": all_triplets,
                }
            return None

        if return_details:
            if min_triplet_idx is not None and all_triplets:
                all_triplets[min_triplet_idx]["is_minimum"] = True
            min_triplet = all_triplets[min_triplet_idx] if min_triplet_idx is not None else None
            details = {
                "min_radius": float(min_radius),
                "total_triplets_checked": len(coords_with_dist) - 2,
                "valid_triplets": len([t for t in all_triplets if "radius" in t]),
                "skipped_triplets": len([t for t in all_triplets if "skipped" in t]),
                "all_triplets": all_triplets,
                "min_triplet": min_triplet,
                "calculation_steps": self._format_calculation_steps(min_triplet) if min_triplet else None,
            }
            return float(min_radius), details

        return min_radius

    def _calculate_min_radius_from_lines(self, lines_to_process, pt, collect_radius=5.0, epsilon=1e-6, return_details=False):
        if not lines_to_process:
            if return_details:
                return None, None
            return None

        max_dist = collect_radius + 0.5
        best_radius = None
        best_details = None

        for line in lines_to_process:
            coord_variants = []

            original_coords = [coord[:2] for coord in list(line.coords)]
            if len(original_coords) >= 3:
                original_coords_with_dist = []
                for coord in original_coords:
                    dist_to_pt = ((coord[0] - pt.x) ** 2 + (coord[1] - pt.y) ** 2) ** 0.5
                    original_coords_with_dist.append((coord, dist_to_pt))
                coord_variants.append(original_coords_with_dist)

            densified_coords_with_dist = self._build_curvature_coords_with_distance(line, pt)
            if len(densified_coords_with_dist) >= 3:
                coord_variants.append(densified_coords_with_dist)

            for coords_with_dist in coord_variants:
                if return_details:
                    radius, details = self._calculate_windowed_min_radius_triplets(
                        coords_with_dist,
                        max_dist,
                        epsilon=epsilon,
                        return_details=True,
                    )
                    if radius is not None and (best_radius is None or radius < best_radius):
                        best_radius = radius
                        best_details = details
                else:
                    radius = self._calculate_windowed_min_radius_triplets(
                        coords_with_dist,
                        max_dist,
                        epsilon=epsilon,
                        return_details=False,
                    )
                    if radius is not None and (best_radius is None or radius < best_radius):
                        best_radius = radius

        if return_details:
            return best_radius, best_details

        return best_radius

    def _calculate_min_radius_triplet(self, coordinates, epsilon=1e-6, return_details=False):
        """
        Calculate minimum circumradius from a list of coordinates using the triplet method.

        Args:
            coordinates: List of (x, y) coordinate tuples
            epsilon: Minimum threshold for distance/area calculations
            return_details: If True, return detailed calculation info for diagnostics

        Returns:
            If return_details=False:
                float or None: Minimum circumradius in meters, or None if no valid triplets
            If return_details=True:
                tuple: (min_radius, details_dict) where details_dict contains:
                    - all_triplets: List of all calculated radii with coordinates
                    - min_triplet: The triplet that produced minimum radius
                    - calculation_steps: Detailed step-by-step calculation
        """
        if len(coordinates) < 3:
            if return_details:
                return None, {
                    "error": "Insufficient points",
                    "num_points": len(coordinates),
                    "required": 3
                }
            return None

        min_radius = float('inf')
        min_triplet_idx = None
        all_triplets = []

        # Slide through all consecutive triplets
        for i in range(len(coordinates) - 2):
            A = coordinates[i]
            B = coordinates[i + 1]
            C = coordinates[i + 2]

            # Calculate side lengths using Euclidean distance
            a = np.sqrt((B[0] - A[0])**2 + (B[1] - A[1])**2)  # dist(A, B)
            b = np.sqrt((C[0] - B[0])**2 + (C[1] - B[1])**2)  # dist(B, C)
            c = np.sqrt((C[0] - A[0])**2 + (C[1] - A[1])**2)  # dist(A, C)

            # Skip degenerate and micro-scale triangles.
            if (
                a < CURVATURE_MIN_TRIPLET_LEG_M
                or b < CURVATURE_MIN_TRIPLET_LEG_M
                or c < CURVATURE_MIN_TRIPLET_LEG_M
            ):
                if return_details:
                    all_triplets.append({
                        "index": i,
                        "points": [A, B, C],
                        "skipped": "degenerate",
                        "reason": "Side length too small"
                    })
                continue

            # Calculate semi-perimeter
            p = 0.5 * (a + b + c)

            # Calculate area using Heron's formula
            area_squared = p * (p - a) * (p - b) * (p - c)

            # Skip if area is too small (collinear points)
            if area_squared <= epsilon:
                if return_details:
                    all_triplets.append({
                        "index": i,
                        "points": [A, B, C],
                        "skipped": "collinear",
                        "reason": "Points are nearly collinear"
                    })
                continue

            # Calculate area
            area = np.sqrt(area_squared)

            # Calculate circumradius: R = (a * b * c) / (4 * area)
            R = (a * b * c) / (4.0 * area)

            if R < CURVATURE_MIN_PLAUSIBLE_RADIUS_M:
                if return_details:
                    all_triplets.append({
                        "index": i,
                        "points": [A, B, C],
                        "skipped": "implausible_radius",
                        "reason": f"Radius below plausible minimum ({CURVATURE_MIN_PLAUSIBLE_RADIUS_M}m)",
                    })
                continue

            if return_details:
                all_triplets.append({
                    "index": i,
                    "points": [A, B, C],
                    "sides": {"a": float(a), "b": float(b), "c": float(c)},
                    "semi_perimeter": float(p),
                    "area": float(area),
                    "radius": float(R),
                    "is_minimum": False  # Will update later
                })

            # Track minimum radius
            if R < min_radius:
                min_radius = R
                min_triplet_idx = len(all_triplets) - 1 if return_details else i

        # Return None if no valid triplets were found
        if min_radius == float('inf'):
            if return_details:
                return None, {
                    "error": "No valid triplets",
                    "total_points": len(coordinates),
                    "all_triplets": all_triplets
                }
            return None

        if return_details:
            # Mark the minimum triplet
            if min_triplet_idx is not None and all_triplets:
                all_triplets[min_triplet_idx]["is_minimum"] = True

            # Create detailed explanation
            min_triplet = all_triplets[min_triplet_idx] if min_triplet_idx is not None else None

            details = {
                "min_radius": float(min_radius),
                "total_triplets_checked": len(coordinates) - 2,
                "valid_triplets": len([t for t in all_triplets if "radius" in t]),
                "skipped_triplets": len([t for t in all_triplets if "skipped" in t]),
                "all_triplets": all_triplets,
                "min_triplet": min_triplet,
                "calculation_steps": self._format_calculation_steps(min_triplet) if min_triplet else None
            }

            return float(min_radius), details

        return min_radius

    def _format_calculation_steps(self, triplet):
        """Format the calculation steps for a triplet in human-readable form."""
        if not triplet or "radius" not in triplet:
            return None

        sides = triplet["sides"]
        return {
            "step_1": {
                "description": "Measure triangle sides",
                "formula": "a = distance(A, B), b = distance(B, C), c = distance(A, C)",
                "values": {
                    "side_a": f"{sides['a']:.2f} meters",
                    "side_b": f"{sides['b']:.2f} meters",
                    "side_c": f"{sides['c']:.2f} meters"
                },
                "result": f"a={sides['a']:.2f}m, b={sides['b']:.2f}m, c={sides['c']:.2f}m"
            },
            "step_2": {
                "description": "Calculate semi-perimeter",
                "formula": "p = (a + b + c) / 2",
                "calculation": f"({sides['a']:.2f} + {sides['b']:.2f} + {sides['c']:.2f}) / 2",
                "result": f"{triplet['semi_perimeter']:.2f} meters"
            },
            "step_3": {
                "description": "Calculate triangle area using Heron's formula",
                "formula": "area = √(p × (p-a) × (p-b) × (p-c))",
                "calculation": f"√({triplet['semi_perimeter']:.2f} × {triplet['semi_perimeter'] - sides['a']:.2f} × {triplet['semi_perimeter'] - sides['b']:.2f} × {triplet['semi_perimeter'] - sides['c']:.2f})",
                "result": f"{triplet['area']:.2f} square meters"
            },
            "step_4": {
                "description": "Calculate circumradius",
                "formula": "R = (a × b × c) / (4 × area)",
                "calculation": f"({sides['a']:.2f} × {sides['b']:.2f} × {sides['c']:.2f}) / (4 × {triplet['area']:.2f})",
                "result": f"{triplet['radius']:.2f} meters"
            },
            "conclusion": {
                "description": "Compare with threshold",
                "threshold": "10.0 meters",
                "result": f"{triplet['radius']:.2f} meters",
                "classification": "Sharp Turn (< 10m)" if triplet['radius'] < 10.0 else "No Sharp Turn (≥ 10m)"
            }
        }

    def _build_curvature_diagnostics(self, analysis_lines, point, collect_radius=5.0):
        if not analysis_lines:
            return None

        try:
            pt = self.store.to_metric_point(point)
            _, details = self._calculate_min_radius_from_lines(
                analysis_lines,
                pt,
                collect_radius=collect_radius,
                epsilon=1e-6,
                return_details=True,
            )
            return details
        except Exception as e:
            print(f"Warning: Error generating diagnostics: {e}")
            return None

    def analyze_curvature(self, point, sharp_turn_threshold=10.0, default_value=2, collect_radius=5.0, include_diagnostics=False):
        input_point = self.store.to_metric_point(point)
        analysis_point, snap_info = self._snap_point_to_path_network(point)

        min_radius, width, analysis_details = self.get_radius_and_width_at_point(
            point=analysis_point,
            collect_radius=collect_radius,
            return_details=True,
        )

        is_sharp_curve = (min_radius is not None) and (min_radius < sharp_turn_threshold)
        radius_diagnostics = None
        analysis_lines = analysis_details.get("analysis_lines")
        analysis_segments = analysis_details.get("analysis_segments", [])
        if is_sharp_curve and analysis_lines:
            _, radius_diagnostics = self._calculate_min_radius_from_lines(
                analysis_lines,
                analysis_point,
                collect_radius=collect_radius,
                epsilon=1e-6,
                return_details=True,
            )
            if radius_diagnostics is not None:
                is_sharp_curve = self._supports_sharp_curve_details(
                    radius_diagnostics,
                    sharp_turn_threshold=sharp_turn_threshold,
                )
            if not include_diagnostics:
                radius_diagnostics = None

        # Once a sharp curve is already confirmed, skip expensive junction/kink checks.
        if is_sharp_curve:
            has_kink, has_path_junction = False, False
        else:
            has_kink, has_path_junction = self._check_angle_curvature(analysis_point, collect_radius=collect_radius)
        is_sharp_bend = is_sharp_curve or has_kink

        if is_sharp_bend or has_path_junction:
            curvature = 1
            if is_sharp_bend:
                if min_radius is not None and min_radius < CURVATURE_TIGHT_RADIUS_BUCKET_M:
                    subcategory = "<6.5m"
                else:
                    subcategory = "<10m"
            else:
                subcategory = "Path Junction"
        else:
            curvature = default_value
            if min_radius is not None:
                subcategory = ">18m" if min_radius > 18 else "10–18m"
            else:
                subcategory = None

        diagnostics = None
        if include_diagnostics and is_sharp_curve:
            diagnostics = radius_diagnostics
            if diagnostics is None:
                diagnostics = self._build_curvature_diagnostics(
                    analysis_lines,
                    analysis_point,
                    collect_radius=collect_radius,
                )

        return {
            "radius": min_radius,
            "width": width,
            "input_point": input_point,
            "analysis_point": analysis_point,
            "point_was_snapped": snap_info["point_was_snapped"],
            "snap_distance_m": snap_info["snap_distance_m"],
            "snap_layer": snap_info["snap_layer"],
            "layer_used": analysis_details.get("layer_used"),
            "width_layer": analysis_details.get("width_layer"),
            "first_geometry_layer": analysis_details.get("first_geometry_layer"),
            "analysis_layers": analysis_details.get("analysis_layers", []),
            "analysis_segments": analysis_segments,
            "curvature": curvature,
            "subcategory": subcategory,
            "has_sharp_curve": is_sharp_curve,
            "has_kink": has_kink,
            "has_path_junction": has_path_junction,
            "diagnostics": diagnostics,
        }

    def get_curvature(self, point, sharp_turn_threshold=10.0, default_value=2):
        """
        Calculate curvature for a segment using actual path centerline shapefiles.

        Curvature is a categorical attribute indicating whether a sharp turn is present at or near
        a segment location. This method queries actual cycling/footpath/shared path centerline
        shapefiles from Singapore's infrastructure database to find the real path geometry, then
        calculates the minimum circumradius within a local search window.

        This implements the two-stage process from the original PathAssignmentTool:
        - Stage 1: Expanding ring search (1m→5m) to locate the nearest path
        - Stage 2: Fixed window analysis (5m) to calculate curvature from that path

        Args:
            point: Shapely Point or (lon, lat) tuple representing the segment's starting point
            sharp_turn_threshold: Radius in meters below which indicates a sharp turn (default: 10.0m)
            default_value: Default category value (2 = No Sharp Turn Present) if no data found

        Returns:
            int: Curvature category
                 1 = 'Sharp Turn Present' (minimum radius < 10m)
                 2 = 'No Sharp Turn Present' (minimum radius >= 10m or no data)

        Algorithm:
        1. Extract starting point from segment geometry
        2. Use two-stage process to find path and calculate curvature:
           - Stage 1: Expanding ring (1m→5m) finds nearest path
           - Stage 2: Fixed 5m window calculates curvature from that path
        3. Densify paths (1m intervals) for accurate curvature detection
        4. Calculate minimum circumradius using triplet method
        5. Classify: radius < 10m → Sharp Turn (1), otherwise No Sharp Turn (2)
        """
        analysis = self.analyze_curvature(
            point,
            sharp_turn_threshold=sharp_turn_threshold,
            default_value=default_value,
            collect_radius=5.0,
            include_diagnostics=False,
        )
        return analysis["curvature"], analysis["subcategory"]

    def _check_angle_curvature(
        self,
        point,
        collect_radius=5.0,
        kink_angle_threshold=CURVATURE_KINK_ANGLE_THRESHOLD_DEG,
        junction_angle_threshold=CURVATURE_JUNCTION_ANGLE_THRESHOLD_DEG,
        epsilon=1e-9,
    ):
        """
        Check for two angle-based curvature conditions over all path layers within the window:

        1. KINK (along-path): Any original vertex on a path whose deflection angle exceeds
           `angle_threshold` degrees, with both adjacent legs long enough to represent a
           meaningful bend rather than micro-geometry noise.

        2. NON-PARALLEL JUNCTION (side-path): Any point where two path endpoints meet (within
           a small tolerance) and the angle between their outgoing directions — normalised to
           [0°, 90°] so direction of traversal does not matter — exceeds `angle_threshold`.
           An exactly parallel continuation scores 0°; a T-junction scores 90°.

        Both checks use only the **original (un-densified) shapefile vertices** so that
        interpolated points do not dilute sharp angles.

        Args:
            point:            Shapely Point or (lon, lat) tuple (WGS84 or metric EPSG:3414).
            collect_radius:   Search window radius in metres (default 5.0).
            kink_angle_threshold:      Degrees above which an along-path kink is flagged.
            junction_angle_threshold:  Degrees above which a branch junction is flagged.
            epsilon:          Minimum length threshold to skip degenerate segments.

        Returns:
            tuple[bool, bool]: (has_kink, has_junction)
        """
        import math

        pt = self.store.to_metric_point(point)
        endpoint_search_radius = collect_radius + CURVATURE_JUNCTION_SNAP_TOL_M
        buf = pt.buffer(endpoint_search_radius)

        all_layer_names = {
            "cycling": "cycling_path",
            "shared":  "shared_path",
            "footpath": "footpath",
        }

        # Collect original vertex lists for every segment near the point.
        all_segments = []
        for store_key in all_layer_names.values():
            try:
                gdf = self._load_path_layer(store_key)
                if gdf is None or gdf.empty:
                    continue
                cands = list(gdf.sindex.intersection(buf.bounds))
                if not cands:
                    continue
                subset = gdf.iloc[cands]
                subset = subset[subset.intersects(buf)]
                for feature_idx, geom in zip(subset.index, subset.geometry):
                    if geom.geom_type == "LineString":
                        all_segments.append({
                            "segment_id": f"{store_key}:{feature_idx}:0",
                            "coords": list(geom.coords),
                        })
                    elif geom.geom_type == "MultiLineString":
                        for part_idx, part in enumerate(geom.geoms):
                            all_segments.append({
                                "segment_id": f"{store_key}:{feature_idx}:{part_idx}",
                                "coords": list(part.coords),
                            })
            except Exception:
                continue

        if not all_segments:
            return False, False

        # ------------------------------------------------------------------
        # CHECK 1 — Sudden kink on original vertices
        # A vertex is only tested when it lies inside the analysis window.
        # ------------------------------------------------------------------
        has_kink = False
        for segment in all_segments:
            coords = segment["coords"]
            if len(coords) < 3:
                continue
            for i in range(len(coords) - 2):
                ax, ay = coords[i][:2]
                bx, by = coords[i + 1][:2]
                cx, cy = coords[i + 2][:2]
                if (bx - pt.x) ** 2 + (by - pt.y) ** 2 > collect_radius ** 2:
                    continue  # middle vertex outside window
                leg_ab = math.sqrt((bx - ax) ** 2 + (by - ay) ** 2)
                leg_bc = math.sqrt((cx - bx) ** 2 + (cy - by) ** 2)
                if leg_ab < CURVATURE_MIN_KINK_LEG_M or leg_bc < CURVATURE_MIN_KINK_LEG_M:
                    continue
                if self._deflection_angle_points((ax, ay), (bx, by), (cx, cy), epsilon=epsilon) > kink_angle_threshold:
                    has_kink = True
                    break
            if has_kink:
                break

        # ------------------------------------------------------------------
        # CHECK 2 — True branch junctions between clustered original vertices.
        # This catches both endpoint-to-endpoint joins and branches that connect
        # into an internal vertex on the main corridor.
        # ------------------------------------------------------------------
        junction_vectors = []
        min_junction_leg = CURVATURE_MIN_JUNCTION_LEG_M - 1e-6
        for segment in all_segments:
            coords = segment["coords"]
            if len(coords) < 2:
                continue
            for vertex_idx in range(len(coords)):
                vertex = coords[vertex_idx][:2]
                if ((vertex[0] - pt.x) ** 2 + (vertex[1] - pt.y) ** 2) > endpoint_search_radius ** 2:
                    continue

                for vector in self._vertex_outgoing_vectors(coords, vertex_idx, epsilon=epsilon):
                    leg = math.sqrt(vector[0] * vector[0] + vector[1] * vector[1])
                    if leg < min_junction_leg:
                        continue
                    junction_vectors.append({
                        "segment_id": segment["segment_id"],
                        "point": vertex,
                        "vector": vector,
                    })

        clusters = []
        tol_sq = CURVATURE_JUNCTION_SNAP_TOL_M * CURVATURE_JUNCTION_SNAP_TOL_M
        for entry in junction_vectors:
            matched_cluster = None
            for cluster in clusters:
                if any(
                    (existing["point"][0] - entry["point"][0]) ** 2 + (existing["point"][1] - entry["point"][1]) ** 2 <= tol_sq
                    for existing in cluster
                ):
                    matched_cluster = cluster
                    break
            if matched_cluster is None:
                clusters.append([entry])
            else:
                matched_cluster.append(entry)

        has_junction = False
        for cluster in clusters:
            if len({entry["segment_id"] for entry in cluster}) < 2:
                continue
            for i in range(len(cluster)):
                entry_a = cluster[i]
                for j in range(i + 1, len(cluster)):
                    entry_b = cluster[j]
                    if entry_a["segment_id"] == entry_b["segment_id"]:
                        continue

                    angle = self._normalized_vector_angle(
                        entry_a["vector"],
                        entry_b["vector"],
                        epsilon=epsilon,
                    )
                    if angle <= junction_angle_threshold:
                        continue

                    has_junction = True
                    continue
                if has_junction:
                    break
            if has_junction:
                break

        if not has_junction:
            for idx_a, segment_a in enumerate(all_segments):
                line_a = LineString([coord[:2] for coord in segment_a["coords"]])
                if line_a.is_empty:
                    continue

                for segment_b in all_segments[idx_a + 1:]:
                    if segment_a["segment_id"] == segment_b["segment_id"]:
                        continue

                    line_b = LineString([coord[:2] for coord in segment_b["coords"]])
                    if line_b.is_empty:
                        continue

                    intersection = line_a.intersection(line_b)
                    if intersection.is_empty:
                        continue

                    if intersection.geom_type == "Point":
                        intersection_points = [intersection]
                    elif intersection.geom_type == "MultiPoint":
                        intersection_points = list(intersection.geoms)
                    else:
                        intersection_points = []

                    for intersection_point in intersection_points:
                        if intersection_point.distance(pt) > endpoint_search_radius:
                            continue

                        directions_a = self._line_directions_at_point(line_a, intersection_point, epsilon=epsilon)
                        directions_b = self._line_directions_at_point(line_b, intersection_point, epsilon=epsilon)
                        if not directions_a or not directions_b:
                            continue

                        for direction_a in directions_a:
                            for direction_b in directions_b:
                                angle = self._normalized_vector_angle(direction_a, direction_b, epsilon=epsilon)
                                if angle <= CURVATURE_INTERSECTION_JUNCTION_ANGLE_THRESHOLD_DEG:
                                    continue

                                has_junction = True
                                break
                            if has_junction:
                                break
                        if has_junction:
                            break
                    if has_junction:
                        break
                if has_junction:
                    break

        return has_kink, has_junction

    def get_curvature_visualization(self, point, collect_radius=5.0):
        """
        Generate visualization data for curvature analysis at a given point.

        This method returns all the data needed to visualize the curvature calculation:
        - The analysis point (red dot)
        - The 5-meter analysis window (black circle)
        - Path centerlines within the window (color-coded by type)
        - Calculated radius and width values

        Args:
            point: Shapely Point or (lon, lat) tuple in WGS84
            collect_radius: Radius in meters for the analysis window (default: 5.0m)

        Returns:
            dict: Visualization data containing:
                - point: {"lon": float, "lat": float} - Analysis point in WGS84
                - radius: float or None - Calculated curvature radius in meters
                - width: float or None - Path width in meters
                - circle_geojson: GeoJSON Feature - The analysis circle
                - paths: list[dict] - Path segments with type and coordinates
                - layer_used: str or None - Which layer provided the data ("cycling", "shared", "footpath")
        """
        analysis = self.analyze_curvature(
            point,
            sharp_turn_threshold=10.0,
            default_value=2,
            collect_radius=collect_radius,
            include_diagnostics=True,
        )

        pt = analysis["analysis_point"]
        min_radius = analysis["radius"]
        width = analysis["width"]
        found_layer = analysis["layer_used"]
        diagnostics = analysis["diagnostics"]
        curvature = analysis["curvature"]
        subcategory = analysis["subcategory"]

        # Create the analysis circle (5m buffer in EPSG:3414)
        circle_geom_3414 = pt.buffer(collect_radius)

        # Transform circle to WGS84 for frontend display
        from pyproj import Transformer
        transformer = Transformer.from_crs("EPSG:3414", "EPSG:4326", always_xy=True)

        # Transform circle coordinates
        circle_coords_wgs84 = []
        for x, y in circle_geom_3414.exterior.coords:
            lon, lat = transformer.transform(x, y)
            circle_coords_wgs84.append([lon, lat])

        circle_geojson = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [circle_coords_wgs84]
            },
            "properties": {
                "radius_m": collect_radius,
                "style": {
                    "color": "#000000",
                    "weight": 2,
                    "fill": False
                }
            }
        }

        # Load path layers and collect paths within the circle
        color_map = {
            "cycling": [0, 180, 0],      # Green
            "shared": [230, 140, 0],     # Orange
            "footpath": [30, 144, 255]   # Blue
        }

        paths = []

        # Reuse the already-selected analysis segments instead of re-querying all path layers.
        analysis_segments = analysis.get("analysis_segments") or []
        for segment in analysis_segments:
            layer_key = segment.get("layer_key")
            geom = segment.get("geometry")
            if layer_key is None or geom is None or geom.is_empty:
                continue

            try:
                clipped = geom.intersection(circle_geom_3414)
            except Exception:
                clipped = geom

            for line in self._flatten_line_geometries(clipped):
                if line.is_empty:
                    continue

                coords_wgs84 = []
                for x, y in line.coords:
                    lon, lat = transformer.transform(x, y)
                    coords_wgs84.append([lon, lat])

                paths.append({
                    "type": layer_key,
                    "color": color_map.get(layer_key, [0, 0, 0]),
                    "coordinates": coords_wgs84,
                    "is_analysis_layer": True,
                })

        # Get point coordinates in WGS84
        if isinstance(point, tuple):
            point_lon, point_lat = point
        else:
            # Transform from metric to WGS84
            point_lon, point_lat = transformer.transform(pt.x, pt.y)

        return {
            "point": {
                "lon": point_lon,
                "lat": point_lat
            },
            "original_point": {
                "lon": transformer.transform(analysis["input_point"].x, analysis["input_point"].y)[0],
                "lat": transformer.transform(analysis["input_point"].x, analysis["input_point"].y)[1],
            },
            "radius": min_radius,
            "width": width,
            "curvature": curvature,
            "curvature_subcategory": subcategory,
            "circle_geojson": circle_geojson,
            "paths": paths,
            "layer_used": found_layer,
            "analysis_layers": analysis.get("analysis_layers", []),
            "analysis_window_m": collect_radius,
            "point_was_snapped": analysis.get("point_was_snapped", False),
            "snap_distance_m": analysis.get("snap_distance_m"),
            "snap_layer": analysis.get("snap_layer"),
            "diagnostics": diagnostics
        }

    def get_facility_width(self, point, start_radius=2.0, max_radius=10.0, step_size=2.0, default_value=2):
        """
        Get the facility width per direction for a point using expanding ring search.

        This implementation uses the same process as PathAssignmentTool, leveraging the
        path_width_curvature utility module which provides sophisticated width extraction
        with geometry merging, Z-coordinate removal, and comprehensive caching.

        Args:
            point: Shapely Point or (lon, lat) tuple in WGS84 or metric CRS
            start_radius: Initial search radius in meters (default: 2.0m)
            max_radius: Maximum search radius in meters (default: 10.0m)
            step_size: Radius increment in meters (default: 2.0m)
            default_value: Default category value (2 = Narrow) if no width found

        Returns:
            int: Facility width category
                 1 = 'Very Narrow' (≤ 2 meters)
                 2 = 'Narrow' (> 2 and ≤ 4 meters) - Default
                 3 = 'Wide' (> 4 meters)

        Note: This method uses the same algorithm as PathAssignmentTool:
        - Expanding ring search with priority-based layer matching
        - First-hit width locking (nearest path width is used)
        - Automatic WIDTH column standardization
        - Comprehensive geometry cleaning (remove Z, validation)
        - File modification time-based caching
        """
        # Convert point to metric CRS (EPSG:3414)
        pt = self.store.to_metric_point(point)

        # Get base directory for shapefiles from one of the registered paths
        # Extract the base directory from the cycling_path entry
        base_dir = None
        if "cycling_path" in self.store.paths:
            # Get parent of "path" directory (e.g., /path/to/shapefiles/path/file.shp -> /path/to/shapefiles)
            cycling_path = self.store.paths["cycling_path"]
            base_dir = str(cycling_path.parent.parent)

        # Use the PathAssignmentTool's utility function to get radius and width
        # radius is not used here but returned for potential future use
        _radius, total_width = get_radius_and_width_at_point(
            pt,
            start_radius=start_radius,
            max_radius=max_radius,
            step=step_size,
            priority=["cycling", "shared", "footpath"],
            base_dir=base_dir
        )

        # The shapefile WIDTH column stores the TOTAL facility width (both directions).
        # This attribute is "Facility Width per Direction", so convert total -> per
        # direction by halving before categorizing. (Total width is what the Coding
        # page box bar displays for visuals; the per-direction value drives the code.)
        if total_width is None:
            return default_value, None  # Default: Narrow (2), no sub-category
        width = total_width / 2.0

        # Categorize the per-direction width using the same thresholds as PathAssignmentTool
        if width > 4:
            category, subcat = 3, ">4m"
        elif width > 2:
            category = 2
            subcat = "3.5–4m" if width >= 3.5 else "2–<3.5m"
        else:
            category = 1
            if width <= 1.5:
                subcat = "\u22641.5m"
            elif width <= 1.8:
                subcat = ">1.5\u20131.8m"
            else:
                subcat = ">1.8\u2013<2m"
        return category, subcat

    def get_width_visualization(self, point, start_radius=1.0, max_radius=10.0, step=1.0):
        """
        Generate visualization data for facility width analysis.

        Similar to curvature visualization, this returns data for interactive display showing:
        - Analysis point
        - Expanding ring search pattern
        - Path centerlines color-coded by type
        - Which layer provided the width
        - Width distribution statistics

        Args:
            point: Shapely Point or (lon, lat) tuple in WGS84
            start_radius: Initial search radius in meters (default: 1.0m)
            max_radius: Maximum search radius in meters (default: 10.0m)
            step: Radius increment in meters (default: 1.0m)

        Returns:
            dict: Visualization data
        """
        from pyproj import Transformer

        # Convert point to metric CRS
        pt = self.store.to_metric_point(point)

        # Load path layers
        priority = ["cycling", "shared", "footpath"]
        layer_names = {
            "cycling": "cycling_path",
            "shared": "shared_path",
            "footpath": "footpath"
        }
        color_map = {
            "cycling": [0, 180, 0],      # Green
            "shared": [230, 140, 0],     # Orange
            "footpath": [30, 144, 255]   # Blue
        }

        layers = {}
        width_distribution = {}

        for layer_key in priority:
            try:
                gdf = self.store.get(layer_names[layer_key])
                if gdf is None or gdf.empty:
                    layers[layer_key] = None
                    width_distribution[layer_key] = {"min": None, "max": None, "count": 0}
                    continue

                if gdf.crs.to_epsg() != 3414:
                    gdf = gdf.to_crs("EPSG:3414")

                layers[layer_key] = gdf

                # Get width distribution
                if "WIDTH" in gdf.columns:
                    valid_widths = gdf["WIDTH"].dropna()
                    if len(valid_widths) > 0:
                        width_distribution[layer_key] = {
                            "min": float(valid_widths.min()),
                            "max": float(valid_widths.max()),
                            "count": len(gdf)
                        }
                    else:
                        width_distribution[layer_key] = {"min": None, "max": None, "count": len(gdf)}
                else:
                    width_distribution[layer_key] = {"min": None, "max": None, "count": len(gdf)}

            except Exception as e:
                print(f"Warning: Could not load {layer_key}: {e}")
                layers[layer_key] = None
                width_distribution[layer_key] = {"min": None, "max": None, "count": 0}

        # Perform expanding ring search with diagnostics
        search_rings = []
        found_width = None
        found_layer = None
        found_radius = None

        # Track footpath detection for cycling path override logic
        footpath_detected = False
        footpath_width = None

        for radius in np.arange(start_radius, max_radius + step, step):
            buf = pt.buffer(radius)
            candidates_by_layer = {}

            for layer_key in priority:
                gdf = layers[layer_key]
                if gdf is None or gdf.empty:
                    candidates_by_layer[layer_key] = 0
                    continue

                try:
                    idx = list(gdf.sindex.query(buf, predicate="intersects"))
                except:
                    idx = []

                candidates_by_layer[layer_key] = len(idx)

                # Lock width if not yet set
                if idx and found_width is None:
                    candidates = gdf.iloc[idx].copy()

                    if "WIDTH" in candidates.columns:
                        candidates["_WIDTH_NUM"] = pd.to_numeric(candidates["WIDTH"], errors='coerce')
                        valid = candidates[candidates["_WIDTH_NUM"].notna()]

                        if not valid.empty:
                            dists = valid.geometry.distance(pt)
                            nearest_idx = dists.idxmin()
                            width_val = float(valid.loc[nearest_idx, "_WIDTH_NUM"])

                            # Track if this is a footpath
                            if layer_key == "footpath":
                                footpath_detected = True
                                footpath_width = width_val

                            found_width = width_val
                            found_layer = layer_key
                            found_radius = radius

            search_rings.append({
                "radius": float(radius),
                "center": [point.x if hasattr(point, 'x') else point[0],
                          point.y if hasattr(point, 'y') else point[1]],
                "candidates_by_layer": candidates_by_layer,
                "width_locked": found_width is not None
            })

        # SPECIAL LOGIC: If on/near footpath, check if cycling path is within 1.5m
        # If so, use the cycling path width instead
        if footpath_detected and found_layer == "footpath":
            cycling_override_radius = 1.5  # meters
            cycling_gdf = layers.get("cycling")

            if cycling_gdf is not None and not cycling_gdf.empty:
                cycling_buf = pt.buffer(cycling_override_radius)
                try:
                    cycling_idx = list(cycling_gdf.sindex.query(cycling_buf, predicate="intersects"))

                    if cycling_idx:
                        cycling_candidates = cycling_gdf.iloc[cycling_idx].copy()

                        if "WIDTH" in cycling_candidates.columns:
                            cycling_candidates["_WIDTH_NUM"] = pd.to_numeric(cycling_candidates["WIDTH"], errors='coerce')
                            cycling_valid = cycling_candidates[cycling_candidates["_WIDTH_NUM"].notna()]

                            if not cycling_valid.empty:
                                # Found cycling path within 1.5m - use it instead
                                cycling_dists = cycling_valid.geometry.distance(pt)
                                cycling_nearest_idx = cycling_dists.idxmin()
                                found_width = float(cycling_valid.loc[cycling_nearest_idx, "_WIDTH_NUM"])
                                found_layer = "cycling"
                                # Keep the original found_radius (where footpath was found)
                                # Add note that cycling path was prioritized
                except:
                    pass  # Cycling override failed, keep footpath width

        # Categorize width
        # Very Narrow: < 2m
        # Narrow: >= 2m and <= 4m
        # Wide: > 4m
        if found_width is None:
            width_category = 2  # Default: Narrow
        elif found_width > 4:
            width_category = 3  # Wide
        elif found_width >= 2:
            width_category = 2  # Narrow
        else:
            width_category = 1  # Very Narrow (< 2m)

        # Collect path geometries within visualization radius (20m)
        viz_radius = 20.0
        viz_buffer = pt.buffer(viz_radius)
        paths = []

        transformer = Transformer.from_crs("EPSG:3414", "EPSG:4326", always_xy=True)

        for layer_key in priority:
            gdf = layers[layer_key]
            if gdf is None or gdf.empty:
                continue

            try:
                idx = list(gdf.sindex.query(viz_buffer, predicate="intersects"))
            except:
                idx = []

            if not idx:
                continue

            nearby = gdf.iloc[idx]

            for _, feature in nearby.iterrows():
                geom = feature.geometry
                if geom is None or geom.is_empty:
                    continue

                # Transform to WGS84
                coords_wgs84 = []

                # Handle both LineString and MultiLineString geometries
                if geom.geom_type == "LineString":
                    for coord in geom.coords:
                        x, y = coord[0], coord[1]  # Handle both 2D and 3D coords
                        lon, lat = transformer.transform(x, y)
                        coords_wgs84.append([lon, lat])
                elif geom.geom_type == "MultiLineString":
                    # For MultiLineString, concatenate all parts
                    for line in geom.geoms:
                        for coord in line.coords:
                            x, y = coord[0], coord[1]  # Handle both 2D and 3D coords
                            lon, lat = transformer.transform(x, y)
                            coords_wgs84.append([lon, lat])
                else:
                    # Skip unsupported geometry types
                    continue

                width_value = feature.get("WIDTH", None)

                paths.append({
                    "type": layer_key,
                    "color": color_map.get(layer_key, [0, 0, 0]),
                    "coordinates": coords_wgs84,
                    "is_analysis_layer": (layer_key == found_layer) if found_layer else False,
                    "width_value": float(width_value) if width_value is not None else None
                })

        # Get point coordinates
        if isinstance(point, tuple):
            point_lon, point_lat = point
        else:
            point_lon, point_lat = point.x, point.y

        return {
            "point": {
                "lon": point_lon,
                "lat": point_lat
            },
            "width": found_width,
            "width_category": width_category,
            "search_info": {
                "found_at_radius": found_radius,
                "layer_used": found_layer,
                "total_radii_checked": len(search_rings),
                "start_radius": start_radius,
                "max_radius": max_radius,
                "step": step
            },
            "search_rings": search_rings,
            "paths": paths,
            "width_distribution": width_distribution,
            "category_labels": {
                1: "Very Narrow (< 2m)",
                2: "Narrow (2-4m)",
                3: "Wide (> 4m)"
            }
        }

    @staticmethod
    def _remove_z_coordinate(geom):
        """Remove Z-coordinate from geometry (convert 3D to 2D)"""
        from shapely.geometry import LineString, Point, Polygon, MultiLineString, MultiPoint, MultiPolygon

        if geom is None or geom.is_empty:
            return geom

        geom_type = geom.geom_type

        if geom_type == 'Point':
            return Point(geom.x, geom.y)
        elif geom_type == 'LineString':
            return LineString([(x, y) for x, y, *_ in geom.coords])
        elif geom_type == 'Polygon':
            exterior = [(x, y) for x, y, *_ in geom.exterior.coords]
            interiors = [[(x, y) for x, y, *_ in interior.coords] for interior in geom.interiors]
            return Polygon(exterior, interiors)
        elif geom_type == 'MultiPoint':
            return MultiPoint([Point(p.x, p.y) for p in geom.geoms])
        elif geom_type == 'MultiLineString':
            return MultiLineString([LineString([(x, y) for x, y, *_ in line.coords]) for line in geom.geoms])
        elif geom_type == 'MultiPolygon':
            return MultiPolygon([
                Polygon(
                    [(x, y) for x, y, *_ in poly.exterior.coords],
                    [[(x, y) for x, y, *_ in interior.coords] for interior in poly.interiors]
                )
                for poly in geom.geoms
            ])
        else:
            # For other geometry types, return as-is
            return geom

    @staticmethod
    def _standardize_width_column(gdf):
        """
        Standardize WIDTH column in the GeoDataFrame.

        Looks for various width column candidates (case-insensitive):
        - WIDTH, width, Width
        - PATH_WIDTH, path_width, Path_Width
        - L_WIDTH, R_WIDTH, AVG_WIDTH, avg_width
        - Wdth, WID, Width_m, WIDTH_M

        If found, renames to "WIDTH" and converts to numeric type.
        If not found, creates "WIDTH" column with NaN values.

        Args:
            gdf: GeoDataFrame with potential width columns

        Returns:
            GeoDataFrame with standardized "WIDTH" column
        """
        # Width column candidates (case-insensitive)
        width_candidates = [
            "WIDTH", "width", "Width",
            "PATH_WIDTH", "path_width", "Path_Width",
            "L_WIDTH", "R_WIDTH", "AVG_WIDTH", "avg_width",
            "Wdth", "WID", "Width_m", "WIDTH_M"
        ]

        # Find the first matching column
        found_col = None
        for candidate in width_candidates:
            # Case-insensitive search
            matching_cols = [col for col in gdf.columns if col.upper() == candidate.upper()]
            if matching_cols:
                found_col = matching_cols[0]
                break

        if found_col and found_col != "WIDTH":
            # Rename to standardized "WIDTH"
            gdf = gdf.rename(columns={found_col: "WIDTH"})
        elif not found_col:
            # Create WIDTH column with NaN values
            gdf["WIDTH"] = np.nan

        # Convert to numeric type (coercing errors to NaN)
        if "WIDTH" in gdf.columns:
            gdf["WIDTH"] = pd.to_numeric(gdf["WIDTH"], errors='coerce')

        return gdf
