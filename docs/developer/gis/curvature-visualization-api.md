# Curvature Visualization API

**Status**: ✅ Implemented and tested
**Date**: 2025-11-17

---

## Overview

This API endpoint provides all the data needed to create an interactive map visualization of the curvature analysis process, similar to the original PathAssignmentTool. It shows:

- 🔴 **The analysis point** - Segment starting location
- ⚫ **The 5-meter analysis window** - Circular buffer showing the area analyzed
- 🟢🟠🔵 **Path centerlines** - Actual path geometries color-coded by type
- 📊 **Calculated values** - Curvature radius, width, and classification

---

## API Endpoint

```
POST /api/projects/<project_name>/curvature/visualize
```

### Request

**Headers**:
```
Content-Type: application/json
```

**Body**:
```json
{
  "coords": [[103.8198, 1.3521], [103.8199, 1.3522], ...],  // LineString coordinates
  "index": 0  // Optional: segment index for reference
}
```

**Parameters**:
- `coords` (required): Array of [lon, lat] pairs representing the segment geometry
- `index` (optional): Segment index in the project for reference

---

## Response

### Success Response (200 OK)

```json
{
  "ok": true,
  "point": {
    "lon": 103.8198,
    "lat": 1.3521
  },
  "radius": 8.3,
  "width": 2.5,
  "curvature": 1,
  "circle_geojson": {
    "type": "Feature",
    "geometry": {
      "type": "Polygon",
      "coordinates": [
        [
          [103.8193, 1.3521],
          [103.8194, 1.3522],
          ...
        ]
      ]
    },
    "properties": {
      "radius_m": 5.0,
      "style": {
        "color": "#000000",
        "weight": 2,
        "fill": false
      }
    }
  },
  "paths": [
    {
      "type": "cycling",
      "color": [0, 180, 0],
      "coordinates": [
        [103.8196, 1.3520],
        [103.8197, 1.3521],
        ...
      ],
      "is_analysis_layer": true
    },
    {
      "type": "shared",
      "color": [230, 140, 0],
      "coordinates": [[...]],
      "is_analysis_layer": false
    }
  ],
  "layer_used": "cycling",
  "analysis_window_m": 5.0
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Always `true` for successful requests |
| `point` | object | Analysis point coordinates in WGS84 |
| `point.lon` | number | Longitude of analysis point |
| `point.lat` | number | Latitude of analysis point |
| `radius` | number\|null | Minimum curvature radius in meters (null if no path found) |
| `width` | number\|null | Path width in meters (null if no path found) |
| `curvature` | number | Curvature category: 1=Sharp Turn, 2=No Sharp Turn |
| `circle_geojson` | GeoJSON Feature | The 5m analysis circle (ready for mapping libraries) |
| `paths` | array | Path segments within the circle |
| `paths[].type` | string | Path type: "cycling", "shared", or "footpath" |
| `paths[].color` | [R,G,B] | RGB color array for rendering |
| `paths[].coordinates` | [[lon,lat]] | Path coordinates in WGS84 |
| `paths[].is_analysis_layer` | boolean | True if this layer was used for calculation |
| `layer_used` | string\|null | Which layer provided the data ("cycling"\|"shared"\|"footpath"\|null) |
| `analysis_window_m` | number | Radius of analysis window in meters (always 5.0) |

---

### Error Responses

#### 400 Bad Request
```json
{
  "error": "coords (LineString) is required"
}
```

#### 500 Internal Server Error
```json
{
  "error": "Shapefile base dir not found: /path/to/shapefiles"
}
```

#### 503 Service Unavailable
```json
{
  "error": "CV init failed: ..."
}
```

---

## Color Map

Paths are color-coded by infrastructure type:

| Type | Color Name | RGB | Hex |
|------|-----------|-----|-----|
| cycling | Green | [0, 180, 0] | #00B400 |
| shared | Orange | [230, 140, 0] | #E68C00 |
| footpath | Blue | [30, 144, 255] | #1E90FF |

---

## Example Usage

### JavaScript/TypeScript (Frontend)

```typescript
// Get visualization data for a segment
async function getCurvatureVisualization(projectName: string, coords: [number, number][]) {
  const response = await fetch(`/api/projects/${projectName}/curvature/visualize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coords })
  });

  if (!response.ok) {
    throw new Error('Failed to fetch visualization data');
  }

  return await response.json();
}

// Usage
const vizData = await getCurvatureVisualization('MyProject', [
  [103.8198, 1.3521],
  [103.8199, 1.3522]
]);

console.log(`Radius: ${vizData.radius}m`);
console.log(`Width: ${vizData.width}m`);
console.log(`Sharp turn: ${vizData.curvature === 1 ? 'Yes' : 'No'}`);
```

### Python (Testing)

```python
import requests
import json

url = "http://localhost:5000/api/projects/MyProject/curvature/visualize"
payload = {
    "coords": [[103.8198, 1.3521], [103.8199, 1.3522]]
}

response = requests.post(url, json=payload)
data = response.json()

print(f"Radius: {data['radius']}m")
print(f"Width: {data['width']}m")
print(f"Paths found: {len(data['paths'])}")
```

### cURL

```bash
curl -X POST http://localhost:5000/api/projects/MyProject/curvature/visualize \
  -H "Content-Type: application/json" \
  -d '{
    "coords": [[103.8198, 1.3521], [103.8199, 1.3522]]
  }'
```

---

## Frontend Implementation Examples

### Option 1: Leaflet (React)

```tsx
import { MapContainer, TileLayer, Circle, Marker, Polyline } from 'react-leaflet';

function CurvatureVisualization({ vizData }) {
  // Extract coordinates from GeoJSON
  const circleCoords = vizData.circle_geojson.geometry.coordinates[0];

  return (
    <MapContainer
      center={[vizData.point.lat, vizData.point.lon]}
      zoom={17}
      style={{ height: '500px' }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {/* Analysis point (red dot) */}
      <Marker position={[vizData.point.lat, vizData.point.lon]} />

      {/* 5m circle (black outline) */}
      <Polyline
        positions={circleCoords.map(([lon, lat]) => [lat, lon])}
        color="#000000"
        weight={2}
        fill={false}
      />

      {/* Path centerlines (color-coded) */}
      {vizData.paths.map((path, i) => (
        <Polyline
          key={i}
          positions={path.coordinates.map(([lon, lat]) => [lat, lon])}
          color={`rgb(${path.color.join(',')})`}
          weight={path.is_analysis_layer ? 3 : 2}
        />
      ))}
    </MapContainer>
  );
}
```

### Option 2: Mapbox GL JS (React)

```tsx
import mapboxgl from 'mapbox-gl';
import { useEffect, useRef } from 'react';

function CurvatureMap({ vizData }) {
  const mapContainer = useRef(null);

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [vizData.point.lon, vizData.point.lat],
      zoom: 17
    });

    map.on('load', () => {
      // Add circle
      map.addSource('circle', {
        type: 'geojson',
        data: vizData.circle_geojson
      });
      map.addLayer({
        id: 'circle-layer',
        type: 'line',
        source: 'circle',
        paint: {
          'line-color': '#000000',
          'line-width': 2
        }
      });

      // Add paths
      vizData.paths.forEach((path, i) => {
        map.addSource(`path-${i}`, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: path.coordinates
            }
          }
        });
        map.addLayer({
          id: `path-${i}`,
          type: 'line',
          source: `path-${i}`,
          paint: {
            'line-color': `rgb(${path.color.join(',')})`,
            'line-width': path.is_analysis_layer ? 3 : 2
          }
        });
      });

      // Add point marker
      new mapboxgl.Marker({ color: 'red' })
        .setLngLat([vizData.point.lon, vizData.point.lat])
        .addTo(map);
    });

    return () => map.remove();
  }, [vizData]);

  return <div ref={mapContainer} style={{ height: '500px' }} />;
}
```

### Option 3: Deck.gl (React) - Same as Original

```tsx
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map } from 'react-map-gl';

function CurvatureVisualization({ vizData }) {
  const layers = [
    // Path lines
    new PathLayer({
      id: 'paths',
      data: vizData.paths,
      getPath: d => d.coordinates,
      getColor: d => d.color,
      getWidth: d => d.is_analysis_layer ? 3 : 2,
      widthUnits: 'pixels'
    }),

    // Circle outline
    new GeoJsonLayer({
      id: 'circle',
      data: vizData.circle_geojson,
      stroked: true,
      filled: false,
      getLineColor: [0, 0, 0],
      lineWidthMinPixels: 2
    }),

    // Analysis point
    new ScatterplotLayer({
      id: 'point',
      data: [vizData.point],
      getPosition: d => [d.lon, d.lat],
      getFillColor: [255, 0, 0],
      getRadius: 5,
      radiusUnits: 'pixels'
    })
  ];

  return (
    <DeckGL
      initialViewState={{
        longitude: vizData.point.lon,
        latitude: vizData.point.lat,
        zoom: 17
      }}
      controller={true}
      layers={layers}
    >
      <Map mapStyle="mapbox://styles/mapbox/light-v11" />
    </DeckGL>
  );
}
```

---

## Display Components

### Info Panel Component

```tsx
function CurvatureInfo({ vizData }) {
  return (
    <div className="curvature-info">
      <h3>Curvature Analysis</h3>

      <div className="metric">
        <label>Curvature Radius:</label>
        <span>{vizData.radius ? `${vizData.radius.toFixed(1)}m` : 'N/A'}</span>
      </div>

      <div className="metric">
        <label>Path Width:</label>
        <span>{vizData.width ? `${vizData.width.toFixed(1)}m` : 'N/A'}</span>
      </div>

      <div className="metric">
        <label>Classification:</label>
        <span className={vizData.curvature === 1 ? 'warning' : 'safe'}>
          {vizData.curvature === 1 ? '⚠️ Sharp Turn' : '✓ No Sharp Turn'}
        </span>
      </div>

      <div className="metric">
        <label>Analysis Layer:</label>
        <span>
          {vizData.layer_used || 'No path found'}
          {vizData.layer_used && (
            <span
              className="color-indicator"
              style={{
                backgroundColor: getLayerColor(vizData.layer_used)
              }}
            />
          )}
        </span>
      </div>
    </div>
  );
}

function getLayerColor(layer: string): string {
  const colors = {
    cycling: '#00B400',
    shared: '#E68C00',
    footpath: '#1E90FF'
  };
  return colors[layer] || '#000000';
}
```

---

## Integration in Coding Page

### Where to Display

The visualization should appear in the **Attributes Coding Page**, specifically:

1. **Location**: Next to or below the attributes table
2. **Trigger**: When user clicks on a row/segment or a "Visualize" button
3. **Layout Options**:
   - Modal popup with map
   - Side panel with map
   - Expandable section below the selected row
   - Dedicated "Visualization" tab

### Example Integration

```tsx
// In your coding page component
function AttributesCodingPage() {
  const [selectedSegment, setSelectedSegment] = useState(null);
  const [vizData, setVizData] = useState(null);

  const handleRowClick = async (row) => {
    setSelectedSegment(row);

    // Fetch visualization data
    const data = await fetch(`/api/projects/${projectName}/curvature/visualize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coords: row.geometry.coordinates,
        index: row.index
      })
    }).then(r => r.json());

    setVizData(data);
  };

  return (
    <div className="coding-page">
      <AttributesTable onRowClick={handleRowClick} />

      {vizData && (
        <div className="visualization-panel">
          <CurvatureInfo vizData={vizData} />
          <CurvatureMap vizData={vizData} />
        </div>
      )}
    </div>
  );
}
```

---

## Backend Implementation Details

### Files Modified

1. **[backend/app/services/gis_mapping.py](../app/services/gis_mapping.py)** (Lines 895-1097)
   - Added `get_curvature_visualization()` method
   - Handles coordinate transformation (EPSG:3414 → WGS84)
   - Clips paths to 5m circle
   - Returns complete visualization dataset

2. **[backend/app/api/projects/routes.py](../app/api/projects/routes.py)** (Lines 740-837)
   - Added `/curvature/visualize` endpoint
   - Validates request payload
   - Calls GIS service
   - Returns formatted JSON response

---

## Testing

### Manual Test

```bash
# Start backend server
cd backend
python -m flask run

