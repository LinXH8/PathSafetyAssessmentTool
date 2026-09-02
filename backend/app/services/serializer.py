from __future__ import annotations

import re
import shutil
# import pythoncom  # Windows-only, not used in this module
import json
import app.services.global_var as global_var
import pandas as pd
import geopandas as gpd
import requests
import os

from datetime import datetime
from shapely import wkt
from pathlib import Path
from pandas.errors import EmptyDataError

# Mapping
risk_category                   = {'Default': 0,'Low': 1, 'Medium': 2, 'High': 3, 'Extreme': 4}
area_type_mapping               = {'Urban': 1, 'Suburban': 2, 'Rural': 3, 'Industrial': 4, 'Recreational': 5}
facility_type_mapping           = {'Footpath': 1, 'Shared Path': 2, 'Cycling Path': 3,
                                    'On-road Bicycle Lane': 4, 'Road Shoulder': 5, 'Mixed Traffic Road Lane': 6}
presence_mapping                = {'Present': 1, 'Not Present': 2}
adequecy_mapping                = {'Adequate': 1, 'Inadequate': 2}
facility_width_mapping          = {'Very Narrow': 1, 'Narrow': 2, 'Wide': 3}
flow_direction_mapping          = {'One Way': 1, 'Two Way': 2}
within_5deg_mapping             = {'< 5 Degrees': 1, '=/> 5 Degrees': 2}
sharp_turn_mapping              = {'Sharp Turn Present': 1, 'No Sharp Turn Present': 2}
shared_mapping                  = {'Shared': 1, 'Separate/NA': 2}
NoL_mapping                     = {'1 per Direction/NA': 1, '> 1 per Direction': 2}
none_low_modhigh_mapping        = {'None': 1, 'Low': 2, 'Moderate to high': 3}
low_modhigh_mapping             = {'Low': 1, 'Moderate to high': 2}
less_more_20_mapping            = {'< 20km/h': 1, '=/> 20km/h': 2}
less_more_10_mapping            = {'< 10km/h': 1, '=/> 10km/h': 2}
operating_speed_unit_mapping    = {'km/h': 1, 'mph': 2}
road_speed_limit_mapping        = {
    'NA': 'NA',
    '0 km/h': '0',
    '10 km/h': '10',
    '20 km/h': '20',
    '30 km/h': '30',
    '40 km/h': '40',
    '50 km/h': '50',
    '60 km/h': '60',
    '70 km/h': '70',
    '80 km/h': '80',
    '90 km/h': '90',
    '100 km/h': '100',
    '110 km/h': '110',
    '120 km/h': '120',
}

class LocWrapper:
    def __init__(self, parent):
        self._parent = parent

    def __getitem__(self, key):
        return self._parent.df.loc[key]

    def __setitem__(self, key, value):
        self._parent.df.loc[key] = value
        self._parent.df_dirty = True

class BaseTable:
    def __init__(self, field_class, size=0, values=None):
        self.Fields = field_class
        self.fields = [
            v for k, v in field_class.__dict__.items()
            if isinstance(v, str) and k.endswith('_STR')
        ]
    
        if values is not None:
            self._df = pd.DataFrame([values] * size, columns=self.fields)
        elif size > 0:
            self._df = pd.DataFrame([{f: None for f in self.fields} for _ in range(size)])
        else:
            self._df = pd.DataFrame(columns=self.fields)

        self.df_dirty = False
        self.loc = LocWrapper(self)

    @property
    def df(self) -> pd.DataFrame:
        return self._df

    @df.setter
    def df(self, value : pd.DataFrame):
        if not isinstance(value, pd.DataFrame):
            raise TypeError("Value is not a pd.Dataframe")
        self._df = value
        self.df_dirty = True   

    def serialize(self, file_path: Path):
        file_path.parent.mkdir(parents=True, exist_ok=True)
        ext = file_path.suffix.lower()
        df = self.df if getattr(self, "df", None) is not None else pd.DataFrame()
        if ext == ".csv":
            df.to_csv(file_path, index=False)
        elif ext == ".xlsx":
            df.to_excel(file_path, index=False)
        elif ext == ".json":
            df.to_json(file_path, orient="records")
        else:
            raise ValueError(f"Unsupported file type: {ext}")
        self.df_dirty = False

    def parse(self, file_path: Path):
        """Read table from disk; if the file is missing or empty, initialise an empty DataFrame and mark dirty."""
        # 1) Missing or empty file: initialise an empty DataFrame
        if not file_path.exists() or file_path.stat().st_size == 0:  # ← key: fall back cleanly for empty files
            self.df = pd.DataFrame()
            self.df_dirty = True
            return

        ext = file_path.suffix.lower()
        if ext == ".csv":
            try:
                self.df = pd.read_csv(file_path, encoding="utf-8")
            except UnicodeDecodeError:
                self.df = pd.read_csv(file_path, encoding="latin1")
            except EmptyDataError:  # ← key: fall back cleanly even when the CSV is empty
                self.df = pd.DataFrame()
                self.df_dirty = True
                return
        elif ext == ".xlsx":
            self.df = pd.read_excel(file_path)
        elif ext == ".json":
            self.df = pd.read_json(file_path)
        else:
            raise ValueError(f"Unsupported file type: {ext}")

        # Add missing columns defined in the schema (e.g. for backward compatibility)
        if hasattr(self, 'fields') and self.fields:
            for count, col in enumerate(self.fields):
                if col not in self.df.columns:
                    # Insert missing column at the schema-defined index if possible
                    try:
                        self.df.insert(count, col, None)
                    except ValueError:
                        self.df[col] = None

        self.df_dirty = False
    
