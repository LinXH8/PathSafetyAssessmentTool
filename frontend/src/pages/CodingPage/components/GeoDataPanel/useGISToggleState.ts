/**
 * useGISToggleState.ts — GIS layer toggle state for GeoDataPanel.
 *
 * Single responsibility: the 15 map-layer on/off toggles (paths, crossings,
 * transit, parking, kerb, defects, land ownership), including:
 *   - initialisation from localStorage (`gisLayerToggles_<project>` via
 *     `constants/sessionKeys.ts::gisLayerToggleKey`),
 *   - persistence back to localStorage on every change,
 *   - cross-panel mirroring via the `psat:gisLayers:sync` window event (used by
 *     the Treatment page's Before/After panels showing the same project),
 *   - resync when the project changes,
 *   - auto-enabling the 3 path layers when the Analysis Overlay turns on.
 * Extracted verbatim from GeoDataPanel.tsx in S2.2.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { gisLayerToggleKey } from "../../../../constants/sessionKeys";

/** The 15 GIS layer toggle values. */
export type GISToggleState = {
  showFootpath: boolean;
  showCycling: boolean;
  showShared: boolean;
  showRoadcrossing: boolean;
  showMrtExit: boolean;
  showBusStop: boolean;
  showBusLane: boolean;
  showParkingLot: boolean;
  showKerbLine: boolean;
  showBicycleCrossing: boolean;
  showPathDefects: boolean;
  showStateLand: boolean;
  showStatBoard: boolean;
  showLandPrivate: boolean;
  showLandMinistry: boolean;
};

/** Setter for each toggle, matching AnalysisSidebar's prop contract. */
export type GISToggleSetters = {
  setShowFootpath: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCycling: React.Dispatch<React.SetStateAction<boolean>>;
  setShowShared: React.Dispatch<React.SetStateAction<boolean>>;
  setShowRoadcrossing: React.Dispatch<React.SetStateAction<boolean>>;
  setShowMrtExit: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBusStop: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBusLane: React.Dispatch<React.SetStateAction<boolean>>;
  setShowParkingLot: React.Dispatch<React.SetStateAction<boolean>>;
  setShowKerbLine: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBicycleCrossing: React.Dispatch<React.SetStateAction<boolean>>;
  setShowPathDefects: React.Dispatch<React.SetStateAction<boolean>>;
  setShowStateLand: React.Dispatch<React.SetStateAction<boolean>>;
  setShowStatBoard: React.Dispatch<React.SetStateAction<boolean>>;
  setShowLandPrivate: React.Dispatch<React.SetStateAction<boolean>>;
  setShowLandMinistry: React.Dispatch<React.SetStateAction<boolean>>;
};

/**
 * Owns GeoDataPanel's GIS layer toggles and their persistence/sync side effects.
 *
 * @param projectName raw (possibly URL-encoded) project name — used as the
 *   localStorage key and the cross-panel sync scope. Empty/undefined → no
 *   persistence or sync.
 * @param showCurvatureOverlay the Analysis Overlay prop; persisted as
 *   `overlayEnabled` so the next session knows whether the 3 path layers were
 *   overlay-managed, and auto-enables them when the overlay turns on.
 * @returns `toggles` (values) and `setters` (one setter per toggle).
 * Side effects: localStorage writes (`gisLayerToggles_<project>`), dispatches
 * and listens to the `psat:gisLayers:sync` window event.
 */
