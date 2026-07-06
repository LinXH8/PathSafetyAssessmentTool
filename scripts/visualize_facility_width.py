"""
Facility Width per Direction Visualization and Debugging Tool

Similar to the curvature visualization, this tool helps analyze and debug
the facility width calculation by showing:
1. What width values are found at each search radius
2. Which layer (cycling/shared/footpath) provides the width
3. The actual numeric width values from shapefiles
4. Search pattern visualization
5. Diagnostic information for troubleshooting

This helps identify issues like:
- Why all results are "Narrow"
- Whether shapefiles have correct WIDTH values
- If search radii are appropriate
- Which paths are being matched
"""

import sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import Circle
import numpy as np

# Resolve backend/ relative to this script's location in scripts/
backend_root = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_root))

from shapely.geometry import Point
from app.services import gis_mapping as gis
from app.utils.path_width_curvature import (
    load_layer,
    _nearest_radius_and_width_with_priority,
    standardize_width_column
)


def analyze_width_at_point_detailed(point, base_dir, start_radius=1.0, max_radius=10.0, step=1.0):
    """
    Perform detailed analysis of width calculation at a point.

    Returns diagnostic information about the search process.
    """
    # Convert to metric if needed
    shp_dir = Path(base_dir)
    layer_store = gis.LayerStore.default(base_dir=str(shp_dir))
    _gis = gis.GIS(layer_store)
    pt = _gis.store.to_metric_point(point)

    # Load layers
    gdf_cycling = load_layer("path/CyclingpathCentreline.shp", base_dir=base_dir)
    gdf_foot = load_layer("path/Footpathcentreline.shp", base_dir=base_dir)
    gdf_share = load_layer("path/Sharedpathcentreline.shp", base_dir=base_dir)

    layers = {
        "cycling": gdf_cycling,
        "footpath": gdf_foot,
        "shared": gdf_share
    }

    # Check what's in each layer
    layer_info = {}
    for name, gdf in layers.items():
        if gdf is None or gdf.empty:
            layer_info[name] = {"status": "empty", "count": 0, "has_width": False}
        else:
            has_width = "WIDTH" in gdf.columns
            width_values = []
            if has_width:
                width_values = gdf["WIDTH"].dropna().tolist()

            layer_info[name] = {
                "status": "loaded",
                "count": len(gdf),
                "has_width": has_width,
                "width_range": (min(width_values), max(width_values)) if width_values else None,
                "width_values": width_values[:20]  # First 20 values
            }

    # Perform expanding ring search with diagnostics
    priority = ["cycling", "shared", "footpath"]
    search_diagnostics = []
    found_width = None
    found_layer = None
    found_radius = None

    for radius in np.arange(start_radius, max_radius + step, step):
        buf = pt.buffer(radius)

        for layer_name in priority:
            gdf = layers[layer_name]
            if gdf is None or gdf.empty:
                continue

            # Query spatial index
            try:
                idx = list(gdf.sindex.query(buf, predicate="intersects"))
            except:
                idx = []

            candidates_at_radius = len(idx)

            if idx and found_width is None:
                candidates = gdf.iloc[idx].copy()

                # Check for WIDTH values
                if "WIDTH" in candidates.columns:
                    candidates["_WIDTH_NUM"] = candidates["WIDTH"]
                    valid = candidates[candidates["_WIDTH_NUM"].notna()]

                    if not valid.empty:
                        # Calculate distances
                        dists = valid.geometry.distance(pt)
                        nearest_idx = dists.idxmin()
                        nearest_dist = dists.min()
                        found_width = float(valid.loc[nearest_idx, "_WIDTH_NUM"])
                        found_layer = layer_name
                        found_radius = radius

                        search_diagnostics.append({
                            "radius": radius,
                            "layer": layer_name,
                            "candidates": candidates_at_radius,
                            "valid_widths": len(valid),
                            "width_found": found_width,
                            "distance": nearest_dist,
                            "locked": True
                        })
                    else:
                        search_diagnostics.append({
                            "radius": radius,
                            "layer": layer_name,
                            "candidates": candidates_at_radius,
                            "valid_widths": 0,
                            "width_found": None,
                            "distance": None,
                            "locked": False
                        })
                else:
                    search_diagnostics.append({
                        "radius": radius,
                        "layer": layer_name,
                        "candidates": candidates_at_radius,
                        "valid_widths": 0,
                        "width_found": None,
                        "distance": None,
                        "locked": False,
                        "note": "No WIDTH column"
                    })
            elif idx:
                # Already locked, but show we found candidates
                search_diagnostics.append({
                    "radius": radius,
                    "layer": layer_name,
                    "candidates": candidates_at_radius,
                    "valid_widths": "?",
                    "width_found": found_width,
                    "distance": None,
                    "locked": "already_locked"
                })

    return {
        "point_wgs84": (point.x, point.y),
        "point_metric": (pt.x, pt.y),
        "layer_info": layer_info,
        "search_diagnostics": search_diagnostics,
        "final_width": found_width,
        "final_layer": found_layer,
        "final_radius": found_radius,
        "layers": layers,
        "priority": priority
    }


