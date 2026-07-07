from enum import IntEnum, Enum
from collections import defaultdict
from app.services.cycleRAP_VA import get_full_path
from pathlib import Path

CYCLERAPVER = "CycleRAP_v2.11.xlsm" # NOTE: Deprecated, use the one in cycleRAP_interface.py instead
PROJECT_IMAGES_FOLDER = "images"
PROJECT_IMAGE_DATA_CSV = "geo_location_points.csv"
PROJECT_CYCLERAP_DIRECTORY = "cyclerap_data"
PROJECT_METADATA = "metadata.csv"

class Map_index(IntEnum):
    def class_name(): return "Map_index"
    UNEDITED = 0
    EDITED = 1

map_index_color_mapping = {
    0: [173, 166, 166],     # INCOMPLETE: #ADA6A6 - Grey
    1: [0, 255, 255],       # CURRENT:    #00FFFF - Cyan
    2: [110, 110, 110] 
}

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

# == Start of CycleRAP dataframe strings ==
class Dataframe_attributes(IntEnum):
    def class_name(): return "Dataframe_attributes"
    CODER_NAME                                          = 0
    CODING_DATE                                         = 1
    IMAGE_CAPTURE_DATE                                  = 2
    IMAGE_REFERENCE                                     = 3
    CODING_DATE_REPEATED                                = 4
    DISTANCE                                            = 5
    LENGTH                                              = 6
    GPS_COORDINATES_LAT_START                           = 7
    GPS_COORDINATES_LON_START                           = 8
    GPS_COORDINATES_LAT_END                             = 9
    GPS_COORDINATES_LON_END                             = 10
    COMMENTS                                            = 11
    AREA_TYPE                                           = 12
    FACILITY_TYPE                                       = 13
    FACILITY_ACCESS                                     = 14
    LOOSE_OR_SLIPPERY_SURFACE                           = 15
    TRAM_OR_TRAIN_RAILS                                 = 16
    MAJOR_SURFACE_DEFORMANTION_OR_DRAIN_OPENING         = 17
    FIXED_OBSTACLE_ON_FACILITY                          = 18
    NON_FIXED_OBSTACLE_ON_FACILITY                      = 19
    DELINEATION                                         = 20
    LIGHT_SEGREGATION                                   = 21
    FACILITY_WIDTH_PER_DIRECTION                        = 22
    FLOW_DIRECTION                                      = 23
    WIDTH_RESTRICTION                                   = 24
    ADJACENT_ROAD_LANE_0_1_M                            = 25
    ADJACENT_VEHICLE_PARKING_0_1_M                      = 26
    ADJACENT_SEVERE_HAZARD_0_1_M                        = 27
    ADJACENT_OBJECT_OR_LEVEL_CHANGE_0_1_M               = 28
    ADJACENT_SIDEWALK_0_1_M                             = 29
    ADJACENT_ROAD_LANE_1_3_M                            = 30
    ADJACENT_VEHICLE_PARKING_1_3_M                      = 31
    ADJACENT_SEVERE_HAZARD_1_3_M                        = 32
    ADJACENT_OBJECT_OR_LEVEL_CHANGE_1_3_M               = 33
    ADJACENT_SIDEWALK_1_3_M                             = 34
    GRADE                                               = 35
    CURVATURE                                           = 36
    STREET_LIGHTING                                     = 37
    PEDESTRIAN_CROSSING                                 = 38
    INTERSECTING_BICYCLE_FACILITY                       = 39
    INTERSECTION_APPROACH                               = 40
    INTERSECTION_OR_ROAD_CROSSING                       = 41
    CROSSING_FACILITY                                   = 42
    NUMBER_OF_LANES_ADJACENT_ROAD                       = 43
    NUMBER_OF_LANES_INTERSECTING_ROAD                   = 44
    PROPERTY_ACCESS                                     = 45
    PEAK_PEDESTRIAN_ALONG_OR_ACROSS_FACILITY            = 46
    PEAK_BICYCLE_OR_LV_TRAFFIC_FLOW                     = 47
    OBSERVED_PROPORTION_OF_CARGO_BIKES_AND_MOPEDS       = 48
    BICYCLE_OR_LV_SPEED_AVERAGE                         = 49
    BICYCLE_OR_LV_SPEED_DIFFERENTIAL                    = 50
    ROAD_AADT                                           = 51
    HEAVY_VEHICLE_FLOW                                  = 52
    ROAD_SPEED_LIMIT                                    = 53
    ROAD_OPERATING_SPEED_MEAN                           = 54
    ROAD_OPERATING_SPEED_UNIT                           = 55

    INTENTIONAL_GAP                                     = 56 # NOTE: This is following the CycleRAP excel sheet

    SMOOTHED_SECTION_ID                                 = 57
    BB_SCORE                                            = 58
    BB_SMOOTHED_SCORE                                   = 59
    BP_SCORE                                            = 60
    BP_SMOOTHED_SCORE                                   = 61
    SB_SCORE                                            = 62
    SB_SMOOTHED_SCORE                                   = 63
    VB_SCORE                                            = 64
    VB_SMOOTHED_SCORE                                   = 65
    CYCLERAP_SCORE                                      = 66
    CYCLERAP_SCORE_SMOOTHED                             = 67
    BB_BAND                                             = 68
    BP_BAND                                             = 69
    SB_BAND                                             = 70
    VB_BAND                                             = 71
    CYCLERAP_SCORE_BAND                                 = 72
    BB_BAND_SMOOTHED                                    = 73
    BP_BAND_SMOOTHED                                    = 74
    SB_BAND_SMOOTHED                                    = 75
    VB_BAND_SMOOTHED                                    = 76

