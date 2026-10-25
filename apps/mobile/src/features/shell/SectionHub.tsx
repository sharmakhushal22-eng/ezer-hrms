// src/features/shell/SectionHub.tsx — a section's sub-tabs as a list.
//
// The website draws a pill row (SubTabs) for a section with two or more items;
// nine pills do not fit a phone, so the app lists them, with the website's
// "Soon" chip on the items that are placeholders there.
import * as React from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { useMenu } from '@/core/menu'
import { SECTION_ICON, sectionOf } from '@/core/nav'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Badge, Card, ListRow, Txt } from '@/ui/primitives'

export function SectionHub({ section }: { section: string }) {
  const { C } = useTheme()
  const { menu } = useMenu()
  const s = sectionOf(section)
  if (!s) return null
  const I = SECTION_ICON[s.k]
  // components/ess/hris/HrisShell.tsx: Tasks & Approvals only for someone who can
  // approve (menu.can.approvals); Raise MRF only for an RM, HOD or approver.
  const items = s.items.filter(i => !(s.k === 'hris' && (
    (i.k === 'approvals' && !menu.can.approvals) ||
    (i.k === 'raise-mrf' && !(menu.is_rm || menu.is_hod || menu.can.approvals)))))
  return (
    <Card padded={false} style={{ paddingHorizontal: S.lg }}>
      {items.map((it, i) => (
        <View key={it.k} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
          <ListRow title={it.label} onPress={() => router.push(it.route as any)}
            left={<View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: C.chip, alignItems: 'center', justifyContent: 'center' }}>{I && <I size={17} color={C.chipInk} />}</View>}
            right={it.needs ? <Badge label="Soon" /> : undefined} />
        </View>
      ))}
    </Card>
  )
}

export function SectionHeading({ section }: { section: string }) {
  const s = sectionOf(section)
  if (!s) return null
  return (
    <View style={{ marginBottom: S.lg }}>
      <Txt size={F.page} w={700}>{s.label}</Txt>
      <Txt size={F.small} tone="muted" style={{ marginTop: 2 }}>{s.desc}</Txt>
    </View>
  )
}
