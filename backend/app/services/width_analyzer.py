"""Facility-width analysis extracted from the GIS spatial-query class.

Owns the expanding-ring width search and its map overlay. Instances hold a
back-reference to the parent :class:`GIS` (``self.gis``) and reach shared map
data through ``self.gis.store``.

Public entry points (also exposed on GIS as thin delegators):
  - get_facility_width(point, ...) -> (category, subcategory)
  - get_width_visualization(point, ...) -> dict for the map overlay

_standardize_width_column is a static helper shared with CurvatureAnalyzer
(reached via GIS as self.gis._standardize_width_column).

See REFACTOR_PLAN.md S3.4.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

# Two-stage width+curvature utility used by get_facility_width (unchanged).
from app.utils.path_width_curvature import get_radius_and_width_at_point


class WidthAnalyzer:
    """Facility-width search for a parent :class:`GIS` instance."""

    def __init__(self, gis):
        # Back-reference to the owning GIS; shared map data via self.gis.store.
        self.gis = gis

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
        pt = self.gis.store.to_metric_point(point)

        # Get base directory for shapefiles from one of the registered paths
        # Extract the base directory from the cycling_path entry
        base_dir = None
        if "cycling_path" in self.gis.store.paths:
            # Get parent of "path" directory (e.g., /path/to/shapefiles/path/file.shp -> /path/to/shapefiles)
            cycling_path = self.gis.store.paths["cycling_path"]
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
        pt = self.gis.store.to_metric_point(point)

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
                gdf = self.gis.store.get(layer_names[layer_key])
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