class Attributes(BaseTable):
    class Fields:
        AREA_TYPE_STR                   = "Area type"
        FACILITY_TYPE_STR               = "Facility Type"
        FACILITY_ACCESS_STR             = "Facility access"
        LINE_OF_SIGHT_STR               = "Line of Sight"
        LOOSE_SLIPPERY_SURFACE_STR      = "Loose or slippery surface"
        TRAM_TRAIN_RAIL_STR             = "Tram or Train Rails"
        DEFORMATION_DRAIN_STR           = "Major Surface Deformation or Drain Opening"
        DEFECT_TYPE_STR                 = "Defect Type"
        FIXED_OBSTACLE_STR              = "Fixed Obstacle on Facility"
        FIXED_OBSTACLE_TYPE_STR         = "FO Type"
        NON_FIXED_OBSTACLE_STR          = "Non-Fixed Obstacle on Facility"
        NON_FIXED_OBSTACLE_TYPE_STR     = "NFO Type"
        LOOSE_SLIPPERY_ISSUE_TYPE_STR   = "Issue Type (Slippery)"
        DELINEATION_STR                 = "Delineation"
        DELINEATION_TYPE_STR            = "Delineation Type"
        LIGHT_SEGREGATION_STR           = "Light Segregation"
        FACILITY_WIDTH_STR              = "Facility Width per Direction"
        FLOW_DIR_STR                    = "Flow Direction"
        WIDTH_RESTRICTION_STR           = "Width Restriction"
        ADJ_ROAD_LANE_01M_STR           = "Adjacent Road Lane 0-1m"
        ADJ_VHCL_PARKING_01M_STR        = "Adjacent Vehicle Parking 0-1m"
        ADJ_SVR_PARKING_01M_STR         = "Adjacent Severe Hazard 0-1m"
        ADJ_OBJ_LVL_CHGE_01M_STR        = "Adjacent object or level change 0-1m"
        ADJ_SIDEWALK_01M_STR            = "Adjacent Sidewalk 0-1m"
        ADJ_ROAD_LANE_13M_STR           = "Adjacent Road Lane 1-3m"
        ADJ_VHCL_PARKING_13M_STR        = "Adjacent Vehicle Parking 1-3m"
        ADJ_SVR_HAZARD_13M_STR          = "Adjacent Severe Hazard 1-3m"
        ADJ_OBJ_LVL_CHGE_13M_STR        = "Adjacent object or level change 1-3m"
        ADJ_SIDEWALK_13M_STR            = "Adjacent Sidewalk 1-3m"
        GRADE_STR                       = "Grade"
        CURV_STR                        = "Curvature"
        STREET_LIGHT_STR                = "Street Lighting"
        PED_CROSS_STR                   = "Pedestrian Crossing"
        INTERSECT_FACILITY_STR          = "Intersecting Bicycle Facility"
        INTERSECT_APPRCH_STR            = "Intersection Approach"
        INTERSECT_ROAD_CROSS_STR        = "Intersection or Road Crossing"
        CROSS_FACILITY_STR              = "Crossing Facility"
        CROSSING_TYPE_STR               = "Crossing Type"
        NOL_ADJ_ROAD_STR                = "Number of lanes – adjacent road"
        NOL_INTERSECT_ROAD_STR          = "Number of lanes – intersecting road"
        PROP_ACCESS_STR                 = "Property Access"
        PEAK_PED_FLOW_STR               = "Peak pedestrian flow along or across facility"
        PEAK_BICYCLE_TRAFFIC_FLOW_STR   = "Peak bicycle/LV traffic flow"
        OBSERVED_PROPORTION_STR         = "Observed proportion of cargo bikes and mopeds"
        BICYCLE_SPD_AVG_STR             = "Bicycle/LV speed – average"
        BICYCLE_SPD_DIFF_STR            = "Bicycle/LV speed differential"
        ROAD_AADT_STR                   = "Road AADT"
        HEAVY_VHCL_FLOW_STR             = "Heavy vehicle flow"
        SPD_LIMIT_STR                   = "Road speed limit"
        ROAD_OPR_SPEED_AVG_STR          = "Road operating speed (mean)"
        SPEED_UNIT_STR                  = "Road operating speed (unit)"
        FACILITY_WIDTH_SUBCAT_STR       = "Facility Width Sub-category"
        CURVATURE_SUBCAT_STR            = "Curvature Sub-category"

        @classmethod
        def values(cls) -> list[str]:
            return [v for k, v in cls.__dict__.items() if not k.startswith("__") and isinstance(v, str)]

    CHOICES = {
        Fields.AREA_TYPE_STR:                   area_type_mapping,
        Fields.FACILITY_TYPE_STR:               facility_type_mapping,
        Fields.FACILITY_ACCESS_STR:             adequecy_mapping,
        "Line of Sight":                        adequecy_mapping,
        Fields.LOOSE_SLIPPERY_SURFACE_STR:      presence_mapping,
        Fields.TRAM_TRAIN_RAIL_STR:             presence_mapping,
        Fields.DEFORMATION_DRAIN_STR:           presence_mapping,
        Fields.DEFECT_TYPE_STR:                 None,
        Fields.FIXED_OBSTACLE_STR:              presence_mapping,
        Fields.FIXED_OBSTACLE_TYPE_STR:         None,
        Fields.NON_FIXED_OBSTACLE_STR:          presence_mapping,
        Fields.NON_FIXED_OBSTACLE_TYPE_STR:     None,
        Fields.LOOSE_SLIPPERY_ISSUE_TYPE_STR:   None,
        Fields.DELINEATION_STR:                 presence_mapping,
        Fields.DELINEATION_TYPE_STR:            None,
        Fields.LIGHT_SEGREGATION_STR:           presence_mapping,
        Fields.FACILITY_WIDTH_STR:              facility_width_mapping,
        Fields.FLOW_DIR_STR:                    flow_direction_mapping,
        Fields.WIDTH_RESTRICTION_STR:           presence_mapping,
        Fields.ADJ_ROAD_LANE_01M_STR:           presence_mapping,
        Fields.ADJ_VHCL_PARKING_01M_STR:        presence_mapping,
        Fields.ADJ_SVR_PARKING_01M_STR:         presence_mapping,
        Fields.ADJ_OBJ_LVL_CHGE_01M_STR:        presence_mapping,
        Fields.ADJ_SIDEWALK_01M_STR:            presence_mapping,
        Fields.ADJ_ROAD_LANE_13M_STR:           presence_mapping,
        Fields.ADJ_VHCL_PARKING_13M_STR:        presence_mapping,
        Fields.ADJ_SVR_HAZARD_13M_STR:          presence_mapping,
        Fields.ADJ_OBJ_LVL_CHGE_13M_STR:        presence_mapping,
        Fields.ADJ_SIDEWALK_13M_STR:            presence_mapping,
        Fields.GRADE_STR:                       within_5deg_mapping,
        Fields.CURV_STR:                        sharp_turn_mapping,
        Fields.STREET_LIGHT_STR:                presence_mapping,
        Fields.PED_CROSS_STR:                   presence_mapping,
        Fields.INTERSECT_FACILITY_STR:          presence_mapping,
        Fields.INTERSECT_APPRCH_STR:            shared_mapping,
        Fields.INTERSECT_ROAD_CROSS_STR:        presence_mapping,
        Fields.CROSS_FACILITY_STR:              presence_mapping,
        Fields.CROSSING_TYPE_STR:               None,
        Fields.NOL_ADJ_ROAD_STR:                NoL_mapping,
        Fields.NOL_INTERSECT_ROAD_STR:          NoL_mapping,
        Fields.PROP_ACCESS_STR:                 presence_mapping,
        Fields.PEAK_PED_FLOW_STR:               none_low_modhigh_mapping,
        Fields.PEAK_BICYCLE_TRAFFIC_FLOW_STR:   low_modhigh_mapping,
        Fields.OBSERVED_PROPORTION_STR:         low_modhigh_mapping,
        Fields.BICYCLE_SPD_AVG_STR:             less_more_20_mapping,
        Fields.BICYCLE_SPD_DIFF_STR:            less_more_10_mapping,
        Fields.ROAD_AADT_STR:                   None,
        Fields.HEAVY_VHCL_FLOW_STR:             low_modhigh_mapping,
        Fields.SPD_LIMIT_STR:                   road_speed_limit_mapping,
        Fields.ROAD_OPR_SPEED_AVG_STR:          None,
        Fields.SPEED_UNIT_STR:                  operating_speed_unit_mapping,
    }

    def __init__(self, size=0, values=None):
        super().__init__(self.Fields, size, values)

