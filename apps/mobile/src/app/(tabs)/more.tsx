// More — the website's phone "More" sheet as a screen: who you are, Sign out, and
// every section you can open, grouped exactly like the rail (NAV_GROUPS).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useEmployee } from '@/core/employee'
import { useMenu } from '@/core/menu'
import { useSession } from '@/core/session'
import { groupSections, SECTION_ICON, visibleSections, type NavSection } from '@/core/nav'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Avatar, Button, Card, Notice, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { IconLogout } from '@/ui/icons'
import { TabScreen } from '@/features/shell/TabScreen'
import { FeatureSearch } from '@/features/shell/FeatureSearch'

/** Where tapping a section goes: a single-item section opens its screen. A section
 *  with sub-tabs (Payroll, Profile, HR Services) opens a list of them — the phone's
 *  version of the website's pill row, which would not fit nine tabs across. */
function routeOf(s: NavSection) {
  if (s.k === 'home') return '/'
  if (s.k === 'payroll') return '/payroll'
  if (s.items.length > 1) return `/section/${s.k}`
  return s.items[0].route
}

function Tile({ s }: { s: NavSection }) {
  const { C } = useTheme()
  const I = SECTION_ICON[s.k]
  return (
    <Pressable onPress={() => router.push(routeOf(s) as any)}
      style={({ pressed }) => ({ width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.brandTint : C.surface, minHeight: 52 })}>
      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center' }}>{I && <I size={16} color={C.chipInk} />}</View>
      <Txt size={F.small} w={600} style={{ flex: 1 }} numberOfLines={2}>{s.label}</Txt>
      {s.status === 'soon' && <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 99, backgroundColor: C.sunken }}><Txt size={9.5} w={700} tone="muted" upper>Soon</Txt></View>}
    </Pressable>
  )
}

export default function More() {
  const { C } = useTheme()
  const { emp } = useEmployee()
  const { menu, error, refetch } = useMenu()
  const { signOut } = useSession()
  const { confirm } = useOverlay()
  const groups = groupSections(visibleSections(menu))

  return (
    <TabScreen onRefresh={refetch}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.lg }}>
        <Avatar name={emp?.full_name} uri={emp?.profile_photo} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.body} w={700} numberOfLines={1}>{emp?.full_name || ' '}</Txt>
          <Txt size={F.tiny} tone="muted" numberOfLines={1}>{[emp?.emp_code, emp?.designation].filter(Boolean).join(' · ')}</Txt>
        </View>
        <Button title="Sign out" variant="danger" size="sm" icon={<IconLogout size={15} color={C.critical} />}
          onPress={async () => { if (await confirm({ title: 'Sign out?', message: 'You will need your password to sign in again.', confirm: 'Sign out', destructive: true })) signOut() }} />
      </Card>
      <FeatureSearch />
      {!!error && <Notice tone="critical" style={{ marginBottom: S.md }}>{`Could not load your access: ${(error as Error).message}`}</Notice>}
      {groups.map((g, gi) => (
        <View key={gi} style={{ marginBottom: S.lg }}>
          {!!g.label && <Txt size={10.5} w={700} tone="faint" upper style={{ marginBottom: S.sm }}>{g.label}</Txt>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 }}>
            {g.items.map(s => <Tile key={s.k} s={s} />)}
          </View>
        </View>
      ))}
      <View style={{ height: 1, backgroundColor: C.line, marginVertical: S.sm, borderRadius: R.pill }} />
      <Txt size={F.micro} tone="faint" center>EZER HRMS · Employee self-service</Txt>
    </TabScreen>
  )
}
