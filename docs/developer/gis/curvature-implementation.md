# Curvature Attribute Implementation

## Overview

The **Curvature** attribute indicates whether a sharp turn is present on the cycling facility path at a segment location. It uses actual path centerline shapefiles from Singapore's infrastructure database to determine the real path geometry, then applies the circumcircle method to detect sharp turns.

## Attribute Details

- **Attribute Name**: Curvature
- **Field Name in System**: `Curvature` (also referenced as `CURV_STR` in code)
- **Data Type**: Categorical (Integer)
- **Default Value**: 2 (No Sharp Turn Present)

### Coding Values

| Code | Label | Description |
|------|-------|-------------|
| 1 | Sharp Turn Present | Minimum circumradius < 10m threshold |
| 2 | No Sharp Turn Present | Minimum circumradius >= 10m threshold (default) |

### Value Mapping

The attribute uses `sharp_turn_mapping` defined in `global_var.py` and `serializer.py`:

```python
sharp_turn_mapping = {
    'Sharp Turn Present': 1,
    'No Sharp Turn Present': 2
}
```

## Data Sources

The curvature is calculated using **actual path centerline shapefiles** from Singapore's infrastructure database, not the segment geometries created from sampled images.

### Required Shapefiles

1. **`CyclingpathCentreline.shp`** - Cycling path centerlines
2. **`Footpathcentreline.shp`** - Footpath centerlines
3. **`Sharedpathcentreline.shp`** - Shared path centerlines

**Location**: `backend/shapefiles/path/`

**Priority Order**: Cycling paths > Shared paths > Footpaths (first match wins)

**Coordinate System**: EPSG:3414 (Singapore SVY21)

## Algorithm: Shapefile-Based Circumcircle Method

### High-Level Process

1. **Extract Starting Point**: Use the first coordinate of the segment's LineString geometry
2. **Query Shapefiles**: Search for path features within 10-meter radius of the starting point
3. **Merge and Clip**: Merge connectable line segments and clip to the search buffer
4. **Densify**: Insert vertices every 1 meter along the path for accurate curvature detection
5. **Calculate Radius**: Apply circumcircle method to find minimum radius
6. **Classify**: Compare radius against 10-meter threshold

### Mathematical Foundation

The circumcircle method analyzes path geometry by calculating the circumradius (radius of the circumscribed circle) for every three consecutive points along the path. The minimum circumradius across all triplets represents the sharpest turn.

For three points A, B, C forming a triangle:

1. **Calculate side lengths**:
   - a = distance(A, B)
   - b = distance(B, C)
   - c = distance(A, C)

2. **Calculate semi-perimeter**:
   - p = 0.5 × (a + b + c)

3. **Calculate area using Heron's formula**:
   - area² = p × (p - a) × (p - b) × (p - c)
   - area = √(area²)

4. **Calculate circumradius**:
   - R = (a × b × c) / (4 × area)

The circumradius R represents the curvature at that point:
- **Smaller radius** = **sharper curve**
- **Larger radius** = **gentler curve**

### Implementation Steps

#### 1. Point Extraction
```python
# Get starting point from segment geometry
start_point = Point(segment_coords[0])  # First coordinate is segment start
```

#### 2. Shapefile Query
- Create 10-meter circular buffer around starting point
- Query each shapefile layer using spatial index for efficiency
- Priority order: cycling → shared → footpath
- Stop at first layer that contains matching features

#### 3. Geometry Processing
```python
# Merge all intersecting features
merged_geom = unary_union(intersecting_features.geometry.tolist())

# Connect line segments if possible
if merged_geom.geom_type == 'MultiLineString':
    merged_geom = linemerge(merged_geom)

# Clip to search buffer
clipped_geom = merged_geom.intersection(buffer_geom)
```

#### 4. Path Densification
- Insert vertices every **1.0 meter** along the line
- Creates smoother representation for accurate curvature detection
- Uses Shapely's `interpolate()` method

```python
densified_coords = []
num_points = int(line.length / 1.0)  # 1 meter step
for i in range(num_points + 1):
    distance = min(i * 1.0, line.length)
    point = line.interpolate(distance)
    densified_coords.append((point.x, point.y))
```

#### 5. Triplet Analysis
- Slide a 3-vertex window through all consecutive points
- For each triplet (A, B, C):
  - Calculate side lengths using Euclidean distance
  - Skip degenerate cases (collinear points, zero-length segments)
  - Calculate circumradius using the formula above
  - Track the minimum radius

```python
for i in range(len(coordinates) - 2):
    A, B, C = coordinates[i:i+3]

    # Calculate distances
    a = distance(A, B)
    b = distance(B, C)
    c = distance(A, C)

    # Skip if too small
    if a < 1e-6 or b < 1e-6 or c < 1e-6:
        continue

    # Heron's formula for area
    p = 0.5 * (a + b + c)
    area = sqrt(p * (p-a) * (p-b) * (p-c))

    # Skip collinear
    if area <= 1e-6:
        continue

    # Circumradius
    R = (a * b * c) / (4 * area)

    if R < min_radius:
        min_radius = R
```

#### 6. Classification
```python
if min_radius is None:
    return 2  # Default: No Sharp Turn
elif min_radius < 10.0:
    return 1  # Sharp Turn Present
else:
    return 2  # No Sharp Turn Present
```

