/**
 * Risk-band color and label utilities — single source of truth for the Report
 * Builder's numeric band index (1=Low … 4=Extreme) representation.
 *
 * Two representations of the same four risk levels exist for historical reasons:
 *  - RISK_BAND_COLORS (keyed by name: LOW/MEDIUM/HIGH/EXTREME) lives in
 *    colorConstants.ts and is used everywhere that works with named bands.
 *  - RISK_COLORS / RISK_LABELS (keyed by index 1–4) are used by the Report
 *    Builder, which receives numeric band values from the score API. They are
 *    derived from RISK_BAND_COLORS so hex values stay in sync automatically.
 *
 * Used by: reportBuilderPage.tsx.
 */

import { RISK_BAND_COLORS } from "../components/visualization/scoreband/colorConstants";

/** Band index (1=Low, 2=Medium, 3=High, 4=Extreme) → hex color. */
export const RISK_COLORS: Record<number, string> = {
  1: RISK_BAND_COLORS.LOW,
  2: RISK_BAND_COLORS.MEDIUM,
  3: RISK_BAND_COLORS.HIGH,
  4: RISK_BAND_COLORS.EXTREME,
};

/** Band index (1=Low, 2=Medium, 3=High, 4=Extreme) → display label. */
export const RISK_LABELS: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Extreme",
};
