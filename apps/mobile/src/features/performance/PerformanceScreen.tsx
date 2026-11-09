// src/features/performance/PerformanceScreen.tsx — PMS in the app (website:
// components/ess/Performance.tsx). Three audiences — Me, My team, My
// department — offered only for the roles you hold (derived from the org
// columns: L1, L2 or HOD reportees; HOD via departments.hod_employee_id or
// employees.hod_id). Each is a card saying what you do on that side and how
// many it covers; below the cycle header, the chosen side's workspace header
// carries the open tab's purpose and the tabs. The cycle header's
// call-to-action moves both dials (GO_TO).
import * as React from 'react'
import { Pressable, View, type ScrollView } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import type { ActionTab } from '@web/pms/cycle'
import { useEmployeeId } from '@/core/session'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import type { Palette } from '@/ui/theme'
import { F, R, S } from '@/ui/theme'
import { Loading, Txt } from '@/ui/primitives'
import { IconBuilding, IconEmployees, IconUser } from '@/ui/icons'
import { Screen } from '@/ui/Screen'
import { loadRoles, probeModule, type Roles } from './data'
import { CycleHeader } from './CycleHeader'
import { EMP_TABS, MySide, type EmpTab } from './MySide'
import { DeptSide, HOD_TABS, MGR_TABS, TeamSide, type HodTab, type MgrTab } from './Sides'
import { ModulePending } from './Pending'
import { TabStrip } from './ui'
import { RevealProvider, revealIn } from './scroll'

type Scope = 'me' | 'team' | 'dept'

const GO_TO: Record<ActionTab, { scope: Scope; tab: string }> = {
  mine: { scope: 'me', tab: 'kras' },
  self: { scope: 'me', tab: 'self' },
  oneone: { scope: 'me', tab: 'oneToOne' },
  team: { scope: 'team', tab: 'approve' },
  dept: { scope: 'dept', tab: 'finalise' },
  fill: { scope: 'dept', tab: 'deptAnalytics' },
}

/** What each side of the review is for, in the words on its card (Performance.tsx SCOPE_META). */
const SCOPE_META: Record<Scope, { title: string; does: string }> = {
  me: { title: 'Me', does: 'Your KRAs, self rating, one-to-ones and result' },
  team: { title: 'My team', does: 'Approve KRAs, hold one-to-ones and rate the people you manage' },
  dept: { title: 'My department', does: 'Review, finalise and publish results for your department' },
}
const SCOPE_ICON = { me: IconUser, team: IconEmployees, dept: IconBuilding }
/** pms.css .pms-scope-me / -team / -dept: brand, info, positive. */
const scopeColours = (C: Palette, s: Scope) =>
  s === 'team' ? { c: C.info, tint: C.infoTint, edge: C.infoEdge }
  : s === 'dept' ? { c: C.positive, tint: C.positiveTint, edge: C.positiveEdge }
  : { c: C.brandDeep, tint: C.brandTint, edge: C.brandEdge }

function scopeMeta(roles: Roles, k: Scope) {
  const count = k === 'team' ? `${roles.reportees} ${roles.reportees === 1 ? 'person' : 'people'}`
    : k === 'dept' && roles.deptCount > 0 ? `${roles.deptCount} ${roles.deptCount === 1 ? 'department' : 'departments'}`
    : null
  return { ...SCOPE_META[k], count }
}

function ScopeCard({ k, roles, on, onPick }: { k: Scope; roles: Roles; on: boolean; onPick: (s: Scope) => void }) {
  const { C } = useTheme()
  const m = scopeMeta(roles, k)
  const c = scopeColours(C, k)
  const Ico = SCOPE_ICON[k]
  return (
    <Pressable onPress={() => onPick(k)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${m.title}. ${m.does}${m.count ? `. ${m.count}` : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md, borderRadius: R.lg, borderWidth: on ? 2 : 1,
        borderColor: on ? c.c : C.line, backgroundColor: on ? c.tint : C.surface }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.c : c.tint }}>
        <Ico size={18} color={on ? C.onAccent : c.c} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.body} w={700} color={on ? c.c : C.ink}>{m.title}</Txt>
        <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{m.does}</Txt>
      </View>
      {!!m.count && (
        <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, backgroundColor: on ? C.surface : C.sunken, flexShrink: 0 }}>
          <Txt size={F.micro} w={700} color={on ? c.c : C.muted}>{m.count}</Txt>
        </View>
      )}
    </Pressable>
  )
}