def visualize_width_analysis(point, base_dir, start_radius=1.0, max_radius=10.0, step=1.0,
                             location_name="Test Location"):
    """
    Create comprehensive visualization of facility width analysis.
    """
    print(f"\n{'='*80}")
    print(f"FACILITY WIDTH ANALYSIS: {location_name}")
    print(f"{'='*80}\n")

    # Perform analysis
    analysis = analyze_width_at_point_detailed(point, base_dir, start_radius, max_radius, step)

    # Print layer information
    print("1. LAYER INFORMATION:")
    print("-" * 80)
    for layer_name, info in analysis["layer_info"].items():
        print(f"\n{layer_name.upper()} PATH:")
        print(f"  Status: {info['status']}")
        print(f"  Features: {info['count']}")
        print(f"  Has WIDTH column: {info['has_width']}")
        if info.get("width_range"):
            print(f"  Width range: {info['width_range'][0]:.2f}m - {info['width_range'][1]:.2f}m")
            print(f"  Sample widths: {[f'{w:.2f}' for w in info['width_values'][:5]]}")

    # Print search diagnostics
    print(f"\n2. EXPANDING RING SEARCH (start={start_radius}m, max={max_radius}m, step={step}m):")
    print("-" * 80)
    print(f"{'Radius':<8} {'Layer':<12} {'Candidates':<12} {'Valid WIDTH':<13} {'Width Found':<13} {'Status':<15}")
    print("-" * 80)

    for diag in analysis["search_diagnostics"]:
        radius_str = f"{diag['radius']:.1f}m"
        layer_str = diag['layer']
        candidates_str = str(diag['candidates'])
        valid_str = str(diag['valid_widths'])
        width_str = f"{diag['width_found']:.2f}m" if diag['width_found'] else "-"

        if diag.get('locked') == True:
            status_str = "🔒 LOCKED"
        elif diag.get('locked') == 'already_locked':
            status_str = "(locked)"
        else:
            status_str = ""

        print(f"{radius_str:<8} {layer_str:<12} {candidates_str:<12} {valid_str:<13} {width_str:<13} {status_str:<15}")

    # Print final result
    print(f"\n3. FINAL RESULT:")
    print("-" * 80)
    if analysis["final_width"] is not None:
        print(f"Width found: {analysis['final_width']:.2f} meters")
        print(f"Source layer: {analysis['final_layer']}")
        print(f"Found at radius: {analysis['final_radius']:.1f}m")

        # Categorize
        width = analysis["final_width"]
        if width > 4:
            category = "Wide (3)"
            print(f"Category: {category} [width > 4m]")
        elif width > 2:
            category = "Narrow (2)"
            print(f"Category: {category} [2m < width ≤ 4m]")
        else:
            category = "Very Narrow (1)"
            print(f"Category: {category} [width ≤ 2m]")
    else:
        print("❌ No width found - would return default value (2 = Narrow)")

    # Create visualization
    create_width_visualization(analysis, location_name, start_radius, max_radius, step)


