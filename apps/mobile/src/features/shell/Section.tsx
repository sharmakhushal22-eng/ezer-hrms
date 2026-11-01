// src/features/shell/Section.tsx — a section of the app, inside its shell.
//
// The website's phone portal never leaves the page: the top bar and thumb bar stay
// where they are, and a section's sub-tabs swap the content underneath them
// (EmployeePortal.tsx SubTabs, portal.css .ess-head / .ess-seg). This is that, for
// the app. A panel is mounted on first opening and then kept, so going back to one
// is instant and keeps its scroll position and anything half-typed.
import * as React from 'react'
import { View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useMenu } from '@/core/menu'
import { SECTION_ICON, sectionOf } from '@/core/nav'
import { useTheme } from '@/ui/ThemeProvider'
import { ScreenFrame } from '@/ui/Screen'
import { F, S } from '@/ui/theme'
import { Segmented, Txt } from '@/ui/primitives'

/** The section's heading — portal.css .ess-head. */
export function SectionHead({ section }: { section: string }) {
  const { C } = useTheme()
  const s = sectionOf(section)
  if (!s) return null
  const I = SECTION_ICON[s.k]
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S.md, paddingHorizontal: S.lg, paddingTop: S.lg, paddingBottom: S.md }}>
      <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge, alignItems: 'center', justifyContent: 'center' }}>
        {I && <I size={21} color={C.brand} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={21} w={700}>{s.label}</Txt>
        <Txt size={F.small} tone="muted" style={{ marginTop: 1 }}>{s.desc}</Txt>
      </View>
    </View>
  )
}

/** A section with one screen: Team, Attendance, Leave… `head={false}` is Home. */
export function Section({ k, head = true, children }: { k: string; head?: boolean; children: React.ReactNode }) {
  const frame = React.useMemo(() => ({ head: head ? <SectionHead section={k} /> : undefined }), [k, head])
  return <ScreenFrame.Provider value={frame}>{children}</ScreenFrame.Provider>
}

/** A section with sub-tabs. The open one is the route's `?sub=` param, so a link from
 *  a notification, a Home card or the search lands on the right tab. A pane may be
 *  reachable without a tab of its own (Payroll's Investment Declaration). */
export function SectionTabs({ section, panes }: { section: string; panes: Record<string, React.ComponentType> }) {
  const s = sectionOf(section)
  const { menu } = useMenu()
  const { sub } = useLocalSearchParams<{ sub?: string }>()

  // components/ess/hris/HrisShell.tsx: Tasks & Approvals only for someone who can approve.
  const items = (s?.items || []).filter(i => !(section === 'hris' && i.k === 'approvals' && !menu.can.approvals))
  const first = items[0]?.k ?? ''
  const wanted = typeof sub === 'string' && panes[sub] ? sub : first
  const [open, setOpen] = React.useState(wanted)
  const [seen, setSeen] = React.useState<string[]>([wanted])
  const show = (k: string) => { setOpen(k); setSeen(v => (v.includes(k) ? v : [...v, k])) }
  // A link arrived while the section was already open.
  const [linked, setLinked] = React.useState(wanted)
  if (wanted !== linked) { setLinked(wanted); show(wanted) }
  const pick = (k: string) => { show(k); router.setParams({ sub: k }) }

  const frame = {
    head: <SectionHead section={section} />,
    tabs: <Segmented bleed items={items.map(i => ({ key: i.k, label: i.label, soon: !!i.needs }))} value={open} onChange={pick} />,
  }

  return (
    <ScreenFrame.Provider value={frame}>
      {seen.map(k => {
        const Pane = panes[k]
        if (!Pane) return null
        return <View key={k} style={{ flex: 1, display: k === open ? 'flex' : 'none' }}><Pane /></View>
      })}
    </ScreenFrame.Provider>
  )
}
