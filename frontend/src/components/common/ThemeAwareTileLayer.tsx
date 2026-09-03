import { TileLayer } from "react-leaflet";
import { useColorMode } from "../ui/color-mode";

export default function ThemeAwareTileLayer() {
  const { colorMode } = useColorMode();
  
  // Tiles are served by our own backend (see backend/app/api/tiles.py) rather
  // than fetched straight from the CDN, so maps still render on machines with
  // no internet. Do not put an external tile URL back here.
  //
  // ?v=2 cache-busts browsers that already cached the pre-API-key "API KEY
  // REQUIRED" placeholder tiles under these same URLs (served with a 7-day
  // Cache-Control) -- without this, real tiles from the fixed backend are
  // masked by the browser's own stale cache. Bump if this ever recurs.
  const lightMap = "/api/tiles/light/{z}/{x}/{y}.png?v=2";
  const darkMap = "/api/tiles/dark/{z}/{x}/{y}.png?v=2";

  return (
    <TileLayer
      key={colorMode} // Force re-render when theme changes to avoid caching issues
      url={colorMode === "dark" ? darkMap : lightMap}
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors & <a href="https://carto.com/attributions">CARTO</a>'
      maxZoom={22}
    />
  );
}
