#!/usr/bin/env python3
"""
Setup script to create a test project structure for PSAT
"""
import json
from pathlib import Path
from datetime import datetime

# Paths — resolve backend/ relative to this script's location in scripts/
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
DATA_DIR = BACKEND_DIR / "data"
PROJECT_NAME = "TestProject"
VERSION = datetime.now().strftime("%Y%m%d")

# Create directories
project_dir = DATA_DIR / PROJECT_NAME
version_dir = project_dir / VERSION
images_dir = project_dir / "images"

project_dir.mkdir(parents=True, exist_ok=True)
version_dir.mkdir(parents=True, exist_ok=True)
images_dir.mkdir(parents=True, exist_ok=True)

# Create metadata.json
metadata = {
    "project_name": PROJECT_NAME,
    "created_date": datetime.now().strftime("%Y-%m-%d"),
    "description": "Test project for development"
}
with open(project_dir / "metadata.json", "w") as f:
    json.dump(metadata, f, indent=2)

# Create geodata.geojson (Singapore coordinates in EPSG:3414)
geodata = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [28500.0, 39000.0],
                    [28550.0, 39050.0],
                    [28600.0, 39100.0]
                ]
            },
            "properties": {
                "Image Reference": "test_001.jpg",
                "Segment ID": 1
            }
        },
        {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [28700.0, 39200.0],
                    [28750.0, 39250.0],
                    [28800.0, 39300.0]
                ]
            },
            "properties": {
                "Image Reference": "test_002.jpg",
                "Segment ID": 2
            }
        }
    ]
}
with open(project_dir / "geodata.geojson", "w") as f:
    json.dump(geodata, f, indent=2)

# Create attributes.csv
attributes_csv = """Segment ID,Area type,Facility Type,AADT,Speed Limit
1,1,1,1000,30
2,2,2,2000,50"""

with open(version_dir / "attributes.csv", "w") as f:
    f.write(attributes_csv)

# Create snapshot_metadata.json
snapshot_metadata = {
    "version": VERSION,
    "created_date": datetime.now().isoformat()
}
with open(version_dir / "snapshot_metadata.json", "w") as f:
    json.dump(snapshot_metadata, f, indent=2)

print(f"✅ Test project created successfully!")
print(f"📁 Location: {project_dir}")
print(f"📅 Version: {VERSION}")
print(f"\nProject structure:")
print(f"  {project_dir}/")
print(f"  ├── metadata.json")
print(f"  ├── geodata.geojson")
print(f"  ├── images/")
print(f"  └── {VERSION}/")
print(f"      ├── attributes.csv")
print(f"      └── snapshot_metadata.json")
print(f"\n🚀 You can now:")
print(f"  1. Start the backend: python app.py")
print(f"  2. Visit: http://localhost:5001/api/projects")
print(f"  3. See your test project: http://localhost:5001/api/projects/{PROJECT_NAME}")