class Results(BaseTable):
    class Fields:
        BB_STR                          = "BB"
        BP_STR                          = "BP"
        SB_STR                          = "SB"
        VB_STR                          = "VB"
        CYCLERAP_SCORE_STR              = "Overall Risk Level"
        BB_BAND_STR                     = "BB Band"
        BP_BAND_STR                     = "BP Band"
        SB_BAND_STR                     = "SB Band"
        VB_BAND_STR                     = "VB Band"
        CYCLERAP_SCORE_BAND_STR         = "Overall Risk Level Band"
        TOP_1_CONTRIBUTOR_STR           = "Top 1 Contributor"
        TOP_1_CONTRIBUTION_STR          = "Top 1 Contribution"
        TOP_2_CONTRIBUTOR_STR           = "Top 2 Contributor"
        TOP_2_CONTRIBUTION_STR          = "Top 2 Contribution"
        TOP_3_CONTRIBUTOR_STR           = "Top 3 Contributor"
        TOP_3_CONTRIBUTION_STR          = "Top 3 Contribution"
        TOP_4_CONTRIBUTOR_STR           = "Top 4 Contributor"
        TOP_4_CONTRIBUTION_STR          = "Top 4 Contribution"
        TOP_5_CONTRIBUTOR_STR           = "Top 5 Contributor"
        TOP_5_CONTRIBUTION_STR          = "Top 5 Contribution"
    
    FIELDS_META = {
        Fields.BB_BAND_STR:             risk_category,
        Fields.BP_BAND_STR:             risk_category,
        Fields.SB_BAND_STR:             risk_category,
        Fields.VB_BAND_STR:             risk_category,
        Fields.CYCLERAP_SCORE_BAND_STR: risk_category,
    }

    def __init__(self, size=0):
        super().__init__(self.Fields, size=size)

