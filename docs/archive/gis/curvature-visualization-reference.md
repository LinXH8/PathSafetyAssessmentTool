# Curvature Visualization in Original PathAssignmentTool

**Reference Source**: `/Users/xh/Final Year/cyclerap/PathAssignmentTool/src/app.py` (Lines 927-1062)

## Overview

Yes! The original Streamlit application **did have visualization** for curvature. It displayed an interactive map showing:
- 🔴 The current point (red dot)
- ⚫ A **5-meter radius circle** (black outline) representing the curvature analysis window
- 🟢🟠🔵 Path centerlines within that circle (color-coded by type)

---

## Visualization Components

### 1. **The 5-Meter Analysis Window**

```python
# Line 968-973
radius, width = get_radius_and_width_at_point(
    start_point,
    collect_radius=5.0,         # This is the window size
    sample_half_window=1.0,
)

# Line 973-975
display_radius_m = 5.0  # Fixed 5-meter circle for display
# Note: Could optionally show the computed radius instead
```

**What it shows**: A black circle outline with a **5-meter radius** around the selected point, representing the exact area used for curvature calculation.

---

### 2. **Path Centerlines (Color-Coded)**

```python
# Lines 988-992
color_map = {
    "cycling": [0, 180, 0],      # 🟢 Green
    "shared":  [230, 140, 0],    # 🟠 Orange
    "footpath":[30, 144, 255],   # 🔵 Blue
}
```

**What it shows**: The actual path geometries from the shapefiles, clipped to the 5-meter circle, showing exactly which paths were analyzed for curvature.

---

### 3. **The Current Point**

```python
# Lines 1024-1031
point_layer = pdk.Layer(
    "ScatterplotLayer",
    data=point_data,
    get_position="coords",
    get_radius=1,        # pixels
    get_fill_color=[255, 0, 0],  # 🔴 Red
    pickable=True,
)
```