### Algorithm Parameters

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| `sharp_turn_threshold` | 10.0 meters | Radius below which indicates a sharp turn |
| `search_radius` | 10.0 meters | Distance to search for nearby path features |
| `densify_step` | 1.0 meters | Distance between interpolated points |
| `epsilon` | 1e-6 | Minimum value for distance/area to avoid numerical issues |
| `default_value` | 2 | Default category (No Sharp Turn Present) |

## Error Handling

The implementation handles various edge cases:

1. **No path features found**: Returns default value (2)
2. **Invalid geometry**: Skips and tries next layer
3. **Insufficient points** (< 3): Returns default value (2)
4. **Degenerate triangles**: Skips collinear points and zero-length segments
5. **Division by zero**: Protected by epsilon checks
6. **Empty geometries after clipping**: Returns default value (2)

## Configuration

### Field Definitions

**File**: `backend/app/services/serializer.py`

```python
class Attributes(BaseTable):
    class Fields:
        CURV_STR = "Curvature"
        # ... other fields

    CHOICES = {
        Fields.CURV_STR: sharp_turn_mapping,
        # ... other mappings
    }
```

### Value Mappings

**File**: `backend/app/services/global_var.py`

```python
sharp_turn_mapping = {'Sharp Turn Present': 1, 'No Sharp Turn Present': 2}
```

**File**: `backend/app/services/global_var.py` - Default values

```python
dataframe_default_values = {
    # ... other defaults
    CURV_STR: 2,  // Default: No Sharp Turn Present
    # ... other defaults
}
```

## Integration

### GIS Service

**File**: `backend/app/services/gis_mapping.py`

**Method 1**: `GIS.get_radius_and_width_at_point(point, search_radius=10.0, densify_step=1.0, epsilon=1e-6)`

Returns: `(min_radius, width)` tuple
- `min_radius`: Minimum circumradius in meters, or None if not found
- `width`: Path width in meters, or None if not found

**Method 2**: `GIS.get_curvature(point, sharp_turn_threshold=10.0, search_radius=10.0, default_value=2)`

Returns: Curvature category (1 or 2)

### API Endpoint

**File**: `backend/app/api/projects/routes.py`

**Endpoint**: `POST /api/projects/<project_name>/autocode/gis`

```python
@bp.post("/<project_name>/autocode/gis")
def autocode_gis(project_name: str):
    # ... initialization code

    # Extract starting point from segment coordinates
    start_lon, start_lat = coords[0]  # First coordinate
    pt = Point(start_lon, start_lat)

    # ... other GIS rules

    # Calculate curvature using actual path centerline shapefiles
    curvature = _gis.get_curvature(
        pt,
        sharp_turn_threshold=10.0,
        search_radius=10.0,
        default_value=2
    )
    updates["Curvature"] = curvature

    return ok({"updates": updates, "changed_fields": list(updates.keys())})
```

## Comparison with Previous Implementation

### Previous Approach (Removed)
- Used sampled segment geometry directly
- Densified the sampled points
- Analyzed a window around a specific point index
- Issues: GPS noise, inaccurate for actual infrastructure

### Current Approach (Shapefile-Based)
- Uses official infrastructure centerline shapefiles
- Queries actual path geometry from authoritative source
- More accurate representation of designed infrastructure
- Consistent with other GIS-based attributes (Area Type, Facility Width, etc.)

## Testing

To test the curvature calculation:

1. **Verify Shapefiles**: Ensure path centerline shapefiles exist at `backend/shapefiles/path/`
2. **Check Spatial Index**: Shapefiles should have spatial indexes for performance
3. **Test Different Scenarios**:
   - Straight paths (should return 2)
   - Sharp 90-degree turns (should return 1)
   - Gentle curves (should return 2)
   - Areas without path coverage (should return default 2)

## Performance Considerations

1. **Spatial Indexing**: Uses R-tree spatial index (`.sindex`) for efficient queries
2. **Priority Layering**: Stops searching after first layer with matching features
3. **Buffer Clipping**: Only processes geometry within 10m radius
4. **Computational Complexity**: O(n) where n = number of densified points

## Known Limitations

1. **Coverage Dependency**: Requires path centerline shapefiles to be present
2. **10-Meter Window**: Only detects turns within 10m of segment starting point
3. **Threshold Sensitivity**: 10m threshold may not suit all contexts
4. **Shapefile Quality**: Results depend on accuracy of source shapefiles

## Future Enhancements

1. **Adaptive Search Radius**: Increase radius if no features found
2. **Multi-Scale Analysis**: Analyze at different radius thresholds
3. **Confidence Scores**: Return probability instead of binary classification
4. **Visualization**: Generate debug output showing detected path geometry

## References

- Heron's Formula: https://en.wikipedia.org/wiki/Heron%27s_formula
- Circumscribed Circle: https://en.wikipedia.org/wiki/Circumscribed_circle
- CycleRAP Methodology: CycleRAP User Guide

## Author & Version

- **Implemented**: 2025-11-17
- **Version**: 2.0 (Shapefile-based)
- **Framework**: PathSafetyAssessmentTool / CycleRAP
- **Implementation Files**:
  - `backend/app/services/gis_mapping.py` (GIS.get_curvature, GIS.get_radius_and_width_at_point)
  - `backend/app/api/projects/routes.py` (API integration)