class SnapshotMetadata(BaseTable):
    class Fields:
        CODER_NAME_STR      = "Coder Name"
        CODING_DATE_STR     = "Coding Date"
        DESCRIPTION_STR     = "Description"
        STATUS_STR          = "Status"

    def __init__(self, size=0):
        super().__init__(self.Fields, size=size)
        self.df.loc[:, self.Fields.STATUS_STR] = global_var.Map_index.UNEDITED

class Treatment(BaseTable):
    class Fields:
        TREATMENTS_APPLIED_STR  = "Treatments Applied"
        IMAGE_REFERENCE_STR     = "Image Reference"
        TREATMENT_RANK_STR      = "Treatment Rank"
        TREATMENT_ID_STR        = "Treatment ID"
        TREATMENT_NAME_STR      = "Name"
        BB_REMEDIED_STR         = "BB"
        BP_REMEDIED_STR         = "BP"
        SB_REMEDIED_STR         = "SB"
        VB_REMEDIED_STR         = "VB"
        SCORE_REMEDIED_STR      = "Overall Risk Level"

    def __init__(self, size=0):
        super().__init__(self.Fields, size=size)
        
class ProjectGeoData:
    class Fields:
        IMAGE_REFERENCE_STR = "Image Reference"
        ROAD_NAME_STR       = "Road Name"
        DISTANCE_STR        = "Distance (Metres)"
        LINESTRING_STR      = "LineString"

    # === INIT ===

    def __init__(self, size : int = None, file_path : Path = None):
        self.df_dirty = False
        self.loc = LocWrapper(self)

        if file_path is None and size is None:
            return

        if file_path is not None:
            self.df : gpd.GeoDataFrame = None
            self.parse(file_path)
            return

        if size == 0:
            self.df = gpd.GeoDataFrame(columns=[
                self.Fields.IMAGE_REFERENCE_STR,
                self.Fields.ROAD_NAME_STR,
                self.Fields.DISTANCE_STR,
                self.Fields.LINESTRING_STR
            ], geometry=self.Fields.LINESTRING_STR, crs="EPSG:3414")
        else:
            self.df = gpd.GeoDataFrame([{
                self.Fields.IMAGE_REFERENCE_STR:    "",
                self.Fields.ROAD_NAME_STR:          "",
                self.Fields.DISTANCE_STR:           0,
                self.Fields.LINESTRING_STR:         None
            } for _ in range(size)], geometry=self.Fields.LINESTRING_STR, crs="EPSG:3414")

    # === UTILITY ===

    def populate_linestring(self, geometries: gpd.GeoSeries):
        if geometries.crs.to_epsg() != 3414:
            geometries = geometries.to_crs("EPSG:3414")

        self.df[self.Fields.LINESTRING_STR] = geometries["geometry"]
        per_segment_lengths = geometries.length
        self.df[self.Fields.DISTANCE_STR] = per_segment_lengths.cumsum()

    def get_point_start(self, index: int):
        geom = self.df.at[index, self.Fields.LINESTRING_STR]
        return geom.coords[0] if geom and not geom.is_empty else None

    def get_point_end(self, index: int):
        geom = self.df.at[index, self.Fields.LINESTRING_STR]
        return geom.coords[-1] if geom and not geom.is_empty else None

    # === SERIALIZATION ===

    def serialize(self, to_dir : Path):
        to_dir.mkdir(parents=True, exist_ok=True)
        file_path = to_dir / "geo_data.gpkg"
        self.df.to_file(file_path, driver="GPKG", index=False)

    def parse(self, project_path : Path):
        file_path = project_path / "geo_data.gpkg"
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        self.df = gpd.read_file(file_path)
        if self.df.crs.to_epsg() != 3414:
            raise Exception("Unexpected CRS: ", self.df.crs)