# == START OF ATTRIBUTE NAMING ==
# CycleRAP Meta-data
RISK_CAT_STR                    = "Risk Category"
CODER_NAME_STR                  = "Coder name"
CODING_DATE_STR                 = "Coding date"
IMG_CAPTURE_DATE_STR            = "Image capture date"
IMAGE_NAME_STR                  = "Image reference"
CODING_DATE_REPEAT_STR          = "Coding date 2"
DISTANCE_STR                    = "Distance"
LENGTH_STR                      = "Length"
START_PT_LAT_STR                = "GPS coordinates – latitude start"
START_PT_LON_STR                = "GPS coordinates – longitude start"
END_PT_LAT_STR                  = "GPS coordinates – latitude end"
END_PT_LON_STR                  = "GPS coordinates – longitude end"
COMMENT_STR                     = "Comments"
# Coding Attributes
AREA_TYPE_STR                   = "Area type"
FACILITY_TYPE_STR               = "Facility Type"
FACILITY_ACCESS_STR             = "Facility access"
LINE_OF_SIGHT_STR               = "Line of Sight"
LOOSE_SLIPPERY_SURFACE_STR      = "Loose or slippery surface"
TRAM_TRAIN_RAIL_STR             = "Tram or Train Rails"
DEFORMATION_DRAIN_STR           = "Major Surface Deformation or Drain Opening"
FIXED_OBSTACLE_STR              = "Fixed Obstacle on Facility"
NON_FIXED_OBSTACLE_STR          = "Non-Fixed Obstacle on Facility"
DELINEATION_STR                 = "Delineation"
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
SPEED_UNIT_STR                  = "blank"
# Results
SMOOTHED_SECTION_ID_STR         = "Smoothed Section ID"
BB_STR                          = "BB"
SBB_STR                         = "BB Smoothed"
BP_STR                          = "BP"
SBP_STR                         = "BP Smoothed"
SB_STR                          = "SB"
SSB_STR                         = "SB Smoothed"
VB_STR                          = "VB"
SVB_STR                         = "VBSmoothed"
CYCLERAP_SCORE_STR              = "Overall Risk Level"
CYCLERAP_SCORE_SMOOTHED_STR     = "Overall Risk Level Smoothed"
BB_BAND_STR                     = "BB Band"
BP_BAND_STR                     = "BP Band"
SB_BAND_STR                     = "SB Band"
VB_BAND_STR                     = "VB Band"
CYCLERAP_SCORE_BAND_STR         = "Overall Risk Level Band"
# == END ==

