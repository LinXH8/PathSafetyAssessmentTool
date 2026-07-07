# Road Operating Speed (mean) - Implementation Documentation

## Overview

This document describes the implementation of the "Road Operating Speed (mean)" attribute in the PathSafetyAssessmentTool autocoding system. This attribute represents the average hourly speed of vehicles on the road adjacent to the cycling facility, with a default value of 30 km/h.

## Implementation Date

**Added:** November 5, 2025

## Files Modified

### 1. `app/services/gis_mapping.py`

#### Changes Made:

**LayerStore Class:**
- Added `speed_data` attribute to cache the speed CSV data
- Added `set_speed_csv()` method to load and index the speed CSV by LINKID
- Modified `default()` class method to register the road links shapefile and speed CSV

**GIS Class:**
- Added `get_road_operating_speed()` method to calculate road operating speed for a given point

#### Key Methods:

```python
def set_speed_csv(self, csv_path: str | Path):
    """Load and cache the speed CSV data for Road Operating Speed (mean)"""
```
- Reads the CSV file with headers
- Converts LINKID to string type for matching
- Indexes the DataFrame by LINKID for O(1) lookup performance

```python
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
    """
```

### 2. `app/api/projects/routes.py`

#### Changes Made:

**autocode_gis() endpoint:**
- Added call to `get_road_operating_speed()` method
- Result is stored in the `updates` dictionary with key "Road operating speed (mean)"

#### Code Addition:

```python
# Added for Road Operating Speed (mean)
# Calculate road operating speed based on nearest road link
road_speed = _gis.get_road_operating_speed(pt, buffer_dist=20, max_dist=30, default_speed=30.0)
updates["Road operating speed (mean)"] = road_speed
```

## Data Sources

### 1. Road Network Shapefile

**File:** `/backend/shapefiles/LinkID_Shape_File/31Oct24_Link_FUL.shp`

**Key Fields:**
- `LK_ID_NUM` - Link ID Number (used for matching with speed data)
- `geometry` - Road link geometries (LineStrings)

**CRS:** Converted to EPSG:3414 (SVY21) for distance calculations

**Details:**
- Contains 188,987 road links (as of the shapefile date)
- Covers the entire Singapore road network

### 2. Speed Data CSV

**File:** `/backend/shapefiles/LinkID_Shape_File/TSE_AdHocReq_ERP2AverageSpeedData_250425.csv`

**Structure:**
```csv
LINKID,CALCULATION_DATE,HOURLY_TIMESLOT,AVERAGE_HOURLY_SPEED
103814,15/01/2025,10:00-11:00,0.1
191673,15/01/2025,10:00-11:00,0.1
...
```

**Key Columns:**
- `LINKID` - Link ID (matches LK_ID_NUM from shapefile)
- `AVERAGE_HOURLY_SPEED` - Average speed in km/h for the time slot
- `CALCULATION_DATE` - Date of calculation
- `HOURLY_TIMESLOT` - Time slot for the speed measurement

**Note:** CSV contains multiple records per Link ID (one per time slot). The current implementation retrieves the first matching record. Future enhancement could aggregate across all time slots.

## Algorithm

The implementation follows this spatial matching logic:

1. **Point Conversion:** Convert the input point from WGS84 (lon, lat) to EPSG:3414 (metric CRS)

2. **Buffer Creation:** Create a 20-meter buffer around the point for efficient spatial querying

3. **Spatial Query:** Use the shapefile's spatial index (R-tree) to find candidate road links that intersect the buffer

4. **Distance Filtering:** Calculate exact distances and filter to only roads within 30 meters

5. **Nearest Road Selection:** Find the road link with the minimum distance to the point

6. **Link ID Extraction:** Extract the `LK_ID_NUM` field from the nearest road

7. **Speed Lookup:** Look up the Link ID in the indexed speed CSV

8. **Result:** Return the `AVERAGE_HOURLY_SPEED` if found, otherwise return 30 km/h (default)

## Performance Considerations

- **Spatial Indexing:** Uses GeoPandas spatial index (R-tree) for O(log n) candidate search
- **CSV Indexing:** Speed CSV is indexed by LINKID for O(1) lookup
- **Lazy Loading:** Shapefiles are loaded on first use and cached
- **CRS Caching:** CRS conversion is done once during shapefile loading