/** The workspace header: which side, what the open tab is for, and the tabs along its lower edge. */
function Workspace({ scope, roles, tabs, active, onPick }: {
  scope: Scope; roles: Roles; tabs: { k: string; label: string; blurb: string }[]; active: string; onPick: (k: string) => void
}) {
  const { C } = useTheme()
  const m = scopeMeta(roles, scope)
  const c = scopeColours(C, scope)
  const Ico = SCOPE_ICON[scope]
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.lg, backgroundColor: C.surface, marginBottom: S.lg, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, padding: S.md, paddingBottom: 0 }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.tint }}>
          <Ico size={18} color={c.c} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.lead} w={700}>{m.title}</Txt>
          <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{tabs.find(t => t.k === active)?.blurb}</Txt>
        </View>
        {!!m.count && <Txt size={F.micro} w={700} tone="muted" style={{ flexShrink: 0 }}>{m.count}</Txt>}
      </View>
      <View style={{ paddingHorizontal: S.sm }}>
        <TabStrip tabs={tabs} active={active} onPick={onPick} />
      </View>
    </View>
  )
}

export default function PerformanceScreen() {
  const employeeId = useEmployeeId()
  const rolesQ = useQuery({ queryKey: ['pms', 'roles', employeeId], queryFn: () => loadRoles(employeeId), enabled: !!employeeId })
  const moduleQ = useQuery({ queryKey: ['pms', 'probe'], queryFn: probeModule })
  const [scope, setScope] = React.useState<Scope>('me')
  const [empTab, setEmpTab] = React.useState<EmpTab>('dashboard')
  const [mgrTab, setMgrTab] = React.useState<MgrTab>('team')
  const [hodTab, setHodTab] = React.useState<HodTab>('finalise')

  const scroller = React.useRef<ScrollView>(null)
  // The sub-tabs: the next-step card ("Add your first KRA") switches the tab and brings it
  // into view, since the tab's content opens below the cycle card, off the screen.
  const workspace = React.useRef<View>(null)
  const roles = rolesQ.data
  const refresh = () => invalidate('pms')
  const frame = (body: React.ReactNode) => (
    <Screen title="Performance" subtitle="Your goals (KRAs) and the reviews you owe" onRefresh={refresh} scrollRef={scroller}>
      <RevealProvider scroller={scroller}>{body}</RevealProvider>
    </Screen>
  )
  if (moduleQ.data === false) return frame(<ModulePending />)
  if (!roles) return frame(<Loading />)

  const scopes: Scope[] = ['me', ...(roles.isRM ? ['team' as const] : []), ...(roles.isHOD ? ['dept' as const] : [])]
  const tabs = scope === 'me' ? EMP_TABS : scope === 'team' ? MGR_TABS : HOD_TABS
  const activeKey = scope === 'me' ? empTab : scope === 'team' ? mgrTab : hodTab
  const pick = (k: string) => {
    if (scope === 'me') setEmpTab(k as EmpTab)
    else if (scope === 'team') setMgrTab(k as MgrTab)
    else setHodTab(k as HodTab)
  }
  const goToAction = (destination: string) => {
    // An unmapped destination falls back to the person's own dashboard rather than doing nothing.
    const { scope: s, tab } = GO_TO[destination as ActionTab] ?? { scope: 'me' as Scope, tab: 'dashboard' }
    setScope(s)
    if (s === 'me') setEmpTab(tab as EmpTab)
    else if (s === 'team') setMgrTab(tab as MgrTab)
    else setHodTab(tab as HodTab)
    revealIn(scroller, workspace.current)
  }

  return frame(
    <>
      {scopes.length > 1 && (
        <View accessibilityRole="tablist" accessibilityLabel="Which side of the review" style={{ gap: S.sm, marginBottom: S.lg }}>
          {scopes.map(k => <ScopeCard key={k} k={k} roles={roles} on={scope === k} onPick={setScope} />)}
        </View>
      )}
      {/* On every side: the header carries the next step, including a manager's own overdue self rating. */}
      <CycleHeader employeeId={employeeId} isRM={roles.isRM} isHOD={roles.isHOD} onGo={goToAction} />
      <View ref={workspace} collapsable={false}>
        <Workspace scope={scope} roles={roles} tabs={tabs as { k: string; label: string; blurb: string }[]} active={activeKey} onPick={pick} />
      </View>
      {scope === 'me' && <MySide employeeId={employeeId} tab={empTab} />}
      {scope === 'team' && <TeamSide employeeId={employeeId} tab={mgrTab} />}
      {scope === 'dept' && <DeptSide employeeId={employeeId} tab={hodTab} />}
    </>
  )
}
