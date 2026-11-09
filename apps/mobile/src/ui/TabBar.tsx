// src/ui/TabBar.tsx — the phone tab bar, drawn like the website's .ess-tabbar
// (components/ess/portal.css): a solid strip, label under an icon pill, the active
// pill filled with the portal gradient. It stays on every section. Sections without
// a tab of their own are opened from More, which rises over the screen as a sheet
// and is marked while one of them is open.
import * as React from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Tabs } from 'expo-router'
import { useTheme } from './ThemeProvider'
import { Txt } from './primitives'
import { IconMore } from './icons'
import { tick } from './feel'
import { SECTION_ICON } from '@/core/nav'
import { MoreSheet } from '@/features/shell/MoreSheet'

export type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0]

const PRIMARY: { route: string; label: string; icon: string }[] = [
  { route: 'index', label: 'Home', icon: 'home' },
  { route: 'payroll', label: 'Payroll', icon: 'payroll' },
  { route: 'attendance', label: 'Attend', icon: 'attendance' },
  { route: 'leave', label: 'Leave', icon: 'leave' },
]

function Tab({ label, on, icon: Icon, onPress }: { label: string; on: boolean; icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>; onPress: () => void }) {
  const { C } = useTheme()
  const fg = on ? '#FFFFFF' : C.essInk3
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={onPress}
      style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 }}>
      <View style={{ width: 50, height: 30, borderRadius: 99, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {on && <LinearGradient colors={[C.gradFrom, C.gradTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
        {Icon && <View style={{ position: 'relative' }}><Icon size={19} color={fg} strokeWidth={on ? 2.2 : 1.8} /></View>}
      </View>
      <Txt size={10.5} w={600} color={on ? C.chipInk : C.essInk3}>{label}</Txt>
    </Pressable>
  )
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  const [moreOpen, setMoreOpen] = React.useState(false)

  const current = state.routes[state.index]?.name
  const go = (route: string) => {
    tick()
    setMoreOpen(false)
    if (route !== current) navigation.navigate(route)
  }
  const onPrimary = PRIMARY.some(t => t.route === current)

  return (
    <>
      <View style={{
        flexDirection: 'row', paddingTop: 6, paddingHorizontal: 6, paddingBottom: 6 + insets.bottom, backgroundColor: C.surface,
        borderTopWidth: 1, borderTopColor: C.hair, shadowColor: C.shadow, shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: -6 }, elevation: 12,
      }}>
        {PRIMARY.map(t => <Tab key={t.route} label={t.label} on={!moreOpen && current === t.route} icon={SECTION_ICON[t.icon]} onPress={() => go(t.route)} />)}
        <Tab label="More" on={moreOpen || !onPrimary} icon={IconMore} onPress={() => { tick(); setMoreOpen(o => !o) }} />
      </View>
      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} active={current === 'index' ? 'home' : current} />
    </>
  )
}
