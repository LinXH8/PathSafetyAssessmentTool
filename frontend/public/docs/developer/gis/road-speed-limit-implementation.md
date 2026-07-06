# Road Speed Limit Autocoding Implementation

## Overview

This document describes the implementation of the **Road Speed Limit** attribute autocoding feature for the Path Safety Assessment Tool. This feature automatically determines the posted speed limit on the road adjacent to a cycling facility based on spatial proximity to speed limit road segments.

## Implementation Date

November 5, 2025

## Attribute Details

### Attribute Name
**Road Speed Limit**

### Description
A numeric attribute that represents the posted speed limit on the road adjacent to the cycling facility.

### Default Value
10 km/h (when no speed limit segment is found within search distance)

## Data Source

### Shapefile
- **File Path**: `backend/shapefiles/Speed_limit/ROADATTRIBUTELINE_SPEEDLIMITS.shp`
- **Contents**: Road segments with speed limit information
- **Key Field**: `SPEEDLIMIT` - contains the numeric speed limit value
- **Coordinate Reference System**: Converted to EPSG:3414 (SVY21) for spatial operations

### Shapefile Verification
The shapefile exists and contains:
- Road attribute line segments with speed limit data
- SPEEDLIMIT field with numeric values representing km/h
- Valid geometries in a supported CRS

## Spatial Matching Algorithm

### Step-by-Step Process

1. **Point Extraction**: Extract the first coordinate from the location's LineString geometry
2. **Buffer Creation**: Create a 20-meter buffer around this point for initial spatial search
3. **Spatial Query**: Use a spatial index (R-tree) to query candidate speed limit segments within the buffer area
4. **Distance Calculation**: Calculate the exact distance from the point to each candidate road segment
5. **Nearest Segment**: Identify the nearest speed limit segment by finding the one with minimum distance
6. **Distance Check**: If the nearest segment is within MAX_DISTANCE (30 meters), extract its SPEEDLIMIT value
7. **Assignment**: Assign this speed limit value to the attribute; otherwise use default value (10 km/h)

### Configuration Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `buffer_dist` | 20.0 meters | Buffer distance for initial spatial query using R-tree index |
| `max_dist` | 30.0 meters | Maximum search distance for valid speed limit segments |
| `default_limit` | 10 km/h | Default value when no segment found within max_dist |

## Implementation Files

### 1. Core GIS Logic: `gis_mapping.py`

**File**: [`backend/app/services/gis_mapping.py`](backend/app/services/gis_mapping.py)

#### Changes Made:

**A. LayerStore Registration (Lines 109-110)**
```python
# Added for Road Speed Limit
store.add_path("speed_limit", base / "Speed_limit" / "ROADATTRIBUTELINE_SPEEDLIMITS.shp")
```

**B. GIS Method Implementation (Lines 383-463)**
```python
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
    """
```

**Key Implementation Details**:
- Uses lazy loading via `LayerStore.get("speed_limit")`
- Converts point to metric CRS (EPSG:3414) for accurate distance calculations
- Uses spatial indexing (R-tree) for efficient candidate search: O(log n) complexity
- Filters candidates to only those within 30m maximum distance
- Handles null/NaN values gracefully
- Returns default value (10 km/h) when no match is found

### 2. API Integration: `routes.py`

**File**: [`backend/app/api/projects/routes.py`](backend/app/api/projects/routes.py)

#### Changes Made (Lines 635-638):

```python
# Added for Road Speed Limit
# Calculate road speed limit based on nearest speed limit segment
speed_limit = _gis.get_road_speed_limit(pt, buffer_dist=20, max_dist=30, default_limit=10)
updates["Road speed limit"] = speed_limit
```

**Integration Point**: `/api/projects/<project_name>/autocode/gis` endpoint

The Road Speed Limit is now automatically calculated and returned as part of the GIS autocoding response, along with other attributes like:
- Road operating speed (mean)
- Peak pedestrian flow
- Area type
- etc.

## Error Handling

The implementation includes comprehensive error handling:

