import { TileLayer } from "react-leaflet";
import { useColorMode } from "../ui/color-mode";

export default function ThemeAwareTileLayer() {
  const { colorMode } = useColorMode();
  
  // Tiles are served by our own backend (see backend/app/api/tiles.py) rather
  // than fetched straight from the CDN, so maps still render on machines with
  // no internet. Do not put an external tile URL back here.
  const lightMap = "/api/tiles/light/{z}/{x}/{y}.png";
  const darkMap = "/api/tiles/dark/{z}/{x}/{y}.png";

  return (
    <TileLayer
      key={colorMode} // Force re-render when theme changes to avoid caching issues
      url={colorMode === "dark" ? darkMap : lightMap}
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors & <a href="https://carto.com/attributions">CARTO</a>'
      maxZoom={22}
    />
  );
}
