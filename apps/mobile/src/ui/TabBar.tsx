// src/ui/TabBar.tsx — the phone tab bar, drawn like the website's .ess-tabbar
// (components/ess/portal.css): a frosted strip, label under an icon pill, the
// active pill filled with the portal gradient.
import * as React from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Tabs } from 'expo-router'
import { useTheme } from './ThemeProvider'
import { Txt } from './primitives'
import { IconMore } from './icons'
import { SECTION_ICON } from '@/core/nav'

export type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0]

const TAB_META: Record<string, { label: string; icon: string }> = {
  index: { label: 'Home', icon: 'home' },
  payroll: { label: 'Payroll', icon: 'payroll' },
  attendance: { label: 'Attend', icon: 'attendance' },
  leave: { label: 'Leave', icon: 'leave' },
  more: { label: 'More', icon: 'more' },
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', paddingTop: 6, paddingHorizontal: 6,
      paddingBottom: 6 + insets.bottom, backgroundColor: C.surface,
      borderTopWidth: 1, borderTopColor: C.hair, shadowColor: C.shadow, shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: -6 }, elevation: 12,
    }}>
      {state.routes.map((route, i) => {
        const meta = TAB_META[route.name]
        if (!meta) return null
        const on = state.index === i
        const Icon = meta.icon === 'more' ? IconMore : SECTION_ICON[meta.icon]
        const fg = on ? '#FFFFFF' : C.essInk3
        return (
          <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={meta.label}
            onPress={() => {
              const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
              if (!on && !e.defaultPrevented) navigation.navigate(route.name)
            }}
            style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 }}>
            <View style={{ width: 50, height: 30, borderRadius: 99, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
              {on && <LinearGradient colors={[C.gradFrom, C.gradTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
              {Icon && <View style={{ position: 'relative' }}><Icon size={19} color={fg} strokeWidth={on ? 2.2 : 1.8} /></View>}
            </View>
            <Txt size={10.5} w={600} color={on ? C.chipInk : C.essInk3}>{meta.label}</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}