class ProjectMetadata:
    # === INIT ===

    def __init__(self):
        self.project_name : str             = None
        self.date_created : datetime        = None
        self.last_updated : datetime        = None
        self.created_by   : str             = None
        self.dataset      : str             = None
        self.source_folders : list[str]     = None
        self.progress     : int             = None
        self.size         : int             = None
        self.tags         : list[str]       = None
        self.path_key     : str             = None
        self.verified     : bool            = False
        self.verified_segment_count : int   = 0
        self.autocoded_segment_count : int  = 0

    # === SERIALIZATION ===

    def parse(self, file_path: Path):
        with open(file_path, 'r') as f:
            data = json.load(f)
            self.project_name = data.get("project_name")
            
            # Helper to safely parse datetime or date
            def parse_datetime(s):
                if not s: return None
                try:
                    return datetime.fromisoformat(s)
                except ValueError:
                    # Fallback for old date-only strings or other formats if needed
                    return None

            self.date_created = parse_datetime(data.get("date_created"))
            self.last_updated = parse_datetime(data.get("last_updated"))
            self.created_by = data.get("created_by")
            self.dataset    = data.get("dataset")
            self.source_folders = data.get("source_folders") or []
            self.progress   = data.get("progress")
            self.size       = data.get("size")
            self.tags       = data.get("tags")
            self.path_key   = data.get("path_key")
            self.verified   = data.get("verified", False)
            self.verified_segment_count = data.get("verified_segment_count", 0)
            self.autocoded_segment_count = data.get("autocoded_segment_count", 0)

    def to_dict(self):
        return {
            "project_name": self.project_name,
            "date_created": self.date_created.isoformat() if self.date_created else None,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
            "created_by": self.created_by,
            "dataset": self.dataset,
            "source_folders": self.source_folders or [],
            "progress": self.progress,
            "size": self.size,
            "tags": self.tags,
            "path_key": self.path_key,
            "verified": self.verified,
            "verified_segment_count": self.verified_segment_count,
            "autocoded_segment_count": self.autocoded_segment_count
        }

    def serialize(self, to_dir: Path):
        to_dir.mkdir(parents=True, exist_ok=True)
        file_path = to_dir / "project_metadata.json"
        with open(file_path, 'w') as f:
            json.dump(self.to_dict(), f, indent=4)
            

