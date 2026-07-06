# Facility Width per Direction - Visualization and Debugging Summary

## Overview

Created a comprehensive visualization tool to analyze and debug the "Facility Width per Direction" attribute coding, similar to the curvature analysis tool. This helps understand why width values are being coded and identify issues.

## Key Findings

### ✅ Implementation is Working Correctly

The facility width calculation **IS working as expected**:

1. **Shapefiles load successfully** with varied width data:
   - Cycling paths: 0.57m - 8.97m (1,437 features)
   - Footpaths: 0.04m - 33.29m (179,483 features)
   - Shared paths: 0.44m - 11.26m (4,531 features)

2. **Algorithm functions correctly**:
   - Expanding ring search works
   - First-hit width locking works
   - Priority-based layer matching works (cycling → shared → footpath)
   - Width categorization thresholds are correct

3. **Test Results** (using points ON actual paths):
   - Cycling path (width=1.99m) → Category 1 (Very Narrow) ✓
   - Shared path (width=2.61m) → Category 2 (Narrow) ✓
   - Footpath (width=1.22m) → Category 1 (Very Narrow) ✓
   - Footpath (width=1.45m) → Category 1 (Very Narrow) ✓

### 🔍 Why Results Show "Narrow" for Most Locations

The reason most test locations return "Narrow" (default value) is:

**Test points are NOT located near any cycling/footpaths within the search radius (10m)**

From visualization output:
```
2. EXPANDING RING SEARCH (start=1.0m, max=10.0m, step=1.0m):
--------------------------------------------------------------------------------
Radius   Layer        Candidates   Valid WIDTH   Width Found   Status
--------------------------------------------------------------------------------
[EMPTY - No candidates found at any radius]

3. FINAL RESULT:
--------------------------------------------------------------------------------
❌ No width found - would return default value (2 = Narrow)
```

This is **expected behavior**, not a bug. The locations tested (Orchard Road, Marina Bay, Sentosa, etc.) are general area coordinates, not specific path locations.

## Tools Created

### 1. Visualization Tool

**File**: [`backend/visualize_facility_width.py`](backend/visualize_facility_width.py)

**Features**:
- Detailed layer information (feature count, WIDTH range, sample values)
- Expanding ring search diagnostics (shows candidates at each radius)
- Visual map with search rings and nearby paths
- Width distribution histogram from shapefiles
- Saves visualization images for each test location

**Usage**:
```bash
cd backend
python3 visualize_facility_width.py
```

**Output**:
- Console output with detailed diagnostics
- PNG images: `width_analysis_<location_name>.png`

### 2. Test with Actual Path Coordinates

**File**: [`backend/test_width_with_actual_paths.py`](backend/test_width_with_actual_paths.py)

**Features**:
- Extracts sample points from actual path centerlines
- Tests points that are guaranteed to be ON paths
- Shows expected vs. actual width categories
- Validates the entire coding pipeline

**Usage**:
```bash
cd backend
python3 test_width_with_actual_paths.py
```

**Sample Output**:
```
Testing: Cycling Path (width=1.992m)
Expected width from shapefile: 1.992
Source layer: cycling

Result:
  Category Code: 1
  Category Label: Very Narrow (≤2m)
  Expected Code: 1
  Match: ✓
```

## Visualization Output Example

### Layer Information
```
CYCLING PATH:
  Status: loaded
  Features: 1437
  Has WIDTH column: True
  Width range: 0.57m - 8.97m
  Sample widths: ['3.69', '1.56', '2.46', '1.90', '1.80']

FOOTPATH PATH:
  Status: loaded
  Features: 179483
  Has WIDTH column: True
  Width range: 0.04m - 33.29m
  Sample widths: ['1.45', '2.10', '2.10', '1.28', '1.70']
```

### Search Diagnostics (when path is found)
```
Radius   Layer        Candidates   Valid WIDTH   Width Found   Status
0.5m     cycling      1            1             1.99m         🔒 LOCKED
1.0m     cycling      1            ?             1.99m         (locked)
2.0m     footpath     1            ?             1.99m         (locked)
...
```

Shows:
- ✓ **Width was found** at 0.5m radius
- ✓ **Source layer** was cycling path (priority works!)
- ✓ **First-hit locking** works (marked as 🔒 LOCKED)
- ✓ **Width value** extracted correctly (1.99m)

## Width Distribution in Shapefiles

Based on the loaded shapefiles, here's the actual width distribution:

### Cycling Paths (1,437 features)
- Range: 0.57m - 8.97m
- Most paths appear to be in 1.5m - 4m range
- Expected categories: Mix of Very Narrow (1) and Narrow (2), some Wide (3)

### Shared Paths (4,531 features)
- Range: 0.44m - 11.26m
- Samples show: 3.55m, 3.97m, 4.54m, 4.11m, 2.24m
- Expected categories: Mostly Narrow (2), some Wide (3)

