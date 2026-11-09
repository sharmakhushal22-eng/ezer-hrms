// src/ui/EyeComfort.tsx — lib/ui/EyeComfort.tsx: blue-light reduction for the app's
// own pixels. A layer over the app in multiply blend, so every pixel is scaled by an
// amber colour: blue falls while red stays, and text and background fall together, so
// contrast holds. On a phone the control lives in More, as on the phone website, where
// a floating dock would sit on top of whatever card was under it.
import * as React from 'react'
import { StyleSheet, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { F, S } from './theme'
import { useTheme } from './ThemeProvider'
import { Segmented, Txt } from './primitives'

const KEY = 'ezer_eye_comfort'
// lib/ui/EyeComfort.tsx: red pinned at 255; green falls a quarter as far as blue.
const GREEN_DROP = 65, BLUE_DROP = 163

const LEVELS = [{ key: '0', label: 'Off' }, { key: '30', label: 'Low' }, { key: '60', label: 'Medium' }, { key: '100', label: 'High' }]

const Ctx = React.createContext<{ strength: number; setStrength: (n: number) => void }>({ strength: 0, setStrength: () => {} })

export function EyeComfortProvider({ children }: { children: React.ReactNode }) {
  const [strength, set] = React.useState(0)
  React.useEffect(() => {
    AsyncStorage.getItem(KEY).then(v => { const n = parseInt(v || '0', 10); if (n > 0) set(Math.min(100, n)) }).catch(() => {})
  }, [])
  const value = React.useMemo(() => ({
    strength,
    setStrength: (n: number) => { set(n); AsyncStorage.setItem(KEY, String(n)).catch(() => {}) },
  }), [strength])
  const t = strength / 100
  return (
    <Ctx.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        {strength > 0 && (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { mixBlendMode: 'multiply', backgroundColor: `rgb(255, ${Math.round(255 - GREEN_DROP * t)}, ${Math.round(255 - BLUE_DROP * t)})` }]} />
        )}
      </View>
    </Ctx.Provider>
  )
}

/** The row in More (EmployeePortal.tsx: "Warmer screen for low light"). */
export function EyeComfortRow() {
  const { C } = useTheme()
  const { strength, setStrength } = React.useContext(Ctx)
  return (
    <View style={{ gap: S.sm, paddingTop: S.md, marginTop: S.xs, borderTopWidth: 1, borderTopColor: C.line }}>
      <View>
        <Txt size={F.small} w={700}>Eye comfort</Txt>
        <Txt size={F.tiny} tone="muted">Warmer screen for low light</Txt>
      </View>
      <Segmented items={LEVELS} value={String(strength)} onChange={k => setStrength(Number(k))} />
    </View>
  )
}