1. **Missing Shapefile**: Returns default value (10) if shapefile is not found or not registered
2. **Empty Shapefile**: Returns default value if shapefile has no data
3. **Invalid Geometries**: Filters out null or invalid geometries before processing
4. **No Candidates Found**: Returns default value if no segments found in buffer
5. **No Segments Within Distance**: Returns default value if all candidates are beyond 30m
6. **Missing SPEEDLIMIT Field**: Logs warning and returns default value
7. **Null SPEEDLIMIT Values**: Returns default value if the field value is null/NaN

All errors are logged for debugging while ensuring the system continues to function.

## Testing

### Test Script
A comprehensive test script has been created: [`backend/test_road_speed_limit.py`](backend/test_road_speed_limit.py)

### Test Coverage

The test script validates:
1. ✓ GIS system initialization with speed limit shapefile
2. ✓ Speed limit shapefile loading and structure verification
3. ✓ SPEEDLIMIT column presence and data validity
4. ✓ Spatial query with multiple test coordinates across Singapore
5. ✓ Detailed spatial analysis showing nearest segments and distances

### Sample Test Locations

| Location | Coordinates (WGS84) | Purpose |
|----------|---------------------|---------|
| Orchard Road area | (103.8198, 1.3521) | Central business district |
| Marina Bay area | (103.8500, 1.2900) | Downtown core |
| Bukit Timah area | (103.7800, 1.3800) | Residential area |
| Shenton Way area | (103.8494, 1.2896) | Business district |
| Changi area | (103.9500, 1.3500) | Eastern region |

### Running Tests

To run the test script:

```bash
cd /Users/xh/IWSP Documents/cyclerap/PathSafetyAssessmentTool/backend
python3 test_road_speed_limit.py
```

**Prerequisites**:
- Python 3.9+
- Required packages from `requirements.txt` installed
- Shapefile data in correct location

## API Usage

### Request Format

**Endpoint**: `POST /api/projects/<project_name>/autocode/gis`

**Request Body**:
```json
{
  "coords": [[103.8198, 1.3521], [103.8200, 1.3525], ...]
}
```

The `coords` array represents a LineString geometry. The **first coordinate** is used as the reference point for spatial matching.

### Response Format

```json
{
  "updates": {
    "Road speed limit": 50,
    "Road operating speed (mean)": 45.2,
    "Area type": 1,
    "Road AADT": 5000,
    ...
  },
  "changed_fields": [
    "Road speed limit",
    "Road operating speed (mean)",
    "Area type",
    "Road AADT",
    ...
  ]
}
```

### Example Response Values

| Speed Limit Value | Interpretation |
|-------------------|---------------|
| 10 | Default value (no segment found or error) |
| 30 | 30 km/h speed limit zone |
| 40 | 40 km/h speed limit zone |
| 50 | 50 km/h speed limit zone |
| 60 | 60 km/h speed limit zone |
| 70 | 70 km/h speed limit zone |
| 80+ | High-speed roads/expressways |

## Performance Optimization

### Spatial Indexing
- Uses R-tree spatial index via `gdf.sindex.intersection()` for O(log n) candidate search
- Dramatically faster than brute-force distance calculation for all segments

### Lazy Loading
- Shapefile is loaded only when first accessed via `LayerStore.get()`
- Subsequent accesses use cached GeoDataFrame

### CRS Conversion
- Conversion to metric CRS (EPSG:3414) done once during shapefile loading
- All subsequent operations use the cached metric CRS data

### Streamlit Caching
- Optional support for Streamlit's `@st.cache_resource` decorator
- Automatically detected and used when running in Streamlit environment
- Falls back to standard loading in non-Streamlit environments

## Comparison with Road Operating Speed

Both features follow similar spatial matching patterns but use different data sources:

| Aspect | Road Speed Limit | Road Operating Speed (mean) |
|--------|-----------------|---------------------------|
| **Data Source** | Shapefile (ROADATTRIBUTELINE_SPEEDLIMITS.shp) | Shapefile + CSV (road links + speed data) |
| **Key Field** | SPEEDLIMIT | LK_ID_NUM → AVERAGE_HOURLY_SPEED |
| **Default Value** | 10 km/h | 30 km/h |
| **Search Distance** | 30m | 30m |
| **Buffer Distance** | 20m | 20m |
| **Data Type** | Posted speed limit | Observed average speed |
| **Complexity** | Single shapefile lookup | Two-step: shapefile → CSV lookup |

## Code Architecture

