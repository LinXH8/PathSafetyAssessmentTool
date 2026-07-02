import re
from pathlib import Path

# Resolve frontend/src relative to this script's location in scripts/
FRONTEND_SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"

files_to_update = {
    'pages/PathAnalysisPage/components/PathAnalysisMapView.tsx': '../../../components/common/ThemeAwareTileLayer',
    'pages/GisLayersPage/GisLayersPage.tsx': '../../components/common/ThemeAwareTileLayer',
    'pages/CodingPage/components/GeoDataPanel.tsx': '../../../components/common/ThemeAwareTileLayer',
    'pages/TreatmentPage/components/MapView.tsx': '../../../components/common/ThemeAwareTileLayer',
    'pages/TreatmentPage/components/TreatmentMapView.tsx': '../../../components/common/ThemeAwareTileLayer',
    'pages/AnalysisPage/components/MapView.tsx': '../../../components/common/ThemeAwareTileLayer',
    'components/visualization/width/WidthVisualization.tsx': '../../common/ThemeAwareTileLayer',
    'components/visualization/curvature/CurvatureVisualization.tsx': '../../common/ThemeAwareTileLayer'
}

tile_layer_regex = re.compile(r'<TileLayer\s+url="[^"]+"\s+attribution=\'[^"\'\[]+\'\s+maxZoom=\{22\}\s*/>|<TileLayer[^>]*/>', re.DOTALL)

for file_path, import_path in files_to_update.items():
    abs_path = FRONTEND_SRC / file_path
    if not abs_path.exists():
        print(f"Skipping {file_path}")
        continue

    with open(abs_path, 'r') as f:
        content = f.read()
    
    # Check if we already imported
    if "ThemeAwareTileLayer" not in content:
        # Replace the <TileLayer ... />
        new_content = tile_layer_regex.sub('<ThemeAwareTileLayer />', content)
        
        # Add import
        import_str = f'import ThemeAwareTileLayer from "{import_path}";'
        new_content = import_str + "\n" + new_content
        
        with open(abs_path, 'w') as f:
            f.write(new_content)
        print(f"Updated {file_path}")

