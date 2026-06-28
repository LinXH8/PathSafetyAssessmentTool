import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/**
 * v2 Chakra theme — light-only, Inter typeface. Selected by the `?ui` flag in
 * provider.tsx. v1 keeps Chakra's `defaultSystem`. See temp/UI_V2_REDESIGN_GUIDE.md §4.
 *
 * The forced-light behaviour is applied via the ColorModeProvider props in
 * provider.tsx (next-themes `forcedTheme="light"`); here we only override the
 * font tokens to Inter. RSB risk hues stay in colorConstants.ts (guide §3).
 */
const v2Config = defineConfig({
  theme: {
    tokens: {
      fonts: {
        heading: { value: "Inter, sans-serif" },
        body: { value: "Inter, sans-serif" },
      },
    },
  },
});

export const themeV2 = createSystem(defaultConfig, v2Config);
