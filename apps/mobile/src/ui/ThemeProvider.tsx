// src/ui/ThemeProvider.tsx — light / dark / follow-the-phone, like the website's
// ThemeToggle (lib/ui/ThemeToggle.tsx), which offers the same three states.
//
// The choice is a per-device convenience, so it lives in AsyncStorage rather than
// in SecureStore: it is not a secret, and losing it costs nothing.
import * as React from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { dark, light, type Palette } from './theme'

export type ThemeMode = 'system' | 'light' | 'dark'
// Same key and default as the website (lib/ui/theme-resolve.ts): light unless chosen.
const KEY = 'ezer_theme'

interface ThemeCtx { C: Palette; isDark: boolean; mode: ThemeMode; setMode: (m: ThemeMode) => void }
const Ctx = React.createContext<ThemeCtx>({ C: light, isDark: false, mode: 'light', setMode: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme()
  const [mode, setModeState] = React.useState<ThemeMode>('light')

  React.useEffect(() => {
    AsyncStorage.getItem(KEY).then(v => { if (v === 'light' || v === 'dark' || v === 'system') setModeState(v) }).catch(() => {})
  }, [])

  const setMode = React.useCallback((m: ThemeMode) => {
    setModeState(m)
    AsyncStorage.setItem(KEY, m).catch(() => {})
  }, [])

  const isDark = mode === 'dark' || (mode === 'system' && scheme === 'dark')
  const value = React.useMemo(() => ({ C: isDark ? dark : light, isDark, mode, setMode }), [isDark, mode, setMode])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useTheme = () => React.useContext(Ctx)