### Footpaths (179,483 features)
- Range: 0.04m - 33.29m (very wide range!)
- Most appear to be in 1.2m - 2.1m range
- Expected categories: Mostly Very Narrow (1), some Narrow (2)

**Note**: The 33.29m footpath width seems unusual - could be a data quality issue or a special case (plaza, multi-lane footpath, etc.)

## Findings & Recommendations

### ✅ What's Working

1. **Implementation is correct** - matches PathAssignmentTool exactly
2. **WIDTH data exists** in all three shapefiles
3. **Width values are varied** (0.04m to 33.29m range)
4. **Categorization thresholds are correct**
5. **Priority-based layer matching works**
6. **First-hit locking works**

### ⚠️ Why You See "Narrow" Everywhere

The issue is **NOT with the implementation**, but with:

1. **Test point selection**: Random area coordinates don't overlap with path centerlines
2. **Search radius**: Default 10m may not reach distant paths from arbitrary points
3. **Path density**: Not all areas have cycling/footpaths nearby

### 📋 Recommendations

#### 1. For Development/Testing

**Use the actual path coordinate test**:
```bash
python3 test_width_with_actual_paths.py
```

This extracts coordinates from actual paths, guaranteeing matches.

#### 2. For Production Use

**Ensure user clicks are ON or NEAR actual paths**:
- In the UI, guide users to click directly on path centerlines
- Or: Snap user clicks to nearest path centerline (within reason)
- Or: Increase search radius for areas with sparse path coverage

#### 3. Data Quality

**Review extreme values**:
- 33.29m footpath width seems unusually large
- 0.04m footpath width seems unusually small
- Consider adding validation or capping extreme values

#### 4. Search Parameters

**Consider adjusting default parameters based on area**:
- Dense urban areas: start_radius=1.0m, max_radius=10.0m ✓
- Sparse rural areas: start_radius=5.0m, max_radius=25.0m (increase search)
- Exact coding (user clicks on path): start_radius=0.5m, max_radius=5.0m (tighter search)

## Visualization Examples

The tool generates PNG images showing:

1. **Left Panel**: Search pattern map
   - Concentric rings (search radii)
   - Path centerlines color-coded by type (blue=cycling, purple=shared, green=footpath)
   - Red star marking test point
   - Red circle showing where width was found

2. **Right Panel**: Width distribution histogram
   - Histogram of WIDTH values from shapefiles
   - Orange dashed line: 2m threshold (Very Narrow/Narrow)
   - Red dashed line: 4m threshold (Narrow/Wide)
   - Green solid line: Found width value

## Files Created

1. **[`backend/visualize_facility_width.py`](backend/visualize_facility_width.py)** - Main visualization tool
2. **[`backend/test_width_with_actual_paths.py`](backend/test_width_with_actual_paths.py)** - Test with actual path coordinates
3. **[`backend/WIDTH_VISUALIZATION_SUMMARY.md`](backend/WIDTH_VISUALIZATION_SUMMARY.md)** - This document

## Generated Visualizations

The following visualization images were generated:

- `width_analysis_Orchard_Road.png`
- `width_analysis_Marina_Bay.png`
- `width_analysis_Sentosa.png`
- `width_analysis_Changi_Airport.png`
- `width_analysis_Jurong_East.png`
- `width_analysis_Cycling_Path_width_1.992m.png`
- `width_analysis_Shared_Path_width_2.606m.png`
- `width_analysis_Footpath_Narrow_width_1.22m.png`
- `width_analysis_Footpath_Medium_width_1.45m.png`

## How to Use

### Quick Diagnosis

Run the visualization on your problem locations:

```python
from visualize_facility_width import visualize_width_analysis
from shapely.geometry import Point

visualize_width_analysis(
    Point(103.8198, 1.3521),  # Your coordinates
    base_dir="shapefiles",
    start_radius=1.0,
    max_radius=10.0,
    step=1.0,
    location_name="My Test Point"
)
```

The visualization will show you:
- Whether any paths exist nearby
- What width values are in those paths
- At what radius the nearest path was found
- Why a particular category was assigned

### Systematic Testing

Extract and test actual path locations:

```bash
python3 test_width_with_actual_paths.py
```

This will:
- Sample paths with various widths from shapefiles
- Test each one
- Show expected vs. actual results
- Generate detailed visualizations

## Conclusion

The **Facility Width per Direction implementation is working correctly**. The PathAssignmentTool migration was successful, and the algorithm functions as designed.

The reason for seeing "Narrow" (default) in many tests is simply that **test points don't have paths nearby**. This is expected behavior when testing random coordinates.

To see varied width categories:
1. Use coordinates that are actually ON cycling/footpaths
2. Or run `test_width_with_actual_paths.py` which does this automatically

The visualization tools created help debug and understand the coding process, making it easy to verify correctness and troubleshoot issues.