# LTA DataMall traffic-flow/speed-bands loader. Unused: getTrafficFlow_df() and
# getTrafficSpeedBands_df() have no callers anywhere in the backend -- GIS-derived
# attributes (road speed, heavy vehicle flow, etc.) are read from the static shapefiles
# in backend/shapefiles/ instead (see docs/developer/gis/README.md). config.json's
# Datamall_API_key/TrafficFlow_Url/TrafficSpeedBands_URL fields are not needed to run
# the app -- initialise() is only called defensively (wrapped in try/except) and quietly
# no-ops when they're absent.
class data_loader:
    TrafficFlow_Url = None
    TrafficSpeedBands_URL = None
    key = None
    TrafficFlow_df: pd.DataFrame | None = None
    TrafficSpeedBands_df: pd.DataFrame | None = None
    cache_dir = "src/api_data"
    
    class Fields:
        TrafficFlow_Url = 0
        TrafficSpeedBands_URL = 1
    
    @classmethod
    def initialise(cls):
        with open("config.json", 'r') as json_file:
            data = json.load(json_file)
            cls.TrafficFlow_Url = data.get("TrafficFlow_Url")
            cls.TrafficSpeedBands_URL = data.get("TrafficSpeedBands_URL")
            cls.key = data.get("Datamall_API_key")
    
    @classmethod
    def clean_old_cache(cls, keyword):
        today = datetime.today().strftime('%Y-%m-%d')
        for filename in os.listdir(cls.cache_dir):
            if keyword in filename and not filename.startswith(today):
                os.remove(os.path.join(cls.cache_dir, filename))

    @classmethod
    def getTrafficFlow_df(cls) -> pd.DataFrame | dict:
        today = datetime.today().strftime('%Y-%m-%d')
        cache_path = os.path.join(cls.cache_dir, f"{today}_TrafficFlow.json")

        if os.path.exists(cache_path):
            with open(cache_path, 'r') as f:
                cls.TrafficFlow_df = json.load(f)
        else:
            cls.clean_old_cache("TrafficFlow")
            df = cls.APIcall(cls.TrafficFlow_Url)
            url = df["Link"].values[0]
            response = requests.get(url)
            response.raise_for_status()
            cls.TrafficFlow_df = response.json()

            with open(cache_path, 'w') as f:
                json.dump(cls.TrafficFlow_df, f)

        return cls.TrafficFlow_df
    
    @classmethod
    def getTrafficSpeedBands_df(cls) -> pd.DataFrame | dict:
        today = datetime.today().strftime('%Y-%m-%d')
        cache_path = os.path.join(cls.cache_dir, f"{today}_TrafficSpeedBands.json")
        
        if os.path.exists(cache_path):
            print("--------------------------------------------------------")
            print("NEW DATA")
            with open(cache_path, 'r') as f:
                data = json.load(f)
                cls.TrafficSpeedBands_df = pd.json_normalize(data)
        else:
            print("--------------------------------------------------------")
            print("CLEAR OLD DATA")
            cls.clean_old_cache("TrafficSpeedBands")
            cls.TrafficSpeedBands_df = cls.APIcall(cls.TrafficSpeedBands_URL)
            with open(cache_path, 'w') as f:
                json.dump(cls.TrafficSpeedBands_df.to_dict(orient="records"), f)

        return cls.TrafficSpeedBands_df
    
    @classmethod
    def APIcall(cls, url) -> pd.DataFrame: 
        headers = {
            "AccountKey": cls.key,
            "accept": "application/json",
        }
        resp = requests.get(url, headers=headers)
        resp.raise_for_status()
        payload = resp.json()
        records = payload.get("value", payload)
        return pd.json_normalize(records)
