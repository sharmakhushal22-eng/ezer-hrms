// src/features/shell/TopBar.tsx — the phone top bar of the website's portal:
// logo, the compact theme button, the notification bell, the avatar.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { api } from '@/core/api'
import { useEmployee } from '@/core/employee'
import { useTheme, type ThemeMode } from '@/ui/ThemeProvider'
import { S } from '@/ui/theme'
import { Avatar, IconButton } from '@/ui/primitives'
import { Logo } from '@/ui/Logo'
import { IconBell } from '@/ui/icons'
import Svg, { Circle, Path } from 'react-native-svg'
import { openBell, useUnreadCount } from './notifications'

// lib/ui/ThemeToggle.tsx: light → dark → system → light, each with its own fill.
const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' }
const FILL: Record<ThemeMode, { bg: string; ink: string }> = {
  light: { bg: '#F59E0B', ink: '#1F2937' }, dark: { bg: '#4F46E5', ink: '#FFFFFF' }, system: { bg: '#0F766E', ink: '#FFFFFF' },
}
const LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' }

function ThemeGlyph({ mode, color }: { mode: ThemeMode; color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round">
      {mode === 'light' && <><Circle cx="10" cy="10" r="3.4" /><Path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M15.3 4.7l-1.1 1.1M5.8 14.2l-1.1 1.1" /></>}
      {mode === 'dark' && <Path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8Z" />}
      {mode === 'system' && <><Circle cx="10" cy="10" r="6.5" /><Path d="M10 3.5a6.5 6.5 0 0 1 0 13Z" fill={color} /></>}
    </Svg>
  )
}

export function ThemeButton() {
  const { mode, setMode } = useTheme()
  const f = FILL[mode]
  const pick = () => {
    const next = NEXT[mode]
    setMode(next)
    // The website saves the choice to the employee's preferences too (best effort).
    api('/api/ess/preferences', { method: 'PUT', body: { theme: next === 'system' ? 'auto' : next } }).catch(() => {})
  }
  return (
    <Pressable onPress={pick} accessibilityLabel={`Theme: ${LABEL[mode]}. Switch to ${LABEL[NEXT[mode]]}`}
      style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: f.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ThemeGlyph mode={mode} color={f.ink} />
    </Pressable>
  )
}

export function TopBar() {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  const { emp } = useEmployee()
  const unread = useUnreadCount()
  return (
    <View style={{ paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.canvas, borderBottomWidth: 1, borderBottomColor: C.hair }}>
      <Logo height={20} />
      <View style={{ flex: 1 }} />
      <ThemeButton />
      <IconButton label="Notifications" badge={unread} onPress={openBell}>
        <IconBell size={20} color={C.muted} />
      </IconButton>
      <Pressable onPress={() => router.push('/profile')} accessibilityLabel="My profile">
        <Avatar name={emp?.full_name} uri={emp?.profile_photo} size={32} />
      </Pressable>
    </View>
  )
}