export function useGISToggleState(
  projectName: string | undefined,
  showCurvatureOverlay: boolean | undefined,
): { toggles: GISToggleState; setters: GISToggleSetters } {
  // Read initial toggle states from localStorage if available
  const cachedLayers = useMemo(() => {
    if (!projectName) return {} as Record<string, boolean>;
    try {
      const stored = localStorage.getItem(gisLayerToggleKey(projectName));
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }, [projectName]);

  // GIS Layer toggles (matching curvature analysis colors)
  // If the overlay was on when the session ended (overlayEnabled !== false), the 3 path layers
  // were in "overlay-managed" mode — reset them to false because the overlay always starts off.
  // Treating a missing key (old localStorage entries) the same as true migrates stale data.
  const overlayWasOn = cachedLayers.overlayEnabled !== false;
  const [showFootpath, setShowFootpath] = useState(overlayWasOn ? false : (cachedLayers.showFootpath ?? false));  // Blue
  const [showCycling, setShowCycling] = useState(overlayWasOn ? false : (cachedLayers.showCycling ?? false));     // Red
  const [showShared, setShowShared] = useState(overlayWasOn ? false : (cachedLayers.showShared ?? false));       // Orange
  const [showRoadcrossing, setShowRoadcrossing] = useState(cachedLayers.showRoadcrossing ?? false);  // Red
  const [showMrtExit, setShowMrtExit] = useState(cachedLayers.showMrtExit ?? false);     // Cyan
  const [showBusStop, setShowBusStop] = useState(cachedLayers.showBusStop ?? false);     // Purple
  const [showBusLane, setShowBusLane] = useState(cachedLayers.showBusLane ?? false);     // Yellow
  const [showParkingLot, setShowParkingLot] = useState(cachedLayers.showParkingLot ?? false); // Gold
  const [showKerbLine, setShowKerbLine] = useState(cachedLayers.showKerbLine ?? false);   // Deep Pink
  const [showBicycleCrossing, setShowBicycleCrossing] = useState(cachedLayers.showBicycleCrossing ?? false); // Orange
  const [showPathDefects, setShowPathDefects] = useState(cachedLayers.showPathDefects ?? false); // Red
  const [showStateLand, setShowStateLand] = useState(cachedLayers.showStateLand ?? false);
  const [showStatBoard, setShowStatBoard] = useState(cachedLayers.showStatBoard ?? false);
  const [showLandPrivate, setShowLandPrivate] = useState(cachedLayers.showLandPrivate ?? false);
  const [showLandMinistry, setShowLandMinistry] = useState(cachedLayers.showLandMinistry ?? false);

  // Cross-panel GIS layer sync: when two panels show the same project (e.g. the
  // Treatment page's Before/After maps), toggling a layer on either mirrors to both.
  // A stable per-instance id lets a panel ignore its own broadcasts, and the last
  // persisted toggle snapshot lets it skip no-op events (preventing feedback loops).
  const layerSyncIdRef = useRef(Math.random().toString(36).slice(2));
  const layerTogglesRef = useRef<Record<string, boolean>>({});

  // Update localStorage whenever these toggles change.
  // overlayEnabled is persisted so the next session knows whether the 3 path layers were
  // in "overlay-managed" mode and should be reset (rather than restored as stale trues).
  useEffect(() => {
    if (!projectName) return;
    const toggles: Record<string, boolean> = {
      showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop, showBusLane, showParkingLot, showKerbLine, showBicycleCrossing, showPathDefects,
      showStateLand, showStatBoard, showLandPrivate, showLandMinistry,
    };
    layerTogglesRef.current = toggles;
    localStorage.setItem(gisLayerToggleKey(projectName), JSON.stringify({
      ...toggles,
      overlayEnabled: showCurvatureOverlay ?? false,
    }));
    // Broadcast to any sibling panel showing the same project so its toggles mirror.
    window.dispatchEvent(new CustomEvent("psat:gisLayers:sync", {
      detail: { projectName, source: layerSyncIdRef.current, toggles },
    }));
  }, [showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop, showBusLane, showParkingLot, showKerbLine, showBicycleCrossing, showPathDefects, showStateLand, showStatBoard, showLandPrivate, showLandMinistry, showCurvatureOverlay, projectName]);

  // Mirror GIS layer toggles broadcast by a sibling panel for the same project.
  // The source-id and equality checks make this self-terminating: a panel ignores
  // its own events and any event whose toggles already match its current state.
  useEffect(() => {
    if (!projectName) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { projectName?: string; source?: string; toggles?: Record<string, boolean> }
        | undefined;
      if (!detail || detail.projectName !== projectName) return;
      if (detail.source === layerSyncIdRef.current) return;
      const incoming = detail.toggles;
      if (!incoming) return;
      const current = layerTogglesRef.current;
      if (!Object.keys(incoming).some((key) => incoming[key] !== current[key])) return;
      layerTogglesRef.current = { ...current, ...incoming };
      setShowFootpath(!!incoming.showFootpath);
      setShowCycling(!!incoming.showCycling);
      setShowShared(!!incoming.showShared);
      setShowRoadcrossing(!!incoming.showRoadcrossing);
      setShowMrtExit(!!incoming.showMrtExit);
      setShowBusStop(!!incoming.showBusStop);
      setShowBusLane(!!incoming.showBusLane);
      setShowParkingLot(!!incoming.showParkingLot);
      setShowKerbLine(!!incoming.showKerbLine);
      setShowBicycleCrossing(!!incoming.showBicycleCrossing);
      setShowPathDefects(!!incoming.showPathDefects);
      setShowStateLand(!!incoming.showStateLand);
      setShowStatBoard(!!incoming.showStatBoard);
      setShowLandPrivate(!!incoming.showLandPrivate);
      setShowLandMinistry(!!incoming.showLandMinistry);
    };
    window.addEventListener("psat:gisLayers:sync", handler);
    return () => window.removeEventListener("psat:gisLayers:sync", handler);
  }, [projectName]);

  // Sync GIS toggle states when the project changes. useState initializers only fire
  // on first mount; without this effect, switching projects leaves stale toggle values
  // from the previous project (e.g. footpath/cycling/shared left on by Analysis Overlay).
  useEffect(() => {
    const wasOn = cachedLayers.overlayEnabled !== false;
    setShowFootpath(wasOn ? false : (cachedLayers.showFootpath ?? false));
    setShowCycling(wasOn ? false : (cachedLayers.showCycling ?? false));
    setShowShared(wasOn ? false : (cachedLayers.showShared ?? false));
    setShowRoadcrossing(cachedLayers.showRoadcrossing ?? false);
    setShowMrtExit(cachedLayers.showMrtExit ?? false);
    setShowBusStop(cachedLayers.showBusStop ?? false);
    setShowBusLane(cachedLayers.showBusLane ?? false);
    setShowParkingLot(cachedLayers.showParkingLot ?? false);
    setShowKerbLine(cachedLayers.showKerbLine ?? false);
    setShowBicycleCrossing(cachedLayers.showBicycleCrossing ?? false);
    setShowPathDefects(cachedLayers.showPathDefects ?? false);
    setShowStateLand(cachedLayers.showStateLand ?? false);
    setShowStatBoard(cachedLayers.showStatBoard ?? false);
    setShowLandPrivate(cachedLayers.showLandPrivate ?? false);
    setShowLandMinistry(cachedLayers.showLandMinistry ?? false);
  }, [cachedLayers]);

  // Auto-enable path layers when Analysis Overlay is turned on; never auto-disable them
  useEffect(() => {
    if (!showCurvatureOverlay) return;
    if (!showFootpath) setShowFootpath(true);
    if (!showCycling) setShowCycling(true);
    if (!showShared) setShowShared(true);
  }, [showCurvatureOverlay]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    toggles: {
      showFootpath, showCycling, showShared, showRoadcrossing, showMrtExit, showBusStop,
      showBusLane, showParkingLot, showKerbLine, showBicycleCrossing, showPathDefects,
      showStateLand, showStatBoard, showLandPrivate, showLandMinistry,
    },
    setters: {
      setShowFootpath, setShowCycling, setShowShared, setShowRoadcrossing, setShowMrtExit,
      setShowBusStop, setShowBusLane, setShowParkingLot, setShowKerbLine, setShowBicycleCrossing,
      setShowPathDefects, setShowStateLand, setShowStatBoard, setShowLandPrivate, setShowLandMinistry,
    },
  };
}
