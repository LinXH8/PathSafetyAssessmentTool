/**
 * v2 design tokens — the concrete values from temp/psat-design/DESIGN_GUIDE.md.
 * These back the v2 layout shells (light-only). RSB risk hues are intentionally
 * NOT redefined here — reuse colorConstants.ts for those (guide §3 / §4).
 */

export const FONT = "Inter, sans-serif";

// Surfaces & neutrals (Chakra gray scale)
export const COLOR = {
  canvas: "#F7FAFC", // gray.50
  gray100: "#EDF2F7",
  border: "#E2E8F0", // gray.200 — card borders, dividers
  borderInput: "#CBD5E0", // gray.300 — input/ghost borders, switch-off track
  gray400: "#A0AEC0", // disabled text, placeholder glyphs
  gray500: "#718096", // captions, placeholders
  gray600: "#4A5568", // legend/secondary text, real chevrons
  text: "#2D3748", // gray.700 — body & darkest UI text (never #000)
  gray800: "#1A202C", // secondary-button fill

  white: "#fff",

  // Accent = scope (not decoration)
  blue: "#3182CE", // local scope
  blueHover: "#2C5FA8",
  teal: "#319795", // global scope
  tealHover: "#2C7A7B",

  danger: "#E53E3E",
  dangerHover: "#C53030",
  dangerBg: "#FFF5F5", // soft-red highlight paired with a `danger` border

  rowDivider: "#EDF2F7",
} as const;

// Categorical / tag palette (cycled in order; excludes blue/teal/RSB hues)
export const CATEGORICAL = ["#718096", "#00B5D8", "#D53F8C", "#DD6B20"] as const;

// Sizing tokens — hybrid responsive units (see temp/UI_V2_REDESIGN_GUIDE.md
// "Sizing & Responsive-Unit Conversion Catalog"). Reference viewport 1920×911,
// root font 16px. Density values are rem (px÷16), screen-independent.
export const RADIUS = "0.375rem"; // 6px
export const CONTENT_PADDING = "2rem"; // 32px — screen content padding
export const CARD_GAP = "1rem"; // 16px — gap between stacked cards
export const SIDEBAR_WIDTH = "17.5rem"; // 280px — fixed rem (never raw vw; balloons on ultrawide)
