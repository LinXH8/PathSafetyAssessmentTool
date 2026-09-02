import { TileLayer } from "react-leaflet";
import { useColorMode } from "../ui/color-mode";

export default function ThemeAwareTileLayer() {
  const { colorMode } = useColorMode();

  // Tiles are served by our own backend (see backend/app/api/tiles.py) rather
  // than fetched straight from the CDN, so maps still render on machines with
  // no internet. Do not put an external tile URL back here.
  //
  // There is only one basemap style now (OSM's standard tiles) -- both themes
  // hit the same "light" route, and dark mode is faked with a CSS invert
  // filter (map-tile-dark-filter, index.css) rather than a second tile
  // source, since no free/keyless dark raster basemap is available (see the
  // tiles.py module docstring for why).
  const tileUrl = "/api/tiles/light/{z}/{x}/{y}.png";

  return (
    <TileLayer
      key={colorMode} // Force re-render so className (only applied at tile creation) is correct on all tiles
      url={tileUrl}
      className={colorMode === "dark" ? "map-tile-dark-filter" : undefined}
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      maxZoom={22}
      maxNativeZoom={19}
    />
  );
}
