import os
import xml.etree.ElementTree as ET
from pathlib import Path

# Update BASE_DIR to point to your local backend/shapefiles directory before running.
BASE_DIR = Path(r"c:\Users\23010975\Documents\GitHub\PathSafetyAssessmentTool\backend\shapefiles")

def get_xml_date(xml_path):
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
        # Find CreaDate inside Esri tag
        crea_date = root.find('.//CreaDate')
        if crea_date is not None and crea_date.text:
            return crea_date.text
        # Fallback to ModDate
        mod_date = root.find('.//ModDate')
        if mod_date is not None and mod_date.text:
            return mod_date.text
    except Exception as e:
        return f"Error parsing: {e}"
    return None

results = []
for root, dirs, files in os.walk(BASE_DIR):
    for f in files:
        if f.endswith('.shp'):
            shp_path = Path(root) / f
            # Check for .shp.xml
            xml_path = shp_path.with_suffix('.shp.xml')
            if not xml_path.exists():
                # Sometimes it's .xml without .shp
                xml_path = shp_path.with_suffix('.xml')
            
            date_val = None
            if xml_path.exists():
                date_val = get_xml_date(xml_path)
            
            rel_path = shp_path.relative_to(BASE_DIR)
            results.append((str(rel_path), date_val))

for path, date in sorted(results):
    print(f"{path}: {date}")
