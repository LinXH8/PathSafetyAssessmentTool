"use client"

import { ChakraProvider, defaultSystem } from "@chakra-ui/react"
import {
  ColorModeProvider,
  type ColorModeProviderProps,
} from "./color-mode"
import { resolveUiVersion } from "../../features/ui/useUiVersion"
import { themeV2 } from "../../theme/themeV2"

export function Provider(props: ColorModeProviderProps) {
  // The theme is fixed at provider mount; the ?ui flag is resolved synchronously
  // at the root. Changing the flag requires a reload to re-pick the theme (§2/§4).
  const ui = resolveUiVersion()
  const isV2 = ui === "v2"

  // v2 is light-only: force light and disable system color-mode. v1 untouched.
  const colorModeForcing = isV2
    ? { forcedTheme: "light", defaultTheme: "light", enableSystem: false }
    : {}

  return (
    <ChakraProvider value={isV2 ? themeV2 : defaultSystem}>
      <ColorModeProvider {...colorModeForcing} {...props} />
    </ChakraProvider>
  )
}
