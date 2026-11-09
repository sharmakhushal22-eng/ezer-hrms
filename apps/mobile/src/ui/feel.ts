// src/ui/feel.ts — the small physical response a phone gives to a tap.
import { Platform } from 'react-native'
import * as Haptics from 'expo-haptics'

/** A light tick for changing tab: confirms the tap without announcing itself. */
export function tick() {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {})
}