def create_width_visualization(analysis, location_name, start_radius, max_radius, step):
    """
    Create visual map showing search rings and found paths.
    """
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 8))

    pt_metric = analysis["point_metric"]

    # Left plot: Search pattern and paths
    ax1.set_aspect('equal')
    ax1.set_title(f'Facility Width Search Pattern\n{location_name}', fontsize=12, fontweight='bold')

    # Plot search rings
    for radius in np.arange(start_radius, max_radius + step, step):
        circle = Circle(pt_metric, radius, fill=False, edgecolor='gray',
                       linestyle='--', alpha=0.3, linewidth=1)
        ax1.add_patch(circle)
        # Label radius
        ax1.text(pt_metric[0] + radius, pt_metric[1], f'{radius:.0f}m',
                fontsize=8, color='gray', alpha=0.5)

    # Plot paths from each layer
    colors = {"cycling": "blue", "shared": "purple", "footpath": "green"}
    labels_added = set()

    for layer_name, gdf in analysis["layers"].items():
        if gdf is None or gdf.empty:
            continue

        color = colors[layer_name]

        # Get paths within max_radius
        buf = Point(pt_metric).buffer(max_radius)
        try:
            idx = list(gdf.sindex.query(buf, predicate="intersects"))
        except:
            idx = []

        if idx:
            nearby = gdf.iloc[idx]
            for geom in nearby.geometry:
                x, y = geom.xy
                label = layer_name if layer_name not in labels_added else None
                ax1.plot(x, y, color=color, linewidth=2, alpha=0.6, label=label)
                if label:
                    labels_added.add(layer_name)

    # Mark the point
    ax1.plot(pt_metric[0], pt_metric[1], 'r*', markersize=20, label='Test Point', zorder=10)

    # Mark where width was found
    if analysis["final_radius"]:
        circle = Circle(pt_metric, analysis["final_radius"], fill=False,
                       edgecolor='red', linewidth=3, label=f'Width found at {analysis["final_radius"]:.1f}m')
        ax1.add_patch(circle)

    ax1.legend(loc='upper right')
    ax1.grid(True, alpha=0.3)
    ax1.set_xlabel('X (meters, EPSG:3414)')
    ax1.set_ylabel('Y (meters, EPSG:3414)')

    # Right plot: Width distribution from shapefiles
    ax2.set_title('WIDTH Values in Shapefiles', fontsize=12, fontweight='bold')

    all_widths = []
    all_labels = []

    for layer_name, info in analysis["layer_info"].items():
        if info.get("width_values"):
            for w in info["width_values"]:
                all_widths.append(w)
                all_labels.append(layer_name)

    if all_widths:
        # Create histogram
        width_bins = [0, 2, 4, 6, 8, 10, 15]

        for layer_name in ["cycling", "shared", "footpath"]:
            layer_widths = [w for w, l in zip(all_widths, all_labels) if l == layer_name]
            if layer_widths:
                ax2.hist(layer_widths, bins=width_bins, alpha=0.5,
                        label=layer_name, color=colors[layer_name])

        # Mark thresholds
        ax2.axvline(2, color='orange', linestyle='--', linewidth=2, label='Very Narrow/Narrow (2m)')
        ax2.axvline(4, color='red', linestyle='--', linewidth=2, label='Narrow/Wide (4m)')

        # Mark found width
        if analysis["final_width"]:
            ax2.axvline(analysis["final_width"], color='green', linestyle='-',
                       linewidth=3, label=f'Found: {analysis["final_width"]:.2f}m')

        ax2.set_xlabel('Width (meters)')
        ax2.set_ylabel('Frequency')
        ax2.legend()
        ax2.grid(True, alpha=0.3, axis='y')
    else:
        ax2.text(0.5, 0.5, 'No WIDTH data found in shapefiles',
                ha='center', va='center', transform=ax2.transAxes, fontsize=12)

    plt.tight_layout()

    # Save figure
    output_file = backend_root / f"width_analysis_{location_name.replace(' ', '_')}.png"
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f"\n📊 Visualization saved to: {output_file}")
    plt.close()


def main():
    """
    Test multiple locations to understand width coding patterns.
    """
    backend_root = Path(__file__).resolve().parent.parent / "backend"
    shp_dir = backend_root / "shapefiles"

    if not shp_dir.exists():
        print(f"❌ Shapefile directory not found: {shp_dir}")
        return

    # Test multiple locations
    test_locations = [
        ("Orchard Road", Point(103.8198, 1.3521)),
        ("Marina Bay", Point(103.8608, 1.2820)),
        ("Sentosa", Point(103.8186, 1.2494)),
        ("Changi Airport", Point(103.9915, 1.3644)),
        ("Jurong East", Point(103.7436, 1.3329)),
    ]

    print("\n" + "="*80)
    print("FACILITY WIDTH PER DIRECTION - DEBUGGING VISUALIZATION")
    print("="*80)
    print("\nThis tool helps you understand:")
    print("  • What width values exist in your shapefiles")
    print("  • Which paths are being matched at each search radius")
    print("  • Why results might all be 'Narrow'")
    print("  • Whether search parameters need adjustment")

    for name, point in test_locations:
        try:
            visualize_width_analysis(
                point,
                base_dir=str(shp_dir),
                start_radius=1.0,
                max_radius=10.0,
                step=1.0,
                location_name=name
            )
            print("\n" + "="*80 + "\n")
        except Exception as e:
            print(f"\n❌ Error analyzing {name}: {e}")
            import traceback
            traceback.print_exc()

    print("\n✅ Analysis complete!")
    print("\nIf all results are 'Narrow', check:")
    print("  1. Are WIDTH values in shapefiles correct? (should vary between 1-6+ meters)")
    print("  2. Are paths actually near your test points?")
    print("  3. Do you need to adjust search radii?")
    print("  4. Is the WIDTH column properly populated in shapefiles?")


if __name__ == "__main__":
    main()
