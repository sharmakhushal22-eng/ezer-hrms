// src/features/shell/MoreSheet.tsx — the website's phone "More" sheet: who you are,
// Sign out, and every section you can open, grouped like the rail (NAV_GROUPS). It
// rises over the screen you are on instead of being a page of its own; admin modules
// are not offered on a phone (EmployeePortal.tsx, AdminOnPhone).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { navigateTo } from '@/core/links'
import { LinearGradient } from 'expo-linear-gradient'
import { useEmployee } from '@/core/employee'
import { useMenu } from '@/core/menu'
import { useSession } from '@/core/session'
import { groupSections, SECTION_ICON, visibleSections, type NavSection } from '@/core/nav'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Avatar, Button, Notice, Txt } from '@/ui/primitives'
import { Sheet, useOverlay } from '@/ui/overlays'
import { IconLogout } from '@/ui/icons'
import { EyeComfortRow } from '@/ui/EyeComfort'
import { FeatureSearch } from './FeatureSearch'

function Tile({ s, on, onOpen }: { s: NavSection; on: boolean; onOpen: () => void }) {
  const { C } = useTheme()
  const I = SECTION_ICON[s.k]
  const fg = on ? '#FFFFFF' : C.ink
  return (
    <Pressable onPress={onOpen} android_ripple={{ color: C.chip }} accessibilityRole="button" accessibilityLabel={s.label}
      style={{ width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 11, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: on ? C.brand : C.line, backgroundColor: C.surface, minHeight: 54, overflow: 'hidden' }}>
      {on && <LinearGradient colors={[C.gradFrom, C.gradTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />}
      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: on ? 'rgba(255,255,255,0.2)' : C.chip, alignItems: 'center', justifyContent: 'center' }}>{I && <I size={16} color={on ? '#FFFFFF' : C.chipInk} />}</View>
      <Txt size={F.small} w={600} color={fg} style={{ flex: 1 }}>{s.label}</Txt>
      {s.status === 'soon' && <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 99, backgroundColor: C.sunken }}><Txt size={9.5} w={700} tone="muted" upper>Soon</Txt></View>}
    </Pressable>
  )
}

export function MoreSheet({ visible, onClose, active }: { visible: boolean; onClose: () => void; active: string }) {
  const { C } = useTheme()
  const { emp } = useEmployee()
  const { menu, error } = useMenu()
  const { signOut } = useSession()
  const { confirm } = useOverlay()
  const groups = groupSections(visibleSections(menu))
  const go = (route: string) => { onClose(); navigateTo(route) }
  const leave = async () => {
    onClose()
    if (await confirm({ title: 'Sign out?', message: 'You will need your password to sign in again.', confirm: 'Sign out', destructive: true })) signOut()
  }
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingBottom: S.md, marginBottom: S.md, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Avatar name={emp?.full_name} uri={emp?.profile_photo} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.body} w={700}>{emp?.full_name || ' '}</Txt>
          <Txt size={F.tiny} tone="muted">{[emp?.emp_code, emp?.designation].filter(Boolean).join(' · ')}</Txt>
        </View>
        <Button title="Sign out" variant="danger" size="sm" icon={<IconLogout size={15} color={C.critical} />} onPress={leave} />
      </View>
      <FeatureSearch onOpen={onClose} />
      {!!error && <Notice tone="critical" style={{ marginBottom: S.md }}>{`Could not load your access: ${(error as Error).message}`}</Notice>}
      {groups.map((g, gi) => (
        <View key={gi} style={{ marginBottom: S.md }}>
          {!!g.label && <Txt size={10.5} w={700} tone="faint" upper style={{ marginBottom: S.sm }}>{g.label}</Txt>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 }}>
            {g.items.map(s => <Tile key={s.k} s={s} on={active === s.k} onOpen={() => go(s.items[0].k === s.k ? s.items[0].route : `/${s.k}`)} />)}
          </View>
        </View>
      ))}
      {(menu.super_admin || Object.values(menu.modules).some(level => level > 0)) && (
        <View style={{ padding: S.md, marginBottom: S.md, borderRadius: 12, backgroundColor: C.sunken }}>
          <Txt size={F.tiny} tone="muted">Admin modules you manage (People, Compliance, Docs and others) open on a laptop or desktop.</Txt>
        </View>
      )}
      <EyeComfortRow />
      <View style={{ height: 1, backgroundColor: C.line, marginVertical: S.sm, borderRadius: R.pill }} />
      <Txt size={F.micro} tone="faint" center>EZER HRMS · Employee self-service</Txt>
    </Sheet>
  )
}