**What it shows**: A red dot marking the exact location being analyzed (the segment's starting point).

---

## Full Visualization Code

Here's the complete visualization implementation from the original app:

```python
#----------------------------------------------------------#
#--------------------testing map---------------------------#
#----------------------------------------------------------#

# --- Helpers: extract lines safely & project to lon/lat ---
def _extract_lines(geom):
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, LineString):
        return [geom]
    if isinstance(geom, MultiLineString):
        return [ls for ls in geom.geoms if isinstance(ls, LineString) and not ls.is_empty]
    if isinstance(geom, GeometryCollection):
        out = []
        for g in geom.geoms:
            out.extend(_extract_lines(g))
        return out
    return []

# 3414 -> 4326 transformer for pydeck
_to_wgs84 = Transformer.from_crs("EPSG:3414", "EPSG:4326", always_xy=True).transform

def line_to_lonlat_paths(geom):
    """Return a list of paths (each path is [[lon,lat], ...]) from any geometry."""
    paths = []
    for ls in _extract_lines(geom):
        coords = [(x, y) for x, y in ls.coords]
        lonlat = [list(_to_wgs84(x, y)) for x, y in coords]
        paths.append(lonlat)
    return paths

# --- Get the current segment's starting point ---
start_geom = st.session_state.project.geo_data.loc[st.session_state.index, "geometry"]
start_point = Point(start_geom.coords[0])

# --- Calculate curvature radius and width ---
radius, width = get_radius_and_width_at_point(
    start_point,
    collect_radius=5.0,         # Window size for analysis
    sample_half_window=1.0,
)

# --- Create display circle (5 meters in EPSG:3414) ---
display_radius_m = 5.0
circle_geom_3414 = start_point.buffer(display_radius_m)
circle_geom_wgs84 = shapely_transform(_to_wgs84, circle_geom_3414)  # Convert to WGS84 for rendering

# --- Load path centerline layers ---
layers_gdf = {
    "cycling": load_layer("shp/path/CyclingpathCentreline.shp"),
    "shared":  load_layer("shp/path/Sharedpathcentreline.shp"),
    "footpath": load_layer("shp/path/Footpathcentreline.shp"),
}

# --- Color map for path types ---
color_map = {
    "cycling": [0, 180, 0],      # Green
    "shared":  [230, 140, 0],    # Orange
    "footpath":[30, 144, 255],   # Blue
}

# --- Collect path lines inside the 5m circle ---
lines_data = []
for name, gdf in layers_gdf.items():
    if gdf is None or gdf.empty:
        continue

    # Fast spatial query using spatial index
    try:
        idx = list(gdf.sindex.query(circle_geom_3414, predicate="intersects"))
    except Exception:
        idx = []
    if not idx:
        continue

    sub = gdf.iloc[idx].copy()
    for geom in sub.geometry:
        if geom is None or geom.is_empty:
            continue

        try:
            # Clip path to the circle
            clipped = geom.intersection(circle_geom_3414)
        except Exception:
            # Attempt a light fix if needed
            clipped = geom.buffer(0).intersection(circle_geom_3414)

        # Convert to lon/lat paths
        for path in line_to_lonlat_paths(clipped):
            lines_data.append({
                "name": name,
                "path": path,
                "color": color_map.get(name, [0, 0, 0])
            })

# --- Convert point to lon/lat ---
start_lon, start_lat = _to_wgs84(start_point.x, start_point.y)
point_data = [{"name": "Start Point", "coords": [start_lon, start_lat]}]

# --- Create PyDeck layers ---
point_layer = pdk.Layer(
    "ScatterplotLayer",
    data=point_data,
    get_position="coords",
    get_radius=1,        # pixels
    get_fill_color=[255, 0, 0],  # Red
    pickable=True,
)

circle_layer = pdk.Layer(
    "GeoJsonLayer",
    data={"type": "Feature", "geometry": mapping(circle_geom_wgs84)},
    stroked=True,
    filled=False,
    get_line_color=[0, 0, 0],  # Black outline
    line_width_min_pixels=2,
)

lines_layer = pdk.Layer(
    "PathLayer",
    data=lines_data,
    get_path="path",
    get_width=1,         # pixels
    get_color="color",
    pickable=True,
)

# --- Set view state ---
view_state = pdk.ViewState(longitude=start_lon, latitude=start_lat, zoom=17)

# --- Display the map in an expander ---
with st.expander(f"Width: {width}, Radius: {radius}", expanded=False):
    st.pydeck_chart(pdk.Deck(
        layers=[lines_layer, circle_layer, point_layer],
        initial_view_state=view_state,
        map_style="mapbox://styles/mapbox/light-v9",
        tooltip={"text": "{name}"}
    ))

#----------------------------------------------------------#
#----------------end testing map---------------------------#
#----------------------------------------------------------#
```

---

## What the User Sees

### **In the Streamlit UI:**

1. **An expander with the title**: `"Width: 2.5, Radius: 8.3"` (example values)
2. **When expanded, an interactive map showing**:

```
┌─────────────────────────────────────────┐
│  Mapbox Light Style Background          │
│                                          │
│         ╱───────╲                       │
│        ╱    ⭕    ╲  ← 5m circle (black)│
│       │   🟢 🔴   │  ← Paths & Point    │
│        ╲    ╱    ╱                      │
│         ╲───────╱                       │
│                                          │
│  🔴 = Red dot (analysis point)          │
│  ⭕ = Black circle (5m window)          │
│  🟢 = Green line (cycling path)         │
│  🟠 = Orange line (shared path)         │
│  🔵 = Blue line (footpath)              │
│                                          │
└─────────────────────────────────────────┘
```

---

## Key Features

### ✅ **Interactive Visualization**
- Users can **pan and zoom** the map
- Hovering over paths shows **tooltip** with path type name
- Map is centered on the analysis point with **zoom level 17** (very detailed)

### ✅ **Exact Analysis Window**
- The circle **exactly represents** the `collect_radius=5.0` parameter
- Shows the **actual area** used for curvature calculation
- Helps users understand what data is being analyzed

### ✅ **Path Type Identification**
- **Color-coded paths** make it easy to see which infrastructure type was analyzed
- Green = cycling → Orange = shared → Blue = footpath
- Only shows paths **inside the 5m circle** (clipped geometry)

### ✅ **Real Geometry Display**
- Shows the **actual path centerlines** from shapefiles
- Paths are **clipped to the circle** to show exactly what's analyzed
- Includes **line merging** and **geometry repair** for robustness

---

## Alternative Display Option (Commented Out)

The code includes an alternative visualization option:

```python
# Option A: show the local curvature window used above
display_radius_m = 5.0

# Option B: show the computed radius if present (uncomment if you prefer)
# display_radius_m = float(radius) if radius else 10.0
```

**Option B** would show a circle with **radius = the computed curvature radius** instead of the fixed 5m window. For example:
- If curvature radius = 8.3m → Show 8.3m circle
- If curvature radius = 15m → Show 15m circle
- If no radius found → Show 10m default circle

This gives a visual sense of **how curved the path is** (smaller circle = sharper curve).

---

## Technologies Used

- **PyDeck**: Deck.gl bindings for Python/Streamlit
- **Mapbox**: Light style basemap
- **Shapely**: Geometry operations (buffer, intersection, transform)
- **GeoPandas**: Spatial indexing and queries
- **PyProj**: Coordinate system transformations (EPSG:3414 ↔ EPSG:4326)

---

## Could This Be Implemented in the React App?

**Yes!** Here's how you could adapt it:

### **Option 1: Deck.gl (Same as Original)**
Use the JavaScript version of Deck.gl in React:
```jsx
import DeckGL from '@deck.gl/react';
import {GeoJsonLayer, PathLayer, ScatterplotLayer} from '@deck.gl/layers';
```

### **Option 2: Mapbox GL JS**
Use Mapbox's native library:
```jsx
import mapboxgl from 'mapbox-gl';
// Add circle, point, and path layers
```

### **Option 3: Leaflet**
Use Leaflet with React:
```jsx
import { MapContainer, Circle, Marker, Polyline } from 'react-leaflet';
```

### **Option 4: Google Maps API**
Use Google Maps with circle and polyline overlays.

---

## Data Required from Backend

To implement this visualization, the frontend would need:

```json
{
  "point": {
    "lon": 103.8198,
    "lat": 1.3521
  },
  "radius": 8.3,
  "width": 2.5,
  "circle": {
    "type": "Feature",
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[lon, lat], ...]]
    }
  },
  "paths": [
    {
      "type": "cycling",
      "color": [0, 180, 0],
      "geometry": {
        "type": "LineString",
        "coordinates": [[lon, lat], ...]
      }
    },
    {
      "type": "shared",
      "color": [230, 140, 0],
      "geometry": {
        "type": "LineString",
        "coordinates": [[lon, lat], ...]
      }
    }
  ]
}
```

This could be added as a new endpoint:
```
GET /api/projects/<project>/curvature/visualize?index=5
```

---

## Summary

✅ **Yes, the original app had curvature visualization!**

It showed:
1. 🔴 **Red point** - The analysis location
2. ⚫ **Black circle** - The 5-meter analysis window
3. 🟢🟠🔵 **Colored paths** - Actual path geometries (cycling/shared/footpath)
4. 📊 **Values in title** - Width and curvature radius

The visualization was **interactive, accurate, and informative** - helping users understand exactly what data was being analyzed for the curvature calculation.

This could be replicated in the React app using Deck.gl, Mapbox, Leaflet, or Google Maps! 🗺️