### Class Hierarchy

```
LayerStore (gis_mapping.py)
├── Manages shapefile paths and loading
├── Lazy loads shapefiles on first access
├── Converts all data to metric CRS (EPSG:3414)
└── Provides to_metric_point() for coordinate conversion

GIS (gis_mapping.py)
├── Uses LayerStore for data access
├── Implements spatial matching algorithms
├── get_road_speed_limit() - NEW METHOD
├── get_road_operating_speed()
├── is_mrt(), is_bus_lane(), etc.
└── get_area_type(), get_peak_pedestrian_flow(), etc.
```

### Method Signature

```python
def get_road_speed_limit(
    self,
    point,              # Shapely Point or (lon, lat) tuple
    buffer_dist=20,     # Initial search buffer (meters)
    max_dist=30,        # Maximum valid distance (meters)
    default_limit=10    # Default value if not found (km/h)
) -> float:
    """Returns speed limit in km/h"""
```

## Future Enhancements

### Potential Improvements

1. **Multi-Segment Averaging**: Instead of just using the nearest segment, average speed limits from multiple nearby segments
2. **Time-Based Speed Limits**: Support for time-varying speed limits (e.g., school zones)
3. **Confidence Scoring**: Return confidence scores based on distance to nearest segment
4. **Historical Data**: Track speed limit changes over time
5. **Validation**: Cross-reference with Road Operating Speed to detect inconsistencies
6. **Caching**: Cache recent lookups to improve performance for nearby points

### Configuration Options

Consider making these configurable via API parameters:
- `buffer_dist` (currently hardcoded to 20m)
- `max_dist` (currently hardcoded to 30m)
- `default_limit` (currently hardcoded to 10 km/h)

## Troubleshooting

### Common Issues

**Issue**: All values return default (10)
- **Cause**: Shapefile not found or not loaded
- **Solution**: Verify shapefile exists at `backend/shapefiles/Speed_limit/ROADATTRIBUTELINE_SPEEDLIMITS.shp`

**Issue**: Warning: "SPEEDLIMIT field not found"
- **Cause**: Shapefile schema mismatch
- **Solution**: Verify shapefile has `SPEEDLIMIT` column using QGIS or geopandas

**Issue**: Incorrect speed limits returned
- **Cause**: CRS mismatch or distance calculation error
- **Solution**: Verify shapefile CRS is correctly detected and converted to EPSG:3414

**Issue**: Slow performance
- **Cause**: Spatial index not being used
- **Solution**: Verify `rtree` package is installed for efficient spatial indexing

### Debug Mode

To enable detailed logging, look for print statements in the code:
- "Warning: speed_limit shapefile not registered"
- "Warning: SPEEDLIMIT field not found in speed limit shapefile"
- "Warning: Could not load speed CSV" (different feature, for reference)

## Dependencies

Required Python packages (from `requirements.txt`):
- `geopandas >= 0.14`
- `shapely >= 2.0`
- `pandas >= 2.0`
- `numpy >= 1.24`
- `rtree >= 1.2` (optional but strongly recommended for spatial indexing)
- `pyproj >= 3.5`
- `fiona >= 1.9`

## Coordinate Reference Systems

### Input CRS (Auto-detected)
- **WGS84 (EPSG:4326)**: Latitude/Longitude coordinates
- Auto-detection heuristic: If coordinates are within (-180, 180) for X and (-90, 90) for Y

### Working CRS (Internal)
- **SVY21 (EPSG:3414)**: Singapore Transverse Mercator
- Metric coordinates for accurate distance calculations
- All shapefiles converted to this CRS upon loading

## Summary

The Road Speed Limit autocoding feature has been successfully implemented following the same proven pattern as Road Operating Speed. The implementation:

✓ Registers the speed limit shapefile in the LayerStore
✓ Implements efficient spatial matching using R-tree indexing
✓ Integrates seamlessly with the existing GIS autocoding endpoint
✓ Includes comprehensive error handling
✓ Provides test coverage with sample coordinates
✓ Follows established code architecture and patterns
✓ Uses appropriate default values when no match is found
✓ Is fully documented for future maintenance

The feature is production-ready and will automatically calculate speed limits for any coordinates passed to the `/api/projects/<project_name>/autocode/gis` endpoint.
