// src/features/shell/Placeholders.tsx — what the website shows for a screen that
// is not built yet, word for word (EmployeePortal.tsx Placeholder / FeatureGrid).
// Salary Slip and Statutory render <Placeholder/>; RNR renders <FeatureGrid/>.
// Nothing here invents data: these screens say "not switched on" because on the
// website they say exactly that.
import * as React from 'react'
import { View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Card, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { IconAward, IconCalendar } from '@/ui/icons'
import { SECTION_ICON, sectionOf } from '@/core/nav'

export function Placeholder({ label }: { label: string }) {
  const { C } = useTheme()
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: S.xl }}>
      <View style={{ width: 56, height: 56, borderRadius: R.lg, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge, alignItems: 'center', justifyContent: 'center', marginBottom: S.lg }}>
        <IconCalendar size={24} color={C.brand} />
      </View>
      <Txt size={17} w={700} center>{label} is coming soon</Txt>
      <Txt size={13.5} tone="muted" center style={{ marginTop: S.sm }}>We’re getting this ready for you. It will appear here as soon as your HR team switches it on.</Txt>
    </Card>
  )
}

export function PlaceholderScreen({ label, section }: { label: string; section: string }) {
  const s = sectionOf(section)
  return <Screen title={label} subtitle={s?.label}><Placeholder label={label} /></Screen>
}

export function FeatureGridScreen({ section }: { section: string }) {
  const { C } = useTheme()
  const s = sectionOf(section)!
  return (
    <Screen title={s.label} subtitle={s.desc}>
      <View style={{ flexDirection: 'row', alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99, backgroundColor: C.sunken, marginBottom: S.md }}>
        <Txt size={11} w={600} tone="muted">Coming soon</Txt>
      </View>
      <View style={{ gap: S.sm }}>
        {(s.features || []).map(f => {
          const I = SECTION_ICON[f.icon] || IconAward
          return (
            <View key={f.name} style={{ flexDirection: 'row', gap: S.md, alignItems: 'center', padding: S.md, borderRadius: R.lg, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }}>
              <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' }}><I size={18} color={C.brand} /></View>
              <View style={{ flex: 1 }}>
                <Txt size={13.5} w={700}>{f.name}</Txt>
                <Txt size={F.tiny} tone="muted">{f.note}</Txt>
              </View>
            </View>
          )
        })}
      </View>
      <View style={{ marginTop: S.lg, padding: S.md, borderRadius: R.md, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge }}>
        <Txt size={F.small} color={C.brandDeep}>This is on its way. Above is what it will let you do. It isn’t switched on yet.</Txt>
      </View>
    </Screen>
  )
}