# TODO: Can be serialized and set to be editable by user
dataframe_default_values = {
    # CycleRAP Meta-data
    CODER_NAME_STR:                 None,
    CODING_DATE_STR:                None,
    IMG_CAPTURE_DATE_STR:           None,
    IMAGE_NAME_STR:                 None,
    CODING_DATE_REPEAT_STR:         None,
    DISTANCE_STR:                   None,
    LENGTH_STR:                     None,
    START_PT_LAT_STR:               None,
    START_PT_LON_STR:               None,
    END_PT_LAT_STR:                 None,
    END_PT_LON_STR:                 None,
    COMMENT_STR:                    "",
    # Coding Attributes
    AREA_TYPE_STR:                  2,
    FACILITY_TYPE_STR:              1,
    FACILITY_ACCESS_STR:            1,
    LINE_OF_SIGHT_STR:              1,
    LOOSE_SLIPPERY_SURFACE_STR:     2,
    TRAM_TRAIN_RAIL_STR:            2,
    DEFORMATION_DRAIN_STR:          2,
    FIXED_OBSTACLE_STR:             2,
    NON_FIXED_OBSTACLE_STR:         2,
    DELINEATION_STR:                1,
    LIGHT_SEGREGATION_STR:          1,
    FACILITY_WIDTH_STR:             2,
    FLOW_DIR_STR:                   2,
    WIDTH_RESTRICTION_STR:          2,
    ADJ_ROAD_LANE_01M_STR:          2,
    ADJ_VHCL_PARKING_01M_STR:       2,
    ADJ_SVR_PARKING_01M_STR:        2,
    ADJ_OBJ_LVL_CHGE_01M_STR:       2,
    ADJ_SIDEWALK_01M_STR:           2,
    ADJ_ROAD_LANE_13M_STR:          2,
    ADJ_VHCL_PARKING_13M_STR:       2,
    ADJ_SVR_HAZARD_13M_STR:         2,
    ADJ_OBJ_LVL_CHGE_13M_STR:       2,
    ADJ_SIDEWALK_13M_STR:           2,
    GRADE_STR:                      1,
    CURV_STR:                       2,
    STREET_LIGHT_STR:               1,
    PED_CROSS_STR:                  2,
    INTERSECT_FACILITY_STR:         2,
    INTERSECT_APPRCH_STR:           2,
    INTERSECT_ROAD_CROSS_STR:       2,
    CROSS_FACILITY_STR:             2,
    NOL_ADJ_ROAD_STR:               2,
    NOL_INTERSECT_ROAD_STR:         1,
    PROP_ACCESS_STR:                2,
    PEAK_PED_FLOW_STR:              1,
    PEAK_BICYCLE_TRAFFIC_FLOW_STR:  1,
    OBSERVED_PROPORTION_STR:        1,
    BICYCLE_SPD_AVG_STR:            1,
    BICYCLE_SPD_DIFF_STR:           1,
    ROAD_AADT_STR:                  6000,
    HEAVY_VHCL_FLOW_STR:            1,
    SPD_LIMIT_STR:                  10,
    ROAD_OPR_SPEED_AVG_STR:         30,
    SPEED_UNIT_STR:                 1
}

dataframe_results_default_values = {
    # Results
    SMOOTHED_SECTION_ID_STR:        0,
    BB_STR:                         0,
    SBB_STR:                        0,
    BP_STR:                         0,
    SBP_STR:                        0,
    SB_STR:                         0,
    SSB_STR:                        0,
    VB_STR:                         0,
    SVB_STR:                        0,
    CYCLERAP_SCORE_STR:             0,
    CYCLERAP_SCORE_SMOOTHED_STR:    0,
    BB_BAND_STR:                    "",
    BP_BAND_STR:                    "",
    SB_BAND_STR:                    "",
    VB_BAND_STR:                    "",
    CYCLERAP_SCORE_BAND_STR:        ""
}

risk_mapping = defaultdict(int)  # Default is 0
risk_mapping.update({
    'Low':      1,
    'Medium':   2,
    'High':     3,
    'Extreme':  4
})

risk_color_mapping = {   # Color coded according to CycleRAP user guide
    0: [173, 166, 166],  # Default
    1: [135, 196, 36],   # Low:     #87C424
    2: [255, 204, 26],   # Medium:  #FFCC1A
    3: [255, 91, 26],    # High:    #FF5B1A
    4: [205, 26, 255]    # Extreme: #CD1AFF Magenta!!
}

def get_config_path():
    return Path(get_full_path("config.json"))