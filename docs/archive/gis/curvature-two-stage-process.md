# Curvature Two-Stage Process - Implementation Plan

## Problem Identified

The current implementation uses a **single-stage, fixed-radius search**, but the original PathAssignmentTool implementation uses a **two-stage process with expanding rings**.

## Original Implementation (Correct)

From `/Users/xh/Final Year/cyclerap/PathAssignmentTool/src/utils/path_width_curvature.py`:

### Default Parameters
```python
start_radius = 1.0m      # Start of expanding ring search
max_radius = 5.0m        # End of expanding ring search
step = 1.0m              # Ring increment
collect_radius = 5.0m    # Fixed window for curvature
sample_half_window = 1.0m  # Densify step
```

### Two-Stage Process

**STAGE 1: Width Search (Expanding Ring)**
```
for radius in [1m, 2m, 3m, 4m, 5m]:
    create buffer at current radius
    for layer in [cycling, shared, footpath]:
        if features intersect buffer:
            if width not yet locked:
                lock width from nearest feature
                remember which layer provided it
    increment radius
```

**STAGE 2: Curvature Calculation (Fixed Window)**
```
use ONLY the layer that provided width
query features within collect_radius (5m) of point
merge connectable lines
clip to circular buffer (5m radius)
densify at sample_half_window (1m) intervals
calculate minimum triplet-based radius
return (radius, width)
```

### Key Characteristics

1. **Width and curvature come from THE SAME LAYER**
2. **Width uses expanding ring** (tries closer features first)
3. **Curvature uses fixed window** (always 5m, not expanding)
4. **Width locks at first match** (never changes)
5. **Curvature calculated after** width search completes

##Current Implementation (Incorrect)

```python
def get_radius_and_width_at_point(self, point, search_radius=10.0, densify_step=1.0, epsilon=1e-6):
    buffer_geom = pt.buffer(search_radius)  # SINGLE 10m buffer

    for layer_key in priority:
        intersecting = find_intersecting_features(buffer_geom)
        min_radius = calculate_from_all_features()
        width = get_from_nearest_feature()

        if min_radius is not None:
            break  # Stop at first layer
```

**Problems:**
- ❌ No expanding ring search
- ❌ Uses 10m instead of 5m for curvature
- ❌ Uses 10m instead of 1m→5m for width
- ❌ Single-stage process

## Required Changes

### 1. Update Function Signature

```python
def get_radius_and_width_at_point(
    self,
    point,
    start_radius=1.0,      # NEW
    max_radius=5.0,        # CHANGED from search_radius=10.0
    step=1.0,              # NEW
    collect_radius=5.0,    # NEW - for curvature window
    sample_half_window=1.0, # RENAMED from densify_step
    epsilon=1e-6
):
```

### 2. Implement Two-Stage Process

```python
# STAGE 1: Expanding ring search for WIDTH
found_layer = None
found_width = None

for radius in np.arange(start_radius, max_radius + step, step):
    buffer_ring = pt.buffer(radius)

    for layer_key in priority:
        gdf = layers[layer_key]
        if gdf is None or gdf.empty:
            continue

        # Find features in this ring
        intersecting = find_intersecting(buffer_ring)

        # Lock width if not yet set
        if found_width is None and intersecting has valid WIDTH:
            found_width = get_nearest_width(intersecting)
            found_layer = layer_key
            # KEEP SCANNING but width is locked

# STAGE 2: Curvature from the layer that provided width
if found_layer is not None:
    gdf_selected = layers[found_layer]
    buffer_curv = pt.buffer(collect_radius)  # Fixed 5m window

    intersecting_curv = find_intersecting(buffer_curv)
    merged = merge_and_clip(intersecting_curv, buffer_curv)
    densified = densify(merged, sample_half_window)
    min_radius = calculate_triplet_radius(densified)

return (min_radius, found_width)
```

### 3. Update API Calls

In `routes.py`:
```python
# Current (incorrect)
curvature = _gis.get_curvature(pt, sharp_turn_threshold=10.0, search_radius=10.0, default_value=2)

# Should be (correct)
curvature = _gis.get_curvature(pt, sharp_turn_threshold=10.0, default_value=2)
# get_curvature internally calls get_radius_and_width_at_point with defaults:
#   start_radius=1.0, max_radius=5.0, step=1.0, collect_radius=5.0, sample_half_window=1.0
```

### 4. Update get_curvature wrapper

```python
def get_curvature(self, point, sharp_turn_threshold=10.0, default_value=2):
    min_radius, _ = self.get_radius_and_width_at_point(
        point=point,
        # Use defaults: start_radius=1.0, max_radius=5.0, step=1.0
        # collect_radius=5.0, sample_half_window=1.0
    )

    if min_radius is None:
        return default_value

    return 1 if min_radius < sharp_turn_threshold else 2
```

## Implementation Steps

1. ✅ Analyze original implementation
2. ✅ Rewrite `get_radius_and_width_at_point()` with two-stage process
3. ✅ Update `get_curvature()` to use correct defaults
4. ✅ Update API calls in routes.py
5. ✅ Update documentation
6. ⏳ Test with actual shapefiles

## Testing Plan

1. Test with point near cycling path at 2m → should find width at 2m ring
2. Test with point near shared path at 4m → should find width at 4m ring
3. Verify curvature calculated from same layer that provided width
4. Verify curvature uses 5m window regardless of which ring provided width
5. Compare results with original PathAssignmentTool on same points

## Notes

- `sample_half_window` is a misleading name but kept for compatibility with original
- It's actually used as `densify_step` (distance between interpolated points)
- Original code comment says: "used here as densify_step"
- Consider renaming in future but keep parameter name for now to match original
