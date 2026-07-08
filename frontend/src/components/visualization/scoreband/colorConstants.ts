/**
 * STANDARDIZED RISK BAND THRESHOLDS
 * This is the single source of truth for all safety band categorization in the application.
 *
 * All pages must use these exact thresholds (CycleRAP v2.14 — inclusive
 * upper bounds; VB/overall shown, BB/BP/SB use 5/10/20):
 * - Low: <=10
 * - Medium: >10-25
 * - High: >25-60
 * - Extreme: >60
 *
 * Used consistently throughout the application for:
 * - Risk Score visualization (Coding Page, Path Analysis)
 * - Crash Type Risk bands (VB, BB, SB, BP)
 * - Score-based UI elements (Attribute Analysis filters)
 */

export const RISK_BAND_COLORS = {
  LOW: '#87C424',      // Green
  MEDIUM: '#FFCC1A',   // Yellow
  HIGH: '#FF5B1A',     // Orange
  EXTREME: '#CD1AFF',  // Purple
} as const;

/**
 * Get risk band color based on score
 * Thresholds: Low (<=10), Medium (>10-25), High (>25-60), Extreme (>60)
 */
export function getRiskBandColor(score: number): string {
  if (score <= 10) return RISK_BAND_COLORS.LOW;
  if (score <= 25) return RISK_BAND_COLORS.MEDIUM;
  if (score <= 60) return RISK_BAND_COLORS.HIGH;
  return RISK_BAND_COLORS.EXTREME;
}

/**
 * Get risk band label based on score
 * Thresholds: Low (<=10), Medium (>10-25), High (>25-60), Extreme (>60)
 */
export function getRiskBandLabel(score: number): 'Low' | 'Medium' | 'High' | 'Extreme' {
  if (score <= 10) return 'Low';
  if (score <= 25) return 'Medium';
  if (score <= 60) return 'High';
  return 'Extreme';
}

/**
 * Get risk band index based on score
 * Returns 1-4 for band indices: 1=Low, 2=Medium, 3=High, 4=Extreme
 */
export function getRiskBandIndex(score: number): 1 | 2 | 3 | 4 {
  if (score <= 10) return 1;    // Low: <10
  if (score <= 25) return 2;   // Medium: 10-25
  if (score <= 60) return 3;   // High: 25-60
  return 4;                     // Extreme: >60
}

/**
 * Get segment risk band color using per-crash-type thresholds.
 * Mirrors GeoDataPanel.getSegmentColor:
 *   BB/BP/SB: Extreme>20, High>10, Medium>5
 *   VB:       Extreme>60, High>25, Medium>10
 * Returns the colour of the worst crash type.
 */
export function getSegmentRiskBandColor(scores: Record<string, any> | null | undefined): string {
  if (!scores) return RISK_BAND_COLORS.LOW;

  let maxLevel = 0;
  const crashTypes = ['BB', 'BP', 'SB', 'VB'];

  for (const ct of crashTypes) {
    const score = Number(scores[ct]) || 0;
    let level = 0;
    if (['BB', 'BP', 'SB'].includes(ct)) {
      if (score > 20) level = 3;
      else if (score > 10) level = 2;
      else if (score >= 5) level = 1;
    } else {
      if (score > 60) level = 3;
      else if (score > 25) level = 2;
      else if (score >= 10) level = 1;
    }
    if (level > maxLevel) maxLevel = level;
  }

  switch (maxLevel) {
    case 3: return RISK_BAND_COLORS.EXTREME;
    case 2: return RISK_BAND_COLORS.HIGH;
    case 1: return RISK_BAND_COLORS.MEDIUM;
    default: return RISK_BAND_COLORS.LOW;
  }
}
