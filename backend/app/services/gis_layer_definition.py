"""
GIS Layer Definitions
Defines structure and requirements for each GIS layer to maximize portability
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional


@dataclass
class LayerDefinition:
    """
    Defines how a GIS layer is used in autocoding.
    Separates structure (what columns/geometry it needs)
    from logic (how it's used in calculations).
    """
    name: str                                    # e.g., "cycling_path"
    geometry_types: List[str]                    # ["LineString", "MultiLineString"]
    required_columns: List[str]                  # Columns that MUST be present
    query_type: str                              # "near", "poly", "buffer", "nearest_with_lookup"
    description: str = ""
    default_buffer_m: float = 20.0
    column_aliases: Dict[str, List[str]] = field(default_factory=dict)  # Alternative column names

    def get_column_name(self, required_col: str, gdf_columns: List[str]) -> Optional[str]:
        """
        Find the actual column name in a geodataframe for a required column.
        Handles aliases like WIDTH → PATH_WIDTH, width, W_WIDTH, etc.

        Args:
            required_col: Required column (e.g., "WIDTH")
            gdf_columns: Available columns in the geodataframe

        Returns:
            Actual column name if found, else None
        """
        gdf_cols_upper = {col.upper(): col for col in gdf_columns}

        # Check exact match first
        if required_col.upper() in gdf_cols_upper:
            return gdf_cols_upper[required_col.upper()]

        # Check aliases
        if required_col in self.column_aliases:
            for alias in self.column_aliases[required_col]:
                if alias.upper() in gdf_cols_upper:
                    return gdf_cols_upper[alias.upper()]

        return None


# Define all layers and their requirements
LAYER_DEFINITIONS: Dict[str, LayerDefinition] = {
    # --- Area Type Layers (Polygon containment queries) ---
    "Centralmb2025": LayerDefinition(
        name="Centralmb2025",
        geometry_types=["Polygon", "MultiPolygon"],
        required_columns=["PARKING_ZO (1)", "STATION_NA (2)"],
        query_type="poly",
        description="Area type (Urban)",
        default_buffer_m=20.0,
    ),
    "area_type": LayerDefinition(
        name="area_type",
        geometry_types=["Polygon", "MultiPolygon"],
        required_columns=["LU_DESC (1)", "LU_TEXT (3)"],
        query_type="poly",
        description="Area type (Urban, Industrial, Rural, Recreational)",
        default_buffer_m=20.0,
        column_aliases={
            "LU_DESC": ["LU_DESC", "PARKING_ZO", "STATION_NA", "DESC", "DESCRIPTION", "ZONE", "NAME"],
            "LU_TEXT": ["LU_TEXT", "LU_DESC", "DESC", "NAME"],
        },
    ),
    "LanduseRural2026": LayerDefinition(
        name="LanduseRural2026",
        geometry_types=["Polygon", "MultiPolygon"],
        required_columns=["LU_DESC (1)", "LU_TEXT (3)"],
        query_type="poly",
        description="Area type (Rural)",
        default_buffer_m=20.0,
    ),
    "LanduseRecre2026": LayerDefinition(
        name="LanduseRecre2026",
        geometry_types=["Polygon", "MultiPolygon"],
        required_columns=["LU_DESC (1)", "LU_TEXT (3)"],
        query_type="poly",
        description="Area type (Recreational)",
        default_buffer_m=20.0,
    ),
    "rural": LayerDefinition(
        name="rural",
        geometry_types=["Polygon", "MultiPolygon"],
        required_columns=["LU_DESC (1)", "LU_TEXT (3)"],
        query_type="poly",
        description="Rural area",
        default_buffer_m=20.0,
    ),
    "recreation": LayerDefinition(
        name="recreation",
        geometry_types=["Polygon", "MultiPolygon"],
        required_columns=["LU_DESC (1)", "LU_TEXT (3)"],
        query_type="poly",
        description="Recreation area",
        default_buffer_m=20.0,
    ),

    # --- Proximity Queries (Point/Line distance queries) ---
    "Mrt_exit": LayerDefinition(
        name="Mrt_exit",
        geometry_types=["Point", "MultiPoint"],
        required_columns=["STATION_NA (1)", "EXIT_CODE (2)"],
        query_type="near",
        description="Pedestrian Crossing, Peak Flow",
        default_buffer_m=20.0,
        column_aliases={
            "STATION_NA": ["STATION_NA", "STATION_NAME", "NAME", "EXIT_CODE", "EXIT_NAME", "CODE"]
        },
    ),
    "bus_stop": LayerDefinition(
        name="bus_stop",
        geometry_types=["Point", "MultiPoint"],
        required_columns=["BUS_STOP_N (1)", "LOC_DESC (3)"],
        query_type="near",
        description="Pedestrian Crossing, Peak Flow",
        default_buffer_m=20.0,
        column_aliases={
            "BUS_STOP_N": ["BUS_STOP_N", "BUS_STOP_NO", "BUS_STOP_C", "BUS_STOP_CODE", "CODE", "NAME", "LOC_DESC"]
        },
    ),
    "BusShelter": LayerDefinition(
        name="BusShelter",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["BUS_ROOF_N (1)", "LOC_DESC (2)"],
        query_type="near",
        description="Pedestrian Crossing, Peak Flow",
        default_buffer_m=20.0,
    ),
    "bus_lane": LayerDefinition(
        name="bus_lane",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["TYP_CD (1)", "TYP_NAM (2)"],
        query_type="near",
        description="Heavy vehicle flow; Extracted Type: A1, A6, A7, L, Q, Q1, Q2, Y",
        default_buffer_m=20.0,
    ),
    "LIDAR_scan": LayerDefinition(
        name="LIDAR_scan",
        geometry_types=["Polygon", "MultiPolygon", "Point"],
        required_columns=["ELEVATION (1)"],
        query_type="near",
        description="Grade",
        default_buffer_m=5.0,
    ),
    "Defects": LayerDefinition(
        name="Defects",
        geometry_types=["Point", "MultiPoint", "Polygon", "MultiPolygon"],
        required_columns=["DEFECT_TYP (1)"],
        query_type="near",
        description="Loose/Slippery surface, major surface deformation",
        default_buffer_m=10.0,
    ),
    "pedestrian_crossing": LayerDefinition(
        name="pedestrian_crossing",
        geometry_types=["LineString", "MultiLineString", "Point", "MultiPoint", "Polygon", "MultiPolygon"],
        required_columns=["UNIQUE_ID (1)"],
        query_type="near",
        description="Pedestrian crossing, intersecting bicycle facility",
        default_buffer_m=5.0,
    ),
    "parking_lot": LayerDefinition(
        name="parking_lot",
        geometry_types=["Polygon", "MultiPolygon"],
        required_columns=["PP_CODE (1)", "LOT_NO (2)", "TYPE (3)"],
        query_type="near",
        description="Adjacent Vehicle Parking",
        default_buffer_m=20.0,
    ),
    "HDB_CAR_PARK_LOTS": LayerDefinition(
        name="HDB_CAR_PARK_LOTS",
        geometry_types=["Point", "MultiPoint", "Polygon", "MultiPolygon"],
        required_columns=["CARPARKNO (1)", "NOOFCARLOT (2)"],
        query_type="near",
        description="Adjacent Vehicle Parking",
        default_buffer_m=20.0,
    ),
    "roadcrossinglayer": LayerDefinition(
        name="roadcrossinglayer",
        geometry_types=["LineString", "MultiLineString", "Point"],
        required_columns=["UNIQUE_ID (1)"],
        query_type="near",
        description="Pedestrian Crossing",
        default_buffer_m=5.0,
    ),
    "AMG_BC2025_shp": LayerDefinition(
        name="AMG_BC2025_shp",
        geometry_types=["LineString", "MultiLineString", "Point"],
        required_columns=["UNIQUE_ID (1)"],
        query_type="near",
        description="Intersection or Road Crossing, Crossing Facility",
        default_buffer_m=2.0,
    ),

    # --- Path Feature Layers (LineString width/curvature queries) ---
    "path": LayerDefinition(
        name="path",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["WIDTH (1)"],
        query_type="near",
        description="Facility Width, Curvature",
        default_buffer_m=5.0,
        column_aliases={
            "WIDTH": ["WIDTH", "PATH_WIDTH", "W_WIDTH", "width", "Width_m", "WIDTH_M", "Wdth", "WID"]
        },
    ),
    # Legacy keys for backward compatibility
    "cycling_path": LayerDefinition(
        name="cycling_path",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["WIDTH (1)"],
        query_type="near",
        description="Facility Width, Curvature",
        default_buffer_m=5.0,
    ),
    "shared_path": LayerDefinition(
        name="shared_path",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["WIDTH (1)"],
        query_type="near",
        description="Facility Width, Curvature",
        default_buffer_m=5.0,
    ),
    "footpath": LayerDefinition(
        name="footpath",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["WIDTH (1)"],
        query_type="near",
        description="Facility Width, Curvature",
        default_buffer_m=5.0,
    ),
    "CyclingPath_Jul2024": LayerDefinition(
        name="CyclingPath_Jul2024",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["path_width (1)", "path_type (2)"],
        query_type="near",
        description="Facility Width, Curvature",
        default_buffer_m=5.0,
        column_aliases={
            "path_width": ["path_width", "WIDTH", "width", "W_WIDTH", "Width_m", "WIDTH_M"]
        },
    ),
    "CyclingPathGazette": LayerDefinition(
        name="CyclingPathGazette",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["PLANNING_A (1)", "PLANNING_1 (2)"],
        query_type="near",
        description="Planning Area Reference",
        default_buffer_m=5.0,
    ),
    "FootPath_Mar2025": LayerDefinition(
        name="FootPath_Mar2025",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["WDT_CATG_C (1)", "TYP_CD (2)"],
        query_type="near",
        description="Facility Width, Curvature",
        default_buffer_m=5.0,
        column_aliases={
            "WDT_CATG_C": ["WDT_CATG_C", "WIDTH", "width", "WDT_CATG_1"]
        },
    ),

    # --- Road Data Layers (Lookup/Attribute queries) ---
    "LinkID_Shape_File": LayerDefinition(
        name="LinkID_Shape_File",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["LK_ID_NUM (1)"],
        query_type="nearest_with_lookup",
        description="Road operating speed (mean)",
        default_buffer_m=20.0,
        column_aliases={
            "LK_ID_NUM": ["LK_ID_NUM", "LINKID", "LINK_ID", "LinkID", "ID", "link_id"]
        },
    ),
    "LinkID_Node": LayerDefinition(
        name="LinkID_Node",
        geometry_types=["Point", "MultiPoint"],
        required_columns=["NODE_ID_NU (1)", "RD_TYP_CD (2)"],
        query_type="near",
        description="Road Network Node Reference",
        default_buffer_m=20.0,
    ),
    "Speed_limit": LayerDefinition(
        name="Speed_limit",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["SPEEDLIMIT (1)"],
        query_type="nearest_with_attribute",
        description="Road speed limit",
        default_buffer_m=20.0,
        column_aliases={
            "SPEEDLIMIT": ["SPEEDLIMIT", "SPEED_LIMIT", "SPEED_LIM", "speedlimit", "speed_limit", "LIMIT"]
        },
    ),
    "kerb_line": LayerDefinition(
        name="kerb_line",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["LANES (1)", "LOCATION (2)", "DIRECTION (3)"],
        query_type="nearest",
        description="Number of lanes – adjacent road",
        default_buffer_m=10.0,
        column_aliases={
            "LANES": ["LANES", "NUM_LANES", "LANE_COUNT", "UNIQUE_ID", "ID"]
        },
    ),

    # --- Pedestrian/Traffic Flow Layers (Temporal queries) ---
    "AMGbeforeCount": LayerDefinition(
        name="AMGbeforeCount",
        geometry_types=["Point", "MultiPoint"],
        required_columns=["DataType (1)", "DateTime (2)", "Count_Data (3)"],
        query_type="temporal_aggregation",
        description="Peak Pedestrian Flow, Peak Bicycle Traffic Flow",
        default_buffer_m=20.0,
    ),
    "AMGsensorCount": LayerDefinition(
        name="AMGsensorCount",
        geometry_types=["Point", "MultiPoint"],
        required_columns=["Pivot_user (1)", "Datetime_p (2)", "Count (3)"],
        query_type="temporal_aggregation",
        description="Peak Pedestrian Flow, Peak Bicycle Traffic Flow",
        default_buffer_m=20.0,
    ),

    # --- Miscellaneous ---
    "Planning_area": LayerDefinition(
        name="Planning_area",
        geometry_types=["Polygon", "MultiPolygon"],
        required_columns=["PLN_AREA_N (1)"],
        query_type="poly",
        description="Area-based reporting",
        default_buffer_m=0.0,
    ),
    "Road_name": LayerDefinition(
        name="Road_name",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["RD_CD_DESC (1)"],
        query_type="near",
        description="Road name reference",
        default_buffer_m=10.0,
        column_aliases={
            "RD_CD_DESC": ["RD_CD_DESC", "RD_NAM", "RD_NAME", "ROAD_NAME", "NAME"]
        },
    ),
    "Road_network_line": LayerDefinition(
        name="Road_network_line",
        geometry_types=["LineString", "MultiLineString"],
        required_columns=["RD_TYP_CD (1)"],
        query_type="near",
        description="Road name reference",
        default_buffer_m=10.0,
    ),
}



def get_layer_definition(layer_name: str) -> Optional[LayerDefinition]:
    """
    Get definition for a layer by name.
    Performs case-insensitive lookup and handles versioned folder names.
    """
    if not layer_name:
        return None

    # 1. Direct match (case-sensitive)
    if layer_name in LAYER_DEFINITIONS:
        return LAYER_DEFINITIONS[layer_name]

    # 2. Case-insensitive match
    lower_name = layer_name.lower()
    for key, ld in LAYER_DEFINITIONS.items():
        if key.lower() == lower_name:
            return ld

    # 3. Fuzzy match for versioned folders (e.g., "CyclingPath_Jul2024" -> "cycling_path")
    # Clean both strings of non-alphanumeric chars for comparison
    import re
    def clean(s): return re.sub(r'[^a-z0-9]', '', s.lower())
    
    clean_name = clean(layer_name)
    for key, ld in LAYER_DEFINITIONS.items():
        clean_key = clean(key)
        if clean_key in clean_name or clean_name in clean_key:
            return ld

    return None


def list_layer_definitions() -> Dict[str, LayerDefinition]:
    """List all layer definitions"""
    return LAYER_DEFINITIONS.copy()