# In another terminal, test the endpoint
curl -X POST http://localhost:5000/api/projects/TestProject/curvature/visualize \
  -H "Content-Type: application/json" \
  -d '{
    "coords": [[103.8198, 1.3521], [103.8199, 1.3522]]
  }' | jq
```

### Expected Output

```json
{
  "ok": true,
  "point": {
    "lon": 103.8198,
    "lat": 1.3521
  },
  "radius": null,
  "width": null,
  "curvature": 2,
  "circle_geojson": { ... },
  "paths": [],
  "layer_used": null,
  "analysis_window_m": 5.0
}
```

---

## Performance Considerations

- **Caching**: Consider caching visualization data for frequently accessed segments
- **Lazy Loading**: Only fetch visualization when user explicitly requests it
- **Debouncing**: If visualizing on row hover, debounce the API calls
- **Map Instance**: Reuse map instance and update layers instead of recreating

---

## Future Enhancements

1. **Adjustable Window Size**: Allow users to change the analysis radius (5m, 10m, 20m)
2. **Show Expanding Rings**: Visualize the 1m→5m width search process
3. **Highlight Sharp Curves**: Add visual markers where radius < 10m
4. **3D Visualization**: Show curvature as height on a 3D map
5. **Animation**: Animate the two-stage search process
6. **Comparison Mode**: Show before/after for different thresholds

---

## Summary

✅ **API Endpoint Created**: `POST /api/projects/<project>/curvature/visualize`
✅ **Backend Service Ready**: `get_curvature_visualization()` in gis_mapping.py
✅ **Data Format**: GeoJSON-compatible for all major mapping libraries
✅ **Color Coding**: Matches original PathAssignmentTool
✅ **Tested**: Works with real shapefile data

The visualization is ready to be integrated into the React frontend! 🎉