## Error Handling

The implementation handles several error cases:

1. **Missing Shapefile:** Returns default value (30 km/h)
2. **Missing CSV:** Returns default value and logs warning
3. **No Road Links in Buffer:** Returns default value
4. **No Roads Within Max Distance:** Returns default value
5. **Link ID Not in CSV:** Returns default value
6. **Invalid Geometry:** Returns default value

All error cases gracefully fall back to the default value without crashing the application.

## Testing

### Manual Testing

Two test scripts are provided:

1. **`test_road_speed_simple.py`** - Standalone test that directly tests the spatial matching logic
2. **`test_road_speed.py`** - Integration test using the full GIS module

### Test Points

The test scripts include three sample locations in Singapore:
- Orchard Road area (103.8198, 1.3521)
- Marina Bay area (103.8500, 1.2900)
- Bukit Timah area (103.7800, 1.3800)

### Running Tests

```bash
cd backend
python3 test_road_speed_simple.py
```

**Requirements:** geopandas, pandas, shapely, numpy must be installed

## Integration with Autocoding

The Road Operating Speed attribute is automatically populated when:

1. **Single Image Autocoding:** User clicks "Auto-code" button on a single image
   - Calls `/api/projects/<project>/autocode/all` endpoint
   - GIS rules are applied including road speed lookup
   - Result is displayed in the attributes table

2. **Bulk Autocoding:** User clicks "Auto-code all" button
   - Processes all images in the project
   - Each image's location is used to find the nearest road link
   - Speed values are populated for all rows

3. **GIS-Only Autocoding:** Called internally by `autocode_all` endpoint
   - Separates CV (computer vision) and GIS-based attributes
   - Road speed is tagged as "GIS" source in the UI

## UI Display

In the frontend attributes table:
- **Field Name:** "Road operating speed (mean)"
- **Type:** Numeric (float)
- **Unit:** km/h (specified in separate "Road operating speed (unit)" field)
- **Default:** 30
- **Source Badge:** "GIS" (indicates value came from GIS autocoding)
- **Highlighting:** Field is highlighted if changed by autocoding

## Future Enhancements

Potential improvements to consider:

1. **Time-Based Speed Selection:**
   - Currently uses first matching record
   - Could select speed based on time of day from image EXIF data
   - Could calculate average across all time slots per Link ID

2. **Speed Aggregation:**
   - Average speeds across multiple nearby road links
   - Weight by distance from point

3. **Directional Speed:**
   - CSV contains direction-specific data
   - Could match direction of travel from LineString bearing

4. **Caching:**
   - Cache calculated speeds to avoid repeated lookups
   - Invalidate cache when CSV is updated

5. **CSV Updates:**
   - Add mechanism to reload CSV when new data is available
   - Version tracking for speed data

## Debugging

To debug speed calculation issues:

1. **Check Shapefile Loading:**
```python
layer_store = gis.LayerStore.default(base_dir="shapefiles")
road_gdf = layer_store.get("road_links")
print(f"Loaded {len(road_gdf)} road links")
```

2. **Check CSV Loading:**
```python
print(f"Speed data loaded: {layer_store.speed_data is not None}")
print(f"Number of Link IDs: {len(layer_store.speed_data)}")
```

3. **Check Point Coordinates:**
```python
pt = gis.GIS(layer_store).store.to_metric_point((lon, lat))
print(f"Point in metric CRS: ({pt.x}, {pt.y})")
```

4. **Enable Debug Logging:**
The implementation includes print statements for warnings. These can be captured in logs:
```python
import logging
logging.basicConfig(level=logging.INFO)
```

## Code Comments

All code additions are marked with:
```python
# Added for Road Operating Speed (mean)
```

This allows easy identification of changes related to this feature.

## References

- **Specification:** User requirements document (provided in task description)
- **GeoPandas Spatial Indexing:** https://geopandas.org/en/stable/docs/user_guide/indexing.html
- **Shapely Geometry:** https://shapely.readthedocs.io/
- **CRS EPSG:3414:** SVY21 / Singapore TM (meter-based projected CRS for Singapore)
